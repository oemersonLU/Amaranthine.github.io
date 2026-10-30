// Minimal blog backend: admin login + post CRUD, stored in posts.json
// Setup:  npm install
//         node server.js hash "your-password"      -> prints a hash
//         ADMIN_USER=olivia ADMIN_PASS_HASH="<hash>" node server.js
// Put index.html, style.css, script.js and /images inside a "public" folder.

const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---- password hashing helpers (scrypt, built into Node) ----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return salt + ':' + hash;
}
function checkPassword(pw, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const real = Buffer.from(hash, 'hex');
  return test.length === real.length && crypto.timingSafeEqual(test, real);
}

if (process.argv[2] === 'hash') {
  console.log(hashPassword(process.argv[3] || ''));
  process.exit(0);
}

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH;
if (!ADMIN_PASS_HASH) {
  console.error('Set ADMIN_PASS_HASH first (run: node server.js hash "your-password")');
  process.exit(1);
}

const app = express();
const DATA = path.join(__dirname, 'posts.json');

app.use(express.json({ limit: '50kb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', maxAge: 1000 * 60 * 60 * 8 } // 8 hours
}));

// ---- storage ----
function readPosts() {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); }
  catch { return []; }
}
function writePosts(posts) {
  fs.writeFileSync(DATA, JSON.stringify(posts, null, 2));
}

function requireAdmin(req, res, next) {
  if (req.session.admin) return next();
  res.status(401).json({ error: 'Not logged in' });
}

function validText(t) {
  return typeof t === 'string' && t.trim().length > 0 && t.length <= 5000;
}

// ---- auth (with a simple slowdown against guessing) ----
const fails = new Map();
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const rec = fails.get(ip) || { n: 0, until: 0 };
  if (Date.now() < rec.until) return res.status(429).json({ error: 'Too many attempts, wait a bit' });

  const { username, password } = req.body || {};
  const ok = username === ADMIN_USER && typeof password === 'string' && checkPassword(password, ADMIN_PASS_HASH);
  if (!ok) {
    rec.n++;
    if (rec.n >= 5) { rec.until = Date.now() + 60_000; rec.n = 0; }
    fails.set(ip, rec);
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  fails.delete(ip);
  req.session.regenerate(() => {
    req.session.admin = true;
    res.json({ ok: true });
  });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => res.json({ loggedIn: !!req.session.admin }));

// ---- posts ----
app.get('/api/posts', (req, res) => {
  const posts = readPosts().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // newest first
  res.json(posts);
});

app.post('/api/posts', requireAdmin, (req, res) => {
  const { text } = req.body || {};
  if (!validText(text)) return res.status(400).json({ error: 'Post must be 1-5000 characters' });
  const posts = readPosts();
  const post = { id: crypto.randomUUID(), text: text.trim(), createdAt: new Date().toISOString(), editedAt: null };
  posts.push(post);
  writePosts(posts);
  res.json(post);
});

app.put('/api/posts/:id', requireAdmin, (req, res) => {
  const { text } = req.body || {};
  if (!validText(text)) return res.status(400).json({ error: 'Post must be 1-5000 characters' });
  const posts = readPosts();
  const post = posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  post.text = text.trim();
  post.editedAt = new Date().toISOString();
  writePosts(posts);
  res.json(post);
});

app.delete('/api/posts/:id', requireAdmin, (req, res) => {
  const posts = readPosts();
  const next = posts.filter(p => p.id !== req.params.id);
  if (next.length === posts.length) return res.status(404).json({ error: 'Post not found' });
  writePosts(next);
  res.json({ ok: true });
});

// ---- static site (only the public folder is served) ----
app.use(express.static(path.join(__dirname, 'public')));

app.listen(3000, () => console.log('Running at http://localhost:3000'));
