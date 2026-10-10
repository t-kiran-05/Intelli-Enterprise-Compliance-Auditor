import io, json, os, re, sys, zipfile
import pytest
from botocore.exceptions import ClientError

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "terraform", "lambda_src"))
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
import index  # noqa: E402

REAL_CALL_GEMINI = index.call_gemini

NOTICE = (
    "Acme Privacy Statement. Effective date: April 27, 2026.\n"
    "This Privacy Statement explains the personal data we collect and your privacy rights. "
    "Acme Ltd, 1 Main Street, Dublin is the controller. Contact our Data Protection Officer at dpo[at]acme[dot]com.\n"
    "Lawful bases: contractual necessity and legitimate interests. We use cookies. Data subjects may object.\n"
    "You may lodge a complaint with a supervisory authority. We retain your data as long as your account is active.\n"
    "Do not sell or share: we honour the Global Privacy Control signal.\n"
) * 2


class FakeTable:
    def __init__(self):
        self.items = {}

    def get_item(self, Key):
        it = self.items.get(Key["DocumentId"])
        return {"Item": it} if it else {}

    def put_item(self, Item, ConditionExpression=None, **kw):
        existing = self.items.get(Item["DocumentId"])
        if ConditionExpression and existing and existing.get("Status") not in ("AWAITING_UPLOAD", "FAILED"):
            raise ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "PutItem")
        self.items[Item["DocumentId"]] = Item


class FakeBody:
    def __init__(self, b): self.b = b
    def read(self): return self.b


class FakeS3:
    def __init__(self, data): self.data = data
    def get_object(self, Bucket, Key): return {"Body": FakeBody(self.data[Key])}
    def generate_presigned_url(self, *a, **k): return "https://example.invalid/presigned"


def fake_gemini_factory(all_met=True):
    calls = {"n": 0}

    def fake(contents):
        calls["n"] += 1
        prompt = contents[-1]
        ids = re.findall(r'^\{"id": "([^"]+)"', prompt, flags=re.M)
        items = []
        for rid in ids:
            if rid == "gdpr.13_1_b":
                items.append({"id": rid, "status": "MET", "document": "n.txt", "section": "Intro",
                              "evidence_quote": "Contact our Data Protection Officer at dpo[at]acme[dot]com", "note": "", "recommendation": ""})
            elif rid == "gdpr.13_2_a":
                items.append({"id": rid, "status": "MET", "document": "n.txt", "section": "Retention",
                              "evidence_quote": "We guarantee deletion after thirty days", "note": "", "recommendation": ""})  # fabricated
            else:
                items.append({"id": rid, "status": "NOT_MET", "document": "", "section": "", "evidence_quote": "",
                              "note": "", "recommendation": "Add it."})
        return "mock-model", {"items": items}
    fake.calls = calls
    return fake


@pytest.fixture
def env(monkeypatch):
    table = FakeTable()
    monkeypatch.setattr(index, "get_table", lambda: table)
    monkeypatch.setattr(index, "call_gemini", fake_gemini_factory())
    index._CHECKLIST_CACHE.update(at=0.0, data=None)
    return table, monkeypatch


def s3_event(key):
    return {"Records": [{"s3": {"bucket": {"name": "b"}, "object": {"key": key}}}]}


def test_end_to_end_scores_computed_in_code_and_fabricated_evidence_downgraded(env):
    table, mp = env
    mp.setattr(index, "get_s3", lambda: FakeS3({"uploads/abc/n.txt": NOTICE.encode()}))
    out = index.handler(s3_event("uploads/abc/n.txt"), None)
    assert out["statusCode"] == 200
    item = table.items["uploads/abc/n.txt"]
    assert item["Status"] == "COMPLETED"
    items = {i["id"]: i for i in item["items"]}
    assert items["gdpr.13_1_b"]["status"] == "MET" and items["gdpr.13_1_b"]["evidence_verified"] is True
    assert items["gdpr.13_2_a"]["status"] == "PARTIAL" and items["gdpr.13_2_a"]["downgraded_from"] == "MET"
    assert item["frameworks"]["gdpr"]["score"] is not None
    assert item["frameworks"]["gdpr"]["status"] in ("NON_COMPLIANT", "NEEDS_REVIEW")
    assert item["frameworks"]["soc2"]["disclosure_only"] is True
    assert item["meta"]["llm_data_use_warning"]
    assert item["GdprScore"] == item["frameworks"]["gdpr"]["score"]


