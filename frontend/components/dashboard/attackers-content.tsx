"use client"

import { AttackersList } from "@/components/dashboard/attackers-list"
import { Badge } from "@/components/ui/badge"
import { Server, Activity } from "lucide-react"
import { useRealtimeAttackers } from "@/hooks/use-realtime-attackers"
import { useVMStatus } from "@/hooks/use-vm-status"

export function AttackersContent() {
  const { attackers, loading, lastUpdate, wsConnected } = useRealtimeAttackers(30000)
  const { runningCount, totalVMs, wsConnected: vmWsConnected } = useVMStatus(30000)

  return (
    <div className="space-y-3">
      {/* Status Bar - NO NAVBAR HERE */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={wsConnected && vmWsConnected ? "default" : "secondary"}>
            {wsConnected && vmWsConnected ? "🟢 Fully Live" : "🟡 Partially Live"}
          </Badge>
          {lastUpdate && (
            <span className="text-xs text-muted-foreground">
              Updated: {lastUpdate.toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Server className="h-4 w-4" />
            {runningCount}/{totalVMs} VMs
          </span>
          <span className="flex items-center gap-1">
            <Activity className="h-4 w-4" />
            {attackers.length} attackers
          </span>
        </div>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="text-lg font-semibold text-foreground">Attackers Overview</div>
          <div className="text-sm text-muted-foreground">
            Real-time attacker sessions in deception infrastructure.
          </div>
        </div>
      </div>

      <AttackersList attackers={attackers} loading={loading} />
    </div>
  )
}