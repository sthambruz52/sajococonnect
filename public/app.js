const API = '';
let TOKEN = localStorage.getItem('rc_token') || null;
let ME = null;
let USERS = {};
let POSTS = [];
let CONNECTIONS = { edges: [], requests: [] };
let CONVERSATIONS = [];
let INBOX_THREAD = null; // username of open thread, or null for list view
let THREAD_MESSAGES = [];
let VIEW = 'feed';
let PROFILE_TARGET = null;
let EDITING_POST_ID = null;
let EDIT_REMOVE_IMAGE = false;
let EDIT_REMOVE_VIDEO = false;
let replyContext = null; // { postId, commentId, authorName }
let authTab = 'login';
let authError = '';
let pendingAvatarFile = null;
let pendingPostImageFile = null;
let pendingPostVideoFile = null;
let toastTimer = null;

const ICONS = {
  home: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7"/><path d="M9 22V12h6v10"/><path d="M5 10v11a1 1 0 001 1h3m6 0h3a1 1 0 001-1V10"/></svg>`,
  gallery: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`,
  friends: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`,
  classmates: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/></svg>`,
  inbox: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>`,
  edit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`
};

function sectionBanner(title){
  return `<div class="section-banner"><div class="crest-sm"></div><span class="section-banner-title">${title}</span></div>`;
}

function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function initials(name){ return (name||'?').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase(); }
function timeAgo(ts){
  const s = Math.floor((Date.now()-ts)/1000);
  if(s<60) return 'just now';
  if(s<3600) return Math.floor(s/60)+'m ago';
  if(s<86400) return Math.floor(s/3600)+'h ago';
  return Math.floor(s/86400)+'d ago';
}
function showToast(msg){
  clearTimeout(toastTimer);
  let t = document.getElementById('toast');
  if(!t){ t = document.createElement('div'); t.id='toast'; t.className='toast'; document.body.appendChild(t); }
  t.textContent = msg;
  toastTimer = setTimeout(()=> t.remove(), 2400);
}

async function api(path, { method='GET', body=null, isForm=false } = {}){
  const headers = {};
  if(TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
  if(!isForm && body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: isForm ? body : (body ? JSON.stringify(body) : undefined) });
  let data = null;
  try{ data = await res.json(); }catch(e){ data = null; }
  if(!res.ok){ throw new Error((data && data.error) || 'Something went wrong.'); }
  return data;
}

function avatarHtml(username, size){
  const u = USERS[username];
  const style = size ? `style="width:${size}px;height:${size}px"` : '';
  if(u && u.avatar) return `<img class="avatar" ${style} src="${u.avatar}">`;
  return `<div class="avatar-fallback" ${style}>${initials(u ? u.name : username)}</div>`;
}

function youtubeEmbed(url){
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/);
  if(m) return `https://www.youtube.com/embed/${m[1]}`;
  const v = url.match(/vimeo\.com\/(\d+)/);
  if(v) return `https://player.vimeo.com/video/${v[1]}`;
  return null;
}

function connectionStatus(other){
  if(other === ME.username) return 'self';
  if(CONNECTIONS.edges.some(e => e.includes(ME.username) && e.includes(other))) return 'connected';
  if(CONNECTIONS.requests.some(r => r.from===ME.username && r.to===other)) return 'pending';
  if(CONNECTIONS.requests.some(r => r.from===other && r.to===ME.username)) return 'incoming';
  return 'none';
}

async function loadAppData(){
  const [users, posts, conns, convos] = await Promise.all([api('/api/users'), api('/api/posts'), api('/api/connections'), api('/api/conversations')]);
  USERS = {}; users.forEach(u => USERS[u.username] = u);
  POSTS = posts;
  CONNECTIONS = conns;
  CONVERSATIONS = convos;
}

// ---------------- render ----------------
function render(){
  const app = document.getElementById('app');
  if(!ME){ app.innerHTML = renderAuth(); attachAuthEvents(); return; }
  app.innerHTML = renderApp();
  attachAppEvents();
}

