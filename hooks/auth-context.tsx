"use client"

import React, { createContext, useContext, useEffect, useState } from "react"
import { type Session, type User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase-client"

type AuthContextType = {
  user: User | null
  session: Session | null
  loading: boolean
  isAuthenticated: boolean
  isAuthModalOpen: boolean
  openAuthModal: () => void
  closeAuthModal: () => void
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>
  signUpWithEmail: (email: string, password: string) => Promise<{ error: string | null; message?: string }>
  signInDemo: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)

  useEffect(() => {
    if (!supabase) {
      console.warn(
        "[Auth] Supabase is not configured. Please ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set in .env.local and restart Next.js dev server.",
      )
      setLoading(false)
      return
    }

    // 1. Get initial active session
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        setSession(session)
        setUser(session?.user ?? null)
        setLoading(false)
      })
      .catch((err) => {
        console.warn("[Auth] getSession failed:", err)
        setLoading(false)
      })

    // 2. Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const openAuthModal = () => setIsAuthModalOpen(true)
  const closeAuthModal = () => setIsAuthModalOpen(false)

  const signInWithEmail = async (email: string, password: string) => {
    if (!supabase) {
      return {
        error:
          "Supabase URL is not configured. Check NEXT_PUBLIC_SUPABASE_URL in .env.local (must be https://xxxx.supabase.co) and restart 'npm run dev'.",
      }
    }
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) {
        return { error: error.message }
      }
      setIsAuthModalOpen(false)
      return { error: null }
    } catch (err: any) {
      return { error: err?.message || "Authentication failed." }
    }
  }

  const signUpWithEmail = async (email: string, password: string) => {
    if (!supabase) {
      return {
        error:
          "Supabase URL is not configured. Check NEXT_PUBLIC_SUPABASE_URL in .env.local (must be https://xxxx.supabase.co) and restart 'npm run dev'.",
      }
    }
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      })
      if (error) {
        return { error: error.message }
      }
      if (data.session) {
        setIsAuthModalOpen(false)
      }
      return {
        error: null,
        message: data.session
          ? "Account created successfully!"
          : "Verification link sent! Please check your email inbox.",
      }
    } catch (err: any) {
      return { error: err?.message || "Sign up failed." }
    }
  }

  const signInDemo = async () => {
    // Demo auditor user session
    const demoUser = {
      id: "demo-compliance-auditor",
      email: "auditor@enterprise-compliance.ai",
      role: "authenticated",
      app_metadata: { provider: "email" },
      user_metadata: { full_name: "Lead Compliance Auditor", role: "Auditor" },
      aud: "authenticated",
      created_at: new Date().toISOString(),
    } as unknown as User

    setUser(demoUser)
    setSession({
      access_token: "demo-jwt-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "demo-refresh-token",
      user: demoUser,
    })
    setIsAuthModalOpen(false)
  }

  const signOut = async () => {
    if (supabase) {
      await supabase.auth.signOut().catch(() => {})
    }
    setUser(null)
    setSession(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        isAuthenticated: !!user,
        isAuthModalOpen,
        openAuthModal,
        closeAuthModal,
        signInWithEmail,
        signUpWithEmail,
        signInDemo,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuthContext() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuthContext must be used within an AuthProvider")
  }
  return context
}
