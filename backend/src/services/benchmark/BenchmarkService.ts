import * as fs from 'fs';
import { BenchmarkRun } from '../../models';
import { logger } from '../../utils/logger';
import { runAttack } from './AttackerAgent';
import { Aggregate, aggregateRepetitions, computeMetrics } from './metrics';
import { MatrixResult, scoreMatrix } from './scoring';
import { probePort } from './SshRunner';
import { CowrieTail, collectCowrieTelemetry } from './telemetry/CowrieTelemetry';
import { collectMayaTelemetry, mayaSessionCount } from './telemetry/MayaTelemetry';
import { nullTelemetry } from './telemetry/NullTelemetry';
import { matchEvents } from './matching';
import {
  AttackerRecord,
  BenchmarkConfig,
  BenchmarkTarget,
  Detection,
  StepEvent,
  TargetRepResult,
  TelemetryObservation,
} from './types';

const MAX_LOG_EVENTS = 1500;

export function loadTargets(): BenchmarkTarget[] {
  const env = process.env;
  const user = env.BENCHMARK_USER || 'admin';
  const password = env.BENCHMARK_PASSWORD || 'fakejump01!';
  return [
    {
      id: 'maya',
      kind: 'maya',
      label: 'Maya (gVisor decoy)',
      host: env.BENCHMARK_MAYA_HOST || 'maya-dev-control-plane',
      port: Number(env.BENCHMARK_MAYA_PORT || 30022),
      user,
      password,
      decoyName: env.BENCHMARK_MAYA_DECOY || 'jump-01',
    },
    {
      id: 'cowrie',
      kind: 'cowrie',
      label: 'Cowrie honeypot',
      host: env.BENCHMARK_COWRIE_HOST || 'bench-cowrie',
      port: Number(env.BENCHMARK_COWRIE_PORT || 2222),
      user,
      password,
      logPath: env.BENCHMARK_COWRIE_LOG || '/bench/cowrie/cowrie.json',
    },
    {
      id: 'control',
      kind: 'control',
      label: 'Unprotected host',
      host: env.BENCHMARK_CONTROL_HOST || 'bench-control',
      port: Number(env.BENCHMARK_CONTROL_PORT || 22),
      user,
      password,
    },
  ];
}

export interface TargetStatus {
  id: string;
  kind: string;
  label: string;
  host: string;
  port: number;
  reachable: boolean;
  note: string;
}

export interface RunSnapshot {
  runId: string;
  status: 'running' | 'completed' | 'failed';
  config: BenchmarkConfig;
  startedAt: string;
  finishedAt: string | null;
  targets: Array<{ id: string; kind: string; label: string; host: string; port: number }>;
  progress: { repetition: number; totalRepetitions: number };
  log: StepEvent[];
  results: Record<string, { repetitions: TargetRepResult[]; aggregate: Record<string, Aggregate> }>;
  matrix: MatrixResult | null;
  error: string;
}

export class BenchmarkService {
  private runs = new Map<string, RunSnapshot>();
  private activeRunId: string | null = null;

  async getTargetStatus(): Promise<TargetStatus[]> {
    return Promise.all(
      loadTargets().map(async t => {
        const probe = await probePort(t.host, t.port);
        let note = probe.open ? 'reachable' : `cannot connect to ${t.host}:${t.port}`;
        if (probe.open && t.kind === 'cowrie' && t.logPath) {
          try {
            await fs.promises.access(t.logPath, fs.constants.R_OK);
          } catch {
            note = `reachable, but ${t.logPath} is not readable yet (Cowrie writes it on first connection)`;
          }
        }
        return { id: t.id, kind: t.kind, label: t.label, host: t.host, port: t.port, reachable: probe.open, note };
      })
    );
  }

  getActiveRunId(): string | null {
    return this.activeRunId;
  }

  async startRun(config: BenchmarkConfig): Promise<RunSnapshot> {
    if (this.activeRunId) throw new Error(`benchmark ${this.activeRunId} is still running`);

    const all = loadTargets();
    const targets = all.filter(t => config.targetIds.includes(t.id));
    if (targets.length === 0) throw new Error('no valid targets selected');

    const runId = `bench-${Date.now().toString(36)}`;
    const run: RunSnapshot = {
      runId,
      status: 'running',
      config,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      targets: targets.map(t => ({ id: t.id, kind: t.kind, label: t.label, host: t.host, port: t.port })),
      progress: { repetition: 0, totalRepetitions: config.repetitions },
      log: [],
      results: {},
      matrix: null,
      error: '',
    };
    for (const t of targets) run.results[t.id] = { repetitions: [], aggregate: {} };

    this.runs.set(runId, run);
    this.activeRunId = runId;
    await this.persist(run);
    void this.execute(run, targets);
    return run;
  }

