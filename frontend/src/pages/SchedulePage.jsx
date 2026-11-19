import React, { useEffect, useState } from 'react';
import api from '../lib/api.js';
import { minutesToHHMM, dayName, todayISO, addDaysISO, weekStart, duration, prettyDate } from '../lib/format.js';

export default function SchedulePage() {
  const [sessions, setSessions] = useState([]);
  const [slots, setSlots] = useState([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [error, setError] = useState('');
  const [slotForm, setSlotForm] = useState({ day_of_week: 1, start: '18:00', end: '20:00', label: '' });

  async function load() {
    const [s, sl] = await Promise.all([api('/insights'), api('/slots')]);
    setSessions(s);
    setSlots(sl);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  async function addSlot(e) {
    e.preventDefault();
    try {
      await api('/slots', {
        method: 'POST',
        body: {
          day_of_week: Number(slotForm.day_of_week),
          start_minute: Number(slotForm.start.split(':')[0]) * 60 + Number(slotForm.start.split(':')[1]),
          end_minute: Number(slotForm.end.split(':')[0]) * 60 + Number(slotForm.end.split(':')[1]),
          label: slotForm.label,
        },
      });
      setSlotForm({ ...slotForm, label: '' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeSlot(id) {
    try {
      await api(`/slots/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function regenerate() {
    try {
      await api('/schedule/regenerate', { method: 'POST' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function complete(id) {
    try {
      await api(`/sessions/${id}`, { method: 'PATCH', body: { status: 'completed' } });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const start = addDaysISO(weekStart(todayISO()), weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(start, i));
  const byDay = {};
  for (const s of sessions) {
    if (!byDay[s.scheduled_date]) byDay[s.scheduled_date] = [];
    byDay[s.scheduled_date].push(s);
  }
  const slotsByDay = {};
  for (const s of slots) {
    if (!slotsByDay[s.day_of_week]) slotsByDay[s.day_of_week] = [];
    slotsByDay[s.day_of_week].push(s);
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Schedule</h2>
        <div className="head-actions">
          <button className="small" onClick={() => setWeekOffset(weekOffset - 1)}>‹ Prev week</button>
          <button className="small" onClick={() => setWeekOffset(0)}>This week</button>
          <button className="small" onClick={() => setWeekOffset(weekOffset + 1)}>Next week ›</button>
          <button className="primary" onClick={regenerate}>Re-plan now</button>
        </div>
      </div>

      <form className="row-form card" onSubmit={addSlot}>
        <select value={slotForm.day_of_week} onChange={(e) => setSlotForm({ ...slotForm, day_of_week: e.target.value })}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => <option key={i} value={i}>{d}</option>)}
        </select>
        <input type="time" value={slotForm.start} onChange={(e) => setSlotForm({ ...slotForm, start: e.target.value })} required />
        <input type="time" value={slotForm.end} onChange={(e) => setSlotForm({ ...slotForm, end: e.target.value })} required />
        <input placeholder="Label (optional)" value={slotForm.label} onChange={(e) => setSlotForm({ ...slotForm, label: e.target.value })} />
        <button className="primary">Add free time</button>
      </form>

      {error && <div className="error-banner">{error}</div>}

      <div className="board">
        {days.map((d) => (
          <div key={d} className={`board-day ${d === todayISO() ? 'today' : ''}`}>
            <div className="board-day-head">{prettyDate(d)}</div>
            {(slotsByDay[new Date(`${d}T00:00:00Z`).getUTCDay()] || []).map((sl) => (
              <div key={sl.id} className="free-slot" title="Recurring free time">
                🕐 {minutesToHHMM(sl.start_minute)} – {minutesToHHMM(sl.end_minute)} {sl.label}
              </div>
            ))}
            {(byDay[d] || []).map((s) => (
              <div key={s.id} className={`session ${s.status}`} style={{ borderLeftColor: s.course_color || '#4f7cff' }}>
                <div className="session-time">{minutesToHHMM(s.start_minute)} – {minutesToHHMM(s.end_minute)} ({duration(s.end_minute - s.start_minute)})</div>
                <div>{s.kind === 'review' ? '🔁 ' : ''}{s.task_title}</div>
                <div className="muted">{s.course_name}{s.mlBoosted ? ' · ⚡ best hours' : ''}</div>
                {s.status === 'planned' && (
                  <button className="small" onClick={() => complete(s.id)}>Done</button>
                )}
                {s.status === 'completed' && <span className="pill done">done</span>}
                {s.status === 'missed' && <span className="pill late">missed</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
