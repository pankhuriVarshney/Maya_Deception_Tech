import { AttackEvent, Credential, LateralMovement, DecoyHost } from '../models';

export function mapToAttackerSummary(dbAttacker: any): any {
  const dwellTime = resolveDwellTimeMinutes(dbAttacker);
  // Ensure engagement level is calculated
  const engagementLevel = calculateEngagementLevel(dwellTime);
  
  // Map riskLevel to concernLevel (they're the same concept)
  const concernLevel = dbAttacker.riskLevel;
  
  // Calculate threat confidence
  const threatConfidence = calculateThreatConfidence(dbAttacker);
  
  return {
    // Both id and attackerId for compatibility
    id: dbAttacker.attackerId,
    attackerId: dbAttacker.attackerId,
    
    // Required fields for frontend
    ipAddress: dbAttacker.ipAddress,
    entryPoint: dbAttacker.entryPoint,
    currentHost: dbAttacker.entryPoint || dbAttacker.currentHost || 'unknown',
    currentPrivilege: dbAttacker.currentPrivilege || 'User',
    riskLevel: dbAttacker.riskLevel || 'Medium',
    campaign: dbAttacker.campaign || 'Unknown',
    lastSeenAt: dbAttacker.lastSeen || new Date().toISOString(),
    dwellTime,
    
    // Calculated fields
    engagementLevel: engagementLevel,
    concernLevel: concernLevel,
    threatConfidence: threatConfidence,
    status: dbAttacker.status || 'Active',
  };
}

function calculateEngagementLevel(dwellTime: number): string {
  if (dwellTime > 60) return "High";
  if (dwellTime > 30) return "Medium";
  return "Low";
}

function calculateThreatConfidence(attacker: any): number {
  const dwellTime = resolveDwellTimeMinutes(attacker);
  let score = 50;
  if (attacker.riskLevel === "Critical") score += 30;
  else if (attacker.riskLevel === "High") score += 20;
  else if (attacker.riskLevel === "Medium") score += 10;
  if (attacker.currentPrivilege === "Admin" || attacker.currentPrivilege === "root") score += 10;
  if (dwellTime > 60) score += 10;
  return Math.min(100, Math.max(0, score));
}

export async function mapToDashboardData(dbAttacker: any): Promise<any> {
  const attackerId = dbAttacker.attackerId;
  const dwellTime = resolveDwellTimeMinutes(dbAttacker);
  
  // Query REAL data from MongoDB
  const [
    events,
    credentials,
    movements,
    decoys,
    realAssetsCount,
    activeAttackers
  ] = await Promise.all([
    AttackEvent.find({ attackerId }).sort({ timestamp: -1 }).limit(10).lean(),
    Credential.find({ attackerId }).sort({ timestamp: -1 }).limit(5).lean(),
    LateralMovement.find({ attackerId }).sort({ timestamp: 1 }).limit(5).lean(),
    DecoyHost.find({ attackerIds: attackerId }).lean(),

    // Real production assets
    DecoyHost.countDocuments({
      segment: { $in: ['corp', 'production', 'internal'] }
    }),

    // Active attackers count (instead of separate await later)
    getActiveAttackerCount()
  ]);

  return {
    overview: {
      activeAttackers,
      deceptionEngagement: calculateEngagement(dbAttacker, events),
      dwellTimeGained: formatDwellTime(dwellTime),
      realAssetsProtected: realAssetsCount,
      zeroFalsePositives: events.some((e: any) => e.status === 'False Positive') === false,
      riskLevel: dbAttacker.riskLevel,
      activeCampaign: dbAttacker.campaign,
    },
    attacker: {
      attackerId: dbAttacker.attackerId,
      entryPoint: dbAttacker.entryPoint,
      currentPrivilege: dbAttacker.currentPrivilege,
      lastSeenAt: dbAttacker.lastSeen,
    },
    timeline: events.length > 0 ? events.map((e: any) => ({
      eventId: e.eventId || e._id?.toString(),
      time: new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      label: e.type,
      severity: mapSeverity(e.severity),
      detail: e.description,
    })) : createDefaultTimeline(dbAttacker),
    mitre: generateMitreFromEvents(events),
    lateralMovement: generateMovementFromData(movements, dbAttacker),
    commandActivity: events
      .filter((e: any) => e.type === 'Command Execution' || e.command)
      .map((e: any) => ({ 
        name: e.command || e.description.substring(0, 30), 
        severity: mapSeverityValue(e.severity) 
      })) || createDefaultCommands(),
    behaviorAnalysis: analyzeBehaviors(events, dbAttacker),
    incidentSummary: generateSummaryFromEvents(events),
    activityChart: generateActivityChart(events),
    credentialUsage: generateCredentialUsage(credentials),
    deceptionMetrics: generateDeceptionMetrics(decoys, events),
  };
}

