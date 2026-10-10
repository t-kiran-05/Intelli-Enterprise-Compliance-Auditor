/**
 * lib/backend/types.ts - Shared types for the failover backend router.
 *
 * Both AwsClient and ServerClient implement the BackendClient interface.
 * The router dispatches to the chosen backend and returns composite IDs.
 */

/** Upload initiation response from either backend. */
export interface UploadResult {
  uploadUrl: string;
  documentId: string;
}

/** Audit start response. */
export interface AuditStartResult {
  documentId: string;
  status: string;
  message?: string;
}

/** Raw audit result from either backend (backward-compatible shape). */
export interface AuditResult {
  DocumentId: string;
  Status: string;
  overall_score?: number | null;
  OverallScore?: number | null;
  Score?: number | null;
  GdprScore?: number | null;
  Soc2Score?: number | null;
  CcpaScore?: number | null;
  Iso27701Score?: number | null;
  frameworks?: Record<string, unknown>;
  risks?: unknown[];
  items?: unknown[];
  meta?: Record<string, unknown>;
  forward_looking?: unknown[];
  placeholders?: unknown[];
  Error?: string;
  owner_id?: string;
  [key: string]: unknown;
}

/** Health check response. */
export interface HealthResult {
  status: string;
  backend: string;
  timestamp?: string;
}

/** Abstract backend client interface. */
export interface BackendClient {
  readonly name: "aws" | "server";

  /** Health probe. Should resolve within the given timeout (ms). */
  health(timeoutMs?: number): Promise<HealthResult>;

  /** Request an upload URL + document ID. */
  initUpload(filename: string, docType?: string, ownerId?: string): Promise<UploadResult>;

  /** Start an audit (may be a no-op for AWS where S3 events trigger it). */
  startAudit(documentId: string, ownerId?: string): Promise<AuditStartResult>;

  /** Fetch the current result for a document. */
  getResult(documentId: string): Promise<AuditResult>;
}

/** Composite ID format: "aws:<id>" or "srv:<id>". */
export type CompositeId = `aws:${string}` | `srv:${string}`;

/** Parse a composite ID into its backend prefix and raw ID. */
export function parseCompositeId(compositeId: string): {
  backend: "aws" | "server";
  rawId: string;
} {
  if (compositeId.startsWith("aws:")) {
    return { backend: "aws", rawId: compositeId.slice(4) };
  }
  if (compositeId.startsWith("srv:")) {
    return { backend: "server", rawId: compositeId.slice(4) };
  }
  // Legacy IDs without prefix are assumed to be AWS
  return { backend: "aws", rawId: compositeId };
}
