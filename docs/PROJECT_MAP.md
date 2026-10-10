# Project Map: AI Compliance Dashboard

> Generated during **Phase D (Discovery)** per `ANTIGRAVITY_PROMPT.md`.
> This document maps the real repository structure, runtime environments, cloud resources, integration points, and proposed path mappings.

---

## 1. Repository Structure & Runtime Environment

### 1.1 Directory Tree (to depth 3)
```text
.
|-- .env.example
|-- .gitignore
|-- ANTIGRAVITY_PROMPT.md
|-- README.md
|-- app
|   |-- api
|   |   |-- audit
|   |   \-- upload
|   |-- globals.css
|   |-- layout.tsx
|   \-- page.tsx
|-- components
|   |-- auth
|   |   \-- auth-modal.tsx
|   |-- dashboard
|   |   |-- audit-log.tsx
|   |   |-- clause-editor.tsx
|   |   |-- compliance-dashboard.tsx
|   |   |-- compliance-gauges.tsx
|   |   |-- document-auditor.tsx
|   |   |-- ingestion-dropzone.tsx
|   |   |-- risk-heatmap.tsx
|   |   |-- sidebar.tsx
|   |   \-- top-bar.tsx
|   \-- ui
|       \-- button.tsx
|-- components.json
|-- data
|   \-- regulatory_rules_embedded.json
|-- hooks
|   |-- audit-engine-context.tsx
|   |-- auth-context.tsx
|   \-- use-audit-engine.ts
|-- lib
|   |-- audit.ts
|   |-- ratelimit.ts
|   |-- supabase-client.ts
|   |-- supabase.ts
|   \-- utils.ts
|-- public
|   |-- apple-icon.png
|   |-- icon.svg
|   \-- placeholder-logo.svg
|-- scripts
|   |-- cleanup_s3.py
|   \-- embed_regulations.py
|-- supabase
|   \-- schema.sql
|-- terraform
|   |-- .terraform.lock.hcl
|   |-- lambda_function.zip
|   |-- lambda_src
|   |   |-- audit_core.py
|   |   |-- checklists.json
|   |   |-- index.py
|   |   \-- requirements.txt
|   |-- main.tf
|   \-- terraform-notes-for-me
|-- tests
|   |-- test_audit_core.py
|   \-- test_handler.py
|-- package.json
|-- pnpm-lock.yaml
|-- tsconfig.json
\-- next.config.mjs
```
*(Note: `node_modules`, `.git`, `.next`, `dist`, `.terraform`, `.venv`, and `__pycache__` directories excluded. Environment variable files containing secrets excluded per ground rules).*

### 1.2 Platform & Tooling Versions
- **Package Manager**: `pnpm` (v11.24.0, lockfile: `pnpm-lock.yaml`; `package-lock.json` also present)
- **Node.js**: `v22.15.0`
- **Python**: `3.13.2`
- **Next.js Version**: `16.2.6` (React 19.x, Turbopack enabled)
- **Next.js Router Style**: **App Router** (`app/` directory with `layout.tsx`, `page.tsx`, and route handlers under `app/api/`)

---

## 2. Existing AWS Lambda & Terraform Architecture

### 2.1 Lambda Source & Handler
- **Source Location**: `terraform/lambda_src/`
  - Modules: `index.py`, `audit_core.py`, `checklists.json`, `requirements.txt`, `deployment_package/`
- **Handler Name**: `index.handler` (defined in `terraform/main.tf` line 159)
- **Runtime**: `python3.11` (configured in Terraform)

### 2.2 Packaging & Deployment Workflow
- **Packaging Mechanism**: Pre-packaged zip archive `terraform/lambda_function.zip`.
- **Terraform Configuration**: References `filename = "lambda_function.zip"` with integrity check `source_code_hash = filebase64sha256("lambda_function.zip")`.
- **Deployment**: Manual execution of `terraform apply` within `terraform/` directory.

### 2.3 Terraform Cloud Resources Involved (Resource Names Only)
- **Storage & Lifecycle**:
  - `aws_s3_bucket.document_vault` (Bucket: `enterprise-compliance-vault-2026`)
  - `aws_s3_bucket_cors_configuration.document_vault_cors`
  - `aws_s3_bucket_lifecycle_configuration.document_vault_lifecycle` (24-hour automatic expiration rule)
- **Database**:
  - `aws_dynamodb_table.audit_results` (Table: `ComplianceAuditLogs`, Hash key: `DocumentId`)
