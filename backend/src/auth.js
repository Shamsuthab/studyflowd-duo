const crypto = require('crypto');
const { getDb } = require('./db');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(candidate, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' });
  }
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.daily_goal_minutes
       FROM auth_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token = ?`
    )
    .get(token);
  if (!row) {
    return res.status(401).json({ error: 'Invalid auth token' });
  }
  req.user = row;
  next();
}

function issueToken(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO auth_tokens (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}

module.exports = { hashPassword, verifyPassword, authMiddleware, issueToken };
