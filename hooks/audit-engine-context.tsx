"use client"

import React, { createContext, useContext, useMemo, useRef, useState } from "react"
import { useAuditEngine } from "@/hooks/use-audit-engine"
import type { AuditDocument, LogEntry } from "@/lib/audit"

type AuditEngineValue = ReturnType<typeof useAuditEngine> & {
  // documents/log are already included, keep explicit types for better editor UX
  documents: AuditDocument[]
  log: LogEntry[]
}

const AuditEngineContext = createContext<AuditEngineValue | null>(null)

export function AuditEngineProvider({ children }: { children: React.ReactNode }) {
  // IMPORTANT: ensure only ONE useAuditEngine() instance for the entire subtree.
  const value = useAuditEngine() as AuditEngineValue

  return <AuditEngineContext.Provider value={value}>{children}</AuditEngineContext.Provider>
}

export function useAuditEngineContext() {
  const ctx = useContext(AuditEngineContext)
  if (!ctx) {
    throw new Error("useAuditEngineContext must be used within an AuditEngineProvider")
  }
  return ctx
}

