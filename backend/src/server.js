const dbModule = require('./db');
const { createApp } = require('./app');

const PORT = process.env.PORT || 4000;

dbModule.init();
const app = createApp();

app.listen(PORT, () => {
  console.log(`StudyFlow API listening on http://127.0.0.1:${PORT}`);
});
