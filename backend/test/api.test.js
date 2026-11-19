const request = require('supertest');
const os = require('os');
const path = require('path');
const fs = require('fs');

let dbModule;
let createApp;
let app;

beforeAll(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-test-'));
  process.env.STUDYFLOW_DB = path.join(tmp, 'test.db');
  jest.resetModules();
  dbModule = require('../src/db');
  createApp = require('../src/app').createApp;
  dbModule.init();
  app = createApp();
});

afterAll(() => {
  dbModule.DB_PATH && fs.rmSync(path.dirname(dbModule.DB_PATH), { recursive: true, force: true });
});

async function register(name) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email: `${name}@example.com`, name, password: 'secret123' });
  return res.body.token;
}

describe('auth', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/courses');
    expect(res.status).toBe(401);
  });

  it('registers and logs in', async () => {
    const token = await register('alice');
    expect(token).toBeDefined();
    const login = await request(app).post('/api/auth/login').send({ email: 'alice@example.com', password: 'secret123' });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeDefined();
  });

  it('rejects wrong passwords and duplicate emails', async () => {
    const bad = await request(app).post('/api/auth/login').send({ email: 'alice@example.com', password: 'nope' });
    expect(bad.status).toBe(401);
    const dup = await request(app).post('/api/auth/register').send({ email: 'alice@example.com', name: 'A2', password: 'secret123' });
    expect(dup.status).toBe(409);
  });
});

describe('courses, slots and tasks', () => {
  let token;

  beforeAll(async () => {
    token = await register('bob');
  });

  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  it('creates a course', async () => {
    const res = await request(app).post('/api/courses').set(auth(token)).send({ name: 'Algorithms', color: '#ff8800' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Algorithms');
  });

  it('rejects a course without a name', async () => {
    const res = await request(app).post('/api/courses').set(auth(token)).send({});
    expect(res.status).toBe(400);
  });

  it('adds weekly free slots', async () => {
    const res = await request(app).post('/api/slots').set(auth(token)).send({ day_of_week: 1, start_minute: 540, end_minute: 720, label: 'Library' });
    expect(res.status).toBe(201);
    const bad = await request(app).post('/api/slots').set(auth(token)).send({ day_of_week: 1, start_minute: 600, end_minute: 610 });
    expect(bad.status).toBe(400);
  });

  it('creates a task and auto-plans sessions into free slots', async () => {
    const courseRes = await request(app).get('/api/courses').set(auth(token));
    const courseId = courseRes.body[0].id;
    const res = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ course_id: courseId, title: 'Problem set 1', estimated_hours: 2, deadline: '2030-06-10', priority: 2, difficulty: 3 });
    expect(res.status).toBe(201);

    const schedule = await request(app).get('/api/schedule').set(auth(token));
    expect(schedule.body.sessions.length).toBeGreaterThan(0);
    for (const s of schedule.body.sessions) {
      expect(String(s.scheduled_date) < '2030-06-10').toBe(true);
      expect(s.status).toBe('planned');
    }
  });

  it('rejects invalid task payloads', async () => {
    const res = await request(app).post('/api/tasks').set(auth(token)).send({ course_id: 9999, title: 'x', deadline: 'nope' });
    expect(res.status).toBe(400);
  });

  it('completing all planned sessions completes the task and creates a review plan', async () => {
    let schedule = await request(app).get('/api/schedule').set(auth(token));
    let planned = schedule.body.sessions.filter((s) => s.status === 'planned');
    expect(planned.length).toBeGreaterThan(0);
    while (planned.length > 0) {
      for (const s of planned) {
        const done = await request(app).patch(`/api/sessions/${s.id}`).set(auth(token)).send({ status: 'completed' });
        expect(done.status).toBe(200);
        break;
      }
      schedule = await request(app).get('/api/schedule').set(auth(token));
      planned = schedule.body.sessions.filter((s) => s.status === 'planned');
    }
    const tasks = await request(app).get('/api/tasks').set(auth(token));
    expect(tasks.body.every((t) => t.status === 'done')).toBe(true);

    const reviews = await request(app).get('/api/reviews').set(auth(token));
    expect(reviews.body.length).toBe(4);
    expect(reviews.body.map((r) => r.interval_days).sort((a, b) => a - b)).toEqual([1, 3, 7, 14]);
  });
});

describe('dashboard, insights and gamification', () => {
  let token;

  beforeAll(async () => {
    token = await register('carol');
    await request(app).post('/api/courses').set({ Authorization: `Bearer ${token}` }).send({ name: 'Databases' });
    const courses = await request(app).get('/api/courses').set({ Authorization: `Bearer ${token}` });
    await request(app)
      .post('/api/tasks')
      .set({ Authorization: `Bearer ${token}` })
      .send({ course_id: courses.body[0].id, title: 'ER modelling', estimated_hours: 1.5, deadline: '2030-07-01', priority: 1, difficulty: 4 });
  });

  it('returns a dashboard with goals, streak, badges and productive hours fallback', async () => {
    const res = await request(app).get('/api/dashboard').set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(res.body.dailyGoal.goalMinutes).toBeGreaterThan(0);
    expect(res.body.streakDays).toBe(0);
    expect(res.body.badges.length).toBeGreaterThan(0);
    expect(res.body.productiveHours.bestHours.length).toBeGreaterThan(0);
  });

  it('lists badges with earned flags', async () => {
    const res = await request(app).get('/api/badges').set({ Authorization: `Bearer ${token}` });
    expect(res.body.some((b) => b.code === 'first_session' && !b.earned)).toBe(true);
  });

  it('insights expose ML fields', async () => {
    const res = await request(app).get('/api/insights').set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('productiveHours');
    expect(res.body).toHaveProperty('completionRate');
  });

  it('updates daily goal', async () => {
    const res = await request(app).put('/api/me').set({ Authorization: `Bearer ${token}` }).send({ daily_goal_minutes: 45 });
    expect(res.body.daily_goal_minutes).toBe(45);
  });
});
