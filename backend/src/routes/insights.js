const express = require('express');
const { getDb } = require('../db');
const { dashboard, BADGES } = require('../gamification');
const { completionProfile, toHHmm } = require('../scheduler');
const { predictProductiveHours } = require('../mlClient');

function expandProfile(profile) {
  const samples = [];
  for (const row of profile) {
    for (let i = 0; i < row.completed; i += 1) {
      samples.push({ day_of_week: row.day_of_week, hour: row.hour, completed: true });
    }
    for (let i = 0; i < row.total - row.completed; i += 1) {
      samples.push({ day_of_week: row.day_of_week, hour: row.hour, completed: false });
    }
  }
  return samples;
}

const router = express.Router();

router.get('/dashboard', async (req, res) => {
  const db = getDb();
  const sessions = db.prepare('SELECT * FROM sessions WHERE user_id = ?').all(req.user.id);
  const profile = completionProfile(sessions);
  const ml = await predictProductiveHours(expandProfile(profile));
  res.json({ ...dashboard(db, req.user.id), productiveHours: ml });
});

router.get('/badges', (req, res) => {
  const earned = getDb()
    .prepare('SELECT code, earned_at FROM badges WHERE user_id = ?')
    .all(req.user.id);
  const byCode = new Map(earned.map((b) => [b.code, b.earned_at]));
  res.json(BADGES.map((b) => ({ ...b, earned: byCode.has(b.code), earnedAt: byCode.get(b.code) || null })));
});

router.get('/insights', async (req, res) => {
  const db = getDb();
  const sessions = db.prepare('SELECT * FROM sessions WHERE user_id = ?').all(req.user.id);
  const profile = completionProfile(sessions);
  const ml = await predictProductiveHours(expandProfile(profile));

  const heatmap = new Map();
  for (const row of profile) {
    heatmap.set(`${row.day_of_week}:${row.hour}`, { completed: row.completed, total: row.total });
  }

  const totals = db
    .prepare(
      `SELECT scheduled_date AS day, COALESCE(SUM(CASE WHEN status = 'completed' THEN end_minute - start_minute END), 0) AS completedMinutes,
              COALESCE(SUM(CASE WHEN status = 'planned' THEN end_minute - start_minute END), 0) AS plannedMinutes
       FROM sessions WHERE user_id = ? AND scheduled_date >= DATE('now', '-13 day')
       GROUP BY scheduled_date ORDER BY scheduled_date`
    )
    .all(req.user.id);

  res.json({
    productiveHours: ml,
    bestHoursLabel: ml.bestHours.map((h) => `${toHHmm(h * 60)}–${toHHmm(h * 60 + 60)}`),
    heatmap: Array.from(heatmap.entries()).map(([key, v]) => {
      const [day, hour] = key.split(':').map(Number);
      return { dayOfWeek: day, hour, ...v };
    }),
    activity: totals,
    totalSessions: sessions.length,
    completedSessions: sessions.filter((s) => s.status === 'completed').length,
    completionRate: sessions.length
      ? Math.round((sessions.filter((s) => s.status === 'completed').length / sessions.length) * 100)
      : 0,
  });
});

module.exports = router;
