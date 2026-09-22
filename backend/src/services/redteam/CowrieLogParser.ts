// services/redteam/CowrieLogParser.ts
//
// Parses Cowrie's JSON session log (cowrie.json, one JSON object per line --
// a stable, long-standing format) into structured sessions, then classifies
// every captured command through the SAME MitreAttackService Maya's own
// simulation engines use. This is what makes the Epic 4 comparison fair:
// both sides of the report get MITRE-tagged by identical logic, not two
// different classifiers.
//
// Log location inside the Cowrie container (per scripts/docker/docker-compose.yml):
//   /cowrie/cowrie-git/var/log/cowrie/cowrie.json
// Get it onto the machine running this parser with, e.g.:
//   docker cp cowrie-ssh:/cowrie/cowrie-git/var/log/cowrie/cowrie.json ./cowrie.json

import { readFileSync } from 'fs';
import { MitreAttackService } from '../MitreAttackService';

export interface CowrieLoginAttempt {
  username: string;
  password: string;
  success: boolean;
  timestamp: string;
}

export interface CowrieCommand {
  input: string;
  timestamp: string;
  technique?: string;
  techniqueName?: string;
  tactic?: string;
  tacticId?: string;
}

export interface CowrieSession {
  sessionId: string;
  srcIp?: string;
  connectTs?: string;
  closeTs?: string;
  durationSeconds?: number;
  logins: CowrieLoginAttempt[];
  commands: CowrieCommand[];
}

export interface CowrieParseSummary {
  sessions: CowrieSession[];
  totalSessions: number;
  totalLoginAttempts: number;
  successfulLogins: number;
  totalCommands: number;
  distinctTechniques: string[];
}

// Raw shape varies by event type; only the fields we use are typed.
interface CowrieRawEvent {
  eventid: string;
  session: string;
  timestamp: string;
  src_ip?: string;
  username?: string;
  password?: string;
  input?: string;
  duration?: number;
}

export class CowrieLogParser {
  private mitreService: MitreAttackService;

  constructor() {
    this.mitreService = new MitreAttackService();
  }

  /** Parses the raw JSON-lines file into per-session records, no MITRE classification yet. */
  parseFile(path: string): Map<string, CowrieSession> {
    const raw = readFileSync(path, 'utf-8');
    const sessions = new Map<string, CowrieSession>();

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let event: CowrieRawEvent;
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue; // Cowrie's log occasionally has non-JSON banner lines mixed in
      }

      if (!event.session) continue;

      let session = sessions.get(event.session);
      if (!session) {
        session = { sessionId: event.session, logins: [], commands: [] };
        sessions.set(event.session, session);
      }

      switch (event.eventid) {
        case 'cowrie.session.connect':
          session.srcIp = event.src_ip;
          session.connectTs = event.timestamp;
          break;
        case 'cowrie.login.failed':
          session.logins.push({
            username: event.username || '',
            password: event.password || '',
            success: false,
            timestamp: event.timestamp,
          });
          break;
        case 'cowrie.login.success':
          session.logins.push({
            username: event.username || '',
            password: event.password || '',
            success: true,
            timestamp: event.timestamp,
          });
          break;
        case 'cowrie.command.input':
          session.commands.push({ input: event.input || '', timestamp: event.timestamp });
          break;
        case 'cowrie.session.closed':
          session.closeTs = event.timestamp;
          session.durationSeconds = event.duration;
          break;
        default:
          break; // file_download/file_upload/etc. -- not needed for this comparison yet
      }
    }

    return sessions;
  }

  /** Parses + runs every captured command through MitreAttackService, same classifier Maya's simulations use. */
  async parseAndClassify(path: string): Promise<CowrieParseSummary> {
    const sessions = this.parseFile(path);
    const distinctTechniques = new Set<string>();
    let totalLoginAttempts = 0;
    let successfulLogins = 0;
    let totalCommands = 0;

    for (const session of sessions.values()) {
      totalLoginAttempts += session.logins.length;
      successfulLogins += session.logins.filter(l => l.success).length;
      totalCommands += session.commands.length;

      for (const command of session.commands) {
        const classification = await this.mitreService.classifyEvent(command.input);
        if (classification) {
          command.technique = classification.techniqueId;
          command.techniqueName = classification.techniqueName;
          command.tactic = classification.tactic;
          command.tacticId = classification.tacticId;
          distinctTechniques.add(classification.techniqueId);
        }
      }
    }

    return {
      sessions: Array.from(sessions.values()),
      totalSessions: sessions.size,
      totalLoginAttempts,
      successfulLogins,
      totalCommands,
      distinctTechniques: Array.from(distinctTechniques),
    };
  }
}
