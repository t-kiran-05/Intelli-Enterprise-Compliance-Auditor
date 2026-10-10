"use client"

import { useState } from "react"
import { Grid3x3 } from "lucide-react"
import { type AuditDocument } from "@/lib/audit"

const PILLARS = ["Data Privacy", "Security", "Governance"] as const
type Pillar = (typeof PILLARS)[number]

function getPillarIssueCount(doc: AuditDocument, pillar: Pillar): number {
  let count = 0

  // 1. Check clauses/findings
  const clauses = doc.clauses || []
  for (const c of clauses) {
    const cat = (c.category || "").toLowerCase()
    if (pillar === "Data Privacy") {
      if (cat.includes("privacy") || cat.includes("data") || cat.includes("gdpr") || cat.includes("ccpa")) {
        count++
      }
    } else if (pillar === "Security") {
      if (cat.includes("security") || cat.includes("access") || cat.includes("soc")) {
        count++
      }
    } else if (pillar === "Governance") {
      if (
        cat.includes("governance") ||
        cat.includes("liability") ||
        cat.includes("termination") ||
        cat.includes("ip") ||
        cat.includes("indemn") ||
        cat.includes("confid") ||
        cat.includes("law") ||
        cat.includes("iso")
      ) {
        count++
      }
    }
  }

  // 2. Also count not_met / partial checklist items if available
  if (doc.items && doc.items.length > 0) {
    for (const item of doc.items) {
      const st = (item.status || "").toUpperCase()
      if (st === "NOT_MET" || st === "PARTIAL") {
        const fw = (item.framework || "").toLowerCase()
        if (pillar === "Data Privacy" && (fw === "gdpr" || fw === "ccpa")) count++
        if (pillar === "Security" && fw === "soc2") count++
        if (pillar === "Governance" && (fw === "iso27701" || fw.includes("iso"))) count++
      }
    }
  }

  // 3. Fallback to framework critical gaps if no granular items yet
  if (count === 0 && doc.frameworks) {
    if (pillar === "Data Privacy") {
      count += (doc.frameworks.gdpr?.critical_gaps?.length || 0) + (doc.frameworks.ccpa?.critical_gaps?.length || 0)
    } else if (pillar === "Security") {
      count += doc.frameworks.soc2?.critical_gaps?.length || 0
    } else if (pillar === "Governance") {
      count += doc.frameworks.iso27701?.critical_gaps?.length || 0
    }
  }

  return count
}

export function RiskHeatmap({
  documents,
  onCellClick,
}: {
  documents: AuditDocument[]
  onCellClick?: (docName: string, pillar: Pillar) => void
}) {
  const [selectedCell, setSelectedCell] = useState<{ docId: string; pillar: Pillar } | null>(null)
  const scored = documents.filter((d) => d.stage === "complete")

  const handleClick = (doc: AuditDocument, pillar: Pillar) => {
    const isSame = selectedCell?.docId === doc.id && selectedCell?.pillar === pillar
    const next = isSame ? null : { docId: doc.id, pillar }
    setSelectedCell(next)

    if (onCellClick) {
      onCellClick(doc.name, pillar)
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("filter-audit-category", {
          detail: { docId: doc.id, docName: doc.name, category: isSame ? null : pillar },
        }),
      )
    }
  }

  return (
    <section className="flex flex-col rounded-xl border border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Grid3x3 className="size-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Risk Heatmap Matrix</h2>
          <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            3-Pillar Assessment
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-600 dark:bg-emerald-500" />
            <span className="text-muted-foreground">0 issues</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-amber-600 dark:bg-amber-500" />
            <span className="text-muted-foreground">1–2 issues</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-rose-600 dark:bg-rose-500" />
            <span className="text-muted-foreground">3+ issues</span>
          </span>
        </div>
      </header>

      {scored.length === 0 ? (
        <div className="flex items-center justify-center p-8 text-xs text-muted-foreground">
          Complete an audit to populate the 3-pillar risk matrix.
        </div>
      ) : (
        <div className="overflow-x-auto p-4">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="pb-3 pl-2 font-semibold">Audited Document</th>
                {PILLARS.map((p) => (
                  <th key={p} className="pb-3 text-center font-semibold">
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {scored.map((doc) => (
                <tr key={doc.id} className="transition-colors hover:bg-secondary/40">
                  <td className="py-3 pl-2 font-medium text-foreground">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                        {doc.fileType}
                      </span>
                      <span className="truncate max-w-[220px]" title={doc.name}>
                        {doc.name}
                      </span>
                    </div>
                  </td>
                  {PILLARS.map((pillar) => {
                    const count = getPillarIssueCount(doc, pillar)
                    const isSelected = selectedCell?.docId === doc.id && selectedCell?.pillar === pillar

                    let badgeClass = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    if (count >= 3) {
                      badgeClass = "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                    } else if (count > 0) {
                      badgeClass = "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    }

                    return (
                      <td key={pillar} className="py-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleClick(doc, pillar)}
                          title={`Filter by ${pillar} (${count} issues)`}
                          className={`inline-flex items-center justify-center rounded-md px-2.5 py-1 text-xs font-semibold transition-transform hover:scale-105 ${badgeClass} ${
                            isSelected ? "ring-2 ring-primary ring-offset-1" : ""
                          }`}
                        >
                          {count === 0 ? "0 issues" : `${count} ${count === 1 ? "issue" : "issues"}`}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
