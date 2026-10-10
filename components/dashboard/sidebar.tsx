"use client"

import {
  Activity,
  FileSearch,
  Gauge,
  Grid3x3,
  LayoutDashboard,
  LogIn,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  ShieldCheck,
  User,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuthContext } from "@/hooks/auth-context"

const NAV_SECTIONS: {
  label: string
  items: { name: string; icon: typeof Activity; href: string }[]
}[] = [
  {
    label: "Workspace",
    items: [
      { name: "Overview", icon: LayoutDashboard, href: "#overview" },
      { name: "Auditing", icon: FileSearch, href: "#auditing" },
      { name: "Live Activity", icon: Activity, href: "#overview" },
    ],
  },
  {
    label: "Analysis",
    items: [
      { name: "Risk Heatmap", icon: Grid3x3, href: "#risk-heatmap" },
      { name: "Compliance Scores", icon: Gauge, href: "#overview" },
      { name: "Clause Review", icon: ScrollText, href: "#clause-review" },
    ],
  },
]

interface SidebarProps {
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  isMobileOpen?: boolean
  onCloseMobile?: () => void
}

export function Sidebar({
  isCollapsed = false,
  onToggleCollapse,
  isMobileOpen = false,
  onCloseMobile,
}: SidebarProps) {
  const { user, isAuthenticated, openAuthModal, signOut } = useAuthContext()

  return (
    <>
      {/* 1. Mobile Drawer Backdrop */}
      {isMobileOpen && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Close sidebar overlay"
          onClick={onCloseMobile}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onCloseMobile?.()
          }}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden"
        />
      )}

      {/* 2. Mobile Drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl transition-transform duration-300 ease-in-out lg:hidden",
          isMobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-bold tracking-tight text-sidebar-foreground">Clarity</p>
              <p className="text-[11px] text-muted-foreground">Compliance Audit</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCloseMobile}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
            aria-label="Close menu"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="mb-6">
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.label}
              </p>
              <ul className="flex flex-col gap-1">
                {section.items.map((item) => (
                  <li key={item.name}>
                    <a
                      href={item.href}
                      onClick={onCloseMobile}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                        "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                      )}
                    >
                      <item.icon className="size-4 shrink-0" aria-hidden="true" />
                      <span>{item.name}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-4">
          {isAuthenticated ? (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-sidebar-accent/60 p-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                  {user?.email ? user.email.slice(0, 2).toUpperCase() : "AU"}
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-xs font-semibold text-sidebar-foreground">
                    {user?.email || "Auditor"}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">Authenticated</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  signOut()
                  onCloseMobile?.()
                }}
                title="Sign Out"
                className="rounded-md p-1.5 text-muted-foreground hover:text-rose-500 transition-colors"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                onCloseMobile?.()
                openAuthModal()
              }}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            >
              <LogIn className="size-3.5" />
              <span>Sign In to Audit</span>
            </button>
          )}
        </div>
      </aside>

      {/* 3. Desktop Collapsible Sidebar */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out lg:flex",
          isCollapsed ? "w-18" : "w-64",
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "flex h-16 items-center border-b border-sidebar-border transition-all",
            isCollapsed ? "justify-center px-2" : "justify-between px-4",
          )}
        >
          {!isCollapsed ? (
            <>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                  <ShieldCheck className="size-5" aria-hidden="true" />
                </div>
                <div className="leading-tight min-w-0">
                  <p className="truncate text-sm font-bold tracking-tight text-sidebar-foreground">
                    Clarity
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">Compliance Audit</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleCollapse}
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
              >
                <PanelLeftClose className="size-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onToggleCollapse}
              title="Expand sidebar"
              aria-label="Expand sidebar"
              className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              <PanelLeftOpen className="size-5" />
            </button>
          )}
        </div>

        {/* Navigation Body */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-4 space-y-4">
          {NAV_SECTIONS.map((section, sIdx) => (
            <div key={section.label}>
              {!isCollapsed ? (
                <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.label}
                </p>
              ) : sIdx > 0 ? (
                <div className="my-2 border-t border-sidebar-border/60" />
              ) : null}

              <ul className="flex flex-col gap-1">
                {section.items.map((item) => (
                  <li key={item.name}>
                    <a
                      href={item.href}
                      title={isCollapsed ? item.name : undefined}
                      className={cn(
                        "flex items-center rounded-lg transition-colors",
                        isCollapsed
                          ? "size-10 justify-center mx-auto text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                          : "w-full gap-3 px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                      )}
                    >
                      <item.icon className="size-4 shrink-0" aria-hidden="true" />
                      {!isCollapsed && <span className="truncate">{item.name}</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer / Auth Profile */}
        <div className="border-t border-sidebar-border p-3">
          {isAuthenticated ? (
            !isCollapsed ? (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-sidebar-accent/50 p-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                    {user?.email ? user.email.slice(0, 2).toUpperCase() : "AU"}
                  </div>
                  <div className="min-w-0 leading-tight">
                    <p className="truncate text-xs font-semibold text-sidebar-foreground">
                      {user?.email || "Auditor"}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground">Authenticated</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => signOut()}
                  title="Sign Out"
                  aria-label="Sign Out"
                  className="rounded-md p-1.5 text-muted-foreground hover:text-rose-500 transition-colors"
                >
                  <LogOut className="size-4" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div
                  className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary"
                  title={user?.email || "Auditor"}
                >
                  {user?.email ? user.email.slice(0, 2).toUpperCase() : "AU"}
                </div>
                <button
                  type="button"
                  onClick={() => signOut()}
                  title="Sign Out"
                  aria-label="Sign Out"
                  className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-rose-500 transition-colors"
                >
                  <LogOut className="size-4" />
                </button>
              </div>
            )
          ) : !isCollapsed ? (
            <button
              type="button"
              onClick={openAuthModal}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            >
              <LogIn className="size-3.5" />
              <span>Sign In</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={openAuthModal}
              title="Sign In to Audit"
              aria-label="Sign In"
              className="flex size-10 mx-auto items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            >
              <LogIn className="size-4" />
            </button>
          )}
        </div>
      </aside>
    </>
  )
}
