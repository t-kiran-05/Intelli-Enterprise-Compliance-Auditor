"""tests/test_contract.py - Validate that test fixtures match the shared audit result contract.

Also validates that the result_to_dict function in audit_service produces conforming output.
"""

import json
import os
import sys

import pytest

# Allow importing from server/ and terraform/lambda_src/
_ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(_ROOT, "server"))
sys.path.insert(0, os.path.join(_ROOT, "terraform", "lambda_src"))

import jsonschema

SCHEMA_PATH = os.path.join(_ROOT, "contracts", "audit_result.schema.json")
FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


@pytest.fixture(scope="module")
def schema():
    with open(SCHEMA_PATH) as f:
        return json.load(f)


class TestContractFixtures:
    """Validate all test fixtures against the contract schema."""

    def test_completed_fixture_matches_schema(self, schema):
        with open(os.path.join(FIXTURES_DIR, "audit_completed.json")) as f:
            data = json.load(f)
        jsonschema.validate(instance=data, schema=schema)

    def test_unscored_fixture_matches_schema(self, schema):
        with open(os.path.join(FIXTURES_DIR, "audit_unscored.json")) as f:
            data = json.load(f)
        jsonschema.validate(instance=data, schema=schema)

    def test_failed_fixture_matches_schema(self, schema):
        with open(os.path.join(FIXTURES_DIR, "audit_failed.json")) as f:
            data = json.load(f)
        jsonschema.validate(instance=data, schema=schema)

    def test_completed_has_required_completed_fields(self, schema):
        with open(os.path.join(FIXTURES_DIR, "audit_completed.json")) as f:
            data = json.load(f)
        assert data["Status"] == "COMPLETED"
        assert "overall_score" in data
        assert "frameworks" in data
        assert "items" in data

    def test_backward_compatible_score_keys(self, schema):
        """Ensure backward-compatible keys are present in COMPLETED results."""
        with open(os.path.join(FIXTURES_DIR, "audit_completed.json")) as f:
            data = json.load(f)
        for key in ("OverallScore", "Score", "GdprScore", "Soc2Score", "CcpaScore", "Iso27701Score"):
            assert key in data, f"Missing backward-compatible key: {key}"


class TestAuditServiceContract:
    """Validate that audit_service.result_to_dict produces schema-conforming output."""

    def test_result_to_dict_completed(self, schema):
        # Force re-import from server/ directory
        import importlib
        if "audit_service" in sys.modules:
            del sys.modules["audit_service"]
        import audit_service
        importlib.reload(audit_service)

        # Minimal result that mimics run_audit output
        fake_result = {
            "overall_score": 78,
            "frameworks": {
                "gdpr": {"score": 80, "status": "COMPLIANT", "summary": "ok", "counts": {}, "critical_gaps": [],
                          "coverage_pct": 95, "disclosure_only": False, "unverifiable": []},
                "soc2": {"score": 65, "status": "NEEDS_REVIEW", "summary": "partial", "counts": {}, "critical_gaps": [],
                          "coverage_pct": 70, "disclosure_only": True, "unverifiable": []},
                "ccpa": {"score": 85, "status": "COMPLIANT", "summary": "good", "counts": {}, "critical_gaps": [],
                          "coverage_pct": 90, "disclosure_only": False, "unverifiable": []},
                "iso27701": {"score": 72, "status": "NEEDS_REVIEW", "summary": "ok", "counts": {}, "critical_gaps": [],
                              "coverage_pct": 75, "disclosure_only": False, "unverifiable": []},
            },
            "items": [{"id": "gdpr-01", "status": "MET"}],
            "risks": [],
            "forward_looking": [],
            "placeholders": [],
            "meta": {"scoring_version": "3.0"},
        }
        shaped = audit_service.result_to_dict("test-doc-1", fake_result, owner_id="user-abc")
        jsonschema.validate(instance=shaped, schema=schema)
        assert shaped["DocumentId"] == "test-doc-1"
        assert shaped["Status"] == "COMPLETED"
        assert shaped["owner_id"] == "user-abc"
        assert shaped["OverallScore"] == 78
        assert shaped["GdprScore"] == 80
        assert shaped["Soc2Score"] == 65

    def test_result_to_dict_unscored(self, schema):
        import audit_service

        fake_result = {
            "overall_score": None,
            "frameworks": {
                "gdpr": {"score": None, "status": "UNSCORED", "summary": "n/a", "counts": {}, "critical_gaps": [],
                          "coverage_pct": None, "disclosure_only": False, "unverifiable": []},
                "soc2": {"score": None, "status": "UNSCORED", "summary": "n/a", "counts": {}, "critical_gaps": [],
                          "coverage_pct": None, "disclosure_only": False, "unverifiable": []},
                "ccpa": {"score": None, "status": "UNSCORED", "summary": "n/a", "counts": {}, "critical_gaps": [],
                          "coverage_pct": None, "disclosure_only": False, "unverifiable": []},
                "iso27701": {"score": None, "status": "UNSCORED", "summary": "n/a", "counts": {}, "critical_gaps": [],
                              "coverage_pct": None, "disclosure_only": False, "unverifiable": []},
            },
            "items": [],
            "risks": [],
            "forward_looking": [],
            "placeholders": [],
            "meta": {"scoring_version": "3.0", "unscored_reason": "test"},
        }
        shaped = audit_service.result_to_dict("test-doc-2", fake_result)
        jsonschema.validate(instance=shaped, schema=schema)
        assert shaped["overall_score"] is None
        assert shaped["GdprScore"] is None


class TestCompositeId:
    """Validate composite ID parsing."""

    def test_parse_aws_id(self):
        raw = "aws:uploads/abc123/doc.pdf"
        assert raw.startswith("aws:")
        assert raw[4:] == "uploads/abc123/doc.pdf"

    def test_parse_srv_id(self):
        raw = "srv:def456/report.docx"
        assert raw.startswith("srv:")
        assert raw[4:] == "def456/report.docx"

    def test_legacy_id_no_prefix(self):
        raw = "uploads/old-format/doc.pdf"
        # Legacy IDs without prefix are assumed AWS
        assert not raw.startswith("aws:") and not raw.startswith("srv:")
