## Quick Start

Docker is the only hard requirement. No Rust, Vagrant or KVM is needed for either path below.

### Dashboard only

```bash
docker network create kind
docker compose up --build
```

Open the dashboard at http://localhost:3000. It loads with simulated attacker data automatically.
(`docker-compose.yml` joins a Docker network named `kind`, which a kind cluster creates; the first
command creates an empty one if you have no cluster. Skip it if you already ran the full setup.)

### Full setup (Kubernetes decoys, simulations, benchmark)

```bash
./scripts/1_Epic.sh                      # kind cluster + gVisor + Ingress + 4 decoys, then a health check
mkdir -p .kube
kind get kubeconfig --internal --name maya-dev > .kube/kind-internal-config
docker compose up -d --build            # dashboard, backend, MongoDB, plus the two benchmark targets
```

Needs `docker`, `kind` and `kubectl`. Developed and verified on Linux; gVisor inside kind needs a Linux
Docker host. **[docs/SETUP_AND_TESTING.md](./docs/SETUP_AND_TESTING.md)** has the full walkthrough:
restarting after a reboot, rebuilding after code changes, simulated and manual tests, and troubleshooting.

**Accessing it from another device** (phone, another computer on the same network): open
`http://<this-machine's-LAN-IP>:3000` instead of `localhost`. The dashboard talks to the right
backend address either way, so no config change is needed.

**Optional overrides**: copy `.env.example` to `.env` next to `docker-compose.yml` to customise
anything (for example `OPENAI_API_KEY` for LLM-generated decoy blueprints; without one a simpler
deterministic generator is used).

To connect real honeypot VMs, see [Infrastructure Setup](./simulations/README.md).

# Maya — Autonomous Deception Fabric

> **Trap attackers. Study them. Harden your defenses.**

Maya deploys honeypot networks that mirror real infrastructure. When an attacker gets in, they land on
a parallel fake environment where every session and command is recorded, mapped to MITRE ATT&CK, and
flagged if it is dangerous, then shown on a live dashboard.

<img width="1319" height="767" alt="image" src="https://github.com/user-attachments/assets/74d548ba-3a65-4c62-bea4-c1c538b5ec97" />

<img width="588" height="332" alt="image" src="https://github.com/user-attachments/assets/1814aed1-e0dd-4a52-9b0b-60abab475ecd" />


---

## What It Does

Traditional defenses wait for attackers to hit real systems. Maya takes a different approach — **deception as detection**.

- Runs real-OS decoys (SSH jump host, web, Redis, FTP) in sandboxed Kubernetes pods, plus a Vagrant/libvirt honeynet that also covers RDP and SMB
- Plants fake credentials as breadcrumbs that lead attackers deeper into the honeypot
- Records attacker state with **CRDT data structures** (Rust) in a sidecar the attacker cannot see
- Maps attacker commands to **MITRE ATT&CK techniques** and flags dangerous ones
- Streams data to a dashboard (WebSocket plus polling). Activity from a K8s decoy appears within about 45 seconds
- Includes a **Benchmark** page that runs the same simulated attack against Maya, Cowrie and an unprotected host and scores them side by side

---

## Architecture

Maya has two decoy fabrics behind one backend and one dashboard (see [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)):
a **Kubernetes fabric** (the default: gVisor-sandboxed decoys, with a Kata tier for bare-metal clusters) and a
**Vagrant/libvirt fabric** (reserved as the final, human-approved tier).

Kubernetes fabric:

```
   [ Attacker ] ──SSH/HTTP/FTP/Redis──▶  kind node (NodePorts 30022/30222/30122/30021/30637, Ingress 80/443)
                                                    │
                          ┌─────────────────────────┴──────────────────────────┐
                          │  Decoy pod (jump-01, web-03, redis-01, ftp-01)      │
                          │   decoy container  ──shared volume──▶ crdt-sync     │
                          │   (real sshd,        (audit lines)    sidecar       │
                          │    ForceCommand)                      (CRDT state)  │
                          └─────────────────────────┬──────────────────────────┘
                                                    │  backend polls every 15 s
                                       [ Backend API (Node.js) + MongoDB ]
                                                    │
                                       [ Live Dashboard (Next.js) ]
```

Vagrant fabric:

