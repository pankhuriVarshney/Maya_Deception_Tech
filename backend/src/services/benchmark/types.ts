export type TargetKind = 'maya' | 'cowrie' | 'control';

export interface BenchmarkTarget {
  id: string;
  kind: TargetKind;
  label: string;
  host: string;
  port: number;
  user: string;
  password: string;
  /** Maya only: the decoy name AttackEvents are recorded against. */
  decoyName?: string;
  /** Cowrie only: path to cowrie.json as seen from this container. */
  logPath?: string;
}

export interface BenchmarkConfig {
  targetIds: string[];
  repetitions: number;
  adaptive: boolean;
  suspicionThreshold: number;
  thinkTimeMs: number;
  settleSeconds: number;
}

export type Stage =
  | 'recon'
  | 'initial_access'
  | 'validation'
  | 'discovery'
  | 'credential_access'
  | 'collection'
  | 'exfiltration'
  | 'defense_evasion';

export const STAGE_ORDER: Stage[] = [
  'recon',
  'initial_access',
  'validation',
  'discovery',
  'credential_access',
  'collection',
  'exfiltration',
  'defense_evasion',
];

export interface ScenarioCommand {
  command: string;
  stage: Stage;
  /** MITRE technique an analyst would expect for this command ('' if unlabeled). */
  expectedTechnique: string;
  dangerous: boolean;
  /** Labeled commands feed the MITRE / dangerous-command metrics. */
  labeled: boolean;
}

export interface CommandResult {
  index: number;
  stage: Stage;
  command: string;
  sentAt: number;
  durationMs: number;
  exitCode: number | null;
  output: string;
  labeled: boolean;
  expectedTechnique: string;
  dangerous: boolean;
  probeId?: string;
}

export interface ProbeOutcome {
  id: string;
  name: string;
  kind: 'tell' | 'fidelity';
  /** tell: a honeypot indicator was found. fidelity: the output was wrong. */
  failed: boolean;
  evidence: string;
  /** Monitoring artifacts found (monitoring probe only). */
  artifacts?: number;
}

export interface StepEvent {
  at: number;
  targetId: string;
  stage: Stage;
  kind: 'info' | 'command' | 'probe' | 'disengage' | 'error';
  text: string;
}

export interface AuthAttempt {
  password: string;
  ok: boolean;
  at: number;
}

export interface AttackerRecord {
  targetId: string;
  startedAt: number;
  finishedAt: number;
  openPorts: number[];
  localAddress: string | null;
  attempts: AuthAttempt[];
  /** Every ssh invocation that attempted to authenticate (failed logins + commands). */
  authAttemptsSent: number;
  connectionsAuthenticated: number;
  engagedFrom: number | null;
  engagedUntil: number | null;
  commands: CommandResult[];
  probes: ProbeOutcome[];
  disengaged: boolean;
  disengageReason: string;
  lastStageReached: Stage | null;
  error: string;
}

export interface ObservedEvent {
  command: string;
  /** When the defender made this visible to us (ms epoch). */
  observedAt: number;
  /** When the defender says the command ran (ms epoch), if known. */
  eventTime: number | null;
  technique: string;
  confidence: number;
  dangerous: boolean;
  srcIp: string;
}

export interface TelemetryObservation {
  available: boolean;
  note: string;
  events: ObservedEvent[];
  loginsRecorded: number | null;
  sessionsObserved: number | null;
  sourceIps: string[];
  firstEventAt: number | null;
  lastEventAt: number | null;
  /** True when MITRE/danger were computed by us from the raw command, not by the defender. */
  postHocClassification: boolean;
}

export type MetricValues = Record<string, number | null>;

/** A command we sent that the defender recorded. */
export interface Detection {
  commandIndex: number;
  observedAt: number;
  latencyMs: number;
  technique: string;
  confidence: number;
  dangerous: boolean;
}

export interface TargetRepResult {
  repetition: number;
  record: AttackerRecord;
  observation: TelemetryObservation;
  matchedCommands: number;
  detections: Detection[];
  metrics: MetricValues;
}
