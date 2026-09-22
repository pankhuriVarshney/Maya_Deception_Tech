"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { fetchInfrastructureNodeDetail } from "@/lib/infrastructure/api"
import type { InfrastructureNodeDetail } from "@/lib/infrastructure/types"
import { useSharedWebSocket } from "./use-shared-websocket"

export function useInfrastructureNodeDetail(name: string | null, pollIntervalMs = 10000) {
  const [data, setData] = useState<InfrastructureNodeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { subscribe } = useSharedWebSocket()
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (!name || inFlight.current) return
    inFlight.current = true
    try {
      const detail = await fetchInfrastructureNodeDetail(name)
      setData(detail)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to load ${name}`)
    } finally {
      setLoading(false)
      inFlight.current = false
    }
  }, [name])

  useEffect(() => {
    if (!name) return
    setLoading(true)
    void refresh()
    const interval = setInterval(refresh, pollIntervalMs)
    return () => clearInterval(interval)
  }, [name, refresh, pollIntervalMs])

  useEffect(() => {
    const unsubscribe = subscribe((msg) => {
      if (msg.type === "SYNC_COMPLETE" || msg.type === "ATTACKER_UPDATED" || msg.type === "NEW_EVENT") {
        void refresh()
      }
    })
    return unsubscribe
  }, [subscribe, refresh])

  return { data, loading, error, refresh }
}
