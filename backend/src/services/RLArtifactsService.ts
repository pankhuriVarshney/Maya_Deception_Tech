import { logger } from '../utils/logger';

export interface RLArtifacts {
  last_log_lines: string[];  // last 10 lines of RL_ACTUATED.log
  files: Record<string, string>;  // filename -> content
  last_updated: string;
}

const MAX_LOG_LINES = 10;
let currentArtifacts: RLArtifacts = {
  last_log_lines: [],
  files: {},
  last_updated: new Date().toISOString(),
};

export class RLArtifactsService {
  updateArtifacts(logContent: string, files: Record<string, string>) {
    const lines = logContent.split('\n').filter(l => l.trim()).slice(-MAX_LOG_LINES);
    
    currentArtifacts = {
      last_log_lines: lines,
      files: { ...currentArtifacts.files, ...files },
      last_updated: new Date().toISOString(),
    };

    logger.info(`RL Artifacts updated: ${Object.keys(files).length} files, ${lines.length} log lines`);
  }

  getArtifacts(): RLArtifacts {
    return { ...currentArtifacts };
  }

  // For demo / simulate
  seedDemoArtifacts() {
    const demoLog = [
      '[2026-06-06 14:20:11] ACTION: plant_breadcrumb | CONFIDENCE: 78% | RATIONALE: Recon + lateral movement observed. Planting credentials.',
      '[2026-06-06 14:22:33] ACTION: escalate_tier | CONFIDENCE: 85% | RATIONALE: High privilege escalation signals. Moving to Kata tier.',
      '[2026-06-06 14:25:31] ACTION: plant_breadcrumb | CONFIDENCE: 89% | RATIONALE: High recon + priv esc detected. Planting admin creds to prolong engagement.',
    ];

    const demoFiles: Record<string, string> = {
      'admin-password.txt': 'admin:Winter2026!\nroot:RLDeception2026!\nsvc_account:SuperSecretPass123!@#',
      'internal-secret.key': '-----BEGIN FAKE PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7...\n(RL-planted internal signing key)\n-----END FAKE PRIVATE KEY-----',
      'db-credentials.json': JSON.stringify({
        host: "db.internal.maya-deception",
        port: 5432,
        user: "readonly",
        password: "RL-planted-2026",
        database: "production",
        note: "Discovered via RL breadcrumb"
      }, null, 2),
      'fake-api-key.txt': 'API_KEY=sk_live_maya_rl_2026_abc123def456ghi789jkl0\nSERVICE_TOKEN=RLDeceptionToken2026'
    };

    currentArtifacts = {
      last_log_lines: demoLog,
      files: demoFiles,
      last_updated: new Date().toISOString(),
    };
  }

  clear() {
    currentArtifacts = {
      last_log_lines: [],
      files: {},
      last_updated: new Date().toISOString(),
    };
  }
}

export const rlArtifactsService = new RLArtifactsService();
