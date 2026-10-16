"use client"

import { ChevronRight, Terminal } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
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
      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
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
          : data.map((cmd, idx) => (
              <div
                key={`${cmd.name}-${idx}`}
                className="rounded-md bg-secondary/50 px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Terminal className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="text-sm font-mono text-foreground truncate" title={cmd.name}>
                    {cmd.name}
                  </span>
                  <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground shrink-0" />
                </div>
                {(cmd.technique || cmd.dangerous || cmd.timestamp) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[22px]">
                    {cmd.timestamp && (
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {new Date(cmd.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                    )}
                    {cmd.technique && (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {cmd.technique}
                        {cmd.techniqueName ? ` · ${cmd.techniqueName}` : ""}
                      </Badge>
                    )}
                    {cmd.dangerous && (
                      <Badge variant="destructive" className="text-[10px]">
                        Dangerous
                      </Badge>
                    )}
                  </div>
                )}
                <div className="mt-2 h-1 rounded-full bg-secondary overflow-hidden">
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
