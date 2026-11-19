import React, { useEffect, useState } from 'react';
import api from '../lib/api.js';
import { prettyDate, duration, PRIORITY_LABELS, todayISO } from '../lib/format.js';

const TYPES = ['assignment', 'essay', 'exam', 'reading', 'project'];

export default function TasksPage() {
  const [tasks, setTasks] = useState([]);
  const [courses, setCourses] = useState([]);
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    course_id: '', title: '', type: 'assignment', priority: 2, difficulty: 3, estimated_hours: 2, deadline: todayISO(),
  });

  async function load() {
    const [t, c] = await Promise.all([api('/tasks'), api('/courses')]);
    setTasks(t);
    setCourses(c);
    if (!form.course_id && c.length > 0) setForm((f) => ({ ...f, course_id: c[0].id }));
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  async function addTask(e) {
    e.preventDefault();
    try {
      await api('/tasks', { method: 'POST', body: form });
      setShow(false);
      setForm((f) => ({ ...f, title: '' }));
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function setStatus(id, status) {
    try {
      await api(`/tasks/${id}/status`, { method: 'PATCH', body: { status } });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    if (!confirm('Delete this task?')) return;
    try {
      await api(`/tasks/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Tasks &amp; deadlines</h2>
        <button className="primary" onClick={() => setShow(!show)}>{show ? 'Close' : '+ New task'}</button>
      </div>
      {show && (
        <form className="card grid-form" onSubmit={addTask}>
          <label>Course
            <select value={form.course_id} onChange={(e) => setForm({ ...form, course_id: e.target.value })} required>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Title
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="e.g. Problem set 3" />
          </label>
          <label>Type
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>Priority
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}>
              <option value={1}>High</option>
              <option value={2}>Medium</option>
              <option value={3}>Low</option>
            </select>
          </label>
          <label>Difficulty (1-5)
            <input type="number" min="1" max="5" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })} />
          </label>
          <label>Estimated hours
            <input type="number" step="0.5" min="0.5" value={form.estimated_hours} onChange={(e) => setForm({ ...form, estimated_hours: Number(e.target.value) })} />
          </label>
          <label>Deadline
            <input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} required />
          </label>
          <button className="primary">Save &amp; auto-plan</button>
        </form>
      )}
      {error && <div className="error-banner">{error}</div>}
      <table className="table card">
        <thead>
          <tr><th>Task</th><th>Course</th><th>Deadline</th><th>Priority</th><th>Effort</th><th>Progress</th><th></th></tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className={t.status === 'done' ? 'row-done' : t.status === 'late' ? 'row-late' : ''}>
              <td>{t.title}{t.status === 'late' && <span className="pill late">late</span>}{t.status === 'done' && <span className="pill done">done</span>}</td>
              <td><span className="dot" style={{ background: t.course_color }} /> {t.course_name}</td>
              <td>{prettyDate(t.deadline)}</td>
              <td>{PRIORITY_LABELS[t.priority]}</td>
              <td>{duration(Math.round(t.estimated_hours * 60))}</td>
              <td>{duration(Math.round(t.completed_minutes || 0))} done</td>
              <td className="row-actions">
                {t.status !== 'done' && <button className="small" onClick={() => setStatus(t.id, 'done')}>Complete</button>}
                {t.status === 'done' && <button className="small" onClick={() => setStatus(t.id, 'todo')}>Reopen</button>}
                <button className="small danger" onClick={() => remove(t.id)}>✕</button>
              </td>
            </tr>
          ))}
          {tasks.length === 0 && <tr><td colSpan="7" className="muted">No tasks yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
