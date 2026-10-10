"use client"

import {
  Activity,
  CircleCheck,
  Cpu,
  FileSearch,
  ListChecks,
  Scale,
  TriangleAlert,
  UploadCloud,
} from "lucide-react"
import type { LogEntry } from "@/lib/audit"
import { type Stage } from "@/lib/audit"
import { cn } from "@/lib/utils"

const STAGE_ICON: Record<Stage, typeof Activity> = {
  uploading: UploadCloud,
  uploaded: CircleCheck,
  chunking: ListChecks,
  extracting: FileSearch,
  scoring: Scale,
  complete: CircleCheck,
}

function relativeTime(time: number): string {
  const diff = Math.max(0, Date.now() - time)
  const s = Math.floor(diff / 1000)
  if (s < 5) return "just now"
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

const LEVEL_COLOR = {
  info: "var(--primary)",
  success: "var(--success)",
  warning: "var(--warning)",
  error: "var(--destructive)",
} as const

export function AuditLog({ log }: { log: LogEntry[] }) {
  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold tracking-tight">
            Live Audit Stream
          </h2>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-success" />
          </span>
          <span className="text-[11px] font-medium text-muted-foreground">
            Live
          </span>
        </div>
      </header>

      <ol
        className="flex max-h-[26rem] min-h-0 flex-1 flex-col gap-0 overflow-y-auto p-2"
        aria-live="polite"
        aria-label="Audit activity log"
      >
        {log.map((entry) => {
          const Icon = STAGE_ICON[entry.stage] ?? Activity
          const color = LEVEL_COLOR[entry.level]
          const isCritical = entry.level === "warning" || entry.level === "error"
          return (
            <li
              key={entry.id}
              className="group flex gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-secondary/50"
            >
              <div className="relative flex flex-col items-center">
                <span
                  className="flex size-7 items-center justify-center rounded-full border"
                  style={{
                    borderColor: color,
                    backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)`,
                    color,
                  }}
                >
                  {isCritical ? (
                    <TriangleAlert className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Icon className="size-3.5" aria-hidden="true" />
                  )}
                </span>
                <span className="mt-1 w-px flex-1 bg-border group-last:hidden" />
              </div>

              <div className="min-w-0 flex-1 pb-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-xs font-medium text-foreground">
                    {entry.docName}
                  </p>
                  <time className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {relativeTime(entry.time)}
                  </time>
                </div>
                <p
                  className={cn(
                    "mt-0.5 text-xs leading-relaxed",
                    isCritical ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {entry.message}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
