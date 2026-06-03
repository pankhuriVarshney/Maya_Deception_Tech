import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

import { VMStatus } from '../models';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

type VMRunState = 'running' | 'stopped' | 'unknown' | 'error' | 'not_created';

export class CRDTSyncService extends EventEmitter {
  private syncInterval?: NodeJS.Timeout;
  private vmStatusInterval?: NodeJS.Timeout;
  private vagrantDir: string;
  private isSyncing = false;
  private simulationMode: boolean;
  private warnedSimulationMode = false;
  private warnedVmPollingFailure = false;

  constructor() {
    super();
    this.vagrantDir = process.env.VAGRANT_DIR || path.join(__dirname, '../../simulations/fake');
    this.simulationMode = process.env.SIMULATION_MODE === 'true';

    if (this.simulationMode) {
      this.logSimulationModeWarning();
    }
  }

  startSyncLoop(intervalMs: number = 10000) {
    this.syncInterval = setInterval(() => {
      if (!this.isSyncing) {
        this.performSync().catch(err => logger.error('CRDT sync error:', err));
      }
    }, intervalMs);

    this.vmStatusInterval = setInterval(() => {
      this.updateVMStatusInDB().catch(err => logger.error('VM status update error:', err));
    }, 10000);

    this.updateVMStatusInDB().catch(err => logger.error('Initial VM status error:', err));
    logger.info(`Started CRDT sync loop with ${intervalMs}ms interval`);
  }

