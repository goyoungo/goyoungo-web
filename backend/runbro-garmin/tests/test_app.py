from __future__ import annotations

import gzip
import importlib.util
import io
import json
import os
import sys
import unittest
from pathlib import Path
from typing import Any


APP_PATH = Path(__file__).resolve().parents[1] / "app.py"
os.environ.update(
    {
        "RUNBRO_GARMIN_BUCKET": "test-runbro-garmin",
        "RUNBRO_TOKEN_KEY_ID": "arn:aws:kms:test:key/runbro",
        "KAKAO_APP_ID": "1470643",
        "USER_HMAC_SECRET": "test-secret-that-is-longer-than-thirty-two-bytes",
    }
)
SPEC = importlib.util.spec_from_file_location("runbro_garmin_app", APP_PATH)
assert SPEC and SPEC.loader
app = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = app
SPEC.loader.exec_module(app)


class FakeClientError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


class FakeS3:
    def __init__(self) -> None:
        self.objects: dict[str, dict[str, Any]] = {}
        self.put_calls: list[dict[str, Any]] = []

    def put_object(self, **kwargs: Any) -> dict[str, Any]:
        key = kwargs["Key"]
        if kwargs.get("IfNoneMatch") == "*" and key in self.objects:
            raise FakeClientError("PreconditionFailed")
        self.put_calls.append(dict(kwargs))
        self.objects[key] = {
            "Body": bytes(kwargs["Body"]),
            "ContentEncoding": kwargs.get("ContentEncoding"),
            "Tagging": kwargs.get("Tagging"),
        }
        return {"ETag": '"fake"'}

    def get_object(self, **kwargs: Any) -> dict[str, Any]:
        key = kwargs["Key"]
        if key not in self.objects:
            raise FakeClientError("NoSuchKey")
        stored = self.objects[key]
        return {
            "Body": io.BytesIO(stored["Body"]),
            "ContentEncoding": stored.get("ContentEncoding"),
        }

    def delete_object(self, **kwargs: Any) -> dict[str, Any]:
        self.objects.pop(kwargs["Key"], None)
        return {}

    def list_object_versions(self, **kwargs: Any) -> dict[str, Any]:
        prefix = kwargs["Prefix"]
        return {
            "Versions": [
                {"Key": key, "VersionId": "1"}
                for key in self.objects
                if key.startswith(prefix)
            ],
            "DeleteMarkers": [],
            "IsTruncated": False,
        }

    def list_objects_v2(self, **kwargs: Any) -> dict[str, Any]:
        prefix = kwargs["Prefix"]
        return {
            "Contents": [
                {"Key": key} for key in self.objects if key.startswith(prefix)
            ],
            "IsTruncated": False,
        }

    def delete_objects(self, **kwargs: Any) -> dict[str, Any]:
        for item in kwargs["Delete"]["Objects"]:
            self.objects.pop(item["Key"], None)
        return {}


class FakeGarmin:
    def __init__(self, **kwargs: Any) -> None:
        self.email = kwargs.get("email")
        self.return_on_mfa = kwargs.get("return_on_mfa", False)
        self.client = self
        self._token = '{"access_token":"' + "a" * 600 + '","refresh_token":"refresh"}'

    def login(self, tokenstore: str | None = None) -> tuple[Any, Any]:
        if tokenstore:
            self._token = tokenstore
            return None, None
        if self.email == "mfa@example.com":
            return {
                "ticket": "ticket-value",
                "cookies": {"SESSION": "continuation"},
            }, None
        return None, None

    def resume_login(self, state: dict[str, Any], code: str) -> tuple[Any, Any]:
        if state.get("ticket") != "ticket-value" or code != "123456":
            raise FakeGarminAuthenticationError("bad MFA")
        return None, None

    def dumps(self) -> str:
        return self._token

    def get_activities(self, start: int, limit: int) -> list[dict[str, Any]]:
        assert start == 0 and limit == 100
        return [
            {
                "activityId": 101,
                "activityName": "Morning Run",
                "activityType": {"typeKey": "running"},
                "startTimeGMT": "2026-07-27 22:00:00",
                "distance": 10000,
                "duration": 3300,
                "elapsedDuration": 3400,
                "elevationGain": 84,
                "averageHR": 151,
                "maxHR": 173,
            },
            {
                "activityId": 102,
                "activityName": "Bike",
                "activityType": {"typeKey": "cycling"},
                "startTimeGMT": "2026-07-26 22:00:00",
                "distance": 20000,
                "duration": 3600,
            },
        ]

    def get_heart_rates(self, day: str) -> dict[str, Any]:
        return {"calendarDate": day, "restingHeartRate": 52}

    def get_sleep_data(self, day: str) -> dict[str, Any]:
        return {"dailySleepDTO": {"calendarDate": day, "sleepTimeSeconds": 27000}}

    def get_hrv_data(self, day: str) -> dict[str, Any]:
        return {"hrvSummary": {"calendarDate": day, "lastNightAvg": 61}}

    def get_morning_training_readiness(self, day: str) -> dict[str, Any]:
        return {"calendarDate": day, "score": 78}


class FakeGarminAuthenticationError(Exception):
    pass


