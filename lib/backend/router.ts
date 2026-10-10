/**
 * lib/backend/router.ts - Failover backend router (server-side only).
 *
 * Chooses between AWS (primary) and FastAPI/Render (secondary) backends.
 * Returns composite IDs (aws:<id> / srv:<id>) so later calls route correctly.
 * Archives completed results into Supabase Postgres for durability.
 *
 * FAILOVER_MODE env:
 *   "auto"      - use primary if healthy, fall back to secondary (default)
 *   "primary"   - always use AWS
 *   "secondary" - always use secondary (post-AWS-closure mode)
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { AwsClient } from "./aws-client";
import {
  getCircuitState,
  isFailoverStatus,
  recordFailure,
  recordSuccess,
} from "./circuit-breaker";
import { ServerClient } from "./server-client";
import type {
  AuditResult,
  AuditStartResult,
  BackendClient,
  UploadResult,
} from "./types";
import { parseCompositeId } from "./types";

// ---------------------------------------------------------------------------
// Env
const FAILOVER_MODE = (
  process.env.FAILOVER_MODE || "auto"
).toLowerCase() as "auto" | "primary" | "secondary";

// ---------------------------------------------------------------------------
// Singleton clients (created lazily)
let awsClient: AwsClient | null = null;
let serverClient: ServerClient | null = null;
let archiveClient: SupabaseClient | null = null;

function getAwsClient(): AwsClient {
  if (!awsClient) awsClient = new AwsClient();
  return awsClient;
}

function getServerClient(): ServerClient {
  if (!serverClient) serverClient = new ServerClient();
  return serverClient;
}

function getArchiveClient(): SupabaseClient | null {
  if (archiveClient) return archiveClient;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    archiveClient = createClient(url, key);
  }
  return archiveClient;
}

// ---------------------------------------------------------------------------
// Archive helpers

/** Upsert a completed result into the Supabase audit_results table.
 *  Failures are logged but never break the user flow. */
async function archiveResult(
  documentId: string,
  result: AuditResult,
  backend: "aws" | "server",
  ownerId?: string
): Promise<void> {
  const sb = getArchiveClient();
  if (!sb) return;
  try {
    const now = new Date().toISOString();
    const effectiveOwnerId = result.owner_id || ownerId || null;
    await sb.from("audit_results").upsert(
      {
        document_id: documentId,
        status: result.Status || "COMPLETED",
        result: result,
        backend,
        owner_id: effectiveOwnerId,
        updated_at: now,
      },
      { onConflict: "document_id" }
    );
  } catch (err) {
    console.warn("[Router] Archive upsert failed (non-fatal):", err);
  }
}

/** Try to read a result from the archive (Supabase).
 *  Returns null on miss or error. */
