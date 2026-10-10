"""audit_service.py - Platform-neutral compliance audit execution engine.

Shared by both the Lambda serverless worker and the FastAPI secondary failover server.
Provides text extraction (PDF, DOCX, TXT), checklist resolution (Supabase with bundled fallback),
Gemini model fallback chain invocation, and compliance scoring aggregation.
"""

import io
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import date
from functools import lru_cache
from typing import List, Literal, Optional, Tuple

import audit_core as core

try:
    import pypdf
except ImportError:  # pragma: no cover
    pypdf = None

try:
    from pydantic import BaseModel
except ImportError:  # pragma: no cover
    BaseModel = None


# --------------------------------------------------------------------------- Configuration
AUDIT_MODELS = [
    m.strip()
    for m in os.environ.get(
        "AUDIT_MODELS", "gemini-2.5-flash,gemini-2.0-flash,gemini-1.5-flash"
    ).split(",")
    if m.strip()
]
AUDIT_PASSES = max(1, min(5, int(os.environ.get("AUDIT_PASSES", "1"))))
GEMINI_TIER = os.environ.get("GEMINI_TIER", "free").lower()  # free | paid
MAX_DOC_CHARS = int(os.environ.get("MAX_DOC_CHARS", "200000"))
MAX_RETRIES = int(os.environ.get("MAX_RETRIES", "3"))
SOC2_MODE = os.environ.get("SOC2_MODE", "penalize")  # penalize | unverifiable
USE_SUPABASE = os.environ.get("USE_SUPABASE", "false").lower() == "true"
ALLOWED_EXTENSIONS = (".pdf", ".docx", ".txt", ".png", ".jpg", ".jpeg")
VALID_DOC_TYPES = ("privacy_notice", "dpa", "security_policy")
BUNDLED_CHECKLIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "checklists.json")
CHECKLIST_TTL_SECONDS = 900
TRANSIENT_CODES = (429, 500, 502, 503, 504)


if BaseModel is not None:
    class ItemResult(BaseModel):
        id: str
        status: Literal["MET", "PARTIAL", "NOT_MET", "NOT_APPLICABLE"]
        document: str
        section: str
        evidence_quote: str
        note: str
        recommendation: str

    class AuditResponse(BaseModel):
        items: List[ItemResult]
else:  # pragma: no cover
    AuditResponse = None


# --------------------------------------------------------------------------- Secrets & Client
def get_secret(name: str, required: bool = True) -> Optional[str]:
    """Fetch secret from environment variables."""
    val = os.environ.get(name)
    if val:
        return val
    if required:
        raise RuntimeError(f"Missing required secret: {name}")
    return None


@lru_cache(maxsize=None)
def get_gemini_client():
    from google import genai
    api_key = get_secret("GEMINI_API_KEY")
    return genai.Client(api_key=api_key)


# --------------------------------------------------------------------------- Text Extraction
def extract_text(file_bytes: bytes, file_name: str) -> Tuple[str, bool]:
    """Return (text, is_text). is_text=False means the document must be sent as an image/scan."""
    lower = file_name.lower()
    text = ""
    try:
        if lower.endswith(".pdf") and pypdf is not None:
            reader = pypdf.PdfReader(io.BytesIO(file_bytes))
            text = "\n\n".join((page.extract_text() or "") for page in reader.pages)
        elif lower.endswith(".docx"):
            with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
                root = ET.fromstring(archive.read("word/document.xml"))
            ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
            text = "\n".join("\n".join(n.text or "" for n in p.findall(".//w:t", ns)) for p in root.findall(".//w:p", ns))
        elif lower.endswith(".txt"):
            text = file_bytes.decode("utf-8", errors="ignore")
    except Exception as error:
        print(f"Text extraction failed for {file_name}: {type(error).__name__}")
    text = text.strip()
    return (text, True) if len(text) >= 200 else ("", False)


def mime_for(name: str) -> str:
    lower = name.lower()
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    return "application/pdf"


# --------------------------------------------------------------------------- Checklist Loading
_CHECKLIST_CACHE = {"at": 0.0, "data": None}


