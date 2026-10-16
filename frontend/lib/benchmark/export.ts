import { toCsv, type CsvCell } from "@/lib/export/download"
import type { RunSnapshot } from "@/lib/benchmark/types"

/** One row per metric: median / min / max and the 0-5 score for every target. */
export function runToCsv(run: RunSnapshot): string {
  const ids = run.targets.map((t) => t.id)
  const header: CsvCell[] = ["category", "metric_id", "metric", "unit", "better", "scored"]
  for (const id of ids) header.push(`${id}_median`, `${id}_min`, `${id}_max`, `${id}_score`)

  const rows: CsvCell[][] = [header]

  for (const cat of run.matrix?.categories ?? []) {
    for (const m of cat.metrics) {
      const row: CsvCell[] = [cat.name, m.id, m.name, m.unit, m.better, m.scored]
      for (const id of ids) {
        const agg = run.results[id]?.aggregate?.[m.id]
        row.push(agg?.median ?? null, agg?.min ?? null, agg?.max ?? null, m.scores[id] ?? null)
      }
      rows.push(row)
    }
  }

  if (run.matrix) {
    const composite: CsvCell[] = ["composite", "composite", "Weighted composite (0-5)", "score", "higher", true]
    const percent: CsvCell[] = ["composite", "composite_percent", "Weighted composite (% of max)", "%", "higher", true]
    for (const id of ids) {
      composite.push(null, null, null, run.matrix.composite[id] ?? null)
      percent.push(null, null, null, run.matrix.compositePercent[id] ?? null)
    }
    rows.push(composite, percent)
  }

  return toCsv(rows)
}
