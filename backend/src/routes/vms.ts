import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { VMStatus } from '../models';
import { InfrastructureDiscoveryService } from '../services/InfrastructureDiscoveryService';
import { logger } from '../utils/logger';
import { WebSocketHandler } from '../websocket/WebSocketHandler';

const router = Router();
const infrastructureDiscovery = new InfrastructureDiscoveryService();
const isSimulationMode = process.env.SIMULATION_MODE === 'true';

let wsHandler: WebSocketHandler | null = null;

export function setVmRoutesWebSocket(handler: WebSocketHandler): void {
  wsHandler = handler;
}

interface HeartbeatBody {
  vmName: string;
  vmIp: string;
  status: string;
  timestamp: string;
  crdtStats?: { syncs?: number; merges?: number };
  dockerContainers?: Array<{ name?: string; status?: string }>;
}

function normalizeVmName(podName: string): string {
  const parts = podName.split('-');
  // K8s pod names: <base>-<replicaset-hash>-<pod-hash>
  // e.g. fake-jump-01-6b4bdf6d87-hnslz → fake-jump-01
  if (parts.length > 2) {
    return parts.slice(0, -2).join('-');
  }
  return podName;
}

function mapDockerContainers(
  containers: HeartbeatBody['dockerContainers']
): Array<{
  id: string;
  name: string;
  image: string;
  status: 'running' | 'exited' | 'paused';
  ports: string[];
  created: string;
}> {
  if (!Array.isArray(containers)) {
    return [];
  }
  return containers.map((c) => ({
    id: '',
    name: c.name || 'unknown',
    image: '',
    status: (c.status === 'running' ? 'running' : 'exited') as 'running' | 'exited' | 'paused',
    ports: [],
    created: new Date().toISOString()
  }));
}

function mapCrdtStats(crdtStats?: HeartbeatBody['crdtStats']) {
  return {
    attackers: crdtStats?.syncs ?? 0,
    credentials: crdtStats?.merges ?? 0,
    sessions: 0,
    hash: JSON.stringify(crdtStats ?? {})
  };
}

router.post(
  '/heartbeat',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const body = req.body as HeartbeatBody;
      const { vmName, vmIp, status, timestamp, crdtStats, dockerContainers } = body;

      if (!vmName || !vmIp || !status || !timestamp) {
        return res.status(400).json({
          success: false,
          error: 'vmName, vmIp, status, and timestamp are required'
        });
      }

      const normalizedName = normalizeVmName(vmName);

      const vmStatus = (['running', 'stopped', 'unknown', 'error'].includes(status)
        ? status
        : 'unknown') as 'running' | 'stopped' | 'unknown' | 'error';

      await VMStatus.findOneAndUpdate(
        { vmName: normalizedName },
        {
          $set: {
            vmName: normalizedName,
            hostname: normalizedName,
            ip: vmIp,
            status: vmStatus,
            lastSeen: new Date(timestamp),
            crdtState: mapCrdtStats(crdtStats),
            dockerContainers: mapDockerContainers(dockerContainers),
            updatedAt: new Date()
          }
        },
        { upsert: true, new: true }
      );

      wsHandler?.broadcastMessage({
        type: 'VM_HEARTBEAT',
        data: { vmName: normalizedName, vmIp, status, timestamp }
      });

      res.json({ success: true, vmName: normalizedName });
    } catch (error) {
      logger.error('VM heartbeat failed:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Heartbeat failed'
      });
    }
  })
);

router.get(
  '/k8s-status',
  asyncHandler(async (_req: Request, res: Response) => {
    const cutoff = new Date(Date.now() - 30 * 1000);
    const vms = await VMStatus.find({ updatedAt: { $gt: cutoff } })
      .sort({ vmName: 1 })
      .lean();

    res.json({ success: true, data: vms, count: vms.length });
  })
);

router.get('/', async (_req, res) => {
  try {
    if (!isSimulationMode) {
      try {
        const discovered = await infrastructureDiscovery.discoverVMs();
        return res.json({
          vms: discovered,
          updatedAt: new Date().toISOString(),
          cached: false
        });
      } catch (error) {
        logger.warn('VM discovery failed, falling back to cached VM status:', error);
      }
    }

    const vms = await VMStatus.find().sort({ vmName: 1 }).lean();
    const formattedVMs = vms.map((vm) => ({
      name: vm.vmName,
      status: vm.status,
      ip: vm.ip,
      lastSeen: vm.lastSeen,
      crdtState: vm.crdtState,
      dockerContainers: vm.dockerContainers || []
    }));

    res.json({
      vms: formattedVMs,
      updatedAt: new Date().toISOString(),
      cached: true
    });
  } catch (error) {
    logger.error('Failed to fetch VM status:', error);
    res.status(500).json({
      vms: [],
      updatedAt: new Date().toISOString(),
      cached: true,
      error: 'VM status error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
