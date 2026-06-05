# Testing Attacker Detection & Dashboard

## Quick Test (API Method)

This is the fastest way to test the attacker dashboard without waiting for CRDT sync.

### 1. Create a Test Attacker via API

```bash
# Make sure backend is running on port 3001
curl -X POST http://localhost:3001/api/dashboard/attacker \
  -H "Content-Type: application/json" \
  -d '{
    "attackerId": "APT-192-168-1-100",
    "ipAddress": "192.168.1.100",
    "entryPoint": "fake-web-01",
    "campaign": "Test Campaign Alpha"
  }'
```

This will:
- Create an attacker in MongoDB
- Create an initial attack event
- Return the full attacker dashboard data

### 2. View the Attacker Dashboard

Open your browser and navigate to:
```
http://localhost:3000/attacker/APT-192-168-1-100
```

You should see:
- Attacker profile with entry point and privilege level
- Attack timeline showing the initial access event
- MITRE ATT&CK matrix
- Lateral movement graph
- Behavior analysis
- Command activity
- Incident summary

### 3. Add More Events to the Attacker

```bash
# Add a lateral movement event
curl -X POST http://localhost:3001/api/dashboard/attacker/APT-192-168-1-100/event \
  -H "Content-Type: application/json" \
  -d '{
    "type": "Lateral Movement",
    "technique": "T1021",
    "tactic": "Lateral Movement",
    "description": "SSH pivot from fake-web-01 to fake-jump-01",
    "sourceHost": "fake-web-01",
    "targetHost": "fake-jump-01",
    "severity": "High"
  }'

# Add a credential theft event
curl -X POST http://localhost:3001/api/dashboard/attacker/APT-192-168-1-100/event \
  -H "Content-Type: application/json" \
  -d '{
    "type": "Credential Theft",
    "technique": "T1003",
    "tactic": "Credential Access",
    "description": "Mimikatz execution detected",
    "sourceHost": "fake-jump-01",
    "targetHost": "fake-jump-01",
    "severity": "Critical",
    "command": "mimikatz.exe sekurlsa::logonpasswords"
  }'
```

---

## Full Integration Test (VM + CRDT Method)

This tests the complete flow from VM → CRDT → MongoDB → Dashboard.

### Prerequisites

1. **Backend running:**
   ```bash
   cd backend
   npm run dev
   ```

2. **Frontend running:**
   ```bash
   cd frontend
   npm run dev
   ```

3. **VMs running:**
   ```bash
   ./scripts/manage-vms.sh list
   # Should show at least one VM as "Running"
   ```

### Step 1: SSH into a Honeypot VM

```bash
# Connect to fake-jump-01
./scripts/manage-vms.sh ssh fake-jump-01

# Or manually:
ssh admin@10.20.20.10
# Password: fakejump01!
```

### Step 2: Simulate Attacker Activity

Inside the VM, run these commands to simulate an attacker:

```bash
# Record a visit (simulates attacker arriving at this host)
sudo /usr/local/bin/syslogd-helper visit 10.20.20.100 fake-web-01

# Record an action (simulates attacker doing something)
sudo /usr/local/bin/syslogd-helper action 10.20.20.100 fake-web-01 "ssh_login_attempt"

# Record credential theft
sudo /usr/local/bin/syslogd-helper cred "admin:Winter2023!"

# Check the local state
sudo cat /var/lib/.syscache | jq
```

You should see output like:
```json
{
  "node_id": "fake-jump-01",
  "clock": { "counter": 3, "node_id": "fake-jump-01" },
  "attackers": {
    "10.20.20.100": {
      "visited_decoys": { "elements": ["fake-web-01"] },
      "actions_per_decoy": { "entries": {...} },
      "location": { "value": "ssh", "ts": 123, "node": "fake-jump-01" }
    }
  },
  "stolen_creds": { "adds": {...} },
  "active_sessions": { "entries": {...} }
}
```

### Step 3: Wait for CRDT Sync

The backend polls VMs every **10 seconds**. Wait about 15-20 seconds for the sync to occur.

Watch the backend logs:
```bash
# In backend terminal, you should see:
[INFO] Processed state from fake-jump-01: 1 attackers
[INFO] Sync complete: 1 attackers found across 7 VMs
[INFO] WebSocket broadcasting SYNC_COMPLETE
```

### Step 4: Check the Dashboard

1. **Open the main dashboard:**
   ```
   http://localhost:3000
   ```

2. **Check the attackers list** - You should see a new attacker card with:
   - Attacker ID (e.g., `APT-10-20-20-100`)
   - IP address
   - Entry point
   - Risk level
   - Engagement level

3. **Click on the attacker card** to view the full dashboard

### Step 5: Simulate Lateral Movement

SSH into another VM and simulate the attacker moving:

```bash
# In a new terminal, SSH into fake-web-02
./scripts/manage-vms.sh ssh fake-web-02

# Inside fake-web-02, record the attacker's arrival
sudo /usr/local/bin/syslogd-helper visit 10.20.20.100 fake-web-02
sudo /usr/local/bin/syslogd-helper action 10.20.20.100 fake-web-02 "privilege_escalation_attempt"

# Check state
sudo cat /var/lib/.syscache | jq
```

