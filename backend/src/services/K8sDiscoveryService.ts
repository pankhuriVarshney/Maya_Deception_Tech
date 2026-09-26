import { EventEmitter } from 'events';
import { VMStatus } from '../models';
import { logger } from '../utils/logger';
import {
  getTierClusters,
  listDecoyPods,
  execInPod,
  K8sPodInfo,
  DecoyTier,
} from './k8s/K8sClient';
import { syncAttackerCommandsFromState } from './crdtCommandSync';

const STATE_FILE_PATH = '/var/lib/.state/.syscache';

export interface K8sCrdtState {
  attackers: number;
  credentials: number;
  sessions: number;
  hash: string;
}

/**
 * K8s-side counterpart to CRDTSyncService: discovers decoy pods across every
 * configured tier/cluster (see K8sClient.getTierClusters) and keeps VMStatus
 * up to date for them, the same collection Vagrant VMs already populate.
 * Additive only -- if no kubeconfig/cluster is reachable, this is a no-op
 * and the rest of the backend (including the Vagrant path) is unaffected.
 */
export class K8sDiscoveryService extends EventEmitter {
  private pollInterval?: NodeJS.Timeout;
  private isPolling = false;
  private warnedNoClusters = false;

  startPolling(intervalMs = 15000) {
    this.pollOnce().catch(err => logger.error('K8s discovery initial poll error:', err));
    this.pollInterval = setInterval(() => {
      if (!this.isPolling) {
        this.pollOnce().catch(err => logger.error('K8s discovery poll error:', err));
      }
    }, intervalMs);
    logger.info(`Started K8s decoy discovery loop with ${intervalMs}ms interval`);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
  }

  async pollOnce() {
    this.isPolling = true;
    try {
      const clusters = getTierClusters();
      if (clusters.length === 0) {
        if (!this.warnedNoClusters) {
          logger.info('K8s: no cluster contexts configured, skipping K8s decoy discovery (this is fine if you only run the Vagrant fabric)');
          this.warnedNoClusters = true;
        }
        return;
      }

      const seenVmNames: string[] = [];

      for (const cluster of clusters) {
        const pods = await listDecoyPods(cluster);

        for (const pod of pods) {
          // appName (the stable Deployment/Service name, e.g. "web-03") is
          // the identifier -- podName changes every time the pod restarts,
          // which would otherwise upsert a new VMStatus doc each time.
          seenVmNames.push(pod.appName);
          await this.syncPodStatus(pod);
        }
      }

      // Clean up VMStatus entries for K8s pods that no longer exist (pod
      // was rescheduled, deployment scaled to zero, etc.) -- never touch
      // platform: 'vagrant' entries here.
      await VMStatus.deleteMany({ platform: 'k8s', vmName: { $nin: seenVmNames } });

      this.emit('pollComplete', { podCount: seenVmNames.length });
    } finally {
      this.isPolling = false;
    }
  }

  private async syncPodStatus(pod: K8sPodInfo) {
    const status = pod.phase === 'Running' && pod.ready ? 'running' : 'stopped';
    const crdtState = status === 'running' ? await this.getCrdtState(pod) : this.emptyState();

    await VMStatus.findOneAndUpdate(
      { vmName: pod.appName },
      {
        vmName: pod.appName,
        hostname: pod.appName,
        status,
        ip: pod.podIp,
        platform: 'k8s',
        tier: this.resolveTier(pod),
        lastSeen: new Date(),
        crdtState,
      },
      { upsert: true, new: true }
    );
  }

  private resolveTier(pod: K8sPodInfo): DecoyTier {
    // runtimeClassName is authoritative when present; the configured tier
    // (from K8S_TIER_CONTEXTS) is the fallback for pods that don't set one.
    if (pod.runtimeClassName === 'kata-containers') return 'kata';
    if (pod.runtimeClassName === 'gvisor') return 'gvisor';
    return pod.tier;
  }

  private emptyState(): K8sCrdtState {
    return { attackers: 0, credentials: 0, sessions: 0, hash: '' };
  }

  private async getCrdtState(pod: K8sPodInfo): Promise<K8sCrdtState> {
    try {
      const clusters = getTierClusters();
      const cluster = clusters.find(c => c.context === pod.context);
      if (!cluster) return this.emptyState();

      const { stdout, code } = await execInPod(
        cluster,
        pod.podName,
        pod.containerName,
        ['sh', '-c', `cat ${STATE_FILE_PATH} 2>/dev/null || echo '{}'`],
        8000
      );

      if (code !== 0) return this.emptyState();

      const cleaned = stdout.trim();
      if (!cleaned || cleaned === '{}') return this.emptyState();

      const state = JSON.parse(cleaned);

      // Real per-command history (if any) -- feeds the same Attacker/
      // AttackEvent collections the simulation engines already populate,
      // so the dashboard shows genuine attacker commands, not just
      // aggregate counts. Isolated in its own try so a sync failure never
      // affects the count summary returned below.
      try {
        await syncAttackerCommandsFromState(state, pod.appName, 'k8s', this.resolveTier(pod));
      } catch (syncError) {
        logger.error(`Command sync failed for pod ${pod.podName}:`, syncError);
      }

      return {
        attackers: Object.keys(state.attackers || {}).length,
        credentials: Object.keys(state.stolen_creds?.adds || {}).length,
        sessions: (state.active_sessions?.elements || []).length,
        hash: '',
      };
    } catch (error) {
      logger.debug(`K8s CRDT state lookup failed for pod ${pod.podName}: ${error instanceof Error ? error.message : String(error)}`);
      return this.emptyState();
    }
  }
}
