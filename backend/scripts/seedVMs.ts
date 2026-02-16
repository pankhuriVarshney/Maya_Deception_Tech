import mongoose from 'mongoose';
import { VMStatus } from '../src/models';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/maya_deception';

async function seedVMs() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing
    await VMStatus.deleteMany({});
    console.log('Cleared existing VM status');

    // Create initial VM entries (will be updated by CRDT sync)
    const vms = [
      { vmName: 'fake-ftp-01', hostname: 'fake-ftp-01', status: 'unknown' },
      { vmName: 'fake-jump-01', hostname: 'fake-jump-01', status: 'unknown' },
      { vmName: 'fake-rdp-01', hostname: 'fake-rdp-01', status: 'unknown' },
      { vmName: 'fake-smb-01', hostname: 'fake-smb-01', status: 'unknown' },
      { vmName: 'fake-web-01', hostname: 'fake-web-01', status: 'unknown' },
      { vmName: 'fake-web-02', hostname: 'fake-web-02', status: 'unknown' },
      { vmName: 'gateway-vm', hostname: 'gateway-vm', status: 'unknown' },
    ];

    for (const vm of vms) {
      await VMStatus.create({
        ...vm,
        lastSeen: new Date(),
        crdtState: { attackers: 0, credentials: 0, sessions: 0, hash: '' },
        dockerContainers: []
      });
    }

    console.log('Created initial VM entries');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

seedVMs();