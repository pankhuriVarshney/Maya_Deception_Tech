"use client"

import { AttackersList } from "@/components/dashboard/attackers-list"
import { Badge } from "@/components/ui/badge"
import { Server, Activity, RefreshCw } from "lucide-react"
import { useRealtimeAttackers } from "@/hooks/use-realtime-attackers"
import { useVMStatus } from "@/hooks/use-vm-status"
import { Button } from "@/components/ui/button"
import { useEffect } from "react"

export function AttackersContent() {
  const { attackers, loading, lastUpdate, wsConnected, refresh } = useRealtimeAttackers()
  const { runningCount, totalVMs, totalAttackers: vmAttackers, wsConnected: vmWsConnected } = useVMStatus()

  // Debug logging
  useEffect(() => {
    console.log('AttackersContent - attackers:', attackers)
    console.log('AttackersContent - VM attackers:', vmAttackers)
    console.log('AttackersContent - wsConnected:', wsConnected, vmWsConnected)
  }, [attackers, vmAttackers, wsConnected, vmWsConnected])

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
            {attackers.length} attackers (VM shows: {vmAttackers})
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              console.log('Manual refresh triggered')
              refresh()
            }}
            className="h-7 px-2"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Refresh
          </Button>
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

      {loading && !attackers?.length ? (
        <div className="text-sm text-muted-foreground text-center py-8">
          Loading attackers...
        </div>
      ) : !attackers || attackers.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8">
          No attackers detected. VM CRDT shows: {vmAttackers} attackers
        </div>
      ) : (
        <AttackersList attackers={attackers} loading={false} />
      )}
    </div>
  )
}