- **Security & IAM**:
  - `aws_iam_role.lambda_role` (`DocumentAIProcessorRole`)
  - `aws_iam_policy.lambda_policy` (`DocumentAIProcessorPolicy`)
  - `aws_iam_role_policy_attachment.lambda_attach`
- **Secrets & Configuration Data**:
  - `data.aws_ssm_parameter.gemini_api_key` (SSM Parameter: `/prod/gemini/api_key`)
- **Compute**:
  - `aws_lambda_function.ai_processor` (`DocumentAIProcessor`, Memory: 1024 MB, Timeout: 900s)
  - `aws_lambda_permission.allow_bucket`
  - `aws_s3_bucket_notification.bucket_notification` (Invokes Lambda on `s3:ObjectCreated:*`)
- **API Gateway (HTTP API v2)**:
  - `aws_apigatewayv2_api.http_api` (`compliance-http-api`, Protocol: `HTTP`)
  - `aws_apigatewayv2_integration.lambda_integration` (AWS Proxy Integration)
  - `aws_apigatewayv2_stage.api_stage` (`$default`, Auto-deploy enabled)
  - `aws_lambda_permission.api_gateway_permission`
- **API Gateway Routes**:
  - `aws_apigatewayv2_route.upload_route` (`POST /upload`)
  - `aws_apigatewayv2_route.results_route` (`GET /results/{id}`)
  - `aws_apigatewayv2_route.agreement_route` (`POST /agreement-audit`)
  - `aws_apigatewayv2_route.agreement_results_route` (`GET /agreement-results/{id}`)
- **Terraform Outputs**:
  - `api_endpoint` (Base URL for API Gateway)

---

## 3. Frontend to Backend Integration Points

### 3.1 Network Call Locations
- **`components/dashboard/document-auditor.tsx`**:
  - `fetch("/api/upload", { method: "POST", body: JSON.stringify({ filename }) })` (Line 293 & 407):
    - Requests an S3 presigned upload URL and rate limit allowance from the Next.js server route.
  - `fetch(tokenData.uploadUrl, { method: "PUT", body: file })` / `xhr.open("PUT", tokenData.uploadUrl)` (Lines 312 & 451):
    - Directly uploads binary document files (`.pdf`, `.docx`, `.txt`) into the AWS S3 vault.
  - `fetch("${API_BASE}/agreement-audit", { method: "POST", body: JSON.stringify({ groupId, documentIds }) })` (Line 321):
    - Initiates asynchronous agreement-set evaluation.
  - `fetch("${API_BASE}/agreement-results/${encodeURIComponent(groupId)}")` (Line 332):
    - Polls for completed agreement batch evaluation.
  - `fetch("${API_BASE}/results/${encodeURIComponent(tokenData.documentId)}")` (Line 485):
    - Polls DynamoDB for single-document audit status and results.
- **`app/api/upload/route.ts`**:
  - `fetch("${AWS_API_BASE}/upload", { method: "POST", ... })` (Line 58):
    - Next.js server route proxies the upload request to AWS API Gateway after verifying Upstash rate limit.
- **`app/api/audit/route.ts`**:
  - `fetch("${SUPABASE_URL}/rest/v1/rpc/match_regulatory_rules", ...)` (Line 147):
    - Queries Supabase pgvector table for RAG grounding before running AI analysis.
  - `fetch("${AWS_API_BASE}/agreement-audit", { method: "POST", ... })` (Line 378):
    - Server-side proxy for agreement audit requests.

### 3.2 Result Fields Read by Frontend
The frontend `normalizeAuditResponse` function reads:
- `OverallScore`, `overall_score`, `Score`
- `GdprScore`, `gdpr_score`
- `CcpaScore`, `ccpa_score`
- `Soc2Score`, `soc2_score`
- `Iso27701Score`, `iso27701_score`
- `frameworks` / `Frameworks` (`score`, `status`, `summary`, `rationale`)
- `Findings` / `findings` / `risks` / `Risks` (`category`, `severity`, `issue`, `location`, `recommendation`)
- `Status` (`COMPLETED`, `FAILED`, `PROCESSING`, `AWAITING_UPLOAD`)
- `Error`

