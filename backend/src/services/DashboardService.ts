import { Attacker, AttackEvent, Credential, DecoyHost, LateralMovement } from '../models';
import moment from 'moment';
import { mapToAttackerSummary, mapToDashboardData } from './AttackerMapper';

export class DashboardService {
  
  async getDashboardStats() {
    const [
      activeAttackers,
      totalEvents,
      stolenCredentials,
      compromisedHosts,
      avgDwellTime,
      blockedAttacks
    ] = await Promise.all([
      Attacker.countDocuments({ status: 'Active' }),
      AttackEvent.countDocuments(),
      Credential.countDocuments(),
      DecoyHost.countDocuments({ status: { $in: ['Compromised', 'Under Attack'] } }),
      this.calculateAverageDwellTime(),
      AttackEvent.countDocuments({ status: { $in: ['Blocked', 'Contained'] } })
    ]);

    const totalHosts = await DecoyHost.countDocuments();
    const engagementRate = totalHosts > 0 ? (compromisedHosts / totalHosts) * 100 : 0;
    const totalDwellTime = await this.calculateTotalDwellTime();

    return {
      activeAttackers,
      deceptionEngagement: {
        rate: Math.round(engagementRate),
        level: engagementRate > 70 ? 'High' : engagementRate > 40 ? 'Medium' : 'Low'
      },
      dwellTime: {
        hours: Math.floor(totalDwellTime),
        minutes: Math.round((totalDwellTime % 1) * 60),
        average: Math.round(avgDwellTime)
      },
      realAssetsProtected: 15,
      metrics: {
        totalEvents,
        stolenCredentials,
        compromisedHosts,
        blockedAttacks,
        falsePositives: 0
      }
    };
  }
  async getMappedActiveAttackers() {
    const attackers = await Attacker.find({ status: 'Active' })
      .sort({ lastSeen: -1 })
      .limit(20)
      .lean();
    
    return attackers.map((a: any) => mapToAttackerSummary(a));
  }
  async getAttackerDashboard(attackerId: string) {
    const attacker = await Attacker.findOne({ attackerId }).lean();
    if (!attacker) return null;
    
    const dashboard = await mapToDashboardData(attacker);
    
    return {
      id: attacker.attackerId,
      attackerId: attacker.attackerId,
      generatedAt: new Date().toISOString(),
      dashboard,
    };
  }

  async getAttackerProfile(attackerId: string) {
    const attacker = await Attacker.findOne({ attackerId }).lean();
    if (!attacker) return null;

    const [credentials, recentEvents, movements] = await Promise.all([
      Credential.find({ attackerId }).sort({ timestamp: -1 }).limit(10).lean(),
      AttackEvent.find({ attackerId }).sort({ timestamp: -1 }).limit(5).lean(),
      LateralMovement.find({ attackerId }).sort({ timestamp: -1 }).lean()
    ]);

    return {
      attackerId: attacker.attackerId,
      ipAddress: attacker.ipAddress,
      entryPoint: attacker.entryPoint,
      currentPrivilege: attacker.currentPrivilege,
      riskLevel: attacker.riskLevel,
      campaign: attacker.campaign,
      firstSeen: attacker.firstSeen,
      lastSeen: attacker.lastSeen,
      dwellTime: this.formatDwellTime(attacker.dwellTime),
      status: attacker.status,
      geolocation: attacker.geolocation,
      fingerprint: attacker.fingerprint,
      credentials: credentials.map(c => ({
        username: c.username,
        source: c.source,
        timestamp: c.timestamp,
        riskScore: c.riskScore
      })),
      recentEvents: recentEvents.map(e => ({
        type: e.type,
        timestamp: e.timestamp,
        description: e.description
      })),
      lateralMovement: movements.map(m => ({
        from: m.sourceHost,
        to: m.targetHost,
        method: m.method,
        successful: m.successful
      }))
    };
  }

  async getAttackTimeline(attackerId?: string, hours = 24) {
    const query: any = { timestamp: { $gte: moment().subtract(hours, 'hours').toDate() } };
    if (attackerId) query.attackerId = attackerId;

    const events = await AttackEvent.find(query).sort({ timestamp: 1 }).lean();

    return events.map(e => ({
      time: moment(e.timestamp).format('HH:mm'),
      type: e.type,
      technique: e.technique,
      description: e.description,
      severity: e.severity,
      status: e.status
    }));
  }

  async getMitreMatrix(attackerId?: string) {
    const tactics = [
      'Initial Access', 'Execution', 'Persistence', 'Privilege Escalation',
      'Defense Evasion', 'Credential Access', 'Discovery', 'Lateral Movement',
      'Collection', 'Command and Control', 'Exfiltration', 'Impact'
    ];

    const query: any = {};
    if (attackerId) query.attackerId = attackerId;

    const events = await AttackEvent.find(query).lean();
    
    const matrix: any = {};
    tactics.forEach(tactic => {
      matrix[tactic] = { techniques: [], coverage: 0, color: 'none' };
    });

    events.forEach(event => {
      if (matrix[event.tactic]) {
        const existing = matrix[event.tactic].techniques.find((t: any) => t.id === event.technique);
        if (!existing) {
          matrix[event.tactic].techniques.push({
            id: event.technique,
            name: event.description.split(':')[0] || event.description,
            count: 1,
            severity: event.severity
          });
        } else {
          existing.count++;
        }
      }
    });

    Object.keys(matrix).forEach(tactic => {
      const techniqueCount = matrix[tactic].techniques.length;
      matrix[tactic].coverage = techniqueCount;
      if (techniqueCount === 0) matrix[tactic].color = 'none';
      else if (techniqueCount <= 2) matrix[tactic].color = 'low';
      else if (techniqueCount <= 4) matrix[tactic].color = 'medium';
      else matrix[tactic].color = 'high';
    });

    return matrix;
  }

