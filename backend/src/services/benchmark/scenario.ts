import { ScenarioCommand, Stage } from './types';

// The one attack every target gets. Nothing here is destructive: the
// "dangerous" commands are the kind an analyst should flag, but they either
// only read (cat /etc/shadow fails for a non-root user), only touch the
// session's own shell history, or only encode a file that's already readable.

export const RECON_PORTS = [21, 22, 23, 80, 443, 2222, 3306, 6379];

export const WRONG_PASSWORDS = ['123456', 'password', 'admin', 'letmein'];

export const ATTACK_USER = 'admin';

/** Commands run after the honeypot-detection probes, in kill-chain order. */
export const SCENARIO_COMMANDS: ScenarioCommand[] = [
  { command: 'whoami', stage: 'discovery', expectedTechnique: 'T1033', dangerous: false, labeled: true },
  { command: 'id', stage: 'discovery', expectedTechnique: 'T1033', dangerous: false, labeled: true },
  { command: 'uname -a', stage: 'discovery', expectedTechnique: 'T1082', dangerous: false, labeled: true },
  { command: 'ps aux', stage: 'discovery', expectedTechnique: 'T1057', dangerous: false, labeled: true },
  { command: 'netstat -tulpn || ss -tulpn', stage: 'discovery', expectedTechnique: 'T1049', dangerous: false, labeled: true },
  { command: 'cat /etc/hosts', stage: 'discovery', expectedTechnique: 'T1016', dangerous: false, labeled: true },
  { command: 'ls -la /', stage: 'discovery', expectedTechnique: 'T1083', dangerous: false, labeled: true },
  { command: 'cat /etc/passwd', stage: 'credential_access', expectedTechnique: 'T1087.001', dangerous: false, labeled: true },
  { command: 'cat /etc/shadow', stage: 'credential_access', expectedTechnique: 'T1003.008', dangerous: true, labeled: true },
  { command: "find / -maxdepth 2 -name '*.conf' 2>/dev/null", stage: 'collection', expectedTechnique: 'T1083', dangerous: false, labeled: true },
  { command: 'cat /etc/passwd | base64 | head -c 2000', stage: 'exfiltration', expectedTechnique: 'T1132.001', dangerous: true, labeled: true },
  { command: 'history -c', stage: 'defense_evasion', expectedTechnique: 'T1070.003', dangerous: true, labeled: true },
];

export const STAGE_LABELS: Record<Stage, string> = {
  recon: 'Recon',
  initial_access: 'Initial access',
  validation: 'Honeypot checks',
  discovery: 'Discovery',
  credential_access: 'Credential access',
  collection: 'Collection',
  exfiltration: 'Exfiltration',
  defense_evasion: 'Defense evasion',
};