  stopSyncLoop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
    }

    if (this.vmStatusInterval) {
      clearInterval(this.vmStatusInterval);
      this.vmStatusInterval = undefined;
    }
  }

  async performSync() {
    if (this.simulationMode) {
      this.emit('syncComplete', {
        simulationMode: true,
        attackersFound: 0,
        timestamp: new Date().toISOString()
      });
      return;
    }

    this.isSyncing = true;

    try {
      if (!fs.existsSync(this.vagrantDir)) {
        this.warnVmPollingOnce(`Vagrant directory not found: ${this.vagrantDir}`);
        await this.getSeededVMStatus();
        this.emit('syncComplete', { attackersFound: 0, fallback: true });
        return;
      }

      const vmDirs = this.getVagrantVmDirs();
      for (const vmName of vmDirs) {
        await this.collectVmCrdtState(vmName);
      }

      this.emit('syncComplete', {
        attackersFound: 0,
        vmCount: vmDirs.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.warnVmPollingOnce(`CRDT sync failed, using cached VM status: ${error instanceof Error ? error.message : 'Unknown error'}`);
      await this.getSeededVMStatus();
      this.emit('syncComplete', { attackersFound: 0, fallback: true });
    } finally {
      this.isSyncing = false;
    }
  }

  private async updateVMStatusInDB() {
    if (this.simulationMode) {
      await this.getSeededVMStatus();
      return;
    }

    if (!fs.existsSync(this.vagrantDir)) {
      this.warnVmPollingOnce(`Vagrant directory not found: ${this.vagrantDir}`);
      await this.getSeededVMStatus();
      return;
    }

    try {
      const vmDirs = this.getVagrantVmDirs();

      if (vmDirs.length === 0) {
        this.warnVmPollingOnce('No Vagrant VM directories found, using cached VM status');
        await this.getSeededVMStatus();
        return;
      }

      await VMStatus.deleteMany({ vmName: { $nin: vmDirs } });

      for (const vmName of vmDirs) {
        const vmPath = path.join(this.vagrantDir, vmName);
        const vmStatus = await this.getVMStatus(vmName, vmPath);

        await VMStatus.findOneAndUpdate(
          { vmName },
          {
            vmName,
            hostname: vmName,
            status: vmStatus.status === 'not_created' ? 'stopped' : vmStatus.status,
            ip: vmStatus.ip,
            lastSeen: new Date(),
            crdtState: vmStatus.status === 'running'
              ? await this.getCrdtState(vmPath)
              : { attackers: 0, credentials: 0, sessions: 0, hash: '' },
            dockerContainers: vmStatus.status === 'running'
              ? await this.getDockerContainers(vmPath)
              : []
          },
          { upsert: true, new: true }
        );
      }
    } catch (error) {
      this.warnVmPollingOnce(`VM status polling failed, using cached VM status: ${error instanceof Error ? error.message : 'Unknown error'}`);
      await this.getSeededVMStatus();
    }
  }

  private getVagrantVmDirs(): string[] {
    return fs.readdirSync(this.vagrantDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .filter(name => fs.existsSync(path.join(this.vagrantDir, name, 'Vagrantfile')));
  }

  private async getVMStatus(vmName: string, vmPath: string): Promise<{
    status: VMRunState;
    exists: boolean;
    ip?: string;
  }> {
    try {
      const domainName = `${vmName}_default`;
      const { stdout } = await execAsync(`virsh domstate ${domainName} 2>/dev/null || true`, { timeout: 5000 });
      const state = stdout.trim().toLowerCase();

      if (state === 'running') {
        return { status: 'running', exists: true, ip: await this.getVmIp(vmPath) };
      }

      if (state === 'shut off' || state === 'shutdown' || state === 'paused') {
        return { status: 'stopped', exists: true };
      }
    } catch (error) {
      logger.debug(`virsh status failed for ${vmName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    try {
      const { stdout } = await execAsync(
        `cd "${vmPath}" && vagrant status --machine-readable`,
        { timeout: 10000 }
      );
      const stateLine = stdout.split('\n').find(line => line.includes(',state,') && !line.includes('state-human'));
      const state = stateLine?.split(',')[3]?.trim();

      if (state === 'running') {
        return { status: 'running', exists: true, ip: await this.getVmIp(vmPath) };
      }

      if (state === 'not_created') {
        return { status: 'not_created', exists: false };
      }

      return { status: state ? 'stopped' : 'unknown', exists: Boolean(state) };
    } catch (error) {
      logger.debug(`vagrant status failed for ${vmName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { status: 'error', exists: false };
    }
  }

  private async getVmIp(vmPath: string): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync(
        `cd "${vmPath}" && vagrant ssh -c "hostname -I 2>/dev/null || ip addr show | grep 'inet ' | grep -v '127.0.0.1' | awk '{print \\$2}' | cut -d/ -f1" 2>/dev/null`,
        { timeout: 8000, killSignal: 'SIGTERM' }
      );

      return stdout
        .split('\n')
        .map(line => line.trim())
        .find(line => /^\d+\.\d+\.\d+\.\d+$/.test(line));
    } catch (error) {
      logger.debug(`VM IP lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return undefined;
    }
  }

  private async getCrdtState(vmPath: string) {
    try {
      const { stdout } = await execAsync(
        `cd "${vmPath}" && vagrant ssh -c "if command -v syslogd-helper >/dev/null 2>&1; then sudo syslogd-helper stats 2>/dev/null; else echo '{}'; fi" 2>/dev/null`,
        { timeout: 8000, killSignal: 'SIGTERM' }
      );
      const cleaned = stdout.split('\n')
        .filter(line => !line.includes('[fog]') && !line.includes('libvirt_ip_command'))
        .join('\n')
        .trim();

      if (!cleaned || cleaned === '{}') {
        return { attackers: 0, credentials: 0, sessions: 0, hash: '' };
      }

      const stats = JSON.parse(cleaned);
      return {
        attackers: Object.keys(stats.attackers || {}).length,
        credentials: Object.keys(stats.stolen_creds?.adds || {}).length,
        sessions: Object.keys(stats.active_sessions?.entries || {}).length,
        hash: stats.state_hash || ''
      };
    } catch (error) {
      logger.debug(`CRDT stats lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { attackers: 0, credentials: 0, sessions: 0, hash: '' };
    }
  }

  private async getDockerContainers(vmPath: string) {
    try {
      const { stdout } = await execAsync(
        `cd "${vmPath}" && vagrant ssh -c "sudo docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' 2>/dev/null || echo ''" 2>/dev/null`,
        { timeout: 8000, killSignal: 'SIGTERM' }
      );

      return stdout.split('\n')
        .filter(line => line.includes('|'))
        .map(line => {
          const parts = line.split('|');
          return {
            id: parts[0]?.substring(0, 12) || '',
            name: parts[1] || '',
            image: parts[2] || '',
            status: parts[3]?.includes('Up') ? 'running' : 'exited',
            ports: parts[4] ? parts[4].split(', ') : [],
            created: ''
          };
        });
    } catch (error) {
      logger.debug(`Docker container lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  private async collectVmCrdtState(vmName: string) {
    const vmPath = path.join(this.vagrantDir, vmName);
    const vmStatus = await this.getVMStatus(vmName, vmPath);

    if (vmStatus.status !== 'running') {
      return;
    }

    await VMStatus.findOneAndUpdate(
      { vmName },
      {
        vmName,
        hostname: vmName,
        status: 'running',
        ip: vmStatus.ip,
        lastSeen: new Date(),
        crdtState: await this.getCrdtState(vmPath),
        dockerContainers: await this.getDockerContainers(vmPath)
      },
      { upsert: true, new: true }
    );
  }

  private async getSeededVMStatus() {
    return VMStatus.find().sort({ vmName: 1 }).lean();
  }

  private logSimulationModeWarning() {
    if (!this.warnedSimulationMode) {
      logger.warn('SIMULATION_MODE enabled — VM polling disabled, using seeded data');
      this.warnedSimulationMode = true;
    }
  }

  private warnVmPollingOnce(message: string) {
    if (!this.warnedVmPollingFailure) {
      logger.warn(message);
      this.warnedVmPollingFailure = true;
    }
  }
}
