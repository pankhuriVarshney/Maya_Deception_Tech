// Shared by K8sDiscoveryService and CRDTSyncService (the K8s and Vagrant
// paths respectively) -- both already exec into a decoy/VM and parse the
// full `.syscache` JSON, but previously only kept three aggregate counts.
// This turns each attacker's real `actions_per_decoy` history (see
// scripts/crdt/src/lib.rs's ActionRecord) into the same Attacker/
// AttackEvent records the simulation engines already populate, so the
// existing dashboard (CommandActivity, MitreMatrix, AttackTimeline, etc.)
// shows real attacker commands with zero new frontend plumbing.
import { Attacker, AttackEvent } from '../models';
import { MitreAttackService } from './MitreAttackService';
import { assessCommandRisk } from '../utils/commandPatterns';
import { logger } from '../utils/logger';

const mitre = new MitreAttackService();

// AttackEvent.classificationMethod only allows these five values, but
// classifyCommand() (backend/src/utils/commandPatterns.ts) can also
// return 'database' -- clamp anything unrecognized rather than letting a
// real command silently fail Mongoose validation on save.
const ALLOWED_CLASSIFICATION_METHODS = new Set(['exact', 'fuzzy', 'pattern', 'manual', 'unknown']);

interface RawActionRecord {
  decoy: string;
  action: string;
  ts: number;
  wall_ts: string;
  node: string;
}

interface RawAttackerState {
  actions_per_decoy?: { elements?: RawActionRecord[] };
}

export interface RawMayaState {
  attackers?: Record<string, RawAttackerState>;
}

function attackerIdFor(ip: string): string {
  return `APT-${ip.replace(/\./g, '-')}`;
}

function eventIdFor(ip: string, record: RawActionRecord): string {
  return `crdt-${ip}-${record.decoy}-${record.ts}-${record.node}`;
}

export async function syncAttackerCommandsFromState(
  rawState: RawMayaState,
  decoyName: string,
  platform: 'k8s' | 'vagrant',
  tier?: string
): Promise<void> {
  const attackers = rawState.attackers || {};

  for (const [ip, attackerState] of Object.entries(attackers)) {
    const records = attackerState.actions_per_decoy?.elements || [];
    if (records.length === 0) continue;

    const attackerId = attackerIdFor(ip);

    await Attacker.findOneAndUpdate(
      { attackerId },
      {
        $setOnInsert: {
          attackerId,
          ipAddress: ip,
          entryPoint: decoyName,
          firstSeen: new Date(),
          platform,
        },
        $set: {
          lastSeen: new Date(),
          ...(tier ? { tier } : {}),
        },
      },
      { upsert: true }
    );

    for (const record of records) {
      const eventId = eventIdFor(ip, record);

      // The GSet never shrinks, so every poll re-sees the full history --
      // this check is what keeps re-polling idempotent.
      const alreadyRecorded = await AttackEvent.exists({ eventId });
      if (alreadyRecorded) continue;

      // Separately from the exact eventId check above: a single real SSH
      // connection can occasionally cause sshd to invoke ForceCommand
      // twice (an OpenSSH/sshpass negotiation quirk, not something this
      // service controls), producing two distinct ActionRecords -- same
      // attacker/decoy/command, a couple seconds apart, different Lamport
      // tick. Collapse those into one AttackEvent rather than showing a
      // duplicate command in the dashboard.
      const wallTs = new Date(record.wall_ts);
      const nearDuplicateWindowMs = 5000;
      const nearDuplicate = await AttackEvent.exists({
        attackerId,
        targetHost: record.decoy,
        command: record.action,
        timestamp: {
          $gte: new Date(wallTs.getTime() - nearDuplicateWindowMs),
          $lte: new Date(wallTs.getTime() + nearDuplicateWindowMs),
        },
      });
      if (nearDuplicate) continue;

      const classification = await mitre.classifyEvent(record.action);
      const risk = assessCommandRisk(record.action);
      const classificationMethod = ALLOWED_CLASSIFICATION_METHODS.has(classification.method)
        ? (classification.method as 'exact' | 'fuzzy' | 'pattern' | 'manual' | 'unknown')
        : 'unknown';

      try {
        await AttackEvent.create({
          eventId,
          timestamp: new Date(record.wall_ts),
          attackerId,
          type: 'Command Execution',
          description: record.action,
          sourceHost: ip,
          targetHost: record.decoy,
          command: record.action,
          severity: risk.severity,
          status: 'Detected',
          tactic: classification.tactic,
          tacticId: classification.tacticId,
          tacticName: classification.tacticName,
          technique: classification.techniqueId,
          techniqueName: classification.techniqueName,
          isSubtechnique: classification.isSubtechnique,
          mitreConfidence: classification.confidence,
          classificationMethod,
        });
      } catch (error) {
        // Duplicate-key races between overlapping poll cycles are
        // expected and harmless -- anything else is worth knowing about.
        if (!(error instanceof Error) || !error.message.includes('E11000')) {
          logger.error(`Failed to record real AttackEvent ${eventId}:`, error);
        }
      }
    }
  }
}
