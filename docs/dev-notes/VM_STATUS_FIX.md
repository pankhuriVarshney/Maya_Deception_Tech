# VM Status Check Fix - Using Correct Domain Naming

## Problem

The VM status detection was using the wrong libvirt domain name format, causing VMs to not be detected as running.

### Wrong Approach (Before)
```bash
virsh domstate fake-jump-01
# Returns: error: failed to get domain state
```

### Correct Approach (from check_vms.sh)
```bash
virsh domstate fake-jump-01_default
# Returns: running
```

Vagrant creates libvirt domains with the `_default` suffix by default.

---

## Changes Made

### 1. RealSimulationService.ts

**File:** `backend/src/services/RealSimulationService.ts`

#### Changed: VM List
```typescript
// OLD: Dynamic discovery (unreliable)
const vmDirs = fs.readdirSync(this.vagrantDir)
  .filter(dir => dir.startsWith('fake-'));

// NEW: Explicit list from check_vms.sh
const vmNames = [
  'gateway-vm',
  'fake-ftp-01', 'fake-jump-01', 'fake-rdp-01', 'fake-smb-01',
  'fake-ssh-01', 'fake-web-01', 'fake-web-02', 'fake-web-03'
];
```

#### Changed: Virsh Domain Name
```typescript
// OLD: Wrong domain name
const { stdout } = await execAsync(
  `virsh domstate ${vmName} 2>&1`
);

// NEW: Correct domain name with _default suffix
const domainName = `${vmName}_default`;
const { stdout } = await execAsync(
  `virsh domstate ${domainName} 2>/dev/null || echo ""`
);
```

#### Changed: Status Detection Priority
```typescript
// 1. vagrant status --machine-readable (PRIMARY)
//    Parse: timestamp,provider,state,state-short,state-long

// 2. virsh domstate <vm>_default (SECONDARY but trusted)
//    If virsh says "running" but vagrant doesn't → trust virsh

// 3. vagrant ssh hostname -I (for IP address)
```

---

### 2. CRDTSyncService.ts

**File:** `backend/src/services/CRDTSyncService.ts`

#### Changed: Same VM List
```typescript
// Use same VM list as check_vms.sh
const vmNames = [
  'gateway-vm',
  'fake-ftp-01', 'fake-jump-01', 'fake-rdp-01', 'fake-smb-01',
  'fake-ssh-01', 'fake-web-01', 'fake-web-02', 'fake-web-03'
];
```

#### Changed: Correct Domain Name for CRDT Sync
```typescript
// OLD
const { stdout } = await execAsync(
  `virsh domstate ${vm} 2>&1`
);

// NEW
const domainName = `${vm}_default`;
const { stdout } = await execAsync(
  `virsh domstate ${domainName} 2>/dev/null || echo ""`
);
```

---

## How It Works Now

### VM Status Detection Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. Check VM directory exists                            │
│    /home/maria/Documents/Maya/simulations/fake/<vm>    │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 2. Check Vagrantfile exists                             │
│    Skip if missing                                      │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 3. vagrant status --machine-readable                    │
│    Parse: timestamp,provider,state,state-short          │
│    Extract: state = "running" | "shutoff" | "not_created"│
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 4. virsh domstate <vm>_default                          │
│    Cross-check with libvirt                             │
│    If virsh says "running" → trust it                   │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 5. If running: vagrant ssh hostname -I                  │
│    Get IP address                                       │
│    Clean output (remove \r, take first IP)              │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 6. Add to cache                                         │
│    vmCache.set(vmName, { path, ip })                   │
│    Log: ✅ <vm>: running (virsh: <state>, IP: <ip>)    │
└─────────────────────────────────────────────────────────┘
```

---

## Testing

### 1. Compare with check_vms.sh

```bash
# Run the original script
cd simulations/fake
./check_vms.sh

# Should show:
# ✅ fake-jump-01
#    Status: running (virsh: running)
#    IP: 10.20.20.10
```

### 2. Check Backend Logs

```bash
# Start backend
cd backend
npm run dev

# Watch for VM discovery logs
tail -f backend/logs/combined.log | grep -E "✅|virsh|VM"

