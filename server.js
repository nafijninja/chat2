require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 10000
}).then(() => console.log('✅ MongoDB Connected')).catch(err => console.error('❌ MongoDB Connection Error:', err));

// Define Message Schema
const messageSchema = new mongoose.Schema({
  user: String,
  text: String,
  fileUrl: String,
  fileName: String,
  reaction: String,
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// Ensure 'uploads' directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

app.use('/uploads', express.static(uploadDir));

// File upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const fileUrl = `/uploads/${req.file.filename}`;
  const message = new Message({ user: 'Anonymous', fileUrl, fileName: req.file.originalname });
  await message.save();

  io.emit('file message', { user: 'Anonymous', fileUrl, fileName: req.file.originalname });
  res.json({ fileUrl, fileName: req.file.originalname });
});

// Get messages from MongoDB
app.get('/messages', async (req, res) => {
  const messages = await Message.find().sort('timestamp');
  res.json(messages);
});

const users = {}; // Store usernames

io.on('connection', async (socket) => {
  console.log('User connected:', socket.id);

  // Send stored messages
  socket.emit('load messages', await Message.find().sort('timestamp'));

  socket.on('set username', (username) => {
    users[socket.id] = username;
    console.log('Username set:', username);
  });

  socket.on('chat message', async (msg) => {
    const message = new Message({ user: users[socket.id] || 'Anonymous', text: msg.text });
    await message.save();
    io.emit('chat message', message);
  });

  socket.on('file message', async (fileData) => {
    const message = new Message({ user: users[socket.id] || 'Anonymous', fileUrl: fileData.fileUrl, fileName: fileData.fileName });
    await message.save();
    io.emit('file message', message);
  });

  socket.on('chat reaction', async (reactionData) => {
    const message = new Message({ user: users[socket.id] || 'Anonymous', reaction: reactionData.reaction });
    await message.save();
    io.emit('chat reaction', message);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    delete users[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server is running on port ${PORT}`));