function renderAuth(){
  return `
  <div class="auth-wrap">
    <div class="hero-wrap">
      <div class="hero-banner"></div>
      <div class="hero-crest"></div>
    </div>
    <h1 class="brand-title" style="font-size:44px;">SAJOCO '92 SET</h1>
    <div class="brand-rule"></div>
    <p class="roll-sub">a small board, just for our class</p>
    <div class="tabs">
      <button class="tab-btn ${authTab==='login'?'active':''}" data-tab="login">Log in</button>
      <button class="tab-btn ${authTab==='register'?'active':''}" data-tab="register">Join</button>
    </div>
    ${authTab==='login' ? `
      <div class="card">
        <div class="field"><label>Username</label><input id="login-username" autocapitalize="off" placeholder="e.g. tayo92"></div>
        <div class="field"><label>Password</label><input id="login-password" type="password" placeholder="••••••••"></div>
        <button class="primary-btn" id="login-btn">Log in</button>
        <div class="error-msg">${escapeHtml(authError)}</div>
      </div>
    ` : `
      <div class="card">
        <div class="avatar-pick">
          ${pendingAvatarFile ? `<img class="avatar" style="width:52px;height:52px" src="${URL.createObjectURL(pendingAvatarFile)}">` : `<div class="avatar-fallback" style="width:52px;height:52px">+</div>`}
          <label class="file-btn">Add photo<input type="file" id="reg-avatar" accept="image/*" style="display:none"></label>
        </div>
        <div class="field"><label>Full name</label><input id="reg-name" placeholder="Your name"></div>
        <div class="field"><label>Username</label><input id="reg-username" autocapitalize="off" placeholder="no spaces"></div>
        <div class="field"><label>Password</label><input id="reg-password" type="password" placeholder="••••••••"></div>
        <div class="field"><label>Bio (optional)</label><input id="reg-bio" placeholder="What have you been up to?"></div>
        <button class="primary-btn" id="register-btn">Create account</button>
        <div class="error-msg">${escapeHtml(authError)}</div>
      </div>
    `}
    <p class="hint">This board is shared with every classmate who joins — anything you post, your name, photos, and messages are visible to the whole group.</p>
  </div>`;
}

function renderApp(){
  return `
  <div class="roll-header">
    <div class="brand-row">
      <div class="crest-sm"></div>
      <h1 class="brand-title" style="font-size:32px;">SAJOCO '92 SET</h1>
    </div>
    <button class="logout-btn" id="logout-btn">Log out</button>
  </div>
  <div class="layout">
    <div class="side-left">
      <div class="card me-card">
        <div class="pin"></div>
        ${avatarHtml(ME.username, 64)}
        <div class="me-name">${escapeHtml(ME.name)}</div>
        <div class="me-bio">${escapeHtml(ME.bio||'')}</div>
        <span class="edit-link" id="edit-profile-link">Edit profile</span>
      </div>
      <div class="card" style="padding:8px;">
        <button class="nav-btn ${VIEW==='feed'?'active':''}" data-view="feed">${ICONS.home}<span>Home</span></button>
        <button class="nav-btn ${VIEW==='gallery'?'active':''}" data-view="gallery">${ICONS.gallery}<span>Gallery</span></button>
        <button class="nav-btn ${VIEW==='friends'?'active':''}" data-view="friends">${ICONS.friends}<span>Friends</span></button>
        <button class="nav-btn ${VIEW==='classmates'?'active':''}" data-view="classmates">${ICONS.classmates}<span>Classmates</span></button>
        <button class="nav-btn ${VIEW==='inbox'?'active':''}" data-view="inbox">${ICONS.inbox}<span>Inbox</span>${unreadTotal()?` <span class="nav-badge">${unreadTotal()}</span>`:''}</button>
        ${VIEW==='profile' ? `<button class="nav-btn active" data-view="profile">${ICONS.edit}<span>Edit profile</span></button>`:''}
      </div>
    </div>
    <div class="side-main">
      ${VIEW==='feed' ? renderFeed() : VIEW==='gallery' ? renderGallery() : VIEW==='classmates' ? renderRoster() : VIEW==='friends' ? renderFriends() : VIEW==='inbox' ? renderInbox() : VIEW==='viewProfile' ? renderViewProfile() : renderEditProfile()}
    </div>
    <div class="side-right">
      ${renderRosterMini()}
    </div>
  </div>`;
}

function unreadTotal(){ return CONVERSATIONS.reduce((sum,c) => sum + (c.unread||0), 0); }

function renderFeed(){
  const posts = POSTS;
  return `
    ${sectionBanner('Home')}
    <div class="card composer">
      <div class="pin"></div>
      <textarea id="post-text" placeholder="What's on your mind, ${escapeHtml(ME.name.split(' ')[0])}?"></textarea>
      <div id="post-preview"></div>
      <div class="composer-row">
        <div class="composer-attach">
          <label class="file-btn">📷 Photo<input type="file" id="post-image" accept="image/*" style="display:none"></label>
          <label class="file-btn">🎬 Video<input type="file" id="post-video" accept="video/*" style="display:none"></label>
          <input class="video-url-field" id="post-video-url" placeholder="or paste a YouTube/Vimeo link">
        </div>
        <button class="post-btn" id="post-submit">Pin it up</button>
      </div>
    </div>
    <div id="posts-list">
      ${posts.length===0 ? `<div class="empty">No posts yet — be the first to pin something to the board.</div>` : posts.map(renderPost).join('')}
    </div>
  `;
}

