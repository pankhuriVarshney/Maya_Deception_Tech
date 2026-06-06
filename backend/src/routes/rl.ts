import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { rlDecisionService, RLDecision } from '../services/RLDecisionService';
import { rlArtifactsService } from '../services/RLArtifactsService';
import { WebSocketHandler } from '../websocket/WebSocketHandler';
import { logger } from '../utils/logger';

const router = Router();

// This will be set from server.ts
let wsHandler: WebSocketHandler | null = null;

export function setRLRoutesWebSocket(handler: WebSocketHandler) {
  wsHandler = handler;
}

// POST /api/rl/decision
// The Rust RL sidecar (or any simulator) POSTs the decision here.
// This stores it and immediately broadcasts via WebSocket.
router.post('/decision', asyncHandler(async (req: Request, res: Response) => {
  const body = req.body;

  // Support both the full RL_DECISION_JSON shape and a flat one
  const decision: RLDecision = {
    timestamp: body.timestamp || new Date().toISOString(),
    attacker_id: body.attacker_id || body.attackerId || 'unknown',
    current_tier: body.current_tier || body.currentTier || 'med-kata',
    action: body.action || 'maintain',
    confidence: typeof body.confidence === 'number' ? body.confidence : parseFloat(body.confidence) || 0.7,
    rationale: body.rationale || 'RL decision received',
    features: body.features || {},
    observed_ttps: body.observed_ttps || body.observedTTPs || [],
    predicted_reward_delta: body.predicted_reward_delta || 0,
    estimated_value: body.estimated_value,
  };

  rlDecisionService.addDecision(decision);

  // Broadcast to all connected dashboard clients
  if (wsHandler) {
    wsHandler.broadcastMessage({
      type: 'RL_DECISION',
      data: decision,
      timestamp: decision.timestamp,
    });
  } else {
    logger.warn('WebSocketHandler not available for RL_DECISION broadcast');
  }

  // Also update general stats so the main dashboard feels alive
  // (optional: could trigger a STATS_UPDATED here if desired)

  res.json({
    success: true,
    message: 'RL decision recorded and broadcast',
    decision: {
      action: decision.action,
      confidence: decision.confidence,
      attacker_id: decision.attacker_id,
    },
  });
}));

// GET /api/rl/decisions - for initial load or polling fallback
router.get('/decisions', asyncHandler(async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 15;
  const decisions = rlDecisionService.getRecentDecisions(limit);
  const avgConfidence = rlDecisionService.getAverageConfidence(10);

  res.json({
    success: true,
    data: {
      decisions,
      avgConfidence,
      count: decisions.length,
    },
    timestamp: new Date().toISOString(),
  });
}));

// For demo: one-click simulate a sophisticated attacker decision
router.post('/simulate-decision', asyncHandler(async (_req: Request, res: Response) => {
  const sophisticatedDecision: RLDecision = {
    timestamp: new Date().toISOString(),
    attacker_id: `SIM-${Date.now().toString().slice(-6)}`,
    current_tier: 'low-gvisor',
    action: Math.random() > 0.4 ? 'escalate_tier' : 'plant_breadcrumb',
    confidence: 0.78 + Math.random() * 0.18,
    rationale: 'High recon + privilege escalation signals detected. Escalating fidelity to prolong engagement.',
    features: {
      recon_command_count: 12 + Math.floor(Math.random() * 8),
      privilege_escalation_attempts: 3 + Math.floor(Math.random() * 4),
      mitre_ttp_coverage: 4,
      fingerprint_risk_score: 1.2,
      command_entropy: 4.1,
      num_lateral_moves: 2,
    },
    observed_ttps: ['T1082', 'T1068', 'T1021'],
    predicted_reward_delta: 85 + Math.floor(Math.random() * 40),
  };

  rlDecisionService.addDecision(sophisticatedDecision);

  if (wsHandler) {
    wsHandler.broadcastMessage({
      type: 'RL_DECISION',
      data: sophisticatedDecision,
      timestamp: sophisticatedDecision.timestamp,
    });
  }

  // Also seed artifacts so the Live Artifacts panel lights up immediately in demo mode
  rlArtifactsService.seedDemoArtifacts();
  const artifacts = rlArtifactsService.getArtifacts();
  if (wsHandler) {
    wsHandler.broadcastMessage({
      type: 'RL_ARTIFACTS_UPDATED',
      data: artifacts,
      timestamp: artifacts.last_updated,
    });
  }

  res.json({ success: true, data: sophisticatedDecision });
}));

// POST /api/rl/artifacts
// Called by RL sidecar when it writes to /deception/RL_ACTUATED.log or plants files.
// Body example:
// {
//   "log_content": "[2026-...] ACTION: plant_breadcrumb | ... \n [next line]...",
//   "files": {
//     "admin-password.txt": "admin:Winter2026! ...",
//     "db-credentials.json": "{...}"
//   }
// }
router.post('/artifacts', asyncHandler(async (req: Request, res: Response) => {
  const { log_content, files } = req.body;

  if (typeof log_content === 'string' || files) {
    rlArtifactsService.updateArtifacts(
      typeof log_content === 'string' ? log_content : '',
      files && typeof files === 'object' ? files : {}
    );

    const artifacts = rlArtifactsService.getArtifacts();

    if (wsHandler) {
      wsHandler.broadcastMessage({
        type: 'RL_ARTIFACTS_UPDATED',
        data: artifacts,
        timestamp: artifacts.last_updated,
      });
    }

    res.json({ success: true, message: 'Artifacts recorded' });
  } else {
    res.status(400).json({ success: false, message: 'log_content or files required' });
  }
}));

// GET /api/rl/artifacts - for dashboard initial load and polling
router.get('/artifacts', asyncHandler(async (_req: Request, res: Response) => {
  const artifacts = rlArtifactsService.getArtifacts();
  res.json({
    success: true,
    data: artifacts,
    timestamp: new Date().toISOString(),
  });
}));

// Demo: seed some artifacts (used by simulate-decision too)
router.post('/seed-artifacts', asyncHandler(async (_req: Request, res: Response) => {
  rlArtifactsService.seedDemoArtifacts();
  const artifacts = rlArtifactsService.getArtifacts();

  if (wsHandler) {
    wsHandler.broadcastMessage({
      type: 'RL_ARTIFACTS_UPDATED',
      data: artifacts,
      timestamp: artifacts.last_updated,
    });
  }

  res.json({ success: true, data: artifacts });
}));

export default router;
