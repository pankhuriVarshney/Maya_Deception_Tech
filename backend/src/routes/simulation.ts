import { Router, Request, Response } from 'express';
import { RealSimulationService } from '../services/RealSimulationService';
import { K8sSimulationService } from '../services/K8sSimulationService';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();
const simulationService = new RealSimulationService();
const k8sSimulationService = new K8sSimulationService();

// Valid target name pattern (security: prevent path traversal / injection).
// Matches both Vagrant VM names (fake-web-01) and K8s decoy app names
// (web-03, jump-01) -- effectively a DNS-1123-label-like pattern.
const VM_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;
const VALID_SCAN_TYPES = ['internal', 'external', 'full', 'stealth'];
const VALID_TOOLS = ['mimikatz', 'lazagne', 'gsecdump', 'pwdump'];
const VALID_METHODS = ['sudo-exploit', 'kernel-exploit', 'misconfiguration', 'credential-reuse'];

/**
 * Validate VM name to prevent path traversal and injection attacks
 */
function isValidVmName(name: string): boolean {
  return VM_NAME_PATTERN.test(name);
}

/**
 * Validate and sanitize simulation parameters
 */
function validateSimulationInput(
  params: { target?: string; source?: string; targets?: string[] },
  type: string
): { valid: boolean; error?: string } {
  if (params.target && !isValidVmName(params.target)) {
    return {
      valid: false,
      error: `Invalid target VM name: ${params.target}. Must match pattern: ${VM_NAME_PATTERN}`
    };
  }

  if (params.source && !isValidVmName(params.source)) {
    return {
      valid: false,
      error: `Invalid source VM name: ${params.source}. Must match pattern: ${VM_NAME_PATTERN}`
    };
  }

  if (params.targets && Array.isArray(params.targets)) {
    for (const target of params.targets) {
      if (!isValidVmName(target)) {
        return {
          valid: false,
          error: `Invalid target VM name in array: ${target}`
        };
      }
    }
  }

  return { valid: true };
}

// Helper: Refresh VM cache before simulations if needed
async function ensureVMCacheFresh() {
  logger.info('Refreshing VM cache before simulation...');
  const vmStatus = await simulationService.refreshVMs();
  logger.info(`VM cache refreshed: ${vmStatus.count} running VMs found: [${vmStatus.vms.join(', ')}]`);
  return vmStatus;
}

// SSH Brute Force Simulation
router.post('/ssh-bruteforce', asyncHandler(async (req: Request, res: Response) => {
  const { target = 'fake-jump-01', attempts = 5 } = req.body;

  // Validate inputs
  const validation = validateSimulationInput({ target }, 'ssh-bruteforce');
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      error: validation.error,
      timestamp: new Date().toISOString()
    });
  }

  // Validate attempts range
  const safeAttempts = Math.min(Math.max(1, parseInt(attempts) || 5), 100);
  if (safeAttempts !== attempts) {
    logger.warn(`Adjusted attempts from ${attempts} to ${safeAttempts}`);
  }

  logger.info(`API: REAL SSH brute force simulation requested - target: ${target}, attempts: ${safeAttempts}`);

  // K8s decoys take priority when the target name resolves there --
  // otherwise fall back to the existing Vagrant path (which has its own
  // mock fallback when the VM isn't running either).
  await k8sSimulationService.refreshTargets();
  if (k8sSimulationService.hasTarget(target)) {
    const k8sResult = await k8sSimulationService.simulateSSHBruteForce({ target, attempts: safeAttempts });
    return res.json({
      success: true,
      message: 'REAL SSH brute force simulation executed on K8s decoy',
      data: k8sResult,
      real: true,
      platform: 'k8s',
      attackerId: k8sResult.attackerId,
      timestamp: new Date().toISOString()
    });
  }

  // Refresh VM cache before simulation
  await ensureVMCacheFresh();

  const result = await simulationService.simulateSSHBruteForce({ target, attempts: safeAttempts });

  res.json({
    success: true,
    message: result.real ? 'REAL SSH brute force simulation executed on VM' : 'Mock simulation (VM not available)',
    data: result,
    real: result.real || false,
    platform: 'vagrant',
    attackerId: result.attackerId,
    timestamp: new Date().toISOString()
  });
}));

