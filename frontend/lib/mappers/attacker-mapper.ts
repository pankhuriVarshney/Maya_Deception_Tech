import type { AttackerSummary, AttackerDetails } from "@/types"
import type { DashboardData, Overview, Attacker, TimelineEvent, MitreMatrixData, LateralMovementData, CommandActivityItem, BehaviorAnalysisData, IncidentSummaryData, ActivityBar, CredentialUsageData, DeceptionMetricsData } from "@/lib/dashboard/types"

// Map backend MongoDB attacker to frontend AttackerSummary
export function mapToAttackerSummary(dbAttacker: any): AttackerSummary {
  return {
    id: dbAttacker.attackerId,
    attackerId: dbAttacker.attackerId,
    ipAddress: dbAttacker.ipAddress,
    entryPoint: dbAttacker.entryPoint,
    currentHost: dbAttacker.entryPoint, // Use entryPoint as currentHost
    currentPrivilege: dbAttacker.currentPrivilege,
    riskLevel: dbAttacker.riskLevel,
    campaign: dbAttacker.campaign,
    lastSeenAt: dbAttacker.lastSeen,
    dwellTime: dbAttacker.dwellTime,
    // Calculate engagement level based on dwell time
    engagementLevel: calculateEngagementLevel(dbAttacker.dwellTime),
    // Calculate concern level based on risk
    concernLevel: dbAttacker.riskLevel,
    // Calculate threat confidence (mock calculation)
    threatConfidence: calculateThreatConfidence(dbAttacker),
    status: dbAttacker.status,
  }
}

// Map to AttackerDetails for individual attacker page
export function mapToAttackerDetails(dbAttacker: any, dashboard: DashboardData | null = null): AttackerDetails {
  return {
    id: dbAttacker.attackerId,
    attackerId: dbAttacker.attackerId,
    generatedAt: new Date().toISOString(),
    dashboard: dashboard || createMockDashboard(dbAttacker),
  }
}

// Calculate engagement level based on dwell time
function calculateEngagementLevel(dwellTime: number): "High" | "Medium" | "Low" {
  if (dwellTime > 60) return "High"
  if (dwellTime > 30) return "Medium"
  return "Low"
}

// Calculate threat confidence percentage
function calculateThreatConfidence(attacker: any): number {
  let score = 50
  if (attacker.riskLevel === "Critical") score += 30
  else if (attacker.riskLevel === "High") score += 20
  else if (attacker.riskLevel === "Medium") score += 10
  
  if (attacker.currentPrivilege === "Admin") score += 10
  if (attacker.dwellTime > 60) score += 10
  
  return Math.min(100, score)
}

// Create mock dashboard data for an attacker
function createMockDashboard(attacker: any): DashboardData {
  return {
    overview: createOverview(attacker),
    attacker: mapToDashboardAttacker(attacker),
    timeline: createTimeline(attacker),
    mitre: createMitreMatrix(attacker),
    lateralMovement: createLateralMovement(attacker),
    commandActivity: createCommandActivity(attacker),
    behaviorAnalysis: createBehaviorAnalysis(attacker),
    incidentSummary: createIncidentSummary(attacker),
    activityChart: createActivityChart(attacker),
    credentialUsage: createCredentialUsage(attacker),
    deceptionMetrics: createDeceptionMetrics(attacker),
  }
}

function createOverview(attacker: any): Overview {
  return {
    activeAttackers: 2, // You should query this from DB
    deceptionEngagement: attacker.riskLevel === "Critical" ? "High" : "Medium",
    dwellTimeGained: `${Math.floor(attacker.dwellTime / 60)}h ${attacker.dwellTime % 60}m`,
    realAssetsProtected: 15,
    zeroFalsePositives: true,
    riskLevel: attacker.riskLevel,
    activeCampaign: attacker.campaign,
  }
}

function mapToDashboardAttacker(attacker: any): Attacker {
  return {
    attackerId: attacker.attackerId,
    entryPoint: attacker.entryPoint,
    currentPrivilege: attacker.currentPrivilege,
    lastSeenAt: attacker.lastSeen,
  }
}

