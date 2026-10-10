import json, os, sys
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "terraform", "lambda_src"))
import audit_core as core

CHECKLIST = core.load_checklist_file(os.path.join(ROOT, "terraform", "lambda_src", "checklists.json"))


def mk(rid, fw="gdpr", w=2, crit=False, docs=("privacy_notice",), na=False, must=None, eff=None, pd=False):
    return {"id": rid, "framework": fw, "citation": "X", "title": rid, "looks_for": "lf", "partial": "",
            "assessable_in": list(docs), "weight": w, "critical": crit, "na_allowed": na, "na_when": "",
            "public_disclosure_expected": pd, "effective_from": eff, "must_match": must, "active": True}


def res(status, doc="d", quote="", **kw):
    return dict({"id": "", "status": status, "document": doc, "section": "S", "evidence_quote": quote,
                 "note": "", "recommendation": ""}, **kw)


def test_checklist_is_valid_and_covers_all_frameworks():
    assert core.validate_checklist(CHECKLIST) == []
    assert {r["framework"] for r in CHECKLIST["requirements"]} == set(core.FRAMEWORKS)
    assert len(CHECKLIST["requirements"]) > 100


def test_validate_catches_duplicates_and_bad_weight():
    bad = {"requirements": [mk("a"), mk("a", w=9)]}
    errs = core.validate_checklist(bad)
    assert any("duplicate" in e for e in errs) and any("weight" in e for e in errs)


def test_scoring_is_weighted_and_na_excluded():
    reqs = [mk("a", w=3), mk("b", w=1), mk("c", w=2, na=True)]
    results = {"a": res("MET"), "b": res("NOT_MET"), "c": res("NOT_APPLICABLE")}
    out = core.score_framework("gdpr", reqs, [], results)
    assert out["score"] == 75  # (3*1 + 1*0) / 4
    assert out["counts"]["not_applicable"] == 1


def test_partial_counts_half():
    out = core.score_framework("gdpr", [mk("a", w=2)], [], {"a": res("PARTIAL")})
    assert out["score"] == 50 and out["status"] == "NON_COMPLIANT"


def test_critical_gap_caps_status_below_compliant():
    reqs = [mk("a", w=3), mk("b", w=3, crit=True), mk("c", w=3), mk("d", w=3), mk("e", w=3), mk("f", w=3),
            mk("g", w=3), mk("h", w=3), mk("i", w=3), mk("j", w=3)]
    results = {r["id"]: res("MET") for r in reqs}
    results["b"] = res("NOT_MET")
    out = core.score_framework("gdpr", reqs, [], results)
    assert out["score"] == 90 and out["status"] == "NEEDS_REVIEW" and out["critical_gaps"] == ["b"]


def test_placeholders_cap_status():
    out = core.score_framework("gdpr", [mk("a")], [], {"a": res("MET")}, cap_review=True)
    assert out["score"] == 100 and out["status"] == "NEEDS_REVIEW"


def test_no_assessable_items_is_unscored_not_defaulted():
    out = core.score_framework("soc2", [], [mk("x", fw="soc2")], {})
    assert out["score"] is None and out["status"] == "UNSCORED"


def test_overall_is_mean_of_scored_frameworks_only():
    scored = [mk("g1"), mk("c1", fw="ccpa")]
    results = {"g1": res("MET"), "c1": res("NOT_MET")}
    final = core.finalize(scored, [], [], results, [], [])
    assert final["overall_score"] == 50
    assert final["frameworks"]["soc2"]["status"] == "UNSCORED"


def test_quote_verification_exact_fuzzy_and_negative():
    text = "We retain your Personal Data as long as your account is active, and as needed to comply with law."
    assert core.quote_in_text("retain your personal data as long as your account is active", text)
    assert core.quote_in_text("We retain your Personal Data as long as your account is active and as needed to comply", text)
    assert not core.quote_in_text("We delete all data after exactly thirty days of inactivity", text)
    assert not core.quote_in_text("short", text)

    # 350-character list-type quote test case
    list_quote_350 = (
        "Categories of Personal Data processed include: (1) identity data such as name, email address, and physical address; "
        "(2) technical connection data including IP address, browser user-agent, device identifier, and operating system details; "
        "(3) commercial transaction history including purchase timestamps, billing records, and raw payment method tokens;"
    )
    list_doc = (
        "Privacy Policy Overview.\n"
        "Categories of Personal Data processed include: (1) identity data such as name, email address, and physical address; "
        "(2) technical connection data including IP address, browser user-agent, device identifier, and operating system details; "
        "(3) commercial transaction history including purchase timestamps, billing records, and raw payment method tokens; "
        "and (4) customer feedback surveys."
    )
    assert len(list_quote_350) == 350
    assert core.quote_in_text(list_quote_350, list_doc)


def test_unverified_evidence_is_downgraded_and_must_match_enforced():
    reqs = [mk("a"), mk("b", must=r"data protection officer"), mk("c")]
    doc = {"d": "We retain data as long as the account is active and needed for legal obligations."}
    results = {"a": res("MET", quote="We retain data as long as the account is active"),
               "b": res("MET", quote="Contact our DPO at dpo@example.com"),
               "c": res("MET", quote="We guarantee deletion within thirty days always")}
    stats = core.verify_items(results, reqs, doc)
    assert results["a"]["status"] == "MET" and results["a"]["evidence_verified"] is True
    assert results["b"]["status"] == "NOT_MET"          # hard regex failed
    assert results["c"]["status"] == "PARTIAL"          # quote not found -> one level down
    assert stats["downgraded"] == 2


