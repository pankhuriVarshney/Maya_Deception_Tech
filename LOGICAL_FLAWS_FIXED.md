# Logical Flaws Found and Fixed

## Summary

Your CRDT system was **not working** because attacker IPs were being recorded as `"unknown"` instead of actual IP addresses. This caused a cascade of failures through the entire system.

---

## Root Cause: Environment Variable Loss with sudo

### The Flaw

**Location:** `scripts/crdt/src/main.rs::detect_attacker_id()`

**Original Code:**
```rust
fn detect_attacker_id() -> String {
    if let Ok(conn) = std::env::var("SSH_CONNECTION") {
        // extract IP
    }
    if let Ok(client) = std::env::var("SSH_CLIENT") {
        // extract IP
    }
    "unknown".to_string()  // ← Fallback when both fail
}
```

**Problem:** When you run `sudo syslogd-helper ...`, the sudo command strips environment variables for security. This means:
- `SSH_CONNECTION` is NOT available → fails
- `SSH_CLIENT` is NOT available → fails  
- Result: Always returns `"unknown"`

**Impact:**
```json
{
  "attackers": {
    "unknown": {  // ← Should be "10.20.20.100"
      "visited_decoys": ["fake-web-01"]
    }
  }
}
```

### The Fix

**Changed command signature** to accept attacker IP as explicit parameter:

```rust
// OLD (broken):
// syslogd-helper visit <decoy>  // Tries to auto-detect IP (fails)

// NEW (working):
// syslogd-helper visit <attacker_ip> <decoy>  // Explicit IP
sudo syslogd-helper visit 10.20.20.100 fake-web-01
```

**Updated main.rs:**
```rust
Some("visit") => {
    if let (Some(attacker_ip), Some(decoy)) = (args.get(2), args.get(3)) {
        state.observe_visit(attacker_ip, decoy);  // ← Use explicit IP
        state.save(STATE_FILE);
    }
}
```

---

## Flaw 2: Backend Creating "APT-unknown" Attackers

### The Flaw

**Location:** `backend/src/services/CRDTSyncService.ts::updateAttacker()`

**Code:**
```typescript
const attackerId = `APT-${attackerIp.replace(/\./g, '-')}`;
// When attackerIp = "unknown" → attackerId = "APT-unknown"
```

**Impact:**
- MongoDB filled with `APT-unknown` attacker
- Frontend can't display meaningful data
- All attackers merged into single "unknown" entity

### The Fix

Now that CRDT provides correct IPs, backend creates proper attacker IDs:
```typescript
// When attackerIp = "10.20.20.100" → attackerId = "APT-10-20-20-100"
```

---

## Flaw 3: Frontend Rate Limiting Blocking Updates

### The Flaw

**Location:** `frontend/hooks/use-realtime-attackers.ts`

**Original Code:**
```typescript
const now = Date.now()
if (now - lastFetchTime < 10000) return  // 10 second block
```

**Problem:** Even when WebSocket sent updates, the hook would refuse to fetch new data for 10 seconds.

**Impact:**
- Dashboard showed stale data
- New attackers didn't appear for 10+ seconds
- User had to manually refresh page

### The Fix

**Reduced cooldown + force parameter:**
```typescript
const FETCH_COOLDOWN = 2000  // 2 seconds instead of 10

// Allow force bypass for WebSocket triggers
if (!force && now - lastFetchTime < FETCH_COOLDOWN) return

// WebSocket calls fetchAttackers(true) to bypass limit
if (msg.type === 'SYNC_COMPLETE') {
  fetchAttackers(true)  // Force refresh
}
```

---

## Flaw 4: Missing Error Handling in CRDT State Parsing

### The Flaw

**Location:** `backend/src/services/CRDTSyncService.ts::performSync()`

**Original Code:**
```typescript
const state = JSON.parse(stdout);
await this.processState(state, vm);
```

**Problem:** No validation that state has expected structure. Silent failures when state is malformed.

### The Fix

**Added logging and validation:**
```typescript
logger.info(`Processing CRDT state from ${sourceHost}`);
logger.info(`State contents: attackers=${Object.keys(state.attackers || {}).length}`);

if (state.attackers) {
  logger.info(`Processing ${Object.keys(state.attackers).length} attackers`);
  for (const [attackerIp, attackerState] of Object.entries(state.attackers)) {
    logger.info(`Processing attacker: ${attackerIp}`);
    await this.updateAttacker(attackerIp, attackerState, sourceHost);
  }
}
```

---

## Flaw 5: Frontend Using Mock Data Instead of Real API

### The Flaw

**Location:** `frontend/app/attacker/[id]/page.tsx`

**Original Code:**
```typescript
import { getMockAttackerDetails } from "@/lib/attackers/mock"

const details = getMockAttackerDetails(id, new Date())  // ← MOCK DATA!
```

**Impact:**
- Attacker profile pages showed fake data
- Real attacker data from MongoDB was ignored
- Dashboard looked "working" but was completely disconnected from reality

### The Fix

**Switched to real API:**
```typescript
import { getAttackerDetailsFromApi } from "@/lib/attackers/api"

const initialDetails = await getAttackerDetailsFromApi(id).catch(() => null)
```

---

## Flaw 6: No Debug/Testing Tools

### The Flaw

**Problem:** No easy way to:
- Check what's in MongoDB
- Verify CRDT state is correct
- Test attacker creation without full VM workflow

