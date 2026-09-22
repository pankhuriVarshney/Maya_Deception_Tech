// scripts/redteamReport.ts
//
// Epic 4 Task 5: builds the Maya-vs-Cowrie comparison report from a
// completed run-battery.sh pass against both targets.
//
// This is deliberately honest about what each side's data actually
// represents -- see docs/STATUS.md / the Epic 4 write-up for why Maya's
// passive-detection numbers are aggregate counts, not per-command detail,
// while Cowrie's are full session logs. Faking a like-for-like table would
// be worse than reporting the real asymmetry.
//
// Usage:
//   npx ts-node scripts/redteamReport.ts \
//     --battery-log ../redteam-results/maya-jump-01-battery.jsonl \
//     --cowrie-log /path/to/cowrie.json \
//     --maya-vm jump-01 \
//     [--maya-before /path/to/before-vmstatus.json] \
//     [--out ../redteam-results/comparison-report.md]
//
// --maya-before is a JSON snapshot of the VM's VMStatus document captured
// BEFORE the battery ran (e.g. `curl http://localhost:3001/api/vms | \
// jq '.vms[] | select(.name=="jump-01")' > before.json`) -- without it,
// the report shows current counts only, no before/after delta.

import mongoose from 'mongoose';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { VMStatus } from '../src/models';
import { CowrieLogParser } from '../src/services/redteam/CowrieLogParser';
import { MitreAttackService } from '../src/services/MitreAttackService';

interface BatteryAction {
  ts: string;
  label: string;
  phase: string;
  action: string;
  result: string;
}

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    args[key] = argv[i + 1];
  }
  return args;
}

function readBatteryLog(path: string): BatteryAction[] {
  const raw = readFileSync(path, 'utf-8');
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as BatteryAction);
}

async function classifyBatteryCommands(actions: BatteryAction[], mitre: MitreAttackService) {
  const commandActions = actions.filter(a => a.phase === 'postauth' && a.action.startsWith('command:') && a.result === 'sent');
  const techniques = new Set<string>();

  for (const a of commandActions) {
    const cmd = a.action.replace(/^command:/, '');
    const classification = await mitre.classifyEvent(cmd);
    if (classification) techniques.add(classification.techniqueId);
  }

  return { commandsAttempted: commandActions.length, techniquesAttempted: Array.from(techniques) };
}