  async getRun(runId: string): Promise<RunSnapshot | null> {
    const live = this.runs.get(runId);
    if (live) return live;
    const doc = await BenchmarkRun.findOne({ runId }).lean();
    if (!doc) return null;
    // A run that Mongo still calls "running" but this process isn't running was
    // cut off by a backend restart; don't let the UI poll it forever.
    const interrupted = doc.status === 'running' && runId !== this.activeRunId;
    return {
      runId: doc.runId,
      status: interrupted ? 'failed' : doc.status,
      config: doc.config,
      startedAt: new Date(doc.startedAt).toISOString(),
      finishedAt: doc.finishedAt ? new Date(doc.finishedAt).toISOString() : null,
      targets: doc.config?.targets ?? [],
      progress: doc.config?.progress ?? { repetition: 0, totalRepetitions: 0 },
      log: doc.log ?? [],
      results: doc.results ?? {},
      matrix: doc.matrix ?? null,
      error: interrupted ? 'Interrupted: the backend restarted while this run was in progress.' : doc.error ?? '',
    };
  }

  async listRuns(): Promise<Array<Record<string, unknown>>> {
    const docs = await BenchmarkRun.find({}).sort({ startedAt: -1 }).limit(20).lean();
    return docs.map(d => ({
      runId: d.runId,
      status: d.status === 'running' && d.runId !== this.activeRunId ? 'failed' : d.status,
      startedAt: d.startedAt,
      finishedAt: d.finishedAt ?? null,
      config: d.config,
      compositePercent: d.matrix?.compositePercent ?? null,
    }));
  }

  private pushLog(run: RunSnapshot, e: StepEvent): void {
    run.log.push(e);
    if (run.log.length > MAX_LOG_EVENTS) run.log.splice(0, run.log.length - MAX_LOG_EVENTS);
  }

  // Writes are chained so a slow periodic write can never land after (and
  // overwrite) the final one. Each write reads the run's current state when it
  // executes, so the last queued write always carries the final state.
  private persistChain: Promise<void> = Promise.resolve();

  private persist(run: RunSnapshot): Promise<void> {
    this.persistChain = this.persistChain.then(() => this.writeRun(run));
    return this.persistChain;
  }

