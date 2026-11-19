import unittest

import app as ml


class NoonTestCase(unittest.TestCase):
    def learn_and_predict(self, hours_complete, hours_missing, reps=3):
        sessions = []
        for day in range(7):
            for hour in hours_complete + hours_missing:
                for _ in range(reps):
                    sessions.append(
                        {"day_of_week": day, "hour": hour, "completed": hour in hours_complete}
                    )
        return ml.train_model(sessions)

    def test_empty_payload_returns_default(self):
        self.assertIsNone(ml.train_model([{"day_of_week": 0, "hour": 9, "completed": False}])[0])
        self.assertIsNone(
            ml.train_model(
                [{"day_of_week": d, "hour": 9, "completed": d % 2 == 0} for d in range(7)]
            )[0]
        )

    def test_evening_learner_gets_evening_hours(self):
        model, confidence, best = self.learn_and_predict([18, 19, 21], [8, 9, 10])
        self.assertIsNotNone(model)
        self.assertEqual(sorted(best), [18, 19, 21])
        self.assertGreaterEqual(confidence, 0.5)

    def test_morning_learner_gets_morning_hours(self):
        model, confidence, best = self.learn_and_predict([7, 8, 9], [15, 20, 22])
        self.assertEqual(sorted(best), [7, 8, 9])
        self.assertGreaterEqual(confidence, 0.5)

    def test_predict_endpoint(self):
        ml.app.config["TESTING"] = True
        client = ml.app.test_client()
        default = client.post("/predict", json={"sessions": []})
        self.assertEqual(default.status_code, 200)
        self.assertEqual(default.get_json()["source"], "default")

        sessions = [
            {"day_of_week": d, "hour": hour, "completed": hour >= 19}
            for d in range(7)
            for hour in [9, 16, 20]
            for _ in range(3)
        ]
        learned = client.post("/predict", json={"sessions": sessions})
        self.assertEqual(learned.status_code, 200)
        body = learned.get_json()
        self.assertIn(20, body["best_hours"])
        self.assertTrue(set(body["best_hours"]).issubset({9, 16, 20}))

    def test_health(self):
        client = ml.app.test_client()
        self.assertEqual(client.get("/health").status_code, 200)


if __name__ == "__main__":
    unittest.main()