function renderPost(p){
  const mine = p.author === ME.username;
  const author = p.authorInfo || USERS[p.author];

  if(EDITING_POST_ID === p.id){
    return `
    <div class="card post" data-id="${p.id}">
      <div class="pin"></div>
      <div class="post-head">
        ${avatarHtml(p.author, 38)}
        <div>
          <div class="post-author">${escapeHtml(author ? author.name : p.author)}</div>
          <div class="post-time mono">Editing…</div>
        </div>
      </div>
      <textarea class="edit-post-textarea" id="edit-post-text">${escapeHtml(p.content||'')}</textarea>
      <div class="post-media">
        ${p.image && !EDIT_REMOVE_IMAGE ? `<div class="media-remove-wrap"><img src="${p.image}"><button class="media-remove-btn" data-action="mark-remove-image">Remove photo</button></div>` : ''}
        ${p.video && !EDIT_REMOVE_VIDEO ? `<div class="media-remove-wrap"><video src="${p.video}" controls></video><button class="media-remove-btn" data-action="mark-remove-video">Remove video</button></div>` : ''}
      </div>
      <div class="composer-row">
        <button class="roster-btn" data-action="cancel-edit">Cancel</button>
        <button class="post-btn" data-action="save-edit" data-id="${p.id}">Save changes</button>
      </div>
    </div>`;
  }

  const liked = p.likes.includes(ME.username);
  const embed = p.videoUrl ? youtubeEmbed(p.videoUrl) : null;
  return `
  <div class="card post" data-id="${p.id}">
    <div class="pin"></div>
    <div class="post-head">
      <div class="post-head-link" data-action="view-profile" data-user="${p.author}" style="display:flex;gap:10px;align-items:center;cursor:pointer;">
        ${avatarHtml(p.author, 38)}
        <div>
          <div class="post-author">${escapeHtml(author ? author.name : p.author)}</div>
          <div class="post-time mono">${timeAgo(p.timestamp)}</div>
        </div>
      </div>
      ${mine ? `
        <div class="post-owner-actions">
          <button data-action="edit-post" data-id="${p.id}" title="Edit">${ICONS.edit}</button>
          <button data-action="delete-post" data-id="${p.id}" title="Delete">✕</button>
        </div>` : ''}
    </div>
    ${p.content ? `<div class="post-body">${escapeHtml(p.content)}</div>` : ''}
    <div class="post-media">
      ${p.image ? `<img src="${p.image}">` : ''}
      ${p.video ? `<video src="${p.video}" controls></video>` : ''}
      ${embed ? `<iframe src="${embed}" allowfullscreen frameborder="0"></iframe>` : (p.videoUrl && !embed ? `<div class="post-time">Video link: <a href="${escapeHtml(p.videoUrl)}" target="_blank" rel="noopener">${escapeHtml(p.videoUrl)}</a></div>` : '')}
    </div>
    <div class="post-actions">
      <button class="like-btn ${liked?'liked':''}" data-action="like" data-id="${p.id}">♥ ${p.likes.length ? p.likes.length : ''} ${liked?'Liked':'Like'}</button>
      <button class="comment-btn" data-action="focus-comment" data-id="${p.id}">💬 ${p.comments.length ? p.comments.length+' ' : ''}Comment</button>
    </div>
    <div class="comments">
      ${renderCommentThread(p)}
    </div>
    ${replyContext && replyContext.postId===p.id ? `<div class="reply-indicator">Replying to ${escapeHtml(replyContext.authorName)} <span data-action="cancel-reply">✕ cancel</span></div>` : ''}
    <div class="comment-input-row">
      <input placeholder="Write a comment…" data-comment-input="${p.id}">
      <button class="send-btn" data-action="comment" data-id="${p.id}">Send</button>
    </div>
  </div>`;
}