Wait for CRDT sync (10 seconds), then check the dashboard again. The attacker profile should now show:
- Multiple visited hosts
- Lateral movement graph
- More timeline events

---

## Troubleshooting

### Attacker Not Appearing in Dashboard

**Check backend logs:**
```bash
# Look for these log messages:
"Created new attacker: APT-10-20-20-100"
"Updated attacker: APT-10-20-20-100"
"WebSocket broadcasting SYNC_COMPLETE"
```

**Check MongoDB directly:**
```bash
mongosh

# Switch to database
use maya_deception

# Check attackers
db.attacker.find().pretty()

# Check events
db.attackevents.find().pretty()
```

**Manually trigger sync:**
```bash
# In backend, via WebSocket or:
curl http://localhost:3001/api/vms
```

### VM Commands Not Working

**Check if syslogd-helper exists:**
```bash
which syslogd-helper
# Should return: /usr/local/bin/syslogd-helper

# If not found, the CRDT binary wasn't deployed
# Run the setup script:
./scripts/setup-infrastructure.sh setup
```

**Check syslogd-helper stats:**
```bash
sudo syslogd-helper stats
# Should show:
# ===============================
# Node: fake-jump-01
# Lamport Clock: 3
# Attackers: 1
# Credentials: 1
# Sessions: 0
# ===============================
```

### WebSocket Not Connecting

**Check frontend console:**
- Open browser DevTools (F12)
- Look for: `Shared WebSocket connecting...`
- Should see: `Shared WebSocket connected`

**Check backend WebSocket logs:**
```bash
# Should see:
[INFO] New WebSocket client connected
[INFO] WebSocket broadcasting SYNC_COMPLETE
```

---

## Expected Dashboard Content

After successful testing, the attacker dashboard should show:

### 1. **Overview Metrics**
- Active Attackers: 1+
- Deception Engagement: Low/Medium/High
- Dwell Time Gained: e.g., "0h 5m"
- Risk Level: Medium/High/Critical

### 2. **Attacker Profile**
- Attacker ID: `APT-10-20-20-100`
- Entry Point: `fake-web-01`
- Current Privilege: `User` or `Admin`
- Last Seen: Recent timestamp

### 3. **Attack Timeline**
- Events in chronological order
- Each event shows: time, type, severity, description
- Example: "10:45 AM - Initial Access - High - Entry via fake-web-01"

### 4. **MITRE ATT&CK Matrix**
- Heatmap showing which techniques were used
- Tactics: Initial Access, Execution, Credential Access, etc.
- Colored by activity level (none/low/medium/high)

### 5. **Lateral Movement Graph**
- Nodes: hosts visited
- Edges: movement between hosts
- Labels: method (SSH, RDP, etc.)

### 6. **Behavior Analysis**
- Checkboxes showing detected behaviors:
  - ✓ Credential Dumping
  - ✓ Lateral Movement
  - ✓ Privilege Escalation
- Threat Confidence: 50-90%

### 7. **Command Activity**
- List of commands executed
- Severity scores
- Target hosts

### 8. **Incident Summary**
- Pie chart of event types
- Percentages for each category

---

## API Endpoints for Testing

### Get All Active Attackers
```bash
curl http://localhost:3001/api/dashboard/active-attackers | jq
```

### Get Specific Attacker Dashboard
```bash
curl http://localhost:3001/api/dashboard/attacker/APT-192-168-1-100 | jq
```

### Get Attack Timeline
```bash
curl "http://localhost:3001/api/dashboard/timeline?attackerId=APT-192-168-1-100&hours=24" | jq
```

### Get MITRE Matrix
```bash
curl "http://localhost:3001/api/dashboard/mitre-matrix?attackerId=APT-192-168-1-100" | jq
```

### Get Lateral Movement Graph
```bash
curl "http://localhost:3001/api/dashboard/lateral-movement?attackerId=APT-192-168-1-100" | jq
```

---

## Clean Up Test Data

To remove test attackers from MongoDB:

```bash
mongosh

use maya_deception

# Delete specific attacker
db.attacker.deleteOne({ attackerId: "APT-192-168-1-100" })

# Delete all test attackers
db.attacker.deleteMany({ campaign: "Test Campaign" })

# Delete all events for test attackers
db.attackevents.deleteMany({ attackerId: "APT-192-168-1-100" })
```

---

## Next Steps

Once basic testing works:

1. **Test with real attack tools:**
   - Run nmap scans against honeypots
   - Try SSH brute force
   - Attempt common web exploits

2. **Test CRDT synchronization:**
   - Create activity on multiple VMs
   - Verify state merges correctly
   - Check for duplicate events

3. **Test WebSocket real-time updates:**
   - Open dashboard in browser
   - Create new attacker activity
   - Watch dashboard update automatically (within 10-15 seconds)

4. **Test attacker profile navigation:**
   - Click on attacker cards from main dashboard
   - Verify all sections load correctly
   - Check that back button works
