require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { readDb, writeDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-before-deploying';
if (!process.env.JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not set in .env - using an insecure default. Set it before deploying.');
}

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- uploads (kept in memory, then pushed to Cloudinary - never touches local disk) ----------
const storage = multer.memoryStorage();
function fileFilter(req, file, cb) {
  const okImage = file.fieldname === 'avatar' || file.fieldname === 'image';
  const okVideo = file.fieldname === 'video';
  if (okImage && !file.mimetype.startsWith('image/')) return cb(new Error('That file is not an image.'));
  if (okVideo && !file.mimetype.startsWith('video/')) return cb(new Error('That file is not a video.'));
  cb(null, true);
}
const upload = multer({ storage, fileFilter, limits: { fileSize: 30 * 1024 * 1024 } }); // 30MB cap

async function uploadToCloudinary(buffer, mimetype) {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
    throw new Error('CLOUDINARY_CLOUD_NAME / CLOUDINARY_UPLOAD_PRESET are not set - add them as environment variables.');
  }
  const base64 = `data:${mimetype};base64,${buffer.toString('base64')}`;
  const form = new FormData();
  form.append('file', base64);
  form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`, {
    method: 'POST',
    body: form
  });
  const data = await res.json();
  if (data.error) throw new Error('Upload failed: ' + data.error.message);
  return data.secure_url;
}

// ---------- helpers ----------
function publicUser(u) {
  if (!u) return null;
  return { username: u.username, name: u.name, bio: u.bio || '', avatar: u.avatar || null, createdAt: u.createdAt };
}
function signToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: '60d' });
}
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const db = await readDb();
    const user = db.users[payload.username];
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    req.user = user;
    req.db = db;
    next();
  } catch (e) {
    return res.status(401).json({ error: e.message.includes('Upstash') || e.message.includes('UPSTASH') ? e.message : 'Your session expired - please log in again.' });
  }
}
function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch(err => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Something went wrong.' });
  });
}

// ---------- auth ----------
app.post('/api/register', upload.single('avatar'), asyncRoute(async (req, res) => {
  const { name, password, bio } = req.body;
  let username = (req.body.username || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!name || !username || !password) return res.status(400).json({ error: 'Name, username, and password are required.' });
  if (password.length < 4) return res.status(400).json({ error: 'Password should be at least 4 characters.' });

  const db = await readDb();
  if (db.users[username]) return res.status(409).json({ error: 'That username is already taken.' });

  const passwordHash = bcrypt.hashSync(password, 10);
  const avatar = req.file ? await uploadToCloudinary(req.file.buffer, req.file.mimetype) : null;
  const user = { username, name: name.trim(), passwordHash, bio: (bio || '').trim(), avatar, createdAt: Date.now() };
  db.users[username] = user;
  await writeDb(db);
  res.json({ token: signToken(username), user: publicUser(user) });
}));

app.post('/api/login', asyncRoute(async (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase();
  const password = req.body.password || '';
  const db = await readDb();
  const user = db.users[username];
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "That username or password doesn't match." });
  }
  res.json({ token: signToken(username), user: publicUser(user) });
}));

app.get('/api/me', requireAuth, (req, res) => res.json(publicUser(req.user)));

app.put('/api/me', requireAuth, upload.single('avatar'), asyncRoute(async (req, res) => {
  const db = req.db;
  const user = db.users[req.user.username];
  if (req.body.name) user.name = req.body.name.trim();
  if (typeof req.body.bio === 'string') user.bio = req.body.bio.trim();
  if (req.file) user.avatar = await uploadToCloudinary(req.file.buffer, req.file.mimetype);
  await writeDb(db);
  res.json(publicUser(user));
}));

// ---------- users / roster ----------
app.get('/api/users', requireAuth, (req, res) => {
  res.json(Object.values(req.db.users).map(publicUser));
});

// ---------- posts ----------
app.get('/api/posts', requireAuth, (req, res) => {
  const db = req.db;
  const posts = [...db.posts].sort((a, b) => b.timestamp - a.timestamp).map(p => ({
    ...p,
    authorInfo: publicUser(db.users[p.author])
  }));
  res.json(posts);
});

app.post('/api/posts', requireAuth, upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }]), asyncRoute(async (req, res) => {
  const db = req.db;
  const content = (req.body.content || '').trim();
  const videoUrl = (req.body.videoUrl || '').trim();
  const image = req.files && req.files.image ? await uploadToCloudinary(req.files.image[0].buffer, req.files.image[0].mimetype) : null;
  const video = req.files && req.files.video ? await uploadToCloudinary(req.files.video[0].buffer, req.files.video[0].mimetype) : null;
  if (!content && !image && !video && !videoUrl) return res.status(400).json({ error: 'Add some text, a photo, or a video first.' });

  const post = {
    id: Date.now().toString(36) + crypto.randomBytes(4).toString('hex'),
    author: req.user.username,
    content, image, video, videoUrl: videoUrl || null,
    timestamp: Date.now(),
    likes: [],
    comments: []
  };
  db.posts.push(post);
  await writeDb(db);
  res.json({ ...post, authorInfo: publicUser(req.user) });
}));

app.post('/api/posts/:id/like', requireAuth, asyncRoute(async (req, res) => {
  const db = req.db;
  const post = db.posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  const i = post.likes.indexOf(req.user.username);
  if (i >= 0) post.likes.splice(i, 1); else post.likes.push(req.user.username);
  await writeDb(db);
  res.json({ likes: post.likes });
}));

app.post('/api/posts/:id/comments', requireAuth, asyncRoute(async (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Comment cannot be empty.' });
  const db = req.db;
  const post = db.posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  const comment = { author: req.user.username, text, timestamp: Date.now() };
  post.comments.push(comment);
  await writeDb(db);
  res.json({ comment, authorInfo: publicUser(req.user) });
}));

// ---------- connections ----------
app.get('/api/connections', requireAuth, (req, res) => res.json(req.db.connections));

app.post('/api/connections/:username/request', requireAuth, asyncRoute(async (req, res) => {
  const db = req.db;
  const other = req.params.username;
  if (other === req.user.username) return res.status(400).json({ error: "You can't connect with yourself." });
  if (!db.users[other]) return res.status(404).json({ error: 'That classmate does not exist.' });
  const exists = db.connections.requests.some(r => r.from === req.user.username && r.to === other) ||
    db.connections.edges.some(e => e.includes(req.user.username) && e.includes(other));
  if (!exists) db.connections.requests.push({ from: req.user.username, to: other, ts: Date.now() });
  await writeDb(db);
  res.json(db.connections);
}));

app.post('/api/connections/:username/accept', requireAuth, asyncRoute(async (req, res) => {
  const db = req.db;
  const other = req.params.username;
  db.connections.requests = db.connections.requests.filter(r =>
    !((r.from === other && r.to === req.user.username) || (r.from === req.user.username && r.to === other)));
  const already = db.connections.edges.some(e => e.includes(req.user.username) && e.includes(other));
  if (!already) db.connections.edges.push([req.user.username, other]);
  await writeDb(db);
  res.json(db.connections);
}));

// ---------- messages ----------
function isConnected(db, a, b) {
  return db.connections.edges.some(e => e.includes(a) && e.includes(b));
}

app.get('/api/conversations', requireAuth, (req, res) => {
  const db = req.db;
  const me = req.user.username;
  const others = new Map();
  db.messages.forEach(m => {
    if (m.from !== me && m.to !== me) return;
    const other = m.from === me ? m.to : m.from;
    const existing = others.get(other);
    if (!existing || m.timestamp > existing.lastTimestamp) {
      others.set(other, { username: other, lastText: m.text, lastTimestamp: m.timestamp });
    }
  });
  const unreadByUser = {};
  db.messages.forEach(m => {
    if (m.to === me && !m.read) unreadByUser[m.from] = (unreadByUser[m.from] || 0) + 1;
  });
  const list = Array.from(others.values()).map(c => ({
    ...c,
    userInfo: publicUser(db.users[c.username]),
    unread: unreadByUser[c.username] || 0
  })).sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  res.json(list);
});

app.get('/api/messages/:username', requireAuth, asyncRoute(async (req, res) => {
  const db = req.db;
  const me = req.user.username;
  const other = req.params.username;
  const thread = db.messages.filter(m => (m.from === me && m.to === other) || (m.from === other && m.to === me));
  thread.sort((a, b) => a.timestamp - b.timestamp);
  let changed = false;
  thread.forEach(m => { if (m.to === me && !m.read) { m.read = true; changed = true; } });
  if (changed) await writeDb(db);
  res.json(thread);
}));

app.post('/api/messages/:username', requireAuth, asyncRoute(async (req, res) => {
  const db = req.db;
  const me = req.user.username;
  const other = req.params.username;
  if (!db.users[other]) return res.status(404).json({ error: 'That classmate does not exist.' });
  if (!isConnected(db, me, other)) return res.status(403).json({ error: 'Connect with this classmate first before messaging them.' });
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message cannot be empty.' });
  const message = { id: Date.now().toString(36) + crypto.randomBytes(4).toString('hex'), from: me, to: other, text, timestamp: Date.now(), read: false };
  db.messages.push(message);
  await writeDb(db);
  res.json(message);
}));

// multer / general error handler
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || 'Something went wrong.' });
  next();
});

// SPA fallback - anything not /api goes to index.html
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`SAJOCO '92 SET running on port ${PORT}`));
