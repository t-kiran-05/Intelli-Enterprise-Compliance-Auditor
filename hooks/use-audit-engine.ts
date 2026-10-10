"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  type AuditDocument,
  type AuditMeta,
  type BackendRisk,
  type ChecklistItem,
  type Clause,
  type DocTypeHint,
  type Frameworks,
  type LogEntry,
  type LogLevel,
  type RiskCategory,
  type RiskLevel,
  type Stage,
  RISK_CATEGORIES,
  STAGE_LABEL,
  STAGE_ORDER,
  emptyRiskByCategory,
} from "@/lib/audit"

let counter = 0
function uid(prefix: string) {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}

const STAGE_SPEED: Record<Stage, number> = {
  uploading: 20,
  uploaded: 55,
  chunking: 15,
  extracting: 8.5,
  scoring: 12,
  complete: 0,
}

const TICK_MS = 380

function nextStage(stage: Stage): Stage {
  if (stage === "scoring") return "scoring"
  const i = STAGE_ORDER.indexOf(stage)
  return STAGE_ORDER[Math.min(i + 1, STAGE_ORDER.length - 1)]
}

export function mapSeverityToRiskLevel(severity?: string): RiskLevel {
  const s = severity?.toLowerCase().trim()
  if (s === "critical") return "critical"
  if (s === "high") return "high"
  if (s === "medium") return "medium"
  if (s === "low") return "low"
  return "low"
}

export function mapCategoryToRiskCategory(category?: string): RiskCategory {
  if (!category) return "Data Privacy"
  const normalized = category.trim().toLowerCase()
  const match = RISK_CATEGORIES.find((item) => item.toLowerCase() === normalized)
  return match ?? "Data Privacy"
}

function buildClauseFromRisk(risk: BackendRisk, index: number): Clause {
  const category = mapCategoryToRiskCategory(risk.category)
  const riskLevel = mapSeverityToRiskLevel(risk.severity)
  const location = risk.location || `Clause ${index + 1}`
  const issue = risk.issue || `Compliance Finding ${index + 1}`
  const recommendation =
    risk.recommendation || "Review and update clause to align with compliance frameworks."

  return {
    id: `clause-${Date.now()}-${index}`,
    category,
    title: `${location}: ${issue}`.slice(0, 64),
    original: `${location} — ${issue}`,
    recommendation,
    riskLevel,
    rationale: issue,
    location,
    severity: risk.severity,
  }
}

function buildRiskMap(clauses: Clause[]): Record<RiskCategory, RiskLevel> {
  const riskByCategory = emptyRiskByCategory()
  for (const clause of clauses) {
    const current = riskByCategory[clause.category]
    const currentWeight =
      current === "none" ? 0 : current === "low" ? 1 : current === "medium" ? 2 : current === "high" ? 3 : 4
    const nextWeight =
      clause.riskLevel === "none"
        ? 0
        : clause.riskLevel === "low"
          ? 1
          : clause.riskLevel === "medium"
            ? 2
            : clause.riskLevel === "high"
              ? 3
              : 4
    if (nextWeight >= currentWeight) {
      riskByCategory[clause.category] = clause.riskLevel
    }
  }
  return riskByCategory
}

export type FinalizePayload = {
  id: string
  name: string
  sizeBytes: number
  fileType: "PDF" | "DOCX" | "TXT"
  overall_score: number | null
  frameworks?: Frameworks
  risks: BackendRisk[]
  items?: ChecklistItem[]
  meta?: AuditMeta
  forwardLooking?: any[]
  docTypeHint?: DocTypeHint
  unscoredReason?: string | null
}

