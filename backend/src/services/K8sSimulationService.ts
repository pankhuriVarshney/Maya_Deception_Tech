// services/K8sSimulationService.ts
//
// K8s-decoy counterpart to RealSimulationService: same domain model
// (Attacker/AttackEvent/Credential), same MITRE classification service, but
// runs commands via `kubectl exec` against gVisor/Kata decoy pods instead of
// `vagrant ssh` against VMs. Kept as a separate file rather than merged into
// RealSimulationService so the (much larger, more established) Vagrant path
// is not put at risk by this addition.
//
// Full scenario parity with RealSimulationService: SSH brute force,
// lateral movement, credential theft, discovery, privilege escalation,
// and a multi-stage full campaign chaining several of the above.

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Attacker, AttackEvent, Credential } from '../models';
import { logger } from '../utils/logger';
import { MitreAttackService } from './MitreAttackService';
import {
  getTierClusters,
  listDecoyPods,
  execInPod,
  K8sPodInfo,
  TierCluster,
} from './k8s/K8sClient';

const STATE_FILE_PATH = '/var/lib/.state/.syscache';

interface ResolvedTarget {
  pod: K8sPodInfo;
  cluster: TierCluster;
}

export class K8sSimulationService extends EventEmitter {
  private mitreService: MitreAttackService;
  // appName (stable, e.g. "web-03") -> resolved pod/cluster. Rebuilt on
  // every simulation call rather than cached long-lived, since pod names
  // (and therefore exec targets) change on every restart.
  private targetCache: Map<string, ResolvedTarget> = new Map();

  constructor() {
    super();
    this.mitreService = new MitreAttackService();
  }

  async refreshTargets(): Promise<{ count: number; targets: string[] }> {
    this.targetCache.clear();
    const clusters = getTierClusters();

    for (const cluster of clusters) {
      const pods = await listDecoyPods(cluster);
      for (const pod of pods) {
        if (pod.phase === 'Running' && pod.ready) {
          this.targetCache.set(pod.appName, { pod, cluster });
        }
      }
    }

    return { count: this.targetCache.size, targets: Array.from(this.targetCache.keys()) };
  }

  hasTarget(appName: string): boolean {
    return this.targetCache.has(appName);
  }

  availableTargets(): string[] {
    return Array.from(this.targetCache.keys());
  }

  // syslogd-helper now lives only in the crdt-sync sidecar (see
  // maya-k8s/docker/crdt-sync/Dockerfile) -- separate rootfs and PID
  // namespace from the decoy container on purpose, so an attacker with a
  // shell in the decoy can't find the binary. Anything that needs to
  // invoke the binary itself must exec into this container, not the
  // decoy's own (which execOn below still correctly targets, for actual
  // attack-command execution -- whoami, discovery commands, etc.).
  private static readonly CRDT_SIDECAR_CONTAINER = 'crdt-sync';

  private async execOn(appName: string, command: string[]): Promise<{ stdout: string; stderr: string }> {
    const target = this.targetCache.get(appName);
    if (!target) {
      throw new Error(`K8s decoy ${appName} not found or not ready`);
    }

    const { stdout, stderr } = await execInPod(
      target.cluster,
      target.pod.podName,
      target.pod.containerName,
      command,
      10000
    );
    return { stdout, stderr };
  }