```
                         Internet
                             │
                       [ Attacker ]
                             │
             ┌───────────────┴───────────────┐
             │                               │
        corp_net (real)               maya_net (fake)
        10.10.10.0/24                10.20.20.0/24
             │                               │
        [Protected]               ┌──────────┴──────────┐
                             gateway-vm            fake-* VMs
                                                   (see table below)
                                  │
                         [ CRDT Sync Layer ]
                         syslogd-helper (Rust)
                                  │
                         [ Backend API (Node.js) ]
                                  │
                         [ Live Dashboard (Next.js) ]
```

### Core Components

| Component | Tech | Purpose |
|---|---|---|
| **Backend API** | Node.js + TypeScript + MongoDB | Aggregates attacker data, MITRE classification, simulations, benchmark |
| **Frontend Dashboard** | Next.js + React + Recharts | Attacker tracking, command history, MITRE heatmap, lateral movement graph, simulations, benchmark |
| **Kubernetes decoys** | kind, gVisor (Kata optional), Alpine/Debian | Real-OS SSH, web, Redis and FTP decoys |
| **crdt-sync sidecar** | Rust (musl, static) | Records session/command state outside the decoy container |
| **Lifecycle manager** | Go | Provisions, scales and terminates decoys (`maya-k8s/lifecycle-manager`) |
| **Honeypot VMs** | Vagrant + libvirt + QEMU/KVM | Final-tier fake infrastructure, including RDP and SMB |
| **Docker honeypots** | Cowrie, Dionaea, Conpot, Honeytrap | Defined in `scripts/docker/docker-compose.yml` (a separate compose file). Cowrie is the baseline in the benchmark; the others are not connected to the backend |
| **ELK Stack** | Elasticsearch + Logstash + Kibana | Defined in the same separate compose file; not connected to the backend |

---

## CRDT State Synchronization

Attacker state is kept in **Conflict-free Replicated Data Types** implemented in Rust (`scripts/crdt/`):

| CRDT Type | Data | Merge Rule |
|---|---|---|
| **G-Set** | Visited hosts, every command an attacker ran (with timestamps), session IDs | Union: nothing is ever dropped |
| **AWOR-Set** | Stolen credentials | Add-wins: credential theft is permanent |
| **LWW-Register** | Current attacker location | Last-write-wins by Lamport timestamp |

The merge functions are idempotent and order-independent, so states that are exchanged converge.
How state moves differs by fabric:

- **Kubernetes:** the decoy container's sshd runs a `ForceCommand` wrapper that appends one JSON line per
  session and command to a shared volume. The `crdt-sync` sidecar, which the attacker cannot see, reads
  that file every 30 s and updates the CRDT state. The backend reads each pod's state every 15 s and
  merges it into MongoDB. There is no peer-to-peer gossip between pods, so cross-decoy correlation
  currently depends on the backend.
- **Vagrant:** each VM runs `syslogd-helper daemon`, which gossips its state to peers over scp/ssh every
  30 s, and `/etc/profile.d` hooks record logins and commands from interactive shells.

Not captured: the passwords of failed logins. Real sshd never exposes them, and wrong-password attempts
never reach the `ForceCommand` wrapper.

---

## MITRE ATT&CK Mapping

Maya classifies attacker **commands** (`backend/src/utils/commandPatterns.ts`: exact signatures, regex
patterns, then a database lookup) and falls back to a low-confidence default when nothing matches.
Examples observed on the SSH decoy:

| Command | Technique | Tactic |
|---|---|---|
| `whoami`, `id` | T1033 System Owner/User Discovery | Discovery |
| `uname -a` | T1082 System Information Discovery | Discovery |
| `ps aux` | T1057 Process Discovery | Discovery |
| `ls -la /`, `find / -name ...` | T1083 File and Directory Discovery | Discovery |
| `cat /etc/passwd` | T1087.001 Account Discovery: Local Account | Discovery |
| `cat /etc/passwd \| base64` | T1132.001 Data Encoding: Standard Encoding | Command and Control |

Dangerous commands (for example `cat /etc/shadow`, `history -c`, reverse-shell patterns,
credential-file encoding) are flagged separately. The simulation features assign their own techniques as
part of their scripted events.

---

## Dashboard

