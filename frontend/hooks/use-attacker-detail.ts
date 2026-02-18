"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { AttackerDetails } from "@/types"
import { useSharedWebSocket } from "./use-shared-websocket"

type UseAttackerDetailResult = {
  loading: boolean
  data: AttackerDetails | null
  error: unknown
  refresh: () => void
}

export function useAttackerDetail(
  id: string | null,
  initialData?: AttackerDetails | null
): UseAttackerDetailResult {
  const initialForId = id && initialData?.id === id ? initialData : null
  const [data, setData] = useState<AttackerDetails | null>(initialForId)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState<boolean>(!initialForId)
  const { connected: wsConnected, subscribe } = useSharedWebSocket()

  const inFlightRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const prevIdRef = useRef<string | null>(null)

  const fetchDetail = useCallback(async (force = false) => {
    if (!id) return
    if (!force && inFlightRef.current) return
    inFlightRef.current = true

    abortRef.current?.abort()
    const abortController = new AbortController()
    abortRef.current = abortController

    const url = `/api/dashboard/attacker/${encodeURIComponent(id)}`

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { 
          Accept: "application/json",
          'Pragma': 'no-cache',
        },
        cache: "no-store",
        signal: abortController.signal,
      })

      if (!res.ok) throw new Error(`Request failed: ${res.status}`)

      const json = await res.json() as { success: boolean; data: AttackerDetails }
      
      if (!json.success || !json.data) {
        throw new Error('No data received')
      }

      setData(json.data)
      console.log(`Fetched attacker details for ${id}:`, json.data.attacker)
      setError(null)
    } catch (e) {
      if ((e as Error).name === "AbortError") return
      console.error('Error fetching attacker details:', e)
      setError(e)
    } finally {
      setLoading(false)
      inFlightRef.current = false
    }
  }, [id])

  const refresh = useCallback(() => {
    setLoading(true)
    void fetchDetail(true)
  }, [fetchDetail])

  useEffect(() => {
    const prevId = prevIdRef.current
    prevIdRef.current = id

    if (!id) {
      abortRef.current?.abort()
      setLoading(false)
      setData(null)
      setError(null)
      return
    }

    if (prevId !== null && prevId !== id) {
      setLoading(true)
      setData(null)
    } else if (!initialForId) {
      setLoading(true)
    }

    setError(null)
    void fetchDetail(true)
    return () => abortRef.current?.abort()
  }, [fetchDetail, id, initialForId])

  // WebSocket updates for real-time attacker data
  useEffect(() => {
    if (!id) return

    const unsubscribe = subscribe((msg) => {
      console.log('useAttackerDetail received:', msg.type, msg.data?.attackerId)
      
      // Refresh if this attacker was updated
      if (msg.type === 'ATTACKER_UPDATED' && msg.data?.attackerId === id) {
        console.log('Attacker updated via WebSocket, refreshing...')
        fetchDetail(true)
      }
      
      // Also refresh on sync complete or new events
      if (msg.type === 'SYNC_COMPLETE' || msg.type === 'NEW_EVENT') {
        // Check if the event is related to this attacker
        const isRelated = msg.data?.attackerId === id || 
                         msg.data?.data?.attackerId === id
        if (isRelated) {
          console.log('Related event detected, refreshing attacker...')
          fetchDetail(true)
        }
      }
    })

    return unsubscribe
  }, [id, subscribe, fetchDetail])

  return useMemo(() => ({ loading, data, error, refresh }), [loading, data, error, refresh])
}