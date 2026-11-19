const { getDb } = require('./db');
const { todayISO, addDays } = require('./scheduler');

const BADGES = [
  { code: 'first_session', name: 'First Step', description: 'Complete your first study session.' },
  { code: 'streak_3', name: 'Warming Up', description: 'Keep a 3-day study streak.' },
  { code: 'streak_7', name: 'On Fire', description: 'Keep a 7-day study streak.' },
  { code: 'sessions_10', name: 'Grinder', description: 'Complete 10 study sessions.' },
  { code: 'sessions_50', name: 'Veteran', description: 'Complete 50 study sessions.' },
  { code: 'early_bird', name: 'Deadline Ninja', description: 'Finish a task at least one day before its deadline.' },
  { code: 'review_master', name: 'Memory Keeper', description: 'Complete a spaced-repetition review session.' },
  { code: 'daily_goal', name: 'Goal Crusher', description: 'Hit your daily goal in a single day.' },
];

function sessionDates(db, userId) {
  const rows = db
    .prepare(
      `SELECT DISTINCT COALESCE(SUBSTR(completed_at, 1, 10), scheduled_date) AS day
       FROM sessions WHERE user_id = ? AND status = 'completed'
       ORDER BY day DESC`
    )
    .all(userId);
  return rows.map((r) => r.day);
}

function computeStreak(days) {
  if (days.length === 0) return 0;
  const set = new Set(days);
  const today = todayISO();
  let cursor = set.has(today) ? today : addDays(today, -1);
  if (!set.has(cursor)) return 0;
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function awardBadge(db, userId, code) {
  db.prepare('INSERT OR IGNORE INTO badges (user_id, code) VALUES (?, ?)').run(userId, code);
}

function maybeAward(db, userId) {
  const completed = db
    .prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND status = 'completed'`)
    .get(userId).n;
  const reviews = db
    .prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND status = 'completed' AND kind = 'review'`)
    .get(userId).n;
  const streak = computeStreak(sessionDates(db, userId));

  if (completed >= 1) awardBadge(db, userId, 'first_session');
  if (completed >= 10) awardBadge(db, userId, 'sessions_10');
  if (completed >= 50) awardBadge(db, userId, 'sessions_50');
  if (streak >= 3) awardBadge(db, userId, 'streak_3');
  if (streak >= 7) awardBadge(db, userId, 'streak_7');
  if (reviews >= 1) awardBadge(db, userId, 'review_master');

  const goal = db.prepare('SELECT daily_goal_minutes FROM users WHERE id = ?').get(userId).daily_goal_minutes;
  const goalHit = db
    .prepare(
      `SELECT COALESCE(SUM(end_minute - start_minute), 0) AS mins
       FROM sessions
       WHERE user_id = ? AND status = 'completed' AND COALESCE(SUBSTR(completed_at, 1, 10), scheduled_date) = ?
       HAVING mins >= ? LIMIT 1`
    )
    .get(userId, todayISO(), goal);
  if (goalHit) awardBadge(db, userId, 'daily_goal');

  const early = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tasks
       WHERE user_id = ? AND status = 'done' AND DATE(completed_at) <= DATE(deadline, '-1 day')`
    )
    .get(userId).n;
  if (early >= 1) awardBadge(db, userId, 'early_bird');
}

function dashboard(db, userId) {
  maybeAward(db, userId);
  const user = db.prepare('SELECT name, daily_goal_minutes FROM users WHERE id = ?').get(userId);
  const now = new Date();
  const today = todayISO(now);

  const completedToday = db
    .prepare(
      `SELECT COALESCE(SUM(end_minute - start_minute), 0) AS mins, COUNT(*) AS n
       FROM sessions
       WHERE user_id = ? AND status = 'completed' AND COALESCE(SUBSTR(completed_at, 1, 10), scheduled_date) = ?`
    )
    .get(userId, today);

  const todaySessions = db
    .prepare(
      `SELECT s.*, t.title AS task_title, c.name AS course_name, c.color AS course_color
       FROM sessions s
       LEFT JOIN tasks t ON t.id = s.task_id
       LEFT JOIN courses c ON c.id = t.course_id
       WHERE s.user_id = ? AND s.scheduled_date = ? AND s.status IN ('planned', 'completed')
       ORDER BY s.start_minute`
    )
    .all(userId, today);

  const dueSoonTaskCount = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tasks
       WHERE user_id = ? AND status IN ('todo', 'in_progress', 'late') AND DATE(deadline) BETWEEN DATE(?) AND DATE(?, '+7 day')`
    )
    .get(userId, today, today).n;

  const upcomingDeadlines = db
    .prepare(
      `SELECT t.*, c.name AS course_name, c.color AS course_color
       FROM tasks t JOIN courses c ON c.id = t.course_id
       WHERE t.user_id = ? AND t.status IN ('todo', 'in_progress', 'late')
       ORDER BY t.deadline LIMIT 5`
    )
    .all(userId);

  const reviewsDue = db
    .prepare(
      `SELECT COUNT(*) AS n FROM review_plans WHERE user_id = ? AND status = 'planned' AND due_date <= DATE(?)`
    )
    .get(userId, today).n;

  const streak = computeStreak(sessionDates(db, userId));
  const earned = db.prepare('SELECT code, earned_at FROM badges WHERE user_id = ? ORDER BY earned_at').all(userId);
  const earnedCodes = new Set(earned.map((b) => b.code));
  const allBadges = BADGES.map((b) => ({ ...b, earned: earnedCodes.has(b.code), earned_at: null }));

  const weekMinutes = db
    .prepare(
      `SELECT COALESCE(SUM(end_minute - start_minute), 0) AS mins
       FROM sessions
       WHERE user_id = ? AND status = 'completed' AND scheduled_date >= DATE(?, '-6 day')`
    )
    .get(userId, today).mins;

  return {
    user: { name: user.name, dailyGoalMinutes: user.daily_goal_minutes },
    today,
    dailyGoal: {
      goalMinutes: user.daily_goal_minutes,
      completedMinutes: completedToday.mins,
      sessionsCompleted: completedToday.n,
      percent: Math.min(100, Math.round((completedToday.mins / Math.max(1, user.daily_goal_minutes)) * 100)),
    },
    streakDays: streak,
    weekMinutes,
    todaySessions,
    dueSoonTaskCount,
    upcomingDeadlines,
    reviewsDue,
    badges: allBadges,
    newlyEarned: earned.filter((b) => !b.notified),
  };
}

module.exports = { BADGES, computeStreak, sessionDates, maybeAward, awardBadge, dashboard };
