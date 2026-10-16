import { matchEvents } from './matching';
import { AttackerRecord, MetricValues, ObservedEvent, TargetRepResult, TelemetryObservation } from './types';

// MITRE classifier returns this as the "I found nothing" confidence.
const FALLBACK_CONFIDENCE = 0.3;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

/**
 * Turn one attack run plus what the defender recorded into metric values.
 * `null` means "not exercised / not applicable" (excluded from scoring);
 * 0 means "measured, and the system did nothing" (scored as a loss).
 */
export function computeMetrics(record: AttackerRecord, obs: TelemetryObservation): MetricValues {
  const sent = record.commands;
  const blind = !obs.available;
  const matches = blind ? [] : matchEvents(sent, obs.events);

  const byCommand = new Map<number, ObservedEvent>();
  for (const m of matches) if (m.event) byCommand.set(m.commandIndex, m.event);

  const labeled = sent.filter(c => c.labeled);
  const dangerous = labeled.filter(c => c.dangerous);

  // When the defender records nothing, "how much did it catch" is 0, not N/A.
  const zeroIfBlind = (v: number | null): number | null => (blind && v === null ? 0 : v);

  const A1 = blind ? (sent.length > 0 ? 0 : null) : ratio(byCommand.size, sent.length);

  let A2: number | null;
  if (blind) A2 = record.connectionsAuthenticated > 0 ? 0 : null;
  else if (obs.sessionsObserved === null || record.connectionsAuthenticated === 0) A2 = null;
  else {
    const real = record.connectionsAuthenticated;
    A2 = Math.max(0, 1 - Math.abs(obs.sessionsObserved - real) / real);
  }

  let A4: number | null;
  if (blind) A4 = record.authAttemptsSent > 0 ? 0 : null;
  else if (obs.loginsRecorded === null || record.authAttemptsSent === 0) A4 = null;
  else A4 = Math.min(1, obs.loginsRecorded / record.authAttemptsSent);

  const latencies: number[] = [];
  for (const cmd of sent) {
    const ev = byCommand.get(cmd.index);
    if (ev) latencies.push(Math.max(0, ev.observedAt - cmd.sentAt));
  }
  const A5 = blind ? null : median(latencies);

  let A7: number | null;
  if (blind) A7 = 0;
  else if (!record.localAddress) A7 = null;
  else A7 = obs.sourceIps.includes(record.localAddress) ? 1 : 0;

  const labeledMatched = labeled.filter(c => byCommand.has(c.index));
  const B1 = zeroIfBlind(
    ratio(labeledMatched.filter(c => byCommand.get(c.index)!.technique === c.expectedTechnique).length, labeled.length)
  );
  const B1c = zeroIfBlind(
    ratio(
      labeledMatched.filter(c => {
        const ev = byCommand.get(c.index)!;
        return ev.technique !== '' && ev.confidence > FALLBACK_CONFIDENCE + 0.01;
      }).length,
      labeled.length
    )
  );

  const B3 = zeroIfBlind(ratio(dangerous.filter(c => byCommand.get(c.index)?.dangerous === true).length, dangerous.length));

  const benignMatched = sent.filter(c => !c.dangerous && byCommand.has(c.index));
  const B3f = blind
    ? null
    : ratio(benignMatched.filter(c => byCommand.get(c.index)!.dangerous).length, benignMatched.length);

  const C1 =
    record.engagedFrom !== null && record.engagedUntil !== null
      ? Math.max(0, (record.engagedUntil - record.engagedFrom) / 1000)
      : 0;
  const C1d =
    obs.firstEventAt !== null && obs.lastEventAt !== null ? Math.max(0, (obs.lastEventAt - obs.firstEventAt) / 1000) : null;

  const C2 = labeled.length;

  const tells = record.probes.filter(p => p.kind === 'tell');
  const fidelity = record.probes.filter(p => p.kind === 'fidelity');
  const C3 = ratio(tells.filter(p => !p.failed).length, tells.length);
  const C4 = ratio(fidelity.filter(p => !p.failed).length, fidelity.length);

  const monitoring = record.probes.find(p => p.id === 'P9');
  const C5 = monitoring ? monitoring.artifacts ?? 0 : null;

  return { A1, A2, A4, A5, A7, B1, B1c, B3, B3f, C1, C1d, C2, C3, C4, C5 };
}

export interface Aggregate {
  median: number | null;
  min: number | null;
  max: number | null;
  n: number;
}

/** Median / min / max of each metric across repetitions, ignoring nulls. */
export function aggregateRepetitions(reps: TargetRepResult[]): Record<string, Aggregate> {
  const ids = new Set<string>();
  for (const r of reps) for (const id of Object.keys(r.metrics)) ids.add(id);

  const out: Record<string, Aggregate> = {};
  ids.forEach(id => {
    const vals = reps.map(r => r.metrics[id]).filter((v): v is number => typeof v === 'number');
    out[id] = {
      median: median(vals),
      min: vals.length ? Math.min(...vals) : null,
      max: vals.length ? Math.max(...vals) : null,
      n: vals.length,
    };
  });
  return out;
}
