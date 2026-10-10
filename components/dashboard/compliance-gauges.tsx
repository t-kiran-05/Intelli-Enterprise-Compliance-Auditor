"use client"

import * as React from "react"
import type { AuditDocument } from "@/lib/audit"

// Lightweight inline icon components to avoid dependency on `lucide-react`
const IconBase = ({ children, className, ...props }: any) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    {children}
  </svg>
)

const FileText = (p: any) => (
  <IconBase {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M16 13H8M16 17H8M10 9H8" />
  </IconBase>
)

const Gauge = (p: any) => (
  <IconBase {...p}>
    <path d="M12 8v4l2 2" />
    <path d="M21 12a9 9 0 1 0-18 0" />
  </IconBase>
)

const ShieldCheck = (p: any) => (
  <IconBase {...p}>
    <path d="M12 2l7 3v5c0 5-3.8 9.9-7 11-3.2-1.1-7-6-7-11V5l7-3z" />
    <path d="M9 12l2 2 4-4" />
  </IconBase>
)

const TriangleAlert = (p: any) => (
  <IconBase {...p}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </IconBase>
)

function scoreColor(score: number): string {
  if (score >= 80) return "var(--success)"
  if (score >= 60) return "var(--warning)"
  return "var(--risk-critical)"
}

function RadialGauge({
  score,
  label,
  size = 120,
}: {
  score: number | null
  label: string
  size?: number
}) {
  const r = 40
  const c = 2 * Math.PI * r
  const arc = 0.75 // 270deg gauge
  const track = `${c * arc} ${c}`
  const isValidNumber = typeof score === "number" && !isNaN(score)
  const boundedScore = isValidNumber ? Math.max(0, Math.min(100, score)) : 0
  const value = isValidNumber ? `${c * arc * (boundedScore / 100)} ${c}` : `0 ${c}`
  const color = isValidNumber ? scoreColor(score) : "var(--muted-foreground)"

  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{ width: size, minHeight: size + 24 }}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          viewBox="0 0 100 100"
          className="size-full -rotate-[135deg]"
          aria-hidden="true"
        >
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke="var(--border)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={track}
          />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={value}
            style={{ transition: "stroke-dasharray 700ms ease, stroke 400ms" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-xl font-bold tabular-nums tracking-tight sm:text-2xl"
            style={{ color }}
          >
            {isValidNumber ? score : "N/A"}
          </span>
          <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
            {isValidNumber ? "/ 100" : "Unscored"}
          </span>
        </div>
      </div>
      <span className="mt-1 text-xs font-semibold text-muted-foreground">
        {label}
      </span>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Gauge
  label: string
  value: string
  accent: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/40 p-3">
      <div
        className="flex size-9 shrink-0 items-center justify-center rounded-md"
        style={{
          backgroundColor: `color-mix(in oklch, ${accent} 16%, transparent)`,
          color: accent,
        }}
      >
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-none tabular-nums">
          {value}
        </p>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          {label}
        </p>
      </div>
    </div>
  )
}

export function ComplianceGauges({
  documents,
}: {
  documents: AuditDocument[]
}) {
  const complete = documents.filter(
    (d) => d.stage === "complete",
  )

  const scorableDocs = complete.filter(
    (d) => typeof d.complianceScore === "number" && !isNaN(d.complianceScore),
  )

  const scores = scorableDocs.map((d) => d.complianceScore as number)

  const overall =
    scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null

  const averageFrameworkScore = (key: "gdpr" | "soc2" | "ccpa" | "iso27701") => {
    const values = complete
      .map((document) => document.frameworkScores?.[key])
      .filter((score): score is number => typeof score === "number" && !isNaN(score))
    return values.length > 0
      ? Math.round(values.reduce((sum, score) => sum + score, 0) / values.length)
      : null
  }

  const totalRisks = complete.reduce((sum, d) => sum + d.risksFound, 0)
  const criticalClauses = complete.reduce(
    (sum, d) =>
      sum + d.clauses.filter((c) => c.riskLevel === "critical" || c.riskLevel === "high").length,
    0,
  )

  const gdpr = averageFrameworkScore("gdpr")
  const soc2 = averageFrameworkScore("soc2")
  const ccpa = averageFrameworkScore("ccpa")
  const iso27701 = averageFrameworkScore("iso27701")

  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Gauge className="size-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold tracking-tight">
            Compliance Framework Evaluation
          </h2>
        </div>
        <span className="text-xs text-muted-foreground">
          Across {complete.length} audited{" "}
          {complete.length === 1 ? "document" : "documents"}
        </span>
      </header>

      <div className="grid gap-6 p-5 lg:grid-cols-[auto_1fr]">
        <div className="grid grid-cols-2 place-items-center gap-4 sm:grid-cols-3 md:grid-cols-5 lg:border-r lg:border-border lg:pr-6">
          <RadialGauge score={overall} label="Overall" size={120} />
          <RadialGauge score={gdpr} label="GDPR" size={105} />
          <RadialGauge score={soc2} label="SOC 2" size={105} />
          <RadialGauge score={ccpa} label="CCPA" size={105} />
          <RadialGauge score={iso27701} label="ISO 27701" size={105} />
        </div>

        <div className="grid grid-cols-2 content-center gap-3 sm:grid-cols-2">
          <StatCard
            icon={FileText}
            label="Documents audited"
            value={String(complete.length)}
            accent="var(--primary)"
          />
          <StatCard
            icon={ShieldCheck}
            label="Avg. compliance"
            value={overall != null ? `${overall}%` : "—"}
            accent="var(--success)"
          />
          <StatCard
            icon={Gauge}
            label="Risks identified"
            value={String(totalRisks)}
            accent="var(--warning)"
          />
          <StatCard
            icon={TriangleAlert}
            label="High/Critical risks"
            value={String(criticalClauses)}
            accent="var(--risk-critical)"
          />
        </div>
      </div>
    </section>
  )
}
