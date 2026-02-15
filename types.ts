import type { DashboardData, LateralMovementData, TimelineEvent as DashboardTimelineEvent } from "@/lib/dashboard/types"

export type EngagementLevel = "Low" | "Medium" | "High"
export type ConcernLevel = "Low" | "Medium" | "High" | "Critical"

export type AttackerSummary = {
  id: string
  currentHost: string
  engagementLevel: EngagementLevel
  concernLevel: ConcernLevel
  threatConfidence: number // 0-100
  lastSeenAt: string // ISO string
}

// These align with the existing dashboard domain types.
export type TimelineEvent = DashboardTimelineEvent
export type CredentialUsage = DashboardData["credentialUsage"]
export type LateralMovement = LateralMovementData

export type AttackerDetails = AttackerSummary & {
  dashboard: DashboardData
  generatedAt: string // ISO string
}

