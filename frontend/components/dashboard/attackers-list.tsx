"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import type { AttackerSummary, ConcernLevel, EngagementLevel } from "@/types"
import { cn } from "@/lib/utils"

type AttackersListProps = {
  attackers: AttackerSummary[] | null
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

function engagementVariant(level: EngagementLevel) {
  if (level === "High") return "default" as const
  if (level === "Medium") return "secondary" as const
  return "outline" as const
}

function concernVariant(level: ConcernLevel) {
  if (level === "Critical") return "destructive" as const
  if (level === "High") return "default" as const
  if (level === "Medium") return "secondary" as const
  return "outline" as const
}

function AttackersListSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {Array.from({ length: 6 }).map((_, idx) => (
        <Card key={idx} className="border-border bg-card">
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-40" />
            <div className="mt-2 flex items-center gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-full" />
            </div>
            <div className="flex items-center justify-between text-sm">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function AttackersList({ attackers, loading }: AttackersListProps) {
  if (loading && !attackers) return <AttackersListSkeleton />

  if (!attackers || attackers.length === 0) {
    return (
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">No Active Attackers</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No attacker sessions are currently active.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {(Array.isArray(attackers) ? attackers : []).map((a, index) => (
  <Link
    key={a.id || a.attackerId || `attacker-${index}`}
    href={`/attacker/${encodeURIComponent(a.id || a.attackerId || 'unknown')}`}  
          className={cn("block focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background rounded-lg")}
        >
          <Card className="h-full border-border bg-card transition-colors hover:bg-card/80">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-base">{a.id}</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant={engagementVariant(a.engagementLevel)} className="whitespace-nowrap">
                    {a.engagementLevel}
                  </Badge>
                  <Badge variant={concernVariant(a.concernLevel)} className="whitespace-nowrap">
                    {a.concernLevel}
                  </Badge>
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                Current Decoy Host: <span className="text-foreground font-medium">{a.currentHost}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Threat Confidence</span>
                <span className="text-foreground font-medium">
                  {isNaN(a.threatConfidence) ? 0 : Math.round(a.threatConfidence)}%
                </span>
              </div>
              <Progress 
                value={isNaN(a.threatConfidence) ? 0 : Math.max(0, Math.min(100, a.threatConfidence))} 
              />
             </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Last Seen</span>
                <span className="text-foreground">{formatLastSeen(a.lastSeenAt)}</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  )
}

