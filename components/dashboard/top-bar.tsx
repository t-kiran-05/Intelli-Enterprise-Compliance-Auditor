"use client"

import { Moon, ShieldCheck, Sun, User, LogIn, LogOut, Menu } from "lucide-react"
import { useAuthContext } from "@/hooks/auth-context"
import { useEffect, useRef, useState } from "react"

export function TopBar({
  activeCount,
  search,
  onSearch,
  isSidebarCollapsed,
  onToggleSidebar,
  onToggleMobileSidebar,
}: {
  activeCount: number
  search?: string
  onSearch?: (value: string) => void
  isSidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  onToggleMobileSidebar?: () => void
}) {
  const { user, isAuthenticated, openAuthModal, signOut } = useAuthContext()
  const [theme, setTheme] = useState<"light" | "dark">("dark")
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const saved = localStorage.getItem("theme")
    const isDark = saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)
    applyTheme(isDark ? "dark" : "light")
  }, [])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const applyTheme = (t: "light" | "dark") => {
    setTheme(t)
    localStorage.setItem("theme", t)
    const root = document.documentElement

    const inlineProps = [
      "--background",
      "--foreground",
      "--card",
      "--card-foreground",
      "--secondary",
      "--secondary-foreground",
      "--muted",
      "--muted-foreground",
      "--border",
      "--primary",
      "--sidebar",
      "--sidebar-foreground",
      "--sidebar-accent",
      "--sidebar-border",
    ]
    inlineProps.forEach((prop) => root.style.removeProperty(prop))

    if (t === "dark") {
      root.classList.add("dark")
      root.style.colorScheme = "dark"
    } else {
      root.classList.remove("dark")
      root.style.colorScheme = "light"
    }
  }

  const toggleTheme = () => {
    applyTheme(theme === "dark" ? "light" : "dark")
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md md:px-6 transition-colors duration-200">
      {/* Left Section: Mobile Drawer Toggle & Branding / Title */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Mobile Drawer Toggle */}
        <button
          type="button"
          onClick={onToggleMobileSidebar}
          className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors lg:hidden"
          title="Open navigation menu"
          aria-label="Open navigation menu"
        >
          <Menu className="size-5" />
        </button>

        {/* Branding for Mobile */}
        <div className="flex items-center gap-2 lg:hidden">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
            <ShieldCheck className="size-4" aria-hidden="true" />
          </div>
          <span className="text-sm font-bold tracking-tight text-foreground">Clarity</span>
        </div>

        {/* Header Title */}
        <div className="hidden min-w-0 flex-col md:flex">
          <h1 className="truncate text-sm font-bold tracking-tight text-foreground">
            Compliance Auditing
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            Contract risk analysis & regulatory verification
          </p>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2.5">
        {/* Status Indicator */}
        <div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium md:flex">
          <span className="relative flex size-2">
            <span
              className={
                activeCount > 0
                  ? "absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75"
                  : "hidden"
              }
            />
            <span
              className="relative inline-flex size-2 rounded-full"
              style={{
                background: activeCount > 0 ? "var(--primary)" : "var(--success)",
              }}
            />
          </span>
          <span className="text-muted-foreground">
            {activeCount > 0
              ? `${activeCount} audit${activeCount > 1 ? "s" : ""} running`
              : "All audits idle"}
          </span>
        </div>

        {/* Theme Toggle Button (Dark & Light Mode) */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-foreground hover:bg-secondary transition-colors"
        >
          {theme === "dark" ? (
            <Sun className="size-4.5 text-amber-400" />
          ) : (
            <Moon className="size-4.5 text-indigo-600" />
          )}
        </button>

        {/* User Account Popover */}
        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setIsUserMenuOpen((prev) => !prev)}
            aria-label="User account menu"
            title={isAuthenticated ? user?.email || "User profile" : "Sign In"}
            className={`relative flex size-9 items-center justify-center rounded-lg border transition-colors ${
              isUserMenuOpen
                ? "border-primary bg-secondary text-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            <User className={`size-4.5 ${isAuthenticated ? "text-primary" : ""}`} />
            {isAuthenticated && (
              <span className="absolute bottom-1.5 right-1.5 size-1.5 rounded-full bg-emerald-500 ring-1 ring-card" />
            )}
          </button>

          {/* User Menu Dropdown Card */}
          {isUserMenuOpen && (
            <div className="absolute right-0 top-11 z-50 w-64 rounded-xl border border-border bg-popover p-3 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150">
              {/* Row 1: Email / Account info */}
              <div className="flex items-center gap-2.5 pb-2.5 mb-2.5 border-b border-border">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <User className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {isAuthenticated ? "Signed in as" : "Account"}
                  </p>
                  <p
                    className="truncate text-xs font-semibold text-foreground"
                    title={user?.email || "Guest Auditor"}
                  >
                    {user?.email || "Guest Auditor"}
                  </p>
                </div>
              </div>

              {/* Row 2: Action Button (Sign Out or Sign In) */}
              {isAuthenticated ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsUserMenuOpen(false)
                    signOut()
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-500/10 transition-colors"
                >
                  <LogOut className="size-3.5" />
                  <span>Sign Out</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setIsUserMenuOpen(false)
                    openAuthModal()
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
                >
                  <LogIn className="size-3.5" />
                  <span>Sign In / Sign Up</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
