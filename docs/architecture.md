# Maya Deception Tech - Project Documentation

## Overview

**Maya Deception Fabric** is an enterprise-grade cybersecurity deception platform that creates realistic honeypot infrastructures to detect, engage, and analyze cyber attackers. The system builds parallel "fake" networks that mirror real enterprise infrastructure, allowing security teams to observe attacker behavior in a controlled, monitored environment.

---

## Project Structure

```
Maya_Deception_Tech/
├── backend/                    # Node.js/TypeScript API Server
│   ├── src/
│   │   ├── models/            # MongoDB schemas
│   │   ├── routes/            # Express API routes
│   │   ├── services/          # Business logic (CRDT, Dashboard, Attacker mapping)
│   │   ├── websocket/         # Real-time WebSocket handler
│   │   ├── middleware/        # Express middleware
│   │   ├── utils/             # Utilities (logger, seed data)
│   │   └── server.ts          # Main entry point
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                   # Next.js/React Dashboard
│   ├── app/                   # Next.js App Router pages
│   ├── components/            # React components (dashboard, UI)
│   ├── hooks/                 # Custom React hooks (WebSocket, VM status)
│   ├── lib/                   # Utilities, mappers, types
│   ├── types.ts               # TypeScript type definitions
│   └── package.json
│
├── simulations/                # Virtual Machine Infrastructure
│   ├── fake/                  # Honeypot/decoy VMs (Vagrant + libvirt)
│   │   ├── fake-jump-01/      # SSH jump server decoy
│   │   ├── fake-web-01/       # Web server decoy
│   │   ├── fake-web-02/       # Secondary web server decoy
│   │   ├── fake-ftp-01/       # FTP server decoy
│   │   ├── fake-rdp-01/       # RDP server decoy
│   │   ├── fake-smb-01/       # SMB file server decoy
│   │   └── gateway-vm/        # Network gateway/honey wall
│   ├── control/               # Control plane configurations
│   ├── real/                  # Real infrastructure templates
│   ├── maya-crdt/             # CRDT synchronization binary
│   └── *.xml                  # libvirt network definitions
│
├── scripts/                    # Automation & Deployment
│   ├── crdt/                  # Rust CRDT implementation
│   │   ├── src/               # Rust source code
│   │   ├── Cargo.toml         # Rust dependencies
│   │   └── README.md          # CRDT theory & implementation
│   ├── docker/                # Docker honeypot containers
│   │   └── docker-compose.yml # Cowrie, Dionaea, Conpot, ELK stack
│   ├── manage-vms.sh          # VM lifecycle management
│   └── setup-infrastructure.sh # Full infrastructure orchestration
│
├── config/
│   └── infrastructure.json    # Network topology & configuration
│
└── Maya.pdf, Synopsis Presentation.pptx  # Documentation
```

---

## Core Architecture

### 1. **Backend API (Node.js/TypeScript)**

**Location:** `backend/src/`

**Technology Stack:**
- Express.js with TypeScript
- MongoDB with Mongoose ODM
- WebSocket (ws library)
- Winston logger
- Helmet, CORS, rate-limiting for security

**Key Components:**

#### Models (`backend/src/models/`)
| Model | Description |
|-------|-------------|
| `Attacker.ts` | Tracks attacker identity, IP, privilege level, campaign, dwell time |
| `AttackEvent.ts` | MITRE ATT&CK mapped events (technique, tactic, severity) |
| `Credential.ts` | Stolen credentials with risk scoring |
| `DecoyHost.ts` | Honeypot host definitions (segment, OS, services) |
| `LateralMovement.ts` | Tracks attacker pivot between hosts |
| `VMStatus.ts` | Real-time VM state (running, CRDT stats, Docker containers) |

#### Services (`backend/src/services/`)
| Service | Responsibility |
|---------|----------------|
| `CRDTSyncService.ts` | Synchronizes attacker state across VMs using CRDT theory; polls Vagrant VMs every 10s, updates VM status every 30s |
| `DashboardService.ts` | Aggregates statistics, timelines, MITRE matrix, behavior analysis |
| `AttackerMapper.ts` | Transforms raw DB data into frontend-ready attacker summaries |

