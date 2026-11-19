# StudyFlow — Smart Study Planner

StudyFlow helps university students plan study time, track assignment and exam deadlines,
and stay motivated. Students enter their courses, tasks and weekly free time slots, and a
rule-based scheduler automatically distributes tasks across available slots before each
deadline — taking priority, estimated effort and difficulty into account — and re-plans
whenever tasks are added/completed or slots change.

## Features

- **Courses, tasks & deadlines** — priority (high/medium/low), difficulty (1–5), type and estimated effort per task.
- **Weekly free-time slots** — recurring availability (e.g. Monday 09:00–12:00) that capacity is planned into.
- **Rule-based scheduler with automatic re-planning** — sessions are capped at 90 minutes, ordered by urgency → priority → difficulty, avoid double-booking, subtract already-completed work, and flag tasks that cannot fit before their deadline as *at risk*. Overdue tasks are marked *late*; every create/update/complete triggers a fresh plan.
- **Spaced repetition** — finishing a task schedules review sessions after 1, 3, 7 and 14 days (forgetting-curve intervals).
- **Motivation** — daily goal ring, study streaks, 8 achievement badges, weekly activity chart and completion-rate insights.
- **ML productivity model (optional service)** — a logistic-regression microservice (Python / scikit-learn) learns each student's most productive hours from logged sessions (completed vs. missed, by hour of day) and surfaces "best study hours" in the dashboard and insights.

## Architecture

```
studyflow/
├── backend/        Node.js + Express REST API, SQLite (better-sqlite3), Jest tests
│   └── src/
│       ├── app.js              app wiring + auth middleware
│       ├── auth.js             scrypt password hashing, bearer-token auth
│       ├── db.js               SQLite schema (users, courses, tasks, slots, sessions, badges, review_plans)
│       ├── scheduler.js        rule-based scheduling engine (pure, unit-tested)
│       ├── gamification.js     streaks, badges, daily goal, dashboard aggregation
│       ├── mlClient.js         ML microservice client with timeout + heuristic fallback
│       └── routes/             /auth, core CRUD, /schedule, /dashboard, /insights
├── ml-service/     Flask microservice: logistic regression over hour-of-day (sin/cos features)
│   └── app.py                    learns completion probability per hour → best_hours prediction
└── frontend/       React 18 + Vite SPA (hash routing)
    └── src/pages/  Dashboard, Courses, Tasks, Schedule (week board), Reviews, Insights
```

### REST API (selected)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register`, `/api/auth/login` | token auth |
| GET/POST | `/api/courses` | list/create courses |
| GET/POST/PUT/DELETE | `/api/tasks`, `/api/tasks/:id/status` | task lifecycle (each write re-plans) |
| GET/POST | `/api/slots` | weekly free-time slots |
| GET | `/api/schedule` | planned + completed sessions |
| POST | `/api/schedule/regenerate` | force re-plan |
| PATCH | `/api/sessions/:id` | complete/miss a session (auto task completion, review creation, re-plan) |
| GET | `/api/reviews`, POST `/api/reviews/:id/complete` | spaced-repetition plan |
| GET | `/api/dashboard`, `/api/insights`, `/api/badges` | streaks, goals, badges, ML hours, activity |

### Scheduling algorithm

1. Enumerate upcoming free windows from weekly slots minus already occupied sessions.
2. Order open tasks by urgency (days to deadline), then priority, then difficulty (hardest first).
3. Fill the earliest windows with ≤90-minute sessions until the task's remaining effort
   (`estimated_hours × difficulty factor` minus already-completed minutes) is covered, always
   stopping at the deadline day.
4. Report tasks whose effort cannot fit before the deadline as `atRisk`.
5. Re-run on every task/slot/session mutation; missed sessions are tracked, late tasks flagged.

## Getting started

```bash
cd backend && npm install && npm start          # API on http://127.0.0.1:4000
cd ml-service && pip install -r requirements.txt && python app.py   # ML on http://127.0.0.1:5001
cd frontend && npm install && npm run dev       # SPA on http://127.0.0.1:5173 (proxies /api)
```

Optional environment variables:
`PORT` (API, default 4000), `STUDYFLOW_DB` (SQLite path), `ML_SERVICE_URL` (default `http://127.0.0.1:5001`),
`VITE_API_URL` (frontend, default `/api`).

## Tests

```bash
cd backend && npm test            # scheduler unit tests + full REST API integration tests
cd ml-service && python -m unittest test_ml.py -v
```

## Tech keywords

study planner · task scheduling · deadline tracking · spaced repetition · machine learning · scikit-learn · REST API · SQL (SQLite) · React · local notifications · student motivation
