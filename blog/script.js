function updateClock() {
    const now = new Date();
    document.getElementById('clock').textContent = now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

updateClock(); 
setInterval(updateClock, 1000);

function updateDate() {
    const now = new Date();

    // 'short' gives the 3-letter month (Oct), 'numeric' gives the unpadded day and full year
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    const formattedDate = now.toLocaleDateString('en-US', options);

    document.getElementById('date').textContent = formattedDate;
}

// Call the function when the page loads
updateDate();

function myTrackerFunction() {
  var popup = document.getElementById("myTracker");
  popup.classList.toggle("show");
}
function myInstagramFunction() {
  var popup = document.getElementById("myInstagram");
  popup.classList.toggle("show");
}



let loggedIn = false;
const $ = id => document.getElementById(id);
 
function fmt(iso) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}
 
async function api(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
 
// the "submission time" line above the textbox, kept live while you type
function tickStamp() { $('stamp').textContent = 'will be posted: ' + fmt(new Date().toISOString()); }
setInterval(tickStamp, 1000 * 20);
 
function renderAuth() {
  $('status').textContent = loggedIn ? 'logged in (admin)' : 'guest';
  $('authBtn').textContent = loggedIn ? 'logout' : 'login';
  $('composeBox').classList.toggle('show', loggedIn);
  if (loggedIn) { $('loginBox').classList.remove('show'); tickStamp(); }
}
 
async function loadPosts() {
  const posts = await api('/api/posts');
  const feed = $('feed');
  feed.textContent = '';
  if (!posts.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'no posts yet.';
    feed.appendChild(e);
    return;
  }
  posts.forEach(p => feed.appendChild(renderPost(p)));
}
 
function renderPost(p) {
  const el = document.createElement('div');
  el.className = 'post';
 
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = fmt(p.createdAt) + (p.editedAt ? ' (edited ' + fmt(p.editedAt) + ')' : '');
 
  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = p.text; // textContent, never innerHTML, so posts can't inject code
 
  el.append(meta, text);
 
  if (loggedIn) {
    const actions = document.createElement('div');
    actions.className = 'actions';
 
    const edit = document.createElement('button');
    edit.className = 'btn';
    edit.textContent = 'edit';
    edit.onclick = () => startEdit(el, p);
 
    const del = document.createElement('button');
    del.className = 'btn danger';
    del.textContent = 'delete';
    del.onclick = async () => {
      if (!confirm('Delete this post?')) return;
      try { await api('/api/posts/' + p.id, 'DELETE'); loadPosts(); }
      catch (e) { alert(e.message); }
    };
 
    actions.append(edit, del);
    el.appendChild(actions);
  }
  return el;
}
 
function startEdit(el, p) {
  el.textContent = '';
  const ta = document.createElement('textarea');
  ta.value = p.text;
  const actions = document.createElement('div');
  actions.className = 'actions';
 
  const save = document.createElement('button');
  save.className = 'btn';
  save.textContent = 'save';
  save.onclick = async () => {
    try { await api('/api/posts/' + p.id, 'PUT', { text: ta.value }); loadPosts(); }
    catch (e) { alert(e.message); }
  };
 
  const cancel = document.createElement('button');
  cancel.className = 'btn';
  cancel.textContent = 'cancel';
  cancel.onclick = loadPosts;
 
  actions.append(save, cancel);
  el.append(ta, actions);
  ta.focus();
}
 
$('authBtn').onclick = async () => {
  if (loggedIn) {
    await api('/api/logout', 'POST');
    loggedIn = false;
    renderAuth();
    loadPosts();
  } else {
    $('loginBox').classList.toggle('show');
    $('user').focus();
  }
};
 
async function doLogin() {
  $('loginError').textContent = '';
  try {
    await api('/api/login', 'POST', { username: $('user').value, password: $('pass').value });
    $('pass').value = '';
    loggedIn = true;
    renderAuth();
    loadPosts();
  } catch (e) { $('loginError').textContent = e.message; }
}
$('loginSubmit').onclick = doLogin;
$('pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
 
$('postBtn').onclick = async () => {
  $('postError').textContent = '';
  try {
    await api('/api/posts', 'POST', { text: $('newText').value });
    $('newText').value = '';
    loadPosts();
  } catch (e) { $('postError').textContent = e.message; }
};
 
(async function init() {
  const me = await api('/api/me');
  loggedIn = me.loggedIn;
  renderAuth();
  loadPosts();
})();
