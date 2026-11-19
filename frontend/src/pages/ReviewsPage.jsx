import React, { useEffect, useState } from 'react';
import api from '../lib/api.js';
import { prettyDate } from '../lib/format.js';

const INTERVAL_LABEL = { 1: '1 day', 3: '3 days', 7: '1 week', 14: '2 weeks' };

export default function ReviewsPage() {
  const [reviews, setReviews] = useState([]);
  const [error, setError] = useState('');

  async function load() {
    setReviews(await api('/reviews'));
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  async function complete(id) {
    try {
      await api(`/reviews/${id}/complete`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <h2>Spaced repetition reviews</h2>
      <p className="muted">After you finish a task, StudyFlow schedules memory-boosting reviews 1, 3, 7 and 14 days later.</p>
      {error && <div className="error-banner">{error}</div>}
      <table className="table card">
        <thead><tr><th>Task</th><th>Course</th><th>Review after</th><th>Due</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {reviews.map((r) => (
            <tr key={r.id}>
              <td>{r.task_title}</td>
              <td>{r.course_name}</td>
              <td>+{INTERVAL_LABEL[r.interval_days] || `${r.interval_days} days`}</td>
              <td>{prettyDate(r.due_date)}</td>
              <td><span className={`pill ${r.status === 'done' ? 'done' : r.due_date <= new Date().toISOString().slice(0, 10) ? 'due' : ''}`}>{r.status}</span></td>
              <td>{r.status === 'planned' && <button className="small" onClick={() => complete(r.id)}>Reviewed</button>}</td>
            </tr>
          ))}
          {reviews.length === 0 && <tr><td colSpan="6" className="muted">Complete a task to start the review cycle.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
