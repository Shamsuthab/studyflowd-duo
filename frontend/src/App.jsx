import React, { useEffect, useState } from 'react';
import api, { setToken, getToken } from './lib/api.js';
import { requestPermission, notify, remindersFor } from './lib/notifications.js';
import LoginPage from './pages/LoginPage.jsx';
import Dashboard from './pages/Dashboard.jsx';
import CoursesPage from './pages/CoursesPage.jsx';
import TasksPage from './pages/TasksPage.jsx';
import SchedulePage from './pages/SchedulePage.jsx';
import ReviewsPage from './pages/ReviewsPage.jsx';
import InsightsPage from './pages/InsightsPage.jsx';

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'courses', label: 'Courses' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'insights', label: 'Insights' },
];

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [tab, setTab] = useState('dashboard');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authed) return;
    requestPermission();
    const timer = setInterval(async () => {
      try {
        const sessions = await api('/schedule');
        const due = remindersFor(sessions.sessions);
        for (const s of due) {
          notify('Study session starting soon', `${s.task_title || 'Study session'} at ${s.start_minute}`);
        }
      } catch (err) {
        setError(err.message);
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [authed]);

  if (!authed) {
    return (
      <LoginPage
        onSuccess={() => {
          setAuthed(true);
          setTab('dashboard');
        }}
      />
    );
  }

  async function logout() {
    setToken(null);
    setAuthed(false);
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">StudyFlow</span>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <button className="link" onClick={logout}>
          Log out
        </button>
      </header>
      {error && (
        <div className="error-banner" onClick={() => setError('')}>
          {error}
        </div>
      )}
      <main className="content">
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'courses' && <CoursesPage onChanged={() => {}} />}
        {tab === 'tasks' && <TasksPage onChanged={() => {}} />}
        {tab === 'schedule' && <SchedulePage onChanged={() => {}} />}
        {tab === 'reviews' && <ReviewsPage />}
        {tab === 'insights' && <InsightsPage />}
      </main>
    </div>
  );
}
