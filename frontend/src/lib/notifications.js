export function requestPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

export function notify(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

export function remindersFor(sessions) {
  const due = [];
  const now = Date.now();
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  for (const s of sessions) {
    if (s.status !== 'planned') continue;
    const t = new Date(`${s.scheduled_date}T00:00:00`);
    t.setMinutes(0, s.start_minute, 0);
    const minutesUntil = (t - now) / 60000;
    if (minutesUntil > 0 && minutesUntil <= 15) due.push(s);
  }
  return due;
}
