// Scores the matrix described in docs/EVALUATION.md section 5. Only metrics
// this harness can actually measure are scored; everything else is listed as
// not measured and left out of the composite rather than guessed.

export type MetricCategoryId = 'A' | 'B' | 'C';

export interface MetricDef {
  id: string;
  name: string;
  category: MetricCategoryId;
  better: 'higher' | 'lower';
  unit: string;
  scored: boolean;
}

export const METRIC_DEFS: MetricDef[] = [
  { id: 'A1', name: 'Command capture recall', category: 'A', better: 'higher', unit: 'ratio', scored: true },
  { id: 'A2', name: 'Session count accuracy', category: 'A', better: 'higher', unit: 'ratio', scored: true },
  { id: 'A4', name: 'Login telemetry (recorded / sent)', category: 'A', better: 'higher', unit: 'ratio', scored: true },
  { id: 'A5', name: 'Detection latency (median)', category: 'A', better: 'lower', unit: 'ms', scored: true },
  { id: 'A7', name: 'Attacker attribution (true source IP)', category: 'A', better: 'higher', unit: 'ratio', scored: true },
  { id: 'B1', name: 'MITRE tagging accuracy', category: 'B', better: 'higher', unit: 'ratio', scored: true },
  { id: 'B1c', name: 'MITRE non-fallback coverage', category: 'B', better: 'higher', unit: 'ratio', scored: true },
  { id: 'B3', name: 'Dangerous-command recall', category: 'B', better: 'higher', unit: 'ratio', scored: true },
  { id: 'B3f', name: 'Benign commands flagged dangerous', category: 'B', better: 'lower', unit: 'ratio', scored: true },
  { id: 'C1', name: 'Dwell time (attacker-side)', category: 'C', better: 'higher', unit: 's', scored: true },
  { id: 'C1d', name: 'Dwell time (defender-observed)', category: 'C', better: 'higher', unit: 's', scored: false },
  { id: 'C2', name: 'Engagement depth (labeled commands run)', category: 'C', better: 'higher', unit: 'count', scored: true },
  { id: 'C3', name: 'Fingerprint resistance', category: 'C', better: 'higher', unit: 'ratio', scored: true },
  { id: 'C4', name: 'Output fidelity', category: 'C', better: 'higher', unit: 'ratio', scored: true },
  { id: 'C5', name: 'Monitoring artifacts visible', category: 'C', better: 'lower', unit: 'count', scored: true },
];

export const CATEGORY_DEFS: Array<{ id: string; name: string; weight: number }> = [
  { id: 'A', name: 'Telemetry fidelity', weight: 25 },
  { id: 'B', name: 'Intelligence quality', weight: 20 },
  { id: 'C', name: 'Deception effectiveness', weight: 25 },
  { id: 'D', name: 'Containment and integrity', weight: 15 },
  { id: 'E', name: 'Operations', weight: 15 },
];

export const NOT_MEASURED: Array<{ id: string; name: string; reason: string }> = [
  { id: 'A3', name: 'Command history completeness', reason: 'qualitative' },
  { id: 'A6', name: 'Artifact capture', reason: 'Maya has no file capture; checklist item' },
  { id: 'A8', name: 'Telemetry durability', reason: 'needs a pod-recreation test' },
  { id: 'B2', name: 'Technique coverage breadth', reason: 'static count, not a run result' },
  { id: 'B4', name: 'False-flag rate on a benign corpus', reason: 'needs a labeled benign corpus' },
  { id: 'B5', name: 'Cross-decoy correlation', reason: 'needs two decoys attacked in one run' },
  { id: 'B6', name: 'Kill-chain stage attribution', reason: 'not scored yet' },
  { id: 'D1', name: 'Isolation strength', reason: 'checklist, not a run result' },
  { id: 'D2', name: 'Egress containment', reason: 'needs outbound probes' },
  { id: 'D3', name: 'Telemetry tamper resistance', reason: 'would inject forged telemetry; not run here' },
  { id: 'E1', name: 'Resource footprint', reason: 'needs docker/kubectl stats' },
  { id: 'E2', name: 'Deploy / recover time', reason: 'not part of an attack run' },
  { id: 'E3', name: 'Setup effort', reason: 'qualitative' },
  { id: 'E4', name: 'Ingest robustness', reason: 'needs a load test' },
  { id: 'E5', name: 'Operator UX', reason: 'qualitative' },
];

export interface MatrixMetricRow {
  id: string;
  name: string;
  unit: string;
  better: 'higher' | 'lower';
  scored: boolean;
  values: Record<string, number | null>;
  scores: Record<string, number | null>;
}

export interface MatrixCategory {
  id: string;
  name: string;
  weight: number;
  measured: boolean;
  scores: Record<string, number | null>;
  metrics: MatrixMetricRow[];
}

export interface MatrixResult {
  targetIds: string[];
  categories: MatrixCategory[];
  composite: Record<string, number | null>;
  compositePercent: Record<string, number | null>;
  notMeasured: Array<{ id: string; name: string; reason: string }>;
}

/** 0-5, relative to the best value any target achieved. */
export function normalise(value: number, best: number, better: 'higher' | 'lower'): number {
  if (better === 'higher') return best > 0 ? Math.min(5, (5 * value) / best) : 0;
  if (value === 0) return 5;
  return best >= 0 ? Math.min(5, (5 * best) / value) : 0;
}

/**
 * @param perTarget metric id -> value, per target id (already medianed over repetitions)
 */
export function scoreMatrix(perTarget: Record<string, Record<string, number | null>>): MatrixResult {
  const targetIds = Object.keys(perTarget);

  const rows: MatrixMetricRow[] = METRIC_DEFS.map(def => {
    const values: Record<string, number | null> = {};
    for (const t of targetIds) {
      const v = perTarget[t][def.id];
      values[t] = typeof v === 'number' ? v : null;
    }

    const present = targetIds.map(t => values[t]).filter((v): v is number => v !== null);
    const best = present.length === 0 ? 0 : def.better === 'higher' ? Math.max(...present) : Math.min(...present);

    const scores: Record<string, number | null> = {};
    for (const t of targetIds) {
      const v = values[t];
      scores[t] = def.scored && v !== null ? normalise(v, best, def.better) : null;
    }
    return { id: def.id, name: def.name, unit: def.unit, better: def.better, scored: def.scored, values, scores };
  });

  const categories: MatrixCategory[] = CATEGORY_DEFS.map(cat => {
    const metrics = rows.filter(r => METRIC_DEFS.find(d => d.id === r.id)?.category === cat.id);
    const scores: Record<string, number | null> = {};
    for (const t of targetIds) {
      const vals = metrics.map(m => m.scores[t]).filter((v): v is number => v !== null);
      scores[t] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    return { id: cat.id, name: cat.name, weight: cat.weight, measured: metrics.some(m => m.scored), scores, metrics };
  });

  const measured = categories.filter(c => c.measured);
  const weightSum = measured.reduce((a, c) => a + c.weight, 0);

  const composite: Record<string, number | null> = {};
  const compositePercent: Record<string, number | null> = {};
  for (const t of targetIds) {
    if (weightSum === 0) {
      composite[t] = null;
      compositePercent[t] = null;
      continue;
    }
    const total = measured.reduce((a, c) => a + c.weight * (c.scores[t] ?? 0), 0) / weightSum;
    composite[t] = total;
    compositePercent[t] = (total / 5) * 100;
  }

  return { targetIds, categories, composite, compositePercent, notMeasured: NOT_MEASURED };
}
