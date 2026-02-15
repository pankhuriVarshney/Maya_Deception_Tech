import type { AttackerDetails, AttackerSummary, ConcernLevel, EngagementLevel } from "@/types"
import { getMockDashboardData } from "@/lib/dashboard/mock"

type Seed = {
  id: string
  currentHost: string
  engagementLevel: EngagementLevel
  concernLevel: ConcernLevel
  threatConfidence: number
  lastSeenMinutesAgo: number
  entryPoint: string
  currentPrivilege: string
}

const SEEDS: Seed[] = [
  {
    id: "APT-1032",
    currentHost: "Decoy Server 2",
    engagementLevel: "High",
    concernLevel: "Critical",
    threatConfidence: 87,
    lastSeenMinutesAgo: 3,
    entryPoint: "Phishing Email",
    currentPrivilege: "Admin",
  },
  {
    id: "APT-2091",
    currentHost: "Decoy DB",
    engagementLevel: "Medium",
    concernLevel: "Medium",
    threatConfidence: 52,
    lastSeenMinutesAgo: 8,
    entryPoint: "RDP Brute Force",
    currentPrivilege: "User",
  },
  {
    id: "APT-7710",
    currentHost: "Decoy AD",
    engagementLevel: "Low",
    concernLevel: "High",
    threatConfidence: 64,
    lastSeenMinutesAgo: 21,
    entryPoint: "VPN Credential Stuffing",
    currentPrivilege: "Power User",
  },
  {
    id: "APT-4421",
    currentHost: "Decoy Server 1",
    engagementLevel: "High",
    concernLevel: "High",
    threatConfidence: 78,
    lastSeenMinutesAgo: 14,
    entryPoint: "Web Shell",
    currentPrivilege: "Admin",
  },
]

export function getMockAttackers(now = new Date()): AttackerSummary[] {
  return SEEDS.map((s) => ({
    id: s.id,
    currentHost: s.currentHost,
    engagementLevel: s.engagementLevel,
    concernLevel: s.concernLevel,
    threatConfidence: s.threatConfidence,
    lastSeenAt: new Date(now.getTime() - s.lastSeenMinutesAgo * 60 * 1000).toISOString(),
  }))
}

export function getMockAttackerDetails(id: string, now = new Date()): AttackerDetails | null {
  const seed = SEEDS.find((s) => s.id === id)
  if (!seed) return null

  const dashboard = getMockDashboardData(now)
  dashboard.attacker = {
    attackerId: seed.id,
    entryPoint: seed.entryPoint,
    currentPrivilege: seed.currentPrivilege,
    lastSeenAt: new Date(now.getTime() - seed.lastSeenMinutesAgo * 60 * 1000).toISOString(),
  }

  // Light personalization to keep the UI consistent while making the route feel "real".
  dashboard.overview.riskLevel = seed.concernLevel === "Critical" ? "Critical" : seed.concernLevel
  dashboard.overview.activeCampaign = `"${seed.id} Campaign"`
  dashboard.timeline = dashboard.timeline.map((evt) =>
    evt.label === "Lateral Movement"
      ? { ...evt, detail: `to ${seed.currentHost}` }
      : evt
  )

  return {
    id: seed.id,
    currentHost: seed.currentHost,
    engagementLevel: seed.engagementLevel,
    concernLevel: seed.concernLevel,
    threatConfidence: seed.threatConfidence,
    lastSeenAt: new Date(now.getTime() - seed.lastSeenMinutesAgo * 60 * 1000).toISOString(),
    dashboard,
    generatedAt: now.toISOString(),
  }
}

