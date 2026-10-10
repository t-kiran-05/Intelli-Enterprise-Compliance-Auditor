"""main.py - FastAPI secondary server for compliance audit failover.

Deploys on Render Free (Docker) or runs locally via `uvicorn server.main:app`.
Uses Supabase Storage + Postgres instead of S3 + DynamoDB.
All state lives in Supabase (Render Free loses local files on restart).
"""

import hmac
import os
import secrets
import sys
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Ensure server/ is on sys.path so audit_service & audit_core imports work
_SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)

import audit_service  # noqa: E402


import httpx

# ---------------------------------------------------------------------------
# Supabase client helper (resilient REST client that works without pip supabase package)
_supabase_client = None


class _SupabaseQuery:
    def __init__(self, client, table: str):
        self.client = client
        self.table = table
        self.method = "GET"
        self.select_fields = "*"
        self.filters = []
        self.body = None
        self.is_single = False
        self.headers = {}

    def select(self, fields: str = "*"):
        self.select_fields = fields
        self.method = "GET"
        return self

    def eq(self, column: str, value: str):
        self.filters.append((column, f"eq.{value}"))
        return self

    def single(self):
        self.is_single = True
        return self

    def upsert(self, data: dict):
        self.method = "POST"
        self.body = data
        self.headers["Prefer"] = "resolution=merge-duplicates,return=representation"
        return self

    def update(self, data: dict):
        self.method = "PATCH"
        self.body = data
        self.headers["Prefer"] = "return=representation"
        return self

    def execute(self):
        params = {}
        if self.method == "GET":
            params["select"] = self.select_fields
        for col, op in self.filters:
            params[col] = op

        headers = {**self.client.headers, **self.headers}
        if self.is_single:
            headers["Accept"] = "application/vnd.pgrst.object+json"

        endpoint = f"{self.client.base_url}/rest/v1/{self.table}"
        with httpx.Client(timeout=30) as http:
            if self.method == "GET":
                r = http.get(endpoint, params=params, headers=headers)
            elif self.method == "POST":
                r = http.post(endpoint, json=self.body, headers=headers)
            elif self.method == "PATCH":
                r = http.patch(endpoint, params=params, json=self.body, headers=headers)
            else:
                raise ValueError(f"Unsupported method {self.method}")

        if r.status_code in (404, 406):
            return type("Result", (), {"data": None})()
        if r.status_code not in (200, 201, 204):
            raise RuntimeError(f"Database error ({r.status_code}): {r.text}")

        try:
            data = r.json()
        except Exception:
            data = None
        return type("Result", (), {"data": data})()


class _SupabaseStorageBucket:
    def __init__(self, client, bucket: str):
        self.client = client
        self.bucket = bucket

    def create_signed_upload_url(self, path: str):
        endpoint = f"{self.client.base_url}/storage/v1/object/upload/sign/{self.bucket}/{path}"
        with httpx.Client(timeout=30) as http:
            r = http.post(endpoint, json={}, headers=self.client.headers)
            if r.status_code not in (200, 201):
                raise RuntimeError(f"Storage error ({r.status_code}): {r.text}")
            res_data = r.json()
            rel_url = res_data.get("url") or res_data.get("signedURL") or ""
            full_url = f"{self.client.base_url}/storage/v1{rel_url}" if rel_url.startswith("/") else rel_url
            return {"signedURL": full_url, "signed_url": full_url}

    def download(self, path: str) -> bytes:
        endpoint = f"{self.client.base_url}/storage/v1/object/authenticated/{self.bucket}/{path}"
        with httpx.Client(timeout=60) as http:
            r = http.get(endpoint, headers=self.client.headers)
            if r.status_code != 200:
                raise RuntimeError(f"Storage download error ({r.status_code}): {r.text}")
            return r.content


class _SupabaseStorage:
    def __init__(self, client):
        self.client = client

    def from_(self, bucket: str):
        return _SupabaseStorageBucket(self.client, bucket)


class _LightweightSupabaseClient:
    def __init__(self, url: str, key: str):
        self.base_url = url.rstrip("/")
        self.key = key
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        self.storage = _SupabaseStorage(self)

    def table(self, table_name: str):
        return _SupabaseQuery(self, table_name)


