import * as fs from 'fs';
import { assessCommandRisk } from '../../../utils/commandPatterns';
import { MitreAttackService } from '../../MitreAttackService';
import { matchEvents } from '../matching';
import { sleep } from '../SshRunner';
import { AttackerRecord, ObservedEvent, TelemetryObservation } from '../types';

interface CowrieLine {
  eventid?: string;
  timestamp?: string;
  src_ip?: string;
  input?: string;
  session?: string;
}

/** Cowrie timestamps are ISO strings; anything unparseable becomes null, never NaN. */
function parseTime(ts: string | undefined): number | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  return Number.isNaN(t) ? null : t;
}

interface TailedLine {
  line: CowrieLine;
  observedAt: number;
}

const mitre = new MitreAttackService();
const POLL_MS = 250;
const MAX_SETTLE_SECONDS = 20;

/**
 * Follows cowrie.json from wherever it ends when the run starts, stamping
 * each line with the moment we first saw it (Cowrie writes as it happens, so
 * that is a fair measure of its detection latency).
 */
export class CowrieTail {
  private offset = 0;
  private partial = '';
  private timer?: NodeJS.Timeout;
  private busy = false;
  readonly lines: TailedLine[] = [];

  constructor(private readonly path: string) {}

  async start(): Promise<void> {
    try {
      this.offset = (await fs.promises.stat(this.path)).size;
    } catch {
      this.offset = 0;
    }
    this.timer = setInterval(() => {
      void this.poll();
    }, POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const size = (await fs.promises.stat(this.path)).size;
      if (size < this.offset) this.offset = 0;
      if (size === this.offset) return;

      const handle = await fs.promises.open(this.path, 'r');
      try {
        const len = size - this.offset;
        const buf = Buffer.alloc(len);
        await handle.read(buf, 0, len, this.offset);
        this.offset = size;
        this.partial += buf.toString('utf8');
      } finally {
        await handle.close();
      }

      const parts = this.partial.split('\n');
      this.partial = parts.pop() ?? '';
      const observedAt = Date.now();
      for (const raw of parts) {
        if (!raw.trim()) continue;
        try {
          this.lines.push({ line: JSON.parse(raw) as CowrieLine, observedAt });
        } catch {
          // A line cut off mid-write; the next poll will not see it again, so skip it.
        }
      }
    } catch {
      // File not there yet (Cowrie hasn't logged anything) -- try again next tick.
    } finally {
      this.busy = false;
    }
  }
}

function commandEvents(tail: CowrieTail, srcIp: string | null): ObservedEvent[] {
  return tail.lines
    .filter(t => t.line.eventid === 'cowrie.command.input' && typeof t.line.input === 'string')
    .filter(t => !srcIp || t.line.src_ip === undefined || t.line.src_ip === srcIp)
    .map(t => ({
      command: t.line.input as string,
      observedAt: t.observedAt,
      eventTime: parseTime(t.line.timestamp),
      technique: '',
      confidence: 0,
      dangerous: false,
      srcIp: t.line.src_ip ?? '',
    }));
}

export async function collectCowrieTelemetry(
  tail: CowrieTail,
  record: AttackerRecord,
  settleSeconds: number
): Promise<TelemetryObservation> {
  const deadline = Date.now() + Math.min(settleSeconds, MAX_SETTLE_SECONDS) * 1000;
  for (;;) {
    const matched = matchEvents(record.commands, commandEvents(tail, record.localAddress)).filter(m => m.event).length;
    if (matched >= record.commands.length || Date.now() >= deadline) break;
    await sleep(500);
  }
  tail.stop();

  const srcIp = record.localAddress;
  const mine = tail.lines.filter(t => !srcIp || t.line.src_ip === undefined || t.line.src_ip === srcIp);
  const byId = (id: string) => mine.filter(t => t.line.eventid === id);

  // Cowrie records raw commands only; MITRE and danger come from running the
  // same classifier Maya uses over them, so the comparison is like for like.
  const events: ObservedEvent[] = [];
  for (const ev of commandEvents(tail, srcIp)) {
    const c = await mitre.classifyEvent(ev.command);
    events.push({
      ...ev,
      technique: c.techniqueId,
      confidence: c.confidence,
      dangerous: assessCommandRisk(ev.command).dangerous,
    });
  }

  const stamp = (t: TailedLine): number | null => parseTime(t.line.timestamp);
  const connects = byId('cowrie.session.connect');
  const closes = byId('cowrie.session.closed');
  const starts = [...connects, ...byId('cowrie.command.input')].map(stamp).filter((v): v is number => v !== null);
  const ends = [...closes, ...byId('cowrie.command.input')].map(stamp).filter((v): v is number => v !== null);

  return {
    available: true,
    note: 'cowrie.json lines from this source IP since the run started; MITRE and danger computed by Maya\'s classifier',
    events,
    loginsRecorded: byId('cowrie.login.success').length + byId('cowrie.login.failed').length,
    // A session is a connection that got as far as logging in. Counting every
    // connect would include the recon port probes and any failed logins.
    sessionsObserved: new Set(byId('cowrie.login.success').map(t => t.line.session ?? `${t.observedAt}`)).size,
    sourceIps: Array.from(new Set(connects.map(t => t.line.src_ip).filter((v): v is string => !!v))),
    firstEventAt: starts.length ? Math.min(...starts) : null,
    lastEventAt: ends.length ? Math.max(...ends) : null,
    postHocClassification: true,
  };
}
