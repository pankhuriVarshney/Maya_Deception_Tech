# Architecture

## The three-tier deception fabric

Maya deliberately runs decoys on two different platforms, layered as three
fidelity tiers:

```
Attacker
   │
   ▼
┌─────────────────────────┐   default tier — most traffic lands here
│  Kubernetes + gVisor     │   cheap, fast to provision, container isolation
└─────────────────────────┘
   │  (escalation, automatic — Epic 3, not yet built)
   ▼
┌─────────────────────────┐   escalation tier — suspicious-but-unconfirmed
│  Kubernetes + Kata       │   real VM isolation (KVM), still K8s-orchestrated
└─────────────────────────┘
   │  (escalation, human-approved — Epic 3, not yet built)
   ▼
┌─────────────────────────┐   final tier — confirmed APT/AI-driven only
│  Vagrant + libvirt VM    │   full VM fidelity, highest engagement cost
└─────────────────────────┘
```

Today, all three tiers exist and can run decoys; the *automatic
classification and escalation between them* (Epic 3) is not built yet —
an attacker currently has to be manually pointed at a given tier's decoy
name.

## Why two platforms instead of one

- **Kubernetes (`maya-k8s/`)** is the default fabric because it's cheap to
  scale and gives real container-level isolation via gVisor (`runsc`) for
  the tier most attackers (bots, scanners, casual human intrusion) actually
  hit.
- **Kata Containers** sits between gVisor and Vagrant: still a K8s pod
  (same orchestration, same CRDT plumbing), but backed by a real
  lightweight VM (KVM) instead of a shared-kernel container — meaningfully
  harder to fingerprint than gVisor, cheaper to provision than a full
  Vagrant VM. Requires a bare-metal host with `/dev/kvm` (see
  `maya-k8s/kata-*.sh`) — doesn't work inside `kind`.
- **Vagrant + libvirt (`simulations/`)** is the original, highest-fidelity
  prototype: full VMs, not containers at all. Reserved as the final,
  human-approved escalation tier for confirmed high-value attackers,
  rather than the default — running full VMs for every casual scanner
  doesn't scale.

## CRDT: the shared attacker-observation layer

`scripts/crdt/` is a Rust binary (`syslogd-helper` on disk) implementing a
small CRDT (G-Set, AWOR-Set, LWW-Register, LWW-Map) that records attacker
actions locally on each decoy — `visit`, `action`, `move`, `cred`,
`session`, plus a `daemon` mode for peer-to-peer gossip sync between nodes
on the same fabric.

The **same binary** runs on both platforms:
- Vagrant VMs: state file at `/var/lib/.syscache`, reached over SSH
  (`vagrant ssh -c "..."`).
- K8s pods: state file at `/var/lib/.state/.syscache` (configurable via the
  `MAYA_STATE_FILE` env var — deliberately not `/var/lib/maya/...`, since a
  directory literally named "maya" would be its own fingerprint), reached
  via `kubectl exec` (the K8s client library's `Exec` API). The binary
  itself runs in a separate `crdt-sync` sidecar container in the same Pod
  as the decoy, not inside the decoy's own container — sharing only that
  state file's `emptyDir` volume — so an attacker with a shell in the decoy
  container has no binary, process, or listening port to find. See
  `maya-k8s/README.md`'s "CRDT binary placement" section for why. The
  backend still reads the state file straight from the decoy container
  (`containers[0]` in the Pod spec), since it only ever `cat`s the shared
  file rather than invoking the binary.

The backend never relies on the binary's human-readable `stats` output —
it reads the raw state file directly (`cat ...`) and parses the JSON,
since that's what the binary actually serializes.

Peer-to-peer sync between Vagrant nodes is real (full mesh `peers.conf` +
a `daemon` systemd/OpenRC service, wired up in
`scripts/setup-infrastructure.sh`). K8s pods don't currently gossip with
each other — the backend's own polling (below) is what unifies attacker
state across K8s decoys today.

## Backend (`backend/`, Node/Express/MongoDB)

One MongoDB collection layer serves both fabrics, distinguished by a
`platform: 'vagrant' | 'k8s'` field (and `tier` for K8s):

| Service | Role |
|---|---|
| `CRDTSyncService` | Polls Vagrant VMs over SSH, merges CRDT state into `VMStatus` |
| `K8sDiscoveryService` | Same job, for K8s pods, over `kubectl exec` (`K8sClient.ts`) |
| `RealSimulationService` | Runs attack scenarios against Vagrant VMs, writes `Attacker`/`AttackEvent`/`Credential` records |
| `K8sSimulationService` | Same job, against K8s pods |
| `InfrastructureDiscoveryService` | Lightweight Vagrant VM up/down check (used by `/api/vms`) |
| `MitreAttackService` / `MitreSyncService` | Classifies raw actions into MITRE ATT&CK techniques; syncs the technique reference data from GitHub/TAXII |
| `DecoyGenerationService` | Generates organization-specific decoy blueprints (LLM via OpenAI if `OPENAI_API_KEY` is set, deterministic fallback otherwise) |
| `WebSocketHandler` | Pushes live updates (`NEW_EVENT`, `ATTACKER_UPDATED`, `SYNC_COMPLETE`, ...) to the dashboard |

See [API.md](./API.md) for the full endpoint list.

## Frontend (`frontend/`, Next.js App Router)

- `/` — marketing landing page.
- `/dashboard/*` — the actual SOC dashboard, behind a persistent sidebar
  (`app/dashboard/layout.tsx`): Overview, Attackers, Live Activity,
  Infrastructure, Simulations.
- `/attacker/[id]` — individual attacker detail (server-rendered initial
  fetch, then WebSocket-driven live updates).
- `/dashboard/infrastructure/[name]` — individual VM/pod detail: config,
  declared resources, attacker list, Stop/Resync actions.

**Browser-side backend URL resolution** (`lib/api-base.ts`): the browser
never hardcodes a backend hostname. It derives the backend address from
`window.location.hostname` at runtime (same host, port 3001) — this is
what makes `docker compose up` work unmodified from `localhost`, a LAN
IP, or any other device. Don't reintroduce `process.env.NEXT_PUBLIC_*` or
`http://backend:3001` into client components; both are Docker-internal or
build-time-only and won't resolve from an actual browser.

## Known architectural gaps (see STATUS.md for the full list)

- No automatic tier escalation (Epic 3) — tiers exist, the classifier that
  moves attackers between them doesn't.
- No auth on any API endpoint (Epic 2).
- Vagrant and K8s each have their own simulation engine
  (`RealSimulationService` / `K8sSimulationService`) with duplicated
  scenario logic rather than a shared abstraction — worth refactoring if
  a third platform is ever added, not urgent with just two.
