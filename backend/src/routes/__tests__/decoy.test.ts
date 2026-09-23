import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../middleware/errorHandler';

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../services/DecoyGenerationService');

jest.mock('../../models/CompanyBlueprint', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  },
}));

import { DecoyGenerationService } from '../../services/DecoyGenerationService';
import CompanyBlueprintModel from '../../models/CompanyBlueprint';
import router from '../decoy';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/decoy', router);
  app.use(errorHandler);
  return app;
}

const MockedDecoyGenerationService = DecoyGenerationService as jest.MockedClass<typeof DecoyGenerationService>;
const serviceInstance = MockedDecoyGenerationService.mock.instances[0] as jest.Mocked<DecoyGenerationService>;
const mockedModel = CompanyBlueprintModel as unknown as jest.Mocked<typeof CompanyBlueprintModel>;

describe('decoy routes', () => {
  const app = buildApp();

  describe('POST /api/decoy/generate', () => {
    it('rejects a payload missing required fields', async () => {
      const res = await request(app).post('/api/decoy/generate').send({ industry: 'fintech' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(serviceInstance.generateCompanyBlueprint).not.toHaveBeenCalled();
    });

    it('rejects a non-finite companySize', async () => {
      const res = await request(app)
        .post('/api/decoy/generate')
        .send({ industry: 'fintech', region: 'us', companySize: 'lots' });

      expect(res.status).toBe(400);
    });

    it('generates and persists a blueprint', async () => {
      const blueprint = { companyName: 'Acme Corp', industry: 'fintech', employees: [] };
      serviceInstance.generateCompanyBlueprint.mockResolvedValue(blueprint as any);
      mockedModel.create.mockResolvedValue({} as any);

      const res = await request(app)
        .post('/api/decoy/generate')
        .send({ industry: 'fintech', region: 'us', companySize: 50 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.blueprintId).toMatch(/^bp-/);
      expect(res.body.data.blueprint).toEqual(blueprint);
      expect(serviceInstance.generateCompanyBlueprint).toHaveBeenCalledWith({
        industry: 'fintech',
        region: 'us',
        companySize: 50,
      });
      expect(mockedModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ blueprintId: res.body.data.blueprintId, blueprint })
      );
    });
  });

  describe('POST /api/decoy/apply/:blueprintId', () => {
    it('returns 404 when the blueprint is not found', async () => {
      (mockedModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

      const res = await request(app).post('/api/decoy/apply/bp-missing').send({});

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: 'Blueprint bp-missing not found' });
    });

    it('applies the stored blueprint to the default VM when none is given', async () => {
      const storedBlueprint = { companyName: 'Acme Corp' };
      (mockedModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ blueprintId: 'bp-1', blueprint: storedBlueprint }),
      });
      const deployment = { usersCreated: 3, documentsDeployed: 2, servicesMarked: 1, warnings: [] };
      serviceInstance.applyBlueprintToVM.mockResolvedValue(deployment as any);

      const res = await request(app).post('/api/decoy/apply/bp-1').send({});

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ blueprintId: 'bp-1', vmName: 'fake-web-01', deployment });
      expect(serviceInstance.applyBlueprintToVM).toHaveBeenCalledWith(storedBlueprint, 'fake-web-01');
    });

    it('applies the stored blueprint to a custom VM name', async () => {
      (mockedModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ blueprintId: 'bp-1', blueprint: {} }),
      });
      serviceInstance.applyBlueprintToVM.mockResolvedValue({
        usersCreated: 0,
        documentsDeployed: 0,
        servicesMarked: 0,
        warnings: [],
      } as any);

      const res = await request(app).post('/api/decoy/apply/bp-1').send({ vmName: 'custom-vm-02' });

      expect(res.status).toBe(200);
      expect(res.body.data.vmName).toBe('custom-vm-02');
      expect(serviceInstance.applyBlueprintToVM).toHaveBeenCalledWith({}, 'custom-vm-02');
    });
  });

  describe('POST /api/decoy/create-and-apply/:blueprintId', () => {
    it('returns 404 when the blueprint is not found', async () => {
      (mockedModel.findOne as jest.Mock).mockResolvedValue(null);

      const res = await request(app).post('/api/decoy/create-and-apply/bp-missing').send({});

      expect(res.status).toBe(404);
    });

    it('returns the cached result idempotently when already applied', async () => {
      const appliedResult = { vm: { vmName: 'decoy-01' }, deployment: { usersCreated: 1 } };
      (mockedModel.findOne as jest.Mock).mockResolvedValue({
        blueprintId: 'bp-1',
        blueprint: {},
        deployment: { status: 'applied', result: appliedResult },
      });

      const res = await request(app).post('/api/decoy/create-and-apply/bp-1').send({});

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        blueprintId: 'bp-1',
        vm: appliedResult.vm,
        deployment: appliedResult.deployment,
        idempotent: true,
      });
      expect(mockedModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 202 without starting a new job while a recent apply is in progress', async () => {
      (mockedModel.findOne as jest.Mock).mockResolvedValue({
        blueprintId: 'bp-1',
        blueprint: {},
        deployment: { status: 'applying', updatedAt: new Date(), vmName: 'decoy-01', templateVmName: 'fake-web-01' },
      });

      const res = await request(app).post('/api/decoy/create-and-apply/bp-1').send({});

      expect(res.status).toBe(202);
      expect(res.body.data).toMatchObject({ status: 'applying', started: false, vmName: 'decoy-01' });
    });

    it('starts a new create-and-apply job when nothing is in progress', async () => {
      (mockedModel.findOne as jest.Mock).mockResolvedValue({
        blueprintId: 'bp-1',
        blueprint: {},
        deployment: undefined,
      });
      (mockedModel.findOneAndUpdate as jest.Mock).mockResolvedValue({ blueprintId: 'bp-1' });
      serviceInstance.createDecoyFromTemplateAndApply.mockResolvedValue({
        vm: { vmName: 'decoy-02', templateVmName: 'fake-web-01', created: true },
        deployment: { usersCreated: 1, documentsDeployed: 1 },
      } as any);
      (mockedModel.updateOne as jest.Mock).mockResolvedValue({} as any);

      const res = await request(app)
        .post('/api/decoy/create-and-apply/bp-1')
        .send({ vmName: 'decoy-02', templateVmName: 'fake-web-01' });

      expect(res.status).toBe(202);
      expect(res.body.data).toMatchObject({
        blueprintId: 'bp-1',
        status: 'applying',
        vmName: 'decoy-02',
        templateVmName: 'fake-web-01',
        started: true,
      });
    });
  });

  describe('GET /api/decoy/status/:blueprintId', () => {
    it('returns 404 when the blueprint is not found', async () => {
      (mockedModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

      const res = await request(app).get('/api/decoy/status/bp-missing');

      expect(res.status).toBe(404);
    });

    it('returns pending status when no deployment exists yet', async () => {
      (mockedModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ blueprintId: 'bp-1', deployment: undefined }),
      });

      const res = await request(app).get('/api/decoy/status/bp-1');

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        blueprintId: 'bp-1',
        status: 'pending',
        vmName: null,
        vm: null,
        deployment: null,
      });
    });

    it('returns the applied result when deployment succeeded', async () => {
      const result = { vm: { vmName: 'decoy-01' }, deployment: { usersCreated: 2 } };
      (mockedModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          blueprintId: 'bp-1',
          deployment: { status: 'applied', vmName: 'decoy-01', templateVmName: 'fake-web-01', result },
        }),
      });

      const res = await request(app).get('/api/decoy/status/bp-1');

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        status: 'applied',
        vmName: 'decoy-01',
        vm: result.vm,
        deployment: result.deployment,
      });
    });
  });
});
