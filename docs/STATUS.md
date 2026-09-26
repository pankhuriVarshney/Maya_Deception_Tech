# Project Status

Honest tracker of what's actually built vs. still pending, by epic. This
supersedes the submission-form language wherever the two disagree — see
[README.md](./README.md) for how this fits with the rest of the docs.

Nothing below has been run against a live cluster/VM fleet by the agent
that wrote this — "done" means implemented and reasoned through carefully,
not functionally verified end-to-end unless explicitly noted otherwise.

## Epic 0 — Retire the Go control-plane
✅ Done. `control-plane/` removed; `backend/` (Node/TS) is the control plane.

## Epic 1 — Stabilize the Vagrant/CRDT prototype
✅ Done. Peer-mesh CRDT sync fixed (real full-mesh `peers.conf` + daemon,
was gateway-only before), broken `observe`/`sync` subcommands fixed in
hook scripts, `CRDTSyncService.getCrdtState()` fixed to read the raw state
file instead of parsing `stats`'s human-readable output as JSON, and the
same `observe`/`sync` bug fixed at all 20 remaining call sites in
`RealSimulationService.ts` (14 `observe` → `action`, 6 dead `sync` calls
removed — continuous sync is the daemon's job, per the Epic 1 fix above).

## Epic 2 — Minimal Zero-Trust control plane (auth/RBAC)
⬜ **Not started.** `jsonwebtoken`/`bcryptjs` are installed but unused; no
auth middleware exists. Blocks the "Escalate to Vagrant" human-approval
action Epic 3 depends on.

## Epic 3 — RL-lite classifier + human-gated escalation
⬜ **Not started.** The tiering infrastructure (gVisor default → Kata
escalation → Vagrant final, human-approved) all exists and can run
decoys; nothing classifies attacker behavior or moves them between tiers
yet. This is the actual "brain" of the project's novel claim.

## Epic 4 — Red-team validation & metrics harness

| Task | Status |
|---|---|
| 1-2. Attack battery driver | ✅ Done: `scripts/redteam/run-battery.sh` — recon, brute force, authenticated post-command session, exfil simulation, identical against any SSH target, ground-truth JSONL log |
| 3. Cowrie stack verification | ✅ Done — runs on host port 2223 (2222 is the kind cluster's own SSH port); `docker compose -f scripts/docker/docker-compose.yml up -d cowrie` confirmed working |
| 4. Cowrie log parser + MITRE reclassification | ✅ Done: `backend/src/services/redteam/CowrieLogParser.ts` — parses `cowrie.json`, classifies every command through the same `MitreAttackService` Maya's own simulations use |
| 5. Metrics + comparison report | ✅ Done: `backend/scripts/redteamReport.ts` |
| 6. Fingerprint-probe script (stretch) | ⬜ Not started |

**Update — Epic 4 has now actually been run once, against a live kind
cluster's `jump-01` decoy and a real Cowrie container.** Result: Maya
showed **0 attackers / 0 credentials / 0 sessions** despite a real
successful SSH login + 9 post-auth commands + a simulated exfil having
just happened. Not "less detail than Cowrie" as originally assumed below
— the K8s decoy images never had *any* passive-detection hook wired in at
all (`maya-k8s/docker/jump/Dockerfile` never installed the Vagrant-era
`/etc/profile.d` audit hooks, and those hooks wouldn't have caught a
scripted `ssh host "cmd"` battery anyway — they only fire for interactive
login shells, see `docs/dev-notes/REAL_ATTACK_DETECTION_STATUS.md:56-60`).
Separately, the Cowrie side of that same run was contaminated — its
`cowrie.json` had 26 sessions/52 logins against a battery that only sent
17 (16 failed + 1 success), almost certainly opportunistic internet
scanners hitting the exposed port; restart the Cowrie container
immediately before each battery run to get a clean log.

**Fix applied** (`scripts/crdt/src/main.rs`, `maya-k8s/docker/{jump,ftp,redis,web}/`,
`maya-k8s/docker/common/`): each decoy's sshd now runs a `ForceCommand`
wrapper (`decoy-audit-wrapper.sh`) for its login user — unlike a
profile.d hook, this fires for *every* session, interactive or a single
scripted command, without exposing the CRDT binary or its logic inside
the attacker-reachable decoy container (that separation was a deliberate
security property, preserved here: the wrapper just appends plain JSON
lines to the shared volume; only the `crdt-sync` sidecar, which the
attacker can't see into, turns those into real CRDT state). sshd's own
Accepted/Failed-password log lines are now also captured on the same
shared volume, giving login-attempt and successful-credential detection
without any PAM/auditd dependency.

Still an honest, disclosed asymmetry vs. Cowrie, not a bug: real sshd
never exposes the attempted **password** on a failed login to userspace
(only Cowrie, a fake server, can do that), and `actions_per_decoy` is
still a last-write-wins map, so only the latest command per decoy
survives a merge, not a full per-command history. Both are called out in
the comparison report itself.

**Confirmed working** (2026-09-26, real kind cluster + real Cowrie
container, images rebuilt and rolled out): Maya's `jump-01` now shows
**1 attacker / 1 credential / 1 session** after the same battery that
previously produced 0/0/0. Cowrie's numbers on the same clean run: 26
sessions / 52 login attempts (26 successful) / 26 commands, latency
29721ms -- both sides now internally consistent (Cowrie's 26 comes from
`run-battery.sh` opening a separate SSH connection per command, 16
brute-force + 9 post-auth + 1 exfil = 26, combined with Cowrie's
accept-any-credential default; Maya's 1/1/1 correctly reflects that only
one attacker IP ever used the one real decoy credential). Repro:
```bash
docker restart cowrie-ssh   # clean log, avoids the contamination noted above
./scripts/redteam/run-battery.sh --target <maya-decoy-ip> --ssh-port <port> --label maya-jump-01 --known-user admin --known-pass 'fakejump01!'
./scripts/redteam/run-battery.sh --target 127.0.0.1 --ssh-port 2223 --label cowrie --known-user root --known-pass toor
docker cp cowrie-ssh:/cowrie/cowrie-git/var/log/cowrie/cowrie.json ./cowrie.json
sleep 35   # crdt-sync's daemon loop only polls the shared audit log every 30s
cd backend && npx ts-node scripts/redteamReport.ts --battery-log ../redteam-results/maya-jump-01-battery.jsonl --cowrie-log ../cowrie.json --maya-vm jump-01 --out ../redteam-results/report.md
```

**Update — both remaining gaps above are now fixed.**
`active_sessions` and `actions_per_decoy` are CRDT sets (`GSet`), not
last-write-wins maps (`scripts/crdt/src/lib.rs`) — session count is now
genuinely additive, and every real command survives a merge instead of
only the latest one per decoy. A new shared backend function,
`backend/src/services/crdtCommandSync.ts`, feeds that real per-command
history into the same `Attacker`/`AttackEvent` collections the simulation
engines already populate (classified via the existing
`MitreAttackService.classifyEvent`, idempotent against re-polling via a
deterministic `eventId`), called from both `K8sDiscoveryService` (K8s) and
`CRDTSyncService` (Vagrant) — so real attacker commands now show up in the
dashboard's Command Activity panel with a MITRE technique badge and a
"Dangerous" flag (`backend/src/utils/commandPatterns.ts`'s new
`assessCommandRisk()`), the same way simulated attacks always have. No
Mongo schema changes were needed — `AttackEvent` already had every field
this needed; `AttackerMapper.ts` was just silently discarding
`technique`/`techniqueName` before mapping to the frontend.

Not yet rebuilt/redeployed or run against a live cluster — same
rebuild → `kind load` → rollout restart → re-run-battery sequence as the
previous fix, plus a backend restart to pick up the new TypeScript.

## Epic 5 — Kubernetes as the default fabric (gVisor → Kata → Vagrant)

| Task | Status |
|---|---|
| 1. gVisor/kind foundation | ✅ Done, verified (22/22 checks passed on a real kind cluster) |
| 2. Kata/bare-metal foundation | 🟡 Scripts reviewed, two real bugs fixed (missing shared-config apply, wrong Kata version assumption checked and confirmed correct). Still blocked on a bare-metal host with `/dev/kvm` — never run end-to-end |
| 3. Traffic entry (Ingress/NodePort) | ✅ Done: nginx Ingress for web-03 (HTTP), fixed NodePorts for jump/redis/ftp, kind cluster config maps the needed host ports. Not yet verified against a live cluster |
| 4. Decoy variety (FTP) | ✅ Done: FTP decoy added (vsftpd + real CRDT binary), RDP/SMB documented as intentionally Vagrant-only in `maya-k8s/README.md` |
| 5. lifecycle-manager round-out | ✅ Done: `/status` endpoint added, real buildable `:dev` image (was a placeholder `ghcr.io/Maya/...` reference that was never built), plus a real bug fix — `knownDecoyTypes` mapped to Deployment names with a `fake-` prefix that doesn't exist in the actual manifests, so every provision/terminate/scale call was 404ing |
| 6. Backend/dashboard visibility | ✅ Done: K8s discovery + CRDT polling (`K8sDiscoveryService`) feeding the same `VMStatus`/`Attacker` collections Vagrant uses; all 6 attack scenarios ported to K8s (`K8sSimulationService`); tier (gVisor/Kata/Vagrant) now displayed on both the Infrastructure and Attacker dashboard views |

**Net**: every Epic 5 task is now implemented except the bare-metal Kata
run, which is externally blocked (needs real hardware), not a code gap.
**None of this session's K8s work has been run against a live cluster** —
it's been verified by careful code/API reading (including cross-checking
`@kubernetes/client-node`'s actual method signatures against its docs,
since the sandbox this was built in has no Kubernetes access), not by
executing it. Run `./scripts/1_Epic.sh` and the simulation endpoints
against a real kind cluster before trusting this fully.

## Epic 6 — Documentation & report alignment
✅ Done (this pass): `docs/README.md`, `ARCHITECTURE.md`, `API.md`,
`STATUS.md` (this file) — a small, current set superseding the fragmented
`dev-notes/`. The submission-form language itself hasn't been rewritten
to match; that's a separate, one-time editing pass over that specific
document, not something living in this repo.

## Known cross-cutting gaps

- **Two independent simulation engines** (`RealSimulationService` for
  Vagrant, `K8sSimulationService` for K8s) with duplicated scenario logic.
  Reasonable for now (kept the larger, established Vagrant path safe from
  a risky refactor); worth unifying behind a shared interface if a third
  platform is ever added.
- **Docker portability fixes** (client-side WebSocket/API URL resolution
  via `window.location`, permissive CORS default) — implemented, never
  confirmed working by a real `docker compose up` run from this session.
- **Frontend sidebar restructure** — implemented, one TypeScript build
  error was hit and fixed; the fix itself was never confirmed to produce
  a clean build.
- **Three dead/broken frontend API routes** (`app/api/attackers`,
  `app/api/attacker/[id]`, `app/api/dashboard`) — see `API.md`. Harmless
  (nothing calls them) but worth deleting to avoid confusing a future
  review.
