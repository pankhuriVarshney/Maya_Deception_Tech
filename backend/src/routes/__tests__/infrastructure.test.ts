import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../middleware/errorHandler';
import { logger } from './helpers/mockLogger';
import { mockQuery } from './helpers/mockQuery';

jest.mock('../../utils/logger', () => ({ logger }));

jest.mock('../../services/RealSimulationService');
jest.mock('../../services/CRDTSyncService');
jest.mock('../../services/K8sDiscoveryService');

jest.mock('../../services/k8s/K8sClient', () => ({
  getTierClusters: jest.fn(),
  listDecoyPods: jest.fn(),
  scaleDeployment: jest.fn(),
}));

jest.mock('../../models', () => ({
  VMStatus: { find: jest.fn(), findOne: jest.fn() },
  Attacker: { find: jest.fn() },
  AttackEvent: { distinct: jest.fn() },
}));

const mockExecPromise = jest.fn();
jest.mock('child_process', () => {
  const util = require('util');
  const exec: any = jest.fn();
  exec[util.promisify.custom] = (...args: any[]) => mockExecPromise(...args);
  return { exec };
});

import { RealSimulationService } from '../../services/RealSimulationService';
import { CRDTSyncService } from '../../services/CRDTSyncService';
import { K8sDiscoveryService } from '../../services/K8sDiscoveryService';
import { getTierClusters, listDecoyPods, scaleDeployment } from '../../services/k8s/K8sClient';
import { VMStatus, Attacker, AttackEvent } from '../../models';
import router from '../infrastructure';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/infrastructure', router);
  app.use(errorHandler);
  return app;
}

const MockedRealSimulationService = RealSimulationService as jest.MockedClass<typeof RealSimulationService>;
const MockedCRDTSyncService = CRDTSyncService as jest.MockedClass<typeof CRDTSyncService>;
const MockedK8sDiscoveryService = K8sDiscoveryService as jest.MockedClass<typeof K8sDiscoveryService>;

const vagrantDiscoveryInstance = MockedRealSimulationService.mock.instances[0] as jest.Mocked<RealSimulationService>;
const crdtSyncInstance = MockedCRDTSyncService.mock.instances[0] as jest.Mocked<CRDTSyncService>;
const k8sDiscoveryInstance = MockedK8sDiscoveryService.mock.instances[0] as jest.Mocked<K8sDiscoveryService>;

