import { Router, Request, Response } from 'express';
import { DashboardService } from '../services/DashboardService';
import { asyncHandler } from '../middleware/errorHandler';
import { mapToAttackerSummary, mapToDashboardData } from '../services/AttackerMapper';

const router = Router();
const dashboardService = new DashboardService();

// Root dashboard endpoint (matches frontend /api/dashboard)
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const [stats, activeAttackers, timeline, mitreMatrix, lateralMovement, commands, behavior, incidents] = await Promise.all([
    dashboardService.getDashboardStats(),
    dashboardService.getActiveAttackers(), // You'll need to add this method
    dashboardService.getAttackTimeline(undefined, 24),
    dashboardService.getMitreMatrix(),
    dashboardService.getLateralMovementGraph(),
    dashboardService.getCommandActivity(undefined, 10),
    dashboardService.getAttackerBehaviorAnalysis(),
    dashboardService.getIncidentSummary()
  ]);

  res.json({
    success: true,
    data: {
      stats,
      activeAttackers,
      timeline,
      mitreMatrix,
      lateralMovement,
      commands,
      behavior,
      incidents
    },
    timestamp: new Date().toISOString()
  });
}));

// GET /api/dashboard/attackers (alias for active-attackers)
router.get('/attackers', asyncHandler(async (req: Request, res: Response) => {
    const attackers = await dashboardService.getMappedActiveAttackers();
    
    res.json({
      success: true,
      data: attackers,
      count: attackers.length,
      timestamp: new Date().toISOString()
    });
  }));

// GET /api/dashboard/attacker/:id (matches frontend /api/attacker/:id)
router.get('/attacker/:id', asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const data = await dashboardService.getAttackerDashboard(id);
    
    if (!data) {
      return res.status(404).json({ 
        success: false, 
        error: `Attacker ${id} not found`, 
        timestamp: new Date().toISOString() 
      });
    }
    
    res.json({ 
      success: true, 
      data, 
      timestamp: new Date().toISOString() 
    });
  }));
  

// Keep all your existing routes too...
router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  const stats = await dashboardService.getDashboardStats();
  res.json({ success: true, data: stats, timestamp: new Date().toISOString() });
}));

router.get('/timeline', asyncHandler(async (req: Request, res: Response) => {
  const { attackerId, hours = 24 } = req.query;
  const timeline = await dashboardService.getAttackTimeline(attackerId as string | undefined, parseInt(hours as string));
  res.json({ success: true, data: timeline, count: timeline.length, timestamp: new Date().toISOString() });
}));

router.get('/mitre-matrix', asyncHandler(async (req: Request, res: Response) => {
  const { attackerId } = req.query;
  const matrix = await dashboardService.getMitreMatrix(attackerId as string | undefined);
  res.json({ success: true, data: matrix, timestamp: new Date().toISOString() });
}));

router.get('/lateral-movement', asyncHandler(async (req: Request, res: Response) => {
  const { attackerId } = req.query;
  const graph = await dashboardService.getLateralMovementGraph(attackerId as string | undefined);
  res.json({ success: true, data: graph, timestamp: new Date().toISOString() });
}));

router.get('/commands', asyncHandler(async (req: Request, res: Response) => {
  const { attackerId, limit = 10 } = req.query;
  const commands = await dashboardService.getCommandActivity(attackerId as string | undefined, parseInt(limit as string));
  res.json({ success: true, data: commands, timestamp: new Date().toISOString() });
}));

router.get('/metrics', asyncHandler(async (req: Request, res: Response) => {
  const metrics = await dashboardService.getDeceptionMetrics();
  res.json({ success: true, data: metrics, timestamp: new Date().toISOString() });
}));

router.get('/behavior', asyncHandler(async (req: Request, res: Response) => {
  const { attackerId } = req.query;
  const analysis = await dashboardService.getAttackerBehaviorAnalysis(attackerId as string | undefined);
  res.json({ success: true, data: analysis, timestamp: new Date().toISOString() });
}));

router.get('/incidents', asyncHandler(async (req: Request, res: Response) => {
  const summary = await dashboardService.getIncidentSummary();
  res.json({ success: true, data: summary, timestamp: new Date().toISOString() });
}));

router.get('/active-attackers', asyncHandler(async (req: Request, res: Response) => {
    const attackers = await dashboardService.getMappedActiveAttackers();

    res.json({
      success: true,
      data: attackers,
      count: attackers.length,
      timestamp: new Date().toISOString()
    });
  }));

// DEBUG: Check MongoDB directly for attackers
router.get('/debug/attackers', asyncHandler(async (req: Request, res: Response) => {
  const { Attacker, AttackEvent } = require('../models');
  
  const [allAttackers, activeAttackers, recentEvents] = await Promise.all([
    Attacker.find().sort({ lastSeen: -1 }),
    Attacker.find({ status: 'Active' }).sort({ lastSeen: -1 }),
    AttackEvent.find().sort({ timestamp: -1 }).limit(10)
  ]);

  res.json({
    success: true,
    data: {
      allAttackers: allAttackers.map((a: any) => ({
        attackerId: a.attackerId,
        ipAddress: a.ipAddress,
        entryPoint: a.entryPoint,
        status: a.status,
        lastSeen: a.lastSeen,
        createdAt: a.createdAt
      })),
      activeAttackers: activeAttackers.map((a: any) => ({
        attackerId: a.attackerId,
        ipAddress: a.ipAddress,
        entryPoint: a.entryPoint,
        status: a.status,
        lastSeen: a.lastSeen
      })),
      recentEvents: recentEvents.map((e: any) => ({
        eventId: e.eventId,
        attackerId: e.attackerId,
        type: e.type,
        description: e.description,
        timestamp: e.timestamp
      }))
    },
    timestamp: new Date().toISOString()
  });
}));

// POST /api/dashboard/attacker - Create a test attacker (for debugging)
router.post('/attacker', asyncHandler(async (req: Request, res: Response) => {
  const { Attacker, AttackEvent } = require('../models');
  const { attackerId, ipAddress, entryPoint, campaign } = req.body;
  
  if (!attackerId || !ipAddress) {
    return res.status(400).json({
      success: false,
      error: 'attackerId and ipAddress are required'
    });
  }

  const attacker = new Attacker({
    attackerId,
    ipAddress,
    entryPoint: entryPoint || 'Manual Test',
    currentPrivilege: 'User',
    riskLevel: 'Medium',
    campaign: campaign || 'Test Campaign',
    firstSeen: new Date(),
    lastSeen: new Date(),
    dwellTime: 0,
    status: 'Active'
  });

  await attacker.save();

  // Create an initial event
  const event = new AttackEvent({
    eventId: `evt-test-${Date.now()}`,
    attackerId,
    type: 'Initial Access',
    technique: 'T1078',
    tactic: 'Initial Access',
    description: 'Test attacker created via API',
    sourceHost: ipAddress,
    targetHost: entryPoint || 'Manual Test',
    severity: 'Low',
    status: 'Detected'
  });

  await event.save();

  const dashboard = await dashboardService.getAttackerDashboard(attackerId);

  res.json({
    success: true,
    data: dashboard,
    timestamp: new Date().toISOString()
  });
}));

export default router;