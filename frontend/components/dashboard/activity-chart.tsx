"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Cell,
} from "recharts"
import { Skeleton } from "@/components/ui/skeleton"
import type { ActivityBar } from "@/lib/dashboard/types"

type ActivityChartProps = {
  data: ActivityBar[] | null
  loading?: boolean
}

const barFills = [
  "hsl(187, 80%, 48%)",
  "hsl(142, 71%, 45%)",
  "hsl(38, 92%, 50%)",
  "hsl(187, 80%, 48%)",
  "hsl(0, 72%, 51%)",
  "hsl(142, 71%, 45%)",
] as const

export function ActivityChart({ data, loading }: ActivityChartProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="h-[180px] w-full">
        {loading || !data ? (
          <Skeleton className="h-full w-full rounded-md" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barSize={36}>
              <XAxis
                dataKey="name"
                tick={{ fill: "hsl(215, 20%, 55%)", fontSize: 9 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "hsl(215, 20%, 55%)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={30}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(222, 47%, 11%)",
                  border: "1px solid hsl(222, 30%, 20%)",
                  borderRadius: "6px",
                  color: "hsl(210, 40%, 96%)",
                  fontSize: "12px",
                }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {data.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={barFills[index % barFills.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