// Lateral Movement Simulation
router.post('/lateral-movement', asyncHandler(async (req: Request, res: Response) => {
  const { source = 'fake-web-01', targets = ['fake-jump-01', 'fake-ftp-01'] } = req.body;

  // Validate inputs
  const validation = validateSimulationInput({ source, targets }, 'lateral-movement');
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      error: validation.error,
      timestamp: new Date().toISOString()
    });
  }

  // Ensure targets is an array with at least one element
  const safeTargets = Array.isArray(targets) && targets.length > 0 ? targets : ['fake-jump-01'];

  logger.info(`API: REAL lateral movement simulation requested - source: ${source}, targets: [${safeTargets.join(', ')}]`);

  // K8s decoys take priority when the source resolves there.
  await k8sSimulationService.refreshTargets();
  if (k8sSimulationService.hasTarget(source)) {
    const k8sResult = await k8sSimulationService.simulateLateralMovement({ source, targets: safeTargets });
    return res.json({
      success: true,
      message: 'REAL lateral movement simulation executed on K8s decoys',
      data: k8sResult,
      real: true,
      platform: 'k8s',
      attackerId: k8sResult.attackerId,
      timestamp: new Date().toISOString()
    });
  }

  // Refresh VM cache before simulation
  await ensureVMCacheFresh();

  const result = await simulationService.simulateLateralMovement({ source, targets: safeTargets });

  res.json({
    success: result.success,
    message: result.real ? 'REAL lateral movement simulation executed on VMs' : 'Mock simulation (VMs not available)',
    data: result,
    real: result.real || false,
    platform: 'vagrant',
    attackerId: result.attackerId,
    timestamp: new Date().toISOString()
  });
}));

// Credential Theft Simulation
router.post('/credential-theft', asyncHandler(async (req: Request, res: Response) => {
  const { target = 'fake-web-01', tool = 'mimikatz' } = req.body;

  // Validate inputs
  const validation = validateSimulationInput({ target }, 'credential-theft');
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      error: validation.error,
      timestamp: new Date().toISOString()
    });
  }

  // Validate tool parameter
  const safeTool = VALID_TOOLS.includes(tool?.toLowerCase()) ? tool.toLowerCase() : 'mimikatz';
  if (safeTool !== tool?.toLowerCase()) {
    logger.warn(`Adjusted tool from ${tool} to ${safeTool}`);
  }

  logger.info(`API: REAL credential theft simulation requested - target: ${target}, tool: ${safeTool}`);

  await k8sSimulationService.refreshTargets();
  if (k8sSimulationService.hasTarget(target)) {
    const k8sResult = await k8sSimulationService.simulateCredentialTheft({ target, tool: safeTool });
    return res.json({
      success: true,
      message: 'REAL credential theft simulation executed on K8s decoy',
      data: k8sResult,
      real: true,
      platform: 'k8s',
      attackerId: k8sResult.attackerId,
      timestamp: new Date().toISOString()
    });
  }

  // Refresh VM cache before simulation
  await ensureVMCacheFresh();

  const result = await simulationService.simulateCredentialTheft({ target, tool: safeTool });

  res.json({
    success: result.success,
    message: result.real ? 'REAL credential theft simulation executed on VM' : 'Mock simulation (VM not available)',
    data: result,
    real: result.real || false,
    platform: 'vagrant',
    attackerId: result.attackerId,
    timestamp: new Date().toISOString()
  });
}));

