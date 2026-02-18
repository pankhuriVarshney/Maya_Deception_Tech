import { EventEmitter } from 'events';
import { Attacker, AttackEvent, Credential, DecoyHost, LateralMovement } from '../models';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';
import { VMStatus } from '../models';

export class CRDTSyncService extends EventEmitter {
  private syncInterval?: NodeJS.Timeout;
  private vagrantDir: string;
  private isSyncing: boolean = false;

  constructor() {
    super();
    this.vagrantDir = process.env.VAGRANT_DIR || '../simulations/fake';
  }

  startSyncLoop(intervalMs: number = 10000) {
    // Existing CRDT sync
    this.syncInterval = setInterval(() => {
      if (!this.isSyncing) {
        this.performSync().catch(err => logger.error('CRDT sync error:', err));
      }
    }, intervalMs);
  
    // NEW: VM status updates every 30 seconds
    setInterval(() => {
      this.updateVMStatusInDB().catch(err => logger.error('VM status update error:', err));
    }, 30000);
  
    // Initial VM status update
    this.updateVMStatusInDB().catch(err => logger.error('Initial VM status error:', err));
  
    logger.info(`Started CRDT sync loop with ${intervalMs}ms interval`);
  }
  
  // Converted to a proper class method
  private async updateVMStatusInDB() {
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    const fs = require('fs');
    const path = require('path');

    const vagrantDir = process.env.VAGRANT_DIR || '../simulations/fake';
    
    if (!fs.existsSync(vagrantDir)) {
      logger.warn('Vagrant directory not found');
      return;
    }

    const entries = fs.readdirSync(vagrantDir, { withFileTypes: true });
    const vmDirs = entries
      .filter((entry: any) => entry.isDirectory())
      .map((entry: any) => entry.name)
      .filter((name: string) => name.startsWith('fake-') || name === 'gateway-vm');

    for (const vmName of vmDirs) {
      const vmPath = path.join(vagrantDir, vmName);
      
      // Skip if no Vagrantfile
      if (!fs.existsSync(path.join(vmPath, 'Vagrantfile'))) {
        continue;
      }

      try {
        // Get status with timeout
        const { stdout: statusOutput } = await execAsync(
          `cd ${vmPath} && timeout 5 vagrant status --machine-readable 2>/dev/null || echo ""`,
          { timeout: 6000 }
        );

        const statusLine = statusOutput.split('\n').find((line: string) => line.includes(',state,'));
        const vagrantStatus = statusLine ? statusLine.split(',')[3] : 'unknown';
        const isRunning = vagrantStatus === 'running';

        const updateData: any = {
          vmName,
          hostname: vmName,
          status: isRunning ? 'running' : (vagrantStatus === 'unknown' ? 'unknown' : 'stopped'),
          lastSeen: new Date(),
        };

        // If running, get more details
        if (isRunning) {
          try {
            // Get IP
            const { stdout: ipOutput } = await execAsync(
              `cd ${vmPath} && timeout 3 vagrant ssh -c "hostname -I | head -1" 2>/dev/null || echo ""`,
              { timeout: 4000 }
            );
            updateData.ip = ipOutput.trim() || undefined;

            // Get CRDT stats
            const { stdout: statsOutput } = await execAsync(
              `cd ${vmPath} && timeout 3 vagrant ssh -c "sudo syslogd-helper stats 2>/dev/null || echo 'ERROR'" 2>/dev/null`,
              { timeout: 4000 }
            );

            if (statsOutput.includes('Node:')) {
              const lines = statsOutput.split('\n');
              const attackers = parseInt(lines.find((l: string) => l.includes('Attackers:'))?.split(':')[1] || '0');
              const credentials = parseInt(lines.find((l: string) => l.includes('Credentials:'))?.split(':')[1] || '0');
              const sessions = parseInt(lines.find((l: string) => l.includes('Sessions:'))?.split(':')[1] || '0');
              const hash = lines.find((l: string) => l.includes('State hash:'))?.split(':')[1]?.trim() || '';

              updateData.crdtState = { attackers, credentials, sessions, hash };
            }

            // Get Docker containers
            const { stdout: dockerOutput } = await execAsync(
              `cd ${vmPath} && timeout 3 vagrant ssh -c "sudo docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}|{{.CreatedAt}}' 2>/dev/null || echo ''" 2>/dev/null`,
              { timeout: 4000 }
            );

            if (dockerOutput.trim()) {
              updateData.dockerContainers = dockerOutput.split('\n')
                .filter((line: string) => line.includes('|'))
                .map((line: string) => {
                  const [id, name, image, containerStatus, ports, created] = line.split('|');
                  return {
                    id: id.substring(0, 12),
                    name,
                    image,
                    status: containerStatus.includes('Up') ? 'running' : 'exited',
                    ports: ports ? ports.split(', ') : [],
                    created
                  };
                });
            }
          } catch (detailError) {
            logger.warn(`Failed to get details for ${vmName}:`, detailError);
          }
        }

        // Upsert to MongoDB
        await VMStatus.findOneAndUpdate(
          { vmName },
          updateData,
          { upsert: true, new: true }
        );

        logger.info(`Updated VM status for ${vmName}: ${updateData.status}`);

      } catch (error) {
        logger.error(`Failed to update VM status for ${vmName}:`, error);
        
        // Mark as error in DB
        await VMStatus.findOneAndUpdate(
          { vmName },
          { 
            vmName,
            hostname: vmName,
            status: 'error',
            lastSeen: new Date()
          },
          { upsert: true }
        );
      }
    }
  }

