"use client"

import { useCallback, useEffect, useState } from "react"
import { useWebSocket } from "./use-websocket"
import type { AttackerSummary } from "@/types"

export function useRealtimeDashboard() {
  const [attackers, setAttackers] = useState<AttackerSummary[]>([])
  const [lastEvent, setLastEvent] = useState<any>(null)

  const handleMessage = useCallback((data: any) => {
    switch(data.type) {
      case 'NEW_EVENT':
        // New attack event received
        setLastEvent(data.data)
        // Refresh attacker list
        refreshAttackers()
        break
        
      case 'ATTACKER_UPDATED':
        // Attacker status changed
        refreshAttackers()
        break
        
      case 'SYNC_COMPLETE':
        // CRDT sync completed
        refreshAttackers()
        break
    }
  }, [])

  const { connected } = useWebSocket(handleMessage)

  const refreshAttackers = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/active-attackers", {
        cache: "no-store"
      })
      const json = await res.json()
      setAttackers(json.data)
    } catch (e) {
      console.error("Failed to refresh attackers:", e)
    }
  }, [])

  // Initial load
  useEffect(() => {
    refreshAttackers()
    
    // Poll every 5 seconds as fallback
    const interval = setInterval(refreshAttackers, 5000)
    return () => clearInterval(interval)
  }, [refreshAttackers])

  return { attackers, lastEvent, connected, refreshAttackers }
}