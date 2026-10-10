/**
 * lib/backend/circuit-breaker.ts - Upstash Redis circuit breaker for primary backend.
 *
 * State machine: CLOSED → OPEN (after 3 failures in 60s) → HALF_OPEN (after 120s TTL expires).
 * Only network errors, timeouts, 5xx, and 403 trip the breaker. 400/404/413 do NOT.
 */

import { Redis } from "@upstash/redis";

const FAILURE_THRESHOLD = 3;
const FAILURE_WINDOW_SECONDS = 60;
const OPEN_DURATION_SECONDS = 120;

const FAILURE_COUNT_KEY = "circuit:primary:failures";
const OPEN_KEY = "circuit:primary:open";

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    redis = new Redis({ url, token });
  }
  return redis;
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/** Check current breaker state. */
export async function getCircuitState(): Promise<CircuitState> {
  const r = getRedis();
  if (!r) return "CLOSED"; // no Redis = breaker disabled

  try {
    const isOpen = await r.exists(OPEN_KEY);
    if (isOpen) return "OPEN";
    // If the open key expired but we previously had failures, we're half-open
    const failures = (await r.get<number>(FAILURE_COUNT_KEY)) ?? 0;
    if (failures >= FAILURE_THRESHOLD) return "HALF_OPEN";
    return "CLOSED";
  } catch (err) {
    console.warn("[CircuitBreaker] Redis error in getState, defaulting CLOSED:", err);
    return "CLOSED";
  }
}

/** Record a failure. Returns true if the breaker just tripped to OPEN. */
export async function recordFailure(): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;

  try {
    const count = await r.incr(FAILURE_COUNT_KEY);
    if (count === 1) {
      // First failure: set expiry window
      await r.expire(FAILURE_COUNT_KEY, FAILURE_WINDOW_SECONDS);
    }
    if (count >= FAILURE_THRESHOLD) {
      // Trip the breaker
      await r.set(OPEN_KEY, "1", { ex: OPEN_DURATION_SECONDS });
      await r.del(FAILURE_COUNT_KEY);
      console.warn("[CircuitBreaker] Breaker OPEN for", OPEN_DURATION_SECONDS, "seconds");
      return true;
    }
    return false;
  } catch (err) {
    console.warn("[CircuitBreaker] Redis error in recordFailure:", err);
    return false;
  }
}

/** Record a success (reset failure count, close breaker). */
export async function recordSuccess(): Promise<void> {
  const r = getRedis();
  if (!r) return;

  try {
    await r.del(FAILURE_COUNT_KEY, OPEN_KEY);
  } catch (err) {
    console.warn("[CircuitBreaker] Redis error in recordSuccess:", err);
  }
}

/** Check if an HTTP status code should trip the breaker. */
export function isFailoverStatus(status: number): boolean {
  // Network errors, timeouts, 5xx, 403 trip the breaker
  // 400, 404, 413 do NOT
  if (status === 403) return true;
  if (status >= 500) return true;
  return false;
}