### 3.3 Document Identification After Upload
- For single documents: Uses `tokenData.documentId` returned by `/api/upload` (e.g. `document-<timestamp>.pdf` or file key).
- For agreement sets: Uses composite `groupId` (e.g. `agreement-<timestamp>`).
- The frontend registers `tokenData.documentId` in `useAuditEngine` context and polls `/results/{documentId}`.

---

## 4. Existing Supabase & Upstash Redis Usage

### 4.1 Supabase Integration
- **Client Initializers**:
  - `lib/supabase-client.ts`: Uses `@supabase/ssr` (`createBrowserClient`) and `@supabase/supabase-js` (`createClient`).
  - `lib/supabase.ts`: Direct REST fetch client for pgvector RPC operations (`match_regulatory_rules`).
- **Authentication**:
  - `hooks/auth-context.tsx` and `components/auth/auth-modal.tsx`: Handles user sign-in, sign-up, session state, and JWT bearer tokens.
- **Database Schema**:
  - `supabase/schema.sql`: Table `regulatory_rules` with `pgvector` extension (768-dim), IVFFlat cosine index, and `match_regulatory_rules` RPC function.
- **Offline Seeding**:
  - `scripts/embed_regulations.py`: Generates Gemini embeddings and seeds `regulatory_rules`.

### 4.2 Upstash Redis Integration
- **Client Library**: `@upstash/redis` (`Redis`) and `@upstash/ratelimit` (`Ratelimit`).
- **File**: `lib/ratelimit.ts`.
- **Purpose**: Sliding window rate limiter enforcing **5 document scans per hour** per user or IP identifier.
- **Applied In**: `app/api/upload/route.ts` and `app/api/audit/route.ts` (returns HTTP 429 when quota exceeded).

### 4.3 Environment Variable Names Referenced in Code (Names Only)
- `process.env.GEMINI_API_KEY`
- `process.env.GOOGLE_API_KEY`
- `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `process.env.NEXT_PUBLIC_SUPABASE_URL`
- `process.env.NODE_ENV`
- `process.env.SUPABASE_SERVICE_ROLE_KEY`
- `process.env.UPSTASH_REDIS_REST_TOKEN`
- `process.env.UPSTASH_REDIS_REST_URL`

*(Python scripts also reference `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`, `S3_BUCKET_NAME`, `TABLE_NAME`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`)*.

---

## 5. `.gitignore`, CI Config & Existing Tests

### 5.1 Existing `.gitignore` Contents
```gitignore
# v0 sandbox internal files
__v0_runtime_loader.js
__v0_devtools.tsx
__v0_jsx-dev-runtime.ts
.snowflake/
.v0-trash/
.vercel/

# Environment variables
.env*.local
.env
!.env.example

# Common ignores
node_modules
.next/
.DS_Store

#mypersonalnotes
terraform-notes-for-me
```

### 5.2 CI/CD Configuration
- **Status**: No CI workflow file exists in `.github/workflows/` or repository root.

### 5.3 Existing Tests & Execution
- **Test Files**:
  - `tests/test_audit_core.py`: Validates checklist schema, multi-framework coverage, deterministic weighted scoring, critical gap capping, and N/A exclusions.
  - `tests/test_handler.py`: Validates Lambda handler event routing, S3 download mocking, DynamoDB persistence, and Gemini response parsing.
- **Execution Command**:
  ```bash
  python -m pytest tests/ -v
  ```
  *(Requires path fix in Section 6 below, as current test imports point to non-existent `lambda/` directory)*.

---

## 6. Proposed Path Mapping Table & Required Path Fixes

### 6.1 Kit File Mapping Table
| Kit Path (Generic / Suggested) | Proposed Real Path in Project | Rationale / Current State |
| :--- | :--- | :--- |
| `compliance-platform/lambda/audit_core.py` | `terraform/lambda_src/audit_core.py` | Existing deterministic scoring engine module |
| `compliance-platform/lambda/index.py` | `terraform/lambda_src/index.py` | Existing AWS Lambda entry point & event handler |
| `compliance-platform/lambda/checklists.json` | `terraform/lambda_src/checklists.json` | Canonical legal checklist dataset |
| `compliance-platform/lambda/requirements.txt` | `terraform/lambda_src/requirements.txt` | Python runtime dependencies for Lambda package |
| `compliance-platform/scripts/embed_regulations.py` | `scripts/embed_regulations.py` | Knowledge base embedding & seeding script |
| `compliance-platform/scripts/cleanup_s3.py` | `scripts/cleanup_s3.py` | S3 automated document cleanup script |
| `compliance-platform/supabase/schema.sql` | `supabase/schema.sql` | Supabase pgvector schema & RPC setup |
| `compliance-platform/tests/test_audit_core.py` | `tests/test_audit_core.py` | Pytest test suite for audit core |
| `compliance-platform/tests/test_handler.py` | `tests/test_handler.py` | Pytest test suite for Lambda handler |
| `compliance-platform/docs/PROJECT_MAP.md` | `docs/PROJECT_MAP.md` | This architectural map document |

