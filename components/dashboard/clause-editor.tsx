"use client"

import { useEffect, useState } from "react"
import {
  ArrowRight,
  CircleCheck,
  FileText,
  ScrollText,
  Sparkles,
  Wand2,
} from "lucide-react"
import {
  type AuditDocument,
  type Clause,
  RISK_META,
} from "@/lib/audit"
import { cn } from "@/lib/utils"

function RiskBadge({ level }: { level: Clause["riskLevel"] }) {
  const meta = RISK_META[level]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        backgroundColor: `color-mix(in oklch, ${meta.token} 16%, transparent)`,
        color: meta.token,
      }}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: meta.token }}
      />
      {meta.label} risk
    </span>
  )
}

export function ClauseEditor({ documents }: { documents: AuditDocument[] }) {
  const scored = documents.filter(
    (d) => d.stage === "complete" && d.clauses.length > 0,
  )
  const [activeId, setActiveId] = useState<string | null>(
    scored[0]?.id ?? null,
  )
  const [accepted, setAccepted] = useState<Record<string, boolean>>({})
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({})

  // Keep a valid selection as documents complete over time.
  useEffect(() => {
    if (scored.length === 0) {
      if (activeId !== null) setActiveId(null)
      return
    }
    if (!activeId || !scored.some((d) => d.id === activeId)) {
      setActiveId(scored[0].id)
    }
  }, [scored, activeId])

  const activeDoc = scored.find((d) => d.id === activeId) ?? null

  return (
    <section className="flex flex-col rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <ScrollText className="size-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold tracking-tight">
            Clause Review — Original vs AI Recommendation
          </h2>
        </div>
        {activeDoc && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
            {activeDoc.clauses.length} suggested redlines
          </span>
        )}
      </header>

      {scored.length === 0 ? (
        <div className="flex items-center justify-center p-10 text-sm text-muted-foreground">
          Suggested clause redlines will appear here once an audit completes.
        </div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto border-b border-border px-5 py-3">
            {scored.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => setActiveId(doc.id)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  doc.id === activeId
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground",
                )}
              >
                <FileText className="size-3.5" aria-hidden="true" />
                <span className="max-w-40 truncate">{doc.name}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-4 p-5">
            {activeDoc?.clauses.filter((clause) => !dismissed[clause.id]).map((clause) => {
              const isAccepted = accepted[clause.id]
              return (
                <article
                  key={clause.id}
                  className="rounded-lg border border-border bg-secondary/30"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <h3 className="text-sm font-semibold">{clause.title}</h3>
                      <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {clause.category}
                      </span>
                    </div>
                    <RiskBadge level={clause.riskLevel} />
                  </div>

                  <div className="grid gap-px bg-border md:grid-cols-2">
                    <div className="bg-card p-4">
                      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        <FileText className="size-3.5" aria-hidden="true" />
                        Original clause
                      </p>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {clause.original}
                      </p>
                    </div>
                    <div className="relative bg-primary/[0.06] p-4">
                      <span
                        className="absolute -left-3 top-4 hidden size-6 items-center justify-center rounded-full border border-border bg-card text-primary md:flex"
                        aria-hidden="true"
                      >
                        <ArrowRight className="size-3.5" />
                      </span>
                      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-primary">
                        <Wand2 className="size-3.5" aria-hidden="true" />
                        AI recommendation
                      </p>
                      <p className="text-sm leading-relaxed text-foreground">
                        {clause.recommendation}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
                    <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">
                        Rationale:{" "}
                      </span>
                      {clause.rationale}
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                      {isAccepted ? (
                        <span className="flex items-center gap-1.5 rounded-md bg-success/15 px-3 py-1.5 text-xs font-medium text-success">
                          <CircleCheck className="size-3.5" aria-hidden="true" />
                          Redline applied
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setAccepted((p) => ({ ...p, [clause.id]: true }))
                            }
                            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                          >
                            Apply redline
                          </button>
                          <button
                            type="button"
                            onClick={() => setDismissed((previous) => ({ ...previous, [clause.id]: true }))}
                            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                          >
                            Dismiss
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
