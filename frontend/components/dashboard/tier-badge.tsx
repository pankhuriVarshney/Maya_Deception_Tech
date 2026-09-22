"use client"

import { Badge } from "@/components/ui/badge"
import type { DecoyPlatform, DecoyTier } from "@/types"

const TIER_LABEL: Record<DecoyTier, string> = {
  low: "Low",
  gvisor: "gVisor",
  kata: "Kata",
}

/**
 * Shows which deception fabric/tier a decoy or attacker is on:
 * Vagrant (full VM, escalation-only) or K8s + gVisor/Kata (default fabric).
 * Falls back to "Vagrant" when platform is missing, matching the backend's
 * own default for records that predate the platform/tier fields.
 */
export function TierBadge({ platform, tier }: { platform?: DecoyPlatform; tier?: DecoyTier }) {
  if (platform === "k8s") {
    return (
      <Badge variant="outline" className="whitespace-nowrap">
        K8s{tier ? ` · ${TIER_LABEL[tier] || tier}` : ""}
      </Badge>
    )
  }
  return <Badge variant="outline" className="whitespace-nowrap">Vagrant</Badge>
}