# Expected output:
# Checking 10 VMs: [gateway-vm, fake-ftp-01, fake-jump-01, ...]
# vagrant status fake-jump-01: running
# virsh domstate fake-jump-01_default: running
# ✅ fake-jump-01: running (virsh: running, IP: 10.20.20.10)
# VM discovery complete: 3 running VMs cached
```

### 3. Test VM Cache API

```bash
# Check VM cache
curl http://localhost:3001/api/simulation/vm-cache | jq

# Expected:
{
  "success": true,
  "data": {
    "count": 3,
    "vms": [
      {"name": "fake-jump-01", "ip": "10.20.20.10", "path": "..."},
      ...
    ]
  }
}
```

### 4. Test Real Attack Simulation

```bash
# Trigger SSH brute force
curl -X POST http://localhost:3001/api/simulation/ssh-bruteforce \
  -H "Content-Type: application/json" \
  -d '{"target": "fake-jump-01", "attempts": 3}'

# Expected response (REAL attack):
{
  "success": true,
  "message": "REAL SSH brute force simulation executed on VM",
  "real": true,
  "attackerId": "APT-10-20-20-157"
}
```

---

## Why This Fix Works

### Vagrant + Libvirt Naming

When you create a VM with Vagrant using the libvirt provider:

```bash
cd simulations/fake/fake-jump-01
vagrant up
```

Vagrant creates a libvirt domain with the format: `<directory_name>_<random_suffix>`

By default, the suffix is `_default` (can be configured in Vagrantfile).

### Domain Name Examples

| Directory | Libvirt Domain Name |
|-----------|---------------------|
| `fake-jump-01` | `fake-jump-01_default` |
| `fake-web-01` | `fake-web-01_default` |
| `gateway-vm` | `gateway-vm_default` |

### Commands Comparison

```bash
# ❌ WRONG - Domain not found
virsh domstate fake-jump-01
# Error: Domain not found

# ✅ CORRECT - Returns state
virsh domstate fake-jump-01_default
# running

# ✅ Also works
virsh list --all | grep fake-jump-01
#  123  fake-jump-01_default    running
```

---

## Files Modified

| File | Changes |
|------|---------|
| `backend/src/services/RealSimulationService.ts` | - Use explicit VM list from check_vms.sh<br>- Use `${vm}_default` for virsh<br>- Trust virsh if it says running |
| `backend/src/services/CRDTSyncService.ts` | - Use explicit VM list<br>- Use `${vm}_default` for virsh in CRDT sync |

---

## Benefits

1. **Accurate VM Detection** - Uses correct libvirt domain names
2. **Consistent with check_vms.sh** - Same VM list, same detection method
3. **Fallback Logic** - Trusts virsh even if vagrant fails
4. **Better Logging** - Shows both vagrant and virsh status
5. **IP Address Handling** - Properly cleans and parses IP output

---

## Troubleshooting

### If VMs Still Not Detected

1. **Check libvirt domain names:**
   ```bash
   virsh list --all | grep fake
   # Should show: fake-jump-01_default, etc.
   ```

2. **If domain names are different:**
   ```bash
   # Find actual domain names
   virsh list --all
   
   # Update VM list in code if needed
   # Or rename domains to match _default pattern
   ```

3. **If virsh not available:**
   ```bash
   # Install libvirt
   sudo apt install libvirt-clients libvirt-daemon-system
   
   # Add user to libvirt group
   sudo usermod -aG libvirt $USER
   ```

4. **Manual cache population (last resort):**
   ```bash
   curl -X POST http://localhost:3001/api/simulation/vm-cache/populate \
     -H "Content-Type: application/json" \
     -d '{
       "vms": [
         {"name": "fake-jump-01", "path": "/path/to/vm", "ip": "10.20.20.10"}
       ]
     }'
   ```

---

## Reference: check_vms.sh

The original script that uses the correct technique:

```bash
# Get status from vagrant
status=$(vagrant status --machine-readable | grep ",state," | cut -d, -f4 | head -1)

# Get status from virsh for more detail
virsh_status=$(virsh domstate "${vm}_default" 2>/dev/null | head -1)

# Get IP if running
if [ "$status" = "running" ]; then
    ip=$(vagrant ssh -c "hostname -I | awk '{print \$1}'" 2>/dev/null)
fi
```

This is now replicated in the TypeScript code.
