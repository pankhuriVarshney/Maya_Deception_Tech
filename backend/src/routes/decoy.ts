import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import CompanyBlueprintModel from '../models/CompanyBlueprint';
import {
  DecoyGenerationService,
  DecoyGenerationInput,
  CreateAndApplyResult
} from '../services/DecoyGenerationService';

const router = Router();
let decoyGenerationService: DecoyGenerationService | null = null;
try {
  decoyGenerationService = new DecoyGenerationService();
} catch (error) {
  logger.warn('DecoyGenerationService failed to initialize; decoy routes will run in degraded mode', {
    error: error instanceof Error ? error.message : String(error)
  });
}
const activeCreateApplyJobs = new Set<string>();

function getDecoyGenerationService(): DecoyGenerationService | null {
  if (!decoyGenerationService) {
    logger.warn('DecoyGenerationService unavailable; skipping decoy operation');
  }
  return decoyGenerationService;
}

function startCreateAndApplyJob(params: {
  blueprintId: string;
  blueprint: Parameters<DecoyGenerationService['createDecoyFromTemplateAndApply']>[0];
  vmName: string;
  templateVmName: string;
  createdAt: Date;
}) {
  const { blueprintId, blueprint, vmName, templateVmName, createdAt } = params;
  if (activeCreateApplyJobs.has(blueprintId)) {
    return;
  }
  activeCreateApplyJobs.add(blueprintId);

  void (async () => {
    try {
      const service = getDecoyGenerationService();
      if (!service) return;

      const result = await service.createDecoyFromTemplateAndApply(blueprint, {
        templateVmName,
        vmName
      });

      const appliedState = {
        status: 'applied' as const,
        vmName: result.vm.vmName,
        templateVmName: result.vm.templateVmName,
        errorMessage: undefined,
        createdAt,
        updatedAt: new Date(),
        result
      };

      await CompanyBlueprintModel.updateOne(
        { blueprintId },
        { $set: { deployment: appliedState } }
      );

      logger.info(`Created/apply decoy blueprint ${blueprintId}`, {
        templateVmName,
        vmName: result.vm.vmName,
        created: result.vm.created,
        usersCreated: result.deployment.usersCreated,
        documentsDeployed: result.deployment.documentsDeployed
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedState = {
        status: 'failed' as const,
        vmName,
        templateVmName,
        errorMessage: errorMessage.slice(0, 1800),
        createdAt,
        updatedAt: new Date(),
        result: undefined
      };
      await CompanyBlueprintModel.updateOne(
        { blueprintId },
        { $set: { deployment: failedState } }
      );
      logger.error(`Async create/apply failed for blueprint ${blueprintId}`, {
        vmName,
        templateVmName,
        error: errorMessage
      });
    } finally {
      activeCreateApplyJobs.delete(blueprintId);
    }
  })();
}

function parseGenerationInput(body: unknown): DecoyGenerationInput | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;

  const industry = typeof record.industry === 'string' ? record.industry.trim() : '';
  const region = typeof record.region === 'string' ? record.region.trim() : '';
  const companySize = Number(record.companySize);

  if (!industry || !region || !Number.isFinite(companySize)) {
    return null;
  }

  return {
    industry,
    companySize,
    region
  };
}

// POST /api/decoy/generate
router.post('/generate', asyncHandler(async (req: Request, res: Response) => {
  const input = parseGenerationInput(req.body);

  if (!input) {
    return res.status(400).json({
      success: false,
      error: 'Invalid payload. Required fields: industry (string), companySize (number), region (string).',
      timestamp: new Date().toISOString()
    });
  }

  const service = getDecoyGenerationService();
  if (!service) {
    return res.status(503).json({
      success: false,
      error: 'Decoy generation service unavailable',
      timestamp: new Date().toISOString()
    });
  }

  const blueprint = await service.generateCompanyBlueprint(input);
  const blueprintId = `bp-${uuidv4()}`;

  await CompanyBlueprintModel.create({
    blueprintId,
    createdAt: new Date(),
    config: input,
    blueprint
  });

  logger.info(`Generated and stored decoy blueprint ${blueprintId}`, {
    industry: input.industry,
    companySize: input.companySize,
    region: input.region
  });

  res.status(201).json({
    success: true,
    data: {
      blueprintId,
      config: input,
      blueprint
    },
    timestamp: new Date().toISOString()
  });
}));

// POST /api/decoy/apply/:blueprintId
router.post('/apply/:blueprintId', asyncHandler(async (req: Request, res: Response) => {
  const { blueprintId } = req.params;
  const vmName = typeof req.body?.vmName === 'string' && req.body.vmName.trim()
    ? req.body.vmName.trim()
    : 'fake-web-01';

  const stored = await CompanyBlueprintModel.findOne({ blueprintId }).lean();
  if (!stored) {
    return res.status(404).json({
      success: false,
      error: `Blueprint ${blueprintId} not found`,
      timestamp: new Date().toISOString()
    });
  }

  const service = getDecoyGenerationService();
  if (!service) {
    return res.status(503).json({
      success: false,
      error: 'Decoy generation service unavailable',
      timestamp: new Date().toISOString()
    });
  }

  const deployment = await service.applyBlueprintToVM(stored.blueprint, vmName);

  logger.info(`Applied decoy blueprint ${blueprintId} to VM ${vmName}`, {
    usersCreated: deployment.usersCreated,
    documentsDeployed: deployment.documentsDeployed,
    servicesMarked: deployment.servicesMarked,
    warnings: deployment.warnings.length
  });

  res.json({
    success: true,
    data: {
      blueprintId,
      vmName,
      deployment
    },
    timestamp: new Date().toISOString()
  });
}));

// POST /api/decoy/create-and-apply/:blueprintId
router.post('/create-and-apply/:blueprintId', asyncHandler(async (req: Request, res: Response) => {
  const { blueprintId } = req.params;
  const templateVmName = typeof req.body?.templateVmName === 'string' && req.body.templateVmName.trim()
    ? req.body.templateVmName.trim()
    : 'fake-web-01';
  const requestedVmName = typeof req.body?.vmName === 'string' && req.body.vmName.trim()
    ? req.body.vmName.trim()
    : undefined;

  const stored = await CompanyBlueprintModel.findOne({ blueprintId });
  if (!stored) {
    return res.status(404).json({
      success: false,
      error: `Blueprint ${blueprintId} not found`,
      timestamp: new Date().toISOString()
    });
  }

  const existingDeployment = stored.deployment;
  const existingCreatedAt = existingDeployment?.createdAt || new Date();
  const now = new Date();
  const staleApplyingCutoff = new Date(now.getTime() - (15 * 60 * 1000));

  if (existingDeployment?.status === 'applied' && existingDeployment.result) {
    const appliedResult = existingDeployment.result as CreateAndApplyResult;
    return res.json({
      success: true,
      data: {
        blueprintId,
        vm: appliedResult.vm,
        deployment: appliedResult.deployment,
        idempotent: true
      },
      timestamp: new Date().toISOString()
    });
  }

  if (existingDeployment?.status === 'applying' && existingDeployment.updatedAt) {
    const elapsedMs = now.getTime() - new Date(existingDeployment.updatedAt).getTime();
    if (elapsedMs < 15 * 60 * 1000) {
      return res.status(202).json({
        success: true,
        data: {
          status: 'applying',
          vmName: existingDeployment.vmName || null,
          templateVmName: existingDeployment.templateVmName || templateVmName,
          started: false
        },
        timestamp: new Date().toISOString()
      });
    }
  }

  const vmName = requestedVmName
    || existingDeployment?.vmName
    || await (async () => {
      const service = getDecoyGenerationService();
      return service ? service.getSuggestedVmName(stored.blueprint) : 'fake-web-01';
    })();
  const applyingState = {
    status: 'applying' as const,
    vmName,
    templateVmName,
    errorMessage: undefined,
    result: undefined,
    createdAt: existingCreatedAt,
    updatedAt: now
  };

  const lock = await CompanyBlueprintModel.findOneAndUpdate(
    {
      blueprintId,
      $or: [
        { deployment: { $exists: false } },
        { 'deployment.status': 'pending' },
        { 'deployment.status': 'failed' },
        {
          $and: [
            { 'deployment.status': 'applying' },
            { 'deployment.updatedAt': { $lt: staleApplyingCutoff } }
          ]
        }
      ]
    },
    { $set: { deployment: applyingState } },
    { new: true }
  );

  if (!lock) {
    const latest = await CompanyBlueprintModel.findOne({ blueprintId }).lean();
    const latestDeployment = latest?.deployment;

    if (latestDeployment?.status === 'applied' && latestDeployment.result) {
      const appliedResult = latestDeployment.result as CreateAndApplyResult;
      return res.json({
        success: true,
        data: {
          blueprintId,
          vm: appliedResult.vm,
          deployment: appliedResult.deployment,
          idempotent: true
        },
        timestamp: new Date().toISOString()
      });
    }

    if (latestDeployment?.status === 'applying') {
      return res.status(202).json({
        success: true,
        data: {
          status: 'applying',
          vmName: latestDeployment.vmName || null,
          templateVmName: latestDeployment.templateVmName || templateVmName,
          started: false
        },
        timestamp: new Date().toISOString()
      });
    }
  }
  startCreateAndApplyJob({
    blueprintId,
    blueprint: stored.blueprint,
    vmName,
    templateVmName,
    createdAt: existingCreatedAt
  });

  res.status(202).json({
    success: true,
    data: {
      blueprintId,
      status: 'applying',
      vmName,
      templateVmName,
      started: true
    },
    timestamp: new Date().toISOString()
  });
}));

// GET /api/decoy/status/:blueprintId
router.get('/status/:blueprintId', asyncHandler(async (req: Request, res: Response) => {
  const { blueprintId } = req.params;
  const stored = await CompanyBlueprintModel.findOne({ blueprintId }).lean();

  if (!stored) {
    return res.status(404).json({
      success: false,
      error: `Blueprint ${blueprintId} not found`,
      timestamp: new Date().toISOString()
    });
  }

  const deployment = stored.deployment;
  const result = (deployment?.result || null) as CreateAndApplyResult | null;

  res.json({
    success: true,
    data: {
      blueprintId,
      status: deployment?.status || 'pending',
      vmName: deployment?.vmName || null,
      templateVmName: deployment?.templateVmName || null,
      errorMessage: deployment?.errorMessage || null,
      vm: result?.vm || null,
      deployment: result?.deployment || null,
      updatedAt: deployment?.updatedAt || null
    },
    timestamp: new Date().toISOString()
  });
}));

export default router;
