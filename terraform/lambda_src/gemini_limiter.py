"""gemini_limiter.py - Upstash Redis rate limiter for Gemini models in AWS Lambda.

Tracks RPM (requests per minute) and RPD (requests per day) per model using
the Upstash REST API (no external Redis packages; standard urllib.request only).
If Upstash is unreachable, it logs a warning and proceeds without rate limiting.
"""

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request


class RateLimitExhausted(Exception):
    """Raised when RPM timeout is exceeded or daily quota (RPD) is exhausted."""
    pass


def _get_env_config():
    url = os.environ.get("UPSTASH_REDIS_REST_URL", "").rstrip("/")
    token = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "")
    rpm_limit = int(os.environ.get("GEMINI_RPM", "9"))
    rpd_limit = int(os.environ.get("GEMINI_RPD", "450"))
    return url, token, rpm_limit, rpd_limit


def _execute_rest(url: str, token: str, path: str, method: str = "GET") -> dict:
    """Execute a single REST command against Upstash Redis."""
    req_url = f"{url}/{path}"
    req = urllib.request.Request(
        req_url,
        data=b"" if method == "POST" else None,
        headers={"Authorization": f"Bearer {token}"},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get_key_count(url: str, token: str, key: str) -> int:
    """Retrieve current integer count for a key, or 0 if non-existent."""
    res = _execute_rest(url, token, f"get/{urllib.parse.quote(key)}", method="GET")
    val = res.get("result")
    if val is None:
        return 0
    try:
        return int(val)
    except (ValueError, TypeError):
        return 0


def _incr_and_expire(url: str, token: str, key: str, ttl_seconds: int) -> int:
    """Atomic INCR with TTL set if the key is newly created."""
    res = _execute_rest(url, token, f"incr/{urllib.parse.quote(key)}", method="POST")
    count = int(res.get("result", 0))
    if count == 1:
        _execute_rest(url, token, f"expire/{urllib.parse.quote(key)}/{ttl_seconds}", method="POST")
    return count


def acquire(model: str, timeout_s: int = 55) -> None:
    """Poll until a rate limit slot is available, then atomically increment RPM and RPD.

    - rl:rpm:<model> (TTL 60s, limit = GEMINI_RPM, default 9)
    - rl:rpd:<model> (TTL 86400s, limit = GEMINI_RPD, default 450)

    Raises RateLimitExhausted if RPD limit is reached or RPM wait exceeds timeout_s.
    Proceeds without rate limiting if Upstash Redis is unreachable.
    """
    url, token, rpm_limit, rpd_limit = _get_env_config()
    if not url or not token:
        return

    rpm_key = f"rl:rpm:{model}"
    rpd_key = f"rl:rpd:{model}"
    deadline = time.time() + timeout_s

    try:
        while True:
            # 1. Check daily quota first (RPD)
            rpd_count = _get_key_count(url, token, rpd_key)
            if rpd_count >= rpd_limit:
                raise RateLimitExhausted(f"Daily limit reached for model {model} (RPD: {rpd_count}/{rpd_limit})")

            # 2. Check minute quota (RPM)
            rpm_count = _get_key_count(url, token, rpm_key)
            if rpm_count < rpm_limit:
                # Slot is free: increment both counters
                _incr_and_expire(url, token, rpm_key, ttl_seconds=60)
                _incr_and_expire(url, token, rpd_key, ttl_seconds=86400)
                return

            # RPM limit hit: wait and retry if within timeout window
            if time.time() + 2.0 > deadline:
                raise RateLimitExhausted(
                    f"Rate limit timeout ({timeout_s}s) exceeded for model {model} (RPM: {rpm_count}/{rpm_limit})"
                )

            time.sleep(2)

    except RateLimitExhausted:
        raise
    except Exception as exc:
        print(f"[GeminiLimiter] Upstash Redis error ({type(exc).__name__}: {exc}); proceeding without rate limiting")
        return
