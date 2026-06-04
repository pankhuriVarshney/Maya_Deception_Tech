## Quick Start (Docker)

> No Vagrant, no KVM, no Rust required. Runs anywhere Docker is installed.

1. Clone the repo
2. Copy the env file: `cp .env.example .env`
3. Start everything: `docker compose up --build`
4. Open the dashboard: http://localhost:3000

The dashboard loads with simulated attacker data automatically.
To connect real honeypot VMs, see [Infrastructure Setup](./simulations/README.md).

## Kubernetes Honeynet

Deploys 7 real honeypot pods as an attacker-facing network using kind.

| Pod | Image | Simulates |
|-----|-------|-----------|
| fake-jump-01 | cowrie/cowrie | SSH jump server |
| fake-web-01 | cowrie + nginx | Web server with decoy portal |
| fake-web-02 | cowrie + nginx | Secondary web server |
| fake-ftp-01 | cowrie/cowrie | FTP server |
| fake-rdp-01 | dtagdevsec/heralding | RDP server |
| fake-smb-01 | dtagdevsec/dionaea | SMB file server |
| gateway-vm | haproxy:2.8-alpine | Network gateway + stats breadcrumb |

### Prerequisites
- Docker (already running for control plane)
- kind: https://kind.sigs.k8s.io/docs/user/quick-start/#installation
- kubectl: https://kubernetes.io/docs/tasks/tools/

### Deploy honeynet
```bash
chmod +x k8s/deploy.sh
./k8s/deploy.sh
```

### Watch CRDT heartbeats live
```bash
kubectl logs -n maya-honeynet deployment/fake-jump-01 -c crdt-sync -f
```

### Tear down
```bash
./k8s/teardown.sh
```

### Architecture
```
Attackers → gateway NodePort (localhost:8080)
         → routed to honeypot pods
         → CRDT sidecar POSTs state to backend API
         → backend updates MongoDB + broadcasts WebSocket
         → dashboard shows live attacker activity
```

# Maya — Autonomous Deception Fabric

> **Trap attackers. Study them. Harden your defenses.**

Maya is an enterprise-grade cybersecurity deception platform that deploys autonomous honeypot networks mirroring real infrastructure. When attackers breach your perimeter, they walk into a parallel fake environment — where every move is silently tracked, fingerprinted, and mapped to MITRE ATT&CK in real time.

<img width="1319" height="767" alt="image" src="https://github.com/user-attachments/assets/74d548ba-3a65-4c62-bea4-c1c538b5ec97" />

<img width="588" height="332" alt="image" src="https://github.com/user-attachments/assets/1814aed1-e0dd-4a52-9b0b-60abab475ecd" />


---

## What It Does

Traditional defenses wait for attackers to hit real systems. Maya takes a different approach — **deception as detection**.

- Deploys a parallel fake network (SSH servers, web servers, databases, FTP, RDP, SMB) that looks and behaves exactly like real infrastructure
- Plants fake credentials as breadcrumbs that lead attackers deeper into the honeypot
- Tracks every action across distributed nodes using **CRDT-based state synchronization** (Rust)
- Maps all attacker behavior automatically to **MITRE ATT&CK techniques**
- Streams live data to a real-time dashboard via WebSockets

The result: you're not just detecting attackers — you're studying them.

---

## Architecture

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
                                  │                     │
                             fake-jump-01          fake-web-01
                             fake-db-01            fake-ftp-01
                             fake-rdp-01           fake-smb-01
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
| **Backend API** | Node.js + TypeScript + MongoDB | Aggregates attacker data, WebSocket broadcasts |
| **Frontend Dashboard** | Next.js + React + Recharts | Real-time attacker tracking, MITRE heatmap, lateral movement graph |
| **Honeypot VMs** | Vagrant + libvirt + QEMU/KVM | Fake infrastructure nodes |
| **Docker Honeypots** | Cowrie, Dionaea, Conpot, Honeytrap | Low-interaction service emulation |
| **CRDT Sync** | Rust | Distributed attacker state without central coordination |
| **ELK Stack** | Elasticsearch + Logstash + Kibana | Log storage and visualization |

---

## CRDT State Synchronization

The hardest problem in a distributed honeypot: keeping attacker state consistent across nodes **without a central coordinator** (which is itself an attack target).

Maya uses **Conflict-free Replicated Data Types** implemented in Rust:

| CRDT Type | Data | Merge Rule |
|---|---|---|
| **G-Set** | Visited hosts, historical actions | Union — hosts are never "unvisited" |
| **AWOR-Set** | Stolen credentials | Add-wins: credential theft is permanent |
| **LWW-Register** | Current attacker location | Last-write-wins by Lamport timestamp |
| **LWW-Map** | Active sessions per host | Per-key LWW resolution |

