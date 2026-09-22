"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { fetchInfrastructureNodes } from "@/lib/infrastructure/api"
import type { InfrastructureNodeSummary } from "@/lib/infrastructure/types"
import { useSharedWebSocket } from "./use-shared-websocket"

export function useInfrastructureNodes(pollIntervalMs = 10000) {
  const [nodes, setNodes] = useState<InfrastructureNodeSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { subscribe } = useSharedWebSocket()
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const data = await fetchInfrastructureNodes()
      setNodes(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load infrastructure nodes")
    } finally {
      setLoading(false)
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    void refresh()
    const interval = setInterval(refresh, pollIntervalMs)
    return () => clearInterval(interval)
  }, [refresh, pollIntervalMs])

  useEffect(() => {
    const unsubscribe = subscribe((msg) => {
      if (msg.type === "SYNC_COMPLETE" || msg.type === "ATTACKER_UPDATED" || msg.type === "NEW_EVENT") {
        void refresh()
      }
    })
    return unsubscribe
  }, [subscribe, refresh])

  return { nodes, loading, error, refresh }
}
