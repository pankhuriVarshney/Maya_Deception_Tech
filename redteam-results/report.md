# Red-Team Battery Comparison Report

Generated: 2026-09-26T05:58:41.654Z

## What this measures

The identical attack battery (`scripts/redteam/run-battery.sh`) was run against
a Maya decoy (`jump-01`) and Cowrie. This is a comparison of each
system's own **independent** detection/logging, not of two synthetic self-reports.

**Important asymmetry**: Cowrie natively logs every command in full detail.
Maya's passive CRDT pipeline (real SSH activity -> syslogd-helper -> CRDTSyncService)
currently only surfaces aggregate counts (attackers/credentials/sessions seen), not
a per-command history -- the CRDT state's `actions_per_decoy` is a last-write-wins
map, so it retains only the most recent action per decoy, not a full log. This is a
real architectural gap, documented in docs/STATUS.md, not a limitation of this report.

## Attack battery (ground truth)

- Failed login attempts sent: 16
- Post-auth commands sent: 9
- MITRE techniques represented in the battery itself: T1033, T1082, T1049

## Cowrie (independently detected)

- Sessions logged: 26
- Login attempts logged: 52 (26 successful)
- Commands logged: 26
- Distinct MITRE techniques detected: 3 (T1082, T1033, T1049)
- Time from first brute-force attempt to first logged session: -222850519ms

## Maya `jump-01` (independently detected)

- Current CRDT-observed attacker count: 0
- Current CRDT-observed credential count: 0
- Current CRDT-observed session count: 0
- Attacker count delta during battery: +0
- Credential count delta during battery: +0
- Per-command MITRE technique detection: not available (see asymmetry note above).
- Lateral movement tracking: not applicable to this single-decoy battery, but is a
  Maya-only capability with no Cowrie equivalent -- Cowrie is a standalone honeypot,
  not a networked fabric an attacker can pivot across.

## Comparison summary

| Metric | Cowrie | Maya |
|---|---|---|
| Sessions/attackers detected | 26 | 0 |
| Credentials captured | 26 | 0 |
| Commands logged (granular) | 26 | not captured (see asymmetry note) |
| MITRE techniques independently detected | 3 | not measurable at command granularity yet |
| Lateral movement across nodes | n/a (single host) | supported (not exercised by this single-target battery) |
| False positives | 0 (no legitimate users) | 0 (no legitimate users) |

For a MITRE-tagged, dashboard-visible narrative on the Maya side (at the cost of
it being simulated rather than passively detected), use the dashboard's "Run
Simulation" feature against the same decoy and re-check `/api/dashboard/attacker/:id`.