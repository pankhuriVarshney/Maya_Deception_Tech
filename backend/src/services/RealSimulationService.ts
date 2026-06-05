// services/RealSimulationService.ts

import { EventEmitter } from 'events';
import { Attacker, AttackEvent, Credential, LateralMovement } from '../models';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { MitreAttackService } from './MitreAttackService';
import VMStatus from '../models/VMStatus';

const execAsync = promisify(exec);

export class RealSimulationService extends EventEmitter {
  private vagrantDir: string;
  private vmCache: Map<string, { path: string; ip: string }> = new Map();
  private mitreService: MitreAttackService;

  constructor() {
    super();
    // Use absolute path from project root
    this.vagrantDir = process.env.VAGRANT_DIR || path.join(__dirname, '../../../simulations/fake');
    this.mitreService = new MitreAttackService();
    this.discoverVMs();
  }

  /**
   * Helper method to handle simulation errors consistently
   * Returns a standardized error result with proper logging
   */
  private handleSimulationError(
    simulationType: string,
    error: unknown,
    mockFallback?: () => Promise<any>
  ): Promise<any> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Real ${simulationType} simulation failed:`, errorMessage);

    // If a mock fallback is provided, use it
    if (mockFallback) {
      logger.warn(`Falling back to mock ${simulationType} simulation`);
      return mockFallback();
    }

    // Otherwise return standardized error result
    return Promise.resolve({
      success: false,
      error: errorMessage,
      real: false
    });
  }

  /**
   * Discover running VMs - always use vagrant-based discovery for accuracy
   * Database is used as a secondary source, but we verify actual VM status
   */
  private async discoverVMs() {
    this.vmCache.clear();
    
    // PRIMARY: Try Vagrant-based discovery
    await this.discoverVMsFromVagrant();
    
    // FALLBACK: If Vagrant found nothing, use K8s pods from MongoDB
    if (this.vmCache.size === 0) {
      logger.info('Vagrant discovery found no VMs, falling back to K8s discovery...');
      await this.discoverVMsFromK8s();
    }
    
    logger.info(`VM cache populated with ${this.vmCache.size} VMs`);
  }

  /**
   * Discover running VMs via vagrant commands and virsh (using correct domain naming)
   * Based on simulations/fake/check_vms.sh script
   */
  private async discoverVMsFromVagrant() {
    if (!fs.existsSync(this.vagrantDir)) {
      logger.warn(`Vagrant directory not found: ${this.vagrantDir}`);
      return;
    }

    logger.info(`Scanning for VMs in: ${this.vagrantDir}`);
    const entries = fs.readdirSync(this.vagrantDir, { withFileTypes: true });
    const vmDirs = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .filter(name => fs.existsSync(path.join(this.vagrantDir, name, 'Vagrantfile')));

    // List of VMs to check (from check_vms.sh)
    const vmNames = [
      'gateway-vm',
      'fake-ftp-01', 'fake-jump-01', 'fake-rdp-01', 'fake-smb-01',
      'fake-ssh-01', 'fake-web-01', 'fake-web-02', 'fake-web-03'
    ];

    logger.info(`Checking ${vmNames.length} VMs: [${vmNames.join(', ')}]`);

    for (const vmName of vmNames) {
      const vmPath = path.join(this.vagrantDir, vmName);

      // Check if directory exists
      if (!fs.existsSync(vmPath)) {
        logger.debug(`Skipping ${vmName}: directory not found`);
        continue;
      }

      // Check if Vagrantfile exists
      if (!fs.existsSync(path.join(vmPath, 'Vagrantfile'))) {
        logger.warn(`Skipping ${vmName}: no Vagrantfile found`);
        continue;
      }

      let isRunning = false;
      let ip: string | null = null;
      let virshState: string | null = null;

      try {
        // Step 1: Get status from vagrant (primary method)
        const { stdout: statusOutput } = await execAsync(
          `cd ${vmPath} && timeout 10 vagrant status --machine-readable 2>/dev/null || echo ""`,
          { timeout: 12000 }
        );

        // Parse machine-readable format: timestamp,provider,state,state-short,state-long
        const statusLine = statusOutput.split('\n').find(line => 
          line.includes(',state,') && !line.includes('state-human')
        );

        if (statusLine) {
          const parts = statusLine.split(',');
          if (parts.length >= 4) {
            const vagrantState = parts[3].trim();
            isRunning = vagrantState === 'running';
            logger.debug(`vagrant status ${vmName}: ${vagrantState}`);
          }
        }

        // Step 2: Get virsh status for additional detail (using correct domain name: vmName_default)
        try {
          const domainName = `${vmName}_default`;
          const { stdout: virshOutput } = await execAsync(
            `virsh domstate ${domainName} 2>/dev/null || echo ""`,
            { timeout: 3000 }
          );
          
          virshState = virshOutput.trim() || null;
          if (virshState) {
            logger.debug(`virsh domstate ${domainName}: ${virshState}`);
            
            // If virsh shows running but vagrant doesn't, trust virsh
            if (virshState.toLowerCase() === 'running' && !isRunning) {
              logger.warn(`vagrant says ${vmName} is not running, but virsh says running - trusting virsh`);
              isRunning = true;
            }
          }
        } catch (virshError) {
          logger.debug(`virsh check failed for ${vmName}: ${(virshError as Error).message}`);
        }

        // Step 3: If running, get IP address
        if (isRunning) {
          try {
            // Use hostname -I with fallback to ip addr for BusyBox systems
            const { stdout: ipOutput } = await execAsync(
              `cd ${vmPath} && timeout 5 vagrant ssh -c "hostname -I 2>/dev/null || ip addr show | grep 'inet ' | grep -v '127.0.0.1' | awk '{print \\$2}' | cut -d/ -f1" 2>/dev/null || echo ""`,
              { timeout: 7000 }
            );

            ip = ipOutput.trim() || null;

            // Clean up IP output (remove carriage returns, take first IP only)
            if (ip) {
              ip = ip.replace(/\r/g, '').replace(/\n/g, ' ').split(' ').filter(Boolean)[0];
              logger.info(`✅ ${vmName}: running (virsh: ${virshState || 'unknown'}, IP: ${ip})`);
            } else {
              logger.warn(`⚠️  ${vmName}: running but no IP (still booting?)`);
              ip = 'unknown';
            }
          } catch (ipError) {
            logger.warn(`Could not get IP for ${vmName}: ${(ipError as Error).message}`);
            ip = 'unknown';
          }

          // Add to cache
          this.vmCache.set(vmName, { path: vmPath, ip: ip || 'unknown' });
        } else {
          logger.debug(`VM ${vmName} is not running (vagrant: ${statusOutput ? 'checked' : 'error'}, virsh: ${virshState || 'unknown'})`);
        }

        // Update database as secondary (for CRDT sync service)
        await VMStatus.findOneAndUpdate(
          { vmName },
          {
            vmName,
            hostname: vmName,
            status: isRunning ? 'running' : 'stopped',
            ip: ip,
            lastSeen: new Date(),
            crdtState: isRunning ? undefined : { attackers: 0, credentials: 0, sessions: 0, hash: '' }
          },
          { upsert: true, new: true }
        );

      } catch (error) {
        logger.error(`❌ Failed to discover VM ${vmName}:`, (error as Error).message);

        // Mark as error in DB
        await VMStatus.findOneAndUpdate(
          { vmName },
          {
            vmName,
            hostname: vmName,
            status: 'error',
            ip: null,
            lastSeen: new Date(),
            crdtState: { attackers: 0, credentials: 0, sessions: 0, hash: '' }
          },
          { upsert: true }
        );
      }
    }

    logger.info(`VM discovery complete: ${this.vmCache.size} running VMs cached`);
  }

  private async discoverVMsFromK8s() {
    try {
      logger.info('Attempting K8s VM discovery from MongoDB vm_status collection...');
      const runningVMs = await VMStatus.find({ status: 'running' }).lean();
      
      if (runningVMs.length === 0) {
        logger.warn('No running VMs found in vm_status collection');
        return;
      }

      for (const vm of runningVMs) {
        const vmName = vm.vmName as string;
        const vmIp = (vm.ip as string) || 'unknown';
        
        // Store with empty path since K8s pods don't use SSH paths
        this.vmCache.set(vmName, { path: '', ip: vmIp });
        logger.info(`K8s VM discovered: ${vmName} (${vmIp})`);
      }

      logger.info(`K8s discovery complete: ${this.vmCache.size} VMs added to cache`);
    } catch (error) {
      logger.error('K8s VM discovery failed:', error);
    }
  }

  /**
   * Execute command on VM via SSH
   */
  /**
 * Execute command on VM via SSH with better error handling
 */
  private async executeOnVM(vmName: string, command: string): Promise<{ stdout: string; stderr: string }> {
    const vmInfo = this.vmCache.get(vmName);
    
    // K8s pods have empty path - skip SSH, just log the command
    if (!vmInfo || vmInfo.path === '') {
      logger.info(`[K8s] Simulating command on ${vmName}: ${command}`);
      return { stdout: `[K8s simulated] ${command}`, stderr: '' };
    }

    if (!vmInfo) {
      throw new Error(`VM ${vmName} not found or not running`);
    }

    try {
      const { stdout, stderr } = await execAsync(
        `cd ${vmInfo.path} && timeout 10 vagrant ssh -c "${command.replace(/"/g, '\\"')}" 2>/dev/null`,
        { timeout: 15000, killSignal: 'SIGTERM' }
      );
      
      // Filter out the fog warning from output
      const cleanStdout = stdout?.split('\n')
        .filter((line: string) => !line.includes('libvirt_ip_command') && !line.includes('[fog][WARNING]'))
        .join('\n') || '';
        
      return { stdout: cleanStdout, stderr: stderr || '' };
    } catch (error: any) {
      // Check if it's a timeout or connection issue
      if (error.message?.includes('timeout') || error.code === 'ETIMEDOUT') {
        logger.warn(`SSH command timed out for ${vmName}`);
      } else if (error.message?.includes('Connection refused') || error.message?.includes('No route to host')) {
        logger.warn(`VM ${vmName} not ready for SSH yet`);
      } else {
        logger.debug(`SSH command failed for ${vmName}: ${error.message}`);
      }
      throw error; // Re-throw so caller can handle it
    }
  }

  /**
   * Simulate REAL SSH brute force attack with MITRE classification
   */
  async simulateSSHBruteForce(params: { target: string; attempts?: number }) {
    const { target, attempts = 5 } = params;

    logger.info(`Checking VM cache for target '${target}': ${this.vmCache.has(target) ? 'FOUND' : 'NOT FOUND'}`);
    logger.info(`Available VMs in cache: [${Array.from(this.vmCache.keys()).join(', ')}]`);

    if (!this.vmCache.has(target)) {
      logger.warn(`Target VM ${target} not running, using mock data`);
      return this.simulateSSHBruteForceMock(target, attempts);
    }

    logger.info(`🎯 Starting REAL SSH brute force simulation on ${target}`);

    const attackerIp = `10.20.10.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `attacker-${attackerIp.replace(/\./g, '-')}`;
    let eventsGenerated = 0;

    try {
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
      this.emit('attackerUpdated', attacker);

      // Execute SSH commands and classify with MITRE
      for (let i = 0; i < attempts; i++) {
        const fakeUser = `user${Math.floor(Math.random() * 100)}`;
        
        try {
          await this.executeOnVM(
            target,
            `sshpass -p 'fakepass' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=2 ${fakeUser}@localhost 2>&1 || true`
          );
        } catch (e) {
          // Expected to fail
        }

        await this.executeOnVM(
          target,
          `/usr/local/bin/syslogd-helper observe "Failed SSH login attempt ${i + 1}/${attempts} from ${attackerIp}"`
        );

        // CLASSIFY with MITRE - SSH brute force is T1110
        const classification = await this.mitreService.classifyEvent('ssh brute force');
        
        const event = new AttackEvent({
          eventId: `evt-${uuidv4()}`,
          timestamp: new Date(),
          attackerId,
          stage: 'INITIAL_ACCESS',
          type: 'Initial Access',
          // NEW MITRE FIELDS
          tactic: classification?.tactic || 'initial-access',
          tacticId: classification?.tacticId || 'TA0001',
          tacticName: classification?.tacticName || 'Initial Access',
          technique: classification?.techniqueId || 'T1110',
          techniqueName: classification?.techniqueName || 'Brute Force',
          isSubtechnique: classification?.isSubtechnique || false,
          mitreConfidence: classification?.confidence || 0.7,
          classificationMethod: classification?.method || 'pattern',
          allMatchingTechniques: classification?.allMatches || ['T1110'],
          // LEGACY FIELDS
          description: `Failed SSH login attempt ${i + 1}/${attempts}`,
          sourceHost: attackerIp,
          targetHost: target,
          severity: i >= attempts - 1 ? 'High' : 'Medium',
          status: 'Detected'
        });
        await event.save();
        this.emit('newEvent', event);
        eventsGenerated++;

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Successful login - classify the success
      const username = 'vagrant';
      const password = 'vagrant';
      
      await this.executeOnVM(
        target,
        `/usr/local/bin/syslogd-helper observe "Successful SSH login with credentials: ${username}:${password}"`
      );

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

      // CLASSIFY successful access - T1078 (Valid Accounts)
      const successClassification = await this.mitreService.classifyEvent('ssh login successful');
      
      const successEvent = new AttackEvent({
        eventId: `evt-${uuidv4()}`,
        timestamp: new Date(),
        attackerId,
        stage: 'INITIAL_ACCESS',
        type: 'Initial Access',
        tactic: successClassification?.tactic || 'initial-access',
        tacticId: successClassification?.tacticId || 'TA0001',
        tacticName: successClassification?.tacticName || 'Initial Access',
        technique: successClassification?.techniqueId || 'T1078',
        techniqueName: successClassification?.techniqueName || 'Valid Accounts',
        isSubtechnique: successClassification?.isSubtechnique || false,
        mitreConfidence: successClassification?.confidence || 0.8,
        classificationMethod: successClassification?.method || 'pattern',
        allMatchingTechniques: successClassification?.allMatches || ['T1078'],
        description: `Successful SSH login with credentials: ${username}`,
        sourceHost: attackerIp,
        targetHost: target,
        severity: 'High',
        status: 'Detected'
      });
      await successEvent.save();
      this.emit('newEvent', successEvent);
      eventsGenerated++;

      await this.executeOnVM(target, '/usr/local/bin/syslogd-helper sync >/dev/null 2>&1 &');

      this.emit('simulationComplete', { 
        type: 'ssh-bruteforce', 
        attackerId, 
        target,
        eventsGenerated,
        real: true
      });

      return { success: true, attackerId, eventsGenerated, real: true };
    } catch (error) {
      logger.error('Real SSH brute force simulation failed:', error);
      return this.simulateSSHBruteForceMock(target, attempts);
    }
  }

  /**
   * Mock fallback if VM not available
   */
  private async simulateSSHBruteForceMock(target: string, attempts: number) {
    logger.warn(`Using MOCK SSH brute force simulation for ${target}`);
    
    const attackerIp = `10.20.20.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `attacker-${attackerIp.replace(/\./g, '-')}`;
    
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

    for (let i = 0; i < attempts; i++) {
      const classification = await this.mitreService.classifyEvent('ssh brute force');
      
      const event = new AttackEvent({
        eventId: `evt-${uuidv4()}`,
        timestamp: new Date(),
        attackerId,
        type: 'Initial Access',
        tactic: classification?.tactic || 'initial-access',
        tacticId: classification?.tacticId || 'TA0001',
        tacticName: classification?.tacticName || 'Initial Access',
        technique: classification?.techniqueId || 'T1110',
        techniqueName: classification?.techniqueName || 'Brute Force',
        mitreConfidence: classification?.confidence || 0.7,
        classificationMethod: classification?.method || 'pattern',
        description: `Failed SSH login attempt ${i + 1}/${attempts} (MOCK)`,
        sourceHost: attackerIp,
        targetHost: target,
        severity: i >= attempts - 1 ? 'High' : 'Medium',
        status: 'Detected'
      });
      await event.save();
    }

    return { success: true, attackerId, eventsGenerated: attempts, real: false };
  }

  /**
   * Simulate REAL lateral movement with MITRE classification
   */
  async simulateLateralMovement(params: { source: string; targets: string[] }) {
    const { source, targets } = params;
    
    const availableSource = this.vmCache.has(source);
    const availableTargets = targets.filter(t => this.vmCache.has(t));

    if (!availableSource || availableTargets.length === 0) {
      logger.warn('Source or target VMs not running, using mock data');
      return { success: false, reason: 'VMs not available' };
    }

    logger.info(`🎯 Starting REAL lateral movement simulation: ${source} → [${availableTargets.join(', ')}]`);

    const attackerIp = `10.20.20.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `attacker-${attackerIp.replace(/\./g, '-')}`;
    let eventsGenerated = 0;

    try {
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
      this.emit('attackerUpdated', attacker);

      // Initial access on source
      await this.executeOnVM(
        source,
        `/usr/local/bin/syslogd-helper observe "Initial compromise from ${attackerIp}"`
      );

      const initialClassification = await this.mitreService.classifyEvent('initial compromise');
      
      const initialEvent = new AttackEvent({
        eventId: `evt-${uuidv4()}`,
        attackerId,
        stage: 'INITIAL_ACCESS',
        type: 'Initial Access',
        tactic: initialClassification?.tactic || 'initial-access',
        tacticId: initialClassification?.tacticId || 'TA0001',
        tacticName: initialClassification?.tacticName || 'Initial Access',
        technique: initialClassification?.techniqueId || 'T1078',
        techniqueName: initialClassification?.techniqueName || 'Valid Accounts',
        isSubtechnique: initialClassification?.isSubtechnique || false,
        mitreConfidence: initialClassification?.confidence || 0.7,
        classificationMethod: initialClassification?.method || 'pattern',
        allMatchingTechniques: initialClassification?.allMatches || ['T1078'],
        description: `Initial compromise of ${source}`,
        sourceHost: attackerIp,
        targetHost: source,
        severity: 'High',
        status: 'Detected'
      });
      await initialEvent.save();
      this.emit('newEvent', initialEvent);
      eventsGenerated++;

      // Lateral movement to each target
      let currentHost = source;
      for (const target of availableTargets) {
        try {
          await this.executeOnVM(
            currentHost,
            `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=2 vagrant@${this.vmCache.get(target)!.ip} "whoami" 2>&1 || true`
          );
        } catch (e) {
          // Connection attempt logged
        }

        await this.executeOnVM(
          currentHost,
          `/usr/local/bin/syslogd-helper observe "SSH pivot from ${currentHost} to ${target}"`
        );

        await this.executeOnVM(
          target,
          `/usr/local/bin/syslogd-helper visit "${attackerIp}" "${target}"`
        );

        // CLASSIFY lateral movement - T1021 (Remote Services)
        const moveClassification = await this.mitreService.classifyEvent('ssh pivot lateral movement');
        
        const moveEvent = new AttackEvent({
          eventId: `evt-${uuidv4()}`,
          attackerId,
          stage: 'LATERAL_MOVEMENT',
          type: 'Lateral Movement',
          tactic: moveClassification?.tactic || 'lateral-movement',
          tacticId: moveClassification?.tacticId || 'TA0008',
          tacticName: moveClassification?.tacticName || 'Lateral Movement',
          technique: moveClassification?.techniqueId || 'T1021',
          techniqueName: moveClassification?.techniqueName || 'Remote Services',
          isSubtechnique: moveClassification?.isSubtechnique || false,
          mitreConfidence: moveClassification?.confidence || 0.8,
          classificationMethod: moveClassification?.method || 'pattern',
          allMatchingTechniques: moveClassification?.allMatches || ['T1021'],
          description: `SSH pivot from ${currentHost} to ${target}`,
          sourceHost: currentHost,
          targetHost: target,
          severity: 'High',
          status: 'Detected'
        });
        await moveEvent.save();
        this.emit('newEvent', moveEvent);
        eventsGenerated++;

        await LateralMovement.create({
          movementId: `mov-${uuidv4()}`,
          attackerId,
          sourceHost: currentHost,
          targetHost: target,
          technique: moveEvent.technique,
          method: 'SSH',
          successful: true
        });

        currentHost = target;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      attacker.currentPrivilege = 'Admin';
      attacker.riskLevel = 'Critical';
      await attacker.save();

      for (const vm of [source, ...availableTargets]) {
        await this.executeOnVM(vm, '/usr/local/bin/syslogd-helper sync >/dev/null 2>&1 &');
      }

      this.emit('simulationComplete', {
        type: 'lateral-movement',
        attackerId,
        path: [source, ...availableTargets],
        eventsGenerated,
        real: true
      });

      return { success: true, attackerId, path: [source, ...availableTargets], real: true };
    } catch (error) {
      return this.handleSimulationError('lateral movement', error, async () => {
        logger.warn('Using mock lateral movement simulation as fallback');
        return {
          success: false,
          reason: (error as Error).message,
          real: false,
          attackerId: undefined,
          path: []
        };
      });
    }
  }

  /**
   * Simulate REAL credential dumping with MITRE classification
   */
  async simulateCredentialTheft(params: { target: string; tool?: string }) {
    const { target, tool = 'mimikatz' } = params;
    
    if (!this.vmCache.has(target)) {
      return { success: false, reason: 'VM not available' };
    }

    logger.info(`🎯 Starting REAL credential theft simulation on ${target}`);

    const attackerIp = `10.20.20.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `attacker-${attackerIp.replace(/\./g, '-')}`;
    let eventsGenerated = 0;

    try {
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
      this.emit('attackerUpdated', attacker);

      // Execute mimikatz-like command
      const mimikatzCommand = `${tool} sekurlsa::logonpasswords`;
      await this.executeOnVM(
        target,
        `/usr/local/bin/syslogd-helper observe "${tool} execution detected - dumping credentials"`
      );

      // CLASSIFY credential dumping - T1003 (OS Credential Dumping)
      const dumpClassification = await this.mitreService.classifyEvent(mimikatzCommand);
      
      const dumpEvent = new AttackEvent({
        eventId: `evt-${uuidv4()}`,
        attackerId,
        stage: 'CREDENTIAL_ACCESS',
        type: 'Credential Theft',
        tactic: dumpClassification?.tactic || 'credential-access',
        tacticId: dumpClassification?.tacticId || 'TA0006',
        tacticName: dumpClassification?.tacticName || 'Credential Access',
        technique: dumpClassification?.techniqueId || 'T1003',
        techniqueName: dumpClassification?.techniqueName || 'OS Credential Dumping',
        isSubtechnique: dumpClassification?.isSubtechnique || false,
        mitreConfidence: dumpClassification?.confidence || 0.95,
        classificationMethod: dumpClassification?.method || 'exact',
        allMatchingTechniques: dumpClassification?.allMatches || ['T1003', 'T1003.001'],
        command: mimikatzCommand,
        description: `${tool} execution detected - dumping credentials`,
        sourceHost: target,
        targetHost: target,
        severity: 'Critical',
        status: 'Detected'
      });
      await dumpEvent.save();
      this.emit('newEvent', dumpEvent);
      eventsGenerated++;

      // Create stolen credentials
      const stolenCreds = [
        { username: 'admin', password: 'Admin123!' },
        { username: 'root', password: 'root123' },
        { username: 'dbuser', password: 'dbpass123' }
      ];

      for (const cred of stolenCreds) {
        await this.executeOnVM(
          target,
          `/usr/local/bin/syslogd-helper cred "${cred.username}:${cred.password}"`
        );

        await Credential.create({
          credentialId: `cred-${uuidv4()}`,
          username: cred.username,
          password: cred.password,
          source: target,
          attackerId,
          decoyHost: target,
          status: 'Stolen',
          riskScore: cred.username.includes('admin') || cred.username === 'root' ? 90 : 70
        });

        // Each credential theft is also T1003
        const credClassification = await this.mitreService.classifyEvent('credential theft');
        
        const credEvent = new AttackEvent({
          eventId: `evt-${uuidv4()}`,
          attackerId,
          stage: 'CREDENTIAL_ACCESS',
          type: 'Credential Theft',
          tactic: credClassification?.tactic || 'credential-access',
          tacticId: credClassification?.tacticId || 'TA0006',
          tacticName: credClassification?.tacticName || 'Credential Access',
          technique: credClassification?.techniqueId || 'T1003',
          techniqueName: credClassification?.techniqueName || 'OS Credential Dumping',
          isSubtechnique: credClassification?.isSubtechnique || false,
          mitreConfidence: credClassification?.confidence || 0.9,
          classificationMethod: credClassification?.method || 'pattern',
          allMatchingTechniques: credClassification?.allMatches || ['T1003'],
          description: `Credential stolen: ${cred.username}`,
          sourceHost: target,
          targetHost: target,
          severity: 'Critical',
          status: 'Detected'
        });
        await credEvent.save();
        this.emit('newEvent', credEvent);
        eventsGenerated++;
      }

      await this.executeOnVM(target, '/usr/local/bin/syslogd-helper sync >/dev/null 2>&1 &');

      this.emit('simulationComplete', {
        type: 'credential-theft',
        attackerId,
        target,
        credentialsStolen: stolenCreds.length,
        eventsGenerated,
        real: true
      });

      return { success: true, attackerId, credentialsStolen: stolenCreds.length, real: true };
    } catch (error) {
      return this.handleSimulationError('credential theft', error, async () => {
        logger.warn('Using mock credential theft simulation as fallback');
        return {
          success: false,
          reason: (error as Error).message,
          real: false,
          attackerId: undefined,
          credentialsStolen: 0
        };
      });
    }
  }

  /**
   * Simulate REAL network discovery with MITRE classification
   */
  async simulateDiscovery(params: { source: string; scanType?: string }) {
    const { source, scanType = 'internal' } = params;

    if (!this.vmCache.has(source)) {
      logger.warn(`Source VM ${source} not running, using mock data`);
      return this.simulateDiscoveryMock(source, scanType);
    }

    logger.info(`🎯 Starting REAL network discovery simulation from ${source}`);

    const attackerIp = `10.20.20.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `attacker-${attackerIp.replace(/\./g, '-')}`;
    let eventsGenerated = 0;

    try {
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
      this.emit('attackerUpdated', attacker);

      const discoveryCommands = [
        { cmd: 'nmap -sS -sV 10.20.20.0/24', technique: 'T1046', tactic: 'discovery', desc: 'Network service discovery' },
        { cmd: 'netstat -tulpn', technique: 'T1049', tactic: 'discovery', desc: 'System network connections' },
        { cmd: 'cat /etc/passwd', technique: 'T1087', tactic: 'discovery', desc: 'Account discovery' },
        { cmd: 'find / -name "*.conf" 2>/dev/null', technique: 'T1083', tactic: 'discovery', desc: 'File and directory discovery' },
        { cmd: 'ps aux | grep -E "(ssh|http|mysql|postgres)"', technique: 'T1057', tactic: 'discovery', desc: 'Process discovery' },
        { cmd: 'ifconfig -a', technique: 'T1016', tactic: 'discovery', desc: 'System network configuration discovery' },
        { cmd: 'cat /etc/hosts', technique: 'T1016', tactic: 'discovery', desc: 'Host file discovery' }
      ];

      for (const { cmd, technique, tactic, desc } of discoveryCommands) {
        try {
          await this.executeOnVM(source, cmd);
        } catch (e) {
          // Command may fail, still log it
        }

        await this.executeOnVM(
          source,
          `/usr/local/bin/syslogd-helper observe "Discovery command: ${cmd.substring(0, 40)}..."`
        );

        const classification = await this.mitreService.classifyEvent(cmd);

        const event = new AttackEvent({
          eventId: `evt-${uuidv4()}`,
          timestamp: new Date(),
          attackerId,
          type: 'Discovery',
          tactic: classification?.tactic || tactic,
          tacticId: classification?.tacticId || 'TA0007',
          tacticName: classification?.tacticName || 'Discovery',
          technique: classification?.techniqueId || technique,
          techniqueName: classification?.techniqueName || desc,
          isSubtechnique: classification?.isSubtechnique || false,
          mitreConfidence: classification?.confidence || 0.8,
          classificationMethod: classification?.method || 'pattern',
          allMatchingTechniques: classification?.allMatches || [technique],
          command: cmd,
          description: desc,
          sourceHost: source,
          targetHost: source,
          severity: 'Low',
          status: 'Detected'
        });
        await event.save();
        this.emit('newEvent', event);
        eventsGenerated++;

        await new Promise(resolve => setTimeout(resolve, 800));
      }

      await this.executeOnVM(source, '/usr/local/bin/syslogd-helper sync >/dev/null 2>&1 &');

      this.emit('simulationComplete', {
        type: 'discovery',
        attackerId,
        source,
        eventsGenerated,
        real: true
      });

      return { success: true, attackerId, commandsExecuted: discoveryCommands.length, real: true };
    } catch (error) {
      logger.error('Real discovery simulation failed:', error);
      return this.simulateDiscoveryMock(source, scanType);
    }
  }

  /**
   * Mock discovery simulation
   */
  private async simulateDiscoveryMock(source: string, scanType: string) {
    logger.warn(`Using MOCK discovery simulation for ${source}`);

    const attackerIp = `10.20.20.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `attacker-${attackerIp.replace(/\./g, '-')}`;

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
      { cmd: 'nmap -sS -sV 10.20.20.0/24', technique: 'T1046' },
      { cmd: 'netstat -tulpn', technique: 'T1049' },
      { cmd: 'cat /etc/passwd', technique: 'T1087' }
    ];

    for (const { cmd, technique } of discoveryCommands) {
      const classification = await this.mitreService.classifyEvent(cmd);

      const event = new AttackEvent({
        eventId: `evt-${uuidv4()}`,
        timestamp: new Date(),
        attackerId,
        type: 'Discovery',
        tactic: classification?.tactic || 'discovery',
        tacticId: classification?.tacticId || 'TA0007',
        tacticName: classification?.tacticName || 'Discovery',
        technique: classification?.techniqueId || technique,
        techniqueName: classification?.techniqueName || technique,
        mitreConfidence: classification?.confidence || 0.7,
        classificationMethod: classification?.method || 'pattern',
        command: cmd,
        description: `Discovery command (MOCK): ${cmd}`,
        sourceHost: source,
        targetHost: source,
        severity: 'Low',
        status: 'Detected'
      });
      await event.save();
    }

    return { success: true, attackerId, commandsExecuted: discoveryCommands.length, real: false };
  }

  /**
   * Simulate REAL privilege escalation with MITRE classification
   */
  async simulatePrivilegeEscalation(params: { target: string; method?: string }) {
    const { target, method = 'sudo-exploit' } = params;

    if (!this.vmCache.has(target)) {
      logger.warn(`Target VM ${target} not running, using mock data`);
      return this.simulatePrivilegeEscalationMock(target, method);
    }

    logger.info(`🎯 Starting REAL privilege escalation simulation on ${target}`);

    const attackerIp = `10.20.20.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `attacker-${attackerIp.replace(/\./g, '-')}`;
    let eventsGenerated = 0;

    try {
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
      this.emit('attackerUpdated', attacker);

      // Initial user-level access
      await this.executeOnVM(
        target,
        `/usr/local/bin/syslogd-helper observe "Initial user-level access to ${target}"`
      );

      const initialClassification = await this.mitreService.classifyEvent('initial user access');

      const initialEvent = new AttackEvent({
        eventId: `evt-${uuidv4()}`,
        attackerId,
        type: 'Initial Access',
        tactic: initialClassification?.tactic || 'initial-access',
        tacticId: initialClassification?.tacticId || 'TA0001',
        tacticName: initialClassification?.tacticName || 'Initial Access',
        technique: initialClassification?.techniqueId || 'T1078',
        techniqueName: initialClassification?.techniqueName || 'Valid Accounts',
        isSubtechnique: initialClassification?.isSubtechnique || false,
        mitreConfidence: initialClassification?.confidence || 0.7,
        classificationMethod: initialClassification?.method || 'pattern',
        allMatchingTechniques: initialClassification?.allMatches || ['T1078'],
        description: `Initial user-level access to ${target}`,
        sourceHost: attackerIp,
        targetHost: target,
        severity: 'Medium',
        status: 'Detected'
      });
      await initialEvent.save();
      this.emit('newEvent', initialEvent);
      eventsGenerated++;

      // Privilege escalation attempt
      const escalationCommand = method === 'sudo-exploit' ? 'sudo -l && CVE-2021-3156 exploit' : method;
      await this.executeOnVM(target, escalationCommand);

      await this.executeOnVM(
        target,
        `/usr/local/bin/syslogd-helper observe "Privilege escalation attempt: ${method}"`
      );

      const escalateClassification = await this.mitreService.classifyEvent(method);

      const escalateEvent = new AttackEvent({
        eventId: `evt-${uuidv4()}`,
        attackerId,
        type: 'Privilege Escalation',
        tactic: escalateClassification?.tactic || 'privilege-escalation',
        tacticId: escalateClassification?.tacticId || 'TA0004',
        tacticName: escalateClassification?.tacticName || 'Privilege Escalation',
        technique: escalateClassification?.techniqueId || 'T1068',
        techniqueName: escalateClassification?.techniqueName || 'Exploitation for Privilege Escalation',
        isSubtechnique: escalateClassification?.isSubtechnique || false,
        mitreConfidence: escalateClassification?.confidence || 0.85,
        classificationMethod: escalateClassification?.method || 'pattern',
        allMatchingTechniques: escalateClassification?.allMatches || ['T1068'],
        description: `${method} attempt detected`,
        sourceHost: target,
        targetHost: target,
        severity: 'High',
        status: 'Detected',
        command: escalationCommand
      });
      await escalateEvent.save();
      this.emit('newEvent', escalateEvent);
      eventsGenerated++;

      // Successful escalation
      await this.executeOnVM(
        target,
        `/usr/local/bin/syslogd-helper observe "Successfully escalated to root privileges"`
      );

      const successClassification = await this.mitreService.classifyEvent('privilege escalation successful');

      const successEvent = new AttackEvent({
        eventId: `evt-${uuidv4()}`,
        attackerId,
        type: 'Privilege Escalation',
        tactic: successClassification?.tactic || 'privilege-escalation',
        tacticId: successClassification?.tacticId || 'TA0004',
        tacticName: successClassification?.tacticName || 'Privilege Escalation',
        technique: successClassification?.techniqueId || 'T1078',
        techniqueName: successClassification?.techniqueName || 'Valid Accounts',
        isSubtechnique: successClassification?.isSubtechnique || false,
        mitreConfidence: successClassification?.confidence || 0.9,
        classificationMethod: successClassification?.method || 'pattern',
        allMatchingTechniques: successClassification?.allMatches || ['T1078'],
        description: `Successfully escalated to root/Administrator privileges`,
        sourceHost: target,
        targetHost: target,
        severity: 'Critical',
        status: 'Detected'
      });
      await successEvent.save();
      this.emit('newEvent', successEvent);
      eventsGenerated++;

      // Update attacker privilege
      attacker.currentPrivilege = 'Admin';
      attacker.riskLevel = 'Critical';
      await attacker.save();

      await this.executeOnVM(target, '/usr/local/bin/syslogd-helper sync >/dev/null 2>&1 &');

      this.emit('simulationComplete', {
        type: 'privilege-escalation',
        attackerId,
        target,
        eventsGenerated,
        real: true
      });

      return { success: true, attackerId, eventsGenerated, real: true };
    } catch (error) {
      logger.error('Real privilege escalation simulation failed:', error);
      return this.simulatePrivilegeEscalationMock(target, method);
    }
  }

  /**
   * Mock privilege escalation simulation
   */
  private async simulatePrivilegeEscalationMock(target: string, method: string) {
    logger.warn(`Using MOCK privilege escalation simulation for ${target}`);

    const attackerIp = `10.20.20.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `attacker-${attackerIp.replace(/\./g, '-')}`;

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

    const classification = await this.mitreService.classifyEvent(method);

    const event = new AttackEvent({
      eventId: `evt-${uuidv4()}`,
      attackerId,
      type: 'Privilege Escalation',
      tactic: classification?.tactic || 'privilege-escalation',
      tacticId: classification?.tacticId || 'TA0004',
      technique: classification?.techniqueId || 'T1068',
      techniqueName: classification?.techniqueName || 'Exploitation for Privilege Escalation',
      mitreConfidence: classification?.confidence || 0.7,
      classificationMethod: classification?.method || 'pattern',
      description: `Privilege escalation (MOCK): ${method}`,
      sourceHost: target,
      targetHost: target,
      severity: 'High',
      status: 'Detected'
    });
    await event.save();

    attacker.currentPrivilege = 'Admin';
    attacker.riskLevel = 'Critical';
    await attacker.save();

    return { success: true, attackerId, real: false };
  }

  /**
   * Simulate REAL full attack campaign with MITRE classification
   */
  async simulateFullCampaign(params: { complexity?: string }) {
    const { complexity = 'advanced' } = params;

    // Check if we have enough VMs running
    const requiredVMs = ['fake-web-01', 'fake-jump-01', 'fake-ftp-01'];
    const availableVMs = requiredVMs.filter(vm => this.vmCache.has(vm));

    if (availableVMs.length < 2) {
      logger.warn('Not enough VMs running for full campaign, using mock data');
      return this.simulateFullCampaignMock(complexity);
    }

    logger.info(`🎯 Starting REAL full attack campaign simulation (complexity: ${complexity})`);

    const attackerIp = `10.20.20.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `attacker-${attackerIp.replace(/\./g, '-')}`;
    let eventsGenerated = 0;

    try {
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
      this.emit('attackerUpdated', attacker);

      // Stage 1: Initial Access (fake-web-01)
      await this.executeOnVM(
        'fake-web-01',
        `/usr/local/bin/syslogd-helper observe "Exploited public-facing application (fake-web-01)"`
      );

      const initialClassification = await this.mitreService.classifyEvent('web application exploit');

      const initialEvent = new AttackEvent({
        eventId: `evt-${uuidv4()}`,
        attackerId,
        type: 'Initial Access',
        tactic: initialClassification?.tactic || 'initial-access',
        tacticId: initialClassification?.tacticId || 'TA0001',
        technique: initialClassification?.techniqueId || 'T1190',
        techniqueName: initialClassification?.techniqueName || 'Exploit Public-Facing Application',
        description: 'Exploited public-facing application (fake-web-01)',
        sourceHost: attackerIp,
        targetHost: 'fake-web-01',
        severity: 'High',
        status: 'Detected'
      });
      await initialEvent.save();
      this.emit('newEvent', initialEvent);
      eventsGenerated++;

      await new Promise(resolve => setTimeout(resolve, 1500));

      // Stage 2: Discovery
      const discoveryCmds = ['whoami', 'uname -a', 'cat /etc/passwd'];
      for (const cmd of discoveryCmds) {
        await this.executeOnVM('fake-web-01', cmd);

        const classification = await this.mitreService.classifyEvent(cmd);

        const event = new AttackEvent({
          eventId: `evt-${uuidv4()}`,
          attackerId,
          type: 'Discovery',
          tactic: classification?.tactic || 'discovery',
          tacticId: classification?.tacticId || 'TA0007',
          technique: classification?.techniqueId || 'T1083',
          techniqueName: classification?.techniqueName || 'System Information Discovery',
          description: `System reconnaissance: ${cmd}`,
          sourceHost: 'fake-web-01',
          targetHost: 'fake-web-01',
          severity: 'Low',
          status: 'Detected',
          command: cmd
        });
        await event.save();
        this.emit('newEvent', event);
        eventsGenerated++;

        await new Promise(resolve => setTimeout(resolve, 800));
      }

      // Stage 3: Credential Theft
      await this.executeOnVM(
        'fake-web-01',
        `/usr/local/bin/syslogd-helper observe "Found database credentials in web application config"`
      );

      const credClassification = await this.mitreService.classifyEvent('credential theft from config');

      const credEvent = new AttackEvent({
        eventId: `evt-${uuidv4()}`,
        attackerId,
        type: 'Credential Theft',
        tactic: credClassification?.tactic || 'credential-access',
        tacticId: credClassification?.tacticId || 'TA0006',
        technique: credClassification?.techniqueId || 'T1003',
        techniqueName: credClassification?.techniqueName || 'OS Credential Dumping',
        description: 'Found database credentials in web application config',
        sourceHost: 'fake-web-01',
        targetHost: 'fake-web-01',
        severity: 'High',
        status: 'Detected'
      });
      await credEvent.save();
      this.emit('newEvent', credEvent);
      eventsGenerated++;

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
      const pivotTargets = ['fake-jump-01', 'fake-ftp-01'].filter(t => this.vmCache.has(t));
      let currentHost = 'fake-web-01';

      for (const target of pivotTargets) {
        try {
          await this.executeOnVM(
            currentHost,
            `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=2 vagrant@${this.vmCache.get(target)!.ip} "whoami" 2>&1 || true`
          );
        } catch (e) {
          // Connection attempt
        }

        await this.executeOnVM(
          currentHost,
          `/usr/local/bin/syslogd-helper observe "Pivoted to ${target} using stolen SSH credentials"`
        );

        await this.executeOnVM(
          target,
          `/usr/local/bin/syslogd-helper visit "${attackerIp}" "${target}"`
        );

        const moveClassification = await this.mitreService.classifyEvent('lateral movement ssh pivot');

        const moveEvent = new AttackEvent({
          eventId: `evt-${uuidv4()}`,
          attackerId,
          type: 'Lateral Movement',
          tactic: moveClassification?.tactic || 'lateral-movement',
          tacticId: moveClassification?.tacticId || 'TA0008',
          technique: moveClassification?.techniqueId || 'T1021',
          techniqueName: moveClassification?.techniqueName || 'Remote Services',
          description: `Pivoted to ${target} using stolen SSH credentials`,
          sourceHost: currentHost,
          targetHost: target,
          severity: 'High',
          status: 'Detected'
        });
        await moveEvent.save();
        this.emit('newEvent', moveEvent);
        eventsGenerated++;

        await LateralMovement.create({
          movementId: `mov-${uuidv4()}`,
          attackerId,
          sourceHost: currentHost,
          targetHost: target,
          technique: moveEvent.technique,
          method: 'SSH',
          successful: true
        });

        currentHost = target;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      // Stage 5: Privilege Escalation
      await this.executeOnVM(
        currentHost,
        `/usr/local/bin/syslogd-helper observe "Exploited local privilege escalation vulnerability"`
      );

      const privClassification = await this.mitreService.classifyEvent('privilege escalation exploit');

      const privEvent = new AttackEvent({
        eventId: `evt-${uuidv4()}`,
        attackerId,
        type: 'Privilege Escalation',
        tactic: privClassification?.tactic || 'privilege-escalation',
        tacticId: privClassification?.tacticId || 'TA0004',
        technique: privClassification?.techniqueId || 'T1068',
        techniqueName: privClassification?.techniqueName || 'Exploitation for Privilege Escalation',
        description: 'Exploited local privilege escalation vulnerability',
        sourceHost: currentHost,
        targetHost: currentHost,
        severity: 'Critical',
        status: 'Detected'
      });
      await privEvent.save();
      this.emit('newEvent', privEvent);
      eventsGenerated++;

      attacker.currentPrivilege = 'Admin';
      attacker.riskLevel = 'Critical';
      await attacker.save();

      await new Promise(resolve => setTimeout(resolve, 1500));

      // Stage 6: Data Exfiltration
      await this.executeOnVM(
        currentHost,
        `/usr/local/bin/syslogd-helper observe "Large data transfer detected to external IP"`
      );

      const exfilClassification = await this.mitreService.classifyEvent('data exfiltration');

      const exfilEvent = new AttackEvent({
        eventId: `evt-${uuidv4()}`,
        attackerId,
        type: 'Data Exfiltration',
        tactic: exfilClassification?.tactic || 'exfiltration',
        tacticId: exfilClassification?.tacticId || 'TA0010',
        technique: exfilClassification?.techniqueId || 'T1041',
        techniqueName: exfilClassification?.techniqueName || 'Exfiltration Over C2 Channel',
        description: 'Large data transfer detected to external IP',
        sourceHost: currentHost,
        targetHost: attackerIp,
        severity: 'Critical',
        status: 'Detected'
      });
      await exfilEvent.save();
      this.emit('newEvent', exfilEvent);
      eventsGenerated++;

      for (const vm of ['fake-web-01', ...pivotTargets]) {
        await this.executeOnVM(vm, '/usr/local/bin/syslogd-helper sync >/dev/null 2>&1 &');
      }

      this.emit('simulationComplete', {
        type: 'full-campaign',
        attackerId,
        campaign: 'Shadow Hydra',
        eventsGenerated,
        stagesCompleted: 6,
        real: true
      });

      return { success: true, attackerId, campaign: 'Shadow Hydra', stagesCompleted: 6, real: true };
    } catch (error) {
      logger.error('Real full campaign simulation failed:', error);
      return this.simulateFullCampaignMock(complexity);
    }
  }

  /**
   * Mock full campaign simulation
   */
  private async simulateFullCampaignMock(complexity: string) {
    logger.warn(`Using MOCK full campaign simulation (complexity: ${complexity})`);

    const attackerIp = `10.20.20.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `attacker-${attackerIp.replace(/\./g, '-')}`;

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

    // Create mock events for each stage
    const stages = [
      { type: 'Initial Access', technique: 'T1190', description: 'Exploited public-facing application' },
      { type: 'Discovery', technique: 'T1083', description: 'System reconnaissance' },
      { type: 'Credential Theft', technique: 'T1003', description: 'Found credentials in config' },
      { type: 'Lateral Movement', technique: 'T1021', description: 'Pivoted to internal hosts' },
      { type: 'Privilege Escalation', technique: 'T1068', description: 'Escalated to admin' },
      { type: 'Data Exfiltration', technique: 'T1041', description: 'Data transfer detected' }
    ];

    for (const stage of stages) {
      const classification = await this.mitreService.classifyEvent(stage.description);

      const event = new AttackEvent({
        eventId: `evt-${uuidv4()}`,
        attackerId,
        type: stage.type,
        tactic: classification?.tactic || 'unknown',
        tacticId: classification?.tacticId || 'TA0000',
        technique: classification?.techniqueId || stage.technique,
        techniqueName: classification?.techniqueName || stage.description,
        mitreConfidence: classification?.confidence || 0.7,
        classificationMethod: classification?.method || 'pattern',
        description: stage.description,
        sourceHost: attackerIp,
        targetHost: 'fake-web-01',
        severity: 'High',
        status: 'Detected'
      });
      await event.save();
    }

    return { success: true, attackerId, campaign: 'Shadow Hydra', stagesCompleted: 6, real: false };
  }

  /**
   * Refresh VM cache - force rediscovery of running VMs
   */
  async refreshVMs() {
    logger.info('Starting VM cache refresh...');
    this.vmCache.clear();
    await this.discoverVMs();
    const result = { count: this.vmCache.size, vms: Array.from(this.vmCache.keys()) };
    logger.info(`VM cache refresh complete: ${result.count} VMs found: [${result.vms.join(', ')}]`);
    return result;
  }

  /**
   * Manual VM cache population for debugging/testing
   * Use this if automatic discovery is not working
   */
  async populateVMCacheManually(vmConfigs: Array<{ name: string; path: string; ip: string }>) {
    this.vmCache.clear();
    for (const config of vmConfigs) {
      this.vmCache.set(config.name, { path: config.path, ip: config.ip });
      logger.info(`Manually added VM to cache: ${config.name} (${config.ip})`);
    }
    logger.info(`Manual VM cache populated with ${this.vmCache.size} VMs`);
    return { count: this.vmCache.size, vms: Array.from(this.vmCache.keys()) };
  }

  /**
   * Get current VM cache status
   */
  getVMCacheStatus() {
    return {
      count: this.vmCache.size,
      vms: Array.from(this.vmCache.entries()).map(([name, info]) => ({
        name,
        ip: info.ip,
        path: info.path
      }))
    };
  }
}
