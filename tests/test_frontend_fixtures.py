"""test_frontend_fixtures.py - Validate frontend normalization and fixture compatibility for Phase 2."""
import json
import math
import os
import pytest

FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def load_fixture(name):
    path = os.path.join(FIXTURES_DIR, name)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def normalize_audit_response_py(data):
    """Python mirror of TypeScript normalizeAuditResponse() in components/dashboard/document-auditor.tsx."""
    overall = data.get("OverallScore")
    if overall is None:
        overall = data.get("overall_score")
    if overall is None:
        overall = data.get("Score")
    if overall is not None:
        try:
            overall = float(overall)
            if math.isnan(overall):
                overall = None
        except (ValueError, TypeError):
            overall = None

    raw_fws = data.get("frameworks") or data.get("Frameworks") or {}
    if isinstance(raw_fws, str):
        try:
            raw_fws = json.loads(raw_fws)
        except Exception:
            raw_fws = {}

    frameworks = {}
    for fw in ("gdpr", "soc2", "ccpa", "iso27701"):
        fw_obj = raw_fws.get(fw) or {}
        score = fw_obj.get("score")
        if score is None:
            score = data.get(f"{fw.capitalize()}Score")
        if score is not None:
            try:
                score = float(score)
                if math.isnan(score):
                    score = None
            except (ValueError, TypeError):
                score = None

        explicit_status = (fw_obj.get("status") or "").upper().strip()
        if explicit_status in ("COMPLIANT", "NEEDS_REVIEW", "NON_COMPLIANT", "UNSCORED"):
            status = explicit_status
        elif score is None:
            status = "UNSCORED"
        elif score >= 80:
            status = "COMPLIANT"
        elif score >= 60:
            status = "NEEDS_REVIEW"
        else:
            status = "NON_COMPLIANT"

        frameworks[fw] = {
            "score": score,
            "status": status,
            "summary": fw_obj.get("summary", ""),
            "rationale": fw_obj.get("rationale", ""),
            "coverage_pct": fw_obj.get("coverage_pct"),
            "critical_gaps": fw_obj.get("critical_gaps", []),
            "unverifiable": fw_obj.get("unverifiable", []),
            "disclosure_only": bool(fw_obj.get("disclosure_only", False)),
        }

    return {
        "overall_score": overall,
        "frameworks": frameworks,
        "risks": data.get("risks") or [],
        "items": data.get("items") or [],
        "meta": data.get("meta") or {},
    }


def test_fixture_completed():
    data = load_fixture("audit_completed.json")
    assert data["Status"] == "COMPLETED"

    normalized = normalize_audit_response_py(data)
    assert normalized["overall_score"] == 82
    assert normalized["overall_score"] is not None
    assert not math.isnan(normalized["overall_score"])

    fws = normalized["frameworks"]
    assert fws["gdpr"]["score"] == 85
    assert fws["soc2"]["score"] == 75
    assert fws["soc2"]["disclosure_only"] is True
    assert fws["soc2"]["critical_gaps"] == ["CC6.1 Access controls"]
    assert fws["ccpa"]["score"] == 90
    assert fws["iso27701"]["score"] == 78

    items = {i["id"]: i for i in normalized["items"]}
    assert len(items) == 3
    assert items["gdpr.13_1_b"]["status"] == "MET"
    assert items["gdpr.13_1_b"]["evidence_verified"] is True
    assert items["gdpr.13_2_a"]["downgraded_from"] == "MET"
    assert items["gdpr.13_2_a"]["evidence_verified"] is False

    assert "llm_data_use_warning" in normalized["meta"]
    assert "free-tier" in normalized["meta"]["llm_data_use_warning"].lower()


def test_fixture_unscored_never_renders_nan_or_defaulted_zero():
    data = load_fixture("audit_unscored.json")
    assert data["Status"] == "COMPLETED"

    normalized = normalize_audit_response_py(data)
    # MUST be None, not 0 and not NaN
    assert normalized["overall_score"] is None

    fws = normalized["frameworks"]
    for fw_name, fw in fws.items():
        assert fw["score"] is None, f"{fw_name} score should be None"
        assert fw["status"] == "UNSCORED", f"{fw_name} status should be UNSCORED"
        assert not math.isnan(fw["score"] or 0)

    assert "unscored_reason" in normalized["meta"]
    assert "not recognised" in normalized["meta"]["unscored_reason"].lower()


def test_fixture_failed():
    data = load_fixture("audit_failed.json")
    assert data["Status"] == "FAILED"
    assert "ResourceExhausted" in data["Error"]

