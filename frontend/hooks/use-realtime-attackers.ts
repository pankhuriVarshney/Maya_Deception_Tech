"use client"

import { useEffect, useState, useCallback } from "react"
import { useSharedWebSocket } from "./use-shared-websocket"
import type { AttackerSummary } from "@/types"

let globalFetchPromise: Promise<void> | null = null
let lastFetchTime = 0

export function useRealtimeAttackers() {
  const [attackers, setAttackers] = useState<AttackerSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const { connected: wsConnected, subscribe } = useSharedWebSocket()

  const fetchAttackers = useCallback(async () => {
    // Deduplicate requests
    if (globalFetchPromise) {
      await globalFetchPromise
      return
    }

    // Rate limit: max once every 10 seconds
    const now = Date.now()
    if (now - lastFetchTime < 10000) return
    lastFetchTime = now

    const fetchPromise = (async () => {
      try {
        setLoading(prev => attackers.length === 0 ? true : prev)
        
        const res = await fetch("/api/dashboard/active-attackers", { cache: "no-store" })

        if (res.status === 429) {
          console.warn('Rate limited')
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
        
        setAttackers(data)
        setLastUpdate(new Date())
      } catch (e) {
        console.error("Failed to fetch attackers:", e)
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
      console.log('Attachers hook received:', msg.type)
      
      if (msg.type === 'INITIAL_STATE' && msg.data?.activeAttackers) {
        const validAttackers = (msg.data.activeAttackers || []).map((a: any) => ({
          ...a,
          threatConfidence: typeof a.threatConfidence === 'number' ? a.threatConfidence : 0,
        }))
        setAttackers(validAttackers)
        setLastUpdate(new Date())
        setLoading(false)
      } else if (['NEW_EVENT', 'ATTACKER_UPDATED', 'SYNC_COMPLETE'].includes(msg.type)) {
        fetchAttackers()
      }
    })
    
    return unsubscribe
  }, [subscribe, fetchAttackers])

  return { 
    attackers, 
    loading, 
    lastUpdate, 
    wsConnected, 
    refresh: fetchAttackers 
  }
}