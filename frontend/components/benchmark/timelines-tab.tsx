"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Detection, RunSnapshot } from "@/lib/benchmark/types"
import { clock, formatValue, stageLabel, targetColor } from "./format"

export function TimelinesTab({ run }: { run: RunSnapshot }) {
  const maxReps = Math.max(1, ...run.targets.map((t) => run.results[t.id]?.repetitions.length ?? 0))
  const [rep, setRep] = useState(1)
  const repIndex = Math.min(rep, maxReps) - 1

  return (
    <div className="space-y-3">
      {maxReps > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Repetition</span>
          <Select value={String(repIndex + 1)} onValueChange={(v) => setRep(Number(v))}>
            <SelectTrigger className="w-[90px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: maxReps }, (_, i) => (
                <SelectItem key={i} value={String(i + 1)}>
                  {i + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {run.targets.map((t) => {
          const result = run.results[t.id]?.repetitions[repIndex]
          if (!result) {
            return (
              <Card key={t.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{t.label}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">No data for this repetition.</CardContent>
              </Card>
            )
          }

          const { record, observation, detections } = result
          const byIndex = new Map<number, Detection>(detections.map((d) => [d.commandIndex, d] as [number, Detection]))
          const failedProbes = record.probes.filter((p) => p.failed)

          return (
            <Card key={t.id} style={{ borderTopColor: targetColor(t.id), borderTopWidth: 3 }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t.label}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {record.commands.length} commands · {record.attempts.length} password attempts ·{" "}
                  {record.authAttemptsSent} logins
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {record.disengaged && (
                  <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">
                    {record.disengageReason}
                  </div>
                )}
                {record.error && (
                  <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">
                    {record.error}
                  </div>
                )}
                {failedProbes.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {failedProbes.map((p) => (
                      <Badge key={p.id} variant="destructive" className="text-[10px]" title={p.evidence}>
                        {p.id} {p.name}
                      </Badge>
                    ))}
                  </div>
                )}
                {!observation.available && (
                  <p className="text-xs text-muted-foreground">{observation.note}</p>
                )}

                <ol className="space-y-1.5">
                  {record.commands.map((c) => {
                    const d = byIndex.get(c.index)
                    return (
                      <li key={c.index} className="rounded-md bg-secondary/40 px-2.5 py-1.5">
                        <div className="flex items-start gap-2">
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{clock(c.sentAt)}</span>
                          <span className="min-w-0 flex-1 break-all font-mono text-xs">{c.command}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-[52px]">
                          <Badge variant="outline" className="text-[10px] font-normal">
                            {stageLabel(c.stage)}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{formatValue(c.durationMs, "ms")}</span>
                          {observation.available &&
                            (d ? (
                              <>
                                <Badge variant="secondary" className="text-[10px] font-normal">
                                  seen +{formatValue(d.latencyMs, "ms")}
                                </Badge>
                                {d.technique && (
                                  <Badge variant="outline" className="font-mono text-[10px]">
                                    {d.technique}
                                  </Badge>
                                )}
                                {d.dangerous && (
                                  <Badge variant="destructive" className="text-[10px]">
                                    Dangerous
                                  </Badge>
                                )}
                              </>
                            ) : (
                              <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                                not recorded
                              </Badge>
                            ))}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