function renderCommentThread(p){
  const top = p.comments.filter(c => !c.replyTo);
  const repliesOf = id => p.comments.filter(c => c.replyTo === id);
  const findComment = id => p.comments.find(c => c.id === id);
  const renderOne = (c, isReply) => {
    const name = escapeHtml((USERS[c.author]&&USERS[c.author].name)||c.author);
    const liked = (c.likes||[]).includes(ME.username);
    const parent = c.replyTo ? findComment(c.replyTo) : null;
    const quote = parent ? `<div class="comment-quote">↳ replying to <b>${escapeHtml((USERS[parent.author]&&USERS[parent.author].name)||parent.author)}</b>: "${escapeHtml((parent.text||'').slice(0,60))}${(parent.text||'').length>60?'…':''}"</div>` : '';
    return `
    <div class="comment${isReply?' comment-reply':''}">
      ${quote}
      <div><b>${name}</b> ${escapeHtml(c.text)}</div>
      <div class="comment-actions">
        <button class="reply-link ${liked?'liked':''}" data-action="like-comment" data-post="${p.id}" data-comment="${c.id}">♥ ${(c.likes||[]).length||''} ${liked?'Liked':'Like'}</button>
        <button class="reply-link" data-action="reply-comment" data-post="${p.id}" data-comment="${c.id}" data-author="${name}">Reply</button>
      </div>
    </div>
    ${repliesOf(c.id).map(r => renderOne(r, true)).join('')}`;
  };
  return top.map(c => renderOne(c, false)).join('');
}

function renderRoster(){
  const others = Object.keys(USERS).filter(u=>u!==ME.username);
  return `
  ${sectionBanner('Classmates')}
  <div class="card">
    <div class="pin"></div>
    <div class="roster-title">Whole class (${Object.keys(USERS).length})</div>
    ${others.length===0 ? `<div class="empty">No other classmates have joined yet.</div>` : others.map(u => renderRosterItem(u)).join('')}
  </div>`;
}

function renderRosterItem(u){
  const user = USERS[u];
  const status = connectionStatus(u);
  let btn = '';
  if(status==='connected') btn = `<span class="roster-btn connected">✓ Connected</span>`;
  else if(status==='pending') btn = `<span class="roster-btn pending">Requested</span>`;
  else if(status==='incoming') btn = `<button class="roster-btn accept" data-action="accept" data-user="${u}">Accept</button>`;
  else btn = `<button class="roster-btn" data-action="connect" data-user="${u}">Connect</button>`;
  return `
  <div class="roster-item">
    <div class="roster-item-link" data-action="view-profile" data-user="${u}" style="display:flex;gap:10px;align-items:center;flex:1;cursor:pointer;">
      ${avatarHtml(u,32)}
      <div>
        <div class="roster-name">${escapeHtml(user.name)}</div>
        <div class="post-time mono">${escapeHtml(user.bio||'')}</div>
      </div>
    </div>
    ${btn}
  </div>`;
}

function renderRosterMini(){
  const others = Object.keys(USERS).filter(u=>u!==ME.username);
  const incoming = CONNECTIONS.requests.filter(r=>r.to===ME.username);
  return `
    ${incoming.length ? `
    <div class="card roster-card">
      <div class="roster-title">Requests</div>
      ${incoming.map(r => `
        <div class="roster-item">
          ${avatarHtml(r.from,32)}
          <div class="roster-name">${escapeHtml((USERS[r.from]||{}).name||r.from)}</div>
          <button class="roster-btn accept" data-action="accept" data-user="${r.from}">Accept</button>
        </div>`).join('')}
    </div>` : ''}
    <div class="card roster-card">
      <div class="roster-title">Classmates</div>
      ${others.length===0 ? `<div class="empty" style="padding:10px 0;">Nobody else yet</div>` : others.slice(0,8).map(u=>`
        <div class="roster-item">
          ${avatarHtml(u,32)}
          <div class="roster-name">${escapeHtml(USERS[u].name)}</div>
        </div>`).join('')}
    </div>
  `;
}

function renderEditProfile(){
  return `
  ${sectionBanner('Edit Profile')}
  <div class="card">
    <div class="pin"></div>
    <div class="avatar-pick">
      ${pendingAvatarFile ? `<img class="avatar" style="width:56px;height:56px" src="${URL.createObjectURL(pendingAvatarFile)}">` : (ME.avatar ? `<img class="avatar" style="width:56px;height:56px" src="${ME.avatar}">` : `<div class="avatar-fallback" style="width:56px;height:56px">${initials(ME.name)}</div>`)}
      <label class="file-btn">Change photo<input type="file" id="edit-avatar" accept="image/*" style="display:none"></label>
    </div>
    <div class="field"><label>Full name</label><input id="edit-name" value="${escapeHtml(ME.name)}"></div>
    <div class="field"><label>Bio</label><input id="edit-bio" value="${escapeHtml(ME.bio||'')}"></div>
    <button class="primary-btn" id="save-profile-btn">Save changes</button>
  </div>`;
}