// Helper functions
// function calculateEngagementLevel(dwellTime: number): string {
//   if (dwellTime > 60) return "High";
//   if (dwellTime > 30) return "Medium";
//   return "Low";
// }

// function calculateThreatConfidence(attacker: any): number {
//   let score = 50;
//   if (attacker.riskLevel === "Critical") score += 30;
//   else if (attacker.riskLevel === "High") score += 20;
//   else if (attacker.riskLevel === "Medium") score += 10;
//   if (attacker.currentPrivilege === "Admin") score += 10;
//   if (attacker.dwellTime > 60) score += 10;
//   return Math.min(100, score);
// }

async function getActiveAttackerCount(): Promise<number> {
  const { Attacker } = require('../models');
  return Attacker.countDocuments({ status: 'Active' });
}

function calculateEngagement(attacker: any, events: any[]): string {
  if (events.length > 10 || attacker.riskLevel === 'Critical') return "High";
  if (events.length > 5 || attacker.riskLevel === 'High') return "Medium";
  return "Low";
}

function formatDwellTime(minutes: number): string {
  const safeMinutes = Math.max(0, Math.floor(minutes || 0));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${hours}h ${mins}m`;
}

function resolveDwellTimeMinutes(attacker: any): number {
  const stored = Number(attacker?.dwellTime);
  if (Number.isFinite(stored) && stored > 0) {
    return Math.floor(stored);
  }

  const startTime = new Date(attacker?.firstSeen || attacker?.createdAt).getTime();
  if (!Number.isFinite(startTime)) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - startTime) / 60000));
}

function mapSeverity(severity: string): string {
  const map: Record<string, string> = {
    'Critical': 'critical',
    'High': 'high',
    'Medium': 'medium',
    'Low': 'low',
  };
  return map[severity] || 'low';
}

function mapSeverityValue(severity: string): number {
  const map: Record<string, number> = {
    'Critical': 95,
    'High': 75,
    'Medium': 50,
    'Low': 25,
  };
  return map[severity] || 30;
}

function createDefaultTimeline(attacker: any): any[] {
  const events = [];
  const baseTime = new Date(attacker.firstSeen);
  
  events.push({
    time: baseTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    label: "Initial Access",
    severity: "high",
    detail: `Entry via ${attacker.entryPoint}`,
  });
  
  if (attacker.currentPrivilege === "Admin") {
    events.push({
      time: new Date(baseTime.getTime() + 30 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      label: "Privilege Escalation",
      severity: "critical",
      detail: "Obtained admin access",
    });
  }
  
  events.push({
    time: new Date(attacker.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    label: "Last Activity",
    severity: "medium",
    detail: "Active session",
  });
  
  return events;
}

function generateMitreFromEvents(events: any[]): any {
  // Use real 14 tactics from MITRE
  const tactics = [
    'Reconnaissance', 'Resource Development', 'Initial Access', 'Execution',
    'Persistence', 'Privilege Escalation', 'Defense Evasion', 'Credential Access',
    'Discovery', 'Lateral Movement', 'Collection', 'Command and Control',
    'Exfiltration', 'Impact'
  ];

  if (events.length === 0) {
    return {
      tactics,
      matrix: Array(14).fill(Array(5).fill(0)),
    };
  }

  // Build matrix from real MITRE data in events
  const matrix: number[][] = tactics.map(() => Array(5).fill(0));
  
  // Track technique counts per tactic
  const tacticTechCounts: Record<string, Map<string, number>> = {};
  
  events.forEach((event: any) => {
    // Use the new MITRE fields if available, fallback to legacy
    const tacticName = event.tacticName || event.tactic || 'Unknown';
    const techniqueId = event.technique || 'TXXXX';
    
    // Map tactic name to index
    const tacticIndex = tactics.findIndex(t => 
      t.toLowerCase().replace(/\s+/g, '-') === tacticName.toLowerCase().replace(/\s+/g, '-') ||
      t === tacticName
    );
    
    if (tacticIndex >= 0) {
      // Track unique techniques per tactic
      if (!tacticTechCounts[tacticIndex]) {
        tacticTechCounts[tacticIndex] = new Map();
      }
      const currentCount = tacticTechCounts[tacticIndex].get(techniqueId) || 0;
      tacticTechCounts[tacticIndex].set(techniqueId, currentCount + 1);
      
      // Fill matrix based on confidence/severity
      const severityValue = event.mitreConfidence || 
        (event.severity === 'Critical' ? 0.9 : 
         event.severity === 'High' ? 0.7 : 
         event.severity === 'Medium' ? 0.5 : 0.3);
      
      const row = Math.min(4, Math.floor(severityValue * 5));
      matrix[tacticIndex][row] = Math.min(3, (matrix[tacticIndex][row] || 0) + 1);
    }
  });

  // Add metadata about technique diversity
  const techniqueDiversity = Object.entries(tacticTechCounts).map(([tacticIdx, techniques]) => ({
    tactic: tactics[parseInt(tacticIdx)],
    uniqueTechniques: techniques.size,
    topTechnique: Array.from(techniques.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
  }));

  return { 
    tactics, 
    matrix,
    techniqueDiversity,
    totalEvents: events.length,
    classifiedEvents: events.filter((e: any) => e.technique && e.technique !== 'TXXXX').length
  };
}

function generateMovementFromData(movements: any[], attacker: any): any {
  const attackerIp = attacker?.ipAddress || attacker?.attackerId || "Unknown Attacker";
  const entryPoint = attacker?.entryPoint || attacker?.currentHost || "Unknown Host";

  if (movements.length === 0) {
    return {
      nodes: [
        { id: "attacker", label: attackerIp, x: 50, y: 20 },
        { id: "entry", label: entryPoint, x: 180, y: 20 },
      ],
      edges: [{ from: "attacker", to: "entry", label: "Initial Access" }],
    };
  }

  const path: string[] = [attackerIp];

  for (const movement of movements) {
    const source = movement.sourceHost || entryPoint;
    const target = movement.targetHost;

    if (path.length === 1) {
      path.push(source);
    } else if (path[path.length - 1] !== source && !path.includes(source)) {
      path.push(source);
    }

    if (target && path[path.length - 1] !== target) {
      path.push(target);
    }
  }

  if (path.length === 1) {
    path.push(entryPoint);
  }

  const step = path.length > 1 ? 280 / (path.length - 1) : 0;
  const nodes = path.map((label, idx) => ({
    id: `node-${idx}`,
    label,
    x: 30 + (idx * step),
    y: 20,
  }));

  const edges = path.slice(1).map((_, idx) => {
    const movement = idx === 0 ? null : movements[idx - 1];
    return {
      from: `node-${idx}`,
      to: `node-${idx + 1}`,
      label: movement?.credentialsUsed || movement?.method || "Initial Access",
    };
  });

  return { nodes, edges };
}

function createDefaultCommands(): any[] {
  return [
    { name: "whoami", severity: 30 },
    { name: "net user", severity: 60 },
  ];
}

function analyzeBehaviors(events: any[], attacker: any): any {
  const behaviors = [];
  
  // Use real MITRE tactic classifications
  const tacticCounts: Record<string, number> = {};
  events.forEach((e: any) => {
    const tactic = e.tactic || 'unknown';
    tacticCounts[tactic] = (tacticCounts[tactic] || 0) + 1;
  });

  // Map tactics to behavior labels
  if (tacticCounts['credential-access'] || tacticCounts['Credential Access']) {
    behaviors.push({ label: "Credential Dumping", kind: "destructive" });
  }
  if (tacticCounts['lateral-movement'] || tacticCounts['Lateral Movement']) {
    behaviors.push({ label: "Lateral Movement", kind: "destructive" });
  }
  if (tacticCounts['privilege-escalation'] || tacticCounts['Privilege Escalation']) {
    behaviors.push({ label: "Privilege Escalation", kind: "chart3" });
  }
  if (tacticCounts['defense-evasion'] || tacticCounts['Defense Evasion']) {
    behaviors.push({ label: "Defense Evasion", kind: "destructive" });
  }
  if (tacticCounts['command-and-control'] || tacticCounts['Command and Control']) {
    behaviors.push({ label: "Command & Control", kind: "chart3" });
  }
  if (tacticCounts['discovery'] || tacticCounts['Discovery']) {
    behaviors.push({ label: "Discovery", kind: "chart3" });
  }
  if (tacticCounts['exfiltration'] || tacticCounts['Exfiltration']) {
    behaviors.push({ label: "Data Exfiltration", kind: "destructive" });
  }
  
  // Fallback to legacy type checking if no MITRE data
  if (behaviors.length === 0) {
    const hasCredentialTheft = events.some((e: any) => e.type === 'Credential Theft');
    const hasLateralMovement = events.some((e: any) => e.type === 'Lateral Movement');
    const hasPrivilegeEscalation = events.some((e: any) => e.type === 'Privilege Escalation');
    
    if (hasCredentialTheft) behaviors.push({ label: "Credential Dumping", kind: "destructive" });
    if (hasLateralMovement) behaviors.push({ label: "Lateral Movement", kind: "destructive" });
    if (hasPrivilegeEscalation) behaviors.push({ label: "Privilege Escalation", kind: "chart3" });
  }
  
  if (behaviors.length === 0) {
    behaviors.push({ label: "Reconnaissance", kind: "chart3" });
  }

  // Calculate threat confidence based on MITRE confidence scores
  const avgConfidence = events.length > 0
    ? events.reduce((sum: number, e: any) => sum + (e.mitreConfidence || 0), 0) / events.length
    : 0.5;

  let threatPct = Math.round(avgConfidence * 100);
  if (attacker.riskLevel === "Critical") threatPct = Math.max(threatPct, 90);
  else if (attacker.riskLevel === "High") threatPct = Math.max(threatPct, 75);
  else if (attacker.riskLevel === "Medium") threatPct = Math.max(threatPct, 50);

  return { 
    behaviors, 
    threatConfidencePct: threatPct,
    avgMitreConfidence: Math.round(avgConfidence * 100) / 100,
    tacticsObserved: Object.keys(tacticCounts).length
  };
}
function generateSummaryFromEvents(events: any[]): any {
  const types = events.reduce((acc: any, e: any) => {
    acc[e.type] = (acc[e.type] || 0) + 1;
    return acc;
  }, {});

  const total = events.length || 1;
  
  return {
    slices: [
      { value: types['Initial Access'] || 0, label: "Initial Access" },
      { value: types['Lateral Movement'] || 0, label: "Lateral Movement" },
      { value: types['Credential Theft'] || 0, label: "Credential Theft" },
    ],
    legend: [
      { label: "Initial Access", kind: "secondary", pct: `${Math.round(((types['Initial Access'] || 0) / total) * 100)}%` },
      { label: "Lateral Movement", kind: "primary", pct: `${Math.round(((types['Lateral Movement'] || 0) / total) * 100)}%` },
      { label: "Credential Theft", kind: "chart3", pct: `${Math.round(((types['Credential Theft'] || 0) / total) * 100)}%` },
    ],
  };
}

function generateActivityChart(events: any[]): any[] {
  const result: { name: string; value: number }[] = [];

  const now = new Date();

  // Create last 7 days (oldest → newest)
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(now);
    dayStart.setDate(now.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    const count = events.filter((e: any) => {
      const ts = new Date(e.timestamp);
      return ts >= dayStart && ts <= dayEnd;
    }).length;

    result.push({
      name: dayStart.toLocaleDateString('en-US', { weekday: 'short' }),
      value: count,
    });
  }

  return result;
}

function generateCredentialUsage(credentials: any[]): any {
  if (credentials.length === 0) {
    return {
      credentials: [
        { name: "admin_user", alerts: 2, sessions: 3 },
        { name: "service_account", alerts: 0, sessions: 1 },
      ],
      warnings: [
        { label: "No credential alerts", kind: "accent" },
      ],
    };
  }

  return {
    credentials: credentials.map((c: any) => ({
      name: c.username,
      alerts: c.usageCount || 0,
      sessions: c.usageCount || 1,
    })),
    warnings: credentials.some((c: any) => c.riskScore > 80) 
      ? [{ label: "High risk credentials compromised", kind: "destructive" }]
      : [{ label: "Credentials accessed", kind: "accent" }],
  };
}

function generateDeceptionMetrics(decoys: any[], events: any[]): any {
  return {
    items: [
      { label: "Decoys Deployed", value: String(decoys.length || 6), kind: "chart3" },
      { label: "Attackers Engaged", value: String(new Set(events.map((e: any) => e.attackerId)).size || 1), kind: "destructive" },
      { label: "Events Logged", value: String(events.length), kind: "accent" },
    ],
  };
}