Sync happens over multiple redundant channels:
- SSH profile hooks (`/etc/profile.d/10-sys-audit.sh`) on login
- HTTP endpoints via nginx internal locations on web servers
- Logrotate postrotate hooks
- APT post-invoke hooks

**Mathematical guarantee**: nodes converge to the same state regardless of network partitions or message ordering.

---

## MITRE ATT&CK Mapping

Every attacker action is automatically classified:

| Attacker Action | Technique | Tactic |
|---|---|---|
| SSH login with fake credential | T1078 — Valid Accounts | Initial Access |
| Pivot between honeypot nodes | T1021 — Remote Services | Lateral Movement |
| Credential dumping attempt | T1003 — OS Credential Dumping | Credential Access |
| Web shell deployment | T1505 — Server Software Component | Persistence |
| Data exfiltration attempt | T1041 — Exfiltration Over C2 | Exfiltration |

---

## Dashboard

The live dashboard gives security teams:

- **Infrastructure Overview** — health score, active decoys, active sessions
- **Attacker Profiles** — IP, entry point, privilege level, dwell time, campaign detection
- **Attack Timeline** — chronological event log with severity coding
- **MITRE ATT&CK Heatmap** — visual technique coverage across all active attackers
- **Lateral Movement Graph** — network topology of attacker pivots
- **Credential Intelligence** — stolen credential tracking with risk scoring
- **Behavior Analysis** — privilege escalation patterns, confidence scoring

All data updates in real time via WebSocket.

---

## Honeypot Infrastructure

| VM | IP | Emulates |
|---|---|---|
| `gateway-vm` | 10.20.20.1 | Honey wall, NAT, traffic redirection |
| `fake-jump-01` | 10.20.20.10 | SSH jump server |
| `fake-web-01` | 10.20.20.20 | nginx web server |
| `fake-web-02` | 10.20.20.21 | Secondary web server |
| `fake-ftp-01` | 10.20.20.30 | FTP server |
| `fake-rdp-01` | 10.20.20.40 | RDP server |
| `fake-smb-01` | 10.20.20.50 | SMB file server |

Docker honeypot services: **Cowrie** (SSH), **Dionaea** (malware capture), **Conpot** (ICS/SCADA), **Honeytrap** (low-interaction).

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB 6+
- Vagrant 2.4+ with vagrant-libvirt
- QEMU/KVM
- Docker + docker-compose
- Rust (for CRDT binary)

### Backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# Dashboard → http://localhost:3000
```

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

---

## Environment Variables

```env
PORT=3001
MONGODB_URI=mongodb://localhost:27017/maya_deception
JWT_SECRET=your-secret-key
NODE_ENV=development
CRDT_SYNC_INTERVAL=10000
VAGRANT_DIR=../simulations/fake
```

---

## Research Value

This project demonstrates:

- **CRDT theory applied to security** — distributed state management without coordination
- **Deception technology** as a proactive detection mechanism
- **MITRE ATT&CK integration** for structured threat intelligence
- **Lateral movement simulation** for red team / purple team exercises
- **Real-time SOC tooling** with WebSocket-driven live dashboards

Suitable for cybersecurity research, SOC analyst training, and red team infrastructure.

---

## Known Limitations & Roadmap

**Current gaps:**
- No API authentication (open endpoints — fine for research, not production)
- WebSocket has no auth layer
- Vagrant Vagrantfiles have duplicate provisioning blocks

**Planned:**
- JWT-based API access control
- ML anomaly detection on attacker behavior patterns
- MISP integration (STIX/TAXII export)
- Windows Active Directory decoys
- Automated IP blocking via iptables on confirmed attackers

---

## Tech Stack

**Backend:** Node.js · TypeScript · Express · MongoDB · WebSocket · Winston  
**Frontend:** Next.js · React · Tailwind CSS · shadcn/ui · Recharts  
**Infrastructure:** Vagrant · libvirt · QEMU/KVM · Docker  
**Systems:** Rust (CRDT) · Go · Shell  
**Security:** Cowrie · Dionaea · Conpot · ELK Stack

---

## Authors

Built by [Karan Desai](https://github.com/desaikaran) & [Pankhuri Varshney](https://github.com/pankhuriVarshney) & [Reeti Agarawal](https://github.com/Reeti05Agarwal)

---

*"The best way to understand how attackers think is to watch them work — without them knowing you're watching."*
