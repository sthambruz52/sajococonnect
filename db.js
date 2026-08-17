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
  const data = await res.json();
  if (data && data.error) throw new Error('Firebase error: ' + data.error);
  if (!data) return JSON.parse(JSON.stringify(EMPTY_DB));
  if (!data.users) data.users = {};
  if (!data.posts) data.posts = [];
  if (!data.messages) data.messages = [];
  if (!data.connections) data.connections = { edges: [], requests: [] };
  return data;
}

async function writeDb(data) {
  const res = await fetch(endpoint(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const result = await res.json();
  if (result && result.error) throw new Error('Firebase error: ' + result.error);
}

module.exports = { readDb, writeDb };
