import { NextResponse } from "next/server"
import { getMockDashboardData } from "@/lib/dashboard/mock"
import type { DashboardResponse } from "@/lib/dashboard/types"

export const runtime = "nodejs"

export function GET() {
  const now = new Date()
  const body: DashboardResponse = {
    data: getMockDashboardData(now),
    generatedAt: now.toISOString(),
  }

  return NextResponse.json(body, {
    headers: {
      // Keep it dynamic for polling.
      "Cache-Control": "no-store",
    },
  })
}

