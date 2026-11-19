const express = require('express');
const { getDb } = require('../db');
const { hashPassword, verifyPassword, issueToken } = require('../auth');

const router = express.Router();

router.post('/register', (req, res) => {
  const { email, name, password } = req.body || {};
  if (!email || !name || !password || password.length < 6) {
    return res.status(400).json({ error: 'email, name and a password of at least 6 characters are required' });
  }
  const db = getDb();
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (exists) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }
  const info = db
    .prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)')
    .run(email.toLowerCase(), name, hashPassword(password));
  const token = issueToken(db, info.lastInsertRowid);
  res.status(201).json({ token, user: { id: info.lastInsertRowid, email: email.toLowerCase(), name } });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!user || !verifyPassword(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = issueToken(db, user.id);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

module.exports = router;
