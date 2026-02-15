"use client"

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts"
import { Skeleton } from "@/components/ui/skeleton"
import type { IncidentSummaryData } from "@/lib/dashboard/types"

type IncidentSummaryProps = {
  data: IncidentSummaryData | null
  loading?: boolean
}

const sliceColors = [
  "hsl(222, 30%, 25%)",
  "hsl(187, 80%, 48%)",
  "hsl(38, 92%, 50%)",
] as const

function legendDotClass(kind: "secondary" | "primary" | "chart3") {
  switch (kind) {
    case "secondary":
      return "bg-secondary"
    case "primary":
      return "bg-primary"
    case "chart3":
      return "bg-chart-3"
  }
}

export function IncidentSummary({ data, loading }: IncidentSummaryProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground mb-4">Incident Summary</h3>
      <div className="flex items-center gap-4">
        <div className="w-28 h-28 shrink-0">
          {loading || !data ? (
            <Skeleton className="w-full h-full rounded-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.slices}
                  cx="50%"
                  cy="50%"
                  innerRadius={28}
                  outerRadius={48}
                  paddingAngle={3}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {data.slices.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={sliceColors[index % sliceColors.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="space-y-2.5 flex-1 min-w-0">
          {loading || !data
            ? Array.from({ length: 3 }).map((_, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Skeleton className="w-2.5 h-2.5 rounded-sm shrink-0" />
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-3 w-8 ml-auto shrink-0" />
                </div>
              ))
            : data.legend.map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-sm ${legendDotClass(item.kind)} shrink-0`}
                  />
                  <span className="text-xs text-muted-foreground truncate">{item.label}</span>
                  {item.pct && (
                    <span className="text-xs font-semibold text-foreground ml-auto shrink-0">
                      {item.pct}
                    </span>
                  )}
                </div>
              ))}
        </div>
      </div>
    </div>
  )
}