def test_duplicate_s3_event_is_idempotent(env):
    table, mp = env
    mp.setattr(index, "get_s3", lambda: FakeS3({"uploads/abc/n.txt": NOTICE.encode()}))
    fake = fake_gemini_factory(); mp.setattr(index, "call_gemini", fake)
    index.handler(s3_event("uploads/abc/n.txt"), None)
    index.handler(s3_event("uploads/abc/n.txt"), None)
    assert fake.calls["n"] == 1


def test_unrecognised_document_is_unscored_not_defaulted(env):
    table, mp = env
    junk = ("Lunch menu: soup, salad and bread. " * 20).encode()
    mp.setattr(index, "get_s3", lambda: FakeS3({"uploads/x/menu.txt": junk}))
    index.handler(s3_event("uploads/x/menu.txt"), None)
    item = table.items["uploads/x/menu.txt"]
    assert item["Status"] == "COMPLETED" and item["OverallScore"] is None
    assert all(v["status"] == "UNSCORED" for v in item["frameworks"].values())


def test_placeholder_is_critical_risk(env):
    table, mp = env
    doc = (NOTICE + "\nEffective [DATE]. Controller: [COMPANY_NAME].").encode()
    mp.setattr(index, "get_s3", lambda: FakeS3({"uploads/p/n.txt": doc}))
    index.handler(s3_event("uploads/p/n.txt"), None)
    item = table.items["uploads/p/n.txt"]
    assert item["risks"][0]["severity"] == "CRITICAL" and "placeholder" in item["risks"][0]["issue"].lower()


def test_failure_is_recorded_and_retryable(env):
    table, mp = env
    mp.setattr(index, "get_s3", lambda: FakeS3({"uploads/f/n.txt": NOTICE.encode()}))
    def boom(contents): raise RuntimeError("quota")
    mp.setattr(index, "call_gemini", boom)
    out = index.handler(s3_event("uploads/f/n.txt"), None)
    assert out["statusCode"] == 500 and table.items["uploads/f/n.txt"]["Status"] == "FAILED"
    mp.setattr(index, "call_gemini", fake_gemini_factory())
    index.handler(s3_event("uploads/f/n.txt"), None)  # FAILED rows may be re-claimed
    assert table.items["uploads/f/n.txt"]["Status"] == "COMPLETED"


def api(method, path, body=None, headers=None):
    return {"requestContext": {"httpMethod": method}, "rawPath": path, "path": path,
            "body": json.dumps(body) if body is not None else None, "headers": headers or {}}


def test_upload_route_unique_key_sanitises_and_stores_hint(env):
    table, mp = env
    mp.setattr(index, "get_s3", lambda: FakeS3({}))
    r = index.handler(api("POST", "/upload", {"filename": "../../my doc?.pdf", "docType": "dpa"}), None)
    body = json.loads(r["body"])
    assert r["statusCode"] == 200 and body["documentId"].startswith("uploads/") and ".." not in body["documentId"]
    assert table.items[body["documentId"]]["DocTypeHint"] == "dpa"
    assert index.handler(api("POST", "/upload", {"filename": "evil.exe"}), None)["statusCode"] == 400
    assert index.handler(api("POST", "/upload", {"filename": "a.pdf", "docType": "bogus"}), None)["statusCode"] == 400


def test_agreement_audit_rejects_foreign_keys(env):
    r = index.handler(api("POST", "/agreement-audit", {"groupId": "g", "documentIds": ["secrets/a.pdf", "uploads/b.pdf"]}), None)
    assert r["statusCode"] == 400


def test_api_token_gate(env, monkeypatch):
    monkeypatch.setenv("API_TOKEN", "s3cret")
    assert index.handler(api("GET", "/results/x"), None)["statusCode"] == 401
    assert index.handler(api("GET", "/results/x", headers={"x-api-token": "s3cret"}), None)["statusCode"] == 404


def test_supabase_failure_falls_back_to_bundled_checklist(env, monkeypatch):
    monkeypatch.setattr(index, "USE_SUPABASE", True)
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    index._CHECKLIST_CACHE.update(at=0.0, data=None)
    data = index.load_checklist()
    assert data["source"] == "bundled" and len(data["requirements"]) > 100


def test_secrets_are_never_defaulted(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("SSM_PREFIX", raising=False)
    index.get_secret.cache_clear()
    with pytest.raises(RuntimeError):
        index.get_secret("GEMINI_API_KEY")


def test_end_to_end_docx_fixture(env):
    table, mp = env
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        paragraphs = "".join(f"<w:p><w:r><w:t>{line}</w:t></w:r></w:p>" for line in NOTICE.split("\n"))
        xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            f'<w:body>{paragraphs}</w:body>'
            '</w:document>'
        )
        z.writestr("word/document.xml", xml)
    docx_bytes = buf.getvalue()
    mp.setattr(index, "get_s3", lambda: FakeS3({"uploads/abc/n.docx": docx_bytes}))
    out = index.handler(s3_event("uploads/abc/n.docx"), None)
    assert out["statusCode"] == 200
    item = table.items["uploads/abc/n.docx"]
    assert item["Status"] == "COMPLETED"
    assert item["frameworks"]["gdpr"]["score"] is not None


