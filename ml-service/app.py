"""StudyFlow ML microservice.

Learns the student's most productive study hours from logged activity and
predicts which hours of the day have the highest completion probability.

Model: logistic regression over hour-of-day (with sin/cos features) where the
target is whether the session was completed. Trained lazily on request and cached with the session
signature so repeated identical payloads skip retraining.
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import numpy as np
from sklearn.linear_model import LogisticRegression

app = Flask(__name__)
CORS(app)

MODEL_CACHE = {"signature": None, "model": None, "confidence": 0.0, "best_hours": []}


def train_model(sessions):
    hours = []
    targets = []
    for s in sessions:
        try:
            hour = float(s.get("hour", 0))
            completed = bool(s.get("completed", False))
        except (TypeError, ValueError):
            continue
        if not (0 <= hour <= 23):
            continue
        hours.append(hour)
        targets.append(1 if completed else 0)

    if len(hours) < 8 or len(set(targets)) < 2:
        return None, 0.0, []

    xs = np.array(hours, dtype=float)
    ys = np.array(targets, dtype=float)
    model = LogisticRegression(max_iter=500, C=1.0)
    model.fit(build_features(xs), ys)

    grid = np.array(sorted(set(int(h) for h in hours)), dtype=float)
    probs = model.predict_proba(build_features(grid))[:, 1]
    order = np.argsort(probs)[::-1]
    best = [int(grid[i]) for i in order if probs[i] > 0.5][:3]
    confidence = round(float(max(probs)), 3) if best else 0.0
    return model, confidence, best


def build_features(hours):
    hours = np.asarray(hours, dtype=float)
    return np.column_stack([hours, np.sin(hours / 24 * 2 * np.pi), np.cos(hours / 24 * 2 * np.pi)])


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "studyflow-ml"})


@app.post("/predict")
def predict():
    payload = request.get_json(silent=True) or {}
    sessions = payload.get("sessions") or []
    if not isinstance(sessions, list) or len(sessions) < 5:
        return jsonify({"best_hours": [18, 19, 20], "confidence": 0.0, "source": "default"})

    signature = (len(sessions), tuple(sorted((s.get("day_of_week", 0), s.get("hour", 0), bool(s.get("completed")))) for s in sessions)[:64])
    if MODEL_CACHE["signature"] == signature and MODEL_CACHE["best_hours"]:
        return jsonify(
            {
                "best_hours": MODEL_CACHE["best_hours"],
                "confidence": MODEL_CACHE["confidence"],
                "source": "ml-cache",
            }
        )

    model, confidence, best = train_model(sessions)
    if model is None:
        return jsonify({"best_hours": [18, 19, 20], "confidence": 0.0, "source": "cold-start"}), 200

    MODEL_CACHE.update({"signature": signature, "model": model, "confidence": confidence, "best_hours": best})
    return jsonify({"best_hours": best, "confidence": confidence, "source": "ml"})


if __name__ == "__main__":
    import os

    app.run(host="127.0.0.1", port=int(os.environ.get("ML_PORT", "5001")))
