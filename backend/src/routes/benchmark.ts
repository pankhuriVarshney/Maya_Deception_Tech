import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { BenchmarkService, loadTargets } from '../services/benchmark/BenchmarkService';
import { PROBES } from '../services/benchmark/probes';
import { RECON_PORTS, SCENARIO_COMMANDS, STAGE_LABELS, WRONG_PASSWORDS } from '../services/benchmark/scenario';
import { CATEGORY_DEFS, METRIC_DEFS, NOT_MEASURED } from '../services/benchmark/scoring';
import { BenchmarkConfig, STAGE_ORDER } from '../services/benchmark/types';

const router = Router();
const benchmark = new BenchmarkService();

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Which targets exist and whether the backend can reach them right now.
router.get('/targets', asyncHandler(async (_req: Request, res: Response) => {
  const targets = await benchmark.getTargetStatus();
  res.json({
    success: true,
    data: targets,
    activeRunId: benchmark.getActiveRunId(),
    timestamp: new Date().toISOString(),
  });
}));

// What every target is subjected to, so the UI can show it before a run.
router.get('/scenario', asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      stages: STAGE_ORDER.map(id => ({ id, label: STAGE_LABELS[id] })),
      reconPorts: RECON_PORTS,
      wrongPasswordCount: WRONG_PASSWORDS.length,
      commands: SCENARIO_COMMANDS,
      probes: PROBES.map(p => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        description: p.description,
        commands: p.commands,
      })),
      metrics: METRIC_DEFS,
      categories: CATEGORY_DEFS,
      notMeasured: NOT_MEASURED,
    },
    timestamp: new Date().toISOString(),
  });
}));

router.post('/runs', asyncHandler(async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const known = loadTargets().map(t => t.id);

  const requested: string[] = Array.isArray(body.targets)
    ? body.targets.filter((t: unknown): t is string => typeof t === 'string' && known.includes(t))
    : known;
  if (requested.length === 0) {
    return res.status(400).json({
      success: false,
      error: `Select at least one target (${known.join(', ')})`,
      timestamp: new Date().toISOString(),
    });
  }

  const config: BenchmarkConfig = {
    targetIds: requested,
    repetitions: clampInt(body.repetitions, 1, 1, 10),
    adaptive: body.adaptive !== false,
    suspicionThreshold: clampInt(body.suspicionThreshold, 2, 1, 6),
    thinkTimeMs: clampInt(body.thinkTimeMs, 1500, 200, 5000),
    settleSeconds: clampInt(body.settleSeconds, 90, 10, 180),
  };

  try {
    const run = await benchmark.startRun(config);
    res.status(202).json({
      success: true,
      data: { runId: run.runId, status: run.status },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('still running') ? 409 : 400;
    res.status(status).json({ success: false, error: message, timestamp: new Date().toISOString() });
  }
}));

router.get('/runs', asyncHandler(async (_req: Request, res: Response) => {
  const runs = await benchmark.listRuns();
  res.json({ success: true, data: runs, timestamp: new Date().toISOString() });
}));

router.get('/runs/:id', asyncHandler(async (req: Request, res: Response) => {
  const run = await benchmark.getRun(req.params.id);
  if (!run) {
    return res.status(404).json({
      success: false,
      error: `Benchmark run ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
  }
  res.json({ success: true, data: run, timestamp: new Date().toISOString() });
}));

export default router;
