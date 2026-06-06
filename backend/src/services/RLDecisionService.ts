import { logger } from '../utils/logger';

// Simple in-memory store for recent RL decisions (hackathon-friendly, no Redis needed)
export interface RLDecision {
  timestamp: string;
  attacker_id: string;
  current_tier: string;
  action: 'maintain' | 'escalate_tier' | 'plant_breadcrumb' | 'observe_only';
  confidence: number;
  rationale: string;
  features: Record<string, number>;
  observed_ttps: string[];
  predicted_reward_delta: number;
  estimated_value?: number;
}

const MAX_DECISIONS = 50;
let recentDecisions: RLDecision[] = [];

export class RLDecisionService {
  addDecision(decision: RLDecision) {
    recentDecisions.unshift(decision);
    if (recentDecisions.length > MAX_DECISIONS) {
      recentDecisions = recentDecisions.slice(0, MAX_DECISIONS);
    }
    logger.info(`RL Decision stored: ${decision.action} for ${decision.attacker_id} (conf=${decision.confidence})`);
  }

  getRecentDecisions(limit: number = 10): RLDecision[] {
    return recentDecisions.slice(0, limit);
  }

  getLatestDecision(): RLDecision | null {
    return recentDecisions[0] || null;
  }

  // For demo: average confidence over last N decisions as proxy for "reward curve"
  getAverageConfidence(window: number = 10): number {
    const slice = recentDecisions.slice(0, window);
    if (slice.length === 0) return 0;
    const sum = slice.reduce((acc, d) => acc + d.confidence, 0);
    return Math.round((sum / slice.length) * 100) / 100;
  }

  clear() {
    recentDecisions = [];
  }
}

export const rlDecisionService = new RLDecisionService();
