"""tests/test_server.py - Unit tests for the FastAPI secondary server (server/main.py).

Validates:
  - GET /health (public, 200 OK)
  - x-backend-token constant-time authentication (401 on missing/wrong token)
  - POST /upload (validation of file extensions and docType, signed URL generation)
  - POST /audits/{id}/start (idempotency, background task triggering)
  - GET /results/{id} (returns backward-compatible shaped results, handles NOT_FOUND and FAILED)
  - owner_id preservation and storage
"""

import os
import sys
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Ensure server/ is on sys.path
_ROOT = os.path.join(os.path.dirname(__file__), "..")
_SERVER_DIR = os.path.join(_ROOT, "server")
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)
if os.path.join(_ROOT, "terraform", "lambda_src") not in sys.path:
    sys.path.insert(0, os.path.join(_ROOT, "terraform", "lambda_src"))

# Set test environment variables before importing app
os.environ["BACKEND_SHARED_TOKEN"] = "test-shared-secret-token-12345"
os.environ["SUPABASE_URL"] = "https://mock.supabase.co"
os.environ["SUPABASE_SECRET_KEY"] = "mock-secret-key"

import main as server_app


@pytest.fixture
def client():
    return TestClient(server_app.app)


@pytest.fixture
def auth_headers():
    return {"x-backend-token": "test-shared-secret-token-12345"}


class TestHealthEndpoint:
    """GET /health must be public and fast."""

    def test_health_public(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["backend"] == "server"
        assert "timestamp" in data


class TestAuthentication:
    """Routes must enforce constant-time x-backend-token authentication."""

    def test_missing_token_returns_422_or_401(self, client):
        resp = client.post("/upload", json={"filename": "test.pdf"})
        assert resp.status_code in (401, 422)

    def test_wrong_token_returns_401(self, client):
        resp = client.post(
            "/upload",
            json={"filename": "test.pdf"},
            headers={"x-backend-token": "wrong-token"},
        )
        assert resp.status_code == 401
        assert "Invalid backend token" in resp.json()["detail"]


class TestUploadEndpoint:
    """POST /upload validation and Supabase signed URL generation."""

    def test_rejects_empty_filename(self, client, auth_headers):
        resp = client.post("/upload", json={"filename": "  "}, headers=auth_headers)
        assert resp.status_code == 400

    def test_rejects_disallowed_extension(self, client, auth_headers):
        resp = client.post("/upload", json={"filename": "script.sh"}, headers=auth_headers)
        assert resp.status_code == 400
        assert "Allowed extensions" in resp.json()["detail"]

    def test_rejects_invalid_doc_type(self, client, auth_headers):
        resp = client.post(
            "/upload",
            json={"filename": "policy.pdf", "docType": "invalid_type"},
            headers=auth_headers,
        )
        assert resp.status_code == 400
        assert "docType must be one of" in resp.json()["detail"]

    @patch("main._get_supabase")
    def test_successful_upload_init(self, mock_get_sb, client, auth_headers):
        mock_sb = MagicMock()
        mock_get_sb.return_value = mock_sb

        mock_sb.storage.from_.return_value.create_signed_upload_url.return_value = {
            "signedURL": "https://storage.supabase.co/upload?token=abc"
        }
        mock_sb.table.return_value.upsert.return_value.execute.return_value = MagicMock()

        resp = client.post(
            "/upload",
            json={"filename": "dpa_agreement.pdf", "docType": "dpa"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "uploadUrl" in data
        assert "documentId" in data
        assert data["documentId"].endswith("dpa_agreement.pdf")
        assert data["uploadUrl"] == "https://storage.supabase.co/upload?token=abc"


class TestAuditStartEndpoint:
    """POST /audits/{id}/start idempotency and background task."""

    @patch("main._get_supabase")
    def test_start_audit_not_found(self, mock_get_sb, client, auth_headers):
        mock_sb = MagicMock()
        mock_get_sb.return_value = mock_sb
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
            data=None
        )

        resp = client.post("/audits/nonexistent-id/start", json={}, headers=auth_headers)
        assert resp.status_code == 404

    @patch("main._get_supabase")
    def test_start_audit_already_completed_is_idempotent(self, mock_get_sb, client, auth_headers):
        mock_sb = MagicMock()
        mock_get_sb.return_value = mock_sb
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
            data={"status": "COMPLETED"}
        )

        resp = client.post("/audits/done-id/start", json={}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "COMPLETED"

    @patch("main._get_supabase")
    def test_start_audit_already_processing(self, mock_get_sb, client, auth_headers):
        mock_sb = MagicMock()
        mock_get_sb.return_value = mock_sb
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
            data={"status": "PROCESSING"}
        )

        resp = client.post("/audits/running-id/start", json={}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "PROCESSING"

    @patch("main._get_supabase")
    def test_start_audit_starts_new_task(self, mock_get_sb, client, auth_headers):
        mock_sb = MagicMock()
        mock_get_sb.return_value = mock_sb
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
            data={"status": "AWAITING_UPLOAD"}
        )

        resp = client.post(
            "/audits/pending-id/start",
            json={"ownerId": "user-uuid-1234"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "PROCESSING"


class TestResultsEndpoint:
    """GET /results/{id} contract and state shaping."""

    @patch("main._get_supabase")
    def test_get_result_not_found(self, mock_get_sb, client, auth_headers):
        mock_sb = MagicMock()
        mock_get_sb.return_value = mock_sb
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
            data=None
        )

        resp = client.get("/results/nonexistent-id", headers=auth_headers)
        assert resp.status_code == 404

    @patch("main._get_supabase")
    def test_get_result_completed(self, mock_get_sb, client, auth_headers):
        mock_sb = MagicMock()
        mock_get_sb.return_value = mock_sb
        completed_result = {
            "DocumentId": "doc-123",
            "Status": "COMPLETED",
            "overall_score": 88,
            "OverallScore": 88,
            "Score": 88,
            "GdprScore": 90,
            "Soc2Score": 85,
            "CcpaScore": 90,
            "Iso27701Score": 87,
            "frameworks": {"gdpr": {"score": 90, "status": "COMPLIANT"}},
            "items": [],
            "risks": [],
            "owner_id": "user-uuid-1234",
        }
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
            data={"document_id": "doc-123", "status": "COMPLETED", "result": completed_result}
        )

        resp = client.get("/results/doc-123", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["Status"] == "COMPLETED"
        assert data["overall_score"] == 88
        assert data["OverallScore"] == 88
        assert data["owner_id"] == "user-uuid-1234"

    @patch("main._get_supabase")
    def test_get_result_failed(self, mock_get_sb, client, auth_headers):
        mock_sb = MagicMock()
        mock_get_sb.return_value = mock_sb
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
            data={"document_id": "doc-fail", "status": "FAILED", "error": "ExtractionError: Corrupt PDF"}
        )

        resp = client.get("/results/doc-fail", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["Status"] == "FAILED"
        assert "Corrupt PDF" in data["Error"]
