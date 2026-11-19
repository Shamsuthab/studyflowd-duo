const express = require('express');
const cors = require('cors');
const dbModule = require('./db');
const { authMiddleware } = require('./auth');
const authRoutes = require('./routes/auth');
const coreRoutes = require('./routes/core');
const scheduleRoutes = require('./routes/schedule');
const insightsRoutes = require('./routes/insights');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'studyflow-api' }));

  app.use('/api/auth', authRoutes);
  app.use('/api', scheduleRoutes.router);
  app.use('/api', coreRoutes);
  app.use('/api', authMiddleware, insightsRoutes);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