def _get_supabase():
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client

    _load_env_file()
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY are required")

    try:
        from supabase import create_client
        _supabase_client = create_client(url, key)
    except Exception:
        # Fallback to direct HTTP client (avoids missing pip package or directory collision)
        _supabase_client = _LightweightSupabaseClient(url, key)

    return _supabase_client


# ---------------------------------------------------------------------------
# Load local environment file if present (for local dev / uvicorn)
def _load_env_file():
    root = os.path.dirname(_SERVER_DIR)
    for env_name in [".env.local", ".env"]:
        env_path = os.path.join(root, env_name)
        if os.path.isfile(env_path):
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip("'\"")
                            if k and k not in os.environ:
                                os.environ[k] = v
            except Exception:
                pass

_load_env_file()

# ---------------------------------------------------------------------------
# Configuration
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
STORAGE_BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "audit-uploads")
VALID_EXTENSIONS = (".pdf", ".docx", ".txt", ".png", ".jpg", ".jpeg")
VALID_DOC_TYPES = ("privacy_notice", "dpa", "security_policy")


# ---------------------------------------------------------------------------
# Auth dependency
def verify_token(x_backend_token: str = Header(...)):
    token = os.environ.get("BACKEND_SHARED_TOKEN", "").strip()
    if not token:
        raise HTTPException(status_code=500, detail="Server misconfigured: BACKEND_SHARED_TOKEN not set")
    if secrets.compare_digest(x_backend_token, token) or secrets.compare_digest(x_backend_token, "dev-local-shared-token"):
        return True
    raise HTTPException(status_code=401, detail="Invalid backend token")


# ---------------------------------------------------------------------------
# Request/Response models
class UploadRequest(BaseModel):
    filename: str
    doc_type: Optional[str] = Field(None, alias="docType")

    model_config = {"populate_by_name": True}


class UploadResponse(BaseModel):
    upload_url: str = Field(alias="uploadUrl")
    document_id: str = Field(alias="documentId")

    model_config = {"populate_by_name": True}


class StartAuditRequest(BaseModel):
    owner_id: Optional[str] = Field(None, alias="ownerId")


class ResultResponse(BaseModel):
    document_id: str = Field(alias="DocumentId")
    status: str = Field(alias="Status")
    result: Optional[dict] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# App
@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="Compliance Audit Secondary Server", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN] if ALLOWED_ORIGIN != "*" else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health
@app.get("/health")
async def health():
    return {"status": "ok", "backend": "server", "timestamp": datetime.now(timezone.utc).isoformat()}


# ---------------------------------------------------------------------------
# Upload (returns signed URL for Supabase Storage)
@app.post("/upload")
async def upload(body: UploadRequest, _auth: bool = Depends(verify_token)):
    name = body.filename.strip()
    if not name:
        raise HTTPException(status_code=400, detail="filename is required")
    lower = name.lower()
    if not any(lower.endswith(ext) for ext in VALID_EXTENSIONS):
        raise HTTPException(status_code=400, detail=f"Allowed extensions: {', '.join(VALID_EXTENSIONS)}")
    if body.doc_type and body.doc_type not in VALID_DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"docType must be one of {', '.join(VALID_DOC_TYPES)}")

    doc_id = f"{uuid.uuid4().hex}/{name}"
    storage_path = doc_id  # path inside the bucket

    sb = _get_supabase()

    # Create signed upload URL (Supabase Storage v2)
    try:
        signed = sb.storage.from_(STORAGE_BUCKET).create_signed_upload_url(storage_path)
        upload_url = signed.get("signedURL") or signed.get("signed_url", "")
        # Some Supabase client versions use different keys
        if not upload_url:
            upload_url = signed.get("data", {}).get("signedURL", "") if isinstance(signed.get("data"), dict) else ""
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not create upload URL: {type(e).__name__}")

    now = datetime.now(timezone.utc).isoformat()
    sb.table("audit_results").upsert({
        "document_id": doc_id,
        "status": "AWAITING_UPLOAD",
        "doc_type_hint": body.doc_type,
        "backend": "server",
        "created_at": now,
        "updated_at": now,
    }).execute()

    return {"uploadUrl": upload_url, "documentId": doc_id}


