"use client"

import { Loader2, Play } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import type { BenchmarkConfig, RunSummary, ScenarioInfo, TargetStatus } from "@/lib/benchmark/types"
import { targetColor } from "./format"

type Props = {
  targets: TargetStatus[] | null
  config: BenchmarkConfig
  onConfigChange: (next: BenchmarkConfig) => void
  onRun: () => void
  running: boolean
  scenario: ScenarioInfo | null
  history: RunSummary[]
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
}

export function SetupCard({
  targets,
  config,
  onConfigChange,
  onRun,
  running,
  scenario,
  history,
  selectedRunId,
  onSelectRun,
}: Props) {
  const toggleTarget = (id: string, checked: boolean) => {
    const next = checked ? [...config.targetIds, id] : config.targetIds.filter((t) => t !== id)
    onConfigChange({ ...config, targetIds: next })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Side-by-side benchmark</CardTitle>
        <CardDescription>
          The same simulated attack is run at the same time against every selected target. The attacker is adaptive:
          it checks whether the host looks like a honeypot and leaves if it decides it does.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <Label className="text-sm font-semibold">Targets</Label>
          {targets === null ? (
            <p className="text-sm text-muted-foreground">Checking which targets the backend can reach…</p>
          ) : (
            targets.map((t) => (
              <label
                key={t.id}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-accent/30"
              >
                <Checkbox
                  checked={config.targetIds.includes(t.id)}
                  onCheckedChange={(v) => toggleTarget(t.id, v === true)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: targetColor(t.id) }} />
                    <span className="text-sm font-medium">{t.label}</span>
                    <Badge variant={t.reachable ? "secondary" : "destructive"} className="text-[10px]">
                      {t.reachable ? "reachable" : "unreachable"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {t.host}:{t.port}
                  </p>
                  {!t.reachable && <p className="mt-1 text-xs text-destructive">{t.note}</p>}
                </div>
              </label>
            ))
          )}
        </div>

        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
            <div>
              <Label htmlFor="adaptive" className="text-sm font-semibold">
                Adaptive attacker
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                On: leaves when it spots enough honeypot tells, so dwell time reflects how convincing each target is.
                Off: always runs the full chain (compares what each system records, not how believable it is).
              </p>
            </div>
            <Switch
              id="adaptive"
              checked={config.adaptive}
              onCheckedChange={(v) => onConfigChange({ ...config, adaptive: v })}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Suspicion threshold</Label>
              <span className="font-mono text-xs text-muted-foreground">{config.suspicionThreshold} tell(s)</span>
            </div>
            <Slider
              min={1}
              max={6}
              step={1}
              disabled={!config.adaptive}
              value={[config.suspicionThreshold]}
              onValueChange={(v) => onConfigChange({ ...config, suspicionThreshold: v[0] })}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Think time between commands</Label>
              <span className="font-mono text-xs text-muted-foreground">{config.thinkTimeMs} ms</span>
            </div>
            <Slider
              min={500}
              max={4000}
              step={100}
              value={[config.thinkTimeMs]}
              onValueChange={(v) => onConfigChange({ ...config, thinkTimeMs: v[0] })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="reps" className="text-sm">
                Repetitions
              </Label>
              <Input
                id="reps"
                type="number"
                min={1}
                max={10}
                value={config.repetitions}
                onChange={(e) =>
                  onConfigChange({ ...config, repetitions: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settle" className="text-sm">
                Telemetry wait (s)
              </Label>
              <Input
                id="settle"
                type="number"
                min={10}
                max={180}
                value={config.settleSeconds}
                onChange={(e) =>
                  onConfigChange({ ...config, settleSeconds: Math.min(180, Math.max(10, Number(e.target.value) || 90)) })
                }
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={onRun} disabled={running || config.targetIds.length === 0}>
              {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              {running ? "Running…" : "Run benchmark"}
            </Button>

            {history.length > 0 && (
              <Select value={selectedRunId ?? undefined} onValueChange={onSelectRun}>
                <SelectTrigger className="w-[260px]">
                  <SelectValue placeholder="Previous runs" />
                </SelectTrigger>
                <SelectContent>
                  {history.map((h) => (
                    <SelectItem key={h.runId} value={h.runId}>
                      {new Date(h.startedAt).toLocaleString()} · {h.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {scenario && (
            <p className="text-xs text-muted-foreground">
              Each target gets: a {scenario.reconPorts.length}-port scan, {scenario.wrongPasswordCount} wrong passwords then the
              real one, {scenario.probes.length + 1} honeypot checks, then {scenario.commands.length} kill-chain commands.
              Nothing destructive is run.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
