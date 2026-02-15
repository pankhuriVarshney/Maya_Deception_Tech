import type { DashboardData } from "@/lib/dashboard/types"

export function getMockDashboardData(now = new Date()): DashboardData {
  return {
    overview: {
      activeAttackers: 4,
      deceptionEngagement: "High Level",
      dwellTimeGained: "9h 32m",
      realAssetsProtected: 15,
      zeroFalsePositives: true,
      riskLevel: "High",
      activeCampaign: '"Shadow Hydra"',
    },
    attacker: {
      attackerId: "APT-1032",
      entryPoint: "Phishing Email",
      currentPrivilege: "Admin",
      lastSeenAt: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
    },
    timeline: [
      { time: "08:05", label: "Initial Access", detail: "Phishing Email", severity: "medium" },
      { time: "08:15", label: "Credential Theft", detail: "admin_user", severity: "high" },
      { time: "08:45", label: "Lateral Movement", detail: "to Decoy Server 2", severity: "critical" },
      { time: "09:12", label: "Command Executed", detail: "Mimikatz Dump", severity: "high" },
      { time: "09:40", label: "Data Exfiltration Attempt", severity: "critical" },
    ],
    credentialUsage: {
      credentials: [
        { name: "admin_user", alerts: 1, sessions: 3 },
        { name: "db_service", alerts: 1, sessions: 4 },
        { name: "backup_account", alerts: 1, sessions: 3 },
      ],
      warnings: [
        { label: "Elevated Privileges", kind: "destructive" },
        { label: "Lateral Movement Detected", kind: "accent" },
      ],
    },
    deceptionMetrics: {
      items: [
        { label: "Time in Deception:", value: "9h 32m", kind: "destructive" },
        { label: "Fake Assets Accessed:", value: "18", kind: "accent" },
        { label: "Real Damage Prevented", kind: "chart3" },
      ],
    },
    mitre: {
      tactics: [
        "Initial Access",
        "Execution",
        "Persistence",
        "Privilege Escalation",
        "Defense Evasion",
        "Credential Access",
      ],
      matrix: [
        [3, 2, 1, 3, 2],
        [2, 3, 2, 1, 3],
        [1, 2, 3, 2, 1],
        [3, 1, 2, 3, 2],
        [2, 3, 1, 2, 3],
        [3, 2, 3, 1, 2],
      ],
    },
    lateralMovement: {
      nodes: [
        { id: "ds1", label: "Decoy Server 1", x: 200, y: 40 },
        { id: "ddb", label: "Decoy DB", x: 360, y: 40 },
        { id: "ds2", label: "Decoy Server 2", x: 60, y: 120 },
        { id: "dad", label: "Decoy AD", x: 300, y: 120 },
        { id: "ds3", label: "Decoy Server 2", x: 180, y: 190 },
      ],
      edges: [
        { from: "ds1", to: "ddb" },
        { from: "ds2", to: "ds1" },
        { from: "ds2", to: "dad" },
        { from: "ds2", to: "ds3" },
        { from: "dad", to: "ds3" },
      ],
    },
    commandActivity: [
      { name: "mimikatz.exe", severity: 95 },
      { name: "net user /add", severity: 70 },
      { name: "powershell -exec bypass", severity: 85 },
    ],
    behaviorAnalysis: {
      behaviors: [
        { label: "Privilege Escalation", kind: "destructive" },
        { label: "Credential Dumping", kind: "chart3" },
        { label: "Data Exfiltration", kind: "destructive" },
      ],
      threatConfidencePct: 92,
    },
    incidentSummary: {
      slices: [
        { name: "Data Exfiltration Attempt", value: 40 },
        { name: "Lateral Movement", value: 35 },
        { name: "Credential Theft", value: 25 },
      ],
      legend: [
        { label: "Data Exfiltration Attempt", kind: "secondary", pct: "9%" },
        { label: "Lateral Movement", kind: "primary", pct: "4%" },
        { label: "Credential Theft", kind: "chart3" },
      ],
    },
    activityChart: [
      { name: "Recon Engagement", value: 620 },
      { name: "Netw. Scanning", value: 480 },
      { name: "Expl. Movement", value: 550 },
      { name: "Hide Your Obfusc", value: 720 },
      { name: "Decoy Interact", value: 390 },
      { name: "Create Cover", value: 680 },
    ],
  }
}

