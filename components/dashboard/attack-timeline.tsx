"use client"

import { ChevronRight } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import type { TimelineEvent } from "@/lib/dashboard/types"

type AttackTimelineProps = {
  events: TimelineEvent[] | null
  loading?: boolean
}

function getSeverityColor(severity: string) {
  switch (severity) {
    case "critical":
      return "bg-destructive border-destructive/40"
    case "high":
      return "bg-chart-3/20 border-chart-3/40"
    case "medium":
      return "bg-secondary border-border"
    default:
      return "bg-secondary border-border"
  }
}

function getDotColor(severity: string) {
  switch (severity) {
    case "critical":
      return "bg-destructive"
    case "high":
      return "bg-chart-3"
    case "medium":
      return "bg-primary"
    default:
      return "bg-muted-foreground"
  }
}

export function AttackTimeline({ events, loading }: AttackTimelineProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Attack Timeline</h3>
        <div className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
        </div>
      </div>
      <div className="space-y-2">
        {loading || !events
          ? Array.from({ length: 5 }).map((_, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 rounded-md border px-3 py-2.5 bg-secondary/20 border-border"
              >
                <Skeleton className="w-2 h-2 rounded-full shrink-0" />
                <Skeleton className="h-3 w-10 shrink-0" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
                <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
              </div>
            ))
          : events.map((event) => (
              <div
                key={event.time + event.label}
                className={`flex items-center gap-3 rounded-md border px-3 py-2.5 ${getSeverityColor(event.severity)}`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${getDotColor(event.severity)}`} />
                <span className="text-xs text-muted-foreground font-mono w-10 shrink-0">{event.time}</span>
                <span className="text-sm font-semibold text-foreground">{event.label}</span>
                {event.detail && (
                  <>
                    <span className="text-muted-foreground text-sm">:</span>
                    <span className="text-sm text-muted-foreground">{event.detail}</span>
                  </>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
              </div>
            ))}
      </div>
    </div>
  )
}
