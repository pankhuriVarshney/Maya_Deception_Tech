import mongoose from 'mongoose';
import { Attacker, AttackEvent, Credential, DecoyHost, LateralMovement } from '../models';
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/maya_deception';

async function seedDatabase() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    await Promise.all([
      Attacker.deleteMany({}),
      AttackEvent.deleteMany({}),
      Credential.deleteMany({}),
      DecoyHost.deleteMany({}),
      LateralMovement.deleteMany({})
    ]);
    console.log('Cleared existing data');

    const decoys = [
      { hostId: 'decoy-web-01', hostname: 'fake-web-01', ipAddress: '192.168.10.241', segment: 'DMZ', os: 'Linux', services: ['nginx', 'ssh'], deploymentType: 'VM' },
      { hostId: 'decoy-web-02', hostname: 'fake-web-02', ipAddress: '192.168.10.242', segment: 'DMZ', os: 'Linux', services: ['nginx', 'mysql'], deploymentType: 'VM' },
      { hostId: 'decoy-ftp-01', hostname: 'fake-ftp-01', ipAddress: '192.168.10.243', segment: 'DMZ', os: 'Linux', services: ['vsftpd'], deploymentType: 'VM' },
      { hostId: 'decoy-redis-01', hostname: 'fake-redis-01', ipAddress: '192.168.10.244', segment: 'Database', os: 'Linux', services: ['redis'], deploymentType: 'VM' },
      { hostId: 'decoy-jump-01', hostname: 'fake-jump-01', ipAddress: '192.168.10.245', segment: 'Jump', os: 'Linux', services: ['ssh'], deploymentType: 'VM' },
      { hostId: 'decoy-rdp-01', hostname: 'fake-rdp-01', ipAddress: '192.168.10.246', segment: 'Internal', os: 'Windows', services: ['rdp', 'smb'], deploymentType: 'VM' }
    ];

    await DecoyHost.insertMany(decoys);
    console.log('Created decoy hosts');

    const attackers = [
      {
        attackerId: 'APT-192-168-1-100',
        ipAddress: '192.168.1.100',
        entryPoint: 'fake-web-01',
        currentPrivilege: 'Admin',
        riskLevel: 'Critical',
        campaign: 'Shadow Hydra',
        firstSeen: moment().subtract(2, 'hours').toDate(),
        lastSeen: moment().subtract(5, 'minutes').toDate(),
        dwellTime: 120,
        status: 'Active',
        geolocation: { country: 'Unknown', city: 'Tor Exit Node', coordinates: [0, 0] },
        fingerprint: { userAgent: 'Mozilla/5.0', os: 'Linux', tools: ['nmap', 'metasploit'] }
      },
      {
        attackerId: 'APT-10-0-0-50',
        ipAddress: '10.0.0.50',
        entryPoint: 'fake-ftp-01',
        currentPrivilege: 'User',
        riskLevel: 'High',
        campaign: 'Opportunistic',
        firstSeen: moment().subtract(5, 'hours').toDate(),
        lastSeen: moment().subtract(30, 'minutes').toDate(),
        dwellTime: 90,
        status: 'Active',
        fingerprint: { userAgent: 'curl/7.68.0', os: 'Windows', tools: ['hydra'] }
      }
    ];

    await Attacker.insertMany(attackers);
    console.log('Created sample attackers');

    const events = [
      {
        eventId: `evt-${uuidv4()}`,
        timestamp: moment().subtract(2, 'hours').toDate(),
        attackerId: 'APT-192-168-1-100',
        type: 'Initial Access',
        technique: 'T1078',
        tactic: 'Initial Access',
        description: 'Initial Access: Phishing Email',
        sourceHost: '192.168.1.100',
        targetHost: 'fake-web-01',
        severity: 'High',
        status: 'Detected'
      },
      {
        eventId: `evt-${uuidv4()}`,
        timestamp: moment().subtract(1, 'hours').subtract(45, 'minutes').toDate(),
        attackerId: 'APT-192-168-1-100',
        type: 'Credential Theft',
        technique: 'T1003',
        tactic: 'Credential Access',
        description: 'Credential Theft: admin_user',
        sourceHost: 'fake-web-01',
        targetHost: 'fake-web-01',
        command: 'mimikatz.exe',
        severity: 'Critical',
        status: 'Detected'
      },
      {
        eventId: `evt-${uuidv4()}`,
        timestamp: moment().subtract(1, 'hours').subtract(15, 'minutes').toDate(),
        attackerId: 'APT-192-168-1-100',
        type: 'Lateral Movement',
        technique: 'T1021',
        tactic: 'Lateral Movement',
        description: 'Lateral Movement: to Decoy Server 2',
        sourceHost: 'fake-web-01',
        targetHost: 'fake-jump-01',
        severity: 'High',
        status: 'In Progress'
      },
      {
        eventId: `evt-${uuidv4()}`,
        timestamp: moment().subtract(48, 'minutes').toDate(),
        attackerId: 'APT-192-168-1-100',
        type: 'Command Execution',
        technique: 'T1059',
        tactic: 'Execution',
        description: 'Command Executed: Mimikatz Dump',
        sourceHost: 'fake-jump-01',
        targetHost: 'fake-jump-01',
        command: 'sekurlsa::logonpasswords',
        severity: 'Critical',
        status: 'Detected'
      },
      {
        eventId: `evt-${uuidv4()}`,
        timestamp: moment().subtract(20, 'minutes').toDate(),
        attackerId: 'APT-192-168-1-100',
        type: 'Data Exfiltration',
        technique: 'T1041',
        tactic: 'Exfiltration',
        description: 'Data Exfiltration Attempt',
        sourceHost: 'fake-redis-01',
        targetHost: '192.168.1.100',
        severity: 'Critical',
        status: 'Blocked'
      }
    ];

    await AttackEvent.insertMany(events);
    console.log('Created attack events');

    const credentials = [
      {
        credentialId: `cred-${uuidv4()}`,
        username: 'admin_user',
        password: 'Summer2024!',
        source: 'fake-web-01',
        attackerId: 'APT-192-168-1-100',
        decoyHost: 'fake-web-01',
        timestamp: moment().subtract(1, 'hours').subtract(45, 'minutes').toDate(),
        usageCount: 3,
        lastUsed: moment().subtract(20, 'minutes').toDate(),
        status: 'Used',
        riskScore: 85
      },
      {
        credentialId: `cred-${uuidv4()}`,
        username: 'db_service',
        password: 'DbP@ssw0rd123',
        source: 'fake-redis-01',
        attackerId: 'APT-192-168-1-100',
        decoyHost: 'fake-redis-01',
        timestamp: moment().subtract(30, 'minutes').toDate(),
        usageCount: 1,
        status: 'Stolen',
        riskScore: 90
      },
      {
        credentialId: `cred-${uuidv4()}`,
        username: 'backup_account',
        password: 'Backup2024!',
        source: 'fake-ftp-01',
        attackerId: 'APT-10-0-0-50',
        decoyHost: 'fake-ftp-01',
        timestamp: moment().subtract(3, 'hours').toDate(),
        usageCount: 0,
        status: 'Stolen',
        riskScore: 75
      }
    ];

    await Credential.insertMany(credentials);
    console.log('Created credentials');

    const movements = [
      {
        movementId: `mov-${uuidv4()}`,
        attackerId: 'APT-192-168-1-100',
        timestamp: moment().subtract(1, 'hours').subtract(15, 'minutes').toDate(),
        sourceHost: 'fake-web-01',
        targetHost: 'fake-jump-01',
        technique: 'T1021.004',
        method: 'SSH',
        successful: true
      },
      {
        movementId: `mov-${uuidv4()}`,
        attackerId: 'APT-192-168-1-100',
        timestamp: moment().subtract(45, 'minutes').toDate(),
        sourceHost: 'fake-jump-01',
        targetHost: 'fake-redis-01',
        technique: 'T1021.002',
        method: 'SMB',
        successful: true
      }
    ];

    await LateralMovement.insertMany(movements);
    console.log('Created lateral movements');

    console.log('\n✅ Database seeded successfully!');
    console.log('You can now start the dashboard and see sample data.');
    
  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seedDatabase();