### 6.2 Exact Path Fixes Needed in Code

1. **`scripts/embed_regulations.py`** (Lines 31 & 34):
   - Current:
     ```python
     sys.path.insert(0, os.path.join(ROOT, "lambda"))
     import audit_core as core
     CHECKLIST_PATH = os.path.join(ROOT, "lambda", "checklists.json")
     ```
   - Target Fix:
     ```python
     sys.path.insert(0, os.path.join(ROOT, "terraform", "lambda_src"))
     import audit_core as core
     CHECKLIST_PATH = os.path.join(ROOT, "terraform", "lambda_src", "checklists.json")
     ```

2. **`tests/test_audit_core.py`** (Lines 5 & 8):
   - Current:
     ```python
     sys.path.insert(0, os.path.join(ROOT, "lambda"))
     import audit_core as core
     CHECKLIST = core.load_checklist_file(os.path.join(ROOT, "lambda", "checklists.json"))
     ```
   - Target Fix:
     ```python
     sys.path.insert(0, os.path.join(ROOT, "terraform", "lambda_src"))
     import audit_core as core
     CHECKLIST = core.load_checklist_file(os.path.join(ROOT, "terraform", "lambda_src", "checklists.json"))
     ```

3. **`tests/test_handler.py`** (Line 6):
   - Current:
     ```python
     sys.path.insert(0, os.path.join(ROOT, "lambda"))
     ```
   - Target Fix:
     ```python
     sys.path.insert(0, os.path.join(ROOT, "terraform", "lambda_src"))
     ```

4. **Lambda Handler Configuration**:
   - In `terraform/main.tf` (Line 159): `handler = "index.handler"`.
   - **No change needed**: `lambda_function.zip` packages the contents of `terraform/lambda_src/` directly at the root of the zip archive, so `index.handler` correctly targets `index.py`.

---

## 7. Risks, Conflicts & Open Questions

### 7.1 Identified Conflicts & Code Discrepancies
1. **`index.py` Architecture**:
   - `terraform/lambda_src/index.py` currently has direct Gemini audit calls with hardcoded DynamoDB item structures (`overall_score`, `frameworks`, `risks`, `GdprScore`, `CcpaScore`, `Soc2Score`, `Iso27701Score`).
   - The kit's `audit_core.py` introduces deterministic checklist scoring (`items[]`, `evidence_quote`, `coverage_pct`). When integrating in Phase 1, the response contract must retain top-level framework score fields to preserve frontend compatibility.
2. **Hardcoded Fallbacks to Remove in Phase 0**:
   - `scripts/cleanup_s3.py` (lines 12–13): Default AWS credentials in source code.
   - `lib/ratelimit.ts` (lines 6, 9): Default Upstash Redis URL and token in source code.
   - `lib/supabase-client.ts` (line 8): Default Supabase anon key in source code.
   - `terraform/lambda_src/index.py` (line 33): Default Supabase service role key in source code.
3. **`.gitignore` Coverage**:
   - Current `.gitignore` does not explicitly exclude `*.tfstate`, `*.tfstate.backup`, `*.tfvars`, `.terraform/`, `lambda_function.zip`, or `.env.*` (beyond `.env*.local`). Must be updated in Phase 0.

### 7.2 Open Questions for User Approval
1. **Lambda Directory Confirmation**:
   - Do you approve keeping the primary Lambda source inside `terraform/lambda_src/` (with `sys.path` fixes pointing to `terraform/lambda_src`), or do you prefer creating a root `lambda/` directory?
2. **API Result Contract**:
   - When integrating `audit_core.py`, should the Lambda output retain both the new `items[]` checklist array AND the top-level `frameworks` / score attributes to ensure zero frontend regression?
3. **Pytest Dependency**:
   - Would you like `pytest` installed in your `.venv` so the test suite can be run locally during Phase 1?

---
*End of Phase D Discovery Report. Awaiting user approval of path mapping before proceeding.*

