# Maya Deception Tech - Prototype Demo Enhancements

## Overview

This document describes the enhancements made to the Maya Deception Tech dashboard to showcase the CRDT implementation and real-time attack detection capabilities for the company prototype demonstration.

---

## What Was Implemented

### 1. **Real-Time Alert Notification System** 🚨
**File:** `frontend/components/dashboard/real-time-alerts.tsx`

**Features:**
- Live alert notifications for all attack events
- Color-coded severity levels (Critical, High, Medium, Low, Info)
- Audio notifications with different tones for different severity levels
- Alert acknowledgment and dismissal
- Auto-dismiss for info-level alerts after 10 seconds
- Real-time WebSocket updates

**What it shows:**
- Immediate detection of attacker activities
- Visual representation of threat severity
- System responsiveness to new threats

---

### 2. **Attack Simulation Controls** 🎮
**File:** `frontend/components/dashboard/attack-simulation-controls.tsx`

**Features:**
- 6 pre-configured attack scenarios that can be triggered manually:
  1. **SSH Brute Force** - Simulates multiple failed logins followed by successful credential use
  2. **Lateral Movement** - Shows attacker pivoting between hosts
  3. **Credential Dumping** - Mimikatz-style credential extraction
  4. **Network Discovery** - Reconnaissance and scanning activities
  5. **Privilege Escalation** - Gaining elevated privileges
  6. **Full Attack Campaign** - Complete multi-stage attack chain

- "Force CRDT Sync" button to manually trigger synchronization
- Visual feedback for simulation status
- Last-run timestamps for each scenario

**What it shows:**
- Interactive demo capability for presentations
- Real-time attack detection and visualization
- CRDT synchronization across distributed systems
- MITRE ATT&CK technique mapping

**Backend API:** `backend/src/routes/simulation.ts`
- POST `/api/simulation/ssh-bruteforce`
- POST `/api/simulation/lateral-movement`
- POST `/api/simulation/credential-theft`
- POST `/api/simulation/discovery`
- POST `/api/simulation/privilege-escalation`
- POST `/api/simulation/full-campaign`
- POST `/api/simulation/trigger-sync`

---

### 3. **CRDT Synchronization Status Panel** 🔄
**File:** `frontend/components/dashboard/crdt-sync-status.tsx`

**Features:**
- Real-time sync health indicator (Healthy/Degraded/Offline)
- Total attackers tracked across all VMs
- Active VMs participating in synchronization
- Credentials tracked in CRDT
- Last sync timestamp with "time ago" display
- Per-VM synchronization status
- Mini chart showing recent sync activity
- Educational footer explaining how CRDT sync works

**What it shows:**
- **The CRDT implementation is working** - live stats from each VM
- Distributed state synchronization in action
- System health and reliability
- Data consistency across the deception infrastructure

**Key Metrics Displayed:**
- Attackers synchronized from all VMs
- Credentials tracked via CRDT G-Set and AWOR-Set
- Active sessions via LWW-Map
- Individual VM sync status

---

### 4. **Live Activity Feed** 📊
**File:** `frontend/components/dashboard/live-activity-feed.tsx`

**Features:**
- Real-time scrolling feed of all attack events
- Event categorization by type (Credential Theft, Lateral Movement, etc.)
- MITRE ATT&CK technique tags
- Severity badges
- Source and target host information
- Pause/Resume functionality
- Export to JSON capability
- Initial history load from backend

**What it shows:**
- Continuous monitoring and detection
- Rich event metadata (technique, tactic, severity)
- Attack timeline reconstruction
- Command execution tracking

---

### 5. **System Health Indicator** 💚
**File:** `frontend/components/dashboard/system-health-indicator.tsx`

**Features:**
- WebSocket connection status (Connected/Disconnected)
- Backend API health (Healthy/Degraded/Offline)
- MongoDB connection status
- API response time monitoring
- Auto-refresh every 30 seconds

**Location:** Displayed in the navbar

**What it shows:**
- System reliability and uptime
- Real-time connectivity status
- Performance metrics

---

### 6. **Backend Simulation Service** ⚙️
**File:** `backend/src/services/SimulationService.ts`

**Features:**
- Event generation for all attack scenarios
- Automatic attacker record creation
- MITRE ATT&CK technique mapping
- Credential theft simulation
- Lateral movement tracking
- WebSocket event broadcasting
- CRDT sync integration

**Integration:**
- Wired into WebSocket handler for real-time broadcasts
- Emits `newEvent`, `simulationComplete`, and `triggerSync` events
- Creates realistic MongoDB documents (Attacker, AttackEvent, Credential, LateralMovement)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Frontend Dashboard (Next.js)                                    │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │  Attack Simulation Controls                                 │ │
│ │  [SSH Brute] [Lateral] [Creds] [Discovery] [PrivEsc] [Full]│ │
│ └─────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │  Real-Time Alert System                                     │ │
│ │  🚨 Critical: Attacker gained admin access                  │ │
│ │  ⚠️  High: Lateral movement detected                        │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │  CRDT Sync Status Panel                                     │ │
│ │  ✅ Healthy | 5 Attackers | 6 VMs | 12 Credentials          │ │
│ │  [VM1: 2 attackers] [VM2: 3 attackers] [VM3: 1 attacker]   │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │  Live Activity Feed                                         │ │
│ │  [10:45:23] T1003 - Credential Theft on fake-web-01        │ │
│ │  [10:45:25] T1021 - Lateral Movement to fake-jump-01       │ │
│ │  [10:45:30] T1078 - Privilege Escalation on fake-ftp-01    │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ WebSocket (Real-Time)
                            │ HTTP API (Simulations)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Backend API (Node.js/TypeScript)                                │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │  Simulation Service                                         │ │