async function main() {
  const args = parseArgs();
  if (!args['battery-log'] || !args['cowrie-log'] || !args['maya-vm']) {
    console.error('Usage: ts-node redteamReport.ts --battery-log <path> --cowrie-log <path> --maya-vm <name> [--maya-before <path>] [--out <path>]');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/maya_deception');

  const mitre = new MitreAttackService();
  const battery = readBatteryLog(args['battery-log']);
  const batteryClassification = await classifyBatteryCommands(battery, mitre);

  const cowrieParser = new CowrieLogParser();
  const cowrie = await cowrieParser.parseAndClassify(args['cowrie-log']);

  const mayaAfter = await VMStatus.findOne({ vmName: args['maya-vm'] }).lean();
  let mayaBefore: { crdtState?: { attackers: number; credentials: number; sessions: number } } | null = null;
  if (args['maya-before'] && existsSync(args['maya-before'])) {
    mayaBefore = JSON.parse(readFileSync(args['maya-before'], 'utf-8'));
  }

  const failedLogins = battery.filter(a => a.phase === 'bruteforce' && a.action.startsWith('ssh_login_attempt') && a.result === 'failed_as_expected').length;

  const bruteforceStart = battery.find(a => a.phase === 'bruteforce')?.ts;
  const bruteforceEnd = [...battery].reverse().find(a => a.phase === 'bruteforce')?.ts;

  const cowrieFirstDetect = cowrie.sessions[0]?.connectTs;
  const cowrieDetectionLatencyMs = bruteforceStart && cowrieFirstDetect
    ? new Date(cowrieFirstDetect).getTime() - new Date(bruteforceStart).getTime()
    : null;

  const mayaAttackerDelta = mayaBefore?.crdtState && mayaAfter?.crdtState
    ? mayaAfter.crdtState.attackers - mayaBefore.crdtState.attackers
    : null;
  const mayaCredentialDelta = mayaBefore?.crdtState && mayaAfter?.crdtState
    ? mayaAfter.crdtState.credentials - mayaBefore.crdtState.credentials
    : null;

  const lines: string[] = [];
  lines.push('# Red-Team Battery Comparison Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## What this measures');
  lines.push('');
  lines.push('The identical attack battery (`scripts/redteam/run-battery.sh`) was run against');
  lines.push(`a Maya decoy (\`${args['maya-vm']}\`) and Cowrie. This is a comparison of each`);
  lines.push('system\'s own **independent** detection/logging, not of two synthetic self-reports.');
  lines.push('');
  lines.push('**Important asymmetry**: Cowrie natively logs every command in full detail.');
  lines.push('Maya\'s passive CRDT pipeline (real SSH activity -> syslogd-helper -> CRDTSyncService)');
  lines.push('currently only surfaces aggregate counts (attackers/credentials/sessions seen), not');
  lines.push('a per-command history -- the CRDT state\'s `actions_per_decoy` is a last-write-wins');
  lines.push('map, so it retains only the most recent action per decoy, not a full log. This is a');
  lines.push('real architectural gap, documented in docs/STATUS.md, not a limitation of this report.');
  lines.push('');
  lines.push('## Attack battery (ground truth)');
  lines.push('');
  lines.push(`- Failed login attempts sent: ${failedLogins}`);
  lines.push(`- Post-auth commands sent: ${batteryClassification.commandsAttempted}`);
  lines.push(`- MITRE techniques represented in the battery itself: ${batteryClassification.techniquesAttempted.join(', ') || 'none classified'}`);
  lines.push('');
  lines.push('## Cowrie (independently detected)');
  lines.push('');
  lines.push(`- Sessions logged: ${cowrie.totalSessions}`);
  lines.push(`- Login attempts logged: ${cowrie.totalLoginAttempts} (${cowrie.successfulLogins} successful)`);
  lines.push(`- Commands logged: ${cowrie.totalCommands}`);
  lines.push(`- Distinct MITRE techniques detected: ${cowrie.distinctTechniques.length} (${cowrie.distinctTechniques.join(', ') || 'none'})`);
  if (cowrieDetectionLatencyMs !== null) {
    lines.push(`- Time from first brute-force attempt to first logged session: ${cowrieDetectionLatencyMs}ms`);
  }
  const closedSessions = cowrie.sessions.filter(s => s.durationSeconds !== undefined);
  if (closedSessions.length > 0) {
    const avgDuration = closedSessions.reduce((sum, s) => sum + (s.durationSeconds || 0), 0) / closedSessions.length;
    lines.push(`- Average session duration (dwell time): ${avgDuration.toFixed(1)}s`);
  }
  lines.push('');
  lines.push(`## Maya \`${args['maya-vm']}\` (independently detected)`);
  lines.push('');
  if (mayaAfter?.crdtState) {
    lines.push(`- Current CRDT-observed attacker count: ${mayaAfter.crdtState.attackers}`);
    lines.push(`- Current CRDT-observed credential count: ${mayaAfter.crdtState.credentials}`);
    lines.push(`- Current CRDT-observed session count: ${mayaAfter.crdtState.sessions}`);
  } else {
    lines.push('- No VMStatus record found for this VM -- was CRDT sync running during the battery?');
  }
  if (mayaAttackerDelta !== null) {
    lines.push(`- Attacker count delta during battery: ${mayaAttackerDelta >= 0 ? '+' : ''}${mayaAttackerDelta}`);
    lines.push(`- Credential count delta during battery: ${mayaCredentialDelta! >= 0 ? '+' : ''}${mayaCredentialDelta}`);
  } else {
    lines.push('- No --maya-before snapshot supplied, so no before/after delta is available (only current totals above).');
  }
  lines.push('- Per-command MITRE technique detection: not available (see asymmetry note above).');
  lines.push('- Lateral movement tracking: not applicable to this single-decoy battery, but is a');
  lines.push('  Maya-only capability with no Cowrie equivalent -- Cowrie is a standalone honeypot,');
  lines.push('  not a networked fabric an attacker can pivot across.');
  lines.push('');
  lines.push('## Comparison summary');
  lines.push('');
  lines.push('| Metric | Cowrie | Maya |');
  lines.push('|---|---|---|');
  lines.push(`| Sessions/attackers detected | ${cowrie.totalSessions} | ${mayaAfter?.crdtState?.attackers ?? 'n/a'} |`);
  lines.push(`| Credentials captured | ${cowrie.successfulLogins} | ${mayaAfter?.crdtState?.credentials ?? 'n/a'} |`);
  lines.push(`| Commands logged (granular) | ${cowrie.totalCommands} | not captured (see asymmetry note) |`);
  lines.push(`| MITRE techniques independently detected | ${cowrie.distinctTechniques.length} | not measurable at command granularity yet |`);
  lines.push('| Lateral movement across nodes | n/a (single host) | supported (not exercised by this single-target battery) |');
  lines.push('| False positives | 0 (no legitimate users) | 0 (no legitimate users) |');
  lines.push('');
  lines.push('For a MITRE-tagged, dashboard-visible narrative on the Maya side (at the cost of');
  lines.push('it being simulated rather than passively detected), use the dashboard\'s "Run');
  lines.push('Simulation" feature against the same decoy and re-check `/api/dashboard/attacker/:id`.');

  const report = lines.join('\n');
  console.log(report);

  if (args['out']) {
    writeFileSync(args['out'], report, 'utf-8');
    console.log(`\nWritten to ${args['out']}`);
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Report generation failed:', err);
  process.exit(1);
});
