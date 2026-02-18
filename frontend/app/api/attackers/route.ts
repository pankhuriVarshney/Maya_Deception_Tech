import { NextResponse } from "next/server"
import { getMockAttackers } from "@/lib/attackers/mock"
import type { AttackerSummary } from "@/types"

export const runtime = "nodejs"

export function GET() {
  const now = new Date()
  const body = getMockAttackers(now) satisfies AttackerSummary[]

  return NextResponse.json({
    success: true,
    data: body,
    count: body.length,
    timestamp: new Date().toISOString()
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
  })
}