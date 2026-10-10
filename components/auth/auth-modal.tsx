"use client"

import React, { useState } from "react"
import { useAuthContext } from "@/hooks/auth-context"
import { Lock, Mail, ShieldCheck, UserCheck, X, AlertCircle, CheckCircle2 } from "lucide-react"

export function AuthModal() {
  const {
    isAuthModalOpen,
    closeAuthModal,
    signInWithEmail,
    signUpWithEmail,
  } = useAuthContext()

  const [mode, setMode] = useState<"signin" | "signup">("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  if (!isAuthModalOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)

    if (!email.trim() || !password.trim()) {
      setErrorMsg("Please enter both email and password.")
      return
    }

    if (password.length < 6) {
      setErrorMsg("Password must be at least 6 characters.")
      return
    }

    setLoading(true)
    try {
      if (mode === "signin") {
        const res = await signInWithEmail(email, password)
        if (res.error) {
          setErrorMsg(res.error)
        }
      } else {
        const res = await signUpWithEmail(email, password)
        if (res.error) {
          setErrorMsg(res.error)
        } else if (res.message) {
          setSuccessMsg(res.message)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in"
    >
      <div
        tabIndex={0}
        aria-label="Close modal overlay"
        onClick={closeAuthModal}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") closeAuthModal()
        }}
        className="fixed inset-0"
      />

      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl transition-all">
        {/* Header */}
        <div className="border-b border-border p-6 pb-4">
          <button
            onClick={closeAuthModal}
            type="button"
            className="absolute right-4 top-4 rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            aria-label="Close modal"
          >
            <X className="size-4" />
          </button>

          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h2 id="auth-modal-title" className="text-base font-bold text-foreground">
                Compliance Auditor Authentication
              </h2>
              <p className="text-xs text-muted-foreground">
                Secure access to regulatory verification
              </p>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5">
          {/* Mode Switcher */}
          <div className="flex rounded-lg border border-border bg-secondary/50 p-1">
            <button
              type="button"
              onClick={() => {
                setMode("signin")
                setErrorMsg(null)
                setSuccessMsg(null)
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                mode === "signin"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup")
                setErrorMsg(null)
                setSuccessMsg(null)
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                mode === "signup"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Create Account
            </button>
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                Work Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="auditor@organization.com"
                  className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary py-2.5 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="size-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
              ) : mode === "signin" ? (
                <>
                  <UserCheck className="size-4" />
                  <span>Sign In</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="size-4" />
                  <span>Create Account</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