export function useAuditEngine() {
  const [documents, setDocuments] = useState<AuditDocument[]>([])
  const [log, setLog] = useState<LogEntry[]>([])

  const docsRef = useRef<AuditDocument[]>(documents)
  docsRef.current = documents

  const pushLogs = useCallback((entries: LogEntry[]) => {
    if (!entries.length) return
    setLog((prev) => [...entries, ...prev].slice(0, 120))
  }, [])

  const registerPendingDocument = useCallback(
    (file: { id: string; name: string; sizeBytes: number; fileType: "PDF" | "DOCX" | "TXT"; docTypeHint?: DocTypeHint }) => {
      console.log("[useAuditEngine] registerPendingDocument", file)

      setDocuments((prev) => {
        const existing = prev.find((doc) => doc.id === file.id)
        if (existing) return prev
        return [
          {
            id: file.id,
            name: file.name,
            sizeBytes: file.sizeBytes,
            fileType: file.fileType,
            stage: "uploading",
            progress: 0,
            chunks: 0,
            risksFound: 0,
            complianceScore: null,
            frameworkScores: { gdpr: null, soc2: null, ccpa: null, iso27701: null },
            riskByCategory: emptyRiskByCategory(),
            clauses: [],
            docTypeHint: file.docTypeHint,
            createdAt: Date.now(),
          },
          ...prev,
        ]
      })
      pushLogs([
        {
          id: uid("log"),
          docId: file.id,
          docName: file.name,
          stage: "uploading",
          message: "File received — starting secure upload",
          level: "info",
          time: Date.now(),
        },
      ])
    },
    [pushLogs],
  )

  const finalizeDocument = useCallback(
    (payload: FinalizePayload) => {
      const clauses = (payload.risks || []).map((risk, index) => buildClauseFromRisk(risk, index))
      const riskByCategory = buildRiskMap(clauses)

      const frameworkScores = {
        gdpr: payload.frameworks?.gdpr?.score ?? null,
        soc2: payload.frameworks?.soc2?.score ?? null,
        ccpa: payload.frameworks?.ccpa?.score ?? null,
        iso27701: payload.frameworks?.iso27701?.score ?? null,
      }

      setDocuments((prev) => {
        const existingIndex = prev.findIndex((doc) => doc.id === payload.id)
        const nextDoc: AuditDocument = {
          id: payload.id,
          name: payload.name,
          sizeBytes: payload.sizeBytes,
          fileType: payload.fileType,
          stage: "complete",
          progress: 100,
          chunks: Math.max(clauses.length, 1),
          risksFound: clauses.length,
          complianceScore: payload.overall_score,
          frameworks: payload.frameworks,
          frameworkScores,
          riskByCategory,
          clauses,
          items: payload.items,
          meta: payload.meta,
          forwardLooking: payload.forwardLooking,
          docTypeHint: payload.docTypeHint,
          unscoredReason: payload.unscoredReason,
          createdAt: existingIndex >= 0 ? prev[existingIndex].createdAt : Date.now(),
        }

        if (existingIndex >= 0) {
          const updated = [...prev]
          updated[existingIndex] = nextDoc
          return updated
        }

        return [nextDoc, ...prev]
      })

      const scoreMessage =
        payload.overall_score !== null
          ? `Audit complete — compliance score ${payload.overall_score}/100`
          : `Audit complete — not assessable (${payload.unscoredReason || "unscored"})`

      pushLogs([
        {
          id: uid("log"),
          docId: payload.id,
          docName: payload.name,
          stage: "complete",
          message: scoreMessage,
          level: payload.overall_score !== null ? "success" : "warning",
          time: Date.now(),
        },
      ])
    },
    [pushLogs],
  )

  useEffect(() => {
    const interval = setInterval(() => {
      const current = docsRef.current
      if (current.every((d) => d.stage === "complete")) return

      const logs: LogEntry[] = []
      const next = current.map((doc) => {
        if (doc.stage === "complete") return doc

        const nonCompleteStage = doc.stage as Exclude<Stage, "complete">
        const speed = STAGE_SPEED[nonCompleteStage]
        const inc = speed * (0.6 + Math.random() * 0.8)
        let progress = doc.progress + inc
        let stage: Stage = doc.stage
        const { chunks, risksFound, complianceScore, riskByCategory, clauses, frameworks, frameworkScores } = doc

        if (progress >= 100) {
          const nextNonComplete = nextStage(doc.stage)
          if (nextNonComplete === doc.stage) {
            progress = 99
            return {
              ...doc,
              progress,
            }
          }
          progress = 0
          stage = nextNonComplete

          logs.push(
            buildTransitionLog(doc, stage, {
              complianceScore,
            }),
          )
        }

        return {
          ...doc,
          stage,
          progress,
          chunks,
          risksFound,
          complianceScore,
          frameworks,
          frameworkScores,
          riskByCategory,
          clauses,
        }
      })

      setDocuments(next)
      if (logs.length) pushLogs(logs)
    }, TICK_MS)

    return () => clearInterval(interval)
  }, [pushLogs])

  return { documents, log, registerPendingDocument, finalizeDocument }
}

function buildTransitionLog(
  doc: AuditDocument,
  stage: Stage,
  data: { complianceScore: number | null },
): LogEntry {
  let message = STAGE_LABEL[stage]
  let level: LogLevel = "info"

  switch (stage) {
    case "uploaded":
      message = "Upload complete — queued for backend analysis"
      level = "success"
      break
    case "chunking":
      message = "Reading document text for backend evaluation"
      break
    case "extracting":
      message = "Independently evaluating against GDPR, SOC 2, CCPA, and ISO/IEC 27701"
      break
    case "scoring":
      message = "Compiling compliance scores and risk findings"
      break
    case "complete":
      message = `Audit complete — compliance score ${
        data.complianceScore != null ? `${data.complianceScore}/100` : "pending"
      }`
      level = "success"
      break
  }

  return {
    id: uid("log"),
    docId: doc.id,
    docName: doc.name,
    stage,
    message,
    level,
    time: Date.now(),
  }
}

export type { AuditDocument, LogEntry }
