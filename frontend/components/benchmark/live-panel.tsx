"use client"

import { Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { RunSnapshot } from "@/lib/benchmark/types"
import { clock, stageLabel, STEP_COLORS, targetColor } from "./format"

export function LivePanel({ run }: { run: RunSnapshot }) {
  const running = run.status === "running"
  const total = run.progress.totalRepetitions || 1
  const doneReps = Math.min(...run.targets.map((t) => run.results[t.id]?.repetitions.length ?? 0))
  const percent = run.status === "completed" ? 100 : Math.round((doneReps / total) * 100)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          {running && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          {running ? "Attack in progress" : run.status === "failed" ? "Run failed" : "Attack log"}
          <Badge variant="outline" className="font-mono text-[10px]">
            repetition {Math.max(run.progress.repetition, 1)}/{total}
          </Badge>
        </CardTitle>
        <Progress value={percent} className="mt-2 h-1.5" />
        {run.error && <p className="mt-2 text-sm text-destructive">{run.error}</p>}
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {run.targets.map((t) => {
          const events = run.log.filter((e) => e.targetId === t.id).slice(-60)
          return (
            <div key={t.id} className="rounded-lg border border-border">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: targetColor(t.id) }} />
                <span className="text-sm font-medium">{t.label}</span>
              </div>
              <ScrollArea className="h-56">
                <ul className="space-y-1 p-3">
                  {events.length === 0 && <li className="text-xs text-muted-foreground">waiting…</li>}
                  {events.map((e, i) => (
                    <li key={`${e.at}-${i}`} className="flex gap-2 text-xs">
                      <span className="shrink-0 font-mono text-muted-foreground">{clock(e.at)}</span>
                      <span className={`min-w-0 break-words ${STEP_COLORS[e.kind]}`}>
                        {e.kind === "command" ? <span className="font-mono">{e.text}</span> : e.text}
                        {e.kind !== "command" && (
                          <span className="ml-1 text-muted-foreground">[{stageLabel(e.stage)}]</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
