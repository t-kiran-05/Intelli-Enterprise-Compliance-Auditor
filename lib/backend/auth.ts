/**
 * lib/backend/auth.ts - Server-side authentication helper for Next.js API routes.
 *
 * Extracts and verifies the authenticated Supabase user ID from request headers.
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/**
 * Extracts and validates the authenticated Supabase user ID from the Authorization header.
 * Returns null if the user is unauthenticated or the token is invalid.
 */
export async function getAuthUserId(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    return null;
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return null;
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return null;
    }
    return data.user.id;
  } catch (err) {
    console.warn("[Auth] Failed to verify user token:", err);
    return null;
  }
}
