"use client"

import { Skeleton } from "@/components/ui/skeleton"
import type { DashboardData } from "@/lib/dashboard/types"

type DeceptionMetricsProps = {
  data: DashboardData["deceptionMetrics"] | null
  loading?: boolean
}

function dotClass(kind: "destructive" | "accent" | "chart3") {
  switch (kind) {
    case "destructive":
      return "bg-destructive"
    case "accent":
      return "bg-accent"
    case "chart3":
      return "bg-chart-3"
  }
}

export function DeceptionMetrics({ data, loading }: DeceptionMetricsProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <span className="w-1 h-4 rounded-full bg-destructive" />
          Deception Metrics
        </h3>
        <div className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
        </div>
      </div>
      <div className="space-y-3">
        {loading || !data
          ? Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className="flex items-center gap-3">
                <Skeleton className="w-2.5 h-2.5 rounded-full shrink-0" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-14 ml-auto" />
              </div>
            ))
          : data.items.map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <span className={`w-2.5 h-2.5 rounded-full ${dotClass(item.kind)} shrink-0`} />
                <span className="text-sm text-muted-foreground">{item.label}</span>
                {item.value && (
                  <span className="text-sm font-bold text-accent ml-auto">{item.value}</span>
                )}
              </div>
            ))}
      </div>
    </div>
  )
}
