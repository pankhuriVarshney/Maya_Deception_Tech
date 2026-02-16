"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { AttackerSummary } from "@/types"

type UseAttackersListResult = {
  loading: boolean
  data: AttackerSummary[] | null
  error: unknown
  refresh: () => void
}

export function useAttackersList(initialData?: AttackerSummary[] | null): UseAttackersListResult {
  const [data, setData] = useState<AttackerSummary[] | null>(initialData ?? null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState<boolean>(initialData == null)

  const inFlightRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const fetchList = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true

    abortRef.current?.abort()
    const abortController = new AbortController()
    abortRef.current = abortController

    try {
      const res = await fetch("/api/dashboard/active-attackers", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: abortController.signal,
      })

      if (!res.ok) throw new Error(`Request failed: ${res.status}`)
      
      // FIX: Extract data from response wrapper
      const json = await res.json() as { success: boolean; data: AttackerSummary[]; count: number }
      setData(json.data) // <-- Extract the array from json.data
      
      setError(null)
    } catch (e) {
      if ((e as Error).name === "AbortError") return
      setError(e)
    } finally {
      setLoading(false)
      inFlightRef.current = false
    }
  }, [])

  const refresh = useCallback(() => {
    setLoading((prev) => (data ? prev : true))
    void fetchList()
  }, [data, fetchList])

  useEffect(() => {
    void fetchList()
    return () => abortRef.current?.abort()
  }, [fetchList])

  return useMemo(() => ({ loading, data, error, refresh }), [loading, data, error, refresh])
}

export const useDashboardList = useAttackersList