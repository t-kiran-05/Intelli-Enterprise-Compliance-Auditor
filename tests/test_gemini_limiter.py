"""test_gemini_limiter.py - Tests for Upstash Redis Gemini rate limiter."""

import io
import json
import os
import sys
import urllib.error
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "terraform", "lambda_src"))

import gemini_limiter
from gemini_limiter import RateLimitExhausted


class MockResponse:
    def __init__(self, data: dict):
        self._data = json.dumps(data).encode("utf-8")

    def read(self):
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


@pytest.fixture(autouse=True)
def setup_env(monkeypatch):
    monkeypatch.setenv("UPSTASH_REDIS_REST_URL", "https://mock-redis.upstash.io")
    monkeypatch.setenv("UPSTASH_REDIS_REST_TOKEN", "mock-token-xyz")
    monkeypatch.setenv("GEMINI_RPM", "9")
    monkeypatch.setenv("GEMINI_RPD", "450")


def test_acquire_waits_and_retries_when_rpm_at_limit(monkeypatch):
    """acquire() waits and retries when RPM is initially at limit, succeeding when count drops."""
    rpm_calls = {"count": 0}
    recorded_commands = []

    def mock_urlopen(req, timeout=5):
        url = req.full_url
        recorded_commands.append((req.get_method(), url))

        if "get/rl%3Arpd%3Agemini-2.5-flash" in url:
            return MockResponse({"result": 10})
        elif "get/rl%3Arpm%3Agemini-2.5-flash" in url:
            rpm_calls["count"] += 1
            if rpm_calls["count"] == 1:
                return MockResponse({"result": 9})  # At limit
            return MockResponse({"result": 8})  # Slot freed
        elif "incr/" in url:
            return MockResponse({"result": 5})
        return MockResponse({"result": 1})

    monkeypatch.setattr(urllib.request, "urlopen", mock_urlopen)
    # Speed up sleep during test
    sleep_calls = []
    monkeypatch.setattr(gemini_limiter.time, "sleep", lambda s: sleep_calls.append(s))

    gemini_limiter.acquire("gemini-2.5-flash", timeout_s=10)

    assert len(sleep_calls) == 1
    assert sleep_calls[0] == 2
    assert rpm_calls["count"] == 2


def test_acquire_raises_when_rpd_at_limit(monkeypatch):
    """acquire() raises RateLimitExhausted when RPD daily limit is reached."""
    def mock_urlopen(req, timeout=5):
        url = req.full_url
        if "get/rl%3Arpd%3Agemini-2.5-flash" in url:
            return MockResponse({"result": 450})  # Daily quota reached
        return MockResponse({"result": 0})

    monkeypatch.setattr(urllib.request, "urlopen", mock_urlopen)

    with pytest.raises(RateLimitExhausted, match="Daily limit reached"):
        gemini_limiter.acquire("gemini-2.5-flash", timeout_s=5)


def test_acquire_proceeds_silently_when_upstash_unreachable(monkeypatch, capsys):
    """acquire() proceeds silently without blocking the audit when Upstash is unreachable."""
    def mock_urlopen(req, timeout=5):
        raise urllib.error.URLError("Network unreachable")

    monkeypatch.setattr(urllib.request, "urlopen", mock_urlopen)

    # Must NOT raise exception
    gemini_limiter.acquire("gemini-2.5-flash", timeout_s=5)

    captured = capsys.readouterr()
    assert "proceeding without rate limiting" in captured.out


def test_keys_use_correct_ttls_for_rpm_and_rpd(monkeypatch):
    """Keys use correct TTLs: 60s for RPM and 86400s for RPD when initialized."""
    expire_calls = []

    def mock_urlopen(req, timeout=5):
        url = req.full_url
        if "get/" in url:
            return MockResponse({"result": 0})
        elif "incr/" in url:
            return MockResponse({"result": 1})  # First time key created -> triggers EXPIRE
        elif "expire/" in url:
            expire_calls.append(url)
            return MockResponse({"result": 1})
        return MockResponse({"result": 1})

    monkeypatch.setattr(urllib.request, "urlopen", mock_urlopen)

    gemini_limiter.acquire("gemini-2.5-flash", timeout_s=10)

    # Verify expire URLs contain correct TTLs
    assert any("rl%3Arpm%3Agemini-2.5-flash/60" in url for url in expire_calls), f"RPM 60s TTL not found in {expire_calls}"
    assert any("rl%3Arpd%3Agemini-2.5-flash/86400" in url for url in expire_calls), f"RPD 86400s TTL not found in {expire_calls}"

