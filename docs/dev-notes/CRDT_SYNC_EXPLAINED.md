# CRDT Synchronization - How It Actually Works

## The Critical Discovery: **CRDT Peer-to-Peer Sync is BROKEN**

After analyzing your code, I found that **the CRDT synchronization between VMs is NOT working at all**. Here's the complete breakdown:

---

## What SHOULD Happen (The Design)

### Architecture Diagram
```
┌──────────────────────────────────────────────────────────────────┐
│                    Maya Deception Network                        │
│                     10.20.20.0/24                               │
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │fake-web-01  │    │fake-jump-01 │    │fake-ftp-01  │         │
│  │10.20.20.20  │    │10.20.20.10  │    │10.20.20.30  │         │
│  │             │    │             │    │             │         │
│  │ ┌─────────┐ │    │ ┌─────────┐ │    │ ┌─────────┐ │         │
│  │ │ MayaState│ │    │ │ MayaState│ │    │ │ MayaState│ │        │
│  │ │ G-Set   │ │    │ │ G-Set   │ │    │ │ G-Set   │ │         │
│  │ │ AWOR-Set│ │    │ │ AWOR-Set│ │    │ │ AWOR-Set│ │         │
│  │ │ LWW-Reg │ │    │ │ LWW-Reg │ │    │ │ LWW-Reg │ │         │
│  │ └─────────┘ │    │ └─────────┘ │    │ └─────────┘ │         │
│  │             │    │             │    │             │         │
│  │peers.conf:  │    │peers.conf:  │    │peers.conf:  │         │
│  │10.20.20.10  │    │10.20.20.20  │    │10.20.20.20  │         │
│  │10.20.20.30  │    │10.20.20.30  │    │10.20.20.10  │         │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘         │
│         │                  │                  │                 │
│         └──────────────────┼──────────────────┘                 │
│                            │                                     │
│                    [Periodic Sync via SSH]                      │
│                    Every 10 seconds (daemon)                     │
└──────────────────────────────────────────────────────────────────┘
                            │
                            │ Backend polls each VM
                            ↓
                    ┌───────────────┐
                    │   Backend     │
                    │   MongoDB     │
                    │   WebSocket   │
                    └───────────────┘
```

---

## What's ACTUALLY Happening (The Reality)

### Current Setup Script Configuration

**Location:** `scripts/setup-infrastructure.sh` line 309

```bash
echo '10.20.20.1' | sudo tee /etc/syslogd-helper/peers.conf
```

**Problem:** ALL VMs are configured with ONLY the gateway IP (`10.20.20.1`) as their peer!

### Current peers.conf on ALL VMs:
```
10.20.20.1
```

### What This Means:

1. **fake-web-01** tries to sync with → `10.20.20.1` (gateway)
2. **fake-jump-01** tries to sync with → `10.20.20.1` (gateway)
3. **fake-ftp-01** tries to sync with → `10.20.20.1` (gateway)

**BUT:** The gateway VM doesn't have the CRDT binary installed! It's not in the peer list for syncing.

### Result: **NO PEER-TO-PEER SYNC IS HAPPENING**

Each VM's `/var/lib/.syscache` is completely isolated from the others.

---

## The Sync Code (That's Not Running)

### Location: `scripts/crdt/src/main.rs`

```rust
fn sync_with_peers(state_file: &str, last_hash: &mut String) {
    let current_hash = hash_file(state_file);
    if *last_hash == current_hash { return; }  // Skip if unchanged
    *last_hash = current_hash;
    
    // Read peers list
    let peers = std::fs::read_to_string("/etc/syslogd-helper/peers.conf");
    if peers.is_err() { return; }  // Skip if no peers.conf
    
    for peer in peers.unwrap().lines() {
        if peer.trim().is_empty() { continue; }
        
        // SCP state file to peer
        let _ = Command::new("scp")
            .arg(state_file)
            .arg(format!("{}:/tmp/maya.state", peer))
            .output();
        
        // SSH to peer and trigger merge
        let _ = Command::new("ssh")
            .arg(peer)
            .arg("sudo syslogd-helper merge /tmp/maya.state")
            .output();
    }
}
```

