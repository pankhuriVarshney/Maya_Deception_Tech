"use client"

import { Skeleton } from "@/components/ui/skeleton"
import type { MitreMatrixData } from "@/lib/dashboard/types"

type MitreMatrixProps = {
  data: MitreMatrixData | null
  loading?: boolean
}

function getHeatColor(level: number) {
  switch (level) {
    case 3:
      return "bg-destructive"
    case 2:
      return "bg-chart-3"
    case 1:
      return "bg-accent"
    default:
      return "bg-secondary"
  }
}

export function MitreMatrix({ data, loading }: MitreMatrixProps) {
  const tactics = data?.tactics ?? []
  const matrix = data?.matrix ?? []

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">{"MITRE ATT&CK Matrix"}</h3>
        <div className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
        </div>
      </div>
      <div className="overflow-x-auto">
        {loading || !data ? (
          <div className="grid gap-1 min-w-[350px]" style={{ gridTemplateColumns: `repeat(6, 1fr)` }}>
            {Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className="text-[10px] text-center text-muted-foreground font-medium px-1 pb-1 truncate"
              >
                <Skeleton className="h-3 w-full" />
              </div>
            ))}
            {Array.from({ length: 30 }).map((_, idx) => (
              <Skeleton key={idx} className="h-5 rounded-sm" />
            ))}
          </div>
        ) : (
          <div
            className="grid gap-1 min-w-[350px]"
            style={{ gridTemplateColumns: `repeat(${tactics.length}, 1fr)` }}
          >
            {tactics.map((tactic) => (
              <div
                key={tactic}
                className="text-[10px] text-center text-muted-foreground font-medium px-1 pb-1 truncate"
              >
                {tactic}
              </div>
            ))}
            {[0, 1, 2, 3, 4].map((row) =>
              tactics.map((tactic, col) => (
                <div
                  key={`${row}-${col}-${tactic}`}
                  className={`h-5 rounded-sm ${getHeatColor(matrix[col]?.[row] ?? 0)}`}
                />
              ))
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm bg-accent" />
          <span className="text-[10px] text-muted-foreground">Low</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm bg-chart-3" />
          <span className="text-[10px] text-muted-foreground">Medium</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm bg-destructive" />
          <span className="text-[10px] text-muted-foreground">High</span>
        </div>
      </div>
    </div>
  )
}
