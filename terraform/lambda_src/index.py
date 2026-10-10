"""index.py - AWS Lambda entrypoint for the compliance audit platform (v2).

What changed vs v1
  * The LLM only CLASSIFIES checklist items (with verbatim evidence). Scores/status/risks are computed in
    audit_core.py. No defaulted/fabricated scores: unassessable frameworks return score=None, status=UNSCORED.
  * No secrets in code. Secrets come from environment variables or AWS SSM Parameter Store.
  * Model names are configuration with a fallback chain (Gemini IDs are retired regularly).
  * Checklist is loaded from Supabase (optional, versioned) with a bundled JSON fallback, so a paused
    Supabase free project can never break an audit.
  * S3 keys are unique, uploads are idempotent, agreement keys are prefix-restricted, CORS/auth hooks exist.
"""
import hmac
import io
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
import zipfile
from datetime import date
from functools import lru_cache
from typing import List, Literal

import boto3
from botocore.exceptions import ClientError

import audit_core as core
import gemini_limiter

try:
    import pypdf
except ImportError:  # pragma: no cover
    pypdf = None

try:
    from pydantic import BaseModel
except ImportError:  # pragma: no cover
    BaseModel = None

# --------------------------------------------------------------------------- configuration
TABLE_NAME = os.environ.get("TABLE_NAME", "ComplianceAuditLogs")
BUCKET_NAME = os.environ.get("BUCKET_NAME", "enterprise-compliance-vault-2026")
# Gemini models fallback chain. Only gemini-2.5-flash allowed on free tier.
# gemini-2.5-pro can be added via AUDIT_MODELS env var with a paid key.
AUDIT_MODELS = [m.strip() for m in os.environ.get(
    "AUDIT_MODELS", "gemini-2.5-flash").split(",") if m.strip()]
# Rate limits: stay 1 below free limits (10 RPM / 500 RPD)
GEMINI_RPM = int(os.environ.get("GEMINI_RPM", "9"))
GEMINI_RPD = int(os.environ.get("GEMINI_RPD", "450"))
AUDIT_PASSES = max(1, min(5, int(os.environ.get("AUDIT_PASSES", "1"))))
GEMINI_TIER = os.environ.get("GEMINI_TIER", "free").lower()  # free | paid
MAX_DOC_CHARS = int(os.environ.get("MAX_DOC_CHARS", "200000"))
MAX_RETRIES = int(os.environ.get("MAX_RETRIES", "3"))
SOC2_MODE = os.environ.get("SOC2_MODE", "penalize")  # penalize | unverifiable
USE_SUPABASE = os.environ.get("USE_SUPABASE", "false").lower() == "true"
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
UNIQUE_KEYS = os.environ.get("UNIQUE_KEYS", "true").lower() == "true"
ALLOWED_KEY_PREFIXES = ("agreements/", "uploads/")
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


# --------------------------------------------------------------------------- clients & secrets (lazy)
@lru_cache(maxsize=None)
def get_s3():
    return boto3.client("s3")


@lru_cache(maxsize=None)
def get_ddb():
    return boto3.resource("dynamodb")


@lru_cache(maxsize=None)
def get_lambda():
    return boto3.client("lambda")


@lru_cache(maxsize=None)
def get_ssm():
    return boto3.client("ssm")


@lru_cache(maxsize=None)
def get_secretsmanager():
    return boto3.client("secretsmanager")


@lru_cache(maxsize=None)
def get_secret(name, required=True):
    """Order: env var -> SSM Parameter Store ($SSM_PREFIX/<name>) -> AWS Secrets Manager ($SECRETS_MANAGER_ID,
    either a JSON object {"GEMINI_API_KEY": "..."} or, for GEMINI_API_KEY only, a plain-string secret)."""
    value = os.environ.get(name)
    if value:
        return value
    prefix = os.environ.get("SSM_PREFIX")
    if prefix:
        try:
            resp = get_ssm().get_parameter(Name=f"{prefix.rstrip('/')}/{name}", WithDecryption=True)
            return resp["Parameter"]["Value"]
        except ClientError as error:
            print(f"SSM lookup failed for {name}: {error.response['Error']['Code']}")
    sm_id = os.environ.get("SECRETS_MANAGER_ID")
    if sm_id:
        try:
            raw = get_secretsmanager().get_secret_value(SecretId=sm_id)["SecretString"]
            try:
                data = json.loads(raw)
            except ValueError:
                data = None
            if isinstance(data, dict) and data.get(name):
                return str(data[name])
            if data is None and name == "GEMINI_API_KEY":  # secret stored as a plain string
                return raw.strip()
        except ClientError as error:
            print(f"Secrets Manager lookup failed for {name}: {error.response['Error']['Code']}")
    if required:
        raise RuntimeError(f"Missing required secret: {name}")
    return None


