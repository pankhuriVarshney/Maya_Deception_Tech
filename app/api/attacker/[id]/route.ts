import { NextResponse } from "next/server"
import { getMockAttackerDetails } from "@/lib/attackers/mock"

export const runtime = "nodejs"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const now = new Date()
  const { id } = await params
  const details = getMockAttackerDetails(id, now)

  if (!details) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json(details, {
    headers: {
      "Cache-Control": "no-store",
    },
  })
}