// Network Discovery Simulation
router.post('/discovery', asyncHandler(async (req: Request, res: Response) => {
  const { source = 'fake-jump-01', scanType = 'internal' } = req.body;

  // Validate inputs
  const validation = validateSimulationInput({ source }, 'discovery');
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      error: validation.error,
      timestamp: new Date().toISOString()
    });
  }

  // Validate scan type
  const safeScanType = VALID_SCAN_TYPES.includes(scanType?.toLowerCase()) ? scanType.toLowerCase() : 'internal';
  if (safeScanType !== scanType?.toLowerCase()) {
    logger.warn(`Adjusted scanType from ${scanType} to ${safeScanType}`);
  }

  logger.info(`API: REAL network discovery simulation requested - source: ${source}, scanType: ${safeScanType}`);

  await k8sSimulationService.refreshTargets();
  if (k8sSimulationService.hasTarget(source)) {
    const k8sResult = await k8sSimulationService.simulateDiscovery({ source, scanType: safeScanType });
    return res.json({
      success: true,
      message: 'REAL network discovery simulation executed on K8s decoy',
      data: k8sResult,
      real: true,
      platform: 'k8s',
      attackerId: k8sResult.attackerId,
      timestamp: new Date().toISOString()
    });
  }

  // Refresh VM cache before simulation
  await ensureVMCacheFresh();

  const result = await simulationService.simulateDiscovery({ source, scanType: safeScanType });

  res.json({
    success: true,
    message: result.real ? 'REAL network discovery simulation executed on VM' : 'Mock simulation (VM not available)',
    data: result,
    real: result.real || false,
    platform: 'vagrant',
    attackerId: result.attackerId,
    timestamp: new Date().toISOString()
  });
}));

// Privilege Escalation Simulation
router.post('/privilege-escalation', asyncHandler(async (req: Request, res: Response) => {
  const { target = 'fake-ftp-01', method = 'sudo-exploit' } = req.body;

  // Validate inputs
  const validation = validateSimulationInput({ target }, 'privilege-escalation');
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      error: validation.error,
      timestamp: new Date().toISOString()
    });
  }

  // Validate method parameter
  const safeMethod = VALID_METHODS.includes(method?.toLowerCase()) ? method.toLowerCase() : 'sudo-exploit';
  if (safeMethod !== method?.toLowerCase()) {
    logger.warn(`Adjusted method from ${method} to ${safeMethod}`);
  }

  logger.info(`API: REAL privilege escalation simulation requested - target: ${target}, method: ${safeMethod}`);

  await k8sSimulationService.refreshTargets();
  if (k8sSimulationService.hasTarget(target)) {
    const k8sResult = await k8sSimulationService.simulatePrivilegeEscalation({ target, method: safeMethod });
    return res.json({
      success: true,
      message: 'REAL privilege escalation simulation executed on K8s decoy',
      data: k8sResult,
      real: true,
      platform: 'k8s',
      attackerId: k8sResult.attackerId,
      timestamp: new Date().toISOString()
    });
  }

  // Refresh VM cache before simulation
  await ensureVMCacheFresh();

  const result = await simulationService.simulatePrivilegeEscalation({ target, method: safeMethod });

  res.json({
    success: true,
    message: result.real ? 'REAL privilege escalation simulation executed on VM' : 'Mock simulation (VM not available)',
    data: result,
    real: result.real || false,
    platform: 'vagrant',
    attackerId: result.attackerId,
    timestamp: new Date().toISOString()
  });
}));

