"use client"

import { Eye } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import type { Overview } from "@/lib/dashboard/types"

type StatusBarProps = {
  overview: Overview | null
  loading?: boolean
}

export function StatusBar({ overview, loading }: StatusBarProps) {
  if (loading || !overview) {
    return (
      <div className="mx-4 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2 text-sm">
        <Eye className="h-4 w-4 text-primary shrink-0" />
        <Skeleton className="h-4 w-32" />
        <span className="text-border">|</span>
        <Skeleton className="h-4 w-40" />
        <span className="text-border">|</span>
        <Skeleton className="h-4 w-48" />
      </div>
    )
  }

  return (
    <div className="mx-4 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2 text-sm">
      <Eye className="h-4 w-4 text-primary shrink-0" />
      <span className="text-muted-foreground">
        {overview.zeroFalsePositives ? "Zero False Positives" : "False Positives Detected"}
      </span>
      <span className="text-border">|</span>
      <span className="text-muted-foreground">
        Risk Level: <span className="font-semibold text-destructive">{overview.riskLevel}</span>
      </span>
      <span className="text-border">|</span>
      <span className="text-muted-foreground">
        Active Campaign: <span className="font-medium text-foreground">{overview.activeCampaign}</span>
      </span>
    </div>
  )
}
