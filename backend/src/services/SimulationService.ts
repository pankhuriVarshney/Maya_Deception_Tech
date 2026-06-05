// services/SimulationService.ts

import { EventEmitter } from 'events';
import { Attacker, AttackEvent, Credential, LateralMovement } from '../models';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class SimulationService extends EventEmitter {
  private activeSimulations: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Simulate SSH brute force attack followed by successful credential use
   */
  async simulateSSHBruteForce(params: { target: string; attempts?: number }) {
    const { target, attempts = 5 } = params;
    const attackerIp = `10.20.20.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `attacker-${attackerIp.replace(/\./g, '-')}`;
    
    logger.info(`Starting SSH brute force simulation: ${attackerIp} → ${target}`);

    // Create attacker record
    const attacker = new Attacker({
      attackerId,
      ipAddress: attackerIp,
      entryPoint: target,
      currentPrivilege: 'User',
      riskLevel: 'Medium',
      campaign: 'Simulated Attack',
      firstSeen: new Date(),
      lastSeen: new Date(),
      dwellTime: 0,
      status: 'Active'
    });
    await attacker.save();

    // Generate failed login attempts
    for (let i = 0; i < attempts; i++) {
      await this.createEvent({
        attackerId,
        type: 'Initial Access',
        technique: 'T1078',
        tactic: 'Initial Access',
        description: `Failed SSH login attempt ${i + 1}/${attempts}`,
        sourceHost: attackerIp,
        targetHost: target,
        severity: i >= attempts - 1 ? 'High' : 'Medium',
        status: 'Detected'
      });

      // Small delay between attempts
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Successful login with stolen credential
    const username = `user${Math.floor(Math.random() * 10)}`;
    const password = `pass${Math.floor(Math.random() * 100)}`;
    
    await Credential.create({
      credentialId: `cred-${uuidv4()}`,
      username,
      password,
      source: target,
      attackerId,
      decoyHost: target,
      status: 'Stolen',
      riskScore: 65,
      usageCount: 1,
      lastUsed: new Date()
    });

    await this.createEvent({
      attackerId,
      type: 'Initial Access',
      technique: 'T1078',
      tactic: 'Initial Access',
      description: `Successful SSH login with stolen credentials: ${username}`,
      sourceHost: attackerIp,
      targetHost: target,
      severity: 'High',
      status: 'Detected'
    });

    this.emit('simulationComplete', { 
      type: 'ssh-bruteforce', 
      attackerId, 
      target,
      eventsGenerated: attempts + 2 
    });

    return { success: true, attackerId, eventsGenerated: attempts + 2 };
  }

  /**
   * Simulate lateral movement between hosts
   */
  async simulateLateralMovement(params: { source: string; targets: string[] }) {
    const { source, targets } = params;
    const attackerIp = `10.20.20.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `attacker-${attackerIp.replace(/\./g, '-')}`;

    logger.info(`Starting lateral movement simulation: ${source} → [${targets.join(', ')}]`);

    // Create initial attacker
    const attacker = new Attacker({
      attackerId,
      ipAddress: attackerIp,
      entryPoint: source,
      currentPrivilege: 'User',
      riskLevel: 'High',
      campaign: 'Simulated Attack',
      firstSeen: new Date(),
      lastSeen: new Date(),
      dwellTime: 0,
      status: 'Active'
    });
    await attacker.save();

    // Initial access event
    await this.createEvent({
      attackerId,
      type: 'Initial Access',
      technique: 'T1078',
      tactic: 'Initial Access',
      description: `Initial compromise of ${source}`,
      sourceHost: attackerIp,
      targetHost: source,
      severity: 'High',
      status: 'Detected'
    });

    // Lateral movement to each target
    let currentHost = source;
    for (const target of targets) {
      await this.createEvent({
        attackerId,
        type: 'Lateral Movement',
        technique: 'T1021',
        tactic: 'Lateral Movement',
        description: `SSH pivot from ${currentHost} to ${target}`,
        sourceHost: currentHost,
        targetHost: target,
        severity: 'High',
        status: 'Detected'
      });

      await LateralMovement.create({
        movementId: `mov-${uuidv4()}`,
        attackerId,
        sourceHost: currentHost,
        targetHost: target,
        technique: 'T1021',
        method: 'SSH',
        successful: true
      });

      currentHost = target;

      // Delay between movements
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Update attacker's current location
    attacker.currentPrivilege = 'Admin';
    attacker.riskLevel = 'Critical';
    await attacker.save();

    this.emit('simulationComplete', { 
      type: 'lateral-movement', 
      attackerId, 
      path: [source, ...targets],
      eventsGenerated: targets.length + 2 
    });

    return { success: true, attackerId, path: [source, ...targets] };
  }

  /**
   * Simulate credential dumping (Mimikatz-style)
   */
  async simulateCredentialTheft(params: { target: string; tool?: string }) {
    const { target, tool = 'mimikatz' } = params;
    const attackerIp = `10.20.20.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `attacker-${attackerIp.replace(/\./g, '-')}`;

    logger.info(`Starting credential theft simulation: ${attackerIp} → ${target} (${tool})`);

    // Create attacker
    const attacker = new Attacker({
      attackerId,
      ipAddress: attackerIp,
      entryPoint: target,
      currentPrivilege: 'Admin',
      riskLevel: 'Critical',
      campaign: 'Simulated Attack',
      firstSeen: new Date(),
      lastSeen: new Date(),
      dwellTime: 0,
      status: 'Active'
    });
    await attacker.save();

    // Initial access
    await this.createEvent({
      attackerId,
      type: 'Initial Access',
      technique: 'T1078',
      tactic: 'Initial Access',
      description: `Attacker gained access to ${target}`,
      sourceHost: attackerIp,
      targetHost: target,
      severity: 'High',
      status: 'Detected'
    });

    // Credential dumping event
    await this.createEvent({
      attackerId,
      type: 'Credential Theft',
      technique: 'T1003',
      tactic: 'Credential Access',
      description: `${tool} execution detected - dumping LSASS memory`,
      sourceHost: target,
      targetHost: target,
      severity: 'Critical',
      status: 'Detected',
      command: `${tool}.exe sekurlsa::logonpasswords`
    });

    // Generate stolen credentials
    const stolenCreds = [
      { username: 'admin', password: 'Admin123!' },
      { username: 'root', password: 'root123' },
      { username: 'dbuser', password: 'dbpass123' },
      { username: 'webadmin', password: 'web2024!' }
    ];

    for (const cred of stolenCreds) {
      await Credential.create({
        credentialId: `cred-${uuidv4()}`,
        username: cred.username,
        password: cred.password,
        source: target,
        attackerId,
        decoyHost: target,
        status: 'Stolen',
        riskScore: cred.username.includes('admin') || cred.username === 'root' ? 90 : 70,
        usageCount: 0
      });

      await this.createEvent({
        attackerId,
        type: 'Credential Theft',
        technique: 'T1003',
        tactic: 'Credential Access',
        description: `Credential stolen: ${cred.username}`,
        sourceHost: target,
        targetHost: target,
        severity: 'Critical',
        status: 'Detected'
      });
    }

    this.emit('simulationComplete', { 
      type: 'credential-theft', 
      attackerId, 
      target,
      credentialsStolen: stolenCreds.length,
      eventsGenerated: stolenCreds.length + 3 
    });

    return { success: true, attackerId, credentialsStolen: stolenCreds.length };
  }

  /**
   * Simulate network discovery and reconnaissance
   */
  async simulateDiscovery(params: { source: string; scanType?: string }) {
    const { source, scanType = 'internal' } = params;
    const attackerIp = `10.20.20.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `attacker-${attackerIp.replace(/\./g, '-')}`;

    logger.info(`Starting discovery simulation: ${attackerIp} from ${source}`);

    const attacker = new Attacker({
      attackerId,
      ipAddress: attackerIp,
      entryPoint: source,
      currentPrivilege: 'User',
      riskLevel: 'Medium',
      campaign: 'Simulated Attack',
      firstSeen: new Date(),
      lastSeen: new Date(),
      dwellTime: 0,
      status: 'Active'
    });
    await attacker.save();

    const discoveryCommands = [
      'nmap -sS -sV 10.20.20.0/24',
      'netstat -tulpn',
      'cat /etc/passwd',
      'find / -name "*.conf" 2>/dev/null',
      'ps aux | grep -E "(ssh|http|mysql|postgres)"',
      'ifconfig -a',
      'cat /etc/hosts'
    ];

    for (const cmd of discoveryCommands) {
      await this.createEvent({
        attackerId,
        type: 'Discovery',
        technique: 'T1083',
        tactic: 'Discovery',
        description: `Reconnaissance command executed: ${cmd.substring(0, 50)}...`,
        sourceHost: source,
        targetHost: source,
        severity: 'Low',
        status: 'Detected',
        command: cmd
      });

      await new Promise(resolve => setTimeout(resolve, 800));
    }

    this.emit('simulationComplete', { 
      type: 'discovery', 
      attackerId, 
      source,
      eventsGenerated: discoveryCommands.length 
    });

    return { success: true, attackerId, commandsExecuted: discoveryCommands.length };
  }

  /**
   * Simulate privilege escalation
   */
  async simulatePrivilegeEscalation(params: { target: string; method?: string }) {
    const { target, method = 'sudo-exploit' } = params;
    const attackerIp = `10.20.20.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `attacker-${attackerIp.replace(/\./g, '-')}`;

    logger.info(`Starting privilege escalation simulation: ${attackerIp} → ${target}`);

    const attacker = new Attacker({
      attackerId,
      ipAddress: attackerIp,
      entryPoint: target,
      currentPrivilege: 'User',
      riskLevel: 'High',
      campaign: 'Simulated Attack',
      firstSeen: new Date(),
      lastSeen: new Date(),
      dwellTime: 0,
      status: 'Active'
    });
    await attacker.save();

    // Initial access
    await this.createEvent({
      attackerId,
      type: 'Initial Access',
      technique: 'T1078',
      tactic: 'Initial Access',
      description: `Initial user-level access to ${target}`,
      sourceHost: attackerIp,
      targetHost: target,
      severity: 'Medium',
      status: 'Detected'
    });

    // Privilege escalation attempt
    await this.createEvent({
      attackerId,
      type: 'Privilege Escalation',
      technique: 'T1068',
      tactic: 'Privilege Escalation',
      description: `${method} attempt detected`,
      sourceHost: target,
      targetHost: target,
      severity: 'High',
      status: 'Detected',
      command: method === 'sudo-exploit' ? 'sudo -l && CVE-2021-3156 exploit' : method
    });

    // Successful escalation
    await this.createEvent({
      attackerId,
      type: 'Privilege Escalation',
      technique: 'T1078',
      tactic: 'Privilege Escalation',
      description: `Successfully escalated to root/Administrator privileges`,
      sourceHost: target,
      targetHost: target,
      severity: 'Critical',
      status: 'Detected'
    });

    // Update attacker privilege
    attacker.currentPrivilege = 'Admin';
    attacker.riskLevel = 'Critical';
    await attacker.save();

    this.emit('simulationComplete', { 
      type: 'privilege-escalation', 
      attackerId, 
      target,
      eventsGenerated: 3 
    });

    return { success: true, attackerId };
  }

  /**
   * Simulate full attack campaign (multi-stage)
   */
  async simulateFullCampaign(params: { complexity?: string }) {
    const { complexity = 'advanced' } = params;
    const attackerIp = `10.20.20.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `attacker-${attackerIp.replace(/\./g, '-')}`;
    
    logger.info(`Starting full campaign simulation: ${attackerIp} (complexity: ${complexity})`);

    const attacker = new Attacker({
      attackerId,
      ipAddress: attackerIp,
      entryPoint: 'fake-web-01',
      currentPrivilege: 'User',
      riskLevel: 'Medium',
      campaign: 'Shadow Hydra',
      firstSeen: new Date(),
      lastSeen: new Date(),
      dwellTime: 0,
      status: 'Active'
    });
    await attacker.save();

    let eventCount = 0;

    // Stage 1: Initial Access
    await this.createEvent({
      attackerId,
      type: 'Initial Access',
      technique: 'T1190',
      tactic: 'Initial Access',
      description: 'Exploited public-facing application (fake-web-01)',
      sourceHost: attackerIp,
      targetHost: 'fake-web-01',
      severity: 'High',
      status: 'Detected'
    });
    eventCount++;

    await new Promise(resolve => setTimeout(resolve, 1500));

    // Stage 2: Discovery
    const discoveryCmds = ['whoami', 'uname -a', 'cat /etc/passwd'];
    for (const cmd of discoveryCmds) {
      await this.createEvent({
        attackerId,
        type: 'Discovery',
        technique: 'T1083',
        tactic: 'Discovery',
        description: `System reconnaissance: ${cmd}`,
        sourceHost: 'fake-web-01',
        targetHost: 'fake-web-01',
        severity: 'Low',
        status: 'Detected',
        command: cmd
      });
      eventCount++;
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    // Stage 3: Credential Theft
    await this.createEvent({
      attackerId,
      type: 'Credential Theft',
      technique: 'T1003',
      tactic: 'Credential Access',
      description: 'Found database credentials in web application config',
      sourceHost: 'fake-web-01',
      targetHost: 'fake-web-01',
      severity: 'High',
      status: 'Detected'
    });
    eventCount++;

    await Credential.create({
      credentialId: `cred-${uuidv4()}`,
      username: 'dbadmin',
      password: 'DbP@ss2024!',
      source: 'fake-web-01',
      attackerId,
      decoyHost: 'fake-web-01',
      status: 'Stolen',
      riskScore: 85
    });

    await new Promise(resolve => setTimeout(resolve, 1500));

    // Stage 4: Lateral Movement
    const pivotTargets = ['fake-jump-01', 'fake-ftp-01'];
    for (const target of pivotTargets) {
      await this.createEvent({
        attackerId,
        type: 'Lateral Movement',
        technique: 'T1021',
        tactic: 'Lateral Movement',
        description: `Pivoted to ${target} using stolen SSH credentials`,
        sourceHost: 'fake-web-01',
        targetHost: target,
        severity: 'High',
        status: 'Detected'
      });
      eventCount++;

      await LateralMovement.create({
        movementId: `mov-${uuidv4()}`,
        attackerId,
        sourceHost: 'fake-web-01',
        targetHost: target,
        technique: 'T1021',
        method: 'SSH',
        successful: true
      });

      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    // Stage 5: Privilege Escalation
    await this.createEvent({
      attackerId,
      type: 'Privilege Escalation',
      technique: 'T1068',
      tactic: 'Privilege Escalation',
      description: 'Exploited local privilege escalation vulnerability',
      sourceHost: 'fake-ftp-01',
      targetHost: 'fake-ftp-01',
      severity: 'Critical',
      status: 'Detected'
    });
    eventCount++;

    attacker.currentPrivilege = 'Admin';
    attacker.riskLevel = 'Critical';
    await attacker.save();

    await new Promise(resolve => setTimeout(resolve, 1500));

    // Stage 6: Data Exfiltration (simulated)
    await this.createEvent({
      attackerId,
      type: 'Data Exfiltration',
      technique: 'T1041',
      tactic: 'Exfiltration',
      description: 'Large data transfer detected to external IP',
      sourceHost: 'fake-ftp-01',
      targetHost: attackerIp,
      severity: 'Critical',
      status: 'Detected'
    });
    eventCount++;

    this.emit('simulationComplete', { 
      type: 'full-campaign', 
      attackerId, 
      campaign: 'Shadow Hydra',
      eventsGenerated: eventCount,
      stagesCompleted: 6
    });

    return { success: true, attackerId, campaign: 'Shadow Hydra', stagesCompleted: 6 };
  }

  /**
   * Helper method to create attack events and emit real-time updates
   */
  private async createEvent(eventData: any) {
    const event = new AttackEvent({
      eventId: `evt-${uuidv4()}`,
      timestamp: new Date(),
      stage: eventData.stage || this.inferStage(eventData),
      ...eventData
    });
    await event.save();
    
    // Emit real-time event for WebSocket broadcast
    this.emit('newEvent', event);
    
    return event;
  }

  /**
   * Trigger immediate CRDT sync
   */
  async triggerSync() {
    logger.info('Manual CRDT sync triggered via API');
    this.emit('triggerSync');
    return { success: true, message: 'Sync triggered' };
  }

  private inferStage(eventData: { type?: string; tactic?: string; description?: string }): string {
    const type = String(eventData.type || '').toLowerCase();
    const tactic = String(eventData.tactic || '').toLowerCase();
    const description = String(eventData.description || '').toLowerCase();

    if (type.includes('discovery') || description.includes('nmap') || description.includes('recon')) return 'RECON';
    if (type.includes('initial access') || tactic.includes('initial access')) return 'INITIAL_ACCESS';
    if (type.includes('credential') || tactic.includes('credential')) return 'CREDENTIAL_ACCESS';
    if (type.includes('lateral') || tactic.includes('lateral')) return 'LATERAL_MOVEMENT';
    if (type.includes('privilege') || tactic.includes('privilege')) return 'PRIVILEGE_ESCALATION';
    if (type.includes('command') || tactic.includes('execution')) return 'EXECUTION';
    if (type.includes('exfiltration') || tactic.includes('exfiltration')) return 'EXFILTRATION';
    return 'OTHER';
  }
}
