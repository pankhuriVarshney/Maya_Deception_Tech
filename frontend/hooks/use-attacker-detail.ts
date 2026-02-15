"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { AttackerDetails } from "@/types"

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

  const inFlightRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const prevIdRef = useRef<string | null>(null)

  const fetchDetail = useCallback(async () => {
    if (!id) return
    if (inFlightRef.current) return
    inFlightRef.current = true

    abortRef.current?.abort()
    const abortController = new AbortController()
    abortRef.current = abortController

    const url = `/api/attacker/${encodeURIComponent(id)}`

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: abortController.signal,
      })

      if (!res.ok) throw new Error(`Request failed: ${res.status}`)
      const json = (await res.json()) as AttackerDetails
      setData(json)
      setError(null)
    } catch (e) {
      if ((e as Error).name === "AbortError") return
      setError(e)
    } finally {
      setLoading(false)
      inFlightRef.current = false
    }
  }, [id])

  const refresh = useCallback(() => {
    setLoading((prev) => (data ? prev : true))
    void fetchDetail()
  }, [data, fetchDetail])

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

    // Only reset state on a real id change. On initial mount, we keep any server-provided initialData.
    if (prevId !== null && prevId !== id) {
      setLoading(true)
      setData(null)
    } else if (!initialForId) {
      setLoading(true)
    }

    setError(null)
    void fetchDetail()
    return () => abortRef.current?.abort()
  }, [fetchDetail, id, initialForId])

  return useMemo(() => ({ loading, data, error, refresh }), [loading, data, error, refresh])
}