### Why It's Not Running:

The `sync_with_peers` function is only called in the **daemon mode**:

```rust
fn run_daemon(mut state: MayaState) {
    let mut last_hash = state.hash();
    loop {
        sync_with_peers(STATE_FILE, &mut last_hash);  // ← Only place it's called
        
        // ... log parsing code ...
        
        state.save(STATE_FILE);
        thread::sleep(Duration::from_secs(10));
    }
}
```

**BUT:** The daemon is **never started** on any VM!

---

## How the Setup Actually Works

### What setup-infrastructure.sh Does:

1. **Copies binary to each VM:**
   ```bash
   sudo mv /tmp/maya-crdt /usr/local/bin/syslogd-helper
   sudo chmod 755 /usr/local/bin/syslogd-helper
   ```

2. **Creates peers.conf (WRONG):**
   ```bash
   echo '10.20.20.1' | sudo tee /etc/syslogd-helper/peers.conf
   ```

3. **Creates empty state file:**
   ```bash
   sudo touch /var/lib/.syscache
   sudo chmod 600 /var/lib/.syscache
   ```

4. **Sets up hooks** (SSH, logrotate, cron) that call:
   ```bash
   /usr/local/bin/syslogd-helper sync  # ← This command doesn't exist!
   ```

### Commands That Actually Exist:

```bash
syslogd-helper visit <ip> <decoy>      # ✓ Works
syslogd-helper action <ip> <decoy> <action>  # ✓ Works
syslogd-helper cred <username:password>      # ✓ Works
syslogd-helper merge <file>            # ✓ Works
syslogd-helper stats                   # ✓ Works
syslogd-helper daemon                  # ✓ Would start daemon (not configured)
syslogd-helper sync                    # ✗ DOESN'T EXIST!
```

---

## The Backend is Your REAL CRDT Sync

### Here's the Irony:

Your **backend** (`backend/src/services/CRDTSyncService.ts`) is doing all the actual synchronization:

```typescript
async performSync() {
  // 1. Poll ALL VMs
  for (const vm of vmDirs) {
    // 2. Read state file
    const { stdout } = await execAsync(
      `cd ${vmPath} && vagrant ssh -c "sudo cat /var/lib/.syscache"`
    );
    
    const state = JSON.parse(stdout);
    
    // 3. Merge in MongoDB
    await this.processState(state, vm);
  }
  
  // 4. Emit sync event
  this.emit('syncComplete');
}
```

### The Backend is Acting as a:
- **Central aggregator** - Collects state from all VMs
- **Merger** - Combines attacker data from multiple VMs
- **Distributor** - Sends merged data to frontend via WebSocket

**This is NOT a true CRDT implementation** - it's a **centralized database with eventual consistency**.

---

## Why Your System Still "Works"

Even though peer-to-peer CRDT sync is broken, the system appears to work because:

1. **Backend polls every 10 seconds** - Collects state from all VMs
2. **MongoDB merges the data** - Combines attacker records by IP
3. **Frontend shows merged view** - Displays unified attacker picture

### Example Flow:

```
Time 0: Attacker 10.20.20.100 visits fake-web-01
        fake-web-01 state: { attackers: { "10.20.20.100": {...} } }

Time 5s: Attacker pivots to fake-jump-01
         fake-jump-01 state: { attackers: { "10.20.20.100": {...} } }

Time 10s: Backend polls both VMs
          MongoDB merges:
          Attacker.create({
            attackerId: "APT-10-20-20-100",
            entryPoint: "fake-web-01",  // From first VM
            visitedHosts: ["fake-web-01", "fake-jump-01"]  // Merged
          })

Time 11s: Frontend shows attacker with full history
```

**This works WITHOUT peer-to-peer sync** because the backend is the central merger.

---

## What Would Break Without Backend Polling

If you relied ONLY on peer-to-peer CRDT sync:

1. **fake-web-01** knows about attacker `10.20.20.100`
2. **fake-jump-01** knows about attacker `10.20.20.100`
3. **fake-ftp-01** knows about attacker `10.20.20.100`