- **Overview** — health score, active decoys, active attackers
- **Attackers / attacker page** — IP, entry point, privilege level, dwell time (first to last recorded event), command history with MITRE technique and a Dangerous flag, attack timeline, lateral movement graph, credential usage
- **Live Activity** — event feed with MITRE mapping and JSON export
- **Infrastructure** — decoy status, sandbox tier, CRDT counts
- **Simulations** — six scripted attack scenarios run against the live decoys
- **Benchmark** — side-by-side comparison of Maya, Cowrie and an unprotected host with an evaluation matrix (method in [docs/EVALUATION.md](./docs/EVALUATION.md))

Live updates use the WebSocket; most pages also fetch or poll, so data still loads if it is disconnected.

---

## Honeypot Infrastructure

### Kubernetes decoys (default fabric)

| Decoy | Host port | Service |
|---|---|---|
| `jump-01` | 30022 | SSH jump server |
| `redis-01` | 30222 (SSH), 30637 (Redis) | Redis server |
| `ftp-01` | 30122 (SSH), 30021 (FTP) | FTP server |
| `web-03` | 80 / 443 via the Ingress | nginx web server (SSH is cluster-internal) |

RDP and SMB decoys are Vagrant-only by design.

### Vagrant honeynet

| VM | IP | Emulates |
|---|---|---|
| `gateway-vm` | 10.20.20.1 (192.168.10.5 on the corp side) | Honey wall, NAT, traffic redirection |
| `fake-ssh-01` | 10.20.20.10 | SSH server |
| `fake-web-01` | 10.20.20.11 | nginx web server |
| `fake-web-02` (hostname `fake-redis-01`) | 10.20.20.12 | Redis server |
| `fake-rdp-01` | 10.20.20.30 | RDP server |
| `fake-ftp-01` | 10.20.20.40 | FTP server |
| `fake-smb-01` | 10.20.20.50 | SMB file server |
| `fake-web-03` | 10.20.20.60 | Web server |
| `fake-jump-01` | 10.20.20.70 | SSH jump server |

Addresses come from the Vagrantfiles under `simulations/fake/`. The demo data seeded in simulation mode
(`backend/src/utils/seedData.ts`) uses different example addresses.

---

## Getting Started

### Prerequisites

- **Docker with the compose plugin** — for everything in Quick Start
- **kind and kubectl** — for the Kubernetes fabric
- `sshpass`, `nmap`, `jq` — only for the command-line red-team battery and the commands in the docs
- Node.js (the images use Node 20) and `npm install` in `backend/` — only to run the backend locally, its tests, or the comparison report script
- **Vagrant 2.4+ with vagrant-libvirt, QEMU/KVM, and Rust** — only for the Vagrant fabric (Rust builds the CRDT binary that is copied into the VMs)

### Running the backend and frontend locally (without Docker)

```bash
cd backend
npm install
npm run dev        # needs MongoDB; set MONGODB_URI if it is not on localhost:27017
```

```bash
cd frontend
npm install
npm run dev
# Dashboard → http://localhost:3000
```

The backend reads settings from environment variables or a `.env` file in `backend/` (there is no
`backend/.env.example`; the root `.env.example` documents the same variables for Docker).

### VM Infrastructure

```bash
# Define networks
virsh net-define simulations/corp_net.xml
virsh net-define simulations/maya_net.xml
virsh net-start corp_net && virsh net-start maya_net

# Build CRDT binary
cd scripts/crdt
cargo build --release --target x86_64-unknown-linux-musl

# Deploy everything
./scripts/setup-infrastructure.sh setup
```

### VM Management

```bash
./scripts/manage-vms.sh list
./scripts/manage-vms.sh start fake-jump-01
./scripts/manage-vms.sh ssh fake-web-01
```

### Testing

Simulated attacks, the command-line battery, the Benchmark page, and typing commands on a decoy by hand
are covered in [docs/SETUP_AND_TESTING.md](./docs/SETUP_AND_TESTING.md).

---

## Environment Variables

All have working defaults in `docker-compose.yml`.

