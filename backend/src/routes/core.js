const express = require('express');
const { getDb } = require('../db');
const { replan } = require('./schedule');
const { authMiddleware } = require('../auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/courses', (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM tasks t WHERE t.course_id = c.id AND t.status IN ('todo', 'in_progress', 'late')) AS openTasks
       FROM courses c WHERE c.user_id = ? ORDER BY c.name`
    )
    .all(req.user.id);
  res.json(rows);
});

router.post('/courses', (req, res) => {
  const { name, color, credits } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Course name is required' });
  }
  const info = getDb()
    .prepare('INSERT INTO courses (user_id, name, color, credits) VALUES (?, ?, ?, ?)')
    .run(req.user.id, String(name).trim(), color || '#4f7cff', Number(credits) || 0);
  res.status(201).json({ id: info.lastInsertRowid, name: String(name).trim(), color: color || '#4f7cff', credits: Number(credits) || 0, openTasks: 0 });
});

router.put('/courses/:id', (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const { name, color, credits } = req.body || {};
  db.prepare('UPDATE courses SET name = ?, color = ?, credits = ? WHERE id = ?').run(
    name || course.name,
    color || course.color,
    credits !== undefined ? Number(credits) : course.credits,
    course.id
  );
  res.json(db.prepare('SELECT * FROM courses WHERE id = ?').get(course.id));
});

router.delete('/courses/:id', (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  db.prepare('DELETE FROM courses WHERE id = ?').run(course.id);
  replan(req.user.id);
  res.status(204).end();
});

router.get('/tasks', (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT t.*, c.name AS course_name, c.color AS course_color,
              (SELECT COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.end_minute - s.start_minute END), 0)
                 FROM sessions s WHERE s.task_id = t.id) AS completed_minutes
       FROM tasks t JOIN courses c ON c.id = t.course_id
       WHERE t.user_id = ?
       ORDER BY CASE WHEN t.status = 'done' THEN 1 ELSE 0 END, t.deadline, t.priority`
    )
    .all(req.user.id);
  res.json(rows);
});

function validateTaskPayload(body, { existing = {}, userId } = {}) {
  const errors = [];
  const db = getDb();
  const out = {};

  const courseId = body.course_id !== undefined ? body.course_id : existing.course_id;
  if (!courseId) {
    errors.push('course_id is required');
  } else {
    const course = db.prepare('SELECT id FROM courses WHERE id = ? AND user_id = ?').get(courseId, existing.user_id ?? userId);
    if (!course) errors.push('Unknown course');
    else out.course_id = Number(courseId);
  }

  const title = body.title !== undefined ? body.title : existing.title;
  if (!title || !String(title).trim()) errors.push('title is required');
  else out.title = String(title).trim();

  const type = body.type !== undefined ? body.type : existing.type || 'assignment';
  if (!['assignment', 'essay', 'exam', 'reading', 'project'].includes(type)) errors.push('Invalid type');
  else out.type = type;

  const priority = body.priority !== undefined ? Number(body.priority) : existing.priority ?? 2;
  if (![1, 2, 3].includes(priority)) errors.push('priority must be 1 (high), 2 (medium) or 3 (low)');
  else out.priority = priority;

  const difficulty = body.difficulty !== undefined ? Number(body.difficulty) : existing.difficulty ?? 3;
  if (!(difficulty >= 1 && difficulty <= 5)) errors.push('difficulty must be 1-5');
  else out.difficulty = difficulty;

  const estimated = body.estimated_hours !== undefined ? Number(body.estimated_hours) : existing.estimated_hours ?? 2;
  if (!(estimated > 0 && estimated <= 100)) errors.push('estimated_hours must be between 0 and 100');
  else out.estimated_hours = estimated;

  const deadline = body.deadline !== undefined ? body.deadline : existing.deadline;
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) errors.push('deadline must be YYYY-MM-DD');
  else out.deadline = deadline;

  return { errors, out };
}