  /** Records to the pod's real CRDT state via the actual binary (visit/action/cred -- not the nonexistent `observe`), in the crdt-sync sidecar. */
  private async record(appName: string, args: string[]) {
    const target = this.targetCache.get(appName);
    if (!target) return;

    try {
      await execInPod(
        target.cluster,
        target.pod.podName,
        K8sSimulationService.CRDT_SIDECAR_CONTAINER,
        ['syslogd-helper', ...args],
        10000
      );
    } catch (error) {
      logger.debug(`K8s CRDT record failed on ${appName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async simulateSSHBruteForce(params: { target: string; attempts?: number }) {
    const { target, attempts = 5 } = params;

    if (!this.hasTarget(target)) {
      await this.refreshTargets();
    }
    if (!this.hasTarget(target)) {
      throw new Error(`K8s decoy '${target}' not found or not ready. Available: [${this.availableTargets().join(', ')}]`);
    }

    const resolved = this.targetCache.get(target)!;
    logger.info(`Starting K8s SSH brute force simulation on ${target} (tier=${resolved.pod.tier})`);

    const attackerIp = `10.30.30.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `APT-${attackerIp.replace(/\./g, '-')}`;
    let eventsGenerated = 0;

    const attacker = new Attacker({
      attackerId,
      ipAddress: attackerIp,
      entryPoint: target,
      currentPrivilege: 'User',
      riskLevel: 'Medium',
      campaign: 'Simulated Attack (K8s)',
      firstSeen: new Date(),
      lastSeen: new Date(),
      dwellTime: 0,
      status: 'Active',
      platform: 'k8s',
      tier: resolved.pod.tier === 'unknown' ? undefined : resolved.pod.tier,
    });
    await attacker.save();
    this.emit('attackerUpdated', attacker);

    await this.record(target, ['visit', attackerIp, target]);

    for (let i = 0; i < attempts; i++) {
      const fakeUser = `user${Math.floor(Math.random() * 100)}`;

      await this.record(target, ['action', attackerIp, target, `ssh_login_failed:${fakeUser}`]);

      const classification = await this.mitreService.classifyEvent('ssh brute force');
      const event = new AttackEvent({
        eventId: `evt-${uuidv4()}`,
        timestamp: new Date(),
        attackerId,
        stage: 'INITIAL_ACCESS',
        type: 'Initial Access',
        tactic: classification?.tactic || 'initial-access',
        tacticId: classification?.tacticId || 'TA0001',
        tacticName: classification?.tacticName || 'Initial Access',
        technique: classification?.techniqueId || 'T1110',
        techniqueName: classification?.techniqueName || 'Brute Force',
        isSubtechnique: classification?.isSubtechnique || false,
        mitreConfidence: classification?.confidence || 0.7,
        classificationMethod: classification?.method || 'pattern',
        allMatchingTechniques: classification?.allMatches || ['T1110'],
        description: `Failed SSH login attempt ${i + 1}/${attempts}`,
        sourceHost: attackerIp,
        targetHost: target,
        severity: i >= attempts - 1 ? 'High' : 'Medium',
        status: 'Detected',
      });
      await event.save();
      this.emit('newEvent', event);
      eventsGenerated++;

      await new Promise(resolve => setTimeout(resolve, 300));
    }

    const username = 'admin';
    const password = 'changeme';

    await this.record(target, ['action', attackerIp, target, `ssh_login_success:${username}`]);
    await this.record(target, ['cred', `${username}:${password}`]);

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
      lastUsed: new Date(),
    });

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
      status: 'Detected',
    });
    await successEvent.save();
    this.emit('newEvent', successEvent);
    eventsGenerated++;

    this.emit('simulationComplete', { type: 'ssh-bruteforce-k8s', target, attackerId, eventsGenerated });

    return { real: true, attackerId, eventsGenerated, tier: resolved.pod.tier };
  }

  async simulateLateralMovement(params: { source: string; targets: string[] }) {
    const { source, targets } = params;

    await this.refreshTargets();
    if (!this.hasTarget(source)) {
      throw new Error(`K8s decoy '${source}' not found or not ready. Available: [${this.availableTargets().join(', ')}]`);
    }
    const availableTargets = targets.filter(t => this.hasTarget(t));

    const attackerIp = `10.30.30.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `APT-${attackerIp.replace(/\./g, '-')}`;
    let eventsGenerated = 0;
    const path: string[] = [source];

    await this.record(source, ['visit', attackerIp, source]);

    let currentHost = source;
    for (const nextTarget of availableTargets) {
      await this.record(currentHost, ['action', attackerIp, currentHost, `ssh_pivot_to:${nextTarget}`]);
      // Recording the visit on the DESTINATION pod, using the same
      // attackerIp, is what proves cross-pod CRDT consistency -- the same
      // attacker identity now shows up in two independent pods' state
      // files, merged into one MongoDB record by K8sDiscoveryService's
      // polling (crdtState counts) same as the Attacker record already
      // ties them together via attackerId.
      await this.record(nextTarget, ['visit', attackerIp, nextTarget]);

      const classification = await this.mitreService.classifyEvent('ssh pivot lateral movement');
      const event = new AttackEvent({
        eventId: `evt-${uuidv4()}`,
        timestamp: new Date(),
        attackerId,
        stage: 'LATERAL_MOVEMENT',
        type: 'Lateral Movement',
        tactic: classification?.tactic || 'lateral-movement',
        tacticId: classification?.tacticId || 'TA0008',
        tacticName: classification?.tacticName || 'Lateral Movement',
        technique: classification?.techniqueId || 'T1021',
        techniqueName: classification?.techniqueName || 'Remote Services',
        isSubtechnique: classification?.isSubtechnique || false,
        mitreConfidence: classification?.confidence || 0.75,
        classificationMethod: classification?.method || 'pattern',
        allMatchingTechniques: classification?.allMatches || ['T1021'],
        description: `SSH pivot from ${currentHost} to ${nextTarget}`,
        sourceHost: currentHost,
        targetHost: nextTarget,
        severity: 'High',
        status: 'Detected',
      });
      await event.save();
      this.emit('newEvent', event);
      eventsGenerated++;

      path.push(nextTarget);
      currentHost = nextTarget;
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    await Attacker.findOneAndUpdate(
      { attackerId },
      {
        attackerId,
        ipAddress: attackerIp,
        entryPoint: source,
        currentPrivilege: 'User',
        riskLevel: 'High',
        campaign: 'Simulated Attack (K8s)',
        lastSeen: new Date(),
        status: 'Active',
        platform: 'k8s',
      },
      { upsert: true }
    );

    this.emit('simulationComplete', { type: 'lateral-movement-k8s', attackerId, path, eventsGenerated });

    return { real: true, attackerId, path, eventsGenerated };
  }

  async simulateCredentialTheft(params: { target: string; tool?: string }) {
    const { target, tool = 'mimikatz' } = params;

    if (!this.hasTarget(target)) await this.refreshTargets();
    if (!this.hasTarget(target)) {
      throw new Error(`K8s decoy '${target}' not found or not ready. Available: [${this.availableTargets().join(', ')}]`);
    }
    const resolved = this.targetCache.get(target)!;

    logger.info(`Starting K8s credential theft simulation on ${target} (tier=${resolved.pod.tier})`);

    const attackerIp = `10.30.30.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `APT-${attackerIp.replace(/\./g, '-')}`;
    let eventsGenerated = 0;

    const attacker = new Attacker({
      attackerId,
      ipAddress: attackerIp,
      entryPoint: target,
      currentPrivilege: 'Admin',
      riskLevel: 'Critical',
      campaign: 'Simulated Attack (K8s)',
      firstSeen: new Date(),
      lastSeen: new Date(),
      dwellTime: 0,
      status: 'Active',
      platform: 'k8s',
      tier: resolved.pod.tier === 'unknown' ? undefined : resolved.pod.tier,
    });
    await attacker.save();
    this.emit('attackerUpdated', attacker);

    const mimikatzCommand = `${tool} sekurlsa::logonpasswords`;
    await this.record(target, ['action', attackerIp, target, `credential_dump:${tool}`]);

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
      status: 'Detected',
    });
    await dumpEvent.save();
    this.emit('newEvent', dumpEvent);
    eventsGenerated++;

    const stolenCreds = [
      { username: 'admin', password: 'Admin123!' },
      { username: 'root', password: 'root123' },
      { username: 'dbuser', password: 'dbpass123' },
    ];

    for (const cred of stolenCreds) {
      await this.record(target, ['cred', `${cred.username}:${cred.password}`]);

      await Credential.create({
        credentialId: `cred-${uuidv4()}`,
        username: cred.username,
        password: cred.password,
        source: target,
        attackerId,
        decoyHost: target,
        status: 'Stolen',
        riskScore: cred.username.includes('admin') || cred.username === 'root' ? 90 : 70,
      });

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
        status: 'Detected',
      });
      await credEvent.save();
      this.emit('newEvent', credEvent);
      eventsGenerated++;
    }

    this.emit('simulationComplete', { type: 'credential-theft-k8s', attackerId, target, credentialsStolen: stolenCreds.length, eventsGenerated });

    return { real: true, attackerId, credentialsStolen: stolenCreds.length, eventsGenerated, tier: resolved.pod.tier };
  }

  async simulateDiscovery(params: { source: string; scanType?: string }) {
    const { source } = params;

    if (!this.hasTarget(source)) await this.refreshTargets();
    if (!this.hasTarget(source)) {
      throw new Error(`K8s decoy '${source}' not found or not ready. Available: [${this.availableTargets().join(', ')}]`);
    }
    const resolved = this.targetCache.get(source)!;

    logger.info(`Starting K8s discovery simulation from ${source} (tier=${resolved.pod.tier})`);

    const attackerIp = `10.30.30.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `APT-${attackerIp.replace(/\./g, '-')}`;
    let eventsGenerated = 0;

    const attacker = new Attacker({
      attackerId,
      ipAddress: attackerIp,
      entryPoint: source,
      currentPrivilege: 'User',
      riskLevel: 'Medium',
      campaign: 'Simulated Attack (K8s)',
      firstSeen: new Date(),
      lastSeen: new Date(),
      dwellTime: 0,
      status: 'Active',
      platform: 'k8s',
      tier: resolved.pod.tier === 'unknown' ? undefined : resolved.pod.tier,
    });
    await attacker.save();
    this.emit('attackerUpdated', attacker);

    await this.record(source, ['visit', attackerIp, source]);

    const discoveryCommands = [
      { cmd: 'netstat -tulpn', technique: 'T1049', tactic: 'discovery', desc: 'System network connections' },
      { cmd: 'cat /etc/passwd', technique: 'T1087', tactic: 'discovery', desc: 'Account discovery' },
      { cmd: 'find / -name "*.conf" 2>/dev/null', technique: 'T1083', tactic: 'discovery', desc: 'File and directory discovery' },
      { cmd: 'ps aux', technique: 'T1057', tactic: 'discovery', desc: 'Process discovery' },
      { cmd: 'ip addr', technique: 'T1016', tactic: 'discovery', desc: 'System network configuration discovery' },
      { cmd: 'cat /etc/hosts', technique: 'T1016', tactic: 'discovery', desc: 'Host file discovery' },
    ];

    for (const { cmd, technique, tactic, desc } of discoveryCommands) {
      try {
        await this.execOn(source, ['sh', '-c', cmd]);
      } catch {
        // command may not exist on this decoy's minimal image -- still log the attempt
      }

      await this.record(source, ['action', attackerIp, source, `discovery:${cmd.slice(0, 40)}`]);

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
        status: 'Detected',
      });
      await event.save();
      this.emit('newEvent', event);
      eventsGenerated++;

      await new Promise(resolve => setTimeout(resolve, 400));
    }

    this.emit('simulationComplete', { type: 'discovery-k8s', attackerId, source, eventsGenerated });

    return { real: true, attackerId, commandsExecuted: discoveryCommands.length, eventsGenerated, tier: resolved.pod.tier };
  }

  async simulatePrivilegeEscalation(params: { target: string; method?: string }) {
    const { target, method = 'sudo-exploit' } = params;

    if (!this.hasTarget(target)) await this.refreshTargets();
    if (!this.hasTarget(target)) {
      throw new Error(`K8s decoy '${target}' not found or not ready. Available: [${this.availableTargets().join(', ')}]`);
    }
    const resolved = this.targetCache.get(target)!;

    logger.info(`Starting K8s privilege escalation simulation on ${target} (tier=${resolved.pod.tier})`);

    const attackerIp = `10.30.30.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `APT-${attackerIp.replace(/\./g, '-')}`;
    let eventsGenerated = 0;

    const attacker = new Attacker({
      attackerId,
      ipAddress: attackerIp,
      entryPoint: target,
      currentPrivilege: 'User',
      riskLevel: 'High',
      campaign: 'Simulated Attack (K8s)',
      firstSeen: new Date(),
      lastSeen: new Date(),
      dwellTime: 0,
      status: 'Active',
      platform: 'k8s',
      tier: resolved.pod.tier === 'unknown' ? undefined : resolved.pod.tier,
    });
    await attacker.save();
    this.emit('attackerUpdated', attacker);

    await this.record(target, ['action', attackerIp, target, 'initial_user_access']);

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
      status: 'Detected',
    });
    await initialEvent.save();
    this.emit('newEvent', initialEvent);
    eventsGenerated++;

    const escalationCommand = method === 'sudo-exploit' ? 'sudo -l' : method;
    try {
      await this.execOn(target, ['sh', '-c', escalationCommand]);
    } catch {
      // expected to fail/be restricted on a decoy -- the attempt itself is what's recorded
    }
    await this.record(target, ['action', attackerIp, target, `privesc_attempt:${method}`]);

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
      command: escalationCommand,
    });
    await escalateEvent.save();
    this.emit('newEvent', escalateEvent);
    eventsGenerated++;

    await this.record(target, ['action', attackerIp, target, 'privesc_success:root']);

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
      description: 'Successfully escalated to root/Administrator privileges',
      sourceHost: target,
      targetHost: target,
      severity: 'Critical',
      status: 'Detected',
    });
    await successEvent.save();
    this.emit('newEvent', successEvent);
    eventsGenerated++;

    attacker.currentPrivilege = 'Admin';
    attacker.riskLevel = 'Critical';
    await attacker.save();

    this.emit('simulationComplete', { type: 'privilege-escalation-k8s', attackerId, target, eventsGenerated });

    return { real: true, attackerId, eventsGenerated, tier: resolved.pod.tier };
  }

  /**
   * Multi-stage campaign chaining initial access -> discovery -> credential
   * theft -> lateral movement -> privilege escalation -> exfiltration,
   * mirroring RealSimulationService's "Shadow Hydra" campaign but resolving
   * decoy names dynamically from whatever K8s decoys are actually
   * discovered, instead of hardcoding Vagrant's fake-web-01/fake-jump-01.
   */
  async simulateFullCampaign(params: { complexity?: string }) {
    const { complexity = 'advanced' } = params;

    await this.refreshTargets();
    const targets = this.availableTargets();
    if (targets.length < 2) {
      throw new Error(`Not enough K8s decoys running for a full campaign (need >= 2, found: [${targets.join(', ')}])`);
    }

    const entry = targets[0];
    const pivotTargets = targets.slice(1);
    const entryTier = this.targetCache.get(entry)!.pod.tier;

    logger.info(`Starting K8s full campaign (complexity=${complexity}) starting at ${entry}`);

    const attackerIp = `10.30.30.${Math.floor(Math.random() * 100) + 100}`;
    const attackerId = `APT-${attackerIp.replace(/\./g, '-')}`;
    let eventsGenerated = 0;

    const attacker = new Attacker({
      attackerId,
      ipAddress: attackerIp,
      entryPoint: entry,
      currentPrivilege: 'User',
      riskLevel: 'Medium',
      campaign: 'Shadow Hydra (K8s)',
      firstSeen: new Date(),
      lastSeen: new Date(),
      dwellTime: 0,
      status: 'Active',
      platform: 'k8s',
      tier: entryTier === 'unknown' ? undefined : entryTier,
    });
    await attacker.save();
    this.emit('attackerUpdated', attacker);

    // Stage 1: Initial Access
    await this.record(entry, ['visit', attackerIp, entry]);
    await this.record(entry, ['action', attackerIp, entry, 'exploited_public_app']);
    const initialClassification = await this.mitreService.classifyEvent('web application exploit');
    const initialEvent = new AttackEvent({
      eventId: `evt-${uuidv4()}`,
      attackerId,
      type: 'Initial Access',
      tactic: initialClassification?.tactic || 'initial-access',
      tacticId: initialClassification?.tacticId || 'TA0001',
      technique: initialClassification?.techniqueId || 'T1190',
      techniqueName: initialClassification?.techniqueName || 'Exploit Public-Facing Application',
      description: `Exploited public-facing application (${entry})`,
      sourceHost: attackerIp,
      targetHost: entry,
      severity: 'High',
      status: 'Detected',
    });
    await initialEvent.save();
    this.emit('newEvent', initialEvent);
    eventsGenerated++;

    await new Promise(resolve => setTimeout(resolve, 500));

    // Stage 2: Discovery
    for (const cmd of ['whoami', 'uname -a', 'cat /etc/passwd']) {
      try {
        await this.execOn(entry, ['sh', '-c', cmd]);
      } catch {
        // best-effort
      }
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
        sourceHost: entry,
        targetHost: entry,
        severity: 'Low',
        status: 'Detected',
        command: cmd,
      });
      await event.save();
      this.emit('newEvent', event);
      eventsGenerated++;
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Stage 3: Credential Theft
    await this.record(entry, ['action', attackerIp, entry, 'found_db_credentials']);
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
      sourceHost: entry,
      targetHost: entry,
      severity: 'High',
      status: 'Detected',
    });
    await credEvent.save();
    this.emit('newEvent', credEvent);
    eventsGenerated++;

    await this.record(entry, ['cred', 'dbadmin:DbP@ss2024!']);
    await Credential.create({
      credentialId: `cred-${uuidv4()}`,
      username: 'dbadmin',
      password: 'DbP@ss2024!',
      source: entry,
      attackerId,
      decoyHost: entry,
      status: 'Stolen',
      riskScore: 85,
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    // Stage 4: Lateral Movement
    let currentHost = entry;
    for (const pivotTarget of pivotTargets) {
      await this.record(currentHost, ['action', attackerIp, currentHost, `pivot_to:${pivotTarget}`]);
      await this.record(pivotTarget, ['visit', attackerIp, pivotTarget]);

      const moveClassification = await this.mitreService.classifyEvent('lateral movement ssh pivot');
      const moveEvent = new AttackEvent({
        eventId: `evt-${uuidv4()}`,
        attackerId,
        type: 'Lateral Movement',
        tactic: moveClassification?.tactic || 'lateral-movement',
        tacticId: moveClassification?.tacticId || 'TA0008',
        technique: moveClassification?.techniqueId || 'T1021',
        techniqueName: moveClassification?.techniqueName || 'Remote Services',
        description: `Pivoted to ${pivotTarget} using stolen credentials`,
        sourceHost: currentHost,
        targetHost: pivotTarget,
        severity: 'High',
        status: 'Detected',
      });
      await moveEvent.save();
      this.emit('newEvent', moveEvent);
      eventsGenerated++;

      currentHost = pivotTarget;
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Stage 5: Privilege Escalation
    await this.record(currentHost, ['action', attackerIp, currentHost, 'privesc_exploit']);
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
      status: 'Detected',
    });
    await privEvent.save();
    this.emit('newEvent', privEvent);
    eventsGenerated++;

    attacker.currentPrivilege = 'Admin';
    attacker.riskLevel = 'Critical';
    await attacker.save();

    await new Promise(resolve => setTimeout(resolve, 500));

    // Stage 6: Data Exfiltration
    await this.record(currentHost, ['action', attackerIp, currentHost, 'large_data_transfer']);
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
      status: 'Detected',
    });
    await exfilEvent.save();
    this.emit('newEvent', exfilEvent);
    eventsGenerated++;

    this.emit('simulationComplete', { type: 'full-campaign-k8s', attackerId, campaign: 'Shadow Hydra (K8s)', eventsGenerated, stagesCompleted: 6 });

    return { real: true, attackerId, campaign: 'Shadow Hydra (K8s)', stagesCompleted: 6, eventsGenerated };
  }
}
