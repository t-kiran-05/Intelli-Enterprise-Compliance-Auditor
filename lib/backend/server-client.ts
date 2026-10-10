/**
 * lib/backend/server-client.ts - FastAPI secondary backend implementation.
 *
 * Talks to the Render-hosted (or local) FastAPI server.
 * Authenticated via x-backend-token header (server-to-server only).
 */

import type {
  AuditResult,
  AuditStartResult,
  BackendClient,
  HealthResult,
  UploadResult,
} from "./types";

export class ServerClient implements BackendClient {
  readonly name = "server" as const;
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl?: string, token?: string) {
    this.baseUrl = (
      baseUrl || process.env.SECONDARY_BACKEND_URL || "http://localhost:8000"
    ).replace(/\/$/, "");
    this.token = token || process.env.BACKEND_SHARED_TOKEN || "dev-local-shared-token";
  }

  private headers(): Record<string, string> {
    const currentToken =
      process.env.BACKEND_SHARED_TOKEN?.trim() ||
      this.token ||
      "dev-local-shared-token";
    return {
      "Content-Type": "application/json",
      "x-backend-token": currentToken,
    };
  }

  async health(timeoutMs = 70000): Promise<HealthResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // /health does not require auth
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Server health returned ${res.status}`);
      }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async initUpload(filename: string, docType?: string, ownerId?: string): Promise<UploadResult> {
    const body: Record<string, string> = { filename };
    if (docType && docType !== "auto") body.docType = docType;
    if (ownerId) body.ownerId = ownerId;

    const res = await fetch(`${this.baseUrl}/upload`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Server upload failed: ${res.status} ${text}`);
    }
    const data = await res.json();
    return {
      uploadUrl: data.uploadUrl,
      documentId: data.documentId,
    };
  }

  async startAudit(
    documentId: string,
    ownerId?: string
  ): Promise<AuditStartResult> {
    const body: Record<string, string> = {};
    if (ownerId) body.ownerId = ownerId;

    const res = await fetch(
      `${this.baseUrl}/audits/${encodeURIComponent(documentId)}/start`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Server startAudit failed: ${res.status} ${text}`);
    }
    return res.json();
  }

  async getResult(documentId: string): Promise<AuditResult> {
    const res = await fetch(
      `${this.baseUrl}/results/${encodeURIComponent(documentId)}`,
      { headers: this.headers() }
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`Server getResult failed: ${res.status}`);
    }
    return res.json();
  }
}
