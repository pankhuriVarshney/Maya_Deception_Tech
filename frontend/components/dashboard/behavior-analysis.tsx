"use client"

import { ChevronRight } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import type { BehaviorAnalysisData } from "@/lib/dashboard/types"

type BehaviorAnalysisProps = {
  data: BehaviorAnalysisData | null
  loading?: boolean
}

function dotClass(kind: "destructive" | "chart3") {
  return kind === "destructive" ? "bg-destructive" : "bg-chart-3"
}

export function BehaviorAnalysis({ data, loading }: BehaviorAnalysisProps) {
  const threatPct = data?.threatConfidencePct ?? 0

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground mb-4">Attacker Behavior Analysis</h3>
      <div className="space-y-2">
        {loading || !data
          ? Array.from({ length: 3 }).map((_, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <Skeleton className="w-2.5 h-2.5 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            ))
          : data.behaviors.map((b) => (
              <div
                key={b.label}
                className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${dotClass(b.kind)}`} />
                  <span className="text-sm text-foreground">{b.label}</span>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            ))}
      </div>
      <div className="mt-4 pt-3 border-t border-border">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-muted-foreground">Threat Confidence</span>
          {loading || !data ? (
            <Skeleton className="h-3 w-10" />
          ) : (
            <span className="text-xs font-semibold text-destructive">{threatPct}%</span>
          )}
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          {loading || !data ? (
            <Skeleton className="h-full w-2/3 rounded-full" />
          ) : (
            <div
              className="h-full rounded-full bg-gradient-to-r from-chart-3 via-destructive to-destructive"
              style={{ width: `${Math.max(0, Math.min(100, threatPct))}%` }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