But **they never share this information** because:
- peers.conf only has gateway IP (which doesn't run CRDT)
- Daemon mode is never started
- `syslogd-helper sync` command doesn't exist

**Result:** Each VM has isolated attacker data. No global view.

---

## How to Fix Peer-to-Peer CRDT Sync

### Option 1: Fix peers.conf (Proper Mesh)

Update `setup-infrastructure.sh`:

```bash
# Each VM should know about ALL OTHER VMs
case "$VM_NAME" in
  "fake-web-01")
    echo -e "10.20.20.10\n10.20.20.30" > /etc/syslogd-helper/peers.conf
    ;;
  "fake-jump-01")
    echo -e "10.20.20.20\n10.20.20.30" > /etc/syslogd-helper/peers.conf
    ;;
  "fake-ftp-01")
    echo -e "10.20.20.10\n10.20.20.20" > /etc/syslogd-helper/peers.conf
    ;;
esac
```

### Option 2: Start Daemon Mode

Add to VM provisioning:

```bash
# Create systemd service
cat > /etc/systemd/system/maya-crdt.service << EOF
[Unit]
Description=Maya CRDT Synchronization Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/syslogd-helper daemon
Restart=always
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl enable maya-crdt
systemctl start maya-crdt
```

### Option 3: Keep Current Approach (Recommended)

**Honest truth:** Your backend-centric approach is **better** for this use case because:

1. **Simpler** - No complex peer-to-peer networking
2. **More reliable** - Backend always has complete view
3. **Easier to debug** - Single source of truth (MongoDB)
4. **Better for frontend** - WebSocket pushes from central point

**True CRDT peer-to-peer sync is overkill** for a honeypot dashboard.

---

## Recommended Architecture (Keep What Works)

```
┌──────────────────────────────────────────────────────────────┐
│ VMs (Isolated - No Peer Sync)                                │
│  fake-web-01: { attackers: {...} }                          │
│  fake-jump-01: { attackers: {...} }                         │
│  fake-ftp-01: { attackers: {...} }                          │
└──────────────────────────────────────────────────────────────┘
                        │
                        │ Backend polls every 10s
                        ↓
┌──────────────────────────────────────────────────────────────┐
│ Backend (Central Merger)                                     │
│  MongoDB: Merged attacker data                               │
│  WebSocket: Real-time updates to frontend                    │
└──────────────────────────────────────────────────────────────┘
                        │
                        ↓
┌──────────────────────────────────────────────────────────────┐
│ Frontend (Single View)                                       │
│  Dashboard: Complete attacker picture                        │
└──────────────────────────────────────────────────────────────┘
```

---

## What You Should Do

### Don't Fix Peer-to-Peer Sync

It's unnecessary complexity. Your current backend-centric approach works fine.

### DO Fix These Instead:

1. **Remove broken sync references from hooks:**
   ```bash
   # In setup-infrastructure.sh, replace:
   /usr/local/bin/syslogd-helper sync
   
   # With nothing (remove the hooks entirely)
   ```

2. **Update peers.conf documentation:**
   Add a comment explaining it's not used:
   ```bash
   # peers.conf is not currently used
   # Backend handles all synchronization via polling
   echo "# Not used - backend polls instead" > /etc/syslogd-helper/peers.conf
   ```

3. **Document the actual architecture:**
   Update README to explain that backend is the central merger, not peer-to-peer CRDT.

---

## Summary

| Component | Status | Notes |
|-----------|--------|-------|
| CRDT Binary | ✓ Working | Records attacker data correctly |
| peers.conf | ✗ Misconfigured | Only has gateway IP, not other VMs |
| sync_with_peers() | ✗ Never called | Only runs in daemon mode |
| daemon mode | ✗ Not started | No systemd service or init script |
| Backend polling | ✓ Working | This is what actually syncs data |
| MongoDB merging | ✓ Working | Central source of truth |
| Frontend display | ✓ Working | Shows merged attacker data |

**Conclusion:** Your "CRDT synchronization" is actually **backend polling with MongoDB merging**. The peer-to-peer CRDT code exists but is never executed. This is fine for your use case - just document it correctly and remove the broken sync hooks.
