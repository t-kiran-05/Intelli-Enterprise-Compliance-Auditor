"use client";

import { useEffect, useRef, useState } from "react";
import { IngestionDropzone } from "./ingestion-dropzone";
import {
  type AuditDocument,
  type AuditMeta,
  type BackendRisk,
  type ChecklistItem,
  type DocTypeHint,
  type Frameworks,
} from "@/lib/audit";
import { useAuditEngineContext } from "@/hooks/audit-engine-context";
import { useAuthContext } from "@/hooks/auth-context";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  MinusCircle,
  RotateCw,
  ShieldAlert,
  X,
  XCircle,
  Zap,
} from "lucide-react";

type BackendResult = {
  DocumentId?: string;
  Status?: string;
  overall_score?: number | null;
  OverallScore?: number | null;
  Score?: number | null;
  GdprScore?: number | null;
  gdpr_score?: number | null;
  CcpaScore?: number | null;
  ccpa_score?: number | null;
  Soc2Score?: number | null;
  soc2_score?: number | null;
  Iso27701Score?: number | null;
  iso27701_score?: number | null;
  frameworks?: Frameworks | string;
  Frameworks?: Frameworks | string;
  risks?: BackendRisk[] | string;
  Risks?: BackendRisk[] | string;
  Findings?: any;
  items?: ChecklistItem[] | string;
  meta?: AuditMeta | string;
  forward_looking?: any[] | string;
  Error?: string;
  [k: string]: any;
};

