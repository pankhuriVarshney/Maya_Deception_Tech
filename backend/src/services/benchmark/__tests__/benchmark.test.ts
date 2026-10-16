import { matchEvents } from '../matching';
import { aggregateRepetitions, computeMetrics, median } from '../metrics';
import { PROBES, ProbeExec } from '../probes';
import { normalise, scoreMatrix } from '../scoring';
import { AttackerRecord, CommandResult, ObservedEvent, TargetRepResult, TelemetryObservation } from '../types';

const exec = (command: string, stdout: string, extra: Partial<ProbeExec> = {}): ProbeExec => ({
  command,
  stdout,
  stderr: '',
  exitCode: 0,
  durationMs: 100,
  ...extra,
});

const probe = (id: string) => {
  const p = PROBES.find(x => x.id === id);
  if (!p) throw new Error(`no probe ${id}`);
  return p;
};

describe('honeypot-detection probes', () => {
  it('P2 flags a sandbox kernel string and passes a plain one', () => {
    const gvisor = probe('P2').evaluate([
      exec('uname -a', 'Linux jump 4.19.0-gvisor #1 SMP Sun Jan 10 15:06:54 PST 2016 x86_64 Linux'),
      exec('cat /proc/version 2>&1', ''),
    ]);
    expect(gvisor.failed).toBe(true);
    expect(gvisor.evidence).toContain('gvisor');

    const plain = probe('P2').evaluate([
      exec('uname -a', 'Linux web 6.1.0-18-amd64 #1 SMP Debian x86_64 GNU/Linux'),
      exec('cat /proc/version 2>&1', 'Linux version 6.1.0-18-amd64'),
    ]);
    expect(plain.failed).toBe(false);
  });

  it('P9 counts monitoring artifacts and ignores a commented-out ForceCommand', () => {
    const found = probe('P9').evaluate([
      exec('ps aux 2>&1', '  8 root  0:00 tee -a /var/lib/.state/.sshd_auth.log'),
      exec('grep', '    ForceCommand /usr/local/bin/decoy-audit-wrapper.sh'),
      exec('ls', '/etc/maya-audit-bashrc\nls: /var/lib/.state: No such file or directory'),
    ]);
    expect(found.failed).toBe(true);
    expect(found.artifacts).toBe(3);

    const clean = probe('P9').evaluate([
      exec('ps aux 2>&1', '  1 root  sshd'),
      exec('grep', ''),
      exec('ls', 'ls: /etc/maya-audit-bashrc: No such file or directory\nls: /var/lib/.state: No such file or directory'),
    ]);
    expect(clean.failed).toBe(false);
    expect(clean.artifacts).toBe(0);
  });

  it('P3 flags documented Cowrie defaults', () => {
    expect(probe('P3').evaluate([exec('hostname', 'svr04\n'), exec('cat', 'root:x:0:0\nphil:x:1000:1000')]).failed).toBe(true);
    expect(probe('P3').evaluate([exec('hostname', 'web-03\n'), exec('cat', 'root:x:0:0\nadmin:x:1000')]).failed).toBe(false);
  });

  it('P8 flags a sleep that returns early', () => {
    expect(probe('P8').evaluate([exec('sleep 2; echo done', 'done\n', { durationMs: 400 })]).failed).toBe(true);
    expect(probe('P8').evaluate([exec('sleep 2; echo done', 'done\n', { durationMs: 2300 })]).failed).toBe(false);
  });

  it('fidelity probes check real shell behaviour', () => {
    expect(probe('F1').evaluate([exec('x', '42\n')]).failed).toBe(false);
    expect(probe('F1').evaluate([exec('x', '$((6*7))\n')]).failed).toBe(true);
    expect(probe('F2').evaluate([exec('x', '1\n')]).failed).toBe(false);
    expect(probe('F3').evaluate([exec('x', 'abc')]).failed).toBe(false);
    expect(probe('F4').evaluate([exec('x', 'ls: /definitely_not_here: No such file or directory')]).failed).toBe(false);
    expect(probe('F4').evaluate([exec('x', 'command not found')]).failed).toBe(true);
  });
});