#### WebSocket Handler (`backend/src/websocket/WebSocketHandler.ts`)
- Real-time bidirectional communication with frontend
- Broadcasts `NEW_EVENT`, `ATTACKER_UPDATED`, `SYNC_COMPLETE`
- Handles client requests for attacker profiles, timelines, MITRE matrix

#### API Routes (`backend/src/routes/dashboard.ts`)
```
GET /api/dashboard              # Full dashboard data
GET /api/dashboard/attackers    # Active attackers list
GET /api/dashboard/attacker/:id # Individual attacker dashboard
GET /api/dashboard/stats        # Summary statistics
GET /api/dashboard/timeline     # Attack timeline
GET /api/dashboard/mitre-matrix # MITRE ATT&CK matrix
GET /api/dashboard/lateral-movement # Lateral movement graph
GET /api/dashboard/commands     # Command execution activity
GET /api/vms                    # VM status endpoint
```

---

### 2. **Frontend Dashboard (Next.js/React)**

**Location:** `frontend/`

**Technology Stack:**
- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS + shadcn/ui components
- Recharts for visualization
- WebSocket for real-time updates

**Key Components:**

#### Pages
- `app/page.tsx` - Main dashboard with infrastructure overview, VM status, attacker list
- `app/attacker/[id]/page.tsx` - Individual attacker detail page

#### Dashboard Components (`components/dashboard/`)
| Component | Purpose |
|-----------|---------|
| `InfrastructureOverview.tsx` | Health score, active decoys, sessions, attackers |
| `VMStatusPanel.tsx` | Real-time VM running state with CRDT stats |
| `DockerContainersPanel.tsx` | Container status per VM |
| `AttackersContent.tsx` | Main attacker list view |
| `AttackersList.tsx` | Individual attacker cards |
| `AttackerProfile.tsx` | Detailed attacker profile |
| `AttackTimeline.tsx` | Chronological event timeline |
| `MITREMatrix.tsx` | ATT&CK technique heatmap |
| `LateralMovement.tsx` | Network graph of attacker pivots |
| `BehaviorAnalysis.tsx` | Attacker behavior patterns |
| `CredentialUsage.tsx` | Stolen credential tracking |

#### Custom Hooks (`hooks/`)
| Hook | Purpose |
|------|---------|
| `use-vm-status.ts` | Polls `/api/vms` + WebSocket updates for VM state |
| `use-realtime-attackers.ts` | Fetches active attackers, listens for real-time updates |
| `use-shared-websocket.ts` | Singleton WebSocket connection manager |
| `use-attacker-detail.ts` | Fetches individual attacker dashboard data |

#### API Proxy (`next.config.mjs`)
```javascript
rewrites() {
  return [
    { source: '/api/:path*', destination: 'http://localhost:3001/api/:path*' },
    { source: '/ws', destination: 'http://localhost:3001/ws' }
  ];
}
```

---

### 3. **Simulation Infrastructure (Vagrant + libvirt)**

**Location:** `simulations/`

#### Network Architecture
```
                    Internet
                        │
                  [ Kali Host ]
                        │
        ┌───────────────┴───────────────┐
        │                               │
   corp_net (real)                maya_net (fake)
   10.10.10.0/24                 10.20.20.0/24
        │                               │
   corp-web-01                  fake-jump-01
   corp-db-01                   fake-db-01
```

**Networks:**
- `corp_net` (10.10.10.0/24) - Real internal infrastructure (isolated)
- `maya_net` (10.20.20.0/24) - Deception fabric honeynet
- `virbr1` (192.168.121.0/24) - Default libvirt network

