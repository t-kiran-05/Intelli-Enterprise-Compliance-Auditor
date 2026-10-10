import { NextRequest, NextResponse } from "next/server";
import { routerListAudits } from "@/lib/backend/router";
import { getAuthUserId } from "@/lib/backend/auth";

export async function GET(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);
    const audits = await routerListAudits(userId || undefined);
    return NextResponse.json({ audits }, { status: 200 });
  } catch (err: any) {
    console.error("[API Results List Route] Error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to list previous audits", audits: [] },
      { status: 500 }
    );
  }
}

