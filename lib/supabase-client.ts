import { createBrowserClient } from "@supabase/ssr"
import { createClient as createSupabaseClient, SupabaseClient } from "@supabase/supabase-js"

const rawUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
const rawKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim()

// Validate that the URL is a real Supabase endpoint (not empty and not localhost)
const isValidSupabaseUrl =
  Boolean(rawUrl) &&
  rawUrl.startsWith("https://") &&
  !rawUrl.includes("localhost")

export function createClient(): SupabaseClient | null {
  if (!isValidSupabaseUrl || !rawKey) {
    return null
  }
  return createBrowserClient(rawUrl, rawKey)
}

// Singleton for client-side components (null if unconfigured or pointing to localhost)
export const supabase: SupabaseClient | null =
  isValidSupabaseUrl && rawKey
    ? createSupabaseClient(rawUrl, rawKey)
    : null
