"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DashboardData, DashboardResponse } from "@/lib/dashboard/types"

type UseDashboardOptions = {
  pollIntervalMs?: number
}

type UseDashboardResult = {
  data: DashboardData | null
  isLoading: boolean
  error: string | null
  generatedAt: string | null
  refresh: () => void
}

export function useDashboard(options: UseDashboardOptions = {}): UseDashboardResult {
  const pollIntervalMs = options.pollIntervalMs ?? 5000

  const [data, setData] = useState<DashboardData | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  const inFlightRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const fetchDashboard = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true

    abortRef.current?.abort()
    const abortController = new AbortController()
    abortRef.current = abortController

    try {
      // Change this line in fetchDashboard
      const res = await fetch("/api/dashboard/stats", {  // Was: "/api/dashboard"
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: abortController.signal,
      })

      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`)
      }

      const json = (await res.json()) as DashboardResponse
      setData(json.data)
      setGeneratedAt(json.generatedAt)
      setError(null)
    } catch (e) {
      if ((e as Error).name === "AbortError") return
      setError(e instanceof Error ? e.message : "Unknown error")
    } finally {
      setIsLoading(false)
      inFlightRef.current = false
    }
  }, [])

  const refresh = useCallback(() => {
    setIsLoading((prev) => (data ? prev : true))
    void fetchDashboard()
  }, [data, fetchDashboard])

  useEffect(() => {
    void fetchDashboard()
    return () => abortRef.current?.abort()
  }, [fetchDashboard])

  useEffect(() => {
    if (pollIntervalMs <= 0) return

    let interval: number | null = null

    const start = () => {
      if (interval != null) return
      interval = window.setInterval(() => {
        if (document.visibilityState !== "visible") return
        void fetchDashboard()
      }, pollIntervalMs)
    }

    const stop = () => {
      if (interval == null) return
      window.clearInterval(interval)
      interval = null
    }

    start()
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") start()
      else stop()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      stop()
    }
  }, [fetchDashboard, pollIntervalMs])

  return useMemo(
    () => ({ data, isLoading, error, generatedAt, refresh }),
    [data, isLoading, error, generatedAt, refresh]
  )
}