router.post('/tasks', (req, res) => {
  const { errors, out } = validateTaskPayload(req.body || {}, { userId: req.user.id });
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO tasks (user_id, course_id, title, type, priority, difficulty, estimated_hours, deadline)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, out.course_id, out.title, out.type, out.priority, out.difficulty, out.estimated_hours, out.deadline);
  replan(req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/tasks/:id', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { errors, out } = validateTaskPayload(req.body || {}, { existing: task });
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  db.prepare(
    `UPDATE tasks SET course_id = ?, title = ?, type = ?, priority = ?, difficulty = ?, estimated_hours = ?, deadline = ?, status = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    out.course_id,
    out.title,
    out.type,
    out.priority,
    out.difficulty,
    out.estimated_hours,
    out.deadline,
    task.status,
    task.id
  );
  replan(req.user.id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id));
});

router.patch('/tasks/:id/status', (req, res) => {
  const db = getDb();
  const { status } = req.body || {};
  if (!['todo', 'in_progress', 'done'].includes(status)) {
    return res.status(400).json({ error: 'status must be todo, in_progress or done' });
  }
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (status === 'done') {
    db.prepare(`UPDATE tasks SET status = 'done', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(task.id);
    if (task.status !== 'done') {
      require('./schedule').createReviewPlan(req.user.id, task);
    }
  } else {
    db.prepare(`UPDATE tasks SET status = ?, completed_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(status, task.id);
  }
  replan(req.user.id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id));
});

router.delete('/tasks/:id', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  replan(req.user.id);
  res.status(204).end();
});

router.get('/slots', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM slots WHERE user_id = ? ORDER BY day_of_week, start_minute').all(req.user.id));
});

function validateSlot(body) {
  const day = Number(body.day_of_week);
  const start = Number(body.start_minute);
  const end = Number(body.end_minute);
  if (!(day >= 0 && day <= 6)) return { error: 'day_of_week must be 0 (Sunday) to 6 (Saturday)' };
  if (!(start >= 0 && start < 1440)) return { error: 'start_minute must be 0-1439' };
  if (!(end > 0 && end <= 1440)) return { error: 'end_minute must be 1-1440' };
  if (end - start < 30) return { error: 'Free slots must be at least 30 minutes long' };
  return { day, start, end, label: String(body.label || '') };
}

router.post('/slots', (req, res) => {
  const v = validateSlot(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  const db = getDb();
  const info = db
    .prepare('INSERT INTO slots (user_id, day_of_week, start_minute, end_minute, label) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, v.day, v.start, v.end, v.label);
  replan(req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM slots WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/slots/:id', (req, res) => {
  const db = getDb();
  const slot = db.prepare('SELECT * FROM slots WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!slot) return res.status(404).json({ error: 'Slot not found' });
  db.prepare('DELETE FROM slots WHERE id = ?').run(slot.id);
  replan(req.user.id);
  res.status(204).end();
});

router.get('/me', (req, res) => {
  res.json(req.user);
});

router.put('/me', (req, res) => {
  const db = getDb();
  const { daily_goal_minutes } = req.body || {};
  if (daily_goal_minutes !== undefined) {
    const n = Number(daily_goal_minutes);
    if (!(n > 0 && n <= 960)) return res.status(400).json({ error: 'daily_goal_minutes must be 1-960' });
    db.prepare('UPDATE users SET daily_goal_minutes = ? WHERE id = ?').run(n, req.user.id);
  }
  res.json(db.prepare('SELECT id, email, name, daily_goal_minutes FROM users WHERE id = ?').get(req.user.id));
});

router.get('/reviews', (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT r.*, t.title AS task_title, c.name AS course_name
       FROM review_plans r JOIN tasks t ON t.id = r.task_id JOIN courses c ON c.id = t.course_id
       WHERE r.user_id = ?
       ORDER BY r.due_date`
    )
    .all(req.user.id);
  res.json(rows);
});

router.post('/reviews/:id/complete', (req, res) => {
  const db = getDb();
  const review = db.prepare('SELECT * FROM review_plans WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  db.prepare(`UPDATE review_plans SET status = 'done' WHERE id = ?`).run(review.id);
  db.prepare(`DELETE FROM sessions WHERE task_id = ? AND kind = 'review' AND scheduled_date = ? AND status = 'planned'`).run(review.task_id, review.due_date);
  res.json({ ok: true });
});

module.exports = router;