function renderGallery(){
  const media = [];
  [...POSTS].sort((a,b)=>b.timestamp-a.timestamp).forEach(p => {
    if(p.image) media.push({ type:'image', src:p.image, author:p.author, timestamp:p.timestamp, postId:p.id });
    if(p.video) media.push({ type:'video', src:p.video, author:p.author, timestamp:p.timestamp, postId:p.id });
  });
  return `
  ${sectionBanner('Gallery')}
  <div class="card">
    <div class="pin"></div>
    <div class="roster-title">Photos &amp; videos (${media.length})</div>
    ${media.length===0 ? `<div class="empty">No photos or videos posted yet.</div>` : `
      <div class="gallery-grid">
        ${media.map(m => `
          <div class="gallery-tile-wrap">
            <a class="gallery-tile" href="${m.src}" target="_blank" rel="noopener" title="${escapeHtml((USERS[m.author]&&USERS[m.author].name)||m.author)} · ${timeAgo(m.timestamp)}">
              ${m.type==='image' ? `<img src="${m.src}">` : `<video src="${m.src}"></video><span class="gallery-play">▶</span>`}
            </a>
            ${m.author===ME.username ? `<button class="gallery-delete" data-action="delete-media" data-post="${m.postId}" data-type="${m.type}" title="Delete">✕</button>` : ''}
          </div>`).join('')}
      </div>
    `}
  </div>`;
}

function renderFriends(){
  const friends = Object.keys(USERS).filter(u => u!==ME.username && connectionStatus(u)==='connected');
  return `
  ${sectionBanner('Friends')}
  <div class="card">
    <div class="pin"></div>
    <div class="roster-title">Your friends (${friends.length})</div>
    ${friends.length===0 ? `<div class="empty">No connections yet — head to Classmates to send requests.</div>` : friends.map(u => `
      <div class="roster-item">
        <div class="roster-item-link" data-action="view-profile" data-user="${u}" style="display:flex;gap:10px;align-items:center;flex:1;cursor:pointer;">
          ${avatarHtml(u,32)}
          <div>
            <div class="roster-name">${escapeHtml(USERS[u].name)}</div>
            <div class="post-time mono">${escapeHtml(USERS[u].bio||'')}</div>
          </div>
        </div>
        <button class="roster-btn" data-action="message" data-user="${u}">Message</button>
      </div>`).join('')}
  </div>`;
}

function renderViewProfile(){
  const u = USERS[PROFILE_TARGET];
  if(!u) return `${sectionBanner('Profile')}<div class="card"><div class="empty">This classmate could not be found.</div></div>`;
  const theirPosts = POSTS.filter(p => p.author === PROFILE_TARGET).sort((a,b)=>b.timestamp-a.timestamp);
  const status = connectionStatus(PROFILE_TARGET);
  let actionBtn = '';
  if(status==='self') actionBtn = '';
  else if(status==='connected') actionBtn = `<button class="roster-btn" data-action="message" data-user="${PROFILE_TARGET}" style="margin-top:10px;">Message</button>`;
  else if(status==='incoming') actionBtn = `<button class="roster-btn accept" data-action="accept" data-user="${PROFILE_TARGET}" style="margin-top:10px;">Accept request</button>`;
  else if(status==='pending') actionBtn = `<span class="roster-btn pending" style="margin-top:10px;">Requested</span>`;
  else actionBtn = `<button class="roster-btn" data-action="connect" data-user="${PROFILE_TARGET}" style="margin-top:10px;">Connect</button>`;
  return `
  ${sectionBanner(u.name)}
  <div class="card me-card">
    <div class="pin"></div>
    ${avatarHtml(PROFILE_TARGET, 64)}
    <div class="me-name">${escapeHtml(u.name)}</div>
    <div class="me-bio">${escapeHtml(u.bio||'')}</div>
    ${actionBtn}
  </div>
  <div class="roster-title" style="margin:16px 0 10px;">Posts (${theirPosts.length})</div>
  <div id="posts-list">
    ${theirPosts.length===0 ? `<div class="empty">No posts yet.</div>` : theirPosts.map(renderPost).join('')}
  </div>`;
}

