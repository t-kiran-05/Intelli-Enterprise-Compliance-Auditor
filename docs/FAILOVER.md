# Failover Runbook

## Architecture Overview

```
Browser -> Next.js (Vercel) -> router.ts -> +-- AWS Lambda (primary)
                                            +-- FastAPI on Render (secondary)
                                      |
                              Supabase Postgres (archive)
```

- **Primary**: AWS API Gateway -> Lambda -> S3 + DynamoDB
- **Secondary**: FastAPI on Render Free (Docker) -> Supabase Storage + Postgres
- **Archive**: Supabase `audit_results` table (written on result read, survives after AWS)

---

## Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `PRIMARY_BACKEND_URL` | Vercel | AWS API Gateway base URL |
| `SECONDARY_BACKEND_URL` | Vercel | Render service URL |
| `BACKEND_SHARED_TOKEN` | Vercel, Render | Server-to-server auth token |
| `FAILOVER_MODE` | Vercel | `auto` / `primary` / `secondary` |
| `SUPABASE_URL` | Vercel, Render | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Vercel, Render | Supabase service-role key |
| `GEMINI_API_KEY` | Lambda (SSM/SM), Render | Gemini API key |
| `AUDIT_MODELS` | Lambda, Render | Comma-separated model names |
| `GEMINI_TIER` | Lambda, Render | `free` or `paid` |
| `ALLOWED_ORIGIN` | Render | CORS origin |
| `UPSTASH_REDIS_REST_URL` | Vercel | Circuit breaker Redis |
| `UPSTASH_REDIS_REST_TOKEN` | Vercel | Circuit breaker Redis |

---

## Forcing the Secondary Backend

Set in Vercel environment variables:

```
FAILOVER_MODE=secondary
```

This bypasses all AWS calls. The circuit breaker and primary health checks are skipped entirely.

---

## Rolling Back to Primary

```
FAILOVER_MODE=auto     # or FAILOVER_MODE=primary
```

The router will try AWS first, falling back to secondary only on failures.

---

## Circuit Breaker Behavior

- **Threshold**: 3 failures within 60 seconds
- **Open duration**: 120 seconds (primary is skipped)
- **Tripping errors**: network errors, timeouts, HTTP 5xx, HTTP 403
- **Non-tripping errors**: HTTP 400, 404, 413 (client errors, not backend failures)
- **State stored in**: Upstash Redis (`circuit:primary:failures`, `circuit:primary:open`)

After the open period expires, the next request will **probe** the primary (half-open state). A success resets the counter; another failure re-trips the breaker.

---

## Cold Start (Render Free)

Render Free sleeps after 15 minutes of inactivity. Wake-up takes approximately 60 seconds.

When the router falls back to secondary, it calls `/health` with a 70-second timeout before attempting the upload. The frontend should show a message like:

> "Starting backup server, this can take about a minute..."

---

## Free-Tier Limits

| Service | Limit | Impact |
|---|---|---|
| **Render Free** | 750 instance-hours/month, sleeps after 15min idle | Cold starts; monthly hour cap |
| **Supabase Free** | 500 MB database, 1 GB storage, pauses after 7 days idle | Keep active or wake periodically |
| **Gemini Free** | Rate limits, content may be used for training | Do not audit confidential docs |
| **Vercel Hobby** | Non-commercial, 10s function timeout | Routes must proxy/poll only |
| **AWS Free Plan** | Account closure within months | Export data before expiry |

---

## Pre-Expiry Checklist (Before AWS Closes)

1. **Export data**: Run the migration script
   ```powershell
   $env:SUPABASE_URL = "https://your-project.supabase.co"
   $s = Read-Host "Supabase secret key" -AsSecureString
   $env:SUPABASE_SECRET_KEY = [System.Net.NetworkCredential]::new("", $s).Password
   .\.venv\Scripts\python.exe scripts\export_aws_to_supabase.py --dry-run
   # Verify counts, then:
   .\.venv\Scripts\python.exe scripts\export_aws_to_supabase.py --copy-s3
   Remove-Item Env:SUPABASE_SECRET_KEY
   ```

2. **Manual AWS backup** (optional):
   ```bash
   aws dynamodb scan --table-name ComplianceAuditLogs --output json > dynamodb_backup.json
   aws s3 sync s3://enterprise-compliance-vault-2026 ./s3_backup/
   ```

3. **Verify secondary works**:
   - Set `FAILOVER_MODE=secondary` in Vercel
   - Upload a test document, wait for audit, verify result
   - Check that archived results from AWS are still readable

4. **Flip the mode**:
   ```
   FAILOVER_MODE=secondary
   ```

5. **Let AWS lapse**: No further action needed. Archived results remain in Supabase.

---

## Archive-on-Read

When a COMPLETED result is fetched from either backend, the router **upserts** it into `audit_results` in Supabase. This ensures:

- Results survive after AWS is gone
- The archive is the first place checked on subsequent reads
- Archive failures are logged but never break the user flow

---

## Owner ID Enforcement

- `audit_results` has an `owner_id` column (`uuid` referencing `auth.users`)
- RLS policy: authenticated users can only `SELECT` their own results
- The router checks `owner_id` against the signed-in user before returning results
- The FastAPI server stores `owner_id` when starting an audit

---

## Local Development

Run the secondary server locally:

```powershell
$env:GEMINI_API_KEY = "your-key"
$env:SUPABASE_URL = "https://your-project.supabase.co"
$env:SUPABASE_SECRET_KEY = "your-service-role-key"
$env:BACKEND_SHARED_TOKEN = "dev-token-12345"
cd server
../.venv/Scripts/python.exe -m uvicorn main:app --reload --port 8000
```

Then set in `.env.local`:
```
SECONDARY_BACKEND_URL=http://localhost:8000
BACKEND_SHARED_TOKEN=dev-token-12345
FAILOVER_MODE=secondary
```

---

## Troubleshooting

| Symptom | Check |
|---|---|
| "No backend available" | Both primary and secondary are down; check `FAILOVER_MODE`, URLs, tokens |
| Slow uploads | Render cold start; check `/health` response time |
| Results missing after AWS shutdown | Run `export_aws_to_supabase.py`; check archive table |
| 401 from secondary | `BACKEND_SHARED_TOKEN` mismatch between Vercel and Render |
| Circuit breaker stuck open | Check Redis keys `circuit:primary:*`; delete `circuit:primary:open` to reset |
