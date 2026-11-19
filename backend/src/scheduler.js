const PRIORITY_WEIGHT = { 1: 3, 2: 2, 3: 1 };
const DEFAULT_SESSION_MINUTES = 90;
const MIN_SESSION_MINUTES = 30;
const DAY_MINUTES = 24 * 60;

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function toHHmm(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const d = parseISODate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

function daysBetween(fromISO, toISO) {
  return Math.round((parseISODate(toISO) - parseISODate(fromISO)) / 86400000);
}

function todayISO(now = new Date()) {
  return toISODate(now);
}

function busyIntervals(sessions) {
  const byDate = new Map();
  for (const s of sessions) {
    if (s.status === 'missed' || s.status === 'moved') continue;
    if (!byDate.has(s.scheduled_date)) byDate.set(s.scheduled_date, []);
    byDate.get(s.scheduled_date).push({ start: s.start_minute, end: s.end_minute });
  }
  return byDate;
}

function freeWindowsWithCapacity(slots, dateISO, occupied) {
  if (slots.length === 0) return [];
  const day = parseISODate(dateISO).getUTCDay();
  const slotForDay = slots.filter((s) => s.day_of_week === day);
  if (slotForDay.length === 0) return [];
  const busy = (occupied.get(dateISO) || []).slice().sort((a, b) => a.start - b.start);

  const windows = [];
  for (const slot of slotForDay) {
    let cursor = slot.start_minute;
    for (const b of busy) {
      if (b.end <= cursor || b.start >= slot.end_minute) continue;
      if (b.start > cursor) windows.push({ start: cursor, end: Math.min(b.start, slot.end_minute) });
      cursor = Math.max(cursor, b.end);
    }
    if (cursor < slot.end_minute) windows.push({ start: cursor, end: slot.end_minute });
  }
  return windows
    .filter((w) => w.end - w.start >= MIN_SESSION_MINUTES)
    .sort((a, b) => a.start - b.start);
}

function chunkDurations(totalMinutes) {
  const chunks = [];
  let remaining = Math.round(totalMinutes * 60);
  while (remaining > 0) {
    const take = Math.min(DEFAULT_SESSION_MINUTES, remaining);
    const leftover = remaining - take;
    if (take < MIN_SESSION_MINUTES && chunks.length > 0) {
      chunks[chunks.length - 1] += take;
    } else {
      chunks.push(take);
    }
    remaining = leftover;
  }
  return chunks;
}

function effectiveEffortMinutes(task, taskCompletedMinutes = 0) {
  const raw = Math.round(task.estimated_hours * 60);
  const difficultyFactor = 1 + (task.difficulty - 3) * 0.1;
  return Math.max(0, Math.round(raw * difficultyFactor) - taskCompletedMinutes);
}

function urgency(task, today) {
  const d = daysBetween(today, task.deadline);
  if (d < 0) return -1000;
  return d;
}

function orderTasks(tasks, today) {
  return tasks.slice().sort((a, b) => {
    const ua = urgency(a, today);
    const ub = urgency(b, today);
    if (ua !== ub) return ua - ub;
    const pa = PRIORITY_WEIGHT[a.priority];
    const pb = PRIORITY_WEIGHT[b.priority];
    if (pa !== pb) return pb - pa;
    if (a.difficulty !== b.difficulty) return b.difficulty - a.difficulty;
    return a.id - b.id;
  });
}

function isSlotInProductiveHours(windowStart, productiveHours) {
  if (!productiveHours || productiveHours.length === 0) return null;
  return productiveHours.includes(Math.floor(windowStart / 60));
}

function buildSchedule({ tasks, slots, existingSessions = [], productiveHours = null, today = null, horizonDays = 60 }) {
  const now = today || todayISO();
  const openTasks = tasks.filter(
    (t) => t.status === 'todo' || t.status === 'in_progress' || t.status === 'late'
  );
  const activeSlots = slots.filter((s) => s.end_minute > s.start_minute);

  const completedMinutesByTask = new Map();
  for (const s of existingSessions) {
    if (s.status !== 'completed' || !s.task_id) continue;
    const key = s.task_id;
    completedMinutesByTask.set(key, (completedMinutesByTask.get(key) || 0) + (s.end_minute - s.start_minute));
  }

  const occupied = busyIntervals(existingSessions);
  const planned = [];
  const atRisk = [];
  const unscheduled = [];

  const remainingByTask = new Map();
  for (const task of openTasks) {
    remainingByTask.set(task.id, effectiveEffortMinutes(task, completedMinutesByTask.get(task.id) || 0));
  }

  for (const task of orderTasks(openTasks, now)) {
    let remaining = remainingByTask.get(task.id) || 0;
    const lastDate = addDays(task.deadline, 1);
    const horizonEnd = addDays(now, horizonDays);
    let cursorDate = now;

    while (remaining > 0 && daysBetween(cursorDate, lastDate) > 0 && daysBetween(now, cursorDate) <= horizonDays) {
      const windows = freeWindowsWithCapacity(activeSlots, cursorDate, occupied);
      for (const win of windows) {
        if (remaining <= 0) break;
        const capacity = win.end - win.start;
        if (capacity < MIN_SESSION_MINUTES) continue;
        const boost = isSlotInProductiveHours(win.start, task.difficulty >= 4 ? productiveHours : null);
        if (remaining < MIN_SESSION_MINUTES && planned.length > 0 && planned[planned.length - 1].task_id === task.id) {
          planned[planned.length - 1].end_minute += remaining;
          remaining = 0;
          break;
        }
        const take = Math.min(capacity, remaining, DEFAULT_SESSION_MINUTES);
        const sessionId = `s-${task.id}-${cursorDate}-${win.start}`;
        planned.push({
          id: sessionId,
          task_id: task.id,
          course_id: task.course_id,
          kind: 'work',
          scheduled_date: cursorDate,
          start_minute: win.start,
          end_minute: win.start + take,
          status: 'planned',
          ml_boosted: boost === true ? 1 : 0,
        });
        occupied.set(cursorDate, [
          ...(occupied.get(cursorDate) || []),
          { start: win.start, end: win.start + take },
        ]);
        remaining -= take;
      }
      cursorDate = addDays(cursorDate, 1);
    }

    if (remaining > 0) {
      atRisk.push({ task_id: task.id, hoursShort: Math.round((remaining / 60) * 10) / 10 });
      if (daysBetween(now, task.deadline) <= 0) unscheduled.push(task.id);
    }
  }

  return {
    sessions: planned,
    atRisk,
    unscheduled,
    generated_at: new Date().toISOString(),
    today: now,
  };
}

function completionProfile(sessions) {
  const buckets = new Map();
  for (const s of sessions) {
    if (s.status !== 'completed' && s.status !== 'planned') continue;
    const dateStr = s.completed_at ? s.completed_at.slice(0, 10) : s.scheduled_date;
    const d = parseISODate(dateStr);
    const hourOfDay = Math.floor(s.start_minute / 60);
    const key = `${d.getUTCDay()}:${hourOfDay}`;
    const entry = buckets.get(key) || { day_of_week: d.getUTCDay(), hour: hourOfDay, completed: 0, total: 0 };
    entry.total += 1;
    if (s.status === 'completed') entry.completed += 1;
    buckets.set(key, entry);
  }
  return Array.from(buckets.values());
}

module.exports = {
  buildSchedule,
  chunkDurations,
  effectiveEffortMinutes,
  orderTasks,
  freeWindowsWithCapacity,
  busyIntervals,
  completionProfile,
  urgency,
  addDays,
  daysBetween,
  toMinutes,
  toHHmm,
  todayISO,
  DEFAULT_SESSION_MINUTES,
  MIN_SESSION_MINUTES,
  DAY_MINUTES,
};