const cmd = (index: number, command: string, sentAt: number, extra: Partial<CommandResult> = {}): CommandResult => ({
  index,
  stage: 'discovery',
  command,
  sentAt,
  durationMs: 200,
  exitCode: 0,
  output: '',
  labeled: false,
  expectedTechnique: '',
  dangerous: false,
  ...extra,
});

const ev = (command: string, eventTime: number | null, observedAt: number, extra: Partial<ObservedEvent> = {}): ObservedEvent => ({
  command,
  observedAt,
  eventTime,
  technique: '',
  confidence: 0,
  dangerous: false,
  srcIp: '10.0.0.1',
  ...extra,
});

describe('matchEvents', () => {
  it('pairs repeated commands in send order, each event only once', () => {
    const commands = [cmd(0, 'uname -a', 1000), cmd(1, 'uname -a', 21000)];
    const events = [ev('uname -a', 21000, 29000), ev('uname -a', 1000, 9000)];
    const matches = matchEvents(commands, events);
    expect(matches[0].event?.observedAt).toBe(9000);
    expect(matches[1].event?.observedAt).toBe(29000);
  });

  it('does not pair an event from far outside the command window', () => {
    const matches = matchEvents([cmd(0, 'id', 1000)], [ev('id', 60000, 61000)]);
    expect(matches[0].event).toBeNull();
  });
});

const record = (commands: CommandResult[], extra: Partial<AttackerRecord> = {}): AttackerRecord => ({
  targetId: 't',
  startedAt: 0,
  finishedAt: 100000,
  openPorts: [22],
  localAddress: '10.0.0.1',
  attempts: [],
  authAttemptsSent: commands.length,
  connectionsAuthenticated: commands.length,
  engagedFrom: 1000,
  engagedUntil: 31000,
  commands,
  probes: [],
  disengaged: false,
  disengageReason: '',
  lastStageReached: 'discovery',
  error: '',
  ...extra,
});

const observation = (events: ObservedEvent[], extra: Partial<TelemetryObservation> = {}): TelemetryObservation => ({
  available: true,
  note: '',
  events,
  loginsRecorded: events.length,
  sessionsObserved: events.length,
  sourceIps: ['10.0.0.1'],
  firstEventAt: 1000,
  lastEventAt: 9000,
  postHocClassification: false,
  ...extra,
});

