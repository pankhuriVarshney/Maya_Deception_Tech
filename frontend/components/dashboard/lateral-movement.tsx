"use client"

import { Skeleton } from "@/components/ui/skeleton"
import type { LateralMovementData } from "@/lib/dashboard/types"

type LateralMovementProps = {
  data: LateralMovementData | null
  loading?: boolean
}

export function LateralMovement({ data, loading }: LateralMovementProps) {
  if (loading || !data) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">Lateral Movement Map</h3>
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          </div>
        </div>
        <Skeleton className="h-[180px] w-full rounded-md" />
      </div>
    )
  }

  const getNode = (id: string) => data.nodes.find((n) => n.id === id) ?? null

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Lateral Movement Map</h3>
        <div className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
        </div>
      </div>
      <div className="relative w-full overflow-hidden">
        <svg viewBox="0 0 440 240" className="w-full h-auto" aria-label="Lateral movement map showing connections between decoy servers">
          <defs>
            <marker
              id="arrowhead"
              markerWidth="8"
              markerHeight="6"
              refX="8"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill="hsl(187, 80%, 48%)" />
            </marker>
          </defs>
          {data.edges.map((edge) => {
            const from = getNode(edge.from)
            const to = getNode(edge.to)
            if (!from || !to) return null
            return (
              <line
                key={`${edge.from}-${edge.to}`}
                x1={from.x + 50}
                y1={from.y + 14}
                x2={to.x + 50}
                y2={to.y + 14}
                stroke="hsl(187, 80%, 48%)"
                strokeWidth="1.5"
                strokeOpacity="0.5"
                markerEnd="url(#arrowhead)"
              />
            )
          })}
          {data.nodes.map((node) => (
            <g key={node.id}>
              <rect
                x={node.x}
                y={node.y}
                width="100"
                height="28"
                rx="6"
                fill="hsl(222, 30%, 18%)"
                stroke="hsl(222, 30%, 28%)"
                strokeWidth="1"
              />
              <text
                x={node.x + 50}
                y={node.y + 17}
                textAnchor="middle"
                fill="hsl(210, 40%, 85%)"
                fontSize="10"
                fontFamily="system-ui"
              >
                {node.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}
