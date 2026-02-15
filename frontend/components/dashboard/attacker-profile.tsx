"use client"

import { Skeleton } from "@/components/ui/skeleton"
import type { Attacker } from "@/lib/dashboard/types"

type AttackerProfileProps = {
  attacker: Attacker | null
  loading?: boolean
}

function formatLastSeen(lastSeenAt: string): string {
  const t = new Date(lastSeenAt).getTime()
  if (!Number.isFinite(t)) return "Unknown"

  const diffMs = Math.max(0, Date.now() - t)
  const mins = Math.round(diffMs / 60000)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export function AttackerProfile({ attacker, loading }: AttackerProfileProps) {
  if (loading || !attacker) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <span className="w-1 h-4 rounded-full bg-primary" />
          Attacker Profile
        </h3>
        <div className="space-y-3 text-sm">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
        <span className="w-1 h-4 rounded-full bg-primary" />
        Attacker Profile
      </h3>
      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Attacker ID:</span>
          <span className="font-bold text-foreground">{attacker.attackerId}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Entry Point:</span>
          <span className="font-semibold text-foreground">{attacker.entryPoint}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Current Privilege:</span>
          <span className="font-bold text-foreground">{attacker.currentPrivilege}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Last Seen:</span>
          <span className="text-foreground">{formatLastSeen(attacker.lastSeenAt)}</span>
        </div>
      </div>
    </div>
  )
}