function parseJsonValue<T>(value: string | T | undefined, fallback: T): T {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function extractFrameworkObj(rawFws: any, canonicalKey: "gdpr" | "soc2" | "ccpa" | "iso27701"): any {
  if (!rawFws || typeof rawFws !== "object") return null;
  if (rawFws[canonicalKey] && typeof rawFws[canonicalKey] === "object") return rawFws[canonicalKey];

  const aliasMap: Record<string, string[]> = {
    gdpr: ["gdpr", "GDPR"],
    soc2: ["soc2", "soc_2", "soc-2", "soc 2", "SOC2", "SOC 2", "SOC_2"],
    ccpa: ["ccpa", "cpra", "ccpa_cpra", "CCPA", "CPRA", "CCPA/CPRA", "ccpa/cpra"],
    iso27701: [
      "iso27701",
      "iso_27701",
      "iso-27701",
      "iso 27701",
      "ISO27701",
      "ISO 27701",
      "ISO/IEC 27701",
      "iso/iec 27701",
      "iso_iec_27701",
      "iso27001",
      "ISO27001",
      "iso",
      "ISO",
    ],
  };

  const aliases = aliasMap[canonicalKey] || [canonicalKey];
  for (const alias of aliases) {
    if (rawFws[alias] && typeof rawFws[alias] === "object") return rawFws[alias];
  }

  for (const [k, v] of Object.entries(rawFws)) {
    if (v && typeof v === "object") {
      const cleanK = k.toLowerCase().replace(/[\s_\-\/]/g, "");
      for (const alias of aliases) {
        const cleanAlias = alias.toLowerCase().replace(/[\s_\-\/]/g, "");
        if (cleanK === cleanAlias) return v;
      }
    }
  }

  return null;
}

function extractNumber(data: any, keys: string[]): number | null {
  if (!data || typeof data !== "object") return null;
  for (const key of keys) {
    if (typeof data[key] === "number" && !isNaN(data[key])) return data[key];
    if (typeof data[key] === "string") {
      const p = parseInt(data[key], 10);
      if (!isNaN(p)) return p;
    }
  }
  return null;
}

export function normalizeAuditResponse(data: BackendResult): {
  overall_score: number | null;
  frameworks: Frameworks;
  risks: BackendRisk[];
  items: ChecklistItem[];
  meta: AuditMeta;
  forward_looking: any[];
} {
  let overallScore: number | null = null;
  if (typeof data.OverallScore === "number" && !isNaN(data.OverallScore)) {
    overallScore = data.OverallScore;
  } else if (typeof data.overall_score === "number" && !isNaN(data.overall_score)) {
    overallScore = data.overall_score;
  } else if (typeof data.Score === "number" && !isNaN(data.Score)) {
    overallScore = data.Score;
  }

  const parsedFws = parseJsonValue<any>(data.frameworks || data.Frameworks, null);

  const gdprObj = extractFrameworkObj(parsedFws, "gdpr");
  const ccpaObj = extractFrameworkObj(parsedFws, "ccpa");
  const soc2Obj = extractFrameworkObj(parsedFws, "soc2");
  const isoObj = extractFrameworkObj(parsedFws, "iso27701");

  // Strictly map individual framework cards to response score keys with no defaulted 0 for unscored
  const gdprScore =
    extractNumber(data, ["GdprScore", "gdpr_score", "gdprScore", "GDPRScore", "GDPR", "gdpr"]) ??
    (typeof gdprObj?.score === "number" && !isNaN(gdprObj.score) ? gdprObj.score : null);

  const ccpaScore =
    extractNumber(data, ["CcpaScore", "ccpa_score", "ccpaScore", "CCPAScore", "CCPA", "ccpa", "cpraScore", "cpra"]) ??
    (typeof ccpaObj?.score === "number" && !isNaN(ccpaObj.score) ? ccpaObj.score : null);

  const soc2Score =
    extractNumber(data, ["Soc2Score", "soc2_score", "soc2Score", "SOC2Score", "SOC2", "soc2", "soc_2"]) ??
    (typeof soc2Obj?.score === "number" && !isNaN(soc2Obj.score) ? soc2Obj.score : null);

  const iso27701Score =
    extractNumber(data, [
      "Iso27701Score",
      "iso27701_score",
      "iso27701Score",
      "Iso27701",
      "iso27701",
      "iso_27701",
      "iso_27701_score",
      "IsoScore",
      "iso_score",
      "Iso27001Score",
      "iso27001_score",
      "ISO27701",
      "ISO_27701",
      "ISO/IEC 27701",
      "ISO 27701",
    ]) ?? (typeof isoObj?.score === "number" && !isNaN(isoObj.score) ? isoObj.score : null);

  const getStatus = (score: number | null, explicitStatus?: string) => {
    const s = (explicitStatus || "").toUpperCase().trim();
    if (s === "COMPLIANT" || s === "NEEDS_REVIEW" || s === "NON_COMPLIANT" || s === "UNSCORED") return s;
    if (score === null) return "UNSCORED";
    return score >= 80 ? "COMPLIANT" : score >= 60 ? "NEEDS_REVIEW" : "NON_COMPLIANT";
  };

  const parseCoverage = (val: any): number | null => (typeof val === "number" && !isNaN(val) ? val : null);
  const parseArr = (val: any): any[] => (Array.isArray(val) ? val : []);

  const frameworks: Frameworks = {
    gdpr: {
      score: gdprScore,
      status: getStatus(gdprScore, gdprObj?.status),
      summary: gdprObj?.summary || (gdprScore !== null ? `GDPR independent evaluation score: ${gdprScore}/100.` : "Not assessable for this document type."),
      rationale: gdprObj?.rationale || gdprObj?.summary || "GDPR compliance criteria evaluated.",
      coverage_pct: parseCoverage(gdprObj?.coverage_pct),
      critical_gaps: parseArr(gdprObj?.critical_gaps),
      unverifiable: parseArr(gdprObj?.unverifiable),
      disclosure_only: Boolean(gdprObj?.disclosure_only),
      counts: gdprObj?.counts,
    },
    soc2: {
      score: soc2Score,
      status: getStatus(soc2Score, soc2Obj?.status),
      summary: soc2Obj?.summary || (soc2Score !== null ? `SOC 2 independent evaluation score: ${soc2Score}/100.` : "Not assessable for this document type."),
      rationale: soc2Obj?.rationale || soc2Obj?.summary || "SOC 2 Trust Services Criteria evaluated.",
      coverage_pct: parseCoverage(soc2Obj?.coverage_pct),
      critical_gaps: parseArr(soc2Obj?.critical_gaps),
      unverifiable: parseArr(soc2Obj?.unverifiable),
      disclosure_only: Boolean(soc2Obj?.disclosure_only ?? true),
      counts: soc2Obj?.counts,
    },
    ccpa: {
      score: ccpaScore,
      status: getStatus(ccpaScore, ccpaObj?.status),
      summary: ccpaObj?.summary || (ccpaScore !== null ? `CCPA independent evaluation score: ${ccpaScore}/100.` : "Not assessable for this document type."),
      rationale: ccpaObj?.rationale || ccpaObj?.summary || "CCPA statutory consumer rights evaluated.",
      coverage_pct: parseCoverage(ccpaObj?.coverage_pct),
      critical_gaps: parseArr(ccpaObj?.critical_gaps),
      unverifiable: parseArr(ccpaObj?.unverifiable),
      disclosure_only: Boolean(ccpaObj?.disclosure_only),
      counts: ccpaObj?.counts,
    },
    iso27701: {
      score: iso27701Score,
      status: getStatus(iso27701Score, isoObj?.status),
      summary:
        isoObj?.summary ||
        (iso27701Score !== null
          ? iso27701Score >= 80
            ? "ISO/IEC 27701 PII controller and processor lifecycle controls are satisfied."
            : iso27701Score >= 60
              ? "ISO/IEC 27701 baseline PII controls identified; review retention schedules."
              : "ISO/IEC 27701 PII data retention and disposal controls require remediation."
          : "Not assessable for this document type."),
      rationale:
        isoObj?.rationale ||
        isoObj?.summary ||
        (iso27701Score !== null ? "ISO/IEC 27701 PII governance controls evaluated." : "ISO/IEC 27701 not assessable."),
      coverage_pct: parseCoverage(isoObj?.coverage_pct),
      critical_gaps: parseArr(isoObj?.critical_gaps),
      unverifiable: parseArr(isoObj?.unverifiable),
      disclosure_only: Boolean(isoObj?.disclosure_only),
      counts: isoObj?.counts,
    },
  };

  const rawRisks = parseJsonValue<BackendRisk[]>(
    data.Findings || data.findings || data.risks || data.Risks,
    [],
  );
  const risks = Array.isArray(rawRisks) ? rawRisks : [];

  const rawItems = parseJsonValue<ChecklistItem[]>(data.items, []);
  const items = Array.isArray(rawItems) ? rawItems : [];

  const rawMeta = parseJsonValue<AuditMeta>(data.meta, {});
  const meta: AuditMeta = typeof rawMeta === "object" && rawMeta !== null ? rawMeta : {};

  const rawForward = parseJsonValue<any[]>(data.forward_looking || data.forwardLooking, []);
  const forward_looking = Array.isArray(rawForward) ? rawForward : [];

  return {
    overall_score: overallScore,
    frameworks,
    risks,
    items,
    meta,
    forward_looking,
  };
}

function fileTypeFor(file: File): "PDF" | "DOCX" | "TXT" {
  const lower = file.name.toLowerCase();
  return lower.endsWith(".docx") ? "DOCX" : lower.endsWith(".txt") ? "TXT" : "PDF";
}

function statusBadgeClass(status?: string): string {
  const normalized = (status || "").toUpperCase().trim();
  if (normalized === "COMPLIANT" || normalized === "MET") {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  }
  if (normalized === "NEEDS_REVIEW" || normalized === "PARTIAL") {
    return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  }
  if (normalized === "UNSCORED" || normalized === "NOT_APPLICABLE") {
    return "bg-slate-500/15 text-slate-600 dark:text-slate-400";
  }
  return "bg-rose-500/15 text-rose-700 dark:text-rose-300";
}

function severityBadgeClass(severity?: string): string {
  const normalized = (severity || "").toUpperCase().trim();
  if (normalized === "CRITICAL") {
    return "bg-rose-500/15 text-rose-700 dark:text-rose-300";
  }
  if (normalized === "HIGH") {
    return "bg-orange-500/15 text-orange-700 dark:text-orange-300";
  }
  if (normalized === "MEDIUM") {
    return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  }
  return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
}

export default function DocumentAuditor() {
  const { registerPendingDocument, finalizeDocument } = useAuditEngineContext();
  const { isAuthenticated, session, openAuthModal } = useAuthContext();

  const [status, setStatus] = useState<"idle" | "uploading" | "processing" | "completed" | "failed">("idle");
  const [auditData, setAuditData] = useState<{
    documentId: string;
    overall_score: number | null;
    frameworks: Frameworks;
    risks: BackendRisk[];
    items?: ChecklistItem[];
    meta?: AuditMeta;
    forwardLooking?: any[];
  } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [queueDocs, setQueueDocs] = useState<AuditDocument[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [rateLimitInfo, setRateLimitInfo] = useState<{ remaining: number; timeToReset: string } | null>(null);
  const [dismissFreeTierBanner, setDismissFreeTierBanner] = useState<boolean>(false);
  const [expandedFrameworks, setExpandedFrameworks] = useState<Record<string, boolean>>({});
  const [expandedItemIds, setExpandedItemIds] = useState<Record<string, boolean>>({});
  const [expandedRiskFixes, setExpandedRiskFixes] = useState<Record<number, boolean>>({});
  const [selectedRiskCategory, setSelectedRiskCategory] = useState<string | null>(null);
  const [expandedUnverifiable, setExpandedUnverifiable] = useState<boolean>(false);
  const [pillarFilter, setPillarFilter] = useState<string | null>(null);

  type PreviousAudit = {
    document_id: string;
    status: string;
    updated_at: string;
    backend?: string;
    overall_score?: number | null;
    name?: string;
  };

  const [previousAudits, setPreviousAudits] = useState<PreviousAudit[]>([]);
  const [showPreviousAudits, setShowPreviousAudits] = useState<boolean>(false);
  const [isLoadingPrevious, setIsLoadingPrevious] = useState<boolean>(false);
  const [lastSavedDoc, setLastSavedDoc] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const handleCategoryFilter = (e: any) => {
      const cat = e.detail?.category;
      setPillarFilter(cat || null);
    };
    window.addEventListener("filter-audit-category", handleCategoryFilter);
    return () => window.removeEventListener("filter-audit-category", handleCategoryFilter);
  }, []);

  const API_BASE = "https://vbkod6j4wc.execute-api.us-east-1.amazonaws.com";
  const pollIntervalRef = useRef<number | null>(null);

  const getAuthHeaders = () => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }
    return headers;
  };

  const fetchPreviousAudits = async () => {
    setIsLoadingPrevious(true);
    try {
      const res = await fetch("/api/results", {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.audits)) {
          setPreviousAudits(data.audits);
        }
      }
    } catch (e) {
      console.error("Failed to fetch previous audits from Supabase:", e);
    } finally {
      setIsLoadingPrevious(false);
    }
  };

  const handleRefreshRecord = () => {
    const targetId = auditData?.documentId || lastSavedDoc?.id;
    const targetName = lastSavedDoc?.name;
    if (targetId) {
      loadAuditById(targetId, targetName);
    }
  };

  const handleAgreementFiles = async (files: File[]) => {
    // 1. Auth Gate
    if (!isAuthenticated) {
      openAuthModal();
      return;
    }

    const groupId = `agreement-${Date.now().toString(36)}`;
    const groupName = `Agreement set (${files.length} documents)`;
    const sizeBytes = files.reduce((total, file) => total + file.size, 0);
    const fileType = fileTypeFor(files[0]);

    try {
      setAuditData(null);
      setErrorMessage("");
      setStatus("uploading");
      registerPendingDocument({ id: groupId, name: groupName, sizeBytes, fileType });
      const documentIds: string[] = [];

      for (const file of files) {
        const key = `agreements/${groupId}/${file.name}`;

        // Call rate-limited upload endpoint
        const tokenRes = await fetch("/api/upload", {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({ filename: key }),
        });

        if (tokenRes.status === 429) {
          const limitData = await tokenRes.json().catch(() => ({}));
          throw new Error(
            limitData.error || `Rate limit exceeded (5 scans/hour). Limit resets in ${limitData.timeToReset || "1 hour"}.`,
          );
        }

        if (!tokenRes.ok) throw new Error(`Could not authorize upload for ${file.name}`);
        const tokenData = (await tokenRes.json()) as { uploadUrl: string; documentId: string; remaining?: number; timeToReset?: string };
        if (typeof tokenData.remaining === "number") {
          setRateLimitInfo({ remaining: tokenData.remaining, timeToReset: tokenData.timeToReset || "1 hour" });
        }

        const putRes = await fetch(tokenData.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: file,
        });
        if (!putRes.ok) throw new Error(`Could not upload ${file.name}`);
        documentIds.push(tokenData.documentId);
      }

      const startRes = await fetch(`${API_BASE}/agreement-audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ groupId, documentIds }),
      });
      if (!startRes.ok) throw new Error("Could not start agreement audit");
      setStatus("processing");

      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = window.setInterval(async () => {
        try {
          const resultRes = await fetch(`${API_BASE}/agreement-results/${encodeURIComponent(groupId)}`);
          if (resultRes.status === 404) return;
          if (!resultRes.ok) throw new Error("Could not read agreement audit result");
          const data = (await resultRes.json()) as BackendResult;
          if (data.Status === "FAILED") throw new Error(data.Error || "Agreement audit failed");
          if (data.Status !== "COMPLETED") return;

          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

          const { overall_score, frameworks, risks, items, meta, forward_looking } = normalizeAuditResponse(data);

          finalizeDocument({
            id: groupId,
            name: groupName,
            sizeBytes,
            fileType,
            overall_score,
            frameworks,
            risks,
            items,
            meta,
            forwardLooking: forward_looking,
            unscoredReason: meta?.unscored_reason,
          });

          setAuditData({
            documentId: groupId,
            overall_score,
            frameworks,
            risks,
            items,
            meta,
            forwardLooking: forward_looking,
          });
          setStatus("completed");
        } catch (error) {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setErrorMessage(error instanceof Error ? error.message : "Agreement audit failed");
          setStatus("failed");
        }
      }, 3000);
    } catch (error: any) {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      setErrorMessage(error?.message || "Agreement audit failed");
      setStatus("failed");
    }
  };

  const handleFileUpload = async (file: File | null, docType?: string) => {
    if (!file) return;

    // 1. Auth Gate: Require login before uploading
    if (!isAuthenticated) {
      openAuthModal();
      return;
    }

    try {
      setAuditData(null);
      setErrorMessage("");
      setUploadProgress(0);
      setStatus("uploading");

      const fileType = fileTypeFor(file);
      const currentDoc: AuditDocument = {
        id: Math.random().toString(36).substring(7),
        name: file.name,
        sizeBytes: file.size,
        fileType,
        stage: "uploading",
        progress: 0,
        chunks: 0,
        risksFound: 0,
        complianceScore: null,
        frameworkScores: { gdpr: null, soc2: null, ccpa: null, iso27701: null },
        riskByCategory: {} as any,
        clauses: [],
        docTypeHint: docType as DocTypeHint,
        createdAt: Date.now(),
      };
      setQueueDocs([currentDoc]);

      // Phase 1: Request S3 Presigned URL via Next.js rate-limited API route
      const tokenRes = await fetch("/api/upload", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          filename: file.name,
          file_name: file.name,
          docType: docType || undefined,
        }),
      });

      // 2. Rate limit handler (HTTP 429)
      if (tokenRes.status === 429) {
        const limitData = await tokenRes.json().catch(() => ({}));
        setQueueDocs([]);
        throw new Error(
          limitData.error ||
            `Rate limit exceeded: You are limited to 5 document scans per hour. Try again in ${limitData.timeToReset || "1 hour"}.`,
        );
      }

      if (!tokenRes.ok) {
        const errPayload = await tokenRes.json().catch(() => ({}));
        throw new Error(errPayload.error || "Could not acquire S3 upload authorization.");
      }

      const tokenData = (await tokenRes.json()) as {
        uploadUrl: string;
        documentId: string;
        remaining?: number;
        timeToReset?: string;
      };

      if (typeof tokenData.remaining === "number") {
        setRateLimitInfo({ remaining: tokenData.remaining, timeToReset: tokenData.timeToReset || "1 hour" });
      }

      // Register in shared context with returned documentId
      registerPendingDocument({
        id: tokenData.documentId,
        name: file.name,
        sizeBytes: file.size,
        fileType,
        docTypeHint: docType as DocTypeHint,
      });

      // Phase 2: Binary PUT directly to S3 Vault
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", tokenData.uploadUrl, true);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(pct);
        }
      };

      const uploadToS3 = () =>
        new Promise<void>((resolve, reject) => {
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(`S3 Rejected with status: ${xhr.status} ${xhr.statusText}`));
            }
          };
          xhr.onerror = () => reject(new Error("S3 Network connection error."));
          xhr.send(file);
        });

      await uploadToS3();

      // If secondary backend was selected, trigger background audit execution
      if (tokenData.documentId.startsWith("srv:")) {
        await fetch(`/api/results/${encodeURIComponent(tokenData.documentId)}`, {
          method: "POST",
          headers: getAuthHeaders(),
        }).catch(() => {});
      }

      // Persist document metadata in localStorage so page refreshes or reloads resume automatically
      try {
        localStorage.setItem(
          "ai_compliance_last_doc",
          JSON.stringify({
            id: tokenData.documentId,
            name: file.name,
            size: file.size,
            fileType,
            docTypeHint: docType,
          }),
        );
      } catch {}

      // Phase 3: Poll results through Next.js server route (owner check + archive-on-read)
      startPolling(tokenData.documentId, file.name, file.size, fileType, docType as DocTypeHint);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err?.message || "Pipeline execution failed.");
      setStatus("failed");
    }
  };

  const loadAuditById = async (rawDocId: string, customName?: string) => {
    let docId = rawDocId.trim();
    if (!docId) return;
    if (!docId.startsWith("aws:") && !docId.startsWith("srv:")) {
      docId = `aws:${docId}`;
    }
    const fileName = customName || docId.split("/").pop() || "Audited Document";

    setStatus("processing");
    setErrorMessage("");

    try {
      const res = await fetch(`/api/results/${encodeURIComponent(docId)}`, {
        headers: getAuthHeaders(),
      });
      if (res.status === 404) {
        startPolling(docId, fileName, 0, "TXT");
        return;
      }
      if (!res.ok) {
        throw new Error(`Failed to load document (${res.status})`);
      }
      const data = (await res.json()) as BackendResult;
      const currentStatus = (data?.Status || data?.status || "").toUpperCase().trim();

      if (currentStatus === "COMPLETED") {
        const { overall_score, frameworks, risks, items, meta, forward_looking } = normalizeAuditResponse(data);
        finalizeDocument({
          id: docId,
          name: fileName,
          sizeBytes: 0,
          fileType: "TXT",
          overall_score,
          frameworks,
          risks,
          items,
          meta,
          forwardLooking: forward_looking,
          unscoredReason: meta?.unscored_reason,
        });
        setAuditData({
          documentId: docId,
          overall_score,
          frameworks,
          risks,
          items,
          meta,
          forwardLooking: forward_looking,
        });
        setStatus("completed");
        try {
          localStorage.setItem(
            "ai_compliance_last_doc",
            JSON.stringify({ id: docId, name: fileName, size: 0, fileType: "TXT" }),
          );
        } catch {}
      } else if (currentStatus === "PROCESSING") {
        startPolling(docId, fileName, 0, "TXT");
      } else if (currentStatus === "FAILED") {
        setErrorMessage(data?.Error || data?.error || "Audit evaluation failed");
        setStatus("failed");
      }
    } catch (err: any) {
      console.error("[loadAuditById] Error:", err);
      setErrorMessage(err?.message || "Failed to load audit results.");
      setStatus("failed");
    }
  };

  const startPolling = (
    docId: string,
    fileName: string,
    fileSize: number,
    docFileType: "PDF" | "DOCX" | "TXT",
    docHint?: DocTypeHint,
  ) => {
    setStatus("processing");
    setQueueDocs([]);

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    let pollCount = 0;
    pollIntervalRef.current = window.setInterval(async () => {
      pollCount++;
      try {
        const res = await fetch(`/api/results/${encodeURIComponent(docId)}`, {
          headers: getAuthHeaders(),
        });
        if (res.status === 404) return; // Still processing in DynamoDB / secondary server

        const data = (await res.json()) as BackendResult;
        const currentStatus = (data?.Status || data?.status || "").toUpperCase().trim();

        if (currentStatus === "COMPLETED") {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }

          try {
            const { overall_score, frameworks, risks, items, meta, forward_looking } = normalizeAuditResponse(data);

            finalizeDocument({
              id: docId,
              name: fileName,
              sizeBytes: fileSize,
              fileType: docFileType,
              overall_score,
              frameworks,
              risks,
              items,
              meta,
              forwardLooking: forward_looking,
              docTypeHint: docHint,
              unscoredReason: meta?.unscored_reason,
            });

            setAuditData({
              documentId: docId,
              overall_score,
              frameworks,
              risks,
              items,
              meta,
              forwardLooking: forward_looking,
            });
            setStatus("completed");
          } catch (normErr: any) {
            console.error("Failed to parse audit response:", normErr);
            setErrorMessage(`Failed to display audit results: ${normErr?.message || "Parsing error"}`);
            setStatus("failed");
          }
        } else if (currentStatus === "FAILED") {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setErrorMessage(data?.Error || data?.error || "Backend audit evaluation failed.");
          setStatus("failed");
        }
      } catch (e: any) {
        console.error("Polling fetch encounter error:", e);
        if (pollCount > 60) {
          // Timed out after 3 minutes
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setErrorMessage("Audit polling timed out. Please refresh or retry.");
          setStatus("failed");
        }
      }
    }, 3000);
  };

  // Only clear interval on genuine unmount (never on auth/session re-renders)
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  // Sync upload handler to window
  useEffect(() => {
    (window as any).globalHandleUpload = handleFileUpload;
    return () => {
      (window as any).globalHandleUpload = null;
    };
  }, [isAuthenticated, session]);

  // Check URL query parameters or localStorage once on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlDocId = params.get("docId") || params.get("id");
      if (urlDocId) {
        loadAuditById(urlDocId);
        return;
      }
    }

    try {
      const savedDocRaw = localStorage.getItem("ai_compliance_last_doc");
      if (savedDocRaw) {
        const savedDoc = JSON.parse(savedDocRaw);
        if (savedDoc?.id) {
          setLastSavedDoc(savedDoc);
        }
      }
    } catch {}
  }, []);

  const frameworkLabels: Record<keyof Frameworks, string> = {
    gdpr: "GDPR",
    soc2: "SOC 2",
    ccpa: "CCPA",
    iso27701: "ISO/IEC 27701",
  };

  const riskCategories = (() => {
    if (!auditData?.risks || auditData.risks.length === 0) return [];
    const counts: Record<string, number> = {};
    for (const r of auditData.risks) {
      const cat = r.category || "General";
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return Object.entries(counts).map(([category, count]) => ({ category, count }));
  })();

  const filteredRisks = (auditData?.risks || [])
    .map((r, globalIdx) => ({ ...r, globalIdx }))
    .filter((r) => {
      if (selectedRiskCategory && (r.category || "General") !== selectedRiskCategory) {
        return false;
      }
      if (pillarFilter) {
        const cat = (r.category || "").toLowerCase();
        if (
          pillarFilter === "Data Privacy" &&
          !cat.includes("privacy") &&
          !cat.includes("data") &&
          !cat.includes("gdpr") &&
          !cat.includes("ccpa")
        )
          return false;
        if (
          pillarFilter === "Security" &&
          !cat.includes("security") &&
          !cat.includes("access") &&
          !cat.includes("soc")
        )
          return false;
        if (
          pillarFilter === "Governance" &&
          !cat.includes("governance") &&
          !cat.includes("liability") &&
          !cat.includes("termination") &&
          !cat.includes("ip") &&
          !cat.includes("law") &&
          !cat.includes("iso")
        )
          return false;
      }
      return true;
    });

  const criticalRisks = filteredRisks.filter(
    (r) =>
      (r.severity || "").toUpperCase() === "CRITICAL" ||
      (r.severity || "").toUpperCase() === "HIGH",
  );
  const mediumRisks = filteredRisks.filter(
    (r) => (r.severity || "").toUpperCase() === "MEDIUM",
  );
  const lowRisks = filteredRisks.filter(
    (r) =>
      (r.severity || "").toUpperCase() === "LOW" ||
      (r.severity || "").toUpperCase() === "INFO",
  );

  const allUnverifiable = auditData
    ? [
        ...(auditData.frameworks.gdpr?.unverifiable || []),
        ...(auditData.frameworks.soc2?.unverifiable || []),
        ...(auditData.frameworks.ccpa?.unverifiable || []),
        ...(auditData.frameworks.iso27701?.unverifiable || []),
        ...(auditData.forwardLooking || []),
      ]
    : [];

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* 7. Slim Dismissible Free-Tier Warning Banner */}
      {!dismissFreeTierBanner && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/50 px-3.5 py-2 text-xs text-foreground">
          <div className="flex items-center gap-2">
            <Zap className="size-3.5 shrink-0 text-amber-500" />
            <span>
              Gemini free tier: audits process one document at a time. Results may take 60-90 seconds.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setDismissFreeTierBanner(true)}
            aria-label="Dismiss banner"
            className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Rate limit status HUD if active */}
      {rateLimitInfo && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-3.5 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Zap className="size-3.5 text-primary" />
            <span>
              Scans remaining: <strong className="text-foreground">{rateLimitInfo.remaining}/5</strong> this hour
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <Clock className="size-3" />
            <span>Resets in {rateLimitInfo.timeToReset}</span>
          </div>
        </div>
      )}

      {/* Unauthenticated Notification Banner */}
      {!isAuthenticated && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-600 dark:text-amber-400">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="size-4 shrink-0" />
            <span>Sign in required to run compliance audits and evaluate documents.</span>
          </div>
          <button
            type="button"
            onClick={openAuthModal}
            className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700 transition-colors"
          >
            Sign In
          </button>
        </div>
      )}

      <IngestionDropzone
        activeDocs={queueDocs}
        onRawFileTrigger={handleFileUpload}
        onAgreementFiles={handleAgreementFiles}
      />

      {/* Records & History Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setShowPreviousAudits(!showPreviousAudits);
              if (!showPreviousAudits) fetchPreviousAudits();
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              showPreviousAudits
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-secondary/60 text-foreground hover:bg-secondary"
            }`}
          >
            <Database className="size-3.5" />
            <span>Previous Audits</span>
            {previousAudits.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/20 px-1.5 py-0.2 text-[10px]">
                {previousAudits.length}
              </span>
            )}
          </button>

          {(auditData?.documentId || lastSavedDoc?.id) && (
            <button
              type="button"
              onClick={handleRefreshRecord}
              title="Refresh current / last audit record"
              className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/60 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary transition-colors"
            >
              <RotateCw className="size-3.5" />
              <span>Refresh Record</span>
            </button>
          )}
        </div>
      </div>

      {/* Previous Audits Drawer / Card */}
      {showPreviousAudits && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Database className="size-4 text-primary" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                Previous Audits
              </h4>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={fetchPreviousAudits}
                disabled={isLoadingPrevious}
                className="flex items-center gap-1 rounded-md border border-border bg-secondary/40 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-secondary transition-colors"
              >
                <RotateCw className={`size-3 ${isLoadingPrevious ? "animate-spin" : ""}`} />
                <span>Refresh</span>
              </button>
              <button
                type="button"
                onClick={() => setShowPreviousAudits(false)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {isLoadingPrevious ? (
            <div className="flex items-center justify-center py-6 text-xs text-muted-foreground gap-2">
              <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span>Loading audits...</span>
            </div>
          ) : previousAudits.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No previous audits found in database. Complete an audit to permanently archive results.
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto divide-y divide-border/50 pr-1">
              {previousAudits.map((item) => (
                <div
                  key={item.document_id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5 px-2 hover:bg-secondary/30 rounded-lg transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-foreground" title={item.name || item.document_id}>
                      {item.name || item.document_id}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                      <span className="font-mono truncate max-w-[200px]">{item.document_id}</span>
                      <span>•</span>
                      <span>{new Date(item.updated_at).toLocaleString()}</span>
                      <span>•</span>
                      <span className="uppercase font-semibold">{item.backend || "AWS"}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {item.overall_score !== null && (
                      <span className="font-mono text-xs font-bold text-foreground">
                        {item.overall_score} / 100
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${statusBadgeClass(
                        item.status,
                      )}`}
                    >
                      {item.status.replace(/_/g, " ")}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        loadAuditById(item.document_id, item.name);
                        setShowPreviousAudits(false);
                      }}
                      className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Load
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {status === "uploading" && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
            <p className="flex justify-between text-sm font-medium text-amber-600 dark:text-amber-400">
              <span>Streaming document binary directly to S3 Vault...</span>
              <span className="font-mono font-bold">{uploadProgress}%</span>
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-amber-500/20">
              <div
                className="h-full bg-amber-600 transition-all duration-200"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {status === "processing" && (
          <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 animate-pulse">
            <div className="size-5 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <div>
              <p className="text-sm font-medium text-primary">
                Processing your document
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Evaluating compliance criteria across regulatory frameworks. Audits complete in ~25–40 seconds.
              </p>
            </div>
          </div>
        )}

        {status === "failed" && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm font-medium text-rose-600 dark:text-rose-400 space-y-1">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldAlert className="size-4" />
              <span>Audit Execution Halted</span>
            </div>
            <p className="text-xs opacity-90">{errorMessage}</p>
          </div>
        )}
      </div>

      {status === "completed" && auditData && (
        <div className="space-y-6 rounded-xl border border-border bg-card p-5 shadow-sm">
          {/* LLM Data Use Warning Banner */}
          {auditData.meta?.llm_data_use_warning && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
              <ShieldAlert className="size-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Model Notice: </span>
                <span>{auditData.meta.llm_data_use_warning}</span>
              </div>
            </div>
          )}

          {/* Unscored Reason Banner */}
          {auditData.overall_score === null && (
            <div className="rounded-lg border border-slate-500/30 bg-slate-500/10 p-3.5 text-xs text-muted-foreground">
              <span className="font-bold text-foreground">Document Not Assessable: </span>
              <span>
                {auditData.meta?.unscored_reason ||
                  "The uploaded document did not match any supported compliance requirements."}
              </span>
            </div>
          )}

          {/* Header & Overall Score */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
            <div>
              <h3 className="text-base font-bold text-foreground">Compliance Evaluation Summary</h3>
              <p className="mt-0.5 text-xs text-muted-foreground font-mono">ID: {auditData.documentId}</p>
            </div>
            <button
              type="button"
              onClick={() => setStatus("idle")}
              className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary/80 transition-colors"
            >
              + Audit Another Contract
            </button>
          </div>

          {/* 1. Score Header: Large Number + Ring Chart + 4 Framework Pills */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 py-2 min-w-0">
            <div className="flex items-center gap-6 min-w-0">
              <div className="min-w-0">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                  Overall Compliance Score
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl sm:text-[3.5rem] leading-none font-bold tabular-nums text-foreground">
                    {auditData.overall_score === null ? "UNSCORED" : `${auditData.overall_score} / 100`}
                  </span>
                </div>
              </div>

              {/* Progress Ring */}
              <div className="relative flex size-16 shrink-0 items-center justify-center">
                <svg className="size-16 -rotate-90" viewBox="0 0 64 64">
                  <circle
                    cx="32"
                    cy="32"
                    r="26"
                    stroke="currentColor"
                    strokeWidth="5"
                    className="text-muted/40"
                    fill="none"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r="26"
                    stroke={
                      auditData.overall_score === null
                        ? "#9ca3af"
                        : auditData.overall_score >= 80
                          ? "#16A34A"
                          : auditData.overall_score >= 60
                            ? "#D97706"
                            : "#DC2626"
                    }
                    strokeWidth="5"
                    strokeDasharray={2 * Math.PI * 26}
                    strokeDashoffset={
                      auditData.overall_score === null
                        ? 2 * Math.PI * 26
                        : 2 * Math.PI * 26 * (1 - (auditData.overall_score || 0) / 100)
                    }
                    strokeLinecap="round"
                    fill="none"
                    className="transition-all duration-500 ease-out"
                  />
                </svg>
              </div>
            </div>

            {/* 4 Compact Framework Pills Directly Below Score */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {(["gdpr", "ccpa", "soc2", "iso27701"] as const).map((fwKey) => {
                const fw = auditData.frameworks?.[fwKey];
                const sc = fw?.score ?? null;
                const fwStatus = fw?.status ?? "UNSCORED";
                const isCompliant = fwStatus === "COMPLIANT";
                const isReview = fwStatus === "NEEDS_REVIEW";
                const pillColor =
                  sc === null
                    ? "text-muted-foreground bg-secondary/80"
                    : isCompliant
                      ? "text-emerald-700 dark:text-emerald-300 bg-emerald-500/15"
                      : isReview
                        ? "text-amber-700 dark:text-amber-300 bg-amber-500/15"
                        : "text-rose-700 dark:text-rose-300 bg-rose-500/15";

                return (
                  <div key={fwKey} className="flex items-center">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${pillColor}`}
                    >
                      <span>{frameworkLabels[fwKey]}:</span>
                      <strong className="tabular-nums">{sc !== null ? `${sc} / 100` : "N/A"}</strong>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. Framework Cards — COLLAPSED BY DEFAULT */}
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Evaluated Frameworks
            </h4>
            <div className="space-y-2">
              {(["gdpr", "ccpa", "soc2", "iso27701"] as const).map((fwKey) => {
                const fw = auditData.frameworks?.[fwKey];
                const score = fw?.score ?? null;
                const fwStatus = fw?.status ?? "UNSCORED";
                const summary = fw?.summary ?? (score !== null ? "Evaluation complete." : "Not assessable.");
                const rationale = fw?.rationale;
                const isExpanded = Boolean(expandedFrameworks[fwKey]);
                const fwItems = (auditData.items || []).filter(
                  (it) => it.framework?.toLowerCase() === fwKey.toLowerCase(),
                );
                const critGapsCount = fw?.critical_gaps?.length || 0;

                return (
                  <div
                    key={fwKey}
                    className="rounded-lg border border-border bg-card overflow-hidden transition-colors"
                  >
                    {/* Collapsed Header */}
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedFrameworks((prev) => ({ ...prev, [fwKey]: !prev[fwKey] }))
                      }
                      className="w-full flex flex-wrap items-center justify-between gap-3 p-3.5 hover:bg-secondary/40 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                        )}
                        <span className="text-sm font-bold text-foreground">
                          {frameworkLabels[fwKey]}
                        </span>
                        <span className="font-mono text-xs font-semibold text-foreground">
                          {score !== null ? `${score} / 100` : "UNSCORED"}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${statusBadgeClass(
                            fwStatus,
                          )}`}
                        >
                          {fwStatus.replace(/_/g, " ")}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {typeof fw?.coverage_pct === "number" && (
                          <span>Coverage: {fw.coverage_pct}%</span>
                        )}
                        {critGapsCount > 0 ? (
                          <span className="flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400">
                            <span className="size-1.5 rounded-full bg-amber-400" />
                            {critGapsCount} critical gap{critGapsCount > 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span>No critical gaps</span>
                        )}
                      </div>
                    </button>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="border-t border-border/60 bg-secondary/15 p-4 space-y-4">
                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-foreground">{summary}</p>
                          {rationale && rationale !== summary && (
                            <p className="text-xs text-muted-foreground bg-background/60 rounded p-2 border border-border/50">
                              <span className="font-semibold text-foreground">Rationale: </span>
                              {rationale}
                            </p>
                          )}
                        </div>

                        {/* 3. Requirement Rows: One Line Each, Collapsed by Default */}
                        {fwItems.length > 0 && (
                          <div className="space-y-1.5 pt-2 border-t border-border/40">
                            <div className="flex items-center justify-between text-xs text-muted-foreground pb-1">
                              <span className="font-semibold uppercase tracking-wider text-[11px]">
                                Requirements ({fwItems.length})
                              </span>
                            </div>

                            <div className="space-y-1.5">
                              {fwItems.map((item, idx) => {
                                const itemId = item.id || `${fwKey}-${idx}`;
                                const isItemExpanded = Boolean(expandedItemIds[itemId]);
                                const st = (item.status || "UNSCORED").toUpperCase();
                                const itemWeight = (item as any).weight || (item.critical ? 3 : 2);

                                return (
                                  <div
                                    key={itemId}
                                    className="rounded border border-border/60 bg-card overflow-hidden"
                                  >
                                    {/* One-line Row */}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedItemIds((prev) => ({
                                          ...prev,
                                          [itemId]: !prev[itemId],
                                        }))
                                      }
                                      className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-secondary/40 transition-colors"
                                    >
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        {/* Status Icon */}
                                        {st === "MET" ? (
                                          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-500" />
                                        ) : st === "PARTIAL" ? (
                                          <AlertCircle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
                                        ) : st === "NOT_MET" ? (
                                          <XCircle className="size-3.5 shrink-0 text-rose-600 dark:text-rose-500" />
                                        ) : (
                                          <MinusCircle className="size-3.5 shrink-0 text-muted-foreground" />
                                        )}

                                        {/* Citation */}
                                        <span className="font-mono text-[11px] font-bold text-foreground shrink-0 bg-primary/10 px-1.5 py-0.5 rounded">
                                          {item.citation || item.id}
                                        </span>

                                        {/* Title truncated */}
                                        <span
                                          className="truncate text-xs font-medium text-foreground"
                                          title={item.title}
                                        >
                                          {item.title}
                                        </span>
                                      </div>

                                      <div className="flex items-center gap-3 shrink-0">
                                        {/* Weight dots */}
                                        <span
                                          className="text-[10px] tracking-widest text-muted-foreground font-mono"
                                          title={`Weight: ${itemWeight}/3`}
                                        >
                                          {itemWeight === 3 ? "●●●" : itemWeight === 1 ? "●○○" : "●●○"}
                                        </span>

                                        {isItemExpanded ? (
                                          <ChevronDown className="size-3.5 text-muted-foreground" />
                                        ) : (
                                          <ChevronRight className="size-3.5 text-muted-foreground" />
                                        )}
                                      </div>
                                    </button>

                                    {/* Inline Expanded Panel */}
                                    {isItemExpanded && (
                                      <div className="border-t border-border/40 bg-secondary/20 p-3 space-y-2 text-xs">
                                        {item.evidence_quote && (
                                          <blockquote className="rounded bg-background/80 border-l-2 border-primary/60 px-3 py-2 italic text-muted-foreground">
                                            "{item.evidence_quote}"
                                          </blockquote>
                                        )}

                                          <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                            {item.evidence_verified ? (
                                              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">
                                                Quote Verified
                                              </span>
                                            ) : (
                                              <span className="rounded bg-secondary px-1.5 py-0.5 font-semibold text-muted-foreground">
                                                Unverified Quote
                                              </span>
                                            )}

                                            {item.downgraded_from && (
                                              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-300">
                                                Downgraded from {item.downgraded_from}
                                              </span>
                                            )}

                                          {item.section && (
                                            <span className="text-muted-foreground">Section: {item.section}</span>
                                          )}

                                          {typeof item.agreement === "number" && (
                                            <span className="text-muted-foreground">
                                              Pass Agreement: {item.agreement}%
                                            </span>
                                          )}
                                        </div>

                                        {item.note && (
                                          <p className="text-muted-foreground italic">{item.note}</p>
                                        )}

                                        {item.recommendation && (
                                          <p className="text-foreground">
                                            <strong className="text-primary font-semibold">Recommendation: </strong>
                                            {item.recommendation}
                                          </p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 4. Risks: 3-Column Grid + Tag Cloud */}
          <div className="space-y-3 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Identified Risks & Recommendations
              </h4>
              <span className="text-xs text-muted-foreground">
                {auditData.risks.length} {auditData.risks.length === 1 ? "finding" : "findings"}
              </span>
            </div>

            {/* Tag Cloud */}
            {riskCategories.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 py-1">
                <button
                  type="button"
                  onClick={() => setSelectedRiskCategory(null)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    selectedRiskCategory === null
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  All ({auditData.risks.length})
                </button>
                {riskCategories.map(({ category, count }) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() =>
                      setSelectedRiskCategory(selectedRiskCategory === category ? null : category)
                    }
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      selectedRiskCategory === category
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    }`}
                  >
                    {category} ({count})
                  </button>
                ))}
              </div>
            )}

            {filteredRisks.length === 0 ? (
              <p className="rounded-lg border border-border bg-secondary/20 p-4 text-center text-xs text-muted-foreground">
                No matching compliance risks detected.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-start min-w-0">
                {/* Column 1: CRITICAL */}
                <div className="space-y-2 min-w-0">
                  <div className="flex items-center gap-1.5 px-1 pb-1 border-b border-border text-xs font-bold text-rose-600 dark:text-rose-400">
                    <span className="size-2 rounded-full bg-rose-600 dark:bg-rose-500" />
                    <span>CRITICAL ({criticalRisks.length})</span>
                  </div>
                  {criticalRisks.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground p-2">No critical risks</p>
                  ) : (
                    criticalRisks.map((risk, idx) => (
                      <div
                        key={`crit-${idx}`}
                        className="rounded-lg border border-border bg-card p-3 space-y-2 border-l-4 border-l-rose-600 dark:border-l-rose-500 min-w-0 break-words"
                      >
                        <div className="space-y-1 min-w-0">
                          <span className="text-[10px] font-mono font-bold text-muted-foreground block truncate">
                            {risk.location || risk.category || "Rule"}
                          </span>
                          <p className="text-xs font-semibold text-foreground leading-snug break-words">{risk.issue}</p>
                        </div>
                        {risk.recommendation && (
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedRiskFixes((prev) => ({
                                  ...prev,
                                  [risk.globalIdx]: !prev[risk.globalIdx],
                                }))
                              }
                              className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1"
                            >
                              {expandedRiskFixes[risk.globalIdx] ? "Hide fix ↑" : "Show fix →"}
                            </button>
                            {expandedRiskFixes[risk.globalIdx] && (
                              <p className="mt-1.5 rounded bg-secondary/50 p-2 text-xs leading-relaxed text-muted-foreground border border-border/40 break-words">
                                <strong className="text-foreground">Recommendation: </strong>
                                {risk.recommendation}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {/* Column 2: MEDIUM */}
                <div className="space-y-2 min-w-0">
                  <div className="flex items-center gap-1.5 px-1 pb-1 border-b border-border text-xs font-bold text-amber-600 dark:text-amber-400">
                    <span className="size-2 rounded-full bg-amber-600 dark:bg-amber-500" />
                    <span>MEDIUM ({mediumRisks.length})</span>
                  </div>
                  {mediumRisks.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground p-2">No medium risks</p>
                  ) : (
                    mediumRisks.map((risk, idx) => (
                      <div
                        key={`med-${idx}`}
                        className="rounded-lg border border-border bg-card p-3 space-y-2 border-l-4 border-l-amber-600 dark:border-l-amber-500 min-w-0 break-words"
                      >
                        <div className="space-y-1 min-w-0">
                          <span className="text-[10px] font-mono font-bold text-muted-foreground block truncate">
                            {risk.location || risk.category || "Rule"}
                          </span>
                          <p className="text-xs font-semibold text-foreground leading-snug break-words">{risk.issue}</p>
                        </div>
                        {risk.recommendation && (
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedRiskFixes((prev) => ({
                                  ...prev,
                                  [risk.globalIdx]: !prev[risk.globalIdx],
                                }))
                              }
                              className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1"
                            >
                              {expandedRiskFixes[risk.globalIdx] ? "Hide fix ↑" : "Show fix →"}
                            </button>
                            {expandedRiskFixes[risk.globalIdx] && (
                              <p className="mt-1.5 rounded bg-secondary/50 p-2 text-xs leading-relaxed text-muted-foreground border border-border/40 break-words">
                                <strong className="text-foreground">Recommendation: </strong>
                                {risk.recommendation}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {/* Column 3: LOW */}
                <div className="space-y-2 min-w-0">
                  <div className="flex items-center gap-1.5 px-1 pb-1 border-b border-border text-xs font-bold text-muted-foreground">
                    <span className="size-2 rounded-full bg-slate-400" />
                    <span>LOW ({lowRisks.length})</span>
                  </div>
                  {lowRisks.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground p-2">No low risks</p>
                  ) : (
                    lowRisks.map((risk, idx) => (
                      <div
                        key={`low-${idx}`}
                        className="rounded-lg border border-border bg-card p-3 space-y-2 border-l-4 border-l-slate-400 dark:border-l-slate-500 min-w-0 break-words"
                      >
                        <div className="space-y-1 min-w-0">
                          <span className="text-[10px] font-mono font-bold text-muted-foreground block truncate">
                            {risk.location || risk.category || "Rule"}
                          </span>
                          <p className="text-xs font-semibold text-foreground leading-snug break-words">{risk.issue}</p>
                        </div>
                        {risk.recommendation && (
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedRiskFixes((prev) => ({
                                  ...prev,
                                  [risk.globalIdx]: !prev[risk.globalIdx],
                                }))
                              }
                              className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1"
                            >
                              {expandedRiskFixes[risk.globalIdx] ? "Hide fix ↑" : "Show fix →"}
                            </button>
                            {expandedRiskFixes[risk.globalIdx] && (
                              <p className="mt-1.5 rounded bg-secondary/50 p-2 text-xs leading-relaxed text-muted-foreground border border-border/40">
                                <strong className="text-foreground">Recommendation: </strong>
                                {risk.recommendation}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 6. Unverifiable / Forward-Looking: Single grey accordion at the very bottom */}
          {allUnverifiable.length > 0 && (
            <div className="rounded-lg border border-border/60 bg-secondary/20 overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedUnverifiable(!expandedUnverifiable)}
                className="w-full flex items-center justify-between p-3 text-xs text-muted-foreground hover:bg-secondary/40 transition-colors text-left"
              >
                <span>
                  {allUnverifiable.length} items require internal operational evidence (cannot be audited from public text alone)
                </span>
                {expandedUnverifiable ? (
                  <ChevronDown className="size-4 shrink-0" />
                ) : (
                  <ChevronRight className="size-4 shrink-0" />
                )}
              </button>
              {expandedUnverifiable && (
                <div className="p-3 border-t border-border/40 space-y-1.5 text-xs text-muted-foreground">
                  {allUnverifiable.map((item, idx) => (
                    <div key={idx} className="pl-2 border-l border-border/80">
                      {typeof item === "string" ? item : item.title || item.citation || item.id}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}