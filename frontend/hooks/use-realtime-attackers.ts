"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useSharedWebSocket } from "./use-shared-websocket"
import type { AttackerSummary } from "@/types"

let globalFetchPromise: Promise<void> | null = null
let lastFetchTime = 0
const FETCH_COOLDOWN = 2000 // Reduced from 10000ms to 2000ms for faster updates

export function useRealtimeAttackers() {
  const [attackers, setAttackers] = useState<AttackerSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const { connected: wsConnected, subscribe } = useSharedWebSocket()
  const forceUpdateRef = useRef(false)

  const fetchAttackers = useCallback(async (force = false) => {
    // Allow force fetch bypassing rate limit (for WebSocket triggers)
    if (!force && globalFetchPromise) {
      await globalFetchPromise
      return
    }

    // Only rate limit non-force requests
    const now = Date.now()
    if (!force && now - lastFetchTime < FETCH_COOLDOWN) {
      console.log('[useRealtimeAttackers] Rate limited, skipping fetch')
      return
    }
    
    if (!force) {
      lastFetchTime = now
    }

    console.log('[useRealtimeAttackers] Fetching attackers from API...')
    const fetchPromise = (async () => {
      try {
        setLoading(prev => attackers.length === 0 ? true : prev)

        const res = await fetch("/api/dashboard/active-attackers", { 
          cache: "no-store",
          headers: { 'Pragma': 'no-cache' }
        })

        if (res.status === 429) {
          console.warn('Rate limited by backend')
          return
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const json = await res.json()

        // Validate and sanitize data
        const data = (json.data || []).map((a: any) => ({
          ...a,
          id: a.id || a.attackerId || 'unknown',
          threatConfidence: typeof a.threatConfidence === 'number' && !isNaN(a.threatConfidence)
            ? a.threatConfidence
            : 0,
          engagementLevel: a.engagementLevel || 'Low',
          concernLevel: a.concernLevel || 'Low',
        }))

        console.log(`[useRealtimeAttackers] Fetched ${data.length} attackers:`, data.map((a: any) => a.id))
        setAttackers(data)
        setLastUpdate(new Date())
      } catch (e) {
        console.error("[useRealtimeAttackers] Failed to fetch attackers:", e)
      } finally {
        setLoading(false)
        globalFetchPromise = null
      }
    })()

    globalFetchPromise = fetchPromise
    await fetchPromise
  }, [attackers.length])

  // Initial fetch
  useEffect(() => {
    fetchAttackers()
  }, [fetchAttackers])

  // WebSocket updates
  useEffect(() => {
    const unsubscribe = subscribe((msg) => {
      console.log('useRealtimeAttackers received:', msg.type)

      if (msg.type === 'INITIAL_STATE' && msg.data?.activeAttackers) {
        const validAttackers = (msg.data.activeAttackers || []).map((a: any) => ({
          ...a,
          threatConfidence: typeof a.threatConfidence === 'number' ? a.threatConfidence : 0,
        }))
        setAttackers(validAttackers)
        setLastUpdate(new Date())
        setLoading(false)
      } else if (msg.type === 'SYNC_COMPLETE') {
        // Force refresh on sync complete - this is the key fix!
        console.log('SYNC_COMPLETE received, forcing attacker refresh')
        fetchAttackers(true) // Force bypass rate limit
      } else if (msg.type === 'NEW_EVENT' || msg.type === 'ATTACKER_UPDATED') {
        // Refresh on new events or attacker updates
        console.log(`${msg.type} received, refreshing attackers`)
        fetchAttackers(true) // Force bypass rate limit
      }
    })

    return unsubscribe
  }, [subscribe, fetchAttackers])

  return {
    attackers,
    loading,
    lastUpdate,
    wsConnected,
    refresh: () => fetchAttackers(true)
  }
}