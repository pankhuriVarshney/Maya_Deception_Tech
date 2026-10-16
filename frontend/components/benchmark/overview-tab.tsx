"use client"

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { RunSnapshot } from "@/lib/benchmark/types"
import { formatValue, targetColor } from "./format"

function outcomeOf(run: RunSnapshot, id: string): { text: string; bad: boolean } {
  const reps = run.results[id]?.repetitions ?? []
  if (reps.length === 0) return { text: "no data", bad: false }
  const errored = reps.find((r) => r.record.error)
  if (errored) return { text: `Error: ${errored.record.error}`, bad: true }
  const left = reps.filter((r) => r.record.disengaged).length
  if (left === 0) return { text: "Ran the full attack chain", bad: false }
  return { text: `Left early in ${left} of ${reps.length} run(s)`, bad: true }
}

export function OverviewTab({ run }: { run: RunSnapshot }) {
  const matrix = run.matrix
  if (!matrix) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Results appear when the run completes.</p>
  }

  const dwellData = run.targets.map((t) => {
    const agg = run.results[t.id]?.aggregate ?? {}
    return {
      name: t.label,
      attacker: agg.C1?.median ?? 0,
      defender: agg.C1d?.median ?? 0,
    }
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {run.targets.map((t) => {
          const agg = run.results[t.id]?.aggregate ?? {}
          const outcome = outcomeOf(run, t.id)
          const percent = matrix.compositePercent[t.id]
          return (
            <Card key={t.id} style={{ borderTopColor: targetColor(t.id), borderTopWidth: 3 }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t.label}</CardTitle>
                <CardDescription className="font-mono text-xs">
                  {t.host}:{t.port}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Composite score</p>
                    <p className="text-3xl font-semibold">{percent === null || percent === undefined ? "—" : `${Math.round(percent)}%`}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Attacker dwell time</p>
                    <p className="text-xl font-semibold">{formatValue(agg.C1?.median, "s")}</p>
                  </div>
                </div>
                <Badge variant={outcome.bad ? "destructive" : "secondary"} className="whitespace-normal text-xs font-normal">
                  {outcome.text}
                </Badge>
                <p className="text-xs text-muted-foreground">
                  Defender recorded {formatValue(agg.A1?.median, "ratio")} of the commands sent.
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Dwell time</CardTitle>
          <CardDescription>
            Attacker-side is measured by the attacker itself (first authenticated session to its last action or the moment
            it left). Defender-observed is what the target&apos;s own telemetry reports, and is zero where nothing is recorded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dwellData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 30%, 20%)" />
                <XAxis dataKey="name" tick={{ fill: "hsl(215, 20%, 55%)", fontSize: 11 }} />
                <YAxis tick={{ fill: "hsl(215, 20%, 55%)", fontSize: 11 }} unit=" s" />
                <Tooltip
                  contentStyle={{
                    background: "hsl(222, 47%, 11%)",
                    border: "1px solid hsl(222, 30%, 20%)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v) => `${Number(v).toFixed(1)} s`}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="attacker" name="Attacker-side" fill="hsl(187, 80%, 48%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="defender" name="Defender-observed" fill="hsl(38, 92%, 50%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Metrics</CardTitle>
          <CardDescription>
            Median across repetitions (range shown when they differ). The best score on each scored row is highlighted.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[240px]">Metric</TableHead>
                {run.targets.map((t) => (
                  <TableHead key={t.id} className="text-right">
                    {t.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrix.categories
                .filter((c) => c.metrics.length > 0)
                .map((cat) => (
                  <MetricRows key={cat.id} run={run} categoryId={cat.id} />
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function MetricRows({ run, categoryId }: { run: RunSnapshot; categoryId: string }) {
  const matrix = run.matrix
  const cat = matrix?.categories.find((c) => c.id === categoryId)
  if (!matrix || !cat) return null

  return (
    <>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableCell colSpan={run.targets.length + 1} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {cat.name} · weight {cat.weight}
        </TableCell>
      </TableRow>
      {cat.metrics.map((m) => {
        const scored = run.targets.map((t) => m.scores[t.id]).filter((s): s is number => s !== null)
        const best = scored.length > 1 ? Math.max(...scored) : null
        const allEqual = scored.length > 1 && scored.every((s) => s === scored[0])
        return (
          <TableRow key={m.id}>
            <TableCell>
              <span className="font-mono text-xs text-muted-foreground">{m.id}</span>{" "}
              <span className="text-sm">{m.name}</span>
              {!m.scored && <span className="ml-2 text-xs text-muted-foreground">(informational)</span>}
            </TableCell>
            {run.targets.map((t) => {
              const agg = run.results[t.id]?.aggregate?.[m.id]
              const score = m.scores[t.id]
              const isBest = best !== null && !allEqual && score !== null && score === best
              const range =
                agg && agg.n > 1 && agg.min !== null && agg.max !== null && agg.min !== agg.max
                  ? `${formatValue(agg.min, m.unit)} – ${formatValue(agg.max, m.unit)}`
                  : null
              return (
                <TableCell key={t.id} className={`text-right ${isBest ? "font-semibold text-emerald-500" : ""}`}>
                  {formatValue(m.values[t.id], m.unit)}
                  {range && <div className="text-[10px] font-normal text-muted-foreground">{range}</div>}
                </TableCell>
              )
            })}
          </TableRow>
        )
      })}
    </>
  )
}
