import { NextResponse } from "next/server"
import { getMockAttackers } from "@/lib/attackers/mock"
import type { AttackerSummary } from "@/types"

export const runtime = "nodejs"

export function GET() {
  const now = new Date()
  const body = getMockAttackers(now) satisfies AttackerSummary[]

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store",
    },
  })
}