// Full Attack Campaign Simulation
router.post('/full-campaign', asyncHandler(async (req: Request, res: Response) => {
  const { complexity = 'advanced' } = req.body;

  // Validate complexity parameter
  const validComplexities = ['basic', 'intermediate', 'advanced', 'apt'];
  const safeComplexity = validComplexities.includes(complexity?.toLowerCase()) ? complexity.toLowerCase() : 'advanced';
  if (safeComplexity !== complexity?.toLowerCase()) {
    logger.warn(`Adjusted complexity from ${complexity} to ${safeComplexity}`);
  }

  logger.info(`API: REAL full attack campaign simulation requested - complexity: ${safeComplexity}`);

  // Full campaign needs at least 2 decoys to pivot between; prefer K8s if
  // it has enough, same "K8s first" resolution as the other scenarios.
  await k8sSimulationService.refreshTargets();
  if (k8sSimulationService.availableTargets().length >= 2) {
    const k8sResult = await k8sSimulationService.simulateFullCampaign({ complexity: safeComplexity });
    return res.json({
      success: true,
      message: 'REAL full attack campaign simulation executed on K8s decoys',
      data: k8sResult,
      real: true,
      platform: 'k8s',
      attackerId: k8sResult.attackerId,
      timestamp: new Date().toISOString()
    });
  }

  // Refresh VM cache before simulation
  await ensureVMCacheFresh();

  const result = await simulationService.simulateFullCampaign({ complexity: safeComplexity });

  res.json({
    success: true,
    message: result.real ? 'REAL full attack campaign simulation executed' : 'Mock simulation (VMs not available)',
    data: result,
    real: result.real || false,
    platform: 'vagrant',
    attackerId: result.attackerId,
    timestamp: new Date().toISOString()
  });
}));

// Refresh VMs endpoint
router.post('/refresh-vms', asyncHandler(async (req: Request, res: Response) => {
  logger.info('API: Refreshing VM cache');

  const result = await simulationService.refreshVMs();

  res.json({
    success: true,
    message: `Discovered ${result.count} running VMs`,
    data: result,
    timestamp: new Date().toISOString()
  });
}));

// Get simulation status
router.get('/status', asyncHandler(async (req: Request, res: Response) => {
  const vmCacheStatus = (simulationService as any).getVMCacheStatus();
  
  res.json({
    success: true,
    data: {
      availableSimulations: [
        'ssh-bruteforce',
        'lateral-movement',
        'credential-theft',
        'discovery',
        'privilege-escalation',
        'full-campaign'
      ],
      vmCache: vmCacheStatus,
      runningVMs: Array.from((simulationService as any).vmCache?.keys() || []),
      status: 'ready',
      mode: 'real-attacks',
      validationRules: {
        vmNamePattern: VM_NAME_PATTERN.toString(),
        validScanTypes: VALID_SCAN_TYPES,
        validTools: VALID_TOOLS,
        validMethods: VALID_METHODS
      },
      timestamp: new Date().toISOString()
    }
  });
}));

// Get detailed VM cache status
router.get('/vm-cache', asyncHandler(async (req: Request, res: Response) => {
  const vmCacheStatus = (simulationService as any).getVMCacheStatus();
  
  res.json({
    success: true,
    data: vmCacheStatus,
    timestamp: new Date().toISOString()
  });
}));

// Manually populate VM cache (for debugging)
router.post('/vm-cache/populate', asyncHandler(async (req: Request, res: Response) => {
  const { vms } = req.body; // Array of { name, path, ip }
  
  if (!Array.isArray(vms)) {
    return res.status(400).json({
      success: false,
      error: 'vms array is required',
      timestamp: new Date().toISOString()
    });
  }
  
  const result = await (simulationService as any).populateVMCacheManually(vms);
  
  res.json({
    success: true,
    message: `Manually populated ${result.count} VMs`,
    data: result,
    timestamp: new Date().toISOString()
  });
}));

// Force refresh VM cache
router.post('/vm-cache/refresh', asyncHandler(async (req: Request, res: Response) => {
  logger.info('Force refreshing VM cache...');
  const result = await (simulationService as any).refreshVMs();

  res.json({
    success: true,
    message: `Refreshed VM cache: ${result.count} VMs found`,
    data: result,
    timestamp: new Date().toISOString()
  });
}));

// K8s decoy targets (gVisor/Kata), analogous to /vm-cache above
router.get('/k8s-targets', asyncHandler(async (req: Request, res: Response) => {
  const result = await k8sSimulationService.refreshTargets();

  res.json({
    success: true,
    data: result,
    timestamp: new Date().toISOString()
  });
}));

export default router;
