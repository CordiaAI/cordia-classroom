import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))
os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_KEY", "test")

from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient

import main
from rate_limit import ai_rate_limit


class CorsOriginTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def allowed(self, origin):
        response = self.client.options("/", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
        return response.headers.get("access-control-allow-origin") == origin

    def test_own_origins_are_allowed(self):
        self.assertTrue(self.allowed("https://classroom.cordiaai.io"))
        self.assertTrue(self.allowed("chrome-extension://eddmfjcnfjfbaknmeccjbjdgpeipjbaf"))
        self.assertTrue(self.allowed("https://cordia-classroom-git-main-itzjlaughs-projects.vercel.app"))
        self.assertTrue(self.allowed("https://cordia-classroom.vercel.app"))

    def test_other_extensions_and_vercel_apps_are_refused(self):
        self.assertFalse(self.allowed("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
        self.assertFalse(self.allowed("https://evil.vercel.app"))
        self.assertFalse(self.allowed("https://cordia-classroom-git-x-someone-else.vercel.app"))


class AiRateLimitTests(unittest.TestCase):
    def test_limit_is_per_student_and_returns_429(self):
        app = FastAPI()

        @app.post("/spend", dependencies=[Depends(ai_rate_limit(max_calls=2, window_seconds=60))])
        def spend():
            return {"ok": True}

        client = TestClient(app)
        alice = {"Authorization": "Bearer alice"}
        self.assertEqual(client.post("/spend", headers=alice).status_code, 200)
        self.assertEqual(client.post("/spend", headers=alice).status_code, 200)
        blocked = client.post("/spend", headers=alice)
        self.assertEqual(blocked.status_code, 429)
        self.assertIn("Too many requests", blocked.json()["detail"])
        self.assertEqual(client.post("/spend", headers={"Authorization": "Bearer bob"}).status_code, 200)


if __name__ == "__main__":
    unittest.main()
