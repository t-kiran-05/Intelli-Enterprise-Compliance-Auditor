export type Stage =
  | "uploading"
  | "uploaded"
  | "chunking"
  | "extracting"
  | "scoring"
  | "complete"

export const STAGE_ORDER: Stage[] = [
  "uploading",
  "uploaded",
  "chunking",
  "extracting",
  "scoring",
  "complete",
]

// Stages shown as active "processing" states in the pipeline
export const PIPELINE_STAGES: Stage[] = [
  "uploaded",
  "chunking",
  "extracting",
  "scoring",
]

export const STAGE_LABEL: Record<Stage, string> = {
  uploading: "Uploading",
  uploaded: "Uploaded",
  chunking: "Chunking Text",
  extracting: "AI Evaluating Frameworks",
  scoring: "Generating Legal Scores",
  complete: "Audit Complete",
}

export type RiskLevel = "none" | "low" | "medium" | "high" | "critical"

export const RISK_LEVELS: RiskLevel[] = [
  "none",
  "low",
  "medium",
  "high",
  "critical",
]

export const RISK_META: Record<
  RiskLevel,
  { label: string; token: string; weight: number }
> = {
  none: { label: "None", token: "var(--risk-none)", weight: 0 },
  low: { label: "Low", token: "var(--risk-low)", weight: 1 },
  medium: { label: "Medium", token: "var(--risk-medium)", weight: 2 },
  high: { label: "High", token: "var(--risk-high)", weight: 3 },
  critical: { label: "Critical", token: "var(--risk-critical)", weight: 4 },
}

// Risk categories become the rows of the heatmap matrix.
export const RISK_CATEGORIES = [
  "Data Privacy",
  "Security",
  "Liability",
  "Termination",
  "IP Ownership",
  "Indemnification",
  "Confidentiality",
  "Payment Terms",
  "Governing Law",
  "Governance",
] as const

export type RiskCategory = (typeof RISK_CATEGORIES)[number]

export type Clause = {
  id: string
  category: RiskCategory
  title: string
  original: string
  recommendation: string
  riskLevel: RiskLevel
  rationale: string
  location?: string
  severity?: string
}

export type DocTypeHint = "auto" | "privacy_notice" | "dpa" | "security_policy"

export type ChecklistItem = {
  id: string
  framework: string
  citation: string
  title: string
  status: "MET" | "PARTIAL" | "NOT_MET" | "NOT_APPLICABLE" | "UNSCORED" | string
  document?: string
  section?: string
  evidence_quote?: string
  evidence_verified?: boolean
  downgraded_from?: string
  agreement?: number
  agreement_pct?: number
  note?: string
  recommendation?: string
  critical?: boolean
}

export type AuditMeta = {
  scoring_version?: string
  as_of?: string
  doc_types?: string[]
  classification?: Array<{ document: string; types?: string[]; score?: number }>
  soc2_mode?: string
  thresholds?: { compliant_min: number; review_min: number }
  llm_tier?: string
  llm_data_use_warning?: string
  unscored_reason?: string
  checklist_version?: number | string
  checklist_source?: string
  model?: string
  passes?: number
  vision_mode?: boolean
  truncated_documents?: string[]
  quality?: {
    not_evaluated?: number
    downgraded_for_evidence?: number
    na_overrides?: number
    items_with_pass_disagreement?: number
    evidence_verifiable?: boolean
  }
}

export type FrameworkDetail = {
  score: number | null
  status: "COMPLIANT" | "NEEDS_REVIEW" | "NON_COMPLIANT" | "UNSCORED" | string
  summary: string
  rationale?: string
  coverage_pct?: number | null
  critical_gaps?: string[]
  unverifiable?: string[]
  disclosure_only?: boolean
  counts?: {
    met?: number
    partial?: number
    not_met?: number
    not_applicable?: number
    total_scored?: number
  }
}

export type Frameworks = {
  gdpr: FrameworkDetail
  soc2: FrameworkDetail
  ccpa: FrameworkDetail
  iso27701: FrameworkDetail
}

export type BackendRisk = {
  category: string
  severity: string
  issue: string
  location: string
  recommendation: string
}

export type AuditDocument = {
  id: string
  name: string
  sizeBytes: number
  fileType: "PDF" | "DOCX" | "TXT"
  stage: Stage
  /** progress within the current stage, 0-100 */
  progress: number
  chunks: number
  risksFound: number
  complianceScore: number | null
  frameworks?: Frameworks
  frameworkScores: {
    gdpr: number | null
    soc2: number | null
    ccpa: number | null
    iso27701: number | null
  }
  riskByCategory: Record<RiskCategory, RiskLevel>
  clauses: Clause[]
  items?: ChecklistItem[]
  meta?: AuditMeta
  forwardLooking?: any[]
  docTypeHint?: DocTypeHint
  unscoredReason?: string | null
  createdAt: number
}

export type LogLevel = "info" | "success" | "warning" | "error"

export type LogEntry = {
  id: string
  docId: string
  docName: string
  stage: Stage
  message: string
  level: LogLevel
  time: number
}

export function emptyRiskByCategory(): Record<RiskCategory, RiskLevel> {
  const map = {} as Record<RiskCategory, RiskLevel>
  for (const category of RISK_CATEGORIES) map[category] = "none"
  return map
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Overall pipeline progress across all stages, 0-100. */
export function overallProgress(doc: AuditDocument): number {
  if (doc.stage === "complete") return 100
  const idx = STAGE_ORDER.indexOf(doc.stage)
  const segments = STAGE_ORDER.length - 1
  return Math.min(100, Math.round(((idx + doc.progress / 100) / segments) * 100))
}
