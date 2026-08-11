const BIN_ID = process.env.JSONBIN_BIN_ID;
const MASTER_KEY = process.env.JSONBIN_MASTER_KEY;
const BASE = 'https://api.jsonbin.io/v3/b';

const EMPTY_DB = { users: {}, posts: [], connections: { edges: [], requests: [] }, messages: [] };

function checkConfig() {
  if (!BIN_ID || !MASTER_KEY) {
    throw new Error('JSONBIN_BIN_ID / JSONBIN_MASTER_KEY are not set - add them as environment variables.');
  }
}

async function readDb() {
  checkConfig();
  const res = await fetch(`${BASE}/${BIN_ID}/latest`, {
    headers: { 'X-Master-Key': MASTER_KEY }
  });
  const data = await res.json();
  if (!res.ok) throw new Error('JSONBin error: ' + (data.message || res.status));
  const record = data.record || {};
  if (!record.users) record.users = {};
  if (!record.posts) record.posts = [];
  if (!record.messages) record.messages = [];
  if (!record.connections) record.connections = { edges: [], requests: [] };
  return record;
}

async function writeDb(data) {
  checkConfig();
  const res = await fetch(`${BASE}/${BIN_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': MASTER_KEY },
    body: JSON.stringify(data)
  });
  const result = await res.json();
  if (!res.ok) throw new Error('JSONBin error: ' + (result.message || res.status));
}

module.exports = { readDb, writeDb };
