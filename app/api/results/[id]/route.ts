import { NextRequest, NextResponse } from "next/server"
import { routerGetResult, routerStartAudit } from "@/lib/backend/router"
import { getAuthUserId } from "@/lib/backend/auth"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: "Missing document id" }, { status: 400 })
    }

    const decodedId = decodeURIComponent(id)
    const userId = await getAuthUserId(req)

    const result = await routerGetResult(decodedId, userId || undefined)
    if (
      result.Status === "NOT_FOUND" ||
      (result as any).message === "Not Found" ||
      (result as any).message === "Document not processed yet."
    ) {
      return NextResponse.json(
        {
          Status: "NOT_FOUND",
          message: "Document not processed yet.",
          backend: (result as any).backend,
        },
        { status: 404 }
      )
    }
    return NextResponse.json(result, { status: 200 })
  } catch (err: any) {
    const msg = err?.message || ""
    if (msg.includes("FORBIDDEN")) {
      return NextResponse.json(
        { error: "Forbidden: You do not own this document.", Status: "FORBIDDEN" },
        { status: 403 }
      )
    }
    if (msg.includes("404") || msg.includes("not found") || msg.includes("NOT_FOUND")) {
      return NextResponse.json(
        { Status: "NOT_FOUND", message: "Document not processed yet." },
        { status: 404 }
      )
    }
    console.error("[API Results Route] Error:", err)
    return NextResponse.json(
      { error: msg || "Failed to retrieve audit result", Status: "FAILED" },
      { status: 500 }
    )
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: "Missing document id" }, { status: 400 })
    }

    const decodedId = decodeURIComponent(id)
    const userId = await getAuthUserId(req)

    const result = await routerStartAudit(decodedId, userId || undefined)
    return NextResponse.json(result, { status: 202 })
  } catch (err: any) {
    console.error("[API Results Route] Start audit error:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to start audit", Status: "FAILED" },
      { status: 500 }
    )
  }
}
