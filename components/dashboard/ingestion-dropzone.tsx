"use client"

import { useCallback, useRef, useState } from "react"
import { Loader, UploadCloud } from "lucide-react"
import { STAGE_LABEL, type AuditDocument, formatBytes, overallProgress } from "@/lib/audit"
import { cn } from "@/lib/utils"

export function IngestionDropzone({
  activeDocs,
  onRawFileTrigger,
  onAgreementFiles,
  onFiles, // Pehle wala prop bhi extract kar lete hain safety ke liye
}: {
  activeDocs: AuditDocument[]
  onRawFileTrigger?: (file: File, docType?: string) => Promise<void>
  onAgreementFiles?: (files: File[]) => Promise<void>
  onFiles?: (files: { name: string; sizeBytes: number; fileType: "PDF" | "DOCX" | "TXT" }[]) => void // Fallback support
}) {
  const [dragging, setDragging] = useState(false)
  const [uploadHint, setUploadHint] = useState<string | null>(null)
  const [selectedDocType, setSelectedDocType] = useState<string>("auto")
  const inputRef = useRef<HTMLInputElement>(null)

  const supportedLabel = "Supported: .txt, .docx, and text-based .pdf only"

  const isAllowedFile = useCallback((file: File) => {
    const lower = file.name.toLowerCase()
    return lower.endsWith(".txt") || lower.endsWith(".docx") || lower.endsWith(".pdf")
  }, [])

  const toQueueFile = useCallback((file: File) => {
    const lower = file.name.toLowerCase()
    return {
      name: file.name,
      sizeBytes: file.size || 0,
      fileType: lower.endsWith(".docx") ? ("DOCX" as const) : lower.endsWith(".txt") ? ("TXT" as const) : ("PDF" as const),
    }
  }, [])

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return
      const files = Array.from(fileList)
      const invalidFile = files.find((file) => !isAllowedFile(file))

      if (invalidFile) {
        setUploadHint("Only .txt, .docx, and text-based .pdf files are allowed.")
        return
      }

      if (files.length > 1 && typeof onAgreementFiles === "function") {
        setUploadHint(`Agreement set selected: ${files.length} related documents.`)
        void onAgreementFiles(files)
        return
      }

      const primaryFile = files[0]

      setUploadHint(
        primaryFile.name.toLowerCase().endsWith(".pdf")
          ? "Text-based PDFs only. Scanned PDFs will be rejected by the backend."
          : null,
      )

      const docTypeHint = selectedDocType === "auto" ? undefined : selectedDocType

      // 1. Agar naya connected trigger maujood hai to use chalayein
      if (typeof onRawFileTrigger === "function") {
        void onRawFileTrigger(primaryFile, docTypeHint)
      } else if (typeof (window as any).globalHandleUpload === "function") {
        void (window as any).globalHandleUpload(primaryFile, docTypeHint)
      } else if (typeof onFiles === "function") {
        onFiles([toQueueFile(primaryFile)])
      }
    },
    [isAllowedFile, onAgreementFiles, onFiles, onRawFileTrigger, selectedDocType, toQueueFile],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      if (e.dataTransfer.files?.length) {
        handleFiles(e.dataTransfer.files)
      }
    },
    [handleFiles],
  )

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card shadow-sm">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <UploadCloud className="size-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold tracking-tight">
            Document Ingestion Pipeline
          </h2>
        </div>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground">
          TXT · DOCX · text PDF
        </span>
      </header>

      {/* Document Type Selector */}
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-5 py-2.5 text-xs">
        <label htmlFor="doc-type-select" className="font-medium text-muted-foreground">
          Document Type:
        </label>
        <select
          id="doc-type-select"
          value={selectedDocType}
          onChange={(e) => setSelectedDocType(e.target.value)}
          className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="auto">Auto-detect</option>
          <option value="privacy_notice">Privacy Notice</option>
          <option value="dpa">Data Processing Agreement (DPA)</option>
          <option value="security_policy">Security Policy</option>
        </select>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload documents by dragging files here or browsing"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              inputRef.current?.click()
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-9 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            dragging
              ? "border-primary bg-primary/10"
              : "border-border bg-secondary/40 hover:border-primary/50 hover:bg-secondary/70",
          )}
        >
          <div
            className={cn(
              "flex size-12 items-center justify-center rounded-full transition-colors",
              dragging ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
            )}
          >
            <UploadCloud className="size-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium">
              {dragging ? "Release to ingest" : "Drag & drop contracts here"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              or{" "}
              <span className="font-medium text-primary underline-offset-2 hover:underline">
                browse files
              </span>{" "}
              — {supportedLabel}
            </p>
            {uploadHint ? (
              <p className="mt-2 text-xs text-amber-600">{uploadHint}</p>
            ) : null}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".txt,.pdf,.docx,application/pdf"
            multiple
            className="sr-only"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        <div className="min-h-0 flex-1">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              Processing queue
            </p>
            <span className="text-xs tabular-nums text-muted-foreground">
              {activeDocs.length} active
            </span>
          </div>

          {activeDocs.length === 0 ? (
            <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
              No live cloud documents processing
            </div>
          ) : (
            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
              {activeDocs.map((doc) => (
                <QueueItem key={doc.id} doc={doc} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

function QueueItem({ doc }: { doc: AuditDocument }) {
  const pct = doc.stage === "uploading" ? doc.progress : overallProgress(doc)
  const uploading = doc.stage === "uploading"

  return (
    <li className="rounded-lg border border-border bg-secondary/40 p-3">
      <div className="flex items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[10px] font-bold text-primary">
          {doc.fileType}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{doc.name}</p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {uploading ? (
              <>{formatBytes(doc.sizeBytes)}</>
            ) : (
              <>
                <Loader className="size-3 animate-spin text-primary" aria-hidden="true" />
                {STAGE_LABEL[doc.stage]}
              </>
            )}
          </p>
        </div>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
          {Math.round(pct)}%
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </li>
  )
}