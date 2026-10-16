// Mirrors the JSON returned by backend/src/routes/benchmark.ts

export type StepKind = "info" | "command" | "probe" | "disengage" | "error"

export interface TargetStatus {
  id: string
  kind: "maya" | "cowrie" | "control"
  label: string
  host: string
  port: number
  reachable: boolean
  note: string
}

export interface BenchmarkConfig {
  targetIds: string[]
  repetitions: number
  adaptive: boolean
  suspicionThreshold: number
  thinkTimeMs: number
  settleSeconds: number
}

export interface StepEvent {
  at: number
  targetId: string
  stage: string
  kind: StepKind
  text: string
}

export interface ProbeOutcome {
  id: string
  name: string
  kind: "tell" | "fidelity"
  failed: boolean
  evidence: string
  artifacts?: number
}

export interface CommandResult {
  index: number
  stage: string
  command: string
  sentAt: number
  durationMs: number
  exitCode: number | null
  output: string
  labeled: boolean
  expectedTechnique: string
  dangerous: boolean
  probeId?: string
}

export interface AttackerRecord {
  targetId: string
  startedAt: number
  finishedAt: number
  openPorts: number[]
  localAddress: string | null
  attempts: Array<{ password: string; ok: boolean; at: number }>
  authAttemptsSent: number
  connectionsAuthenticated: number
  engagedFrom: number | null
  engagedUntil: number | null
  commands: CommandResult[]
  probes: ProbeOutcome[]
  disengaged: boolean
  disengageReason: string
  lastStageReached: string | null
  error: string
}

export interface TelemetryObservation {
  available: boolean
  note: string
  loginsRecorded: number | null
  sessionsObserved: number | null
  sourceIps: string[]
  firstEventAt: number | null
  lastEventAt: number | null
  postHocClassification: boolean
}

export interface Detection {
  commandIndex: number
  observedAt: number
  latencyMs: number
  technique: string
  confidence: number
  dangerous: boolean
}

export type MetricValues = Record<string, number | null>

export interface TargetRepResult {
  repetition: number
  record: AttackerRecord
  observation: TelemetryObservation
  matchedCommands: number
  detections: Detection[]
  metrics: MetricValues
}

export interface Aggregate {
  median: number | null
  min: number | null
  max: number | null
  n: number
}

export interface MatrixMetricRow {
  id: string
  name: string
  unit: string
  better: "higher" | "lower"
  scored: boolean
  values: Record<string, number | null>
  scores: Record<string, number | null>
}

export interface MatrixCategory {
  id: string
  name: string
  weight: number
  measured: boolean
  scores: Record<string, number | null>
  metrics: MatrixMetricRow[]
}

export interface MatrixResult {
  targetIds: string[]
  categories: MatrixCategory[]
  composite: Record<string, number | null>
  compositePercent: Record<string, number | null>
  notMeasured: Array<{ id: string; name: string; reason: string }>
}

export interface RunTarget {
  id: string
  kind: string
  label: string
  host: string
  port: number
}

export interface RunSnapshot {
  runId: string
  status: "running" | "completed" | "failed"
  config: BenchmarkConfig
  startedAt: string
  finishedAt: string | null
  targets: RunTarget[]
  progress: { repetition: number; totalRepetitions: number }
  log: StepEvent[]
  results: Record<string, { repetitions: TargetRepResult[]; aggregate: Record<string, Aggregate> }>
  matrix: MatrixResult | null
  error: string
}

export interface RunSummary {
  runId: string
  status: "running" | "completed" | "failed"
  startedAt: string
  finishedAt: string | null
  config: BenchmarkConfig
  compositePercent: Record<string, number | null> | null
}

export interface ScenarioInfo {
  stages: Array<{ id: string; label: string }>
  reconPorts: number[]
  wrongPasswordCount: number
  commands: Array<{ command: string; stage: string; expectedTechnique: string; dangerous: boolean; labeled: boolean }>
  probes: Array<{ id: string; name: string; kind: "tell" | "fidelity"; description: string; commands: string[] }>
}