function createTimeline(attacker: any): TimelineEvent[] {
  const events: TimelineEvent[] = []
  const baseTime = new Date(attacker.firstSeen)
  
  events.push({
    time: baseTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    label: "Initial Access",
    severity: "high",
    detail: `Entry via ${attacker.entryPoint}`,
  })
  
  if (attacker.currentPrivilege === "Admin") {
    events.push({
      time: new Date(baseTime.getTime() + 30 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      label: "Privilege Escalation",
      severity: "critical",
      detail: "Obtained admin access",
    })
  }
  
  events.push({
    time: new Date(attacker.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    label: "Last Activity",
    severity: "medium",
    detail: "Active session",
  })
  
  return events
}

function createMitreMatrix(attacker: any): MitreMatrixData {
  const tactics = ["Initial Access", "Execution", "Persistence", "Privilege Escalation", "Defense Evasion", "Credential Access"]
  
  // Create heatmap based on attacker activity
  const matrix: number[][] = []
  for (let i = 0; i < tactics.length; i++) {
    const row: number[] = []
    for (let j = 0; j < 5; j++) {
      // Higher activity for critical/high risk attackers
      if (attacker.riskLevel === "Critical" && i < 4) {
        row.push(Math.floor(Math.random() * 2) + 2) // 2-3 (medium-high)
      } else if (attacker.riskLevel === "High" && i < 3) {
        row.push(Math.floor(Math.random() * 2) + 1) // 1-2 (low-medium)
      } else {
        row.push(Math.floor(Math.random() * 2)) // 0-1 (none-low)
      }
    }
    matrix.push(row)
  }
  
  return { tactics, matrix }
}

function createLateralMovement(attacker: any): LateralMovementData {
  const nodes = [
    { id: "entry", label: attacker.entryPoint, x: 50, y: 20 },
    { id: "pivot1", label: "fake-jump-01", x: 180, y: 20 },
    { id: "target", label: "fake-rdp-01", x: 310, y: 20 },
  ]
  
  const edges = [
    { from: "entry", to: "pivot1" },
    { from: "pivot1", to: "target" },
  ]
  
  return { nodes, edges }
}

function createCommandActivity(attacker: any): CommandActivityItem[] {
  const commands = [
    { name: "whoami", severity: 30 },
    { name: "net user", severity: 60 },
    { name: "mimikatz", severity: 95 },
  ]
  return commands
}

function createBehaviorAnalysis(attacker: any): BehaviorAnalysisData {
  const behaviors = [
    { label: "Credential Dumping", kind: "destructive" as const },
    { label: "Lateral Movement", kind: "destructive" as const },
    { label: "Privilege Escalation", kind: "chart3" as const },
  ]
  
  return {
    behaviors,
    threatConfidencePct: calculateThreatConfidence(attacker),
  }
}

function createIncidentSummary(attacker: any): IncidentSummaryData {
  return {
    slices: [
      { value: 40, label: "Reconnaissance" },
      { value: 35, label: "Exploitation" },
      { value: 25, label: "Exfiltration" },
    ],
    legend: [
      { label: "Reconnaissance", kind: "secondary" as const, pct: "40%" },
      { label: "Exploitation", kind: "primary" as const, pct: "35%" },
      { label: "Exfiltration", kind: "chart3" as const, pct: "25%" },
    ],
  }
}

function createActivityChart(attacker: any): ActivityBar[] {
  return [
    { name: "Mon", value: 12 },
    { name: "Tue", value: 19 },
    { name: "Wed", value: 15 },
    { name: "Thu", value: 25 },
    { name: "Fri", value: 22 },
    { name: "Sat", value: 8 },
  ]
}

function createCredentialUsage(attacker: any): CredentialUsageData {
  return {
    credentials: [
      { name: "admin_user", alerts: 3, sessions: 5 },
      { name: "db_service", alerts: 1, sessions: 2 },
      { name: "backup_account", alerts: 0, sessions: 1 },
    ],
    warnings: [
      { label: "Admin credentials compromised", kind: "destructive" as const },
      { label: "Multiple failed login attempts", kind: "accent" as const },
    ],
  }
}

function createDeceptionMetrics(attacker: any): DeceptionMetricsData {
  return {
    items: [
      { label: "Decoys Deployed", value: "12", kind: "chart3" as const },
      { label: "Attackers Engaged", value: "2", kind: "destructive" as const },
      { label: "Sessions Tracked", value: "8", kind: "accent" as const },
    ],
  }
}