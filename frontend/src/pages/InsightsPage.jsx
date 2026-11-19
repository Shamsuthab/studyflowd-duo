import React, { useEffect, useState } from 'react';
import api from '../lib/api.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function InsightsPage() {
  const [insights, setInsights] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/insights').then(setInsights).catch((err) => setError(err.message));
  }, []);

  if (!insights) return <p className="muted">Loading insights...</p>;

  const maxTotal = Math.max(1, ...insights.activity.map((a) => a.plannedMinutes + a.completedMinutes));

  return (
    <div className="page">
      <h2>Insights</h2>
      {error && <div className="error-banner">{error}</div>}

      <div className="cards">
        <div className="card stat">
          <h3>Sessions completed</h3>
          <div className="big">{insights.completedSessions}</div>
          <p className="muted">of {insights.totalSessions} scheduled</p>
        </div>
        <div className="card stat">
          <h3>Completion rate</h3>
          <div className="big">{insights.completionRate}%</div>
          <p className="muted">planned sessions you finished</p>
        </div>
        <div className="card stat">
          <h3>Best study hours</h3>
          <div className="big">{insights.bestHoursLabel.join(' ')}</div>
          <p className="muted">
            {insights.productiveHours.source === 'ml' || insights.productiveHours.source === 'ml-cache'
              ? `learned from your activity (confidence ${Math.round(insights.productiveHours.confidence * 100)}%)`
              : insights.productiveHours.source}
          </p>
        </div>
      </div>

      <section className="card">
        <h3>Last 14 days</h3>
        {insights.activity.length === 0 && <p className="muted">No activity yet.</p>}
        <div className="bars">
          {insights.activity.map((a) => (
            <div key={a.day} className="bar-col" title={`${a.day}: ${a.completedMinutes} min completed / ${a.plannedMinutes} min planned`}>
              <div className="bar-stack" style={{ height: `${(a.completedMinutes / maxTotal) * 120}px` }} />
              <div className="bar-ghost" style={{ height: `${(a.plannedMinutes / maxTotal) * 120}px` }} />
              <span className="muted">{a.day.slice(5)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>When do you actually study?</h3>
        <p className="muted">Weekly pattern of completed sessions (darker = more completions).</p>
        <div className="heatmap">
          {Array.from({ length: 24 }, (_, hour) => (
            <div key={hour} className="heatmap-col">
              {DAYS.map((d, dow) => {
                const cell = insights.heatmap.find((h) => h.dayOfWeek === dow && h.hour === hour);
                const intensity = cell ? cell.completed / Math.max(1, cell.total) : 0;
                return (
                  <div
                    key={dow}
                    className="heatmap-cell"
                    style={{ background: cell ? `rgba(79, 124, 255, ${0.15 + intensity * 0.85})` : '#f4f6fb' }}
                    title={cell ? `${d} ${hour}:00 — ${cell.completed}/${cell.total} completed` : `${d} ${hour}:00`}
                  />
                );
              })}
              <span className="muted">{hour}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
