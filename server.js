
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const { readDb, writeDb } = require('./db.js');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'sajoco-92-secret';

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const uploadDir = path.join(__dirname, 'public', 'uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (req,file,cb)=>cb(null, uploadDir),
  filename: (req,file,cb)=>cb(null, Date.now()+'-'+file.originalname.replace(/\s/g,'_'))
});
const upload = multer({ storage });

function auth(req,res,next){
  const h=req.headers.authorization;
  if(!h) return res.status(401).json({error:'No token'});
  const token=h.split(' ')[1];
  try{ req.user=jwt.verify(token, JWT_SECRET); next(); }catch(e){ return res.status(401).json({error:'Invalid token'}); }
}

app.post('/api/register', (req,res)=>{
  const { username, password } = req.body;
  const db = readDb();
  if(db.users.find(u=>u.username===username)) return res.status(400).json({error:'Taken'});
  const hashed = bcrypt.hashSync(password, 8);
  db.users.push({ username, password: hashed });
  writeDb(db);
  const token = jwt.sign({username}, JWT_SECRET);
  res.json({ token, username });
});
app.post('/api/login', (req,res)=>{
  const { username, password } = req.body;
  const db = readDb();
  const u = db.users.find(x=>x.username===username);
  if(!u) return res.status(400).json({error:'Not found'});
  if(!bcrypt.compareSync(password, u.password)) return res.status(400).json({error:'Wrong pass'});
  const token = jwt.sign({username}, JWT_SECRET);
  res.json({ token, username });
});
app.get('/api/users', (req,res)=>{
  const db = readDb();
  res.json(db.users.map(u=>({username:u.username})));
});
app.get('/api/posts', (req,res)=>{
  const db = readDb();
  res.json(db.posts.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)));
});
app.post('/api/posts', auth, upload.single('image'), (req,res)=>{
  const db = readDb();
  const { text, videoLink } = req.body;
  let imageUrl=null;
  if(req.file) imageUrl='/uploads/'+req.file.filename;
  const post = { _id: Date.now().toString(), author: req.user.username, text: text||'', imageUrl, videoLink: videoLink||'', likes:[], comments:[], createdAt: new Date().toISOString() };
  db.posts.push(post); writeDb(db); res.json(post);
});
app.put('/api/posts/:id', auth, (req,res)=>{
  const db = readDb();
  const p = db.posts.find(x=>x._id===req.params.id);
  if(!p) return res.status(404).json({error:'Not found'});
  if(p.author!==req.user.username) return res.status(403).json({error:'No'});
  p.text = req.body.text; writeDb(db); res.json(p);
});
app.delete('/api/posts/:id', auth, (req,res)=>{
  let db = readDb();
  const p = db.posts.find(x=>x._id===req.params.id);
  if(!p) return res.status(404).json({error:'Not found'});
  if(p.author!==req.user.username) return res.status(403).json({error:'No'});
  db.posts = db.posts.filter(x=>x._id!==req.params.id); writeDb(db); res.json({ok:true});
});
app.post('/api/posts/:id/like', auth, (req,res)=>{
  const db = readDb();
  const p = db.posts.find(x=>x._id===req.params.id);
  if(!p) return res.status(404).json({error:'Not found'});
  if(!p.likes) p.likes=[];
  const i = p.likes.indexOf(req.user.username);
  if(i===-1) p.likes.push(req.user.username); else p.likes.splice(i,1);
  writeDb(db); res.json(p);
});
app.post('/api/posts/:id/comments', auth, (req,res)=>{
  const db = readDb();
  const p = db.posts.find(x=>x._id===req.params.id);
  if(!p) return res.status(404).json({error:'Not found'});
  const c = { _id: Date.now().toString(), author: req.user.username, text: req.body.text, likes:[], replies:[], createdAt: new Date().toISOString() };
  p.comments.push(c); writeDb(db); res.json(p);
});
app.put('/api/posts/:postId/comments/:commentId', auth, (req,res)=>{
  const db = readDb();
  const p = db.posts.find(x=>x._id===req.params.postId);
  const c = p?.comments.find(x=>x._id===req.params.commentId);
  if(!c) return res.status(404).json({error:'Not found'});
  if(c.author!==req.user.username) return res.status(403).json({error:'No'});
  c.text = req.body.text; writeDb(db); res.json(p);
});
app.delete('/api/posts/:postId/comments/:commentId', auth, (req,res)=>{
  const db = readDb();
  const p = db.posts.find(x=>x._id===req.params.postId);
  if(!p) return res.status(404).json({error:'Not found'});
  const c = p.comments.find(x=>x._id===req.params.commentId);
  if(!c) return res.status(404).json({error:'Not found'});
  if(c.author!==req.user.username && p.author!==req.user.username) return res.status(403).json({error:'No'});
  p.comments = p.comments.filter(x=>x._id!==req.params.commentId); writeDb(db); res.json(p);
});
app.post('/api/posts/:postId/comments/:commentId/like', auth, (req,res)=>{
  const db = readDb();
  const p = db.posts.find(x=>x._id===req.params.postId);
  const c = p?.comments.find(x=>x._id===req.params.commentId);
  if(!c) return res.status(404).json({error:'Not found'});
  if(!c.likes) c.likes=[];
  const i = c.likes.indexOf(req.user.username);
  if(i===-1) c.likes.push(req.user.username); else c.likes.splice(i,1);
  writeDb(db); res.json(p);
});
app.post('/api/posts/:postId/comments/:commentId/replies', auth, (req,res)=>{
  const db = readDb();
  const p = db.posts.find(x=>x._id===req.params.postId);
  const c = p?.comments.find(x=>x._id===req.params.commentId);
  if(!c) return res.status(404).json({error:'Not found'});
  const r = { _id: Date.now().toString(), author: req.user.username, text: req.body.text, likes:[], createdAt: new Date().toISOString() };
  if(!c.replies) c.replies=[];
  c.replies.push(r); writeDb(db); res.json(p);
});
app.post('/api/posts/:postId/comments/:commentId/replies/:replyId/like', auth, (req,res)=>{
  const db = readDb();
  const p = db.posts.find(x=>x._id===req.params.postId);
  const c = p?.comments.find(x=>x._id===req.params.commentId);
  const r = c?.replies.find(x=>x._id===req.params.replyId);
  if(!r) return res.status(404).json({error:'Not found'});
  if(!r.likes) r.likes=[];
  const i = r.likes.indexOf(req.user.username);
  if(i===-1) r.likes.push(req.user.username); else r.likes.splice(i,1);
  writeDb(db); res.json(p);
});
app.put('/api/posts/:postId/comments/:commentId/replies/:replyId', auth, (req,res)=>{
  const db = readDb();
  const r = db.posts.find(x=>x._id===req.params.postId)?.comments.find(x=>x._id===req.params.commentId)?.replies.find(x=>x._id===req.params.replyId);
  if(!r) return res.status(404).json({error:'Not found'});
  if(r.author!==req.user.username) return res.status(403).json({error:'No'});
  r.text = req.body.text; writeDb(db); res.json(db.posts.find(x=>x._id===req.params.postId));
});
app.delete('/api/posts/:postId/comments/:commentId/replies/:replyId', auth, (req,res)=>{
  const db = readDb();
  const p = db.posts.find(x=>x._id===req.params.postId);
  const c = p?.comments.find(x=>x._id===req.params.commentId);
  if(!c) return res.status(404).json({error:'Not found'});
  const r = c.replies.find(x=>x._id===req.params.replyId);
  if(!r) return res.status(404).json({error:'Not found'});
  if(r.author!==req.user.username && c.author!==req.user.username && p.author!==req.user.username) return res.status(403).json({error:'No'});
  c.replies = c.replies.filter(x=>x._id!==req.params.replyId); writeDb(db); res.json(p);
});

app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT, ()=>console.log('SAJOCO 92 fixed running '+PORT));
