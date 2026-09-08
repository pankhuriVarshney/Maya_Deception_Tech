# VM Cache Refresh Fix for Attack Simulations

## Problem

When executing attack simulations, the system was **always using mock services** instead of the actual attack simulation scripts on real VMs.

### Root Cause

The `RealSimulationService` maintains a `vmCache` (Map) of running VMs that is populated **once at startup**:

```typescript
// backend/src/services/RealSimulationService.ts
constructor() {
  this.discoverVMs(); // Called once when service initializes
}
```

The `discoverVMs()` method queries the `VMStatus` MongoDB collection for VMs with `status: 'running'`.

**The Issue:**
1. Backend starts → `RealSimulationService` initializes → queries `VMStatus` table
2. If VMs aren't running yet or DB is empty at that moment → `vmCache` is empty
3. When you click "Run Simulation" → checks `vmCache.has(target)` → returns `false`
4. Falls back to mock simulation

All simulation methods check the cache before executing:
```typescript
if (!this.vmCache.has(target)) {
  logger.warn(`Target VM ${target} not running, using mock data`);
  return this.simulateSSHBruteForceMock(target, attempts);
}
```

## Solution

### 1. Backend: Auto-refresh VM cache before each simulation

**File:** `backend/src/routes/simulation.ts`

Added `ensureVMCacheFresh()` helper that refreshes the VM cache before every simulation:

```typescript
async function ensureVMCacheFresh() {
  const vmStatus = await simulationService.refreshVMs();
  logger.info(`VM cache refreshed: ${vmStatus.count} running VMs found`);
  return vmStatus;
}

// Used in all simulation routes:
router.post('/ssh-bruteforce', async (req, res) => {
  await ensureVMCacheFresh(); // ← Refresh before simulation
  const result = await simulationService.simulateSSHBruteForce({ target, attempts });
  // ...
});
```

This ensures the `vmCache` is always up-to-date with the latest VM status from the database.

### 2. Frontend: Refresh VM cache before running simulations

**File:** `frontend/components/dashboard/attack-simulation-controls.tsx`

Added VM refresh call at the start of `runSimulation()`:

```typescript
const runSimulation = async (scenario: SimulationScenario) => {
  setIsRunning(scenario.id)

  try {
    // FIRST: Refresh VM cache to ensure we have latest running VMs
    await fetch("/api/simulation/refresh-vms", { method: "POST" })

    const response = await fetch(scenario.endpoint, {
      method: "POST",
      // ...
    })
    // ...
  }
}
```

## How It Works Now

1. User clicks "Run Simulation" in frontend
2. Frontend calls `/api/simulation/refresh-vms` to update VM cache
3. Backend route also calls `ensureVMCacheFresh()` for redundancy
4. `refreshVMs()` queries `VMStatus` collection for all `status: 'running'` VMs
5. `vmCache` is populated with current running VMs (IPs, paths)
6. Simulation executes on **real VM** if target is in cache
7. Falls back to mock **only if VM truly not available**

## VM Status Flow

```
┌─────────────────┐
│ CRDTSyncService │ (runs every 30s)
│   ↓ updates     │
│ VMStatus DB     │
└────────┬────────┘
         │
         ↓ queries
┌─────────────────┐
│ RealSimulation  │
│ Service         │
│   ↓ checks      │
│ vmCache         │
└────────┬────────┘
         │
         ↓ executes on
┌─────────────────┐
│ Real VMs via    │
│ vagrant SSH     │
└─────────────────┘
```

## Testing

1. **Start your Vagrant VMs:**
   ```bash
   cd simulations/fake-web
   vagrant up
   ```

2. **Restart the backend** (to pick up the changes):
   ```bash
   cd backend
   npm run dev
   ```

3. **Run a simulation** from the frontend:
   - Click "Run Simulation" on any attack scenario
   - Check the toast notification - it should say "**REAL** Simulation Started"
   - Check backend logs for: `🎯 Starting REAL SSH brute force simulation on fake-jump-01`

4. **Verify in database:**
   ```javascript
   // MongoDB
   db.attackevents.find().sort({timestamp: -1}).limit(5)
   ```
   
   Events should have real VM hostnames, not mock data.

## Files Changed

- `backend/src/routes/simulation.ts` - Added VM cache refresh before all simulations
- `frontend/components/dashboard/attack-simulation-controls.tsx` - Added VM refresh before simulation calls

## Verification Commands

Check VM cache status:
```bash
curl http://localhost:3001/api/simulation/status
```

Check running VMs in database:
```bash
mongosh maya_deception --eval "db.vm_status.find({status: 'running'}).pretty()"
```

Trigger VM refresh manually:
```bash
curl -X POST http://localhost:3001/api/simulation/refresh-vms
```
