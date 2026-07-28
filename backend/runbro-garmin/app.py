"""RUNBRO Garmin connector for AWS Lambda.

The function deliberately does not run an MCP server.  It creates a Garmin
client only for the lifetime of a request, stores the refreshable token in an
SSE-KMS encrypted S3 object, and keeps only normalized running/health data.
Garmin credentials are used for the initial request and are never persisted.
"""

from __future__ import annotations

import base64
import gzip
import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import time
import urllib.error
import urllib.request
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Callable


ALLOWED_ORIGINS = {
    "https://goyoungo.com",
    "https://www.goyoungo.com",
    "https://test.goyoungo.com",
}
RUN_TYPES = {
    "running",
    "trail_running",
    "treadmill_running",
    "indoor_running",
    "virtual_running",
    "track_running",
}
MFA_TTL_SECONDS = 5 * 60
SYNC_LOCK_SECONDS = 2 * 60
MAX_BODY_BYTES = 4096

_s3_override: Any = None
_garmin_factory_override: Callable[..., Any] | None = None
_kakao_verifier_override: Callable[[str], str] | None = None


class HttpError(Exception):
    def __init__(self, status_code: int, message: str, code: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code


def configure_for_tests(
    *,
    s3_client: Any | None = None,
    garmin_factory: Callable[..., Any] | None = None,
    kakao_verifier: Callable[[str], str] | None = None,
) -> None:
    """Inject local fakes without bundling test-only SDKs into production."""

    global _s3_override, _garmin_factory_override, _kakao_verifier_override
    _s3_override = s3_client
    _garmin_factory_override = garmin_factory
    _kakao_verifier_override = kakao_verifier


def _bucket_name() -> str:
    value = os.getenv("RUNBRO_GARMIN_BUCKET", "")
    if not value:
        raise RuntimeError("RUNBRO_GARMIN_BUCKET is not configured")
    return value


def _kms_key_id() -> str:
    value = os.getenv("RUNBRO_TOKEN_KEY_ID", "")
    if not value:
        raise RuntimeError("RUNBRO_TOKEN_KEY_ID is not configured")
    return value


def _kakao_app_id() -> str:
    value = os.getenv("KAKAO_APP_ID", "")
    if not re.fullmatch(r"\d+", value):
        raise RuntimeError("KAKAO_APP_ID is not configured")
    return value


def _hmac_secret() -> str:
    value = os.getenv("USER_HMAC_SECRET", "")
    if len(value) < 32:
        raise RuntimeError("USER_HMAC_SECRET is not configured")
    return value


def _s3() -> Any:
    if _s3_override is not None:
        return _s3_override
    import boto3  # Lambda runtime dependency

    return boto3.client("s3")


def _garmin_factory(**kwargs: Any) -> Any:
    if _garmin_factory_override is not None:
        return _garmin_factory_override(**kwargs)
    from garminconnect import Garmin

    return Garmin(**kwargs)


def _json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _response(status_code: int, body: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
        },
        "body": json.dumps(body, ensure_ascii=False, separators=(",", ":")),
    }


def _parse_body(event: dict[str, Any]) -> dict[str, Any]:
    source = event.get("body") or ""
    if event.get("isBase64Encoded"):
        try:
            source = base64.b64decode(source).decode("utf-8")
        except Exception as error:
            raise HttpError(400, "요청 형식이 올바르지 않습니다.", "invalid_json") from error
    if len(source.encode("utf-8")) > MAX_BODY_BYTES:
        raise HttpError(413, "요청 내용이 너무 큽니다.", "payload_too_large")
    try:
        body = json.loads(source or "{}")
    except (TypeError, ValueError) as error:
        raise HttpError(400, "요청 형식이 올바르지 않습니다.", "invalid_json") from error
    if not isinstance(body, dict):
        raise HttpError(400, "요청 형식이 올바르지 않습니다.", "invalid_json")
    return body


