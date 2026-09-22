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
| 3. Cowrie stack verification | ⬜ Not started — `scripts/docker/docker-compose.yml` has a Cowrie service, never confirmed to actually start |
| 4. Cowrie log parser + MITRE reclassification | ✅ Done: `backend/src/services/redteam/CowrieLogParser.ts` — parses `cowrie.json`, classifies every command through the same `MitreAttackService` Maya's own simulations use |
| 5. Metrics + comparison report | ✅ Done: `backend/scripts/redteamReport.ts` |
| 6. Fingerprint-probe script (stretch) | ⬜ Not started |

**Important finding from building this**: Maya's *passive* detection
pipeline (real SSH activity → `syslogd-helper` → `CRDTSyncService`) never
creates `Attacker`/`AttackEvent` records — only aggregate counts in
`VMStatus.crdtState`. All MITRE-tagged, dashboard-visible attacker detail
comes exclusively from the simulation engines self-reporting. Separately,
the CRDT schema's `actions_per_decoy` is a last-write-wins map, so even a
fix would only ever retain the *latest* action per decoy, not a full
per-command history. The comparison report is written to be honest about
this asymmetry (Cowrie logs full command detail natively; Maya currently
only confirms engagement via count deltas) rather than fabricate a
like-for-like table.

**None of Epic 4 has been run.** No docker/red-team tooling exists in the
sandbox this was built in — verify with:
```bash
docker compose -f scripts/docker/docker-compose.yml up -d cowrie
./scripts/redteam/run-battery.sh --target <maya-decoy-ip> --ssh-port <port> --label maya-jump-01 --known-user admin --known-pass 'fakejump01!'
./scripts/redteam/run-battery.sh --target 127.0.0.1 --ssh-port 2222 --label cowrie --known-user root --known-pass toor
docker cp cowrie-ssh:/cowrie/cowrie-git/var/log/cowrie/cowrie.json ./cowrie.json
cd backend && npx ts-node scripts/redteamReport.ts --battery-log ../redteam-results/maya-jump-01-battery.jsonl --cowrie-log ../cowrie.json --maya-vm jump-01 --out ../redteam-results/report.md
```

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
