"use client"

import { ChevronRight, Terminal } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import type { CommandActivityItem } from "@/lib/dashboard/types"

type CommandActivityProps = {
  data: CommandActivityItem[] | null
  loading?: boolean
}

export function CommandActivity({ data, loading }: CommandActivityProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Command Activity</h3>
        <div className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
        </div>
      </div>
      <div className="space-y-2">
        {loading || !data
          ? Array.from({ length: 3 }).map((_, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <Terminal className="h-3.5 w-3.5 text-primary" />
                  <Skeleton className="h-4 w-28" />
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            ))
          : data.map((cmd) => (
              <div
                key={cmd.name}
                className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <Terminal className="h-3.5 w-3.5 text-primary" />
                  <span className="text-sm font-mono text-foreground">{cmd.name}</span>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            ))}
      </div>
      <div className="mt-3 space-y-1.5">
        {loading || !data
          ? Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <Skeleton className="h-full w-2/3 rounded-full" />
                </div>
              </div>
            ))
          : data.map((cmd) => (
              <div key={cmd.name + "-bar"} className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      cmd.severity > 90
                        ? "bg-destructive"
                        : cmd.severity > 75
                        ? "bg-chart-3"
                        : "bg-primary"
                    }`}
                    style={{ width: `${cmd.severity}%` }}
                  />
                </div>
              </div>
            ))}
      </div>
    </div>
  )
}