### The Fix

**Added debug endpoints:**
```typescript
// GET /api/dashboard/debug/attackers
router.get('/debug/attackers', async (req, res) => {
  const allAttackers = await Attacker.find();
  const activeAttackers = await Attacker.find({ status: 'Active' });
  res.json({ allAttackers, activeAttackers });
});

// POST /api/dashboard/attacker (create test attacker)
router.post('/attacker', async (req, res) => {
  const { attackerId, ipAddress, entryPoint } = req.body;
  const attacker = new Attacker({ attackerId, ipAddress, entryPoint });
  await attacker.save();
});
```

**Added helper scripts:**
- `debug-attackers.sh` - Quick diagnostic checks
- `simulate-attack.sh` - Easy attack simulation

---

## Complete Data Flow (Fixed)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Attacker Activity on VM                                      │
│    sudo syslogd-helper visit 10.20.20.100 fake-web-01          │
│    ↓                                                            │
│    CRDT state updated: /var/lib/.syscache                      │
│    { "attackers": { "10.20.20.100": {...} } }                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. Backend CRDT Sync (every 10s)                                │
│    Polls VM: vagrant ssh -c "cat /var/lib/.syscache"           │
│    ↓                                                            │
│    Parses state, extracts attacker IP: "10.20.20.100"          │
│    ↓                                                            │
│    Creates MongoDB document:                                   │
│    Attacker.create({                                           │
│      attackerId: "APT-10-20-20-100",                          │
│      ipAddress: "10.20.20.100",                               │
│      entryPoint: "fake-web-01"                                │
│    })                                                          │
│    ↓                                                            │
│    Emits event: crdtSync.emit('attackerUpdated', attacker)     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. WebSocket Broadcast                                          │
│    WebSocket broadcasts:                                       │
│    { type: 'ATTACKER_UPDATED', data: attacker }                │
│    ↓                                                            │
│    All connected clients receive update                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. Frontend Updates                                             │
│    useRealtimeAttackers hook receives:                         │
│    WebSocket message → fetchAttackers(true)                    │
│    ↓                                                            │
│    Fetches from API: /api/dashboard/active-attackers           │
│    ↓                                                            │
│    Updates React state → Dashboard re-renders                  │
│    ↓                                                            │
│    New attacker card appears!                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Testing Checklist

Run these commands to verify everything works:

```bash
# 1. Check CRDT state on VM
./scripts/manage-vms.sh ssh fake-ftp-01 "sudo syslogd-helper stats"
# Should show: "Attackers: 1" with correct IP

# 2. Check state file
./scripts/manage-vms.sh ssh fake-ftp-01 "sudo cat /var/lib/.syscache" | jq '.attackers'
# Should show: { "10.20.20.100": {...} } NOT { "unknown": {...} }

# 3. Check backend logs
tail -f backend/logs/combined.log | grep -i "attacker"
# Should see: "Created new attacker: APT-10-20-20-100"

# 4. Check MongoDB
curl http://localhost:3001/api/dashboard/debug/attackers | jq '.data.activeAttackers'
# Should show array of attackers with real IPs

# 5. Check frontend
# Open http://localhost:3000
# Should see attacker cards with:
# - Correct attacker IDs (APT-10-20-20-100)
# - Correct IP addresses
# - Correct entry points
```

---

## Files Modified

| File | Issue | Fix |
|------|-------|-----|
| `scripts/crdt/src/main.rs` | Auto-detecting IP from env vars (fails with sudo) | Accept IP as explicit parameter |
| `frontend/hooks/use-realtime-attackers.ts` | 10s rate limit blocking updates | Reduced to 2s + force parameter |
| `frontend/hooks/use-vm-status.ts` | Same rate limit issue | Same fix |
| `frontend/hooks/use-attacker-detail.ts` | No WebSocket updates | Added WebSocket listener |
| `frontend/app/attacker/[id]/page.tsx` | Using mock data | Fetch from real API |
| `backend/src/services/CRDTSyncService.ts` | No logging | Added detailed logging |
| `backend/src/websocket/WebSocketHandler.ts` | Missing sync data in broadcasts | Include syncData |
| `backend/src/routes/dashboard.ts` | No debug tools | Added debug endpoints |
| `frontend/components/dashboard/attackers-content.tsx` | No debug info | Added attacker count comparison |
| `frontend/components/dashboard/vm-status-panel.tsx` | Missing 'error' status | Added error status config |

---

## Next Steps

1. **Rebuild CRDT binary:**
   ```bash
   cd scripts/crdt
   cargo build --release
   ```

2. **Deploy to VMs** (manual copy for now):
   ```bash
   # Inside each VM via SSH:
   # Copy the binary content and save as /usr/local/bin/syslogd-helper
   ```

3. **Clear old state:**
   ```bash
   ./scripts/manage-vms.sh ssh fake-ftp-01 "sudo rm /var/lib/.syscache"
   ```

4. **Test with correct commands:**
   ```bash
   ./scripts/manage-vms.sh ssh fake-ftp-01
   # Inside VM:
   sudo syslogd-helper visit 10.20.20.100 fake-web-01
   sudo syslogd-helper action 10.20.20.100 fake-web-01 "ssh_login"
   sudo syslogd-helper stats
   ```

5. **Wait 15 seconds** for backend sync

6. **Check dashboard** at http://localhost:3000
