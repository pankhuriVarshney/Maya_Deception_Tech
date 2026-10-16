import { CommandResult, ObservedEvent } from './types';

export interface MatchResult {
  commandIndex: number;
  event: ObservedEvent | null;
}

// A defender's timestamp can be truncated to the second (Maya), so allow a
// little slack before the send time and the command's own runtime after it.
const WINDOW_BEFORE_MS = 2000;
const WINDOW_AFTER_MS = 4000;

/**
 * Pair each command we sent with the defender event that recorded it. Events
 * are claimed at most once, in send order, so repeated commands (the same
 * `uname -a` appears as both a probe and a discovery step) pair up correctly.
 */
export function matchEvents(commands: CommandResult[], events: ObservedEvent[]): MatchResult[] {
  const claimed = new Set<number>();
  const ordered = [...commands].sort((a, b) => a.sentAt - b.sentAt);

  return ordered.map(cmd => {
    let best = -1;
    for (let i = 0; i < events.length; i++) {
      if (claimed.has(i)) continue;
      const ev = events[i];
      if (ev.command.trim() !== cmd.command.trim()) continue;

      if (ev.eventTime !== null) {
        if (ev.eventTime < cmd.sentAt - WINDOW_BEFORE_MS) continue;
        if (ev.eventTime > cmd.sentAt + cmd.durationMs + WINDOW_AFTER_MS) continue;
      } else if (ev.observedAt < cmd.sentAt) {
        continue;
      }

      if (best === -1 || ev.observedAt < events[best].observedAt) best = i;
    }
    if (best >= 0) claimed.add(best);
    return { commandIndex: cmd.index, event: best >= 0 ? events[best] : null };
  });
}