│ │  - Generates attack events                                  │ │
│ │  - Creates MongoDB documents                                │ │
│ │  - Emits WebSocket events                                   │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │  CRDT Sync Service                                          │ │
│ │  - Polls VMs every 10 seconds                               │ │
│ │  - Reads /var/lib/.syscache from each VM                   │ │
│ │  - Merges CRDT state in MongoDB                             │ │
│ │  - Emits sync events                                        │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │  WebSocket Handler                                          │ │
│ │  - Broadcasts NEW_EVENT                                     │ │
│ │  - Broadcasts SYNC_COMPLETE                                 │ │
│ │  - Broadcasts SIMULATION_COMPLETE                           │ │
│ │  - Sends INITIAL_STATE to new clients                       │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ Polling (every 10s)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Deception Infrastructure (Vagrant VMs)                          │
│ ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│ │ fake-web-01  │  │ fake-jump-01 │  │ fake-ftp-01  │          │
│ │ /var/lib/    │  │ /var/lib/    │  │ /var/lib/    │          │
│ │ .syscache    │  │ .syscache    │  │ .syscache    │          │
│ │ (CRDT State) │  │ (CRDT State) │  │ (CRDT State) │          │
│ └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

---

## How to Demo the Prototype

### Step 1: Start the Backend
```bash
cd backend
npm run dev
```

### Step 2: Start the Frontend
```bash
cd frontend
npm run dev
```

### Step 3: Open the Dashboard
Navigate to `http://localhost:3000`

### Step 4: Demonstrate Features

#### A. Show System Health
- Point to the navbar showing WebSocket connected, backend healthy, MongoDB connected
- Explain the real-time monitoring capability

#### B. Run Attack Simulations
1. Click **"SSH Brute Force Attack"** - Watch alerts appear in real-time
2. Click **"Lateral Movement"** - Show attacker pivoting between hosts
3. Click **"Credential Dumping"** - Demonstrate Mimikatz detection
4. Click **"Full Attack Campaign"** - Show complete attack chain

#### C. Monitor CRDT Synchronization
- Point to the **CRDT Sync Status Panel**
- Show attacker count increasing as simulations run
- Explain how each VM maintains independent CRDT state
- Show the backend merging data from all VMs

#### D. Watch Live Activity Feed
- Point to the **Live Activity Feed**
- Explain how each event is mapped to MITRE ATT&CK
- Show the variety of event types being detected

#### E. Review Real-Time Alerts
- Point to the **Real-Time Alerts** panel
- Show color-coded severity levels
- Acknowledge a critical alert to demonstrate interaction

---

## Key Talking Points for the Demo

### About CRDT Implementation:
1. **"Each VM maintains independent CRDT state in `/var/lib/.syscache`"**
2. **"The backend polls every 10 seconds and merges attacker data"**
3. **"We use G-Sets for visited hosts, AWOR-Sets for credentials, and LWW-Registers for location"**
4. **"This ensures eventual consistency without requiring peer-to-peer networking"**

### About Real-Time Detection:
1. **"All attack events are detected and displayed in real-time via WebSocket"**
2. **"Events are automatically mapped to MITRE ATT&CK techniques"**
3. **"The system tracks attacker dwell time, privilege level, and campaign attribution"**

### About the Architecture:
1. **"Centralized aggregation with distributed data collection"**
2. **"Backend acts as the CRDT merger, providing a unified view"**
3. **"WebSocket pushes updates to all connected clients instantly"**

---

## Files Added/Modified

### New Frontend Components:
- `frontend/components/dashboard/real-time-alerts.tsx`
- `frontend/components/dashboard/attack-simulation-controls.tsx`
- `frontend/components/dashboard/crdt-sync-status.tsx`
- `frontend/components/dashboard/live-activity-feed.tsx`
- `frontend/components/dashboard/system-health-indicator.tsx`

### New Backend Services:
- `backend/src/services/SimulationService.ts`
- `backend/src/routes/simulation.ts`

### Modified Files:
- `frontend/app/page.tsx` - Added new components to dashboard
- `backend/src/server.ts` - Added simulation routes
- `backend/src/websocket/WebSocketHandler.ts` - Wired simulation events
- `frontend/components/dashboard/navbar.tsx` - Added health indicator
- `frontend/hooks/use-vm-status.ts` - Added totalVMs metric
- `frontend/types.ts` - Extended AttackerSummary type
- `frontend/lib/mappers/attacker-mapper.ts` - Fixed type mappings

---

## Testing the Prototype Without VMs

If your VMs are not running, you can still demonstrate the system:

1. **Run simulations** - They create mock data in MongoDB
2. **Show real-time alerts** - Simulations trigger alerts automatically
3. **Show activity feed** - Simulations generate events
4. **Show CRDT sync status** - Will show 0 attackers but healthy system

---

## Next Steps for Production

1. **Deploy VMs** - Run `./scripts/setup-infrastructure.sh setup`
2. **Start backend** - Ensure MongoDB is running
3. **Configure VAGRANT_DIR** - Set environment variable if needed
4. **Test with real attacks** - Use Kali to attack the honeypots
5. **Monitor CRDT sync** - Watch stats panel for real VM data

---

## Summary

This prototype enhancement package provides:
- ✅ **Interactive attack simulation** for live demos
- ✅ **Real-time alert notifications** showing threat detection
- ✅ **CRDT sync visualization** proving distributed state management works
- ✅ **Live activity feed** demonstrating continuous monitoring
- ✅ **System health indicators** showing platform reliability
- ✅ **MITRE ATT&CK mapping** showing threat intelligence integration

**The prototype is ready to present to the company!** 🚀