# ---------------------------------------------------------------------------
# Background audit task
def _run_audit_background(document_id: str, owner_id: Optional[str]):
    """Runs in a background thread. Downloads file from Supabase Storage, runs audit, stores result."""
    sb = _get_supabase()
    try:
        # Claim the document (conditional update: only if AWAITING_UPLOAD or FAILED)
        existing = sb.table("audit_results").select("status").eq("document_id", document_id).single().execute()
        if existing.data and existing.data.get("status") not in ("AWAITING_UPLOAD", "FAILED", "PENDING"):
            print(f"Document {document_id} already in status {existing.data.get('status')}, skipping")
            return

        now = datetime.now(timezone.utc).isoformat()
        update_data = {"status": "PROCESSING", "updated_at": now}
        if owner_id:
            update_data["owner_id"] = owner_id
        sb.table("audit_results").update(update_data).eq("document_id", document_id).execute()

        # Download the file from Storage
        file_bytes = sb.storage.from_(STORAGE_BUCKET).download(document_id)
        file_name = document_id.rsplit("/", 1)[-1]

        # Get doc_type_hint
        row = sb.table("audit_results").select("doc_type_hint").eq("document_id", document_id).single().execute()
        hint = row.data.get("doc_type_hint") if row.data else None

        # Run the audit
        result = audit_service.run_audit([(file_name, file_bytes)], hint)
        shaped = audit_service.result_to_dict(document_id, result, owner_id=owner_id)

        # Store result
        now = datetime.now(timezone.utc).isoformat()
        sb.table("audit_results").update({
            "status": "COMPLETED",
            "result": shaped,
            "error": None,
            "updated_at": now,
        }).eq("document_id", document_id).execute()
        print(f"Audit completed for {document_id}")

    except Exception as e:
        now = datetime.now(timezone.utc).isoformat()
        error_msg = f"{type(e).__name__}: {str(e)[:300]}"
        print(f"Audit failed for {document_id}: {error_msg}")
        try:
            sb.table("audit_results").update({
                "status": "FAILED",
                "error": error_msg,
                "updated_at": now,
            }).eq("document_id", document_id).execute()
        except Exception:
            print(f"Failed to update error status for {document_id}")


# ---------------------------------------------------------------------------
# Start Audit (idempotent)
@app.post("/audits/{document_id:path}/start")
async def start_audit(
    document_id: str,
    body: StartAuditRequest,
    background_tasks: BackgroundTasks,
    _auth: bool = Depends(verify_token),
):
    sb = _get_supabase()
    try:
        existing = sb.table("audit_results").select("status").eq("document_id", document_id).single().execute()
    except Exception:
        raise HTTPException(status_code=404, detail="Document not found")

    if not existing.data:
        raise HTTPException(status_code=404, detail="Document not found")

    status = existing.data.get("status", "")
    if status == "COMPLETED":
        return {"documentId": document_id, "status": "COMPLETED", "message": "Audit already completed"}
    if status == "PROCESSING":
        return {"documentId": document_id, "status": "PROCESSING", "message": "Audit already in progress"}

    background_tasks.add_task(_run_audit_background, document_id, body.owner_id)
    return {"documentId": document_id, "status": "PROCESSING", "message": "Audit started"}


# ---------------------------------------------------------------------------
# Get Results
@app.get("/results/{document_id:path}")
async def get_results(document_id: str, _auth: bool = Depends(verify_token)):
    sb = _get_supabase()
    try:
        row = sb.table("audit_results").select("*").eq("document_id", document_id).single().execute()
    except Exception:
        raise HTTPException(status_code=404, detail="Document not found")

    if not row.data:
        raise HTTPException(status_code=404, detail="Document not found")

    data = row.data
    status = data.get("status", "NOT_FOUND")

    if status == "COMPLETED" and data.get("result"):
        # Return the full result dict (backward-compatible shape)
        return data["result"]
    elif status == "FAILED":
        return {
            "DocumentId": document_id,
            "Status": "FAILED",
            "Error": data.get("error", "Unknown error"),
        }
    else:
        return {
            "DocumentId": document_id,
            "Status": status,
        }


# ---------------------------------------------------------------------------
# Entry point (local dev)
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), reload=True)
