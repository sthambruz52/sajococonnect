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
  const image = req.files && req.files.image? await uploadToCloudinary(req.files.image[0].buffer, req.files.image[0].mimetype) : null;
  const video = req.files && req.files.video? await uploadToCloudinary(req.files.video[0].buffer, req.files.video[0].mimetype) : null;
  if (!content &&!image &&!video &&!videoUrl) return res.status(400).json({ error: 'Add some text, a photo, or a video first.' });
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
  res.json({...post, authorInfo: publicUser(req.user) });
}));

app.put('/api/posts/:id', requireAuth, asyncRoute(async (req, res) => {
  const db = req.db;
  const post = db.posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  if (post.author!== req.user.username) return res.status(403).json({ error: 'You can only edit your own posts.' });
  if (typeof req.body.content === 'string') post.content = req.body.content.trim();
  await writeDb(db);
  res.json({...post, authorInfo: publicUser(req.user) });
}));

app.delete('/api/posts/:id', requireAuth, asyncRoute(async (req, res) => {
  const db = req.db;
  const idx = db.posts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Post not found.' });
  if (db.posts[idx].author!== req.user.username) return res.status(403).json({ error: 'You can only delete your own posts.' });
  db.posts.splice(idx, 1);
  await writeDb(db);
  res.json({ ok: true });
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

// --- COMMENTS WITH LIKE + QUOTE + EDIT/DELETE ---
app.post('/api/posts/:id/comments', requireAuth, asyncRoute(async (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Comment cannot be empty.' });
  const db = req.db;
  const post = db.posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });

  let replyTo = req.body.replyTo || null;
  let quotedUser = null;
  if (replyTo) {
    const parent = post.comments.find(c => c.id === replyTo);
    if (!parent) return res.status(400).json({ error: 'The comment you are replying to no longer exists.' });
    quotedUser = db.users[parent.author]?.name || parent.author;
  }

  const comment = {
    id: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
    author: req.user.username,
    text,
    timestamp: Date.now(),
    replyTo,
    quotedUser,
    likes: []
  };
  post.comments.push(comment);
  await writeDb(db);
  res.json({ comment, authorInfo: publicUser(req.user) });
}));

// LIKE a reply/comment
app.post('/api/posts/:id/comments/:commentId/like', requireAuth, asyncRoute(async (req, res) => {
  const db = req.db;
  const post = db.posts.find(p => p.id === req.params.id);
  const comment = post?.comments.find(c => c.id === req.params.commentId);
  if (!comment) return res.status(404).json({ error: 'Comment not found.' });
  if (!comment.likes) comment.likes = [];
  const idx = comment.likes.indexOf(req.user.username);
  if (idx >= 0) comment.likes.splice(idx,1); else comment.likes.push(req.user.username);
  await writeDb(db);
  res.json(comment);
}));

// EDIT comment
app.put('/api/posts/:id/comments/:commentId', requireAuth, asyncRoute(async (req, res) => {
  const db = req.db;
  const post = db.posts.find(p => p.id === req.params.id);
  const comment = post?.comments.find(c => c.id === req.params.commentId);
  if (!comment) return res.status(404).json({ error: 'Comment not found.' });
  if (comment.author!== req.user.username) return res.status(403).json({ error: 'You can only edit your own.' });
  comment.text = (req.body.text || '').trim();
  await writeDb(db);
  res.json(comment);
}));

// DELETE comment
app.delete('/api/posts/:id/comments/:commentId', requireAuth, asyncRoute(async (req, res) => {
  const db = req.db;
  const post = db.posts.find(p => p.id === req.params.id);
  const idx = post?.comments.findIndex(c => c.id === req.params.commentId)?? -1;
  if (idx === -1) return res.status(404).json({ error: 'Comment not found.' });
  if (post.comments[idx].author!== req.user.username) return res.status(403).json({ error: 'You can only delete your own.' });
  post.comments.splice(idx,1);
  await writeDb(db);
  res.json({ ok: true });
}));

//... keep your connections and messages routes same...

// --- FIX FOR NOT FOUND ---
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || 'Something went wrong.' });
  next();
});

// SPA fallback - MUST be last
const publicDir = path.join(__dirname, 'public');
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API not found' });
  res.sendFile(path.join(publicDir, 'index.html'), (err) => {
    if (err) res.status(404).send(`Not Found - public/index.html missing in ${publicDir}. Check if file exists on GitHub.`);
  });
});

app.listen(PORT, () => console.log(`SAJOCO '92 SET running on port ${PORT}`));