#### VMs (`simulations/fake/`)
| VM Name | IP | Role | OS |
|---------|-----|------|-----|
| `gateway-vm` | 192.168.10.5 / 10.20.20.1 | Honey wall, NAT, traffic redirection | Debian 12 |
| `fake-jump-01` | 10.20.20.10 | SSH jump server | Alpine 3.18 |
| `fake-web-01` | 10.20.20.20 | Web server (nginx) | Debian 12 |
| `fake-web-02` | 10.20.20.21 | Secondary web server | Debian 12 |
| `fake-ftp-01` | 10.20.20.30 | FTP server | Alpine 3.18 |
| `fake-rdp-01` | 10.20.20.40 | RDP server (decoy) | Debian 12 |
| `fake-smb-01` | 10.20.20.50 | SMB file server | Debian 12 |

**VM Features:**
- Docker macvlan networking (containers appear as physical hosts)
- CRDT sync binary (`syslogd-helper`) deployed to each VM
- SSH hooks (`/etc/profile.d/10-sys-audit.sh`)
- Logrotate hooks for CRDT synchronization
- Fake credentials, breadcrumbs, and lateral movement paths

---

### 4. **CRDT Synchronization (Rust)**

**Location:** `scripts/crdt/`

**Purpose:** Maintain consistent attacker state across distributed honeypot nodes without central coordination.

**CRDT Types Used:**
| Type | Purpose | Merge Rule |
|------|---------|------------|
| **G-Set** (Grow-only set) | Visited hosts, historical actions | Union |
| **AWOR-Set** (Add-wins observed-remove set) | Stolen credentials | Union adds - removes, adds win |
| **LWW-Register** (Last-write-wins) | Current attacker location | Higher timestamp wins |
| **LWW-Map** | Active sessions per host | Per-key LWW resolution |

**State File:** `/var/lib/.syscache` (JSON format)

**Commands:**
```bash
syslogd-helper observe <action>   # Record attacker action
syslogd-helper sync               # Sync with peers
syslogd-helper merge <file>       # Merge remote state
syslogd-helper stats              # Show local stats
```

**Sync Mechanisms:**
- SSH hook on jump hosts (randomized execution)
- HTTP endpoint on web servers (nginx internal location)
- Logrotate postrotate hooks
- Package manager hooks (apt post-invoke)

---

### 5. **Docker Honeypots**

**Location:** `scripts/docker/docker-compose.yml`

**Services:**
| Service | Container | Ports | Purpose |
|---------|-----------|-------|---------|
| **Cowrie** | `cowrie-ssh` | 2222 | SSH honeypot |
| **Dionaea** | `dionaea-malware` | 21,23,80,1433,3306,445 | Malware capture |
| **Conpot** | `conpot-ics` | 502,102,44818 | Industrial control systems |
| **Honeytrap** | `honeytrap` | 5900,1080 | Low-interaction honeypot |
| **Elasticsearch** | `elasticsearch` | 9200 | Log storage |
| **Logstash** | `logstash` | 5044 | Log processing |
| **Kibana** | `kibana` | 5601 | Log visualization |

---

## Configuration

### `config/infrastructure.json`

```json
{
  "gateway": {
    "name": "gateway-vm",
    "ip": "192.168.10.5",
    "internal_network": "10.20.20.0/24",
    "internal_gateway": "10.20.20.1"
  },
  "network": {
    "cidr": "192.168.10.0/24",
    "gateway": "192.168.10.1",
    "dns": "192.168.10.1",
    "honeypot_range": "192.168.10.240/28"
  },
  "segments": [
    { "name": "dmz", "network": "10.20.20.0/26", "vms": [...] },
    { "name": "database", "network": "10.20.20.64/26", "vms": [...] },
    { "name": "jump", "network": "10.20.20.128/26", "vms": [...] },
    { "name": "internal", "network": "10.20.20.192/26", "vms": [...] }
  ],
  "api": {
    "port": 3001,
    "cors_origins": ["http://localhost:3000", "http://localhost:5173"]
  }
}
```

### `backend/.env.example`

