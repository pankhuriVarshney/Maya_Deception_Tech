import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../middleware/errorHandler';
import { logger } from './helpers/mockLogger';
import { mockQuery } from './helpers/mockQuery';

jest.mock('../../utils/logger', () => ({ logger }));

jest.mock('../../services/DashboardService');

jest.mock('../../models', () => {
  const makeModel = () => {
    const ctor: any = jest.fn().mockImplementation((doc: any) => ({
      ...doc,
      save: jest.fn().mockResolvedValue(undefined),
    }));
    ctor.find = jest.fn();
    return ctor;
  };
  return {
    Attacker: makeModel(),
    AttackEvent: makeModel(),
  };
});

import { DashboardService } from '../../services/DashboardService';
import { Attacker, AttackEvent } from '../../models';
import router from '../dashboard';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/dashboard', router);
  app.use(errorHandler);
  return app;
}

const MockedDashboardService = DashboardService as jest.MockedClass<typeof DashboardService>;
const dashboardServiceInstance = MockedDashboardService.mock.instances[0] as jest.Mocked<DashboardService>;

describe('dashboard routes', () => {
  const app = buildApp();

  describe('GET /api/dashboard', () => {
    it('aggregates every widget into a single payload', async () => {
      dashboardServiceInstance.getDashboardStats.mockResolvedValue({ totalAttackers: 3 } as any);
      dashboardServiceInstance.getActiveAttackers.mockResolvedValue([{ id: 'a1' }] as any);
      dashboardServiceInstance.getAttackTimeline.mockResolvedValue([] as any);
      dashboardServiceInstance.getMitreMatrix.mockResolvedValue({} as any);
      dashboardServiceInstance.getLateralMovementGraph.mockResolvedValue({ nodes: [], edges: [] } as any);
      dashboardServiceInstance.getCommandActivity.mockResolvedValue([] as any);
      dashboardServiceInstance.getAttackerBehaviorAnalysis.mockResolvedValue({} as any);
      dashboardServiceInstance.getIncidentSummary.mockResolvedValue({} as any);

      const res = await request(app).get('/api/dashboard');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.stats).toEqual({ totalAttackers: 3 });
      expect(res.body.data.activeAttackers).toEqual([{ id: 'a1' }]);
      expect(dashboardServiceInstance.getAttackTimeline).toHaveBeenCalledWith(undefined, 24);
      expect(dashboardServiceInstance.getCommandActivity).toHaveBeenCalledWith(undefined, 10);
    });

    it('propagates a service failure to the error handler', async () => {
      dashboardServiceInstance.getDashboardStats.mockRejectedValue(new Error('db down'));
      dashboardServiceInstance.getActiveAttackers.mockResolvedValue([] as any);
      dashboardServiceInstance.getAttackTimeline.mockResolvedValue([] as any);
      dashboardServiceInstance.getMitreMatrix.mockResolvedValue({} as any);
      dashboardServiceInstance.getLateralMovementGraph.mockResolvedValue({} as any);
      dashboardServiceInstance.getCommandActivity.mockResolvedValue([] as any);
      dashboardServiceInstance.getAttackerBehaviorAnalysis.mockResolvedValue({} as any);
      dashboardServiceInstance.getIncidentSummary.mockResolvedValue({} as any);

      const res = await request(app).get('/api/dashboard');

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ success: false, error: 'db down' });
    });
  });

  describe('GET /api/dashboard/attackers and /active-attackers', () => {
    it.each(['/api/dashboard/attackers', '/api/dashboard/active-attackers'])(
      'returns the mapped active attacker list from %s',
      async (path) => {
        dashboardServiceInstance.getMappedActiveAttackers.mockResolvedValue([
          { id: 'a1' },
          { id: 'a2' },
        ] as any);

        const res = await request(app).get(path);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, count: 2 });
        expect(res.body.data).toHaveLength(2);
      }
    );
  });

  describe('GET /api/dashboard/attacker/:id', () => {
    it('returns 404 when the attacker does not exist', async () => {
      dashboardServiceInstance.getAttackerDashboard.mockResolvedValue(null as any);

      const res = await request(app).get('/api/dashboard/attacker/unknown-id');

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: 'Attacker unknown-id not found' });
    });

    it('returns the attacker dashboard when found', async () => {
      dashboardServiceInstance.getAttackerDashboard.mockResolvedValue({ attackerId: 'a1' } as any);

      const res = await request(app).get('/api/dashboard/attacker/a1');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, data: { attackerId: 'a1' } });
      expect(dashboardServiceInstance.getAttackerDashboard).toHaveBeenCalledWith('a1');
    });
  });

  describe('GET /api/dashboard/timeline', () => {
    it('parses hours/limit query params and forwards them', async () => {
      dashboardServiceInstance.getAttackTimeline.mockResolvedValue([{ id: 1 }, { id: 2 }] as any);

      const res = await request(app)
        .get('/api/dashboard/timeline')
        .query({ attackerId: 'a1', hours: '48', limit: '5' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, count: 2 });
      expect(dashboardServiceInstance.getAttackTimeline).toHaveBeenCalledWith('a1', 48, 5);
    });

    it('defaults hours/limit when omitted', async () => {
      dashboardServiceInstance.getAttackTimeline.mockResolvedValue([] as any);

      await request(app).get('/api/dashboard/timeline');

      expect(dashboardServiceInstance.getAttackTimeline).toHaveBeenCalledWith(undefined, 24, 100);
    });
  });

  describe('GET /api/dashboard/mitre-matrix', () => {
    it('forwards the attackerId filter', async () => {
      dashboardServiceInstance.getMitreMatrix.mockResolvedValue({ techniques: [] } as any);

      const res = await request(app).get('/api/dashboard/mitre-matrix').query({ attackerId: 'a1' });

      expect(res.status).toBe(200);
      expect(dashboardServiceInstance.getMitreMatrix).toHaveBeenCalledWith('a1');
      expect(res.body.data).toEqual({ techniques: [] });
    });
  });

  describe('GET /api/dashboard/lateral-movement', () => {
    it('returns the lateral movement graph', async () => {
      dashboardServiceInstance.getLateralMovementGraph.mockResolvedValue({ nodes: [1] } as any);

      const res = await request(app).get('/api/dashboard/lateral-movement');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ nodes: [1] });
    });
  });

  describe('GET /api/dashboard/commands', () => {
    it('defaults limit to 10', async () => {
      dashboardServiceInstance.getCommandActivity.mockResolvedValue([] as any);

      await request(app).get('/api/dashboard/commands');

      expect(dashboardServiceInstance.getCommandActivity).toHaveBeenCalledWith(undefined, 10);
    });

    it('parses a custom limit', async () => {
      dashboardServiceInstance.getCommandActivity.mockResolvedValue([{ id: 1 }] as any);

      await request(app).get('/api/dashboard/commands').query({ limit: '3', attackerId: 'a9' });

      expect(dashboardServiceInstance.getCommandActivity).toHaveBeenCalledWith('a9', 3);
    });
  });

  describe('GET /api/dashboard/metrics', () => {
    it('returns deception metrics', async () => {
      dashboardServiceInstance.getDeceptionMetrics.mockResolvedValue({ score: 42 } as any);

      const res = await request(app).get('/api/dashboard/metrics');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ score: 42 });
    });
  });

  describe('GET /api/dashboard/security-posture', () => {
    it('returns the security posture score', async () => {
      dashboardServiceInstance.getSecurityPostureScore.mockResolvedValue({ threatLevel: 'LOW' } as any);

      const res = await request(app).get('/api/dashboard/security-posture');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ threatLevel: 'LOW' });
    });
  });

  describe('GET /api/dashboard/behavior', () => {
    it('forwards the attackerId filter', async () => {
      dashboardServiceInstance.getAttackerBehaviorAnalysis.mockResolvedValue({ sophistication: 'High' } as any);

      const res = await request(app).get('/api/dashboard/behavior').query({ attackerId: 'a1' });

      expect(dashboardServiceInstance.getAttackerBehaviorAnalysis).toHaveBeenCalledWith('a1');
      expect(res.body.data).toEqual({ sophistication: 'High' });
    });
  });

  describe('GET /api/dashboard/incidents', () => {
    it('returns the incident summary', async () => {
      dashboardServiceInstance.getIncidentSummary.mockResolvedValue({ lateralMovement: {} } as any);

      const res = await request(app).get('/api/dashboard/incidents');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ lateralMovement: {} });
    });
  });

  describe('GET /api/dashboard/debug/attackers', () => {
    it('returns raw attacker and event data from the models', async () => {
      (Attacker.find as jest.Mock).mockReturnValueOnce(
        mockQuery([{ attackerId: 'a1', ipAddress: '10.0.0.1', status: 'Active' }])
      );
      (Attacker.find as jest.Mock).mockReturnValueOnce(
        mockQuery([{ attackerId: 'a1', ipAddress: '10.0.0.1', status: 'Active' }])
      );
      (AttackEvent.find as jest.Mock).mockReturnValueOnce(
        mockQuery([{ eventId: 'e1', attackerId: 'a1', type: 'Discovery' }])
      );

      const res = await request(app).get('/api/dashboard/debug/attackers');

      expect(res.status).toBe(200);
      expect(res.body.data.allAttackers).toHaveLength(1);
      expect(res.body.data.activeAttackers).toHaveLength(1);
      expect(res.body.data.recentEvents).toEqual([
        { eventId: 'e1', attackerId: 'a1', type: 'Discovery', description: undefined, timestamp: undefined },
      ]);
    });
  });

  describe('POST /api/dashboard/attacker', () => {
    it('rejects a payload missing required fields', async () => {
      const res = await request(app).post('/api/dashboard/attacker').send({ attackerId: 'a1' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        success: false,
        error: 'attackerId and ipAddress are required',
      });
    });

    it('creates an attacker + seed event and returns the dashboard', async () => {
      dashboardServiceInstance.getAttackerDashboard.mockResolvedValue({ attackerId: 'a1' } as any);

      const res = await request(app)
        .post('/api/dashboard/attacker')
        .send({ attackerId: 'a1', ipAddress: '10.0.0.5' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, data: { attackerId: 'a1' } });
      expect(Attacker).toHaveBeenCalledWith(
        expect.objectContaining({ attackerId: 'a1', ipAddress: '10.0.0.5', entryPoint: 'Manual Test' })
      );
      expect(AttackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ attackerId: 'a1', type: 'Initial Access' })
      );
    });
  });
});