  private async writeRun(run: RunSnapshot): Promise<void> {
    try {
      const fields: Record<string, unknown> = {
        status: run.status,
        // targets and progress ride along inside config so a reload from Mongo is complete
        config: { ...run.config, targets: run.targets, progress: run.progress },
        startedAt: new Date(run.startedAt),
        log: run.log,
        results: run.results,
        matrix: run.matrix,
        error: run.error,
      };
      if (run.finishedAt) fields.finishedAt = new Date(run.finishedAt);
      await BenchmarkRun.findOneAndUpdate({ runId: run.runId }, { $set: fields }, { upsert: true });
    } catch (err) {
      logger.warn(`benchmark: could not persist run ${run.runId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async execute(run: RunSnapshot, targets: BenchmarkTarget[]): Promise<void> {
    const timer = setInterval(() => {
      void this.persist(run);
    }, 2000);

    try {
      for (let rep = 1; rep <= run.config.repetitions; rep++) {
        run.progress.repetition = rep;
        // All targets start together, so they face the same conditions at the same moment.
        // One target blowing up must not abandon the others mid-attack.
        const results = await Promise.all(
          targets.map(t => this.runTarget(run, t, rep).catch(err => this.errorResult(run, t, rep, err)))
        );
        results.forEach((res, i) => run.results[targets[i].id].repetitions.push(res));
      }

      const perTarget: Record<string, Record<string, number | null>> = {};
      for (const t of targets) {
        const entry = run.results[t.id];
        entry.aggregate = aggregateRepetitions(entry.repetitions);
        perTarget[t.id] = {};
        for (const [id, agg] of Object.entries(entry.aggregate)) perTarget[t.id][id] = agg.median;
      }
      run.matrix = scoreMatrix(perTarget);
      run.status = 'completed';
    } catch (err) {
      run.status = 'failed';
      run.error = err instanceof Error ? err.message : String(err);
      logger.error(`benchmark ${run.runId} failed: ${run.error}`);
    } finally {
      clearInterval(timer);
      run.finishedAt = new Date().toISOString();
      this.activeRunId = null;
      await this.persist(run);
    }
  }

  private errorResult(run: RunSnapshot, target: BenchmarkTarget, repetition: number, err: unknown): TargetRepResult {
    const message = err instanceof Error ? err.message : String(err);
    const now = Date.now();
    this.pushLog(run, { at: now, targetId: target.id, stage: 'recon', kind: 'error', text: `run aborted: ${message}` });
    const record: AttackerRecord = {
      targetId: target.id,
      startedAt: now,
      finishedAt: now,
      openPorts: [],
      localAddress: null,
      attempts: [],
      authAttemptsSent: 0,
      connectionsAuthenticated: 0,
      engagedFrom: null,
      engagedUntil: null,
      commands: [],
      probes: [],
      disengaged: false,
      disengageReason: '',
      lastStageReached: null,
      error: message,
    };
    const observation: TelemetryObservation = { ...nullTelemetry(), note: `no telemetry: ${message}` };
    return { repetition, record, observation, matchedCommands: 0, detections: [], metrics: computeMetrics(record, observation) };
  }

  private async runTarget(run: RunSnapshot, target: BenchmarkTarget, repetition: number): Promise<TargetRepResult> {
    const log = (e: StepEvent) => this.pushLog(run, e);
    const failEvent = (text: string): StepEvent => ({
      at: Date.now(),
      targetId: target.id,
      stage: 'recon',
      kind: 'error',
      text,
    });

    let tail: CowrieTail | null = null;
    let sessionsBefore: number | null = null;
    try {
      if (target.kind === 'maya') sessionsBefore = await mayaSessionCount(target.decoyName ?? 'jump-01');
      if (target.kind === 'cowrie' && target.logPath) {
        tail = new CowrieTail(target.logPath);
        await tail.start();
      }
    } catch (err) {
      log(failEvent(`setup problem: ${err instanceof Error ? err.message : String(err)}`));
    }

    const record: AttackerRecord = await runAttack(
      target,
      {
        adaptive: run.config.adaptive,
        suspicionThreshold: run.config.suspicionThreshold,
        thinkTimeMs: run.config.thinkTimeMs,
        seed: `${run.runId}:${repetition}`,
      },
      log
    );

    log({
      at: Date.now(),
      targetId: target.id,
      stage: record.lastStageReached ?? 'recon',
      kind: 'info',
      text: target.kind === 'control' ? 'attack finished (no telemetry to collect)' : 'attack finished; collecting defender telemetry',
    });

    let observation: TelemetryObservation;
    try {
      if (target.kind === 'maya') {
        observation = await collectMayaTelemetry(target, record, sessionsBefore, run.config.settleSeconds);
      } else if (target.kind === 'cowrie' && tail) {
        observation = await collectCowrieTelemetry(tail, record, run.config.settleSeconds);
      } else if (target.kind === 'cowrie') {
        // A misconfigured Cowrie log isn't "Cowrie saw nothing" -- say so, don't score it as blind.
        observation = { ...nullTelemetry(), available: true, note: 'Cowrie log path is not configured (BENCHMARK_COWRIE_LOG)' };
      } else {
        observation = nullTelemetry();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(failEvent(`telemetry collection failed: ${msg}`));
      observation = { ...nullTelemetry(), available: target.kind !== 'control', note: `telemetry collection failed: ${msg}` };
    } finally {
      tail?.stop();
    }

    const detections: Detection[] = [];
    if (observation.available) {
      const sentAt = new Map<number, number>(record.commands.map(c => [c.index, c.sentAt] as [number, number]));
      for (const m of matchEvents(record.commands, observation.events)) {
        if (!m.event) continue;
        detections.push({
          commandIndex: m.commandIndex,
          observedAt: m.event.observedAt,
          latencyMs: Math.max(0, m.event.observedAt - (sentAt.get(m.commandIndex) ?? m.event.observedAt)),
          technique: m.event.technique,
          confidence: m.event.confidence,
          dangerous: m.event.dangerous,
        });
      }
    }

    return {
      repetition,
      record,
      observation,
      matchedCommands: detections.length,
      detections,
      metrics: computeMetrics(record, observation),
    };
  }
}