async function readArchive(documentId: string): Promise<AuditResult | null> {
  const sb = getArchiveClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from("audit_results")
      .select("result, status, owner_id")
      .eq("document_id", documentId)
      .single();
    if (error || !data) return null;
    if (data.status === "COMPLETED" && data.result) {
      const res = data.result as AuditResult;
      if (!res.owner_id && data.owner_id) {
        res.owner_id = data.owner_id;
      }
      return res;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Choosing a backend

async function choosePrimaryClient(): Promise<BackendClient | null> {
  if (FAILOVER_MODE === "secondary") return null;
  try {
    const state = await getCircuitState();
    if (state === "OPEN") {
      console.log("[Router] Circuit breaker OPEN, skipping primary");
      return null;
    }
    return getAwsClient();
  } catch {
    return null;
  }
}

async function chooseSecondaryClient(): Promise<BackendClient | null> {
  if (FAILOVER_MODE === "primary") return null;
  try {
    return getServerClient();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Exported router functions

/**
 * Initiate a document upload. Returns composite ID.
 */
export async function routerInitUpload(
  filename: string,
  docType?: string,
  ownerId?: string
): Promise<UploadResult & { compositeId: string; backend: string; wakeUpMessage?: string }> {
  const primary = await choosePrimaryClient();

  // Try primary first
  if (primary) {
    try {
      const result = await primary.initUpload(filename, docType, ownerId);
      await recordSuccess();

      // Record ownership in Supabase archive if ownerId provided
      if (ownerId) {
        const sb = getArchiveClient();
        if (sb) {
          const now = new Date().toISOString();
          Promise.resolve(
            sb.from("audit_results").upsert(
              {
                document_id: result.documentId,
                status: "AWAITING_UPLOAD",
                backend: "aws",
                owner_id: ownerId,
                doc_type_hint: docType || null,
                created_at: now,
                updated_at: now,
              },
              { onConflict: "document_id" }
            )
          ).catch(() => {});
        }
      }

      return {
        ...result,
        compositeId: `aws:${result.documentId}`,
        backend: "aws",
      };
    } catch (err: unknown) {
      console.warn("[Router] Primary upload failed:", err);
      const status = (err as { status?: number })?.status;
      if (status && !isFailoverStatus(status)) throw err; // 400/404/413: don't failover
      await recordFailure();
    }
  }

  // Fall back to secondary
  const secondary = await chooseSecondaryClient();
  if (!secondary) {
    throw new Error("No backend available");
  }

  // Render Free cold start: call health first with long timeout
  let wakeUpMessage: string | undefined;
  try {
    const circuitState = await getCircuitState();
    if (circuitState !== "CLOSED" || !primary) {
      wakeUpMessage = "Starting backup server, this can take about a minute…";
      await secondary.health(70000);
    }
  } catch (err) {
    console.warn("[Router] Secondary health probe failed:", err);
    throw new Error("Secondary backend unavailable");
  }

  const result = await secondary.initUpload(filename, docType, ownerId);
  return {
    ...result,
    compositeId: `srv:${result.documentId}`,
    backend: "server",
    wakeUpMessage,
  };
}

/**
 * Start an audit. Resolves composite ID to the correct backend.
 */
export async function routerStartAudit(
  compositeId: string,
  ownerId?: string
): Promise<AuditStartResult & { backend: string }> {
  const { backend, rawId } = parseCompositeId(compositeId);
  const client = backend === "aws" ? getAwsClient() : getServerClient();
  const result = await client.startAudit(rawId, ownerId);
  return { ...result, backend };
}

/**
 * Get a result. Checks archive first, then live backend, then archives on read.
 * Enforces owner_id check when userId is provided.
 */
export async function routerGetResult(
  compositeId: string,
  userId?: string
): Promise<AuditResult & { backend: string }> {
  const { backend, rawId } = parseCompositeId(compositeId);

  // 1. Try the archive first (results survive after AWS is gone)
  const archived = await readArchive(rawId);
  if (archived) {
    // Owner check: if userId is provided, verify ownership
    if (userId && archived.owner_id && archived.owner_id !== userId) {
      throw new Error("FORBIDDEN: You do not own this document");
    }
    return { ...archived, backend: `${backend}:archived` };
  }

  // 2. Fetch from live backend
  const client = backend === "aws" ? getAwsClient() : getServerClient();

  let result: AuditResult;
  try {
    result = await client.getResult(rawId);
    if (backend === "aws") await recordSuccess();
  } catch (err: unknown) {
    if (backend === "aws") {
      const status = (err as { status?: number })?.status;
      if (status && isFailoverStatus(status)) await recordFailure();
    }
    throw err;
  }

  // Owner check
  if (userId && result.owner_id && result.owner_id !== userId) {
    throw new Error("FORBIDDEN: You do not own this document");
  }

  // 3. Archive on read (non-blocking, fire-and-forget)
  if (result.Status === "COMPLETED") {
    archiveResult(rawId, result, backend, userId).catch(() => {});
  }

  return { ...result, backend };
}

/**
 * Health check for the active backend(s).
 */
export async function routerHealth(): Promise<{
  primary: string;
  secondary: string;
  mode: string;
  circuitState: string;
}> {
  const circuitState = await getCircuitState();

  let primaryStatus = "unchecked";
  let secondaryStatus = "unchecked";

  if (FAILOVER_MODE !== "secondary") {
    try {
      await getAwsClient().health(5000);
      primaryStatus = "ok";
    } catch {
      primaryStatus = "down";
    }
  }

  if (FAILOVER_MODE !== "primary") {
    try {
      await getServerClient().health(10000);
      secondaryStatus = "ok";
    } catch {
      secondaryStatus = "down";
    }
  }

  return {
    primary: primaryStatus,
    secondary: secondaryStatus,
    mode: FAILOVER_MODE,
    circuitState,
  };
}

/**
 * Retrieve list of previous audits from Supabase archive.
 */
export async function routerListAudits(
  ownerId?: string,
  limit: number = 30
): Promise<
  Array<{
    document_id: string;
    status: string;
    updated_at: string;
    backend?: string;
    overall_score?: number | null;
    name?: string;
  }>
> {
  const sb = getArchiveClient();
  if (!sb) return [];
  try {
    let query = sb
      .from("audit_results")
      .select("document_id, status, updated_at, backend, owner_id, result")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (ownerId) {
      query = query.or(`owner_id.eq.${ownerId},owner_id.is.null`);
    }

    const { data, error } = await query;
    if (error || !data) {
      console.warn("[Router] routerListAudits query error:", error);
      return [];
    }

    return data.map((row: any) => {
      const res = row.result || {};
      const score = res.overall_score ?? res.OverallScore ?? res.score ?? res.Score ?? null;
      const docName = row.document_id.split("/").pop() || row.document_id;
      return {
        document_id: row.document_id,
        status: row.status || "COMPLETED",
        updated_at: row.updated_at || new Date().toISOString(),
        backend: row.backend || "aws",
        overall_score: score,
        name: docName,
      };
    });
  } catch (err) {
    console.warn("[Router] routerListAudits exception:", err);
    return [];
  }
}
