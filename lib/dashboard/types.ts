export type RiskLevel = "Low" | "Medium" | "High" | "Critical"

export type Severity = "low" | "medium" | "high" | "critical"

export type Overview = {
  activeAttackers: number
  deceptionEngagement: string
  dwellTimeGained: string
  realAssetsProtected: number
  zeroFalsePositives: boolean
  riskLevel: RiskLevel
  activeCampaign: string
}

export type Attacker = {
  attackerId: string
  entryPoint: string
  currentPrivilege: string
  lastSeenAt: string // ISO string
}

export type TimelineEvent = {
  time: string
  label: string
  detail?: string
  severity: Severity
}

export type CredentialUsageItem = {
  name: string
  alerts: number
  sessions: number
}

export type CredentialWarning = {
  label: string
  kind: "destructive" | "accent"
}

export type DeceptionMetricItem = {
  label: string
  value?: string
  kind: "destructive" | "accent" | "chart3"
}

export type MitreMatrixData = {
  tactics: string[]
  // [tacticIndex][rowIndex] => heat level
  matrix: number[][]
}

export type LateralNode = {
  id: string
  label: string
  x: number
  y: number
}

export type LateralEdge = {
  from: string
  to: string
}

export type LateralMovementData = {
  nodes: LateralNode[]
  edges: LateralEdge[]
}

export type CommandActivityItem = {
  name: string
  severity: number // 0-100
}

export type BehaviorItem = {
  label: string
  kind: "destructive" | "chart3"
}

export type BehaviorAnalysisData = {
  behaviors: BehaviorItem[]
  threatConfidencePct: number // 0-100
}

export type IncidentSlice = {
  name: string
  value: number
}

export type IncidentLegendItem = {
  label: string
  kind: "secondary" | "primary" | "chart3"
  pct?: string
}

export type IncidentSummaryData = {
  slices: IncidentSlice[]
  legend: IncidentLegendItem[]
}

export type ActivityBar = {
  name: string
  value: number
}

export type DashboardData = {
  overview: Overview
  attacker: Attacker
  timeline: TimelineEvent[]
  credentialUsage: {
    credentials: CredentialUsageItem[]
    warnings: CredentialWarning[]
  }
  deceptionMetrics: {
    items: DeceptionMetricItem[]
  }
  mitre: MitreMatrixData
  lateralMovement: LateralMovementData
  commandActivity: CommandActivityItem[]
  behaviorAnalysis: BehaviorAnalysisData
  incidentSummary: IncidentSummaryData
  activityChart: ActivityBar[]
}

export type DashboardResponse = {
  data: DashboardData
  generatedAt: string // ISO string
}

