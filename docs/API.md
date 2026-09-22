# API Reference

All backend endpoints are served by `backend/src/server.ts` on port 3001.
None require authentication yet (see STATUS.md, Epic 2). The frontend
never hardcodes this address — see `frontend/lib/api-base.ts`.

## Top-level (`server.ts`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness — uptime, WebSocket client count, Mongo connection state |
| GET | `/api/vms` | All VMs/pods with status + CRDT stats (live-discovers unless `SIMULATION_MODE=true`) |
| GET | `/api/attackers/summary` | Quick attacker counts by risk level |
| GET | `/` | API index |

## `/api/dashboard` (`routes/dashboard.ts`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Full bundled dashboard payload |
| GET | `/attackers` | Attacker list, frontend-mapped |
| GET | `/attacker/:id` | Single attacker's full profile (`{id, attackerId, generatedAt, dashboard}` — note: flat fields like `ipAddress`/`platform` live under `dashboard.attacker`, not at the top level) |
| GET | `/stats` | Summary stats |
| GET | `/timeline` | Attack event timeline |
| GET | `/mitre-matrix` | MITRE ATT&CK technique coverage |
| GET | `/lateral-movement` | Lateral movement graph data |
| GET | `/commands` | Command execution feed |
| GET | `/metrics` | Deception engagement metrics |
| GET | `/security-posture` | Security posture card data |
| GET | `/behavior` | Behavior analysis |
| GET | `/incidents` | Incident summary |
| GET | `/active-attackers` | Currently-active attackers (list view + system-health poll target) |
| GET | `/debug/attackers` | Debug: raw dump of all + active attacker records |
| POST | `/attacker` | Manually create a test attacker (debug tool) |

## `/api/simulation` (`routes/simulation.ts`)

Every attack-scenario endpoint resolves targets in this order: **K8s decoy
→ Vagrant VM → mock**. `real: true` in the response means it actually ran
against live infrastructure; `platform` says which one.

| Method | Path | Ported to K8s? | Purpose |
|---|---|---|---|
| POST | `/ssh-bruteforce` | Yes | SSH brute-force sim, ends in a captured credential |
| POST | `/lateral-movement` | Yes | Pivot across decoys, proves cross-node CRDT/attacker consistency |
| POST | `/credential-theft` | Yes | Simulated credential-dumping tool run (mimikatz/lazagne/...) |
| POST | `/discovery` | Yes | Simulated recon (network/host discovery commands) |
| POST | `/privilege-escalation` | Yes | Simulated priv-esc attempt |
| POST | `/full-campaign` | Yes | Scripted multi-stage campaign chaining the above |
| POST | `/refresh-vms` | — | Force-refresh the Vagrant VM cache |
| GET | `/status` | — | Simulation engine status + validation rules + VM cache |
| GET | `/vm-cache` | — | Detailed Vagrant VM cache |
| POST | `/vm-cache/populate` | — | Manually seed the VM cache (debug) |
| POST | `/vm-cache/refresh` | — | Same as `/refresh-vms` |
| GET | `/k8s-targets` | — | List currently-discovered K8s decoy targets |

## `/api/decoy` (`routes/decoy.ts`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/generate` | Generate a company decoy blueprint (LLM if `OPENAI_API_KEY` set, deterministic fallback otherwise) |
| POST | `/apply/:blueprintId` | Apply a stored blueprint onto an existing VM |
| POST | `/create-and-apply/:blueprintId` | Provision a new VM from a template and apply the blueprint |
| GET | `/status/:blueprintId` | Poll blueprint deployment status |

## `/api/infrastructure` (`routes/infrastructure.ts`)

Backs the Infrastructure list/detail pages.

| Method | Path | Purpose |
|---|---|---|
| GET | `/nodes` | Every VM/pod (Vagrant + K8s) with live attacker counts |
| GET | `/nodes/:name` | Full detail: config, declared resources, Docker containers, associated attackers |
| POST | `/nodes/:name/stop` | Platform-aware stop (`vagrant halt` / scale Deployment to 0) |
| POST | `/nodes/:name/resync` | Force an immediate status refresh for that node's platform |

## WebSocket (`ws://.../ws`)

**Server → client**: `CONNECTION_ACK`, `INITIAL_STATE`, `NEW_EVENT`,
`ATTACKER_UPDATED`, `STATS_UPDATED`, `SYNC_COMPLETE`, `SIMULATION_COMPLETE`,
`ERROR`

**Client → server** (request/response): `GET_ATTACKER_PROFILE` →
`ATTACKER_PROFILE`, `GET_TIMELINE` → `TIMELINE_UPDATED`,
`GET_MITRE_MATRIX` → `MITRE_MATRIX_UPDATED`, `TRIGGER_SYNC` →
`SYNC_TRIGGERED`

## Frontend API routes (`frontend/app/api/`)

These exist but are not the real data path — flagged here so they don't
get mistaken for live endpoints in a future review:

- `GET /api/attackers`, `GET /api/attacker/[id]` — **dead code**, return
  hardcoded mock data, called from nowhere in the app.
- `GET`/`POST /api/dashboard` — **broken and effectively dead**: the code
  assumes a catch-all route (`[...path]`) but lives at the literal path
  `app/api/dashboard/route.ts`, so it only ever matches the bare
  `/api/dashboard` URL (nothing calls that), and even then constructs a
  malformed backend URL. All real `/api/dashboard/*` traffic bypasses this
  file via `next.config.mjs`'s `rewrites()` instead.

The real data path is either the Next.js rewrite proxy
(`/api/:path*` → `http://backend:3001/api/:path*`, server-side) or direct
browser fetches via `frontend/lib/api-base.ts` (client-side,
address resolved from `window.location` at runtime).

## Other internal APIs

- **`maya-k8s/lifecycle-manager`** (Go, port 8081, internal-only, no auth):
  `POST /provision`, `POST /terminate`, `POST /scale`, `GET /status`
  (decoy type + replica health) — direct K8s Deployment control. Separate
  from the Node backend's own
  `K8sClient.scaleDeployment` (the Infrastructure page's Stop button uses
  the Node backend path, not this service — not yet unified).
- **`syslogd-helper` CLI** (not HTTP — the CRDT binary itself, reached via
  `kubectl exec ... -c crdt-sync` in K8s — it runs in a sidecar container
  next to each decoy, not the decoy's own container):
  `visit`, `action`, `move`, `cred`, `session`, `merge`, `daemon`, `hash`,
  `stats`, `show`, `check-peers`.