def _bearer_token(event: dict[str, Any]) -> str:
    headers = event.get("headers") or {}
    value = headers.get("authorization") or headers.get("Authorization") or ""
    match = re.fullmatch(r"Bearer\s+(\S+)", str(value), re.IGNORECASE)
    if not match or not 20 <= len(match.group(1)) <= 2048:
        raise HttpError(401, "카카오 로그인이 필요합니다.", "login_required")
    return match.group(1)


def _verify_kakao_access_token(access_token: str) -> str:
    if _kakao_verifier_override is not None:
        return _kakao_verifier_override(access_token)
    request = urllib.request.Request(
        "https://kapi.kakao.com/v1/user/access_token_info",
        headers={"Authorization": f"Bearer {access_token}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=4.5) as result:
            payload = json.loads(result.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code in {400, 401}:
            raise HttpError(
                401,
                "카카오 로그인이 만료되었습니다. 다시 로그인해 주세요.",
                "login_expired",
            ) from error
        raise HttpError(
            503,
            "카카오 인증 서버에 연결하지 못했습니다.",
            "auth_unavailable",
        ) from error
    except Exception as error:
        raise HttpError(
            503,
            "카카오 인증 서버에 연결하지 못했습니다.",
            "auth_unavailable",
        ) from error

    user_id = payload.get("id")
    if (
        str(payload.get("app_id") or "") != _kakao_app_id()
        or int(payload.get("expires_in") or 0) <= 0
        or not isinstance(user_id, int)
    ):
        raise HttpError(401, "유효하지 않은 로그인입니다.", "invalid_login")
    digest = hmac.new(
        _hmac_secret().encode("utf-8"),
        f"{_kakao_app_id()}:{user_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"USER#{digest}"


def _user_pk(event: dict[str, Any]) -> str:
    return _verify_kakao_access_token(_bearer_token(event))


def _user_hash(user_pk: str) -> str:
    if not re.fullmatch(r"USER#[a-f0-9]{64}", user_pk):
        raise RuntimeError("Invalid internal user key")
    return user_pk[5:]


def _prefix(user_pk: str) -> str:
    return f"users/{_user_hash(user_pk)}/garmin/"


def _client_error_code(error: Exception) -> str:
    response = getattr(error, "response", None)
    if isinstance(response, dict):
        details = response.get("Error") or {}
        return str(details.get("Code") or "")
    return ""


def _put_json(
    key: str,
    value: Any,
    *,
    if_none_match: bool = False,
    tagging: str | None = None,
) -> None:
    body = gzip.compress(_json_bytes(value), compresslevel=6)
    args: dict[str, Any] = {
        "Bucket": _bucket_name(),
        "Key": key,
        "Body": body,
        "ContentType": "application/json",
        "ContentEncoding": "gzip",
        "CacheControl": "no-store",
        "ServerSideEncryption": "aws:kms",
        "SSEKMSKeyId": _kms_key_id(),
        "BucketKeyEnabled": True,
    }
    if if_none_match:
        args["IfNoneMatch"] = "*"
    if tagging:
        args["Tagging"] = tagging
    _s3().put_object(**args)


def _get_json(key: str) -> Any | None:
    try:
        result = _s3().get_object(Bucket=_bucket_name(), Key=key)
    except Exception as error:
        if _client_error_code(error) in {"NoSuchKey", "404", "NotFound"}:
            return None
        raise
    body = result["Body"].read()
    if result.get("ContentEncoding") == "gzip" or body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    return json.loads(body.decode("utf-8"))


def _delete_key(key: str) -> None:
    _s3().delete_object(Bucket=_bucket_name(), Key=key)


def _connection_key(user_pk: str) -> str:
    return _prefix(user_pk) + "connection.json.gz"


def _token_key(user_pk: str) -> str:
    return _prefix(user_pk) + "token.json.gz"


def _activities_key(user_pk: str) -> str:
    return _prefix(user_pk) + "activities/latest.json.gz"


def _health_key(user_pk: str) -> str:
    return _prefix(user_pk) + "health/latest.json.gz"


def _pending_key(user_pk: str, challenge_id: str) -> str:
    return _prefix(user_pk) + f"pending/{challenge_id}.json.gz"


def _lock_key(user_pk: str) -> str:
    return _prefix(user_pk) + "locks/sync.json.gz"


def _token_string(client: Any) -> str:
    inner = client.client
    dumps = getattr(inner, "dumps", None)
    if callable(dumps):
        value = dumps()
        if isinstance(value, str) and len(value) >= 64:
            return value
    root = Path("/tmp") if Path("/tmp").exists() else None
    with tempfile.TemporaryDirectory(prefix="runbro-garmin-", dir=root) as directory:
        inner.dump(directory)
        token_file = Path(directory) / "garmin_tokens.json"
        value = token_file.read_text(encoding="utf-8")
        if len(value) < 64:
            raise RuntimeError("Garmin token serialization failed")
        return value


def _client_from_token(token: str) -> Any:
    client = _garmin_factory(retry_attempts=1, retry_min_wait=0.5, retry_max_wait=2)
    if len(token) > 512:
        client.login(token)
        return client
    root = Path("/tmp") if Path("/tmp").exists() else None
    with tempfile.TemporaryDirectory(prefix="runbro-garmin-", dir=root) as directory:
        token_file = Path(directory) / "garmin_tokens.json"
        token_file.write_text(token, encoding="utf-8")
        try:
            client.login(directory)
        finally:
            token_file.unlink(missing_ok=True)
    return client


def _save_token(user_pk: str, client: Any) -> None:
    _put_json(
        _token_key(user_pk),
        {
            "version": 1,
            "token": _token_string(client),
            "updatedAt": datetime.now(UTC).isoformat(),
        },
    )


def _map_garmin_error(error: Exception, *, login: bool = False) -> HttpError:
    name = type(error).__name__.lower()
    if "toomanyrequests" in name or "429" in str(error):
        return HttpError(
            429,
            "Garmin 요청이 잠시 제한되었습니다. 몇 분 뒤 다시 시도해 주세요.",
            "garmin_rate_limited",
        )
    if "authentication" in name or "unauthorized" in str(error).lower():
        return HttpError(
            401 if not login else 400,
            "Garmin 로그인 정보를 확인해 주세요."
            if login
            else "Garmin 연결이 만료되었습니다. 다시 연결해 주세요.",
            "garmin_login_failed" if login else "provider_login_expired",
        )
    return HttpError(
        503,
        "Garmin Connect에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
        "garmin_unavailable",
    )


def _start_auth(event: dict[str, Any]) -> dict[str, Any]:
    user_pk = _user_pk(event)
    body = _parse_body(event)
    email = str(body.get("email") or "").strip()
    password = str(body.get("password") or "")
    if (
        not re.fullmatch(r"[^@\s]{1,128}@[^@\s]{1,190}", email)
        or not 6 <= len(password) <= 256
    ):
        raise HttpError(
            400,
            "Garmin 이메일과 비밀번호를 확인해 주세요.",
            "invalid_garmin_credentials",
        )
    try:
        client = _garmin_factory(
            email=email,
            password=password,
            return_on_mfa=True,
            retry_attempts=0,
        )
        mfa_state, _ = client.login()
        password = ""
        if mfa_state:
            # The library intentionally returns a JSON-compatible continuation
            # state so MFA can be resumed by a later Lambda invocation.
            json.dumps(mfa_state, allow_nan=False)
            challenge_id = secrets.token_urlsafe(24)
            _put_json(
                _pending_key(user_pk, challenge_id),
                {
                    "version": 1,
                    "clientState": mfa_state,
                    "expiresAt": int(time.time()) + MFA_TTL_SECONDS,
                },
                tagging="DataClass=ephemeral",
            )
            return _response(
                200,
                {
                    "needsMfa": True,
                    "challengeId": challenge_id,
                    "expiresIn": MFA_TTL_SECONDS,
                },
            )
        _save_token(user_pk, client)
        now = datetime.now(UTC).isoformat()
        _put_json(
            _connection_key(user_pk),
            {"connected": True, "provider": "garmin", "connectedAt": now},
        )
        return _response(200, {"connected": True, "provider": "garmin"})
    except HttpError:
        raise
    except Exception as error:
        raise _map_garmin_error(error, login=True) from error
    finally:
        password = ""


def _complete_auth(event: dict[str, Any]) -> dict[str, Any]:
    user_pk = _user_pk(event)
    body = _parse_body(event)
    challenge_id = str(body.get("challengeId") or "")
    code = re.sub(r"\s+", "", str(body.get("code") or ""))
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,64}", challenge_id) or not re.fullmatch(
        r"\d{4,10}", code
    ):
        raise HttpError(400, "인증 코드를 확인해 주세요.", "invalid_mfa")
    pending_key = _pending_key(user_pk, challenge_id)
    pending = _get_json(pending_key)
    if not pending or int(pending.get("expiresAt") or 0) < int(time.time()):
        _delete_key(pending_key)
        raise HttpError(
            400,
            "인증 요청이 만료되었습니다. 다시 연결해 주세요.",
            "expired_mfa",
        )
    try:
        client = _garmin_factory(return_on_mfa=True, retry_attempts=0)
        client.resume_login(pending["clientState"], code)
        _save_token(user_pk, client)
        now = datetime.now(UTC).isoformat()
        _put_json(
            _connection_key(user_pk),
            {"connected": True, "provider": "garmin", "connectedAt": now},
        )
        _delete_key(pending_key)
        return _response(200, {"connected": True, "provider": "garmin"})
    except HttpError:
        raise
    except Exception as error:
        raise _map_garmin_error(error, login=True) from error


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in {float("inf"), float("-inf")}:
        return None
    return number


def _first_number(value: Any, keys: set[str]) -> float | None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key in keys:
                number = _number(child)
                if number is not None:
                    return number
        for child in value.values():
            found = _first_number(child, keys)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = _first_number(child, keys)
            if found is not None:
                return found
    return None


def _activity_type(activity: dict[str, Any]) -> str:
    source = activity.get("activityType")
    if isinstance(source, dict):
        return str(source.get("typeKey") or source.get("typeId") or "").lower()
    return str(source or activity.get("sportType") or "").lower()


def _normalize_activity(activity: dict[str, Any]) -> dict[str, Any] | None:
    type_key = _activity_type(activity)
    if type_key not in RUN_TYPES and "running" not in type_key:
        return None
    identifier = activity.get("activityId") or activity.get("id")
    started = (
        activity.get("startTimeGMT")
        or activity.get("startTimeLocal")
        or activity.get("beginTimestamp")
    )
    distance_m = _number(activity.get("distance")) or 0
    duration = (
        _number(activity.get("movingDuration"))
        or _number(activity.get("duration"))
        or 0
    )
    if not identifier or not started or distance_m <= 0 or duration <= 0:
        return None
    return {
        "id": str(identifier),
        "provider": "garmin",
        "date": str(started).replace(" ", "T"),
        "name": str(activity.get("activityName") or "Garmin 러닝")[:120],
        "distanceKm": round(distance_m / 1000, 3),
        "movingSeconds": round(duration),
        "elapsedSeconds": round(
            _number(activity.get("elapsedDuration")) or duration
        ),
        "elevationGain": _number(activity.get("elevationGain")),
        "averageHr": _number(
            activity.get("averageHR") or activity.get("averageHeartRate")
        ),
        "maxHr": _number(activity.get("maxHR") or activity.get("maxHeartRate")),
    }


def _best_effort(client: Any, method_name: str, *args: Any) -> Any | None:
    method = getattr(client, method_name, None)
    if not callable(method):
        return None
    try:
        return method(*args)
    except Exception:
        return None


def _health_snapshot(client: Any) -> dict[str, Any]:
    today = date.today().isoformat()
    raw = {
        "heartRate": _best_effort(client, "get_heart_rates", today),
        "sleep": _best_effort(client, "get_sleep_data", today),
        "hrv": _best_effort(client, "get_hrv_data", today),
        "trainingReadiness": _best_effort(
            client, "get_morning_training_readiness", today
        ),
    }
    sleep_seconds = _first_number(
        raw["sleep"],
        {
            "sleepTimeSeconds",
            "sleepingSeconds",
            "totalSleepSeconds",
        },
    )
    return {
        "date": today,
        "summary": {
            "restingHr": _first_number(
                raw["heartRate"], {"restingHeartRate", "restingHR"}
            ),
            "sleepHours": round(sleep_seconds / 3600, 2)
            if sleep_seconds is not None
            else None,
            "sleepScore": _first_number(
                raw["sleep"], {"overallScore", "sleepScore"}
            ),
            "hrv": _first_number(
                raw["hrv"], {"lastNightAvg", "weeklyAvg", "hrvValue"}
            ),
            "trainingReadiness": _first_number(
                raw["trainingReadiness"],
                {"score", "trainingReadinessScore"},
            ),
        },
    }


def _acquire_sync_lock(user_pk: str) -> None:
    key = _lock_key(user_pk)
    value = {"expiresAt": int(time.time()) + SYNC_LOCK_SECONDS}
    try:
        _put_json(
            key,
            value,
            if_none_match=True,
            tagging="DataClass=ephemeral",
        )
        return
    except Exception as error:
        if _client_error_code(error) not in {
            "PreconditionFailed",
            "ConditionalRequestConflict",
            "409",
            "412",
        }:
            raise
    current = _get_json(key)
    if current and int(current.get("expiresAt") or 0) >= int(time.time()):
        raise HttpError(
            409,
            "이미 Garmin 기록을 동기화하고 있습니다.",
            "sync_in_progress",
        )
    _delete_key(key)
    try:
        _put_json(
            key,
            value,
            if_none_match=True,
            tagging="DataClass=ephemeral",
        )
    except Exception as error:
        raise HttpError(
            409,
            "이미 Garmin 기록을 동기화하고 있습니다.",
            "sync_in_progress",
        ) from error


def _dashboard_value(user_pk: str) -> dict[str, Any]:
    connection = _get_json(_connection_key(user_pk))
    activities_value = _get_json(_activities_key(user_pk))
    health_value = _get_json(_health_key(user_pk))
    connected = bool(connection and connection.get("connected"))
    return {
        "connections": {
            "garmin": {
                "connected": connected,
                "lastSyncAt": connection.get("lastSyncAt")
                if connection
                else None,
            }
        },
        "activities": activities_value.get("activities", [])
        if isinstance(activities_value, dict)
        else [],
        "health": health_value.get("summary")
        if isinstance(health_value, dict)
        else None,
    }


def _dashboard(event: dict[str, Any]) -> dict[str, Any]:
    return _response(200, _dashboard_value(_user_pk(event)))


def _sync(event: dict[str, Any]) -> dict[str, Any]:
    user_pk = _user_pk(event)
    _parse_body(event)
    token_value = _get_json(_token_key(user_pk))
    if not token_value or not isinstance(token_value.get("token"), str):
        raise HttpError(
            409,
            "먼저 Garmin Connect를 연결해 주세요.",
            "provider_not_connected",
        )
    _acquire_sync_lock(user_pk)
    try:
        try:
            client = _client_from_token(token_value["token"])
            provider_activities = client.get_activities(0, 100)
            if not isinstance(provider_activities, list):
                raise RuntimeError("Garmin activities response is not a list")
            normalized = [
                result
                for result in (
                    _normalize_activity(item)
                    for item in provider_activities
                    if isinstance(item, dict)
                )
                if result is not None
            ]
            health = _health_snapshot(client)
            _save_token(user_pk, client)
        except HttpError:
            raise
        except Exception as error:
            raise _map_garmin_error(error) from error

        now = datetime.now(UTC).isoformat()
        _put_json(
            _activities_key(user_pk),
            {"version": 1, "syncedAt": now, "activities": normalized},
        )
        _put_json(
            _health_key(user_pk),
            {
                "version": 1,
                "syncedAt": now,
                "summary": health["summary"],
            },
        )
        connection = _get_json(_connection_key(user_pk)) or {}
        connection.update(
            {
                "connected": True,
                "provider": "garmin",
                "lastSyncAt": now,
                "connectedAt": connection.get("connectedAt") or now,
            }
        )
        _put_json(_connection_key(user_pk), connection)
        return _response(200, _dashboard_value(user_pk))
    finally:
        try:
            _delete_key(_lock_key(user_pk))
        except Exception:
            pass


def _delete_user_versions(user_pk: str) -> None:
    client = _s3()
    prefix = _prefix(user_pk)
    key_marker: str | None = None
    version_marker: str | None = None
    while True:
        args: dict[str, Any] = {
            "Bucket": _bucket_name(),
            "Prefix": prefix,
        }
        if key_marker:
            args["KeyMarker"] = key_marker
        if version_marker:
            args["VersionIdMarker"] = version_marker
        try:
            result = client.list_object_versions(**args)
        except (AttributeError, NotImplementedError):
            result = {}
        objects = [
            {"Key": item["Key"], "VersionId": item["VersionId"]}
            for item in (result.get("Versions") or [])
            + (result.get("DeleteMarkers") or [])
        ]
        if objects:
            client.delete_objects(
                Bucket=_bucket_name(),
                Delete={"Objects": objects, "Quiet": True},
            )
        if not result.get("IsTruncated"):
            break
        key_marker = result.get("NextKeyMarker")
        version_marker = result.get("NextVersionIdMarker")

    # Local fakes and non-versioned recovery buckets use the regular listing.
    continuation: str | None = None
    while True:
        args = {"Bucket": _bucket_name(), "Prefix": prefix}
        if continuation:
            args["ContinuationToken"] = continuation
        result = client.list_objects_v2(**args)
        objects = [{"Key": item["Key"]} for item in result.get("Contents") or []]
        if objects:
            client.delete_objects(
                Bucket=_bucket_name(),
                Delete={"Objects": objects, "Quiet": True},
            )
        if not result.get("IsTruncated"):
            break
        continuation = result.get("NextContinuationToken")


def _delete_account(event: dict[str, Any]) -> dict[str, Any]:
    user_pk = _user_pk(event)
    _delete_user_versions(user_pk)
    return _response(200, {"deleted": True, "provider": "garmin"})


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    del context
    try:
        headers = event.get("headers") or {}
        origin = str(headers.get("origin") or headers.get("Origin") or "")
        if origin and origin not in ALLOWED_ORIGINS:
            raise HttpError(403, "허용되지 않은 요청입니다.", "origin_not_allowed")
        request_context = event.get("requestContext") or {}
        http_context = request_context.get("http") or {}
        method = str(http_context.get("method") or "").upper()
        path = str(event.get("rawPath") or "")
        if method == "OPTIONS":
            return _response(204, {})
        if method == "POST" and path == "/garmin/auth/start":
            return _start_auth(event)
        if method == "POST" and path == "/garmin/auth/complete":
            return _complete_auth(event)
        if method == "GET" and path == "/garmin/dashboard":
            return _dashboard(event)
        if method == "POST" and path == "/garmin/sync":
            return _sync(event)
        if method == "DELETE" and path == "/garmin/account":
            return _delete_account(event)
        return _response(
            404,
            {"message": "요청한 기능을 찾을 수 없습니다.", "code": "not_found"},
        )
    except HttpError as error:
        return _response(
            error.status_code,
            {"message": str(error), "code": error.code},
        )
    except Exception as error:
        print(
            json.dumps(
                {
                    "event": "runbro_garmin_error",
                    "type": type(error).__name__,
                },
                separators=(",", ":"),
            )
        )
        return _response(
            500,
            {
                "message": "요청 처리 중 오류가 발생했습니다.",
                "code": "internal_error",
            },
        )
