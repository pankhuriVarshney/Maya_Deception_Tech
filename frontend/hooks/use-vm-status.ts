"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSharedWebSocket } from "./use-shared-websocket"

export interface DockerContainer {
  id: string
  name: string
  image: string
  status: 'running' | 'exited' | 'paused'
  ports: string[]
  created: string
}

export interface VMStatus {
  name: string
  status: 'running' | 'stopped' | 'unknown'
  ip?: string
  lastSeen: Date
  crdtState?: {
    attackers: number
    credentials: number
    sessions: number
    hash: string
  }
  dockerContainers?: DockerContainer[]
}

type UseVMStatusResult = {
  vms: VMStatus[]
  loading: boolean
  error: string | null
  lastUpdate: Date | null
  wsConnected: boolean
  refresh: () => void
  runningCount: number
  stoppedCount: number
  totalAttackers: number
  totalCredentials: number
  totalSessions: number
  totalContainers: number
}

let globalFetchPromise: Promise<void> | null = null
let lastFetchTime = 0
const FETCH_COOLDOWN = 2000 // Reduced from 10000ms to 2000ms

export function useVMStatus(): UseVMStatusResult {
  const [vms, setVMs] = useState<VMStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const { connected: wsConnected, subscribe } = useSharedWebSocket()

  const fetchVMs = useCallback(async (force = false) => {
    // Allow force fetch bypassing rate limit
    if (!force && globalFetchPromise) {
      await globalFetchPromise
      return
    }

    // Only rate limit non-force requests
    const now = Date.now()
    if (!force && now - lastFetchTime < FETCH_COOLDOWN) {
      console.log('Rate limited (use-vm-status), skipping fetch')
      return
    }
    
    if (!force) {
      lastFetchTime = now
    }

    const fetchPromise = (async () => {
      try {
        setLoading(prev => vms.length === 0 ? true : prev)

        const res = await fetch("/api/vms", { 
          cache: "no-store",
          headers: { 'Pragma': 'no-cache' }
        })

        if (res.status === 429) {
          console.warn('Rate limited by backend')
          setError('Rate limited - retrying soon')
          return
        }

        if (!res.ok) throw new Error(`Failed: ${res.status}`)

        const json = await res.json()

        const parsedVMs = (json.vms || []).map((vm: any) => ({
          ...vm,
          lastSeen: new Date(vm.lastSeen || Date.now()),
        }))

        setVMs(parsedVMs)
        setLastUpdate(new Date())
        setError(null)
        console.log(`Fetched ${parsedVMs.length} VMs from backend`)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error")
      } finally {
        setLoading(false)
        globalFetchPromise = null
      }
    })()

    globalFetchPromise = fetchPromise
    await fetchPromise
  }, [vms.length])

  // Initial fetch
  useEffect(() => {
    fetchVMs()
  }, [fetchVMs])

  // WebSocket updates
  useEffect(() => {
    const unsubscribe = subscribe((msg) => {
      if (msg.type === 'SYNC_COMPLETE' || msg.type === 'INITIAL_STATE') {
        console.log('VM status hook: SYNC_COMPLETE received, forcing refresh')
        fetchVMs(true) // Force refresh
      }
    })

    return unsubscribe
  }, [subscribe, fetchVMs])

  const stats = useMemo(() => {
    const running = vms.filter(v => v.status === 'running').length
    const stopped = vms.filter(v => v.status === 'stopped').length
    const totalAttackers = vms.reduce((sum, v) => sum + (v.crdtState?.attackers || 0), 0)
    const totalCredentials = vms.reduce((sum, v) => sum + (v.crdtState?.credentials || 0), 0)
    const totalSessions = vms.reduce((sum, v) => sum + (v.crdtState?.sessions || 0), 0)
    const totalContainers = vms.reduce((sum, v) => sum + (v.dockerContainers?.length || 0), 0)

    return {
      runningCount: running,
      stoppedCount: stopped,
      totalAttackers,
      totalCredentials,
      totalSessions,
      totalContainers,
    }
  }, [vms])

  return {
    vms,
    loading,
    error,
    lastUpdate,
    wsConnected,
    refresh: () => fetchVMs(true),
    ...stats,
  }
}