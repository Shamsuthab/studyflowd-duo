import React, { useState } from 'react';
import api, { setToken } from '../lib/api.js';

export default function LoginPage({ onSuccess }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', name: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function update(field) {
    return (e) => setForm({ ...form, [field]: e.target.value });
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api(`/auth/${mode}`, { method: 'POST', body: form });
      setToken(res.token);
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <h1>StudyFlow</h1>
        <p>Plan smarter. Study consistently. Stay motivated.</p>
        {mode === 'register' && (
          <label>
            Name
            <input value={form.name} onChange={update('name')} required placeholder="Your name" />
          </label>
        )}
        <label>
          Email
          <input type="email" value={form.email} onChange={update('email')} required placeholder="you@university.edu" />
        </label>
        <label>
          Password
          <input type="password" value={form.password} onChange={update('password')} required minLength={6} placeholder="At least 6 characters" />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <button className="primary" disabled={busy}>
          {busy ? 'Working...' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <button className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'New here? Create an account' : 'Already registered? Sign in'}
        </button>
      </form>
    </div>
  );
}
