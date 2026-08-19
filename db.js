
const fs = require('fs');
const path = require('path');
const dbPath = path.join(__dirname, 'data.json');

function readDb(){
  try{
    if(!fs.existsSync(dbPath)) return { posts: [], users: [] };
    const raw = fs.readFileSync(dbPath,'utf-8');
    const j = JSON.parse(raw);
    if(!j.posts) j.posts=[];
    if(!j.users) j.users=[];
    return j;
  }catch(e){ return { posts: [], users: [] }; }
}
function writeDb(data){
  try{ fs.writeFileSync(dbPath, JSON.stringify(data, null, 2)); }catch(e){ console.log('write err', e.message); }
}
module.exports = { readDb, writeDb };
