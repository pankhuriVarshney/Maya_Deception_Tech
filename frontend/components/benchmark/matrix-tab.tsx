"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { RunSnapshot } from "@/lib/benchmark/types"
import { formatValue, targetColor } from "./format"

function ScoreBar({ score, color }: { score: number | null; color: string }) {
  if (score === null) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full" style={{ width: `${(score / 5) * 100}%`, background: color }} />
      </div>
      <span className="w-8 text-right font-mono text-xs">{score.toFixed(1)}</span>
    </div>
  )
}

export function MatrixTab({ run }: { run: RunSnapshot }) {
  const matrix = run.matrix
  if (!matrix) {
    return <p className="py-8 text-center text-sm text-muted-foreground">The scored matrix appears when the run completes.</p>
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Evaluation matrix</CardTitle>
          <CardDescription>
            Scores are 0-5, relative to the best result on each metric. Categories carry the weights from
            docs/EVALUATION.md; only categories with measured metrics count toward the composite, and the unprotected
            host is scored like the others so it shows the realism ceiling and the visibility floor.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[260px]">Category / metric</TableHead>
                {run.targets.map((t) => (
                  <TableHead key={t.id} className="text-right">
                    {t.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrix.categories.map((cat) => (
                <CategoryRows key={cat.id} run={run} categoryId={cat.id} />
              ))}
              <TableRow className="border-t-2">
                <TableCell className="font-semibold">Composite (weighted, 0-5)</TableCell>
                {run.targets.map((t) => (
                  <TableCell key={t.id} className="text-right">
                    <span className="text-lg font-semibold" style={{ color: targetColor(t.id) }}>
                      {matrix.composite[t.id] === null || matrix.composite[t.id] === undefined
                        ? "—"
                        : (matrix.composite[t.id] as number).toFixed(2)}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {matrix.compositePercent[t.id] === null || matrix.compositePercent[t.id] === undefined
                        ? ""
                        : `${Math.round(matrix.compositePercent[t.id] as number)}%`}
                    </span>
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Not measured by this harness</CardTitle>
          <CardDescription>
            Listed in docs/EVALUATION.md but excluded from the composite, so nothing here is guessed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm md:grid-cols-2">
            {matrix.notMeasured.map((m) => (
              <li key={m.id} className="flex gap-2">
                <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">{m.id}</span>
                <span>
                  {m.name} <span className="text-xs text-muted-foreground">({m.reason})</span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function CategoryRows({ run, categoryId }: { run: RunSnapshot; categoryId: string }) {
  const cat = run.matrix?.categories.find((c) => c.id === categoryId)
  if (!cat) return null

  return (
    <>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableCell className="text-sm font-semibold">
          {cat.name} <span className="text-xs font-normal text-muted-foreground">· weight {cat.weight}</span>
          {!cat.measured && <span className="ml-2 text-xs font-normal text-muted-foreground">(no metrics measured here)</span>}
        </TableCell>
        {run.targets.map((t) => (
          <TableCell key={t.id} className="text-right">
            <ScoreBar score={cat.scores[t.id] ?? null} color={targetColor(t.id)} />
          </TableCell>
        ))}
      </TableRow>
      {cat.metrics
        .filter((m) => m.scored)
        .map((m) => (
          <TableRow key={m.id}>
            <TableCell className="pl-6">
              <span className="font-mono text-xs text-muted-foreground">{m.id}</span>{" "}
              <span className="text-sm">{m.name}</span>
              <span className="ml-1 text-xs text-muted-foreground">({m.better} is better)</span>
            </TableCell>
            {run.targets.map((t) => (
              <TableCell key={t.id} className="text-right">
                <div className="text-xs text-muted-foreground">{formatValue(m.values[t.id], m.unit)}</div>
                <ScoreBar score={m.scores[t.id] ?? null} color={targetColor(t.id)} />
              </TableCell>
            ))}
          </TableRow>
        ))}
    </>
  )
}