```env
PORT=3001
MONGODB_URI=mongodb://localhost:27017/maya_deception
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
NODE_ENV=development
LOG_LEVEL=info
CRDT_SYNC_INTERVAL=10000
VAGRANT_DIR=../simulations/fake
```

---

## Data Flow

### 1. Attacker Engagement Flow
```
1. Attacker scans network → hits honeypot (e.g., fake-web-01)
2. Attacker SSH login → /etc/profile.d/10-sys-audit.sh triggers
3. syslogd-helper observe records action to /var/lib/.syscache
4. CRDT sync (every 10s) → merges state across VMs
5. Backend polls VMs → updates MongoDB (VMStatus, Attacker, AttackEvent)
6. WebSocket broadcasts NEW_EVENT → frontend updates in real-time
```

### 2. Credential Theft Flow
```
1. Attacker finds fake credential on fake-web-01
2. Uses credential to SSH into fake-jump-01 (works!)
3. CRDT tracks credential usage across nodes
4. Backend creates Credential + AttackEvent documents
5. Dashboard shows credential usage graph
```

### 3. Lateral Movement Tracking
```
1. Attacker pivots: fake-web-01 → fake-jump-01 → fake-db-01
2. Each hop recorded in LateralMovement collection
3. Graph edges built from movement data
4. MITRE ATT&CK techniques mapped (T1021 - Remote Services)
```

---

## MITRE ATT&CK Mapping

The system automatically maps attacker actions to MITRE ATT&CK:

| Event Type | Technique | Tactic |
|------------|-----------|--------|
| SSH login | T1078 (Valid Accounts) | Initial Access |
| Mimikatz execution | T1003 (OS Credential Dumping) | Credential Access |
| SSH pivot | T1021 (Remote Services) | Lateral Movement |
| Web shell | T1505 (Server Software Component) | Persistence |
| Data download | T1041 (Exfiltration Over C2) | Exfiltration |

---

## Key Features

### 1. **Real-time Attacker Tracking**
- Live WebSocket updates
- Attacker profiles with dwell time, privilege level, campaign detection
- Geolocation and fingerprinting (user-agent, OS, tools)

### 2. **Deception Infrastructure Monitoring**
- VM health score
- Docker container visibility
- CRDT state synchronization status

### 3. **Attack Timeline Reconstruction**
- Chronological event view
- Severity-coded events
- Command execution logging

### 4. **MITRE ATT&CK Matrix**
- Visual heatmap of technique usage
- Coverage scoring per tactic
- Technique count aggregation

### 5. **Lateral Movement Graph**
- Network topology visualization
- Attack path reconstruction
- Success/failure indicators

### 6. **Credential Intelligence**
- Stolen credential tracking
- Risk scoring (admin = higher risk)
- Usage count and last-seen tracking

### 7. **Behavior Analysis**
- Privilege escalation detection
- Credential dumping patterns
- Data exfiltration attempts
- Threat confidence scoring

---

## Installation & Setup

### Prerequisites
- Node.js 18+
- MongoDB 6+
- Vagrant 2.4+
- libvirt + QEMU/KVM
- Docker + docker-compose
- Rust (for CRDT binary)

### Backend Setup
```bash
cd backend
npm install
cp .env.example .env
npm run build
npm run dev  # or npm start
```

### Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

### VM Infrastructure
```bash
# Create libvirt networks
virsh net-define simulations/corp_net.xml
virsh net-define simulations/maya_net.xml
virsh net-start corp_net
virsh net-start maya_net

# Build CRDT binary
cd scripts/crdt
cargo build --release --target x86_64-unknown-linux-musl

# Deploy infrastructure
./scripts/setup-infrastructure.sh setup
```

### VM Management
```bash
# List all VMs
./scripts/manage-vms.sh list

# Start specific VM
./scripts/manage-vms.sh start fake-jump-01

# SSH into VM
./scripts/manage-vms.sh ssh fake-web-01
```

---

## API Reference