  stopSyncLoop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
    }
  }

  async performSync() {
    this.isSyncing = true;
    let newEventsCount = 0;
    let attackersFound = 0;
    
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      const vmDirs = fs.readdirSync(this.vagrantDir)
        .filter(dir => fs.statSync(path.join(this.vagrantDir, dir)).isDirectory())
        .filter(dir => dir.startsWith('fake-') || dir === 'gateway-vm');

      for (const vm of vmDirs) {
        try {
          const vmPath = path.join(this.vagrantDir, vm);

          const { stdout: statusOutput } = await execAsync(
            `cd ${vmPath} && vagrant status --machine-readable`,
            { timeout: 5000 }
          );

          if (!statusOutput.includes('state-running,running')) {
            continue;
          }

          const { stdout } = await execAsync(
            `cd ${vmPath} && vagrant ssh -c "sudo cat /var/lib/.syscache 2>/dev/null || echo '{}'"`,
            { timeout: 10000 }
          );

          if (stdout && stdout.trim() !== '{}' && stdout.trim() !== '') {
            const state = JSON.parse(stdout);
            const beforeCount = Object.keys(state.attackers || {}).length;
            attackersFound += beforeCount;
            await this.processState(state, vm);
            logger.info(`Processed state from ${vm}: ${beforeCount} attackers`);
          }
        } catch (error) {
          logger.warn(`Failed to sync with ${vm}:`, (error as Error).message);
        }
      }

      logger.info(`Sync complete: ${attackersFound} attackers found across ${vmDirs.length} VMs`);
      this.emit('syncComplete', { attackersCount: attackersFound, timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error('CRDT sync failed:', error);
      this.emit('syncError', error);
    } finally {
      this.isSyncing = false;
    }
  }

  private async processState(state: any, sourceHost: string) {
    const nodeId = state.node_id || sourceHost;
    logger.info(`Processing CRDT state from ${sourceHost}, node_id: ${nodeId}`);
    logger.info(`State contents: attackers=${Object.keys(state.attackers || {}).length}, creds=${state.stolen_creds?.adds ? Object.keys(state.stolen_creds.adds).length : 0}`);

    if (state.attackers) {
      logger.info(`Processing ${Object.keys(state.attackers).length} attackers from ${sourceHost}`);
      for (const [attackerIp, attackerState] of Object.entries<any>(state.attackers)) {
        logger.info(`Processing attacker: ${attackerIp} from ${sourceHost}`);
        await this.updateAttacker(attackerIp, attackerState, sourceHost);
      }
    }

    if (state.stolen_creds?.adds) {
      for (const [cred, tags] of Object.entries<any>(state.stolen_creds.adds)) {
        for (const [node, timestamp] of tags) {
          await this.addCredential(cred, nodeId, attackerIpFromTags(tags));
        }
      }
    }

    if (state.active_sessions?.entries) {
      for (const [host, [sessionId, ts, node]] of Object.entries<any>(state.active_sessions.entries)) {
        await this.addSessionEvent(sessionId, host, node, ts);
      }
    }
  }

  private async updateAttacker(attackerIp: string, state: any, sourceHost: string) {
    const attackerId = `APT-${attackerIp.replace(/\./g, '-')}`;

    let attacker = await Attacker.findOne({ attackerId });

    if (!attacker) {
      attacker = new Attacker({
        attackerId,
        ipAddress: attackerIp,
        entryPoint: sourceHost,
        currentPrivilege: 'User',
        riskLevel: 'Medium',
        campaign: this.detectCampaign(state),
        firstSeen: new Date(),
        lastSeen: new Date(),
        dwellTime: 0,
        status: 'Active'
      });
      logger.info(`Created new attacker: ${attackerId} from ${sourceHost}`);
    } else {
      attacker.lastSeen = new Date();
      const dwellMs = attacker.lastSeen.getTime() - attacker.firstSeen.getTime();
      attacker.dwellTime = Math.floor(dwellMs / 60000);

      const visitedCount = state.visited_decoys?.elements?.length || 0;
      if (visitedCount > 5) attacker.riskLevel = 'Critical';
      else if (visitedCount > 3) attacker.riskLevel = 'High';
      else if (visitedCount > 1) attacker.riskLevel = 'Medium';
      logger.info(`Updated attacker: ${attackerId}, dwellTime: ${attacker.dwellTime}min, risk: ${attacker.riskLevel}`);
    }

    await attacker.save();

    if (state.visited_decoys?.elements) {
      for (const decoy of state.visited_decoys.elements) {
        await this.addVisitEvent(attackerId, decoy, sourceHost);
      }
    }

    if (state.actions_per_decoy?.entries) {
      for (const [decoy, [action, ts, node]] of Object.entries<any>(state.actions_per_decoy.entries)) {
        await this.addActionEvent(attackerId, decoy, action, ts, node);
      }
    }

    if (state.location?.value) {
      attacker.currentPrivilege = this.inferPrivilege(state.location.value);
      await attacker.save();
    }

    this.emit('attackerUpdated', attacker);
  }

  private async addVisitEvent(attackerId: string, decoy: string, sourceHost: string) {
    const eventId = `evt-${uuidv4()}`;
    
    const existing = await AttackEvent.findOne({ 
      attackerId, 
      description: `Attacker visited ${decoy}`,
      timestamp: { $gte: new Date(Date.now() - 60000) }
    });
    
    if (existing) return;

    const event = new AttackEvent({
      eventId,
      attackerId,
      type: 'Discovery',
      technique: 'T1083',
      tactic: 'Discovery',
      description: `Attacker visited ${decoy}`,
      sourceHost: attackerId.split('-').slice(1).join('.'),
      targetHost: decoy,
      severity: 'Low',
      status: 'Detected'
    });

    await event.save();
    this.emit('newEvent', event);

    await DecoyHost.findOneAndUpdate(
      { hostname: decoy },
      { 
        $inc: { interactions: 1 },
        $set: { lastInteraction: new Date() },
        $addToSet: { attackerIds: attackerId }
      },
      { upsert: true }
    );
  }

  private async addActionEvent(attackerId: string, decoy: string, action: string, ts: number, node: string) {
    const eventId = `evt-${uuidv4()}`;
    
    const actionLower = action.toLowerCase();
    let type = 'Command Execution';
    let technique = 'T1059';
    let severity: 'Low' | 'Medium' | 'High' | 'Critical' = 'Medium';

    if (actionLower.includes('mimikatz') || actionLower.includes('credential')) {
      type = 'Credential Theft';
      technique = 'T1003';
      severity = 'Critical';
    } else if (actionLower.includes('lateral') || actionLower.includes('ssh') || actionLower.includes('rdp')) {
      type = 'Lateral Movement';
      technique = 'T1021';
      severity = 'High';
    } else if (actionLower.includes('exfil') || actionLower.includes('download')) {
      type = 'Data Exfiltration';
      technique = 'T1041';
      severity = 'Critical';
    } else if (actionLower.includes('privilege') || actionLower.includes('sudo') || actionLower.includes('admin')) {
      type = 'Privilege Escalation';
      technique = 'T1078';
      severity = 'High';
    }

    const event = new AttackEvent({
      eventId,
      timestamp: new Date(ts * 1000),
      attackerId,
      type,
      technique,
      tactic: this.getTacticFromType(type),
      description: action,
      sourceHost: node,
      targetHost: decoy,
      command: action,
      severity,
      status: 'Detected'
    });

    await event.save();
    this.emit('newEvent', event);

    if (type === 'Lateral Movement') {
      await LateralMovement.create({
        movementId: `mov-${uuidv4()}`,
        attackerId,
        sourceHost: node,
        targetHost: decoy,
        technique,
        method: this.inferMethod(action),
        successful: true
      });
    }
  }

  private async addCredential(cred: string, sourceHost: string, attackerIp?: string) {
    const [username, password] = cred.split(':');
    if (!username || !password) return;

    const credentialId = `cred-${uuidv4()}`;
    const attackerId = attackerIp ? `APT-${attackerIp.replace(/\./g, '-')}` : 'unknown';

    const existing = await Credential.findOne({ username, password, attackerId });
    if (existing) {
      existing.usageCount++;
      existing.lastUsed = new Date();
      await existing.save();
      return;
    }

    await Credential.create({
      credentialId,
      username,
      password,
      source: sourceHost,
      attackerId,
      decoyHost: sourceHost,
      status: 'Stolen',
      riskScore: this.calculateCredentialRisk(username, password)
    });

    await AttackEvent.create({
      eventId: `evt-${uuidv4()}`,
      attackerId,
      type: 'Credential Theft',
      technique: 'T1003',
      tactic: 'Credential Access',
      description: `Credential stolen: ${username}`,
      sourceHost: attackerIp || 'unknown',
      targetHost: sourceHost,
      severity: 'Critical',
      status: 'Detected'
    });
  }

  private async addSessionEvent(sessionId: string, host: string, node: string, ts: number) {
    const eventId = `evt-${uuidv4()}`;
    
    await AttackEvent.findOneAndUpdate(
      { eventId },
      {
        eventId,
        timestamp: new Date(ts * 1000),
        attackerId: `APT-${node.replace(/\./g, '-')}`,
        type: 'Initial Access',
        technique: 'T1078',
        tactic: 'Initial Access',
        description: `Active session established on ${host}`,
        sourceHost: node,
        targetHost: host,
        severity: 'High',
        status: 'In Progress'
      },
      { upsert: true }
    );
  }

  private detectCampaign(state: any): string {
    const actions = Object.keys(state.actions_per_decoy?.entries || {});
    const actionStr = JSON.stringify(actions).toLowerCase();
    
    if (actionStr.includes('mimikatz') || actionStr.includes('lsass')) return 'Shadow Hydra';
    if (actionStr.includes('ransomware') || actionStr.includes('encrypt')) return 'CryptoLock';
    if (actionStr.includes('apt') || actionStr.includes('nation')) return 'Silent Tiger';
    return 'Opportunistic';
  }

  private inferPrivilege(location: string): string {
    if (location.includes('admin') || location.includes('root') || location.includes('system')) return 'Admin';
    if (location.includes('db') || location.includes('sql')) return 'DB Admin';
    return 'User';
  }

  private inferMethod(action: string): string {
    const lower = action.toLowerCase();
    if (lower.includes('ssh')) return 'SSH';
    if (lower.includes('rdp')) return 'RDP';
    if (lower.includes('smb')) return 'SMB';
    if (lower.includes('winrm')) return 'WinRM';
    if (lower.includes('wmi')) return 'WMI';
    if (lower.includes('psexec')) return 'PSExec';
    return 'Other';
  }

  private getTacticFromType(type: string): string {
    const tacticMap: Record<string, string> = {
      'Initial Access': 'Initial Access',
      'Credential Theft': 'Credential Access',
      'Lateral Movement': 'Lateral Movement',
      'Command Execution': 'Execution',
      'Data Exfiltration': 'Exfiltration',
      'Privilege Escalation': 'Privilege Escalation',
      'Discovery': 'Discovery',
      'Persistence': 'Persistence',
      'Defense Evasion': 'Defense Evasion'
    };
    return tacticMap[type] || 'Unknown';
  }

  private calculateCredentialRisk(username: string, password: string): number {
    let score = 50;
    if (username.includes('admin')) score += 20;
    if (username.includes('root')) score += 25;
    if (password.length < 8) score += 15;
    if (password.toLowerCase().includes('password')) score += 10;
    return Math.min(score, 100);
  }
}

function attackerIpFromTags(tags: [string, number][]): string | undefined {
  return undefined;
}