import React, { useEffect, useState } from 'react';
import api from '../lib/api.js';

export default function CoursesPage() {
  const [courses, setCourses] = useState([]);
  const [form, setForm] = useState({ name: '', color: '#4f7cff', credits: 0 });
  const [error, setError] = useState('');

  async function load() {
    setCourses(await api('/courses'));
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  async function addCourse(e) {
    e.preventDefault();
    try {
      await api('/courses', { method: 'POST', body: form });
      setForm({ name: '', color: '#4f7cff', credits: 0 });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    if (!confirm('Delete this course and its tasks?')) return;
    try {
      await api(`/courses/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <h2>Courses</h2>
      <form className="row-form card" onSubmit={addCourse}>
        <input placeholder="Course name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
        <input type="number" min="0" max="30" value={form.credits} onChange={(e) => setForm({ ...form, credits: Number(e.target.value) })} />
        <button className="primary">Add course</button>
      </form>
      {error && <div className="error-banner">{error}</div>}
      <div className="cards">
        {courses.map((c) => (
          <div key={c.id} className="card course-card" style={{ borderTopColor: c.color }}>
            <h3>{c.name}</h3>
            <p className="muted">{c.openTasks} open task{c.openTasks === 1 ? '' : 's'} · {c.credits} credits</p>
            <button className="small danger" onClick={() => remove(c.id)}>Delete</button>
          </div>
        ))}
        {courses.length === 0 && <p className="muted">Add your first course above.</p>}
      </div>
    </div>
  );
}