function renderInbox(){
  if(INBOX_THREAD){
    const other = USERS[INBOX_THREAD];
    return `
    <div class="card inbox-thread">
      <div class="pin"></div>
      <div class="thread-head">
        <button class="back-btn" data-action="inbox-back">← Back</button>
        ${avatarHtml(INBOX_THREAD, 30)}
        <div class="post-author">${escapeHtml(other ? other.name : INBOX_THREAD)}</div>
      </div>
      <div class="thread-messages" id="thread-messages">
        ${THREAD_MESSAGES.length===0 ? `<div class="empty">Say hello 👋</div>` : THREAD_MESSAGES.map(m => `
          <div class="bubble ${m.from===ME.username?'mine':'theirs'}">
            <div>${escapeHtml(m.text)}</div>
            <div class="bubble-time mono">${timeAgo(m.timestamp)}</div>
          </div>`).join('')}
      </div>
      <div class="comment-input-row">
        <input id="thread-input" placeholder="Write a message…">
        <button class="send-btn" id="thread-send">Send</button>
      </div>
    </div>`;
  }
  return `
  ${sectionBanner('Inbox')}
  <div class="card">
    <div class="pin"></div>
    <div class="roster-title">Messages</div>
    ${CONVERSATIONS.length===0 ? `<div class="empty">No conversations yet — message a friend to get started.</div>` : CONVERSATIONS.map(c => `
      <div class="roster-item" data-action="open-thread" data-user="${c.username}" style="cursor:pointer;">
        ${avatarHtml(c.username,32)}
        <div style="flex:1;">
          <div class="roster-name">${escapeHtml((c.userInfo&&c.userInfo.name)||c.username)}</div>
          <div class="post-time mono">${escapeHtml(c.lastText||'')}</div>
        </div>
        ${c.unread ? `<span class="roster-btn accept">${c.unread}</span>` : ''}
      </div>`).join('')}
  </div>`;
}

async function openThread(username){
  INBOX_THREAD = username;
  THREAD_MESSAGES = await api(`/api/messages/${username}`);
  CONVERSATIONS = await api('/api/conversations');
  render();
  const box = document.getElementById('thread-messages');
  if(box) box.scrollTop = box.scrollHeight;
}

// ---------------- events ----------------
function attachAuthEvents(){
  document.querySelectorAll('.tab-btn').forEach(b => b.onclick = () => { authTab = b.dataset.tab; authError=''; pendingAvatarFile=null; render(); });

  const regAvatar = document.getElementById('reg-avatar');
  if(regAvatar) regAvatar.onchange = e => { if(e.target.files[0]){ pendingAvatarFile = e.target.files[0]; render(); } };

  const loginBtn = document.getElementById('login-btn');
  if(loginBtn) loginBtn.onclick = async () => {
    loginBtn.disabled = true;
    try{
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      const data = await api('/api/login', { method:'POST', body:{ username, password } });
      TOKEN = data.token; localStorage.setItem('rc_token', TOKEN); ME = data.user;
      await loadAppData(); VIEW='feed'; authError=''; render();
    }catch(e){ authError = e.message; render(); }
  };

  const regBtn = document.getElementById('register-btn');
  if(regBtn) regBtn.onclick = async () => {
    regBtn.disabled = true;
    try{
      const name = document.getElementById('reg-name').value.trim();
      const username = document.getElementById('reg-username').value.trim();
      const password = document.getElementById('reg-password').value;
      const bio = document.getElementById('reg-bio').value.trim();
      const fd = new FormData();
      fd.append('name', name); fd.append('username', username); fd.append('password', password); fd.append('bio', bio);
      if(pendingAvatarFile) fd.append('avatar', pendingAvatarFile);
      const data = await api('/api/register', { method:'POST', body: fd, isForm:true });
      TOKEN = data.token; localStorage.setItem('rc_token', TOKEN); ME = data.user;
      pendingAvatarFile = null;
      await loadAppData(); VIEW='feed'; authError=''; render();
      showToast('Welcome to the board, ' + name.split(' ')[0] + '!');
    }catch(e){ authError = e.message; render(); }
  };
}

