const express = require('express');
const { getDb } = require('../db');
const { buildSchedule } = require('../scheduler');
const { authMiddleware } = require('../auth');

const router = express.Router();
router.use(authMiddleware);

function replan(userId) {
  const db = getDb();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  db.prepare(
    `UPDATE sessions SET status = 'missed'
     WHERE user_id = ? AND status = 'planned'
       AND (scheduled_date < ? OR (scheduled_date = ? AND end_minute < ?))`
  ).run(userId, today, today, now.getUTCHours() * 60 + now.getUTCMinutes());

  db.prepare(
    `UPDATE tasks SET status = 'late', updated_at = datetime('now')
     WHERE user_id = ? AND deadline < ? AND status IN ('todo', 'in_progress')`
  ).run(userId, today);

  const tasks = db
    .prepare(`SELECT * FROM tasks WHERE user_id = ? AND status IN ('todo', 'in_progress', 'late')`)
    .all(userId);
  const slots = db.prepare(`SELECT * FROM slots WHERE user_id = ?`).all(userId);
  const existing = db
    .prepare(`SELECT * FROM sessions WHERE user_id = ? AND status IN ('completed', 'planned')`)
    .all(userId);

  const productive = db
    .prepare(`SELECT * FROM sessions WHERE user_id = ?`)
    .all(userId);
  const plan = buildSchedule({
    tasks,
    slots,
    existingSessions: existing,
    today,
  });

  const remove = db.prepare(`DELETE FROM sessions WHERE user_id = ? AND status = 'planned'`);
  remove.run(userId);
  const insert = db.prepare(
    `INSERT INTO sessions (user_id, task_id, kind, scheduled_date, start_minute, end_minute, status, ml_boosted)
     VALUES (?, ?, ?, ?, ?, ?, 'planned', ?)`
  );
  const tx = db.transaction(() => {
    for (const s of plan.sessions) {
      insert.run(userId, s.task_id, s.kind, s.scheduled_date, s.start_minute, s.end_minute, s.ml_boosted);
    }
  });
  tx();

  return { plan, slotCount: slots.length, taskCount: tasks.length, activityCount: productive.length };
}

function scheduleResponse(userId) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.id, s.task_id, s.kind, s.scheduled_date, s.start_minute, s.end_minute, s.status,
              s.ml_boosted AS mlBoosted, t.title AS task_title, c.name AS course_name, c.color AS course_color,
              t.priority, t.difficulty
       FROM sessions s
       LEFT JOIN tasks t ON t.id = s.task_id
       LEFT JOIN courses c ON c.id = t.course_id
       WHERE s.user_id = ?
       ORDER BY s.scheduled_date, s.start_minute`
    )
    .all(userId);
  return rows;
}

router.get('/schedule', (req, res) => {
  res.json({ sessions: scheduleResponse(req.user.id) });
});

router.post('/schedule/regenerate', (req, res) => {
  replan(req.user.id);
  res.json({ sessions: scheduleResponse(req.user.id) });
});

router.patch('/sessions/:id', (req, res) => {
  const db = getDb();
  const { status } = req.body || {};
  if (!['planned', 'completed', 'missed', 'moved'].includes(status)) {
    return res.status(400).json({ error: 'status must be planned, completed, missed or moved' });
  }
  const session = db
    .prepare(`SELECT * FROM sessions WHERE id = ? AND user_id = ?`)
    .get(req.params.id, req.user.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const completedAt =
    status === 'completed' ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null;
  db.prepare(`UPDATE sessions SET status = ?, completed_at = ? WHERE id = ?`).run(status, completedAt, session.id);

  if (status === 'completed' && session.task_id) {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(session.task_id);
    const remaining = db
      .prepare(`SELECT COUNT(*) AS n FROM sessions WHERE task_id = ? AND status = 'planned'`)
      .get(task.id).n;
    if (remaining === 0 && ['todo', 'in_progress', 'late'].includes(task.status)) {
      db.prepare(`UPDATE tasks SET status = 'done', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(task.id);
    } else if (task.status === 'todo') {
      db.prepare(`UPDATE tasks SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?`).run(task.id);
    }
    createReviewPlan(req.user.id, task);
  }

  replan(req.user.id);
  res.json({ sessions: scheduleResponse(req.user.id) });
});

function createReviewPlan(userId, task) {
  const INTERVALS = [1, 3, 7, 14];
  const db = getDb();
  const anchor = new Date().toISOString().slice(0, 10);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO review_plans (user_id, task_id, anchor_date, interval_days, due_date)
     VALUES (?, ?, ?, ?, DATE(?, '+' || ? || ' day'))`
  );
  const tx = db.transaction(() => {
    for (const interval of INTERVALS) {
      insert.run(userId, task.id, anchor, interval, anchor, interval);
    }
  });
  tx();
  const planned = db
    .prepare(
      `SELECT * FROM review_plans WHERE user_id = ? AND task_id = ? AND status = 'planned' AND due_date = DATE(?, '+1 day')`
    )
    .get(userId, task.id, anchor);
  if (planned) {
    db.prepare(
      `INSERT INTO sessions (user_id, task_id, kind, scheduled_date, start_minute, end_minute, status)
       VALUES (?, ?, 'review', ?, 1080, 1140, 'planned')`
    ).run(userId, task.id, planned.due_date);
  }
}

module.exports = { router, replan, scheduleResponse, createReviewPlan };