describe('computeMetrics', () => {
  const commands = [
    cmd(0, 'whoami', 1000, { labeled: true, expectedTechnique: 'T1033' }),
    cmd(1, 'cat /etc/shadow', 3000, { labeled: true, expectedTechnique: 'T1003.008', dangerous: true }),
    cmd(2, 'ls -la /', 5000, { labeled: true, expectedTechnique: 'T1083' }),
  ];

  it('scores a defender that caught everything correctly', () => {
    const events = [
      ev('whoami', 1000, 4000, { technique: 'T1033', confidence: 0.8 }),
      ev('cat /etc/shadow', 3000, 6000, { technique: 'T1003.008', confidence: 0.9, dangerous: true }),
      ev('ls -la /', 5000, 8000, { technique: 'T1083', confidence: 0.8 }),
    ];
    const m = computeMetrics(record(commands), observation(events));
    expect(m.A1).toBe(1);
    expect(m.B1).toBe(1);
    expect(m.B3).toBe(1);
    expect(m.B3f).toBe(0);
    expect(m.A5).toBe(3000);
    expect(m.A7).toBe(1);
    expect(m.C1).toBe(30);
  });

  it('counts a wrong technique and an unflagged dangerous command against the defender', () => {
    const events = [
      ev('whoami', 1000, 4000, { technique: 'T1082', confidence: 0.3 }),
      ev('cat /etc/shadow', 3000, 6000, { technique: 'T1003.008', confidence: 0.9, dangerous: false }),
    ];
    const m = computeMetrics(record(commands), observation(events));
    expect(m.A1).toBeCloseTo(2 / 3);
    expect(m.B1).toBeCloseTo(1 / 3);
    expect(m.B1c).toBeCloseTo(1 / 3);
    expect(m.B3).toBe(0);
  });

  it('gives a host with no telemetry zeros, not N/A, for what it failed to record', () => {
    const blind = observation([], { available: false, loginsRecorded: null, sessionsObserved: null, sourceIps: [], firstEventAt: null, lastEventAt: null });
    const m = computeMetrics(record(commands), blind);
    expect(m.A1).toBe(0);
    expect(m.A4).toBe(0);
    expect(m.A7).toBe(0);
    expect(m.B1).toBe(0);
    expect(m.B3).toBe(0);
    expect(m.A5).toBeNull();
    expect(m.C1d).toBeNull();
    expect(m.C1).toBe(30);
  });

  it('marks danger metrics not-exercised when the attacker never sent a dangerous command', () => {
    const m = computeMetrics(record([cmd(0, 'whoami', 1000, { labeled: true, expectedTechnique: 'T1033' })]), observation([ev('whoami', 1000, 3000, { technique: 'T1033', confidence: 0.8 })]));
    expect(m.B3).toBeNull();
  });

  it('derives fingerprint and fidelity ratios from the probes that ran', () => {
    const m = computeMetrics(
      record(commands, {
        probes: [
          { id: 'P1', name: '', kind: 'tell', failed: false, evidence: '' },
          { id: 'P2', name: '', kind: 'tell', failed: true, evidence: '' },
          { id: 'P9', name: '', kind: 'tell', failed: true, evidence: '', artifacts: 4 },
          { id: 'F1', name: '', kind: 'fidelity', failed: false, evidence: '' },
        ],
      }),
      observation([])
    );
    expect(m.C3).toBeCloseTo(1 / 3);
    expect(m.C4).toBe(1);
    expect(m.C5).toBe(4);
  });
});

describe('aggregation and scoring', () => {
  it('median handles odd, even and empty input', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('aggregates repetitions ignoring nulls', () => {
    const reps = [{ metrics: { A5: 1000 } }, { metrics: { A5: null } }, { metrics: { A5: 3000 } }] as unknown as TargetRepResult[];
    const agg = aggregateRepetitions(reps);
    expect(agg.A5).toEqual({ median: 2000, min: 1000, max: 3000, n: 2 });
  });

  it('normalises against the best performer in each direction', () => {
    expect(normalise(5, 10, 'higher')).toBe(2.5);
    expect(normalise(10, 10, 'higher')).toBe(5);
    expect(normalise(0, 0, 'higher')).toBe(0);
    expect(normalise(4, 2, 'lower')).toBe(2.5);
    expect(normalise(2, 2, 'lower')).toBe(5);
    expect(normalise(0, 0, 'lower')).toBe(5);
    expect(normalise(3, 0, 'lower')).toBe(0);
  });

  it('weights only the categories that were measured and ranks the better target higher', () => {
    const good = { A1: 1, A2: 1, A4: 1, A5: 1000, A7: 1, B1: 1, B1c: 1, B3: 1, B3f: 0, C1: 60, C1d: 60, C2: 12, C3: 1, C4: 1, C5: 0 };
    const bad = { A1: 0, A2: 0, A4: 0, A5: null, A7: 0, B1: 0, B1c: 0, B3: 0, B3f: null, C1: 10, C1d: null, C2: 5, C3: 0, C4: 0.5, C5: 4 };
    const result = scoreMatrix({ good, bad });

    expect(result.composite.good).toBeCloseTo(5);
    expect((result.composite.bad as number) < (result.composite.good as number)).toBe(true);

    const measured = result.categories.filter(c => c.measured).map(c => c.id);
    expect(measured).toEqual(['A', 'B', 'C']);
    expect(result.categories.find(c => c.id === 'D')?.measured).toBe(false);
    expect(result.notMeasured.some(m => m.id === 'D3')).toBe(true);

    const dwell = result.categories.flatMap(c => c.metrics).find(m => m.id === 'C1d');
    expect(dwell?.scores.good).toBeNull();
  });
});
