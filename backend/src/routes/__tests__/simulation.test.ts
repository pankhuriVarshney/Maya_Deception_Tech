import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../middleware/errorHandler';

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../services/RealSimulationService');
jest.mock('../../services/K8sSimulationService');

import { RealSimulationService } from '../../services/RealSimulationService';
import { K8sSimulationService } from '../../services/K8sSimulationService';
import router from '../simulation';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/simulation', router);
  app.use(errorHandler);
  return app;
}

const MockedRealSimulationService = RealSimulationService as jest.MockedClass<typeof RealSimulationService>;
const MockedK8sSimulationService = K8sSimulationService as jest.MockedClass<typeof K8sSimulationService>;

const simulationServiceInstance = MockedRealSimulationService.mock.instances[0] as jest.Mocked<RealSimulationService>;
const k8sSimulationServiceInstance = MockedK8sSimulationService.mock.instances[0] as jest.Mocked<K8sSimulationService>;

describe('simulation routes', () => {
  const app = buildApp();

  beforeEach(() => {
    k8sSimulationServiceInstance.refreshTargets.mockResolvedValue({ count: 0, targets: [] });
    k8sSimulationServiceInstance.hasTarget.mockReturnValue(false);
    k8sSimulationServiceInstance.availableTargets.mockReturnValue([]);
    simulationServiceInstance.refreshVMs.mockResolvedValue({ count: 0, vms: [] } as any);
  });

  describe('POST /api/simulation/ssh-bruteforce', () => {
    it('rejects an invalid target name', async () => {
      const res = await request(app).post('/api/simulation/ssh-bruteforce').send({ target: '../etc/passwd' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('runs on a K8s decoy when the target resolves there', async () => {
      k8sSimulationServiceInstance.hasTarget.mockReturnValue(true);
      k8sSimulationServiceInstance.simulateSSHBruteForce.mockResolvedValue({ attackerId: 'atk-1' } as any);

      const res = await request(app).post('/api/simulation/ssh-bruteforce').send({ target: 'web-03', attempts: 7 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, real: true, platform: 'k8s', attackerId: 'atk-1' });
      expect(k8sSimulationServiceInstance.simulateSSHBruteForce).toHaveBeenCalledWith({ target: 'web-03', attempts: 7 });
      expect(simulationServiceInstance.refreshVMs).not.toHaveBeenCalled();
    });

    it('falls back to the Vagrant path when no K8s target matches', async () => {
      simulationServiceInstance.simulateSSHBruteForce.mockResolvedValue({ real: false, attackerId: 'atk-2' } as any);

      const res = await request(app)
        .post('/api/simulation/ssh-bruteforce')
        .send({ target: 'fake-jump-01', attempts: 500 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, real: false, platform: 'vagrant', attackerId: 'atk-2' });
      expect(simulationServiceInstance.refreshVMs).toHaveBeenCalled();
      expect(simulationServiceInstance.simulateSSHBruteForce).toHaveBeenCalledWith({
        target: 'fake-jump-01',
        attempts: 100,
      });
    });
  });

  describe('POST /api/simulation/lateral-movement', () => {
    it('rejects an invalid target inside the targets array', async () => {
      const res = await request(app)
        .post('/api/simulation/lateral-movement')
        .send({ source: 'fake-web-01', targets: ['ok-01', 'bad target!'] });

      expect(res.status).toBe(400);
    });

    it('defaults to fake-jump-01 when targets is empty', async () => {
      simulationServiceInstance.simulateLateralMovement.mockResolvedValue({ success: true, attackerId: 'atk-3' } as any);

      await request(app).post('/api/simulation/lateral-movement').send({ source: 'fake-web-01', targets: [] });

      expect(simulationServiceInstance.simulateLateralMovement).toHaveBeenCalledWith({
        source: 'fake-web-01',
        targets: ['fake-jump-01'],
      });
    });

    it('runs on K8s decoys when the source resolves there', async () => {
      k8sSimulationServiceInstance.hasTarget.mockReturnValue(true);
      k8sSimulationServiceInstance.simulateLateralMovement.mockResolvedValue({ attackerId: 'atk-4' } as any);

      const res = await request(app)
        .post('/api/simulation/lateral-movement')
        .send({ source: 'web-03', targets: ['jump-01'] });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ platform: 'k8s', real: true, attackerId: 'atk-4' });
    });
  });

  describe('POST /api/simulation/credential-theft', () => {
    it('falls back to mimikatz for an unrecognized tool', async () => {
      simulationServiceInstance.simulateCredentialTheft.mockResolvedValue({ success: true, attackerId: 'atk-5' } as any);

      await request(app).post('/api/simulation/credential-theft').send({ target: 'fake-web-01', tool: 'not-a-tool' });

      expect(simulationServiceInstance.simulateCredentialTheft).toHaveBeenCalledWith({
        target: 'fake-web-01',
        tool: 'mimikatz',
      });
    });

    it('accepts a valid tool and runs on K8s when available', async () => {
      k8sSimulationServiceInstance.hasTarget.mockReturnValue(true);
      k8sSimulationServiceInstance.simulateCredentialTheft.mockResolvedValue({ attackerId: 'atk-6' } as any);

      const res = await request(app)
        .post('/api/simulation/credential-theft')
        .send({ target: 'web-03', tool: 'lazagne' });

      expect(res.status).toBe(200);
      expect(k8sSimulationServiceInstance.simulateCredentialTheft).toHaveBeenCalledWith({
        target: 'web-03',
        tool: 'lazagne',
      });
      expect(res.body.platform).toBe('k8s');
    });
  });

  describe('POST /api/simulation/discovery', () => {
    it('falls back to internal for an unrecognized scan type', async () => {
      simulationServiceInstance.simulateDiscovery.mockResolvedValue({ real: false, attackerId: 'atk-7' } as any);

      await request(app).post('/api/simulation/discovery').send({ source: 'fake-jump-01', scanType: 'bogus' });

      expect(simulationServiceInstance.simulateDiscovery).toHaveBeenCalledWith({
        source: 'fake-jump-01',
        scanType: 'internal',
      });
    });

    it('rejects an invalid source name', async () => {
      const res = await request(app).post('/api/simulation/discovery').send({ source: 'bad source' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/simulation/privilege-escalation', () => {
    it('falls back to sudo-exploit for an unrecognized method', async () => {
      simulationServiceInstance.simulatePrivilegeEscalation.mockResolvedValue({ real: false, attackerId: 'atk-8' } as any);

      await request(app)
        .post('/api/simulation/privilege-escalation')
        .send({ target: 'fake-ftp-01', method: 'zero-day-magic' });

      expect(simulationServiceInstance.simulatePrivilegeEscalation).toHaveBeenCalledWith({
        target: 'fake-ftp-01',
        method: 'sudo-exploit',
      });
    });
  });

  describe('POST /api/simulation/full-campaign', () => {
    it('falls back to advanced for an unrecognized complexity', async () => {
      simulationServiceInstance.simulateFullCampaign.mockResolvedValue({ real: false, attackerId: 'atk-9' } as any);

      await request(app).post('/api/simulation/full-campaign').send({ complexity: 'nonsense' });

      expect(simulationServiceInstance.simulateFullCampaign).toHaveBeenCalledWith({ complexity: 'advanced' });
    });

    it('prefers K8s decoys when at least two targets are available', async () => {
      k8sSimulationServiceInstance.availableTargets.mockReturnValue(['web-03', 'jump-01']);
      k8sSimulationServiceInstance.simulateFullCampaign.mockResolvedValue({ attackerId: 'atk-10' } as any);

      const res = await request(app).post('/api/simulation/full-campaign').send({ complexity: 'apt' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ platform: 'k8s', real: true, attackerId: 'atk-10' });
      expect(k8sSimulationServiceInstance.simulateFullCampaign).toHaveBeenCalledWith({ complexity: 'apt' });
      expect(simulationServiceInstance.simulateFullCampaign).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/simulation/refresh-vms', () => {
    it('returns the refreshed VM cache', async () => {
      simulationServiceInstance.refreshVMs.mockResolvedValue({ count: 2, vms: ['fake-web-01', 'fake-jump-01'] } as any);

      const res = await request(app).post('/api/simulation/refresh-vms');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ count: 2, vms: ['fake-web-01', 'fake-jump-01'] });
    });
  });

  describe('GET /api/simulation/status', () => {
    it('returns available simulations and validation rules', async () => {
      (simulationServiceInstance as any).getVMCacheStatus.mockReturnValue({ vms: [] });

      const res = await request(app).get('/api/simulation/status');

      expect(res.status).toBe(200);
      expect(res.body.data.availableSimulations).toContain('ssh-bruteforce');
      expect(res.body.data.validationRules.validTools).toEqual(['mimikatz', 'lazagne', 'gsecdump', 'pwdump']);
    });
  });

  describe('GET /api/simulation/vm-cache', () => {
    it('returns the VM cache status', async () => {
      (simulationServiceInstance as any).getVMCacheStatus.mockReturnValue({ vms: ['fake-web-01'] });

      const res = await request(app).get('/api/simulation/vm-cache');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ vms: ['fake-web-01'] });
    });
  });

  describe('POST /api/simulation/vm-cache/populate', () => {
    it('rejects a non-array vms payload', async () => {
      const res = await request(app).post('/api/simulation/vm-cache/populate').send({ vms: 'nope' });
      expect(res.status).toBe(400);
    });

    it('populates the VM cache manually', async () => {
      (simulationServiceInstance as any).populateVMCacheManually = jest.fn().mockResolvedValue({ count: 1 });

      const res = await request(app)
        .post('/api/simulation/vm-cache/populate')
        .send({ vms: [{ name: 'fake-web-01', path: '/vagrant/fake-web-01', ip: '10.0.0.1' }] });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ count: 1 });
    });
  });

  describe('POST /api/simulation/vm-cache/refresh', () => {
    it('force refreshes the VM cache', async () => {
      simulationServiceInstance.refreshVMs.mockResolvedValue({ count: 3, vms: [] } as any);

      const res = await request(app).post('/api/simulation/vm-cache/refresh');

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('3 VMs found');
    });
  });

  describe('GET /api/simulation/k8s-targets', () => {
    it('returns the refreshed K8s target list', async () => {
      k8sSimulationServiceInstance.refreshTargets.mockResolvedValue({ count: 2, targets: ['web-03', 'jump-01'] });

      const res = await request(app).get('/api/simulation/k8s-targets');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ count: 2, targets: ['web-03', 'jump-01'] });
    });
  });
});