  async getLateralMovementGraph(attackerId?: string) {
    const query: any = {};
    if (attackerId) query.attackerId = attackerId;

    const [movements, hosts] = await Promise.all([
      LateralMovement.find(query).lean(),
      DecoyHost.find().lean()
    ]);

    const nodes = hosts.map(h => ({
      id: h.hostname,
      label: h.hostname,
      type: h.segment,
      status: h.status,
      os: h.os
    }));

    const edges = movements.map(m => ({
      from: m.sourceHost,
      to: m.targetHost,
      label: m.method,
      successful: m.successful
    }));

    return { nodes, edges };
  }

  async getCommandActivity(attackerId?: string, limit = 10) {
    const query: any = { type: 'Command Execution' };
    if (attackerId) query.attackerId = attackerId;

    const events = await AttackEvent.find(query).sort({ timestamp: -1 }).limit(limit).lean();

    return events.map(e => ({
      command: e.command || e.description,
      timestamp: e.timestamp,
      target: e.targetHost,
      technique: e.technique
    }));
  }

  async getDeceptionMetrics() {
    const timeframes = [1, 7, 30];
    const metrics: any = {};

    for (const days of timeframes) {
      const startDate = moment().subtract(days, 'days').toDate();
      
      const [decoyAccesses, uniqueAttackers, credentialsHarvested] = await Promise.all([
        AttackEvent.countDocuments({ timestamp: { $gte: startDate } }),
        Attacker.countDocuments({ firstSeen: { $gte: startDate } }),
        Credential.countDocuments({ timestamp: { $gte: startDate } })
      ]);

      metrics[`days${days}`] = {
        decoyAccesses,
        uniqueAttackers,
        credentialsHarvested,
        realDamagePrevented: decoyAccesses * 3
      };
    }

    return metrics;
  }
  async getActiveAttackers() {
    const { Attacker } = require('../models');
    const attackers = await Attacker.find({ status: 'Active' })
      .sort({ lastSeen: -1 })
      .limit(20)
      .lean();
    
    return attackers.map((a: any) => ({
      attackerId: a.attackerId,
      ipAddress: a.ipAddress,
      entryPoint: a.entryPoint,
      currentPrivilege: a.currentPrivilege,
      riskLevel: a.riskLevel,
      campaign: a.campaign,
      lastSeen: a.lastSeen,
      dwellTime: a.dwellTime
    }));
  }

  async getAttackerBehaviorAnalysis(attackerId?: string) {
    const query: any = {};
    if (attackerId) query.attackerId = attackerId;

    const events = await AttackEvent.find(query).lean();
    
    const behaviors = {
      privilegeEscalation: events.filter(e => e.type === 'Privilege Escalation').length > 0,
      credentialDumping: events.filter(e => 
        e.description.toLowerCase().includes('mimikatz') || 
        e.description.toLowerCase().includes('credential')
      ).length > 0,
      lateralMovement: events.filter(e => e.type === 'Lateral Movement').length > 0,
      dataExfiltration: events.filter(e => e.type === 'Data Exfiltration').length > 0,
      persistence: events.filter(e => e.type === 'Persistence').length > 0,
      defenseEvasion: events.filter(e => e.type === 'Defense Evasion').length > 0
    };

    const behaviorCount = Object.values(behaviors).filter(Boolean).length;
    const threatConfidence = behaviorCount >= 4 ? 'High' : behaviorCount >= 2 ? 'Medium' : 'Low';

    return { behaviors, threatConfidence };
  }

  async getIncidentSummary() {
    const events = await AttackEvent.find().lean();
    
    const summary = {
      dataExfiltrationAttempt: { count: 0, percentage: 0 },
      lateralMovement: { count: 0, percentage: 0 },
      credentialTheft: { count: 0, percentage: 0 },
      privilegeEscalation: { count: 0, percentage: 0 }
    };

    events.forEach(e => {
      if (e.type === 'Data Exfiltration') summary.dataExfiltrationAttempt.count++;
      if (e.type === 'Lateral Movement') summary.lateralMovement.count++;
      if (e.type === 'Credential Theft') summary.credentialTheft.count++;
      if (e.type === 'Privilege Escalation') summary.privilegeEscalation.count++;
    });

    const total = events.length || 1;
    Object.keys(summary).forEach(key => {
      summary[key as keyof typeof summary].percentage = 
        Math.round((summary[key as keyof typeof summary].count / total) * 100);
    });

    return summary;
  }

  private async calculateAverageDwellTime(): Promise<number> {
    const result = await Attacker.aggregate([
      { $match: { dwellTime: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$dwellTime' } } }
    ]);
    return result[0]?.avg || 0;
  }

  private async calculateTotalDwellTime(): Promise<number> {
    const result = await Attacker.aggregate([
      { $group: { _id: null, total: { $sum: '$dwellTime' } } }
    ]);
    return (result[0]?.total || 0) / 60;
  }

  private formatDwellTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  }
}