@lru_cache(maxsize=None)
def get_client():
    from google import genai
    return genai.Client(api_key=get_secret("GEMINI_API_KEY"))


def get_table():
    return get_ddb().Table(TABLE_NAME)


# --------------------------------------------------------------------------- HTTP helpers
def _headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Headers": "Content-Type,Authorization,Accept,x-api-token",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS,PUT",
    }


def _resp(status, body):
    return {"statusCode": status, "headers": _headers(), "body": json.dumps(body, default=str)}


def authorized(event):
    """Optional shared-token gate for server-to-server use. For browser clients use a real
    API Gateway authorizer (Cognito/JWT) - a token shipped to a browser is not a secret."""
    token = os.environ.get("API_TOKEN")
    if not token:
        return True
    headers = {str(k).lower(): v for k, v in (event.get("headers") or {}).items()}
    return hmac.compare_digest(str(headers.get("x-api-token", "")), token)


def decode_decimals(value):
    from decimal import Decimal
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {k: decode_decimals(v) for k, v in value.items()}
    if isinstance(value, list):
        return [decode_decimals(v) for v in value]
    return value


# --------------------------------------------------------------------------- text extraction
def extract_text(file_bytes, file_name):
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
            text = "\n".join("".join(n.text or "" for n in p.findall(".//w:t", ns)) for p in root.findall(".//w:p", ns))
        elif lower.endswith(".txt"):
            text = file_bytes.decode("utf-8", errors="ignore")
    except Exception as error:
        print(f"Text extraction failed for {file_name}: {type(error).__name__}")
    text = text.strip()
    return (text, True) if len(text) >= 200 else ("", False)


def mime_for(name):
    lower = name.lower()
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    return "application/pdf"


# --------------------------------------------------------------------------- checklist loading
_CHECKLIST_CACHE = {"at": 0.0, "data": None}


def fetch_supabase_checklist(bundled):
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not url:
        raise RuntimeError("SUPABASE_URL not set")
    key = get_secret("SUPABASE_ANON_KEY")  # read-only; RLS allows select on active rows only
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


def load_checklist():
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


# --------------------------------------------------------------------------- Gemini
def _error_code(error):
    code = getattr(error, "code", None)
    if isinstance(code, int):
        return code
    match = re.search(r"\b([45]\d\d)\b", str(error))
    return int(match.group(1)) if match else None


def _config(use_schema):
    from google.genai.types import GenerateContentConfig
    kwargs = {"response_mime_type": "application/json", "temperature": 0, "max_output_tokens": 32768}
    if use_schema and AuditResponse is not None:
        kwargs["response_schema"] = AuditResponse
    return GenerateContentConfig(**kwargs)


def call_gemini(contents):
    """Try each configured model with bounded retries. Returns (model_used, parsed_json)."""
    client = get_client()
    use_schema, last_error, exhausted_count = True, None, 0
    for model in AUDIT_MODELS:
        try:
            gemini_limiter.acquire(model)
        except gemini_limiter.RateLimitExhausted as limit_err:
            print(f"[call_gemini] model {model} daily limit reached: {limit_err}")
            last_error = limit_err
            exhausted_count += 1
            continue

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
                if code == 429:
                    if attempt < MAX_RETRIES - 1:
                        backoff_s = 4 * (2 ** attempt)  # 4s, 8s, 16s on SAME model
                        print(f"[call_gemini] 429 on {model}. Retrying same model in {backoff_s}s...")
                        time.sleep(backoff_s)
                        continue
                    else:
                        print(f"[call_gemini] All {MAX_RETRIES} retries exhausted for {model} on 429")
                        break  # switch to next model only after exhausting retries
                if code in TRANSIENT_CODES or "timeout" in msg or "timed out" in msg:
                    if attempt == MAX_RETRIES - 1:
                        break
                    time.sleep(min(30, 4 * 2 ** attempt))
                    continue
                raise
    if exhausted_count == len(AUDIT_MODELS):
        raise RuntimeError("All configured Gemini models exhausted for today")
    raise RuntimeError(f"All configured Gemini models failed: {type(last_error).__name__}: {str(last_error)[:200]}")


