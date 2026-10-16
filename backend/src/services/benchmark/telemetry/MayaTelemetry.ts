import { AttackEvent, VMStatus } from '../../../models';
import { matchEvents } from '../matching';
import { sleep } from '../SshRunner';
import { AttackerRecord, BenchmarkTarget, ObservedEvent, TelemetryObservation } from '../types';

const POLL_MS = 3000;
// Events reach Mongo in bursts (30 s daemon cycle, then a 15 s backend poll), so
// "nothing new for 50 s" after the first events arrived means the rest isn't coming.
const STALL_MS = 50000;

/** Total sessions the decoy's CRDT state reports (a growing set, so we take a delta). */
export async function mayaSessionCount(decoyName: string): Promise<number | null> {
  const vm = await VMStatus.findOne({ vmName: decoyName }).lean();
  const sessions = vm?.crdtState?.sessions;
  return typeof sessions === 'number' ? sessions : null;
}

/**
 * Maya's telemetry reaches Mongo asynchronously (30 s daemon cycle + 15 s
 * backend poll), so after the attack we poll until every command we sent has
 * a recorded event, or the settle window runs out. `createdAt` is when the
 * backend stored the event, which is what makes detection latency measurable.
 */
export async function collectMayaTelemetry(
  target: BenchmarkTarget,
  record: AttackerRecord,
  sessionsBefore: number | null,
  settleSeconds: number
): Promise<TelemetryObservation> {
  const decoy = target.decoyName ?? 'jump-01';
  const since = new Date(record.startedAt - 2000);
  const deadline = Date.now() + settleSeconds * 1000;

  let events: ObservedEvent[] = [];
  let sessionsDelta: number | null = null;
  let lastMatched = 0;
  let lastProgressAt = Date.now();

  for (;;) {
    const docs = await AttackEvent.find({
      targetHost: decoy,
      type: 'Command Execution',
      createdAt: { $gte: since },
    })
      .sort({ createdAt: 1 })
      .lean();

    events = docs.map(d => ({
      command: d.command ?? d.description,
      observedAt: d.createdAt ? new Date(d.createdAt).getTime() : Date.now(),
      eventTime: d.timestamp ? new Date(d.timestamp).getTime() : null,
      technique: d.technique ?? '',
      confidence: typeof d.mitreConfidence === 'number' ? d.mitreConfidence : 0,
      dangerous: d.severity === 'Critical',
      srcIp: d.sourceHost ?? '',
    }));

    const sessionsNow = await mayaSessionCount(decoy);
    sessionsDelta = sessionsBefore !== null && sessionsNow !== null ? sessionsNow - sessionsBefore : null;

    const matched = matchEvents(record.commands, events).filter(m => m.event).length;
    const sessionsDone = sessionsDelta === null || sessionsDelta >= record.connectionsAuthenticated;
    if (matched > lastMatched) {
      lastMatched = matched;
      lastProgressAt = Date.now();
    }
    const stalled = lastMatched > 0 && Date.now() - lastProgressAt > STALL_MS;
    if ((matched >= record.commands.length && sessionsDone) || stalled || Date.now() >= deadline) break;
    await sleep(POLL_MS);
  }

  const times = events.map(e => e.eventTime).filter((t): t is number => t !== null);
  return {
    available: true,
    note: `AttackEvents for decoy ${decoy} stored since the run started; sessions from the decoy's CRDT state`,
    events,
    // Maya records successful sessions only: failed logins never reach the wrapper.
    loginsRecorded: sessionsDelta,
    sessionsObserved: sessionsDelta,
    sourceIps: Array.from(new Set(events.map(e => e.srcIp).filter(Boolean))),
    firstEventAt: times.length ? Math.min(...times) : null,
    lastEventAt: times.length ? Math.max(...times) : null,
    postHocClassification: false,
  };
}
