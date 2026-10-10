import { Redis } from "@upstash/redis"
import { Ratelimit } from "@upstash/ratelimit"

const redisUrl = process.env.UPSTASH_REDIS_REST_URL
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN

// Upstash Redis connection singleton (only initialized if credentials exist)
const redis =
  redisUrl && redisToken
    ? new Redis({
        url: redisUrl,
        token: redisToken,
      })
    : null

/**
 * Sliding window rate limiter: 5 document scans per 1 hour per user or IP identifier.
 */
export const auditRateLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "1 h"),
      analytics: true,
      prefix: "compliance_audit_ratelimit",
    })
  : null

export type RateLimitResult = {
  success: boolean
  limit: number
  remaining: number
  reset: number
  timeToReset: string
}

/**
 * Formats milliseconds remaining into human-readable minutes/seconds.
 */
export function formatTimeToReset(resetTimestampMs: number): string {
  const diffMs = Math.max(0, resetTimestampMs - Date.now())
  const totalSeconds = Math.ceil(diffMs / 1000)
  if (totalSeconds < 60) {
    return `${totalSeconds} seconds`
  }
  const minutes = Math.ceil(totalSeconds / 60)
  return `${minutes} minutes`
}

/**
 * Helper to check rate limit for a given identifier (User ID or client IP).
 */
export async function checkAuditRateLimit(identifier: string): Promise<RateLimitResult> {
  const cleanId = identifier.trim() || "anonymous-client"
  if (!auditRateLimiter) {
    return {
      success: true,
      limit: 5,
      remaining: 5,
      reset: Date.now() + 3600000,
      timeToReset: "60 minutes",
    }
  }
  try {
    const result = await auditRateLimiter.limit(cleanId)
    return {
      success: result.success,
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
      timeToReset: formatTimeToReset(result.reset),
    }
  } catch (error) {
    console.warn("[Upstash RateLimit] Redis check failed, allowing request as fallback:", error)
    // Fallback: allow request if Upstash Redis connectivity fails temporarily
    return {
      success: true,
      limit: 5,
      remaining: 5,
      reset: Date.now() + 3600000,
      timeToReset: "60 minutes",
    }
  }
}