def test_vision_mode_skips_quote_verification():
    reqs = [mk("a")]
    results = {"a": res("MET", quote="anything")}
    core.verify_items(results, reqs, {}, vision_mode=True)
    assert results["a"]["status"] == "MET" and results["a"]["evidence_verified"] is None


def test_normalize_blocks_na_abuse_drops_unknown_and_flags_missing():
    reqs = [mk("a", na=False), mk("b", na=True)]
    raw = {"items": [{"id": "a", "status": "NOT_APPLICABLE"}, {"id": "b", "status": "NOT_APPLICABLE"}, {"id": "zzz", "status": "MET"}]}
    out, notes = core.normalize_items(raw, reqs)
    assert out["a"]["status"] == "NOT_MET" and out["b"]["status"] == "NOT_APPLICABLE"
    assert notes == {"na_overrides": 1, "unknown_ids": 1}


def test_normalize_fails_loudly_when_model_skips_many():
    reqs = [mk(str(i)) for i in range(10)]
    with pytest.raises(ValueError):
        core.normalize_items({"items": [{"id": "0", "status": "MET"}]}, reqs)


def test_aggregate_uses_conservative_median():
    p1, p2, p3 = ({"a": res("MET")}, {"a": res("PARTIAL")}, {"a": res("MET")})
    out = core.aggregate_passes([p1, p2, p3])
    assert out["a"]["status"] == "MET" and out["a"]["agreement"] == 67
    out2 = core.aggregate_passes([{"a": res("MET")}, {"a": res("NOT_MET")}])
    assert out2["a"]["status"] == "NOT_MET"


def test_forward_looking_and_soc2_modes():
    types = ["privacy_notice"]
    scored, unver, fwd = core.select_requirements(CHECKLIST, types, "2026-10-05", "penalize")
    assert any(r["id"] == "ccpa.admt" for r in fwd)
    soc2 = [r for r in scored if r["framework"] == "soc2"]
    assert soc2 and all(r["disclosure_only"] for r in soc2)
    scored2, _, _ = core.select_requirements(CHECKLIST, types, "2026-10-05", "unverifiable")
    assert not [r for r in scored2 if r["framework"] == "soc2"]
    scored3, _, fwd3 = core.select_requirements(CHECKLIST, types, "2027-02-01", "penalize")
    assert any(r["id"] == "ccpa.admt" for r in scored3) and not fwd3


def test_placeholder_scan_ignores_email_obfuscation():
    ok = "Email dpo[at]github[dot]com for questions. Effective date: April 27, 2026."
    assert core.scan_placeholders(ok) == []
    bad = "Effective [DATE]. Contact {{COMPANY_NAME}} or [INSERT DPO EMAIL]. TBD"
    tokens = {p["token"] for p in core.scan_placeholders(bad)}
    assert "[DATE]" in tokens and "{{COMPANY_NAME}}" in tokens and any("INSERT" in t for t in tokens)


def test_classifier_multilabel_and_unknown():
    pn = "Privacy Statement. Personal data we collect. Your privacy rights. Cookies. Lawful bases. Data subjects."
    assert "privacy_notice" in core.classify_document(pn)["types"]
    dpa = "Data Processing Agreement. The Processor acts on documented instructions of the Controller. Sub-processors. Standard Contractual Clauses."
    assert core.classify_document(dpa)["types"] == ["dpa"]
    assert core.classify_document("Lunch menu: soup and salad")["types"] == []
    assert core.classify_document("anything", hint="dpa")["types"] == ["dpa"]


def test_risks_order_and_severity():
    scored = [mk("a", w=3, crit=True), mk("b", w=1), mk("c", w=2)]
    results = {"a": res("NOT_MET"), "b": res("NOT_MET"), "c": res("PARTIAL")}
    risks = core.build_risks(scored, results, [{"token": "[DATE]", "line": 3}], [])
    assert risks[0]["severity"] == "CRITICAL" and "placeholder" in risks[0]["issue"].lower()
    assert risks[1]["requirement_id"] == "a" and risks[1]["severity"] == "CRITICAL"
    assert {r["requirement_id"]: r["severity"] for r in risks}["c"] == "LOW"


def test_to_dynamo_converts_floats():
    from decimal import Decimal
    out = core.to_dynamo({"a": 1.5, "b": [2.25, {"c": 3}], "d": None})
    assert out["a"] == Decimal("1.5") and out["b"][0] == Decimal("2.25") and out["d"] is None


def test_scan_basics_recognises_updated_day_month_year():
    text = "Privacy Notice.\nUpdated: 6 February 2026\nContact us at privacy@example.com"
    out = core.scan_basics(text, ["privacy_notice"])
    assert not any(r["id"] == "basic.effective_date" for r in out)


def test_gdpr_13_1_f_transfer_mechanism_passes_must_match():
    checklist = core.load_checklist_file(os.path.join(ROOT, "terraform", "lambda_src", "checklists.json"))
    req = next(r for r in checklist["requirements"] if r["id"] == "gdpr.13_1_f")
    assert req["must_match"] is not None
    quote = "We rely on legally valid transfer mechanisms to transfer Personal Data across borders."
    import re
    assert re.search(req["must_match"], quote, flags=re.IGNORECASE) is not None

