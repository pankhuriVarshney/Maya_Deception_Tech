"use client"

import { useCallback, useEffect, useState } from "react"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { runToCsv } from "@/lib/benchmark/export"
import type {
  BenchmarkConfig,
  RunSnapshot,
  RunSummary,
  ScenarioInfo,
  TargetStatus,
} from "@/lib/benchmark/types"
import { downloadBlob, timestampForFilename } from "@/lib/export/download"
import { FingerprintTab } from "./fingerprint-tab"
import { LivePanel } from "./live-panel"
import { MatrixTab } from "./matrix-tab"
import { OverviewTab } from "./overview-tab"
import { SetupCard } from "./setup-card"
import { TimelinesTab } from "./timelines-tab"

const DEFAULT_CONFIG: BenchmarkConfig = {
  targetIds: ["maya", "cowrie", "control"],
  repetitions: 1,
  adaptive: true,
  suspicionThreshold: 2,
  thinkTimeMs: 1500,
  settleSeconds: 90,
}

async function getJson<T>(url: string): Promise<{ success: boolean; data?: T; activeRunId?: string | null; error?: string }> {
  const res = await fetch(url)
  return res.json()
}

export function BenchmarkContainer() {
  const { toast } = useToast()
  const [targets, setTargets] = useState<TargetStatus[] | null>(null)
  const [scenario, setScenario] = useState<ScenarioInfo | null>(null)
  const [history, setHistory] = useState<RunSummary[]>([])
  const [config, setConfig] = useState<BenchmarkConfig>(DEFAULT_CONFIG)
  const [runId, setRunId] = useState<string | null>(null)
  const [run, setRun] = useState<RunSnapshot | null>(null)
  const [starting, setStarting] = useState(false)

  const loadHistory = useCallback(async () => {
    try {
      const json = await getJson<RunSummary[]>("/api/benchmark/runs")
      if (json.success && json.data) setHistory(json.data)
    } catch {
      // history is a convenience; the page works without it
    }
  }, [])

  // Initial load: which targets exist, what the attack is, past runs, and any run already in flight.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [t, s] = await Promise.all([
          getJson<TargetStatus[]>("/api/benchmark/targets"),
          getJson<ScenarioInfo>("/api/benchmark/scenario"),
        ])
        if (cancelled) return
        if (t.success && t.data) {
          setTargets(t.data)
          // Default to the targets that are actually up.
          const up = t.data.filter((x) => x.reachable).map((x) => x.id)
          if (up.length > 0) setConfig((c) => ({ ...c, targetIds: up }))
          if (t.activeRunId) setRunId(t.activeRunId)
        } else {
          setTargets([])
        }
        if (s.success && s.data) setScenario(s.data)
      } catch {
        if (!cancelled) setTargets([])
      }
      void loadHistory()
    })()
    return () => {
      cancelled = true
    }
  }, [loadHistory])

  // Poll the run until it finishes. Polling (not the websocket) so progress shows even if the socket is down.
  useEffect(() => {
    if (!runId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      try {
        const json = await getJson<RunSnapshot>(`/api/benchmark/runs/${runId}`)
        if (cancelled) return
        if (json.success && json.data) {
          setRun(json.data)
          if (json.data.status === "running") {
            timer = setTimeout(tick, 1500)
          } else {
            void loadHistory()
          }
          return
        }
        timer = setTimeout(tick, 3000)
      } catch {
        if (!cancelled) timer = setTimeout(tick, 3000)
      }
    }
    void tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [runId, loadHistory])

  const startRun = async () => {
    setStarting(true)
    try {
      const res = await fetch("/api/benchmark/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets: config.targetIds,
          repetitions: config.repetitions,
          adaptive: config.adaptive,
          suspicionThreshold: config.suspicionThreshold,
          thinkTimeMs: config.thinkTimeMs,
          settleSeconds: config.settleSeconds,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || `Request failed (${res.status})`)
      setRun(null)
      setRunId(json.data.runId)
      toast({ title: "Benchmark started", description: `Run ${json.data.runId}` })
    } catch (error) {
      toast({
        title: "Could not start the benchmark",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setStarting(false)
    }
  }

  const exportJson = () => {
    if (!run) return
    downloadBlob(
      new Blob([JSON.stringify(run, null, 2)], { type: "application/json" }),
      `benchmark-${run.runId}-${timestampForFilename()}.json`,
    )
  }

  const exportCsv = () => {
    if (!run) return
    downloadBlob(
      new Blob([runToCsv(run)], { type: "text/csv;charset=utf-8" }),
      `benchmark-${run.runId}-${timestampForFilename()}.csv`,
    )
  }

  const running = starting || run?.status === "running"

  return (
    <div className="space-y-4">
      <SetupCard
        targets={targets}
        config={config}
        onConfigChange={setConfig}
        onRun={startRun}
        running={running}
        scenario={scenario}
        history={history}
        selectedRunId={runId}
        onSelectRun={(id) => {
          setRun(null)
          setRunId(id)
        }}
      />

      {run && <LivePanel run={run} />}

      {run && run.status === "completed" && (
        <Tabs defaultValue="overview" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="timelines">Timelines</TabsTrigger>
              <TabsTrigger value="fingerprint">Fingerprint</TabsTrigger>
              <TabsTrigger value="matrix">Matrix</TabsTrigger>
              <TabsTrigger value="raw">Raw</TabsTrigger>
            </TabsList>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportJson}>
                <Download className="mr-2 h-4 w-4" />
                JSON
              </Button>
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download className="mr-2 h-4 w-4" />
                CSV
              </Button>
            </div>
          </div>

          <TabsContent value="overview">
            <OverviewTab run={run} />
          </TabsContent>
          <TabsContent value="timelines">
            <TimelinesTab run={run} />
          </TabsContent>
          <TabsContent value="fingerprint">
            <FingerprintTab run={run} scenario={scenario} />
          </TabsContent>
          <TabsContent value="matrix">
            <MatrixTab run={run} />
          </TabsContent>
          <TabsContent value="raw">
            <pre className="max-h-[560px] overflow-auto rounded-lg border border-border bg-card p-4 text-xs">
              {JSON.stringify({ ...run, log: `${run.log.length} events (see JSON export)` }, null, 2)}
            </pre>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