def test_end_to_end_pdf_fixture(env):
    table, mp = env
    clean = NOTICE.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").replace("\n", " ")
    stream = f"BT /F1 12 Tf 72 712 Td ({clean}) Tj ET"
    stream_len = len(stream.encode("latin-1"))
    pdf = (
        "%PDF-1.4\n"
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n"
        f"4 0 obj << /Length {stream_len} >> stream\n"
        f"{stream}\n"
        "endstream endobj\n"
        "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n"
        "xref\n"
        "0 6\n"
        "0000000000 65535 f \n"
        "0000000009 00000 n \n"
        "0000000058 00000 n \n"
        "0000000115 00000 n \n"
        "0000000244 00000 n \n"
        "0000000300 00000 n \n"
        "trailer << /Size 6 /Root 1 0 R >>\n"
        "startxref\n"
        "365\n"
        "%%EOF\n"
    ).encode("latin-1")
    mp.setattr(index, "get_s3", lambda: FakeS3({"uploads/abc/n.pdf": pdf}))
    out = index.handler(s3_event("uploads/abc/n.pdf"), None)
    assert out["statusCode"] == 200
    item = table.items["uploads/abc/n.pdf"]
    assert item["Status"] == "COMPLETED"
    assert item["frameworks"]["gdpr"]["score"] is not None


def test_audit_models_default_contains_no_lite():
    """Verify that no model ID containing 'lite' appears in AUDIT_MODELS default."""
    for model in index.AUDIT_MODELS:
        assert "lite" not in model.lower(), f"Forbidden lite model found in AUDIT_MODELS: {model}"
    assert "gemini-2.5-flash" in index.AUDIT_MODELS


def test_gemini_429_triggers_backoff_on_same_model(env, monkeypatch):
    """Verify that a 429 from Gemini triggers backoff on the SAME model, not an immediate model switch."""
    table, mp = env
    model_attempts = []
    slept_durations = []

    class Mock429Error(Exception):
        code = 429

    class MockGenAiClient:
        class models:
            @staticmethod
            def generate_content(model, contents, config=None):
                model_attempts.append(model)
                if len(model_attempts) == 1:
                    raise Mock429Error("Resource has been exhausted (e.g. check quota) 429")
                # Second attempt succeeds on same model
                from unittest.mock import MagicMock
                resp = MagicMock()
                resp.text = json.dumps({"items": []})
                return resp

    monkeypatch.setattr(index, "call_gemini", REAL_CALL_GEMINI)
    monkeypatch.setattr(index, "get_client", lambda: MockGenAiClient)
    monkeypatch.setattr(index.time, "sleep", lambda s: slept_durations.append(s))
    monkeypatch.setattr(index.gemini_limiter, "acquire", lambda m: None)

    model_used, result = index.call_gemini(["test content"])

    assert len(model_attempts) == 2
    assert model_attempts[0] == model_attempts[1], "Retried on different model instead of SAME model"
    assert len(slept_durations) == 1
    assert slept_durations[0] == 4  # 4 * (2 ** 0)
    assert model_used == model_attempts[0]


def test_all_models_rpd_exhausted_returns_500_with_clear_error(env, monkeypatch):
    """Verify that when all models are RPD-exhausted, the handler returns 500 with a clear error."""
    table, mp = env

    def mock_exhausted(model):
        import gemini_limiter
        raise gemini_limiter.RateLimitExhausted(f"Daily limit reached for {model}")

    monkeypatch.setattr(index, "call_gemini", REAL_CALL_GEMINI)
    monkeypatch.setattr(index.gemini_limiter, "acquire", mock_exhausted)
    mp.setattr(index, "get_s3", lambda: FakeS3({"uploads/abc/n.txt": NOTICE.encode("utf-8")}))

    out = index.handler({
        "Records": [{
            "s3": {
                "bucket": {"name": "enterprise-compliance-vault-2026"},
                "object": {"key": "uploads/abc/n.txt"}
            }
        }]
    }, None)

    assert out["statusCode"] == 500
    item = table.items["uploads/abc/n.txt"]
    assert item["Status"] == "FAILED"
    assert "All configured Gemini models exhausted for today" in item["Error"]