def fetch_supabase_checklist(bundled: dict) -> dict:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not url:
        raise RuntimeError("SUPABASE_URL not set")
    key = get_secret("SUPABASE_ANON_KEY", required=False) or get_secret("SUPABASE_SECRET_KEY", required=False)
    if not key:
        raise RuntimeError("No Supabase key configured for checklist lookup")
    endpoint = f"{url}/rest/v1/compliance_requirements?select=version,payload&active=eq.true"
    req = urllib.request.Request(endpoint, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        rows = json.loads(resp.read().decode("utf-8"))
    if not rows:
        raise RuntimeError("no active rows")
    latest = max(r["version"] for r in rows)
    reqs = [r["payload"] for r in rows if r["version"] == latest]
    data = {"version": latest, "requirements": reqs, "notes": bundled.get("notes", {})}
    errors = core.validate_checklist(data)
    if errors:
        raise RuntimeError("invalid remote checklist: " + "; ".join(errors[:3]))
    if len(reqs) < 0.8 * len(bundled["requirements"]):
        raise RuntimeError(f"remote checklist too small ({len(reqs)} vs {len(bundled['requirements'])})")
    return data


def load_checklist() -> dict:
    now = time.time()
    if _CHECKLIST_CACHE["data"] and now - _CHECKLIST_CACHE["at"] < CHECKLIST_TTL_SECONDS:
        return _CHECKLIST_CACHE["data"]
    bundled = core.load_checklist_file(BUNDLED_CHECKLIST)
    data = bundled
    if USE_SUPABASE:
        try:
            data = fetch_supabase_checklist(bundled)
            data["source"] = "supabase"
        except Exception as error:
            print(f"Supabase checklist unavailable ({type(error).__name__}: {error}); using bundled checklist")
    data.setdefault("source", "bundled")
    _CHECKLIST_CACHE.update(at=now, data=data)
    return data


# --------------------------------------------------------------------------- Gemini Invocation
def _error_code(error) -> Optional[int]:
    code = getattr(error, "code", None)
    if isinstance(code, int):
        return code
    match = re.search(r"\b([45]\d\d)\b", str(error))
    return int(match.group(1)) if match else None


def _config(use_schema: bool):
    from google.genai.types import GenerateContentConfig
    kwargs = {"response_mime_type": "application/json", "temperature": 0, "max_output_tokens": 32768}
    if use_schema and AuditResponse is not None:
        kwargs["response_schema"] = AuditResponse
    return GenerateContentConfig(**kwargs)


def call_gemini(contents) -> Tuple[str, dict]:
    """Try each configured model with bounded retries. Returns (model_used, parsed_json)."""
    client = get_gemini_client()
    use_schema, last_error = True, None
    for model in AUDIT_MODELS:
        for attempt in range(MAX_RETRIES):
            try:
                response = client.models.generate_content(model=model, contents=contents, config=_config(use_schema))
                return model, core.parse_model_json(response.text)
            except ValueError as error:  # invalid / empty JSON: retry same model
                last_error = error
                continue
            except Exception as error:
                last_error = error
                code, msg = _error_code(error), str(error).lower()
                if use_schema and code == 400 and any(w in msg for w in ("schema", "default", "response_")):
                    use_schema = False
                    continue
                if code in (403, 404) or "not found" in msg or "no longer available" in msg:
                    break  # model unavailable to this key: try the next one
                if code in TRANSIENT_CODES or "timeout" in msg or "timed out" in msg:
                    if attempt == MAX_RETRIES - 1:
                        break
                    time.sleep(min(30, 4 * 2 ** attempt))
                    continue
                raise
    raise RuntimeError(f"All configured Gemini models failed: {type(last_error).__name__}: {str(last_error)[:200]}")


# --------------------------------------------------------------------------- Audit Orchestration
def run_audit(documents: List[Tuple[str, bytes]], doc_type_hint: Optional[str] = None) -> dict:
    """documents: list of (name, bytes). Returns a result dict (never fabricates a score)."""
    from google.genai.types import Part

    parsed = []
    for name, raw in documents:
        text, is_text = extract_text(raw, name)
        parsed.append({"name": name, "raw": raw, "text": text, "is_text": is_text})

    vision_mode = any(not d["is_text"] for d in parsed)
    if vision_mode and not doc_type_hint:
        raise ValueError("Scanned/image document has no extractable text; resubmit with a docType hint "
                         "(privacy_notice | dpa | security_policy) or an OCR'd text/PDF version.")

    doc_types, classifications = set(), []
    for d in parsed:
        cls = core.classify_document(d["text"], doc_type_hint)
        classifications.append({"document": d["name"], **cls})
        doc_types.update(cls["types"])

    base_meta = {
        "scoring_version": core.SCORING_VERSION,
        "as_of": date.today().isoformat(),
        "doc_types": sorted(doc_types),
        "classification": classifications,
        "soc2_mode": SOC2_MODE,
        "thresholds": {"compliant_min": core.COMPLIANT_MIN, "review_min": core.REVIEW_MIN},
        "llm_tier": GEMINI_TIER,
    }
    if GEMINI_TIER == "free":
        base_meta["llm_data_use_warning"] = (
            "Gemini API free-tier content may be used by Google to improve its products. "
            "Do not audit confidential documents on the free tier."
        )
    if not doc_types:
        return _unscored("Document type not recognised (supported: privacy_notice, dpa, security_policy).", base_meta)

    checklist = load_checklist()
    scored, unverifiable, forward = core.select_requirements(checklist, doc_types, date.today().isoformat(), SOC2_MODE)
    if not scored:
        return _unscored("No checklist requirements apply to the detected document type(s).", base_meta)

    # Build model input (text docs inline, image docs as parts), instructions last.
    per_doc_budget = max(20000, MAX_DOC_CHARS // len(parsed))
    contents, doc_texts, truncated = [], {}, []
    for d in parsed:
        if d["is_text"]:
            text = d["text"]
            if len(text) > per_doc_budget:
                text = text[:per_doc_budget]
                truncated.append(d["name"])
            doc_texts[d["name"]] = text
            contents.append(f"=== DOCUMENT: {d['name']} ===\n{text}\n=== END DOCUMENT: {d['name']} ===")
        else:
            contents.append(f"=== DOCUMENT: {d['name']} (scanned image/PDF follows) ===")
            contents.append(Part.from_bytes(data=d["raw"], mime_type=mime_for(d["name"])))
    contents.append(core.build_prompt(scored, [d["name"] for d in parsed]))

    passes, model_used, na_overrides = [], None, 0
    for _ in range(AUDIT_PASSES):
        model_used, raw = call_gemini(contents)
        normalized, notes = core.normalize_items(raw, scored)
        na_overrides += notes["na_overrides"]
        passes.append(normalized)
    results = core.aggregate_passes(passes)
    verify_stats = core.verify_items(results, scored, doc_texts, vision_mode=vision_mode)

    all_text = "\n".join(doc_texts.values())
    placeholders = core.scan_placeholders(all_text)
    basics = core.scan_basics(all_text, doc_types)
    final = core.finalize(scored, unverifiable, forward, results, placeholders, basics)

    not_evaluated = sum(1 for r in results.values() if r["status"] == "NOT_EVALUATED")
    low_agreement = sum(1 for r in results.values() if r.get("agreement", 100) < 100)
    final["meta"] = dict(
        base_meta,
        checklist_version=checklist.get("version"),
        checklist_source=checklist.get("source"),
        model=model_used,
        passes=AUDIT_PASSES,
        vision_mode=vision_mode,
        truncated_documents=truncated,
        quality={
            "not_evaluated": not_evaluated,
            "downgraded_for_evidence": verify_stats["downgraded"],
            "na_overrides": na_overrides,
            "items_with_pass_disagreement": low_agreement,
            "evidence_verifiable": not vision_mode,
        },
    )
    return final


def _unscored(reason: str, meta: dict) -> dict:
    frameworks = {
        fw: {
            "score": None,
            "status": "UNSCORED",
            "summary": reason,
            "rationale": reason,
            "counts": {},
            "critical_gaps": [],
            "coverage_pct": None,
            "disclosure_only": False,
            "unverifiable": [],
        }
        for fw in core.FRAMEWORKS
    }
    return {
        "overall_score": None,
        "frameworks": frameworks,
        "items": [],
        "risks": [],
        "forward_looking": [],
        "placeholders": [],
        "meta": dict(meta, unscored_reason=reason),
    }


def result_to_dict(key: str, result: dict, owner_id: Optional[str] = None) -> dict:
    """Format final audit result into standard backward-compatible dictionary."""
    fw = result.get("frameworks", {})
    item = {
        "DocumentId": key,
        "Status": "COMPLETED",
        "scoring_version": core.SCORING_VERSION,
        "overall_score": result.get("overall_score"),
        "OverallScore": result.get("overall_score"),
        "Score": result.get("overall_score"),
        "frameworks": fw,
        "risks": result.get("risks", []),
        "items": result.get("items", []),
        "meta": result.get("meta", {}),
        "forward_looking": result.get("forward_looking", []),
        "placeholders": result.get("placeholders", []),
        "GdprScore": fw.get("gdpr", {}).get("score"),
        "Soc2Score": fw.get("soc2", {}).get("score"),
        "CcpaScore": fw.get("ccpa", {}).get("score"),
        "Iso27701Score": fw.get("iso27701", {}).get("score"),
    }
    if owner_id:
        item["owner_id"] = owner_id
    return item