# --------------------------------------------------------------------------- audit orchestration
def run_audit(documents, doc_type_hint=None):
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
        "scoring_version": core.SCORING_VERSION, "as_of": date.today().isoformat(),
        "doc_types": sorted(doc_types), "classification": classifications,
        "soc2_mode": SOC2_MODE, "thresholds": {"compliant_min": core.COMPLIANT_MIN, "review_min": core.REVIEW_MIN},
        "llm_tier": GEMINI_TIER,
    }
    if GEMINI_TIER == "free":
        base_meta["llm_data_use_warning"] = ("Gemini API free-tier content may be used by Google to improve its products. "
                                             "Do not audit confidential documents on the free tier.")
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
    final["meta"] = dict(base_meta,
                         checklist_version=checklist.get("version"), checklist_source=checklist.get("source"),
                         model=model_used, passes=AUDIT_PASSES, vision_mode=vision_mode, truncated_documents=truncated,
                         quality={"not_evaluated": not_evaluated, "downgraded_for_evidence": verify_stats["downgraded"],
                                  "na_overrides": na_overrides, "items_with_pass_disagreement": low_agreement,
                                  "evidence_verifiable": not vision_mode})
    return final


def _unscored(reason, meta):
    frameworks = {fw: {"score": None, "status": "UNSCORED", "summary": reason, "rationale": reason, "counts": {},
                       "critical_gaps": [], "coverage_pct": None, "disclosure_only": False, "unverifiable": []}
                  for fw in core.FRAMEWORKS}
    return {"overall_score": None, "frameworks": frameworks, "items": [], "risks": [], "forward_looking": [],
            "placeholders": [], "meta": dict(meta, unscored_reason=reason)}


def result_to_item(key, result):
    fw = result["frameworks"]
    item = {
        "DocumentId": key, "Status": "COMPLETED", "scoring_version": core.SCORING_VERSION,
        "overall_score": result["overall_score"], "OverallScore": result["overall_score"], "Score": result["overall_score"],
        "frameworks": fw, "risks": result["risks"], "items": result["items"], "meta": result["meta"],
        "forward_looking": result["forward_looking"], "placeholders": result["placeholders"],
        "GdprScore": fw["gdpr"]["score"], "Soc2Score": fw["soc2"]["score"],
        "CcpaScore": fw["ccpa"]["score"], "Iso27701Score": fw["iso27701"]["score"],
    }
    return core.to_dynamo(item)


# --------------------------------------------------------------------------- S3 / agreement flows
def claim_document(table, key, hint):
    try:
        item = {"DocumentId": key, "Status": "PROCESSING"}
        if hint:
            item["DocTypeHint"] = hint
        table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(DocumentId) OR #s IN (:a, :f)",
            ExpressionAttributeNames={"#s": "Status"},
            ExpressionAttributeValues={":a": "AWAITING_UPLOAD", ":f": "FAILED"})
        return True
    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise


def process_s3_record(record):
    table = get_table()
    bucket = record["s3"]["bucket"]["name"]
    key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
    if key.startswith("agreements/"):
        return {"statusCode": 200, "body": "Agreement file queued"}
    existing = table.get_item(Key={"DocumentId": key}).get("Item", {})
    hint = existing.get("DocTypeHint")
    if not claim_document(table, key, hint):
        print("Duplicate or already-processed event; skipping")
        return {"statusCode": 200, "body": "Already processed"}
    try:
        body = get_s3().get_object(Bucket=bucket, Key=key)["Body"].read()
        result = run_audit([(key.rsplit("/", 1)[-1], body)], hint)
        table.put_item(Item=result_to_item(key, result))
        print("Audit completed")
        return {"statusCode": 200, "body": "S3 process completed"}
    except Exception as error:
        print(f"Audit failed: {type(error).__name__}")
        table.put_item(Item={"DocumentId": key, "Status": "FAILED", "Error": f"{type(error).__name__}: {str(error)[:300]}"})
        return {"statusCode": 500, "body": json.dumps({"error": "Audit failed"})}


def process_agreement_audit(event):
    table = get_table()
    group_key = f"AGREEMENT#{event['groupId']}"
    try:
        documents = []
        for key in event["documentIds"]:
            if not key.startswith(ALLOWED_KEY_PREFIXES):
                raise ValueError("Document key outside allowed prefixes")
            obj = get_s3().get_object(Bucket=event.get("bucket", BUCKET_NAME), Key=key)
            documents.append((key.rsplit("/", 1)[-1], obj["Body"].read()))
        result = run_audit(documents, None)
        item = result_to_item(group_key, result)
        item["DocumentIds"] = event["documentIds"]
        table.put_item(Item=item)
    except Exception as error:
        table.put_item(Item={"DocumentId": group_key, "Status": "FAILED",
                             "Error": f"Agreement analysis failed: {type(error).__name__}: {str(error)[:300]}"})


