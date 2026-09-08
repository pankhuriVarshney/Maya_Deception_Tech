# VM Detection Debug Guide

## Problem

When running SSH brute force simulations, the system uses mock data instead of real attacks because VMs are not being detected in the cache.

## Root Cause

The `simulateSSHBruteForce()` method checks if the target VM exists in the cache:

```typescript
if (!this.vmCache.has(target)) {
  logger.warn(`Target VM ${target} not running, using mock data`);
  return this.simulateSSHBruteForceMock(target, attempts);
}
```

If the VM is not in the cache, it falls back to mock data.

## Why VMs Might Not Be Detected

1. **VMs are not actually running** - Check with `virsh list` or `vagrant status`
2. **virsh/libvirt not available** - The discovery uses virsh first, then falls back to vagrant
3. **Vagrant commands timing out** - Slow VMs may cause timeouts
4. **Wrong VM directory path** - The code looks in `simulations/fake/`
5. **No Vagrantfile found** - VM directory is incomplete
6. **Cache not refreshed** - VMs started after backend started

## Diagnostic Steps

### 1. Run the Debug Script

```bash
./debug-vm-detection.sh
```

This script checks:
- virsh VM status
- vagrant VM status
- Backend VM cache
- Provides fix commands

### 2. Check VM Cache via API

```bash
# Check what VMs are in the cache
curl http://localhost:3001/api/simulation/vm-cache | jq

# Expected response:
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

If `count: 0`, VMs are not being detected.

### 3. Check VMs Directly

```bash
# Check with virsh
virsh list --all

# Check specific VM
virsh domstate fake-jump-01

# Should return: running
```

### 4. Check Backend Logs

```bash
# Watch backend logs for VM discovery messages
tail -f backend/logs/combined.log | grep -i "VM\|discovered"

# Look for:
# ✅ Discovered running VM: fake-jump-01 (IP: 10.20.20.10)
# OR
# ✗ Failed to discover VM fake-jump-01: <error>
```

## Solutions

### Solution 1: Force Refresh VM Cache

```bash
# Via API
curl -X POST http://localhost:3001/api/simulation/vm-cache/refresh

# Check result
curl http://localhost:3001/api/simulation/vm-cache | jq
```

### Solution 2: Manually Populate VM Cache

If automatic detection fails, manually specify VM details:

```bash
curl -X POST http://localhost:3001/api/simulation/vm-cache/populate \
  -H "Content-Type: application/json" \
  -d '{
    "vms": [
      {
        "name": "fake-jump-01",
        "path": "/home/maria/Documents/Maya/simulations/fake/fake-jump-01",
        "ip": "10.20.20.10"
      },
      {
        "name": "fake-web-01",
        "path": "/home/maria/Documents/Maya/simulations/fake/fake-web-01",
        "ip": "10.20.20.11"
      }
    ]
  }'
```

### Solution 3: Start VMs

If VMs are not running:

```bash
# Start specific VM
cd simulations/fake/fake-jump-01
vagrant up

# Or use the manage script
./scripts/manage-vms.sh start fake-jump-01
```

### Solution 4: Fix virsh/libvirt

If virsh is not working:

```bash
# Install libvirt
sudo apt update
sudo apt install libvirt-clients libvirt-daemon-system

# Add user to libvirt group
sudo usermod -aG libvirt $USER

# Restart libvirt
sudo systemctl restart libvirtd

# Test
virsh list
```

### Solution 5: Check Directory Path

The backend looks for VMs in `simulations/fake/`. Verify the path:

```bash
# Check if directory exists
ls -la simulations/fake/

# Should contain fake-* directories with Vagrantfiles
ls simulations/fake/fake-jump-01/Vagrantfile
```

If the path is different, set the `VAGRANT_DIR` environment variable:

```bash
export VAGRANT_DIR=/path/to/your/simulations/fake
cd backend
npm run dev
```

## Improved VM Detection (New)

The updated code now:

1. **Tries virsh first** - Faster and more reliable than vagrant
2. **Falls back to vagrant** - If virsh fails or VM not found
3. **Better logging** - Shows exactly what's happening
4. **Handles errors gracefully** - Doesn't crash on single VM failure
5. **Logs IP addresses** - Shows detected IPs for debugging

### Example Log Output

```
Scanning for VMs in: /home/maria/Documents/Maya/simulations/fake
Found 7 VM directories: [fake-db-01, fake-file-01, fake-ftp-01, ...]
virsh domstate fake-jump-01: running
Got IP from virsh: 10.20.20.10
✅ Discovered running VM: fake-jump-01 (IP: 10.20.20.10)
VM discovery complete: 3 running VMs cached
```

## Testing After Fix

### 1. Verify VM Cache

```bash
curl http://localhost:3001/api/simulation/vm-cache | jq
```

Should show your running VMs.

### 2. Run SSH Simulation

```bash
curl -X POST http://localhost:3001/api/simulation/ssh-bruteforce \
  -H "Content-Type: application/json" \
  -d '{"target": "fake-jump-01", "attempts": 3}'
```

### 3. Check Response

**Success (REAL attack):**
```json
{
  "success": true,
  "message": "REAL SSH brute force simulation executed on VM",
  "real": true,
  "attackerId": "APT-10-20-20-157"
}
```

**Failure (Mock fallback):**
```json
{
  "success": true,
  "message": "Mock simulation (VM not available)",
  "real": false
}
```

## Quick Reference

| Command | Purpose |
|---------|---------|
| `curl /api/simulation/vm-cache` | Check VM cache |
| `curl -X POST /api/simulation/vm-cache/refresh` | Force refresh |
| `curl -X POST /api/simulation/vm-cache/populate` | Manual populate |
| `virsh list` | List running VMs |
| `virsh domstate <vm>` | Check VM status |
| `./debug-vm-detection.sh` | Full diagnostic |

## Common Error Messages

### "Vagrant directory not found"
**Fix:** Set `VAGRANT_DIR` environment variable or create the directory.

### "No Vagrantfile found"
**Fix:** Ensure VM directory contains a Vagrantfile.

### "virsh failed"
**Fix:** Install libvirt or ensure VMs are created with libvirt provider.

### "Target VM not running, using mock data"
**Fix:** Start the VM or manually populate the cache.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ 1. Backend Starts                                       │
│    - Constructor calls discoverVMs()                   │
│    - Scans simulations/fake/ directory                 │
│    - Checks each fake-* VM with virsh/vagrant          │
│    - Populates vmCache Map                             │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 2. API Request: POST /api/simulation/ssh-bruteforce    │
│    - Calls ensureVMCacheFresh()                        │
│    - Calls refreshVMs() → discoverVMs()                │
│    - Re-scans all VMs                                  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 3. simulateSSHBruteForce()                              │
│    - Checks: this.vmCache.has(target)                  │
│    - If YES → Execute REAL attacks on VM               │
│    - If NO → Return MOCK data                          │
└─────────────────────────────────────────────────────────┘
```

## Prevention

To ensure VMs are always detected:

1. **Start VMs before backend** - Or refresh cache after starting VMs
2. **Use virsh/libvirt** - More reliable than vagrant for status detection
3. **Keep backend running** - Don't restart backend unnecessarily
4. **Monitor logs** - Watch for VM discovery errors
5. **Test detection** - Run `./debug-vm-detection.sh` periodically
