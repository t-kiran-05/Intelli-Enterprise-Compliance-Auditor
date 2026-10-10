/**
 * lib/backend/aws-client.ts - AWS backend implementation.
 *
 * Talks to the existing API Gateway → Lambda pipeline.
 * startAudit is a no-op because the S3 event notification triggers the Lambda.
 */

import type {
  AuditResult,
  AuditStartResult,
  BackendClient,
  HealthResult,
  UploadResult,
} from "./types";

const DEFAULT_AWS_API_BASE = "https://vbkod6j4wc.execute-api.us-east-1.amazonaws.com";

export class AwsClient implements BackendClient {
  readonly name = "aws" as const;
  private readonly baseUrl: string;
  private readonly apiToken: string | undefined;

  constructor(baseUrl?: string, apiToken?: string) {
    this.baseUrl = (
      baseUrl || process.env.PRIMARY_BACKEND_URL || DEFAULT_AWS_API_BASE
    ).replace(/\/$/, "");
    if (!this.baseUrl) {
      throw new Error("PRIMARY_BACKEND_URL is not configured");
    }
    this.apiToken = apiToken || process.env.AWS_API_TOKEN || process.env.API_TOKEN;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.apiToken) {
      h["x-api-token"] = this.apiToken;
    }
    return h;
  }

  async health(timeoutMs = 5000): Promise<HealthResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // AWS API Gateway doesn't have a dedicated /health, so we try a lightweight GET
      const res = await fetch(`${this.baseUrl}/results/__health_probe__`, {
        signal: controller.signal,
        headers: this.headers(),
      });
      // A 404 from API Gateway means the gateway is reachable
      if (res.status === 404 || res.ok) {
        return { status: "ok", backend: "aws" };
      }
      throw new Error(`AWS health probe returned ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async initUpload(filename: string, docType?: string, _ownerId?: string): Promise<UploadResult> {
    const body: Record<string, string> = { filename };
    if (docType && docType !== "auto") body.docType = docType;

    const res = await fetch(`${this.baseUrl}/upload`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`AWS upload failed: ${res.status} ${text}`);
    }
    const data = await res.json();
    return {
      uploadUrl: data.uploadUrl,
      documentId: data.documentId,
    };
  }

  async startAudit(
    documentId: string,
    _ownerId?: string
  ): Promise<AuditStartResult> {
    // No-op: S3 event notification triggers the Lambda automatically
    return {
      documentId,
      status: "PROCESSING",
      message: "S3 event will trigger audit automatically",
    };
  }

  async getResult(documentId: string): Promise<AuditResult> {
    const encoded = encodeURIComponent(documentId);
    const res = await fetch(`${this.baseUrl}/results/${encoded}`, {
      headers: this.headers(),
    });
    if (res.status === 404) {
      const data = await res.json().catch(() => ({}));
      return {
        Status: "NOT_FOUND",
        message: data.message || "Document not processed yet.",
        ...data,
      } as AuditResult;
    }
    if (!res.ok) {
      throw new Error(`AWS getResult failed: ${res.status}`);
    }
    return res.json();
  }
}