function attachAppEvents(){
  document.getElementById('logout-btn').onclick = () => { TOKEN=null; ME=null; localStorage.removeItem('rc_token'); VIEW='feed'; render(); };
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { VIEW = b.dataset.view; render(); });
  const editLink = document.getElementById('edit-profile-link');
  if(editLink) editLink.onclick = () => { VIEW='profile'; render(); };

  document.querySelectorAll('[data-action="view-profile"]').forEach(el => el.onclick = () => {
    PROFILE_TARGET = el.dataset.user; VIEW = 'viewProfile'; render();
  });

  if(VIEW==='feed' || VIEW==='viewProfile'){
    const imgInput = document.getElementById('post-image');
    if(imgInput) imgInput.onchange = e => {
      if(e.target.files[0]){
        pendingPostImageFile = e.target.files[0];
        document.getElementById('post-preview').innerHTML = `<img class="preview-thumb" src="${URL.createObjectURL(pendingPostImageFile)}">`;
      }
    };
    const vidInput = document.getElementById('post-video');
    if(vidInput) vidInput.onchange = e => {
      if(e.target.files[0]){
        pendingPostVideoFile = e.target.files[0];
        document.getElementById('post-preview').innerHTML = `<video class="preview-thumb" src="${URL.createObjectURL(pendingPostVideoFile)}" controls></video>`;
      }
    };
    const submit = document.getElementById('post-submit');
    if(submit) submit.onclick = async () => {
      const text = document.getElementById('post-text').value.trim();
      const videoUrl = document.getElementById('post-video-url').value.trim();
      if(!text && !pendingPostImageFile && !pendingPostVideoFile && !videoUrl){ showToast('Write something or attach a photo/video first.'); return; }
      submit.disabled = true; submit.textContent = 'Pinning…';
      try{
        const fd = new FormData();
        fd.append('content', text); fd.append('videoUrl', videoUrl);
        if(pendingPostImageFile) fd.append('image', pendingPostImageFile);
        if(pendingPostVideoFile) fd.append('video', pendingPostVideoFile);
        await api('/api/posts', { method:'POST', body: fd, isForm:true });
        pendingPostImageFile = null; pendingPostVideoFile = null;
        await loadAppData(); render();
      }catch(e){ showToast(e.message); submit.disabled=false; submit.textContent='Pin it up'; }
    };

    document.querySelectorAll('[data-action="like"]').forEach(b => b.onclick = async () => {
      try{ await api(`/api/posts/${b.dataset.id}/like`, { method:'POST' }); await loadAppData(); render(); }
      catch(e){ showToast(e.message); }
    });
    document.querySelectorAll('[data-action="focus-comment"]').forEach(b => b.onclick = () => {
      const input = document.querySelector(`[data-comment-input="${b.dataset.id}"]`);
      if(input) input.focus();
    });
    document.querySelectorAll('[data-action="comment"]').forEach(b => b.onclick = async () => {
      const input = document.querySelector(`[data-comment-input="${b.dataset.id}"]`);
      const text = input.value.trim();
      if(!text) return;
      const replyTo = (replyContext && replyContext.postId===b.dataset.id) ? replyContext.commentId : null;
      try{
        await api(`/api/posts/${b.dataset.id}/comments`, { method:'POST', body:{ text, replyTo } });
        replyContext = null;
        await loadAppData(); render();
      }
      catch(e){ showToast(e.message); }
    });
    document.querySelectorAll('[data-comment-input]').forEach(inp => inp.onkeydown = e => {
      if(e.key==='Enter'){ document.querySelector(`[data-action="comment"][data-id="${inp.dataset.commentInput}"]`).click(); }
    });

    document.querySelectorAll('[data-action="like-comment"]').forEach(b => b.onclick = async () => {
      try{ await api(`/api/posts/${b.dataset.post}/comments/${b.dataset.comment}/like`, { method:'POST' }); await loadAppData(); render(); }
      catch(e){ showToast(e.message); }
    });

    document.querySelectorAll('[data-action="reply-comment"]').forEach(b => b.onclick = () => {
      replyContext = { postId: b.dataset.post, commentId: b.dataset.comment, authorName: b.dataset.author };
      render();
      const input = document.querySelector(`[data-comment-input="${b.dataset.post}"]`);
      if(input) input.focus();
    });
    document.querySelectorAll('[data-action="cancel-reply"]').forEach(el => el.onclick = () => { replyContext = null; render(); });

    document.querySelectorAll('[data-action="edit-post"]').forEach(b => b.onclick = () => {
      EDITING_POST_ID = b.dataset.id; EDIT_REMOVE_IMAGE = false; EDIT_REMOVE_VIDEO = false; render();
    });
    document.querySelectorAll('[data-action="cancel-edit"]').forEach(b => b.onclick = () => { EDITING_POST_ID = null; render(); });
    document.querySelectorAll('[data-action="mark-remove-image"]').forEach(b => b.onclick = () => { EDIT_REMOVE_IMAGE = true; render(); });
    document.querySelectorAll('[data-action="mark-remove-video"]').forEach(b => b.onclick = () => { EDIT_REMOVE_VIDEO = true; render(); });
    document.querySelectorAll('[data-action="save-edit"]').forEach(b => b.onclick = async () => {
      const content = document.getElementById('edit-post-text').value.trim();
      try{
        await api(`/api/posts/${b.dataset.id}`, { method:'PUT', body:{ content, removeImage: EDIT_REMOVE_IMAGE, removeVideo: EDIT_REMOVE_VIDEO } });
        EDITING_POST_ID = null;
        await loadAppData(); render();
      }catch(e){ showToast(e.message); }
    });
    document.querySelectorAll('[data-action="delete-post"]').forEach(b => b.onclick = async () => {
      if(!confirm('Delete this post? This cannot be undone.')) return;
      try{ await api(`/api/posts/${b.dataset.id}`, { method:'DELETE' }); await loadAppData(); render(); }
      catch(e){ showToast(e.message); }
    });
  }

  if(VIEW==='gallery'){
    document.querySelectorAll('[data-action="delete-media"]').forEach(b => b.onclick = async () => {
      if(!confirm('Remove this ' + (b.dataset.type==='image'?'photo':'video') + '?')) return;
      const body = b.dataset.type==='image' ? { removeImage:true } : { removeVideo:true };
      try{ await api(`/api/posts/${b.dataset.post}`, { method:'PUT', body }); await loadAppData(); render(); }
      catch(e){ showToast(e.message); }
    });
  }

  if(VIEW==='friends' || VIEW==='viewProfile'){
    document.querySelectorAll('[data-action="message"]').forEach(b => b.onclick = async () => {
      VIEW = 'inbox';
      await openThread(b.dataset.user);
    });
  }

  if(VIEW==='inbox'){
    if(!INBOX_THREAD){
      document.querySelectorAll('[data-action="open-thread"]').forEach(el => el.onclick = () => openThread(el.dataset.user));
    } else {
      const backBtn = document.querySelector('[data-action="inbox-back"]');
      if(backBtn) backBtn.onclick = async () => { INBOX_THREAD = null; CONVERSATIONS = await api('/api/conversations'); render(); };
      const sendBtn = document.getElementById('thread-send');
      const input = document.getElementById('thread-input');
      const doSend = async () => {
        const text = input.value.trim();
        if(!text) return;
        input.value = '';
        try{
          await api(`/api/messages/${INBOX_THREAD}`, { method:'POST', body:{ text } });
          THREAD_MESSAGES = await api(`/api/messages/${INBOX_THREAD}`);
          render();
          const box = document.getElementById('thread-messages');
          if(box) box.scrollTop = box.scrollHeight;
        }catch(e){ showToast(e.message); }
      };
      if(sendBtn) sendBtn.onclick = doSend;
      if(input) input.onkeydown = e => { if(e.key==='Enter') doSend(); };
    }
  }

  if(VIEW==='classmates' || VIEW==='viewProfile'){
    document.querySelectorAll('[data-action="connect"]').forEach(b => b.onclick = async () => {
      try{ await api(`/api/connections/${b.dataset.user}/request`, { method:'POST' }); await loadAppData(); render(); }
      catch(e){ showToast(e.message); }
    });
    document.querySelectorAll('[data-action="accept"]').forEach(b => b.onclick = async () => {
      try{ await api(`/api/connections/${b.dataset.user}/accept`, { method:'POST' }); await loadAppData(); render(); showToast('You are now connected!'); }
      catch(e){ showToast(e.message); }
    });
  }
  // requests panel accept buttons (may appear regardless of VIEW)
  document.querySelectorAll('.side-right [data-action="accept"]').forEach(b => { if(!b.onclick) b.onclick = async () => {
    try{ await api(`/api/connections/${b.dataset.user}/accept`, { method:'POST' }); await loadAppData(); render(); }
    catch(e){ showToast(e.message); }
  }});

  if(VIEW==='profile'){
    const av = document.getElementById('edit-avatar');
    if(av) av.onchange = e => { if(e.target.files[0]){ pendingAvatarFile = e.target.files[0]; render(); } };
    const save = document.getElementById('save-profile-btn');
    if(save) save.onclick = async () => {
      try{
        const fd = new FormData();
        fd.append('name', document.getElementById('edit-name').value.trim());
        fd.append('bio', document.getElementById('edit-bio').value.trim());
        if(pendingAvatarFile) fd.append('avatar', pendingAvatarFile);
        ME = await api('/api/me', { method:'PUT', body: fd, isForm:true });
        pendingAvatarFile = null;
        await loadAppData(); VIEW='feed'; render();
        showToast('Profile updated.');
      }catch(e){ showToast(e.message); }
    };
  }
}

// ---------------- boot ----------------
(async function boot(){
  if(TOKEN){
    try{
      ME = await api('/api/me');
      await loadAppData();
    }catch(e){ TOKEN=null; ME=null; localStorage.removeItem('rc_token'); }
  }
  render();
})();