| Variable | Default (compose) | Purpose |
|---|---|---|
| `PORT` | `3001` | Backend port |
| `MONGODB_URI` | `mongodb://mongodb:27017/maya_deception` | MongoDB connection (use `localhost` for a local backend) |
| `NODE_ENV` | `development` | |
| `SIMULATION_MODE` | `true` | Seeds demo attacker data on start |
| `CRDT_SYNC_INTERVAL` | `10000` | Vagrant VM sync loop, ms |
| `VAGRANT_DIR` | `../simulations/fake` | Where the backend finds the Vagrant VMs |
| `KUBECONFIG` | `/kube/kind-internal-config` | Cluster access for K8s discovery and simulations |
| `K8S_TIER_CONTEXTS` | `gvisor=kind-maya-dev` | Maps a decoy tier to a kube context |
| `CORS_ORIGINS` | empty (any origin) | Comma-separated allowed origins |
| `JWT_SECRET` | `dev-secret-change-in-production` | Reserved for the planned API auth; not used yet |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | empty, `gpt-4o-mini` | Optional LLM-generated decoy blueprints |
| `BENCHMARK_MAYA_HOST`, `BENCHMARK_MAYA_PORT` | `maya-dev-control-plane`, `30022` | Where the Benchmark page reaches Maya (try `host.docker.internal` if unreachable) |
| `BENCHMARK_PASSWORD` | `fakejump01!` | Login used by the Benchmark page on all three targets |
| `NEXT_PUBLIC_API_URL` | `http://backend:3001` | Frontend, server-side only |

---

## Documentation

| | |
|---|---|
| [docs/SETUP_AND_TESTING.md](./docs/SETUP_AND_TESTING.md) | Setup, restart, rebuild, simulated and manual tests, troubleshooting |
| [docs/EVALUATION.md](./docs/EVALUATION.md) | How Maya is benchmarked against Cowrie and an unprotected host, and what is measured |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | How the system fits together |
| [docs/API.md](./docs/API.md) | HTTP and WebSocket endpoints |
| [docs/STATUS.md](./docs/STATUS.md) | What is built and what is still pending, by epic |

---

## Research Value

This project demonstrates:

- **CRDT theory applied to security** — attacker state kept in a component the attacker cannot reach
- **Deception technology** as a proactive detection mechanism
- **MITRE ATT&CK integration** for structured threat intelligence
- **Honeypot benchmarking** — a repeatable, side-by-side method for comparing deception systems, including their dwell time and how convincing they are
- **Lateral movement simulation** for red team / purple team exercises

Suitable for cybersecurity research, SOC analyst training, and red team infrastructure.

---

## Known Limitations & Roadmap

**Current gaps:**
- No API authentication (open endpoints: fine for research, not production), and no WebSocket auth
- Failed-login passwords are not captured (Cowrie captures them; real sshd does not expose them)
- Behind a kind NodePort every SSH client appears as the same source address, so separate attackers can merge into one
- Decoy state lives in an `emptyDir`; recreating a pod loses anything not yet read by the backend
- The decoys are real OS environments, but not undetectable: `uname -a` reveals the gVisor kernel and the process list shows the logging helper. The Benchmark page measures this
- The human-approved escalation (gVisor → Kata → Vagrant) and the learned attacker classifier are not built yet (see [docs/STATUS.md](./docs/STATUS.md))
- Dionaea, Conpot, Honeytrap and the ELK stack are defined but not integrated with the backend

**Planned:**
- JWT-based API access control
- Attacker behaviour classification and human-gated escalation between decoy tiers
- MISP integration (STIX/TAXII export)
- Windows Active Directory decoys
- Automated IP blocking via iptables on confirmed attackers

---

## Tech Stack

**Backend:** Node.js · TypeScript · Express · MongoDB · WebSocket · Winston  
**Frontend:** Next.js · React · Tailwind CSS · shadcn/ui · Recharts  
**Infrastructure:** Docker · Kubernetes (kind) · gVisor / Kata Containers · Vagrant · libvirt · QEMU/KVM  
**Systems:** Rust (CRDT) · Go (lifecycle manager) · Shell  
**Honeypots and baselines:** Cowrie · Dionaea · Conpot · Honeytrap · ELK Stack

---

## Authors

Built by [Karan Desai](https://github.com/desaikaran) & [Pankhuri Varshney](https://github.com/pankhuriVarshney) & [Reeti Agarawal](https://github.com/Reeti05Agarwal)

---

*"The best way to understand how attackers think is to watch them work — without them knowing you're watching."*
