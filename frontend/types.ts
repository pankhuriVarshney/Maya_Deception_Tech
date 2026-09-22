import type { DashboardData, LateralMovementData, TimelineEvent as DashboardTimelineEvent } from "@/lib/dashboard/types"

export type EngagementLevel = "Low" | "Medium" | "High"
export type ConcernLevel = "Low" | "Medium" | "High" | "Critical"

export type DecoyPlatform = "vagrant" | "k8s"
export type DecoyTier = "low" | "gvisor" | "kata"

export type AttackerSummary = {
  id: string
  ipAddress?: string
  entryPoint?: string
  currentHost: string
  currentPrivilege?: string
  riskLevel?: string
  campaign?: string
  lastSeenAt: string // ISO string
  dwellTime?: number
  engagementLevel: EngagementLevel
  concernLevel: ConcernLevel
  threatConfidence: number // 0-100
  status?: string
  platform?: DecoyPlatform
  tier?: DecoyTier
}

// These align with the existing dashboard domain types.
export type TimelineEvent = DashboardTimelineEvent
export type CredentialUsage = DashboardData["credentialUsage"]
export type LateralMovement = LateralMovementData

export type AttackerDetails = AttackerSummary & {
  dashboard: DashboardData
  generatedAt: string // ISO string
}

