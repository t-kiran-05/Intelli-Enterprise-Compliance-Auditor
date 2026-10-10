#!/usr/bin/env python3
"""embed_regulations.py - validate the compliance checklist and seed it into Supabase.

Usage
  python scripts/embed_regulations.py --validate-only
  python scripts/embed_regulations.py --dry-run
  python scripts/embed_regulations.py                       # upsert rows (no embeddings)
  python scripts/embed_regulations.py --with-embeddings     # also store 768-d vectors (optional)
  python scripts/embed_regulations.py --deactivate-old      # mark older versions inactive

Secrets (never hard-code; this script refuses to run without them):
  SUPABASE_URL, SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) -> environment; prefer typing it in
                                              a terminal with `read -s` instead of storing it in .env.local
  GEMINI_API_KEY                            -> only for --with-embeddings
The service-role key is for THIS local admin script only. The Lambda uses the read-only anon key.

Embeddings are OPTIONAL. The Lambda looks requirements up by id/doc type (exact filter), so it does not
need vector search. Vectors from different embedding models are NOT comparable: each row records its
embedding_model and any similarity query must filter on it.
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "terraform", "lambda_src"))
import audit_core as core  # noqa: E402

CHECKLIST_PATH = os.path.join(ROOT, "terraform", "lambda_src", "checklists.json")
EMBED_DIM = 768
BATCH = 40


def load_env_local():
    path = os.path.join(ROOT, ".env.local")
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def require_env(name, *aliases):
    value = next((os.environ.get(n) for n in (name, *aliases) if os.environ.get(n)), None)
    if not value:
        sys.exit(f"[error] {name} is not set. Put it in the environment or .env.local (git-ignored). "
                 f"Never hard-code secrets.")
    return value


def http(method, url, key, payload=None, extra_headers=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    headers.update(extra_headers or {})
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")


def l2_normalize(vec):
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


def embed_texts(texts, model_candidates):
    from google import genai
    from google.genai.types import EmbedContentConfig
    client = genai.Client(api_key=require_env("GEMINI_API_KEY"))
    config = EmbedContentConfig(output_dimensionality=EMBED_DIM)
    chosen, vectors = None, []
    for text in texts:
        vec = None
        for model in ([chosen] if chosen else model_candidates):
            for attempt in range(4):
                try:
                    resp = client.models.embed_content(model=model, contents=text, config=config)
                    values = resp.embeddings[0].values
                    if len(values) != EMBED_DIM:
                        raise ValueError(f"unexpected dimension {len(values)}")
                    vec, chosen = l2_normalize(list(values)), model
                    break
                except Exception as e:  # 429 / transient -> backoff; 404 -> next model
                    msg = str(e).lower()
                    if "429" in msg or "resource_exhausted" in msg or "503" in msg:
                        time.sleep(min(30, 2 ** (attempt + 1)))
                        continue
                    print(f"  [warn] {model}: {str(e)[:120]}")
                    break
            if vec:
                break
        if not vec:
            sys.exit("[error] No embedding model worked. Check EMBED_MODELS / API key / quota.")
        vectors.append(vec)
        time.sleep(0.4)  # stay well under free-tier per-minute limits
    return chosen, vectors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--validate-only", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--with-embeddings", action="store_true")
    ap.add_argument("--deactivate-old", action="store_true")
    ap.add_argument("--embed-models", default=os.environ.get("EMBED_MODELS", "gemini-embedding-2,gemini-embedding-2-preview"))
    args = ap.parse_args()

    load_env_local()
    checklist = core.load_checklist_file(CHECKLIST_PATH)  # raises on schema errors
    version, reqs = checklist["version"], checklist["requirements"]
    print(f"[ok] checklist v{version}: {len(reqs)} requirements, schema valid")
    if args.validate_only:
        return

    rows = [{"id": r["id"], "version": version, "framework": r["framework"], "payload": r, "active": True} for r in reqs]

    if args.with_embeddings:
        texts = [f"{r['citation']} | {r['title']}\n{r['looks_for']}" for r in reqs]
        model, vectors = embed_texts(texts, [m.strip() for m in args.embed_models.split(",") if m.strip()])
        for row, vec in zip(rows, vectors):
            row["embedding"], row["embedding_model"] = vec, model
        print(f"[ok] embedded {len(vectors)} rows with {model} (dim {EMBED_DIM})")

    if args.dry_run:
        print(f"[dry-run] would upsert {len(rows)} rows; sample id: {rows[0]['id']}")
        return

    url, key = require_env("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL").rstrip("/"), require_env("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY")
    endpoint = f"{url}/rest/v1/compliance_requirements?on_conflict=id,version"
    for i in range(0, len(rows), BATCH):
        status, body = http("POST", endpoint, key, rows[i:i + BATCH],
                            {"Prefer": "resolution=merge-duplicates,return=minimal"})
        if status not in (200, 201, 204):
            if status == 404 and "PGRST205" in body:
                sys.exit("[error] Table compliance_requirements not found. Run supabase/schema.sql in the SQL editor first.")
            sys.exit(f"[error] upsert failed ({status}): {body[:300]}")
    print(f"[ok] upserted {len(rows)} rows into compliance_requirements (version {version})")

    if args.deactivate_old:
        status, body = http("PATCH", f"{url}/rest/v1/compliance_requirements?version=neq.{version}", key,
                            {"active": False}, {"Prefer": "return=minimal"})
        print("[ok] older versions deactivated" if status in (200, 204) else f"[warn] deactivate failed ({status}): {body[:200]}")


if __name__ == "__main__":
    main()
