
┌─────────────────────────────────────────────────────────────────────────┐
│                    ATTACKER DASHBOARD CREATION FLOW                      │
└─────────────────────────────────────────────────────────────────────────┘

1. User clicks simulation button (e.g., "Lateral Movement")
   ↓
2. Frontend: POST /api/simulation/lateral movement
   ↓
3. Backend: RealSimulationService.simulateLateralMovement()
   - Creates attacker with unique ID: attacker-10-20-20-156
   - Saves to MongoDB: Attacker collection
   - Emits: 'attackerUpdated' event
   ↓
4. For each attack step:
   - Creates AttackEvent with attackerId
   - Saves to MongoDB: AttackEvent collection
   - Emits: 'newEvent' via WebSocket
   ↓
5. Frontend: useAttackerDetail hook detects new attacker
   - Fetches: GET /api/dashboard/attacker/attacker-10-20-20-156
   ↓
6. Dashboard displays attacker-specific data:
   - Timeline (all events with this attackerId)
   - MITRE Matrix (techniques used by this attacker)
   - Lateral Movement (path this attacker took)
   - Commands (commands executed by this attacker)
   - Behavior Analysis (patterns of this attacker)
