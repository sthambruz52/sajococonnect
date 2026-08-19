const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'sajoco-92-secret-2024';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) console.warn('MONGODB_URI not set - using memory fallback');
else mongoose.connect(MONGODB_URI).then(()=>console.log('MongoDB connected')).catch(e=>console.log('Mongo error', e.message));

const ReplySchema = new mongoose.Schema({
  author: String,
  text: String,
  likes: [String],
  createdAt: { type: Date, default: Date.now }
});
const CommentSchema = new mongoose.Schema({
  author: String,
  text: String,
  likes: [String],
  replies: [ReplySchema],
  createdAt: { type: Date, default: Date.now }
});
const PostSchema = new mongoose.Schema({
  author: String,
  text: String,
  imageUrl: String,
  videoLink: String,
  likes: [String],
  comments: [CommentSchema],
  createdAt: { type: Date, default: Date.now }
});
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String,
  avatar: String,
  joinedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Post = mongoose.model('Post', PostSchema);

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

app.post('/api/register', async (req,res)=>{
  const { username, password } = req.body;
  if(!username||!password) return res.status(400).json({error:'Required'});
  const exists = await User.findOne({username});
  if(exists) return res.status(400).json({error:'Username taken'});
  const hashed = await bcrypt.hash(password,10);
  const user = await User.create({ username, password: hashed });
  const token = jwt.sign({username}, JWT_SECRET);
  res.json({ token, username: user.username });
});
app.post('/api/login', async (req,res)=>{
  const { username, password } = req.body;
  const user = await User.findOne({username});
  if(!user) return res.status(400).json({error:'User not found'});
  const ok = await bcrypt.compare(password, user.password);
  if(!ok) return res.status(400).json({error:'Wrong password'});
  const token = jwt.sign({username}, JWT_SECRET);
  res.json({ token, username });
});
app.get('/api/users', async (req,res)=>{
  const users = await User.find().select('username avatar joinedAt').sort({joinedAt:-1}).limit(20);
  res.json(users);
});
app.get('/api/posts', async (req,res)=>{
  const posts = await Post.find().sort({createdAt:-1});
  res.json(posts);
});
app.post('/api/posts', auth, upload.single('image'), async (req,res)=>{
  const { text, videoLink } = req.body;
  let imageUrl=null;
  if(req.file) imageUrl='/uploads/'+req.file.filename;
  const post = await Post.create({ author: req.user.username, text, imageUrl, videoLink, likes:[], comments:[] });
  res.json(post);
});
app.put('/api/posts/:id', auth, async (req,res)=>{
  const post=await Post.findById(req.params.id);
  if(!post) return res.status(404).json({error:'Not found'});
  if(post.author!==req.user.username) return res.status(403).json({error:'Not owner'});
  post.text=req.body.text; await post.save(); res.json(post);
});
app.delete('/api/posts/:id', auth, async (req,res)=>{
  const post=await Post.findById(req.params.id);
  if(!post) return res.status(404).json({error:'Not found'});
  if(post.author!==req.user.username) return res.status(403).json({error:'Not owner'});
  await post.deleteOne(); res.json({ok:true});
});
app.post('/api/posts/:id/like', auth, async (req,res)=>{
  const post=await Post.findById(req.params.id);
  if(!post) return res.status(404).json({error:'Not found'});
  const i=post.likes.indexOf(req.user.username);
  if(i===-1) post.likes.push(req.user.username); else post.likes.splice(i,1);
  await post.save(); res.json(post);
});
app.post('/api/posts/:id/comments', auth, async (req,res)=>{
  const post=await Post.findById(req.params.id);
  if(!post) return res.status(404).json({error:'Not found'});
  post.comments.push({ author:req.user.username, text:req.body.text, likes:[], replies:[] });
  await post.save(); res.json(post);
});
app.put('/api/posts/:postId/comments/:commentId', auth, async (req,res)=>{
  const post=await Post.findById(req.params.postId);
  const c=post?.comments.id(req.params.commentId);
  if(!c) return res.status(404).json({error:'Not found'});
  if(c.author!==req.user.username) return res.status(403).json({error:'Not owner'});
  c.text=req.body.text; await post.save(); res.json(post);
});
app.delete('/api/posts/:postId/comments/:commentId', auth, async (req,res)=>{
  const post=await Post.findById(req.params.postId);
  const c=post?.comments.id(req.params.commentId);
  if(!c) return res.status(404).json({error:'Not found'});
  if(c.author!==req.user.username && post.author!==req.user.username) return res.status(403).json({error:'Not allowed'});
  c.deleteOne(); await post.save(); res.json(post);
});
app.post('/api/posts/:postId/comments/:commentId/like', auth, async (req,res)=>{
  const post=await Post.findById(req.params.postId);
  const c=post?.comments.id(req.params.commentId);
  if(!c) return res.status(404).json({error:'Not found'});
  const i=c.likes.indexOf(req.user.username);
  if(i===-1) c.likes.push(req.user.username); else c.likes.splice(i,1);
  await post.save(); res.json(post);
});
app.post('/api/posts/:postId/comments/:commentId/replies', auth, async (req,res)=>{
  const post=await Post.findById(req.params.postId);
  const c=post?.comments.id(req.params.commentId);
  if(!c) return res.status(404).json({error:'Not found'});
  c.replies.push({ author:req.user.username, text:req.body.text, likes:[] });
  await post.save(); res.json(post);
});
app.post('/api/posts/:postId/comments/:commentId/replies/:replyId/like', auth, async (req,res)=>{
  const post=await Post.findById(req.params.postId);
  const r=post?.comments.id(req.params.commentId)?.replies.id(req.params.replyId);
  if(!r) return res.status(404).json({error:'Reply not found'});
  const i=r.likes.indexOf(req.user.username);
  if(i===-1) r.likes.push(req.user.username); else r.likes.splice(i,1);
  await post.save(); res.json(post);
});
app.put('/api/posts/:postId/comments/:commentId/replies/:replyId', auth, async (req,res)=>{
  const post=await Post.findById(req.params.postId);
  const r=post?.comments.id(req.params.commentId)?.replies.id(req.params.replyId);
  if(!r) return res.status(404).json({error:'Not found'});
  if(r.author!==req.user.username) return res.status(403).json({error:'Not owner'});
  r.text=req.body.text; await post.save(); res.json(post);
});
app.delete('/api/posts/:postId/comments/:commentId/replies/:replyId', auth, async (req,res)=>{
  const post=await Post.findById(req.params.postId);
  const c=post?.comments.id(req.params.commentId);
  const r=c?.replies.id(req.params.replyId);
  if(!r) return res.status(404).json({error:'Not found'});
  if(r.author!==req.user.username && c.author!==req.user.username && post.author!==req.user.username) return res.status(403).json({error:'Not allowed'});
  r.deleteOne(); await post.save(); res.json(post);
});

app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, ()=>console.log('SAJOCO 92 Beautiful Theme running on '+PORT));
