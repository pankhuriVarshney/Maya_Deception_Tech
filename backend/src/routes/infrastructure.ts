// routes/infrastructure.ts
//
// Unified view over every decoy node -- Vagrant VMs and K8s pods alike,
// since K8sDiscoveryService and CRDTSyncService both already write into the
// same VMStatus collection (distinguished by the `platform` field). This
// is what backs the frontend's "Infrastructure" list + detail pages.

import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { VMStatus, Attacker, AttackEvent } from '../models';
import { RealSimulationService } from '../services/RealSimulationService';
import { CRDTSyncService } from '../services/CRDTSyncService';
import { K8sDiscoveryService } from '../services/K8sDiscoveryService';
import { getTierClusters, listDecoyPods, scaleDeployment, K8sPodInfo } from '../services/k8s/K8sClient';

const execAsync = promisify(exec);
const router = Router();

// Reuses the same discovery machinery the simulation/CRDT routes already
// rely on, rather than standing up yet another independent VM scanner.
const vagrantDiscovery = new RealSimulationService();
const crdtSync = new CRDTSyncService();
const k8sDiscovery = new K8sDiscoveryService();

const NODE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;

function isValidNodeName(name: string): boolean {
  return NODE_NAME_PATTERN.test(name);
}

// GET /api/infrastructure/nodes -- list every VM/pod with an attacker count
router.get('/nodes', asyncHandler(async (_req: Request, res: Response) => {
  const nodes = await VMStatus.find().sort({ platform: 1, vmName: 1 }).lean();

  const nodesWithCounts = await Promise.all(nodes.map(async (node) => {
    const attackerIds = await AttackEvent.distinct('attackerId', {
      $or: [{ sourceHost: node.vmName }, { targetHost: node.vmName }],
    });

    return {
      name: node.vmName,
      hostname: node.hostname,
      status: node.status,
      ip: node.ip,
      platform: node.platform || 'vagrant',
      tier: node.tier,
      lastSeen: node.lastSeen,
      crdtState: node.crdtState,
      dockerContainers: node.dockerContainers || [],
      attackerCount: attackerIds.length,
    };
  }));

  res.json({
    success: true,
    data: nodesWithCounts,
    count: nodesWithCounts.length,
    timestamp: new Date().toISOString(),
  });
}));

// GET /api/infrastructure/nodes/:name -- full detail: config, resources, attackers
router.get('/nodes/:name', asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;
  if (!isValidNodeName(name)) {
    return res.status(400).json({ success: false, error: 'Invalid node name' });
  }

  const node = await VMStatus.findOne({ vmName: name }).lean();
  if (!node) {
    return res.status(404).json({ success: false, error: `Node '${name}' not found` });
  }

  const attackerIds = await AttackEvent.distinct('attackerId', {
    $or: [{ sourceHost: name }, { targetHost: name }],
  });
  const attackers = await Attacker.find({ attackerId: { $in: attackerIds } })
    .sort({ lastSeen: -1 })
    .lean();

  let config: Record<string, unknown> = {
    hostname: node.hostname,
    ip: node.ip,
    platform: node.platform || 'vagrant',
    tier: node.tier,
  };
  let resources: Record<string, unknown> | null = null;

  if (node.platform === 'k8s') {
    const pod = await findK8sPod(name);
    if (pod) {
      config = {
        ...config,
        decoyType: pod.decoyType,
        image: pod.image,
        containerName: pod.containerName,
        ports: pod.ports,
        runtimeClassName: pod.runtimeClassName,
        context: pod.context,
        currentPodName: pod.podName,
      };
      resources = {
        source: 'declared', // requests/limits from the pod spec, not live usage (no metrics-server dependency)
        ...pod.resources,
      };
    }
  } else {
    const vmInfo = vagrantDiscovery.getVMCacheStatus().vms.find(v => v.name === name);
    config = {
      ...config,
      vagrantPath: vmInfo?.path,
    };
    resources = null; // no live resource collection wired up for Vagrant VMs yet
  }

  res.json({
    success: true,
    data: {
      name: node.vmName,
      status: node.status,
      lastSeen: node.lastSeen,
      crdtState: node.crdtState,
      dockerContainers: node.dockerContainers || [],
      config,
      resources,
      attackers: attackers.map(a => ({
        attackerId: a.attackerId,
        ipAddress: a.ipAddress,
        riskLevel: a.riskLevel,
        status: a.status,
        currentPrivilege: a.currentPrivilege,
        firstSeen: a.firstSeen,
        lastSeen: a.lastSeen,
        dwellTime: a.dwellTime,
      })),
    },
    timestamp: new Date().toISOString(),
  });
}));