describe('infrastructure routes', () => {
  const app = buildApp();

  beforeEach(() => {
    vagrantDiscoveryInstance.getVMCacheStatus.mockReturnValue({ vms: [] } as any);
  });

  describe('GET /api/infrastructure/nodes', () => {
    it('lists nodes with an attacker count each', async () => {
      (VMStatus.find as jest.Mock).mockReturnValue(
        mockQuery([
          { vmName: 'fake-web-01', hostname: 'web01', status: 'running', ip: '10.0.0.1', platform: 'vagrant' },
          { vmName: 'web-03', hostname: 'web-03', status: 'running', ip: '10.0.0.2', platform: 'k8s' },
        ])
      );
      (AttackEvent.distinct as jest.Mock)
        .mockResolvedValueOnce(['a1', 'a2'])
        .mockResolvedValueOnce([]);

      const res = await request(app).get('/api/infrastructure/nodes');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
      expect(res.body.data[0]).toMatchObject({ name: 'fake-web-01', attackerCount: 2, platform: 'vagrant' });
      expect(res.body.data[1]).toMatchObject({ name: 'web-03', attackerCount: 0, platform: 'k8s' });
    });
  });

  describe('GET /api/infrastructure/nodes/:name', () => {
    it('rejects an invalid node name', async () => {
      const res = await request(app).get('/api/infrastructure/nodes/bad!name');

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, error: 'Invalid node name' });
    });

    it('returns 404 when the node is not found', async () => {
      (VMStatus.findOne as jest.Mock).mockReturnValue(mockQuery(null));

      const res = await request(app).get('/api/infrastructure/nodes/unknown-01');

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: "Node 'unknown-01' not found" });
    });

    it('returns k8s pod config/resources for a k8s node', async () => {
      (VMStatus.findOne as jest.Mock).mockReturnValue(
        mockQuery({ vmName: 'web-03', platform: 'k8s', status: 'running' })
      );
      (AttackEvent.distinct as jest.Mock).mockResolvedValue(['a1']);
      (Attacker.find as jest.Mock).mockReturnValue(
        mockQuery([{ attackerId: 'a1', ipAddress: '10.0.0.9', riskLevel: 'High' }])
      );
      (getTierClusters as jest.Mock).mockReturnValue([{ context: 'ctx-a' }]);
      (listDecoyPods as jest.Mock).mockResolvedValue([
        { appName: 'web-03', decoyType: 'web', image: 'nginx', context: 'ctx-a', resources: { cpu: '100m' } },
      ]);

      const res = await request(app).get('/api/infrastructure/nodes/web-03');

      expect(res.status).toBe(200);
      expect(res.body.data.config).toMatchObject({ platform: 'k8s', decoyType: 'web', image: 'nginx' });
      expect(res.body.data.resources).toMatchObject({ source: 'declared', cpu: '100m' });
      expect(res.body.data.attackers).toHaveLength(1);
    });

    it('returns vagrant path config for a vagrant node', async () => {
      (VMStatus.findOne as jest.Mock).mockReturnValue(
        mockQuery({ vmName: 'fake-web-01', platform: 'vagrant', status: 'running' })
      );
      (AttackEvent.distinct as jest.Mock).mockResolvedValue([]);
      (Attacker.find as jest.Mock).mockReturnValue(mockQuery([]));
      vagrantDiscoveryInstance.getVMCacheStatus.mockReturnValue({
        vms: [{ name: 'fake-web-01', path: '/vagrant/fake-web-01' }],
      } as any);

      const res = await request(app).get('/api/infrastructure/nodes/fake-web-01');

      expect(res.status).toBe(200);
      expect(res.body.data.config).toMatchObject({ platform: 'vagrant', vagrantPath: '/vagrant/fake-web-01' });
      expect(res.body.data.resources).toBeNull();
    });
  });

  describe('POST /api/infrastructure/nodes/:name/stop', () => {
    it('rejects an invalid node name', async () => {
      const res = await request(app).post('/api/infrastructure/nodes/bad!name/stop');
      expect(res.status).toBe(400);
    });

    it('returns 404 when the node is not found', async () => {
      (VMStatus.findOne as jest.Mock).mockReturnValue(mockQuery(null));

      const res = await request(app).post('/api/infrastructure/nodes/unknown-01/stop');

      expect(res.status).toBe(404);
    });

    it('scales a k8s deployment to 0 replicas', async () => {
      (VMStatus.findOne as jest.Mock).mockReturnValue(mockQuery({ vmName: 'web-03', platform: 'k8s' }));
      (getTierClusters as jest.Mock).mockReturnValue([{ context: 'ctx-a' }]);
      (listDecoyPods as jest.Mock).mockResolvedValue([{ appName: 'web-03', context: 'ctx-a' }]);
      (scaleDeployment as jest.Mock).mockResolvedValue(undefined);

      const res = await request(app).post('/api/infrastructure/nodes/web-03/stop');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, platform: 'k8s' });
      expect(scaleDeployment).toHaveBeenCalledWith({ context: 'ctx-a' }, 'web-03', 0);
    });

    it('returns 404 when the k8s pod is not currently discovered', async () => {
      (VMStatus.findOne as jest.Mock).mockReturnValue(mockQuery({ vmName: 'web-03', platform: 'k8s' }));
      (getTierClusters as jest.Mock).mockReturnValue([{ context: 'ctx-a' }]);
      (listDecoyPods as jest.Mock).mockResolvedValue([]);

      const res = await request(app).post('/api/infrastructure/nodes/web-03/stop');

      expect(res.status).toBe(404);
    });

    it('returns 404 when the vagrant VM is not currently running', async () => {
      (VMStatus.findOne as jest.Mock).mockReturnValue(mockQuery({ vmName: 'fake-web-01', platform: 'vagrant' }));
      vagrantDiscoveryInstance.getVMCacheStatus.mockReturnValue({ vms: [] } as any);

      const res = await request(app).post('/api/infrastructure/nodes/fake-web-01/stop');

      expect(res.status).toBe(404);
    });

    it('halts a vagrant VM via vagrant halt', async () => {
      (VMStatus.findOne as jest.Mock).mockReturnValue(mockQuery({ vmName: 'fake-web-01', platform: 'vagrant' }));
      vagrantDiscoveryInstance.getVMCacheStatus.mockReturnValue({
        vms: [{ name: 'fake-web-01', path: '/vagrant/fake-web-01' }],
      } as any);
      mockExecPromise.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const res = await request(app).post('/api/infrastructure/nodes/fake-web-01/stop');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, platform: 'vagrant' });
      expect(mockExecPromise).toHaveBeenCalledWith(
        expect.stringContaining('vagrant halt'),
        expect.objectContaining({ timeout: 35000 })
      );
    });

    it('returns 500 when vagrant halt fails', async () => {
      (VMStatus.findOne as jest.Mock).mockReturnValue(mockQuery({ vmName: 'fake-web-01', platform: 'vagrant' }));
      vagrantDiscoveryInstance.getVMCacheStatus.mockReturnValue({
        vms: [{ name: 'fake-web-01', path: '/vagrant/fake-web-01' }],
      } as any);
      mockExecPromise.mockRejectedValueOnce(new Error('vagrant halt failed'));

      const res = await request(app).post('/api/infrastructure/nodes/fake-web-01/stop');

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ success: false, error: 'vagrant halt failed' });
    });
  });

  describe('POST /api/infrastructure/nodes/:name/resync', () => {
    it('returns 404 when the node is not found', async () => {
      (VMStatus.findOne as jest.Mock).mockReturnValue(mockQuery(null));

      const res = await request(app).post('/api/infrastructure/nodes/unknown-01/resync');

      expect(res.status).toBe(404);
    });

    it('polls k8s discovery for a k8s node', async () => {
      (VMStatus.findOne as jest.Mock)
        .mockReturnValueOnce(mockQuery({ vmName: 'web-03', platform: 'k8s' }))
        .mockReturnValueOnce(mockQuery({ vmName: 'web-03', platform: 'k8s', status: 'running' }));
      k8sDiscoveryInstance.pollOnce.mockResolvedValue(undefined as any);

      const res = await request(app).post('/api/infrastructure/nodes/web-03/resync');

      expect(res.status).toBe(200);
      expect(k8sDiscoveryInstance.pollOnce).toHaveBeenCalled();
      expect(res.body.data).toMatchObject({ vmName: 'web-03' });
    });

    it('runs the CRDT sync for a vagrant node', async () => {
      (VMStatus.findOne as jest.Mock)
        .mockReturnValueOnce(mockQuery({ vmName: 'fake-web-01', platform: 'vagrant' }))
        .mockReturnValueOnce(mockQuery({ vmName: 'fake-web-01', platform: 'vagrant', status: 'running' }));
      crdtSyncInstance.updateVMStatusInDB.mockResolvedValue(undefined as any);

      const res = await request(app).post('/api/infrastructure/nodes/fake-web-01/resync');

      expect(res.status).toBe(200);
      expect(crdtSyncInstance.updateVMStatusInDB).toHaveBeenCalled();
    });
  });
});
