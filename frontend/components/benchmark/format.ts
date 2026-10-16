import type { RunTarget, StepKind } from "@/lib/benchmark/types"

export function formatValue(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  switch (unit) {
    case "ratio":
      return `${Math.round(value * 100)}%`
    case "ms":
      return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`
    case "s":
      return `${value.toFixed(1)} s`
    default:
      return Number.isInteger(value) ? String(value) : value.toFixed(1)
  }
}

const TARGET_COLORS: Record<string, string> = {
  maya: "hsl(187, 80%, 48%)",
  cowrie: "hsl(38, 92%, 50%)",
  control: "hsl(215, 20%, 60%)",
}

export function targetColor(id: string): string {
  return TARGET_COLORS[id] ?? "hsl(142, 71%, 45%)"
}

export function targetLabel(targets: RunTarget[], id: string): string {
  return targets.find((t) => t.id === id)?.label ?? id
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour12: false })
}

export const STEP_COLORS: Record<StepKind, string> = {
  info: "text-muted-foreground",
  command: "text-foreground",
  probe: "text-amber-500",
  disengage: "text-red-500",
  error: "text-red-500",
}

export function stageLabel(stage: string): string {
  return stage.replace(/_/g, " ")
}
