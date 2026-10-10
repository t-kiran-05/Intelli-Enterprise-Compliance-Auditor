/**
 * Supabase client and pgvector RAG utilities for Next.js frontend and server routes.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ""

export type RegulatoryChunk = {
  id: number
  framework: "gdpr" | "soc2" | "ccpa" | "iso27701" | string
  clause_reference: string
  title: string
  content: string
  metadata?: Record<string, any>
  similarity?: number
}

/**
 * Retrieve top matching regulatory chunks using Supabase RPC `match_regulatory_rules`.
 */
export async function matchRegulatoryRules(
  queryEmbedding: number[],
  matchCount: number = 5,
  matchThreshold: number = 0.0,
  filterFramework?: string,
): Promise<RegulatoryChunk[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn("[Supabase RAG] SUPABASE_URL or SUPABASE_ANON_KEY not configured; skipping match")
    return []
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_regulatory_rules`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        query_embedding: queryEmbedding,
        match_count: matchCount,
        match_threshold: matchThreshold,
        filter_framework: filterFramework || null,
      }),
    })

    if (!res.ok) {
      console.warn(`[Supabase RAG] Match query returned status ${res.status}`)
      return []
    }

    const data = (await res.json()) as RegulatoryChunk[]
    return Array.isArray(data) ? data : []
  } catch (error) {
    console.error("[Supabase RAG] Error querying match_regulatory_rules:", error)
    return []
  }
}

