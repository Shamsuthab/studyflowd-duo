import React, { useEffect, useState } from 'react';
import api from '../lib/api.js';
import { minutesToHHMM, duration, prettyDate, PRIORITY_LABELS } from '../lib/format.js';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [enabled, setEnabled] = useState([]);

  async function load() {
    try {
      setData(await api('/dashboard'));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (!data) return <p className="muted">Loading dashboard...</p>;

  const pct = data.dailyGoal.percent;

  return (
    <div className="dashboard">
      <div className="cards">
        <div className="card stat">
          <h3>Today's goal</h3>
          <div className="ring" style={{ '--pct': `${pct}%` }}>
            <span>{duration(data.dailyGoal.completedMinutes)}</span>
          </div>
          <p className="muted">of {duration(data.dailyGoal.goalMinutes)} goal</p>
        </div>
        <div className="card stat">
          <h3>Study streak</h3>
          <div className="big">{data.streakDays} 🔥</div>
          <p className="muted">consecutive days</p>
        </div>
        <div className="card stat">
          <h3>Reviews due</h3>
          <div className="big">{data.reviewsDue}</div>
          <p className="muted">spaced-repetition sessions</p>
        </div>
        <div className="card stat">
          <h3>Best study hours</h3>
          <div className="big">{data.productiveHours.bestHours.map(minutesToHHMM).join(' ')}</div>
          <p className="muted">
            {data.productiveHours.source === 'ml'
              ? `predicted from your habits (${Math.round(data.productiveHours.confidence * 100)}% completion)`
              : 'complete sessions to unlock predictions'}
          </p>
        </div>
      </div>

      <div className="two-col">
        <section className="card">
          <h3>Today's plan</h3>
          {data.todaySessions.length === 0 && <p className="muted">Nothing planned today — add free slots and tasks to generate a schedule.</p>}
          <ul className="session-list">
            {data.todaySessions.map((s) => (
              <li key={s.id} style={{ borderLeftColor: s.course_color || '#4f7cff' }}>
                <div className="session-time">
                  {minutesToHHMM(s.start_minute)} – {minutesToHHMM(s.end_minute)}
                </div>
                <div className="session-title">
                  {s.kind === 'review' ? '🔁 Review: ' : ''}
                  {s.task_title || 'Free study'}
                </div>
                <div className="muted">{s.course_name}</div>
                {s.status === 'completed' ? (
                  <span className="pill done">done</span>
                ) : (
                  <button className="small" onClick={async () => { await api(`/sessions/${s.id}`, { method: 'PATCH', body: { status: 'completed' } }); await load(); }}>
                    Mark done
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <div>
          <section className="card">
            <h3>Upcoming deadlines</h3>
            {data.upcomingDeadlines.length === 0 && <p className="muted">No open tasks yet.</p>}
            <ul className="deadline-list">
              {data.upcomingDeadlines.map((t) => (
                <li key={t.id}>
                  <span className="dot" style={{ background: t.course_color }} />
                  <div>
                    <div>{t.title}</div>
                    <div className="muted">
                      {t.course_name} · deadline {prettyDate(t.deadline)} · {PRIORITY_LABELS[t.priority]} priority
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h3>Badges</h3>
            <div className="badges">
              {data.badges.map((b) => (
                <div key={b.code} className={`badge ${b.earned ? 'earned' : ''}`} title={b.description}>
                  {b.earned ? '🏆' : '🔒'} {b.name}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
