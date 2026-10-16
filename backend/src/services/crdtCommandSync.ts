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

async function existingEventIds(ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const CHUNK = 1000;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const docs = await AttackEvent.find(
      { eventId: { $in: ids.slice(i, i + CHUNK) } },
      { eventId: 1, _id: 0 }
    ).lean();
    for (const doc of docs) found.add(doc.eventId);
  }
  return found;
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

    // Dwell time = first to last recorded command, in minutes (the unit
    // Attacker.dwellTime and the dashboard already use). Rounded up so a
    // short but real engagement doesn't read as "0m".
    let firstMs = Infinity;
    let lastMs = -Infinity;
    for (const r of records) {
      const t = new Date(r.wall_ts).getTime();
      if (Number.isNaN(t)) continue;
      if (t < firstMs) firstMs = t;
      if (t > lastMs) lastMs = t;
    }
    const hasTimes = Number.isFinite(firstMs) && Number.isFinite(lastMs);

    await Attacker.findOneAndUpdate(
      { attackerId },
      {
        $setOnInsert: {
          attackerId,
          ipAddress: ip,
          entryPoint: decoyName,
          firstSeen: hasTimes ? new Date(firstMs) : new Date(),
          platform,
        },
        $set: {
          lastSeen: new Date(),
          ...(hasTimes ? { dwellTime: Math.ceil((lastMs - firstMs) / 60000) } : {}),
          ...(tier ? { tier } : {}),
        },
      },
      { upsert: true }
    );

    // The GSet never shrinks, so every poll re-sees the full history --
    // checking which events already exist is what keeps re-polling
    // idempotent. Done in batches rather than one query per record, so a
    // large state costs a handful of queries per poll instead of tens of
    // thousands holding up the discovery loop.
    const eventIds = records.map(r => eventIdFor(ip, r));
    const existing = await existingEventIds(eventIds);

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const eventId = eventIds[i];
      if (existing.has(eventId)) continue;

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
