// Simple blog backend (no dependencies, just Node 18+).
// Public reads, password-protected writes, posts saved to data/posts.json.
//
// Start it with your own login:
//   ADMIN_USER=yourname ADMIN_PASS=somethinglong node server.js

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'posts.json');
const SECURE_COOKIE = process.env.NODE_ENV === 'production'; // set when served over https

if (!ADMIN_USER || !ADMIN_PASS) {
  console.error('Set ADMIN_USER and ADMIN_PASS environment variables before starting.');
  process.exit(1);
}

// ---------- storage ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

function loadPosts() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}
function savePosts(posts) {
  // write to a temp file, then rename, so a crash can't corrupt the data
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(posts, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// ---------- auth ----------
const sessions = new Map(); // token -> expiry time
const SESSION_MS = 1000 * 60 * 60 * 8; // 8 hours

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function getToken(req) {
  const match = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('session='));
  return match ? match.slice('session='.length) : null;
}
function isLoggedIn(req) {
  const token = getToken(req);
  if (!token || !sessions.has(token)) return false;
  if (sessions.get(token) < Date.now()) { sessions.delete(token); return false; }
  return true;
}

// brute-force protection: 5 failed logins per IP per 15 minutes
const attempts = new Map();
function attemptRecord(ip) {
  const now = Date.now();
  let rec = attempts.get(ip);
  if (!rec || rec.reset < now) { rec = { count: 0, reset: now + 15 * 60 * 1000 }; attempts.set(ip, rec); }
  return rec;
}

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json', ...headers });
  res.end(data);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 100 * 1024) { reject(new Error('Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('Bad JSON')); }
    });
    req.on('error', reject);
  });
}
function cleanText(body) {
  const text = String((body && body.text) || '').trim();
  if (!text) return { error: 'Post is empty' };
  if (text.length > 5000) return { error: 'Post is too long (5000 max)' };
  return { text };
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json'
};
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden'); // block ../ tricks
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- routes ----------
async function handleApi(req, res, pathname) {
  const method = req.method;

  if (pathname === '/api/me' && method === 'GET') return send(res, 200, { loggedIn: isLoggedIn(req) });

  if (pathname === '/api/login' && method === 'POST') {
    const rec = attemptRecord(req.socket.remoteAddress);
    if (rec.count >= 5) return send(res, 429, { error: 'Too many attempts. Try again later.' });
    const { username, password } = await readJson(req);
    const userOk = safeEqual(username || '', ADMIN_USER);
    const passOk = safeEqual(password || '', ADMIN_PASS);
    if (!(userOk && passOk)) { rec.count++; return send(res, 401, { error: 'Wrong username or password' }); }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_MS);
    const cookie = `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${SECURE_COOKIE ? '; Secure' : ''}`;
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const token = getToken(req);
    if (token) sessions.delete(token);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  // public: anyone can read posts (newest first)
  if (pathname === '/api/posts' && method === 'GET') {
    return send(res, 200, loadPosts().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  // everything below needs a login
  const m = pathname.match(/^\/api\/posts(?:\/([\w-]+))?$/);
  if (!m) return send(res, 404, { error: 'Not found' });
  if (!isLoggedIn(req)) return send(res, 401, { error: 'Not logged in' });
  const id = m[1];

  if (!id && method === 'POST') {
    const { text, error } = cleanText(await readJson(req));
    if (error) return send(res, 400, { error });
    const posts = loadPosts();
    const post = { id: crypto.randomUUID(), text, createdAt: new Date().toISOString(), editedAt: null };
    posts.push(post);
    savePosts(posts);
    return send(res, 201, post);
  }

  if (id && method === 'PUT') {
    const { text, error } = cleanText(await readJson(req));
    if (error) return send(res, 400, { error });
    const posts = loadPosts();
    const post = posts.find(p => p.id === id);
    if (!post) return send(res, 404, { error: 'Not found' });
    post.text = text;
    post.editedAt = new Date().toISOString();
    savePosts(posts);
    return send(res, 200, post);
  }

  if (id && method === 'DELETE') {
    const posts = loadPosts();
    const next = posts.filter(p => p.id !== id);
    if (next.length === posts.length) return send(res, 404, { error: 'Not found' });
    savePosts(next);
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: 'Method not allowed' });
}

http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    if (req.method !== 'GET') return send(res, 405, 'Method not allowed');
    serveStatic(req, res, pathname);
  } catch (e) {
    send(res, 400, { error: e.message || 'Bad request' });
  }
}).listen(PORT, () => console.log(`Blog running at http://localhost:${PORT}`));