// POST /api/infrastructure/nodes/:name/stop
router.post('/nodes/:name/stop', asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;
  if (!isValidNodeName(name)) {
    return res.status(400).json({ success: false, error: 'Invalid node name' });
  }

  const node = await VMStatus.findOne({ vmName: name }).lean();
  if (!node) {
    return res.status(404).json({ success: false, error: `Node '${name}' not found` });
  }

  if (node.platform === 'k8s') {
    const pod = await findK8sPod(name);
    if (!pod) {
      return res.status(404).json({ success: false, error: `K8s pod for '${name}' not currently discovered` });
    }
    const cluster = getTierClusters().find(c => c.context === pod.context);
    if (!cluster) {
      return res.status(500).json({ success: false, error: `No cluster client for context '${pod.context}'` });
    }
    await scaleDeployment(cluster, name, 0);
    logger.info(`Scaled K8s decoy '${name}' to 0 replicas (stop) on context ${pod.context}`);
    return res.json({ success: true, message: `Scaled ${name} to 0 replicas`, platform: 'k8s' });
  }

  const vmInfo = vagrantDiscovery.getVMCacheStatus().vms.find(v => v.name === name);
  if (!vmInfo?.path) {
    return res.status(404).json({ success: false, error: `Vagrant VM '${name}' not currently discovered/running` });
  }

  try {
    await execAsync(`cd "${vmInfo.path}" && timeout 30 vagrant halt`, { timeout: 35000 });
    logger.info(`Halted Vagrant VM '${name}'`);
    res.json({ success: true, message: `${name} halted`, platform: 'vagrant' });
  } catch (error) {
    logger.error(`Failed to halt VM ${name}:`, error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'vagrant halt failed' });
  }
}));

// POST /api/infrastructure/nodes/:name/resync -- force an immediate status/CRDT refresh
router.post('/nodes/:name/resync', asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;
  if (!isValidNodeName(name)) {
    return res.status(400).json({ success: false, error: 'Invalid node name' });
  }

  const node = await VMStatus.findOne({ vmName: name }).lean();
  if (!node) {
    return res.status(404).json({ success: false, error: `Node '${name}' not found` });
  }

  // Both resync paths refresh every node of that platform rather than just
  // this one -- CRDTSyncService/K8sDiscoveryService don't expose a
  // single-node entry point, and re-running the full (cheap, already
  // interval-driven) cycle on demand is simpler and safer than adding one.
  if (node.platform === 'k8s') {
    await k8sDiscovery.pollOnce();
  } else {
    await crdtSync.updateVMStatusInDB();
  }

  const refreshed = await VMStatus.findOne({ vmName: name }).lean();
  res.json({
    success: true,
    message: `${name} resynced`,
    data: refreshed,
    timestamp: new Date().toISOString(),
  });
}));

async function findK8sPod(appName: string): Promise<K8sPodInfo | undefined> {
  for (const cluster of getTierClusters()) {
    const pods = await listDecoyPods(cluster);
    const match = pods.find(p => p.appName === appName);
    if (match) return match;
  }
  return undefined;
}

export default router;