def event(
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    *,
    origin: str = "https://goyoungo.com",
) -> dict[str, Any]:
    return {
        "rawPath": path,
        "headers": {
            "authorization": "Bearer " + "k" * 40,
            "origin": origin,
        },
        "requestContext": {"http": {"method": method}},
        "body": json.dumps(body or {}),
    }


def response_body(result: dict[str, Any]) -> dict[str, Any]:
    return json.loads(result["body"])


class RunbroGarminTests(unittest.TestCase):
    def setUp(self) -> None:
        self.s3 = FakeS3()
        app.configure_for_tests(
            s3_client=self.s3,
            garmin_factory=lambda **kwargs: FakeGarmin(**kwargs),
            kakao_verifier=lambda token: "USER#" + "a" * 64,
        )

    def test_password_is_not_persisted_and_objects_use_sse_kms(self) -> None:
        result = app.handler(
            event(
                "POST",
                "/garmin/auth/start",
                {"email": "runner@example.com", "password": "super-secret"},
            ),
            None,
        )
        self.assertEqual(result["statusCode"], 200)
        self.assertTrue(response_body(result)["connected"])
        self.assertGreaterEqual(len(self.s3.put_calls), 2)
        for call in self.s3.put_calls:
            self.assertEqual(call["ServerSideEncryption"], "aws:kms")
            self.assertEqual(call["SSEKMSKeyId"], os.environ["RUNBRO_TOKEN_KEY_ID"])
            self.assertTrue(call["BucketKeyEnabled"])
            source = gzip.decompress(call["Body"]).decode("utf-8")
            self.assertNotIn("super-secret", source)
            self.assertNotIn("runner@example.com", source)

    def test_mfa_can_resume_in_a_separate_invocation(self) -> None:
        start = app.handler(
            event(
                "POST",
                "/garmin/auth/start",
                {"email": "mfa@example.com", "password": "super-secret"},
            ),
            None,
        )
        self.assertEqual(start["statusCode"], 200)
        challenge = response_body(start)
        self.assertTrue(challenge["needsMfa"])
        complete = app.handler(
            event(
                "POST",
                "/garmin/auth/complete",
                {"challengeId": challenge["challengeId"], "code": "123456"},
            ),
            None,
        )
        self.assertEqual(complete["statusCode"], 200)
        self.assertTrue(response_body(complete)["connected"])
        self.assertFalse(any("/pending/" in key for key in self.s3.objects))

    def test_sync_normalizes_only_running_and_returns_health_summary(self) -> None:
        app.handler(
            event(
                "POST",
                "/garmin/auth/start",
                {"email": "runner@example.com", "password": "super-secret"},
            ),
            None,
        )
        result = app.handler(event("POST", "/garmin/sync"), None)
        self.assertEqual(result["statusCode"], 200)
        body = response_body(result)
        self.assertEqual(len(body["activities"]), 1)
        self.assertEqual(body["activities"][0]["provider"], "garmin")
        self.assertEqual(body["activities"][0]["distanceKm"], 10)
        self.assertEqual(body["health"]["restingHr"], 52)
        self.assertEqual(body["health"]["sleepHours"], 7.5)
        self.assertEqual(body["health"]["hrv"], 61)
        self.assertEqual(body["health"]["trainingReadiness"], 78)
        health_objects = [
            gzip.decompress(value["Body"]).decode("utf-8")
            for key, value in self.s3.objects.items()
            if "/health/" in key
        ]
        self.assertEqual(len(health_objects), 1)
        self.assertNotIn('"raw"', health_objects[0])
        self.assertFalse(any("/locks/" in key for key in self.s3.objects))

    def test_pending_mfa_state_is_marked_for_lifecycle_cleanup(self) -> None:
        app.handler(
            event(
                "POST",
                "/garmin/auth/start",
                {"email": "mfa@example.com", "password": "super-secret"},
            ),
            None,
        )
        pending = [
            value
            for key, value in self.s3.objects.items()
            if "/pending/" in key
        ]
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["Tagging"], "DataClass=ephemeral")

    def test_dashboard_is_safe_when_not_connected(self) -> None:
        result = app.handler(event("GET", "/garmin/dashboard"), None)
        self.assertEqual(result["statusCode"], 200)
        body = response_body(result)
        self.assertFalse(body["connections"]["garmin"]["connected"])
        self.assertEqual(body["activities"], [])
        self.assertIsNone(body["health"])

    def test_rejects_unknown_origin(self) -> None:
        result = app.handler(
            event(
                "GET",
                "/garmin/dashboard",
                origin="https://attacker.example",
            ),
            None,
        )
        self.assertEqual(result["statusCode"], 403)
        self.assertEqual(response_body(result)["code"], "origin_not_allowed")

    def test_delete_removes_every_object_under_the_user_prefix(self) -> None:
        app.handler(
            event(
                "POST",
                "/garmin/auth/start",
                {"email": "runner@example.com", "password": "super-secret"},
            ),
            None,
        )
        app.handler(event("POST", "/garmin/sync"), None)
        result = app.handler(event("DELETE", "/garmin/account"), None)
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(self.s3.objects, {})


if __name__ == "__main__":
    unittest.main()