# --------------------------------------------------------------------------- handler
def safe_filename(name):
    base = os.path.basename(str(name)).strip()
    base = re.sub(r"[^A-Za-z0-9._ -]", "_", base)[:120]
    return base if base.lower().endswith(ALLOWED_EXTENSIONS) else None


def handler(event, context):
    if "agreementAudit" in event:
        process_agreement_audit(event["agreementAudit"])
        return {"statusCode": 200, "body": "Agreement audit completed"}

    if "Records" in event and "s3" in event["Records"][0]:
        return process_s3_record(event["Records"][0])

    request = event.get("requestContext") or {}
    if "httpMethod" in request or "http" in request:
        method = request.get("httpMethod") or request["http"]["method"]
        route_key = event.get("routeKey") or request.get("resourcePath")
        raw_path = event.get("rawPath") or event.get("path") or ""

        if method == "OPTIONS":
            return _resp(200, {"message": "OK"})
        if not authorized(event):
            return _resp(401, {"error": "Unauthorized"})
        table = get_table()

        if method == "GET" and (raw_path.startswith("/results/") or route_key == "GET /results/{id}"):
            doc_id = (event.get("pathParameters") or {}).get("id") or raw_path.split("/results/")[-1]
            if not doc_id:
                return _resp(400, {"error": "Missing document id"})
            found = table.get_item(Key={"DocumentId": urllib.parse.unquote_plus(doc_id)})
            if "Item" in found:
                return _resp(200, decode_decimals(found["Item"]))
            return _resp(404, {"Status": "NOT_FOUND", "message": "Document not processed yet."})

        if method == "GET" and (raw_path.startswith("/agreement-results/") or route_key == "GET /agreement-results/{id}"):
            group_id = (event.get("pathParameters") or {}).get("id") or raw_path.split("/agreement-results/")[-1]
            found = table.get_item(Key={"DocumentId": f"AGREEMENT#{urllib.parse.unquote_plus(group_id)}"})
            if "Item" in found:
                return _resp(200, decode_decimals(found["Item"]))
            return _resp(404, {"Status": "NOT_FOUND"})

        if method == "POST" and (raw_path == "/agreement-audit" or route_key == "POST /agreement-audit"):
            body = json.loads(event.get("body") or "{}")
            group_id, document_ids = body.get("groupId"), body.get("documentIds")
            if not group_id or not isinstance(document_ids, list) or len(document_ids) < 2:
                return _resp(400, {"error": "groupId and at least two documentIds are required"})
            if not all(isinstance(k, str) and k.startswith(ALLOWED_KEY_PREFIXES) and ".." not in k for k in document_ids):
                return _resp(400, {"error": "documentIds must be keys under agreements/ or uploads/"})
            table.put_item(Item={"DocumentId": f"AGREEMENT#{group_id}", "Status": "PROCESSING", "DocumentIds": document_ids})
            get_lambda().invoke(
                FunctionName=os.environ["AWS_LAMBDA_FUNCTION_NAME"], InvocationType="Event",
                Payload=json.dumps({"agreementAudit": {"groupId": group_id, "documentIds": document_ids, "bucket": BUCKET_NAME}}).encode())
            return _resp(202, {"groupId": group_id, "Status": "PROCESSING"})

        if method == "POST" and (raw_path == "/upload" or route_key == "POST /upload"):
            try:
                body = json.loads(event.get("body") or "{}")
            except json.JSONDecodeError:
                return _resp(400, {"error": "Invalid JSON body"})
            name = safe_filename(body.get("filename") or body.get("file_name") or "")
            if not name:
                return _resp(400, {"error": f"filename required; allowed extensions: {', '.join(ALLOWED_EXTENSIONS)}"})
            hint = body.get("docType")
            if hint is not None and hint not in VALID_DOC_TYPES:
                return _resp(400, {"error": f"docType must be one of {', '.join(VALID_DOC_TYPES)}"})
            key = f"uploads/{uuid.uuid4().hex}/{name}" if UNIQUE_KEYS else name
            try:
                item = {"DocumentId": key, "Status": "AWAITING_UPLOAD"}
                if hint:
                    item["DocTypeHint"] = hint
                table.put_item(Item=item)
                url = get_s3().generate_presigned_url(
                    "put_object", Params={"Bucket": BUCKET_NAME, "Key": key, "ContentType": "application/octet-stream"},
                    ExpiresIn=900)
                return _resp(200, {"uploadUrl": url, "documentId": key})
            except Exception as error:
                print(f"Presign failure: {type(error).__name__}")
                return _resp(500, {"error": "Could not create upload URL"})

    return {"statusCode": 400, "body": "Bad Request"}
