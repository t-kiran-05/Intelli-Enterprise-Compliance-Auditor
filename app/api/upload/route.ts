import { NextRequest, NextResponse } from "next/server"
import { checkAuditRateLimit } from "@/lib/ratelimit"
import { routerInitUpload } from "@/lib/backend/router"
import { getAuthUserId } from "@/lib/backend/auth"

export async function POST(req: NextRequest) {
  try {
    // 1. Identify client: User ID from Auth Header or Client IP
    const authHeader = req.headers.get("authorization") || ""
    const forwardedFor = req.headers.get("x-forwarded-for") || ""
    const realIp = req.headers.get("x-real-ip") || ""

    let identifier = "anonymous-client"
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "").trim()
      identifier = `user:${token.slice(0, 32)}`
    } else if (forwardedFor) {
      identifier = `ip:${forwardedFor.split(",")[0].trim()}`
    } else if (realIp) {
      identifier = `ip:${realIp.trim()}`
    }

    // 2. Check Upstash Redis Sliding Window Rate Limit (5 scans/hour)
    const rateLimit = await checkAuditRateLimit(identifier)

    const headers = {
      "X-RateLimit-Limit": rateLimit.limit.toString(),
      "X-RateLimit-Remaining": rateLimit.remaining.toString(),
      "X-RateLimit-Reset": rateLimit.reset.toString(),
    }

    if (!rateLimit.success) {
      const retryAfterSec = Math.max(1, Math.ceil((rateLimit.reset - Date.now()) / 1000))
      return NextResponse.json(
        {
          error: "Rate limit exceeded. You are limited to 5 document scans per hour.",
          limit: rateLimit.limit,
          remaining: rateLimit.remaining,
          reset: rateLimit.reset,
          timeToReset: rateLimit.timeToReset,
        },
        {
          status: 429,
          headers: {
            ...headers,
            "Retry-After": retryAfterSec.toString(),
          },
        },
      )
    }

    // 3. Extract authenticated user id for document ownership
    const userId = await getAuthUserId(req)

    // 4. Rate limit passed: Parse request body
    const body = await req.json().catch(() => ({}))
    const filename = body.filename || body.file_name || `document-${Date.now()}.pdf`
    const docType = body.docType || body.doc_type || undefined

    // 5. Dispatch upload initialization through Failover Router (AWS primary -> Render secondary)
    const uploadResult = await routerInitUpload(filename, docType, userId || undefined)

    return NextResponse.json(
      {
        uploadUrl: uploadResult.uploadUrl,
        documentId: uploadResult.compositeId,
        backend: uploadResult.backend,
        wakeUpMessage: uploadResult.wakeUpMessage,
        remaining: rateLimit.remaining,
        limit: rateLimit.limit,
        reset: rateLimit.reset,
        timeToReset: rateLimit.timeToReset,
      },
      {
        status: 200,
        headers,
      },
    )
  } catch (err: any) {
    console.error("[API Upload Route] Error:", err)
    return NextResponse.json(
      { error: err?.message || "Internal server error during upload authorization." },
      { status: 500 },
    )
  }
}
