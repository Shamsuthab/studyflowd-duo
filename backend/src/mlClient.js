const ML_URL = process.env.ML_SERVICE_URL || 'http://127.0.0.1:5001';

async function predictProductiveHours(sessions, fallback = null) {
  if (!sessions || sessions.length < 5) {
    return { bestHours: fallback || [18, 19, 20], confidence: 0, source: 'default' };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${ML_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessions }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`ML service returned ${res.status}`);
    const data = await res.json();
    return { bestHours: data.best_hours || [], confidence: data.confidence ?? 0, source: 'ml' };
  } catch (err) {
    return {
      bestHours: fallback || [18, 19, 20],
      confidence: 0,
      source: 'fallback',
      reason: err.message,
    };
  }
}

module.exports = { predictProductiveHours, ML_URL };
