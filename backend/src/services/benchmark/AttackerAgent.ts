import { PROBES, ProbeExec } from './probes';
import { RECON_PORTS, SCENARIO_COMMANDS, STAGE_LABELS, WRONG_PASSWORDS } from './scenario';
import { ExecResult, scanPorts, seededRandom, sleep, sshExec } from './SshRunner';
import { AttackerRecord, BenchmarkTarget, ProbeOutcome, Stage, StepEvent } from './types';

export interface AgentOptions {
  /** When false the probes still run and are recorded, but never end the attack. */
  adaptive: boolean;
  /** Failed probes (tells) at which the attacker decides the host is a honeypot. */
  suspicionThreshold: number;
  thinkTimeMs: number;
  seed: string;
}

interface RunMeta {
  labeled: boolean;
  expectedTechnique: string;
  dangerous: boolean;
  probeId?: string;
}

const UNLABELED: RunMeta = { labeled: false, expectedTechnique: '', dangerous: false };

/**
 * One scripted attacker, identical for every target: recon, guess the
 * password, check whether the host is a honeypot, then work the kill chain.
 * It only ever decides from what the target actually returns.
 */
export async function runAttack(
  target: BenchmarkTarget,
  opts: AgentOptions,
  log: (e: StepEvent) => void
): Promise<AttackerRecord> {
  const rand = seededRandom(`${opts.seed}:${target.id}`);
  const think = () => sleep(Math.round(opts.thinkTimeMs * (0.7 + 0.6 * rand())));
  const emit = (stage: Stage, kind: StepEvent['kind'], text: string) =>
    log({ at: Date.now(), targetId: target.id, stage, kind, text });

  const record: AttackerRecord = {
    targetId: target.id,
    startedAt: Date.now(),
    finishedAt: Date.now(),
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
    error: '',
  };

  const ssh = { host: target.host, port: target.port, user: target.user };
  let nextIndex = 0;

  const exec = async (command: string, stage: Stage, meta: RunMeta): Promise<ExecResult> => {
    const res = await sshExec(ssh, target.password, command);
    record.authAttemptsSent++;
    if (!res.authRejected && !res.connectionError) record.connectionsAuthenticated++;
    record.commands.push({
      index: nextIndex++,
      stage,
      command,
      sentAt: res.startedAt,
      durationMs: res.durationMs,
      exitCode: res.exitCode,
      output: (res.stdout || res.stderr).slice(0, 300),
      labeled: meta.labeled,
      expectedTechnique: meta.expectedTechnique,
      dangerous: meta.dangerous,
      probeId: meta.probeId,
    });
    record.engagedUntil = res.startedAt + res.durationMs;
    emit(stage, 'command', command);
    return res;
  };

  const tellsFailed = () => record.probes.filter(p => p.failed);
  const shouldLeave = () => opts.adaptive && tellsFailed().length >= opts.suspicionThreshold;
  const leave = (stage: Stage) => {
    const failed = tellsFailed();
    record.disengaged = true;
    record.disengageReason =
      `Suspected honeypot after ${failed.length} tell(s) (threshold ${opts.suspicionThreshold}): ` +
      failed.map(p => `${p.id} ${p.name}`).join(', ');
    emit(stage, 'disengage', record.disengageReason);
  };

  try {
    // 1. Recon
    emit('recon', 'info', `${STAGE_LABELS.recon}: scanning ${target.host}`);
    const scan = await scanPorts(target.host, Array.from(new Set([...RECON_PORTS, target.port])));
    record.openPorts = scan.openPorts;
    record.localAddress = scan.localAddress;
    record.lastStageReached = 'recon';
    emit('recon', 'info', `open ports: ${scan.openPorts.join(', ') || 'none'}`);
    if (!scan.openPorts.includes(target.port)) {
      record.error = `${target.host}:${target.port} is not reachable from the backend`;
      emit('recon', 'error', record.error);
      return finish(record);
    }

    // 2. Initial access: wrong guesses first, the real credential last.
    const wordlist = [...WRONG_PASSWORDS, target.password];
    let accepted: string | null = null;
    for (const password of wordlist) {
      const res = await sshExec(ssh, password, 'true');
      record.authAttemptsSent++;
      const ok = !res.authRejected && !res.connectionError && res.exitCode === 0;
      // The wrong guesses are a public wordlist; the real credential never goes into results.
      record.attempts.push({ password: password === target.password ? '(real credential)' : password, ok, at: res.startedAt });

      if (res.connectionError) {
        record.error = `connection error while guessing passwords (exit ${res.exitCode})`;
        emit('initial_access', 'error', record.error);
        return finish(record);
      }
      if (ok) {
        record.connectionsAuthenticated++;
        record.engagedFrom = res.startedAt;
        record.engagedUntil = res.startedAt + res.durationMs;
        record.commands.push({
          index: nextIndex++,
          stage: 'initial_access',
          command: 'true',
          sentAt: res.startedAt,
          durationMs: res.durationMs,
          exitCode: res.exitCode,
          output: '',
          ...UNLABELED,
        });
        accepted = password;
        break;
      }
      await sleep(Math.round(opts.thinkTimeMs / 4));
    }

    record.lastStageReached = 'initial_access';
    if (accepted === null) {
      record.error = 'no password was accepted';
      emit('initial_access', 'error', record.error);
      return finish(record);
    }

    const weak = accepted !== target.password;
    const attemptNo = record.attempts.length;
    const p1: ProbeOutcome = {
      id: 'P1',
      name: 'Weak password accepted',
      kind: 'tell',
      failed: weak,
      evidence: weak
        ? `accepted "${accepted}" on attempt ${attemptNo}`
        : `rejected ${attemptNo - 1} wrong passwords before the real credential worked`,
    };
    record.probes.push(p1);
    emit('initial_access', weak ? 'probe' : 'info', `access gained on attempt ${attemptNo}; ${p1.evidence}`);
    if (shouldLeave()) {
      leave('initial_access');
      return finish(record);
    }
    await think();

    // 3. Honeypot checks. The attacker can leave after any single probe.
    record.lastStageReached = 'validation';
    for (const probe of PROBES) {
      const execs: ProbeExec[] = [];
      for (const command of probe.commands) {
        const res = await exec(command, 'validation', { ...UNLABELED, probeId: probe.id });
        execs.push({
          command,
          stdout: res.stdout,
          stderr: res.stderr,
          exitCode: res.exitCode,
          durationMs: res.durationMs,
        });
      }
      const verdict = probe.evaluate(execs);
      record.probes.push({
        id: probe.id,
        name: probe.name,
        kind: probe.kind,
        failed: verdict.failed,
        evidence: verdict.evidence,
        artifacts: verdict.artifacts,
      });
      emit('validation', 'probe', `${probe.id} ${probe.name}: ${verdict.failed ? 'FAILED' : 'ok'} - ${verdict.evidence}`);

      if (shouldLeave()) {
        leave('validation');
        return finish(record);
      }
      await think();
    }

    // 4+. Kill chain.
    for (let i = 0; i < SCENARIO_COMMANDS.length; i++) {
      const step = SCENARIO_COMMANDS[i];
      await exec(step.command, step.stage, {
        labeled: step.labeled,
        expectedTechnique: step.expectedTechnique,
        dangerous: step.dangerous,
      });
      record.lastStageReached = step.stage;
      if (i < SCENARIO_COMMANDS.length - 1) await think();
    }
    emit('defense_evasion', 'info', 'attack chain complete');
  } catch (err) {
    record.error = err instanceof Error ? err.message : String(err);
    emit(record.lastStageReached ?? 'recon', 'error', record.error);
  }

  return finish(record);
}

function finish(record: AttackerRecord): AttackerRecord {
  record.finishedAt = Date.now();
  return record;
}
