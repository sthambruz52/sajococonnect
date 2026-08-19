const DB_URL = process.env.FIREBASE_DB_URL;

const EMPTY_DB = { users: {}, posts: [], connections: { edges: [], requests: [] }, messages: [] };

function endpoint() {
  if (!DB_URL) throw new Error('FIREBASE_DB_URL is not set');
  return `${DB_URL.replace(/\/$/, '')}/sajoco-db.json`;
}

async function readDb() {
  const res = await fetch(endpoint());
  const raw = await res.text();
  if (!res.ok) throw new Error(`Firebase read failed (${res.status}): ${raw.slice(0, 300)}`);
  let data = JSON.parse(raw || 'null');
  if (!data) return JSON.parse(JSON.stringify(EMPTY_DB));
  
  if (!data.users) data.users = {};
  if (!data.posts) data.posts = [];
  if (!data.messages) data.messages = [];
  if (!data.connections) data.connections = { edges: [], requests: [] };

  data.posts = data.posts.map(p => ({
    likes: [],
    ...p,
    comments: (p.comments || []).map((c, i) => ({
      id: c.id || `legacy-${Date.now()}-${i}`,
      text: c.text || '',
      userId: c.userId,
      username: c.username || 'Anonymous',
      replyTo: c.replyTo || null, // id of comment this is replying to
      quotedUser: c.quotedUser || null, // e.g. "Kenny Green"
      likes: c.likes || [], // <-- NEW: like on replies
      createdAt: c.createdAt || Date.now(),
      ...c
    }))
  }));
  return data;
}

async function writeDb(data) {
  const res = await fetch(endpoint(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Firebase write failed (${res.status}): ${raw.slice(0,300)}`);
}

module.exports = { readDb, writeDb };
