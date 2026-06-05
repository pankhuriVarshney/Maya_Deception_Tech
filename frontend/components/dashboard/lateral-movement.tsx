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
            const midX = (from.x + to.x) / 2 + 50
            const midY = (from.y + to.y) / 2 + 8
            return (
              <g key={`${edge.from}-${edge.to}`}>
                <line
                  x1={from.x + 50}
                  y1={from.y + 14}
                  x2={to.x + 50}
                  y2={to.y + 14}
                  stroke="hsl(187, 80%, 48%)"
                  strokeWidth="1.5"
                  strokeOpacity="0.5"
                  markerEnd="url(#arrowhead)"
                />
                {edge.label ? (
                  <>
                    <rect
                      x={midX - 42}
                      y={midY + 12}
                      width="84"
                      height="18"
                      rx="4"
                      fill="hsl(222, 30%, 12%)"
                      stroke="hsl(187, 80%, 34%)"
                      strokeWidth="0.6"
                      opacity="0.92"
                    />
                    <text
                      x={midX}
                      y={midY + 25}
                      textAnchor="middle"
                      fill="hsl(187, 80%, 70%)"
                      fontSize="8"
                      fontFamily="system-ui"
                    >
                      {edge.label.length > 16 ? `${edge.label.slice(0, 15)}...` : edge.label}
                    </text>
                  </>
                ) : null}
              </g>
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
