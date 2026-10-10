"use client"

import { AuditEngineProvider, useAuditEngineContext } from "@/hooks/audit-engine-context"
import { AuthProvider } from "@/hooks/auth-context"
import { AuthModal } from "@/components/auth/auth-modal"
import { ClauseEditor } from "./clause-editor"
import { ComplianceGauges } from "./compliance-gauges"
import { RiskHeatmap } from "./risk-heatmap"
import { Sidebar } from "./sidebar"
import { TopBar } from "./top-bar"
import { STAGE_ORDER } from "@/lib/audit"
import { useEffect, useState } from "react"
import DocumentAuditor from "./document-auditor"

function ComplianceDashboardInner() {
  const { documents } = useAuditEngineContext()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem("sidebar_collapsed")
      if (saved !== null) {
        setIsSidebarCollapsed(saved === "true")
      }
    } catch {}
  }, [])

  const handleToggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem("sidebar_collapsed", String(next))
      } catch {}
      return next
    })
  }

  const visibleDocuments = documents
  const activeDocs = documents.filter((d) => d.stage !== STAGE_ORDER[STAGE_ORDER.length - 1])

  return (
    <div className="flex min-h-screen bg-background text-foreground transition-colors duration-200">
      {/* Collapsible Sidebar */}
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        isMobileOpen={isMobileOpen}
        onCloseMobile={() => setIsMobileOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col transition-all duration-300">
        <TopBar
          activeCount={activeDocs.length}
          onToggleMobileSidebar={() => setIsMobileOpen(true)}
        />

        <main className="w-full max-w-7xl mx-auto flex-1 space-y-6 p-4 sm:p-6 md:p-8 min-w-0 transition-all duration-300">
          <div id="overview" className="w-full min-w-0">
            <ComplianceGauges documents={visibleDocuments} />
          </div>

          <div id="auditing" className="w-full min-w-0 space-y-5">
            <DocumentAuditor />
          </div>

          <div id="risk-heatmap" className="w-full min-w-0">
            <RiskHeatmap documents={visibleDocuments} />
          </div>

          <div id="clause-review" className="w-full min-w-0">
            <ClauseEditor documents={visibleDocuments} />
          </div>
        </main>
      </div>

      <AuthModal />
    </div>
  )
}

export function ComplianceDashboard() {
  return (
    <AuthProvider>
      <AuditEngineProvider>
        <ComplianceDashboardInner />
      </AuditEngineProvider>
    </AuthProvider>
  )
}
