"use client"

import { Users, ShieldAlert, Clock, ShieldCheck } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import type { Overview } from "@/lib/dashboard/types"

type MetricsRowProps = {
  overview: Overview | null
  loading?: boolean
}

type Metric = {
  label: string
  value: string
  icon: typeof Users
  color: string
  isBadge?: boolean
}

export function MetricsRow({ overview, loading }: MetricsRowProps) {
  if (loading || !overview) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-4 py-3">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div
            key={idx}
            className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3"
          >
            <Skeleton className="h-5 w-5 rounded-md shrink-0" />
            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-20" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  const metrics: Metric[] = [
    {
      label: "Active Attackers",
      value: String(overview.activeAttackers),
      icon: Users,
      color: "text-destructive",
    },
    {
      label: "Deception Engagement",
      value: overview.deceptionEngagement,
      icon: ShieldAlert,
      color: "text-chart-3",
      isBadge: true,
    },
    {
      label: "Dwell Time Gained",
      value: overview.dwellTimeGained,
      icon: Clock,
      color: "text-primary",
    },
    {
      label: "Real Assets Protected",
      value: String(overview.realAssetsProtected),
      icon: ShieldCheck,
      color: "text-accent",
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-4 py-3">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3"
        >
          <metric.icon className={`h-5 w-5 ${metric.color} shrink-0`} />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-xs text-muted-foreground truncate">{metric.label}</span>
            {metric.isBadge ? (
              <span className="inline-flex w-fit items-center rounded-md bg-chart-3/20 px-2 py-0.5 text-xs font-semibold text-chart-3 border border-chart-3/30">
                {metric.value}
              </span>
            ) : (
              <span className="text-2xl font-bold text-foreground leading-tight">{metric.value}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
