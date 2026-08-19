const DB_URL = process.env.FIREBASE_DB_URL; // e.g. https://your-project-default-rtdb.region.firebasedatabase.app

const EMPTY_DB = { users: {}, posts: [], connections: { edges: [], requests: [] }, messages: [] };

function endpoint() {
  if (!DB_URL) {
    throw new Error('FIREBASE_DB_URL is not set - add it as an environment variable.');
  }
  return `${DB_URL.replace(/\/$/, '')}/sajoco-db.json`;
}

async function readDb() {
  const res = await fetch(endpoint());
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Firebase read failed (status ${res.status}): ${raw.slice(0, 300)}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Firebase returned non-JSON (status ${res.status}): ${raw.slice(0, 300)}`);
  }
  if (data && data.error) throw new Error('Firebase error: ' + data.error);
  if (!data) return JSON.parse(JSON.stringify(EMPTY_DB));
  if (!data.users) data.users = {};
  if (!data.posts) data.posts = [];
  if (!data.messages) data.messages = [];
  if (!data.connections) data.connections = { edges: [], requests: [] };
  if (!data.connections.edges) data.connections.edges = [];
  if (!data.connections.requests) data.connections.requests = [];
  // Firebase silently drops empty arrays/objects when saving - restore them here
  data.posts = data.posts.map(p => ({
    ...p,
    likes: p.likes || [],
    comments: (p.comments || []).map((c, i) => ({ id: `legacy-${i}`, replyTo: null, ...c }))
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
  if (!res.ok) {
    throw new Error(`Firebase write failed (status ${res.status}): ${raw.slice(0, 300)}`);
  }
  let result;
  try { result = JSON.parse(raw); } catch (e) { result = null; }
  if (result && result.error) throw new Error('Firebase error: ' + result.error);
}

module.exports = { readDb, writeDb };