### Health Check
```
GET /health
Response: {
  status: "healthy",
  websocketClients: 5,
  mongodb: "connected"
}
```

### Dashboard Stats
```
GET /api/dashboard/stats
Response: {
  activeAttackers: 3,
  deceptionEngagement: { rate: 75, level: "High" },
  dwellTime: { hours: 2, minutes: 15 },
  metrics: {
    totalEvents: 150,
    stolenCredentials: 12,
    compromisedHosts: 5
  }
}
```

### Active Attackers
```
GET /api/dashboard/active-attackers
Response: {
  success: true,
  data: [
    {
      id: "APT-10-20-20-100",
      ipAddress: "10.20.20.100",
      entryPoint: "fake-web-01",
      currentPrivilege: "Admin",
      riskLevel: "Critical",
      campaign: "Shadow Hydra",
      dwellTime: 145,
      engagementLevel: "High",
      threatConfidence: 95
    }
  ]
}
```

---

## Development Notes

### Code Style
- TypeScript strict mode
- ESLint + Prettier (frontend)
- Winston structured logging
- Async error handling with `asyncHandler` wrapper

### Testing
- Backend: No test suite currently (needs Jest/Mocha)
- Frontend: No test suite currently (needs Jest + React Testing Library)

### Known Issues
1. Duplicate provisioning blocks in Vagrantfiles (orchestrator appends multiple times)
2. Rate limiting on `/api/vms` can cause stale data
3. WebSocket reconnection logic needs improvement
4. No authentication on API endpoints

---

## Security Considerations

### Current Security Measures
- Helmet.js for HTTP headers
- CORS configuration
- Rate limiting (1000 req/15min)
- Input validation via Mongoose schemas
- Environment variable secrets (JWT, MongoDB URI)

### Security Gaps
- No API authentication (anyone can access `/api/*`)
- WebSocket has no auth
- MongoDB exposed on localhost without auth
- Vagrant VMs use weak default passwords

---

## Future Enhancements

1. **Authentication & Authorization**
   - JWT-based API access
   - Role-based dashboard access

2. **Machine Learning Integration**
   - Anomaly detection for attacker behavior
   - Automated campaign classification

3. **Advanced CRDT Features**
   - Peer-to-peer sync without central coordinator
   - Conflict resolution improvements

4. **Windows Honeypots**
   - Active Directory decoys
   - Windows Server eval VMs

5. **Threat Intelligence Integration**
   - MISP integration
   - STIX/TAXII export

6. **Automated Response**
   - IP blocking via iptables
   - Attacker containment workflows

---

## Research & Academic Value

This project demonstrates:
- **CRDT theory in practice** for distributed state management
- **MITRE ATT&CK mapping** for threat intelligence
- **Deception technology** as a detection mechanism
- **Lateral movement simulation** for red team training
- **Real-time analytics** with WebSocket + MongoDB

Suitable for:
- Cybersecurity thesis/dissertation
- Research paper on deception technologies
- SOC analyst training platform
- Red team/purple team exercises

---

## Credits & Dependencies

### Backend Dependencies
- express, mongoose, ws, winston
- helmet, cors, express-rate-limit
- jsonwebtoken, bcryptjs
- node-cron, uuid, lodash, moment

### Frontend Dependencies
- next, react, react-dom
- @radix-ui components (shadcn/ui)
- recharts, lucide-react
- tailwindcss, class-variance-authority
- zod, react-hook-form

### Infrastructure
- Vagrant + vagrant-libvirt
- QEMU/KVM
- Docker + docker-compose
- Rust (CRDT binary)

---

## Contact & Documentation

- **Main Documentation:** `README.md`, `simulations/README.md`, `simulations/doc.md`
- **CRDT Theory:** `scripts/crdt/README.md`, `GSet.md`, `LamportClock.md`, `LwwRegister.md`
- **Presentation:** `Synopsis Presentation.pptx`
- **Technical Details:** `Maya.pdf`

---

*Last Updated: February 17, 2026*
*Project Version: 1.0.0*
