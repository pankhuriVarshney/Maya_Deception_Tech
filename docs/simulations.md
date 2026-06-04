# How to Simulate Attacks (Working Method)

## The Problem

The CRDT binary couldn't auto-detect attacker IPs when running commands with `sudo` because:
- `SSH_CONNECTION` environment variable is stripped by sudo
- `SSH_CLIENT` environment variable is stripped by sudo
- Result: All attackers were being recorded as "unknown"

## The Solution

**Always specify the attacker IP explicitly** when running commands:

### Old (Broken) Way:
```bash
# DON'T DO THIS - will record attacker as "unknown"
sudo syslogd-helper visit 10.20.20.100 fake-web-01
sudo syslogd-helper action 10.20.20.100 fake-web-01 "ssh_login"
```

### New (Working) Way:
```bash
# DO THIS - explicitly specify attacker IP as first argument
sudo syslogd-helper visit 10.20.20.100 fake-web-01
sudo syslogd-helper action 10.20.20.100 fake-web-01 "ssh_login"
```

Wait, the commands look the same! The difference is in the **Rust code parsing**:
- Old code: Tried to auto-detect IP from environment (failed with sudo)
- New code: Uses the first argument as the attacker IP directly

## Quick Start

### 1. Rebuild and Deploy the Binary

On your host machine:
```bash
cd /home/patrick/Documents/Maya_Deception_Tech/scripts/crdt
cargo build --release

# Copy to VM
scp target/release/maya-crdt vagrant@10.20.20.10:/tmp/maya-crdt
# Or use vagrant ssh to copy manually
```

Inside each VM:
```bash
sudo mv /tmp/maya-crdt /usr/local/bin/syslogd-helper
sudo chmod +x /usr/local/bin/syslogd-helper
```

### 2. Simulate an Attack

SSH into a honeypot VM:
```bash
./scripts/manage-vms.sh ssh fake-ftp-01
```

Inside the VM, run these commands:
```bash
# Record attacker arriving at this host
sudo syslogd-helper visit 10.20.20.100 fake-web-01

# Record attacker doing something
sudo syslogd-helper action 10.20.20.100 fake-web-01 "ssh_login_attempt"

# Record credential theft
sudo syslogd-helper cred "admin:Winter2023!"

# Check the state
sudo syslogd-helper stats
```

You should see output like:
```
===============================
Node: fake-ftp-01
Lamport Clock: 3
Attackers: 1
Credentials: 1
Sessions: 0
Decoys visited: 1
State hash: abc123...
===============================

Tracked Attackers:
  - IP: 10.20.20.100 | Visited: 1 decoys
```

**Notice:** The IP should now be `10.20.20.100` NOT `unknown`!

### 3. Wait for CRDT Sync

The backend polls VMs every 10 seconds. Wait 15-20 seconds, then:

### 4. Check the Dashboard

Open: http://localhost:3000

You should see:
- VM card shows: "1 attackers" in CRDT state
- Attackers Overview shows a new attacker card
- Click the attacker card to see full profile

---

## Command Reference

### Record Attacker Visit
```bash
sudo syslogd-helper visit <ATTACKER_IP> <DECOY_NAME>
# Example:
sudo syslogd-helper visit 10.20.20.100 fake-web-01
```

### Record Attacker Action
```bash
sudo syslogd-helper action <ATTACKER_IP> <DECOY_NAME> <ACTION>
# Examples:
sudo syslogd-helper action 10.20.20.100 fake-web-01 "ssh_login_attempt"
sudo syslogd-helper action 10.20.20.100 fake-web-01 "whoami_command"
sudo syslogd-helper action 10.20.20.100 fake-web-01 "downloaded_/etc/passwd"
```

### Record Lateral Movement
```bash
sudo syslogd-helper move <ATTACKER_IP> <NEW_LOCATION>
# Example:
sudo syslogd-helper move 10.20.20.100 fake-jump-01
```

### Record Stolen Credential
```bash
sudo syslogd-helper cred "<USERNAME>:<PASSWORD>"
# Example:
sudo syslogd-helper cred "admin:Winter2023!"
```

### Record Active Session
```bash
sudo syslogd-helper session <HOST> <SESSION_ID>
# Example:
sudo syslogd-helper session fake-web-01 "sess_abc123"
```

### Check State
```bash
sudo syslogd-helper stats
sudo syslogd-helper show
```

### Clear State (for testing)
```bash
sudo rm /var/lib/.syscache
```

---

## Using the Helper Script

From the host machine:
```bash
cd /home/patrick/Documents/Maya_Deception_Tech/scripts

# Full attack simulation
./simulate-attack.sh fake-ftp-01 10.20.20.100 full

# Just record a visit
./simulate-attack.sh fake-ftp-01 10.20.20.100 visit

# Simulate lateral movement
./simulate-attack.sh fake-jump-01 10.20.20.100 lateral

# Clear state
./simulate-attack.sh fake-ftp-01 10.20.20.100 clear
```

---

## Troubleshooting

### Attacker still shows as "unknown"

Check the state file:
```bash
sudo cat /var/lib/.syscache | jq '.attackers'
```

If you see `"unknown"` as a key, the commands weren't updated properly.

### Backend not showing attackers

1. Check backend logs:
   ```bash
   tail -f backend/logs/combined.log | grep -i "attacker\|crdt"
   ```

2. Check MongoDB directly:
   ```bash
   curl http://localhost:3001/api/dashboard/debug/attackers | jq '.data.activeAttackers'
   ```

3. Manually create test attacker:
   ```bash
   curl -X POST http://localhost:3001/api/dashboard/attacker \
     -H "Content-Type: application/json" \
     -d '{
       "attackerId": "APT-10-20-20-100",
       "ipAddress": "10.20.20.100",
       "entryPoint": "fake-web-01"
     }'
   ```

### Binary won't copy to VM

Manual copy method:
```bash
# On host
cd /home/patrick/Documents/Maya_Deception_Tech/scripts/crdt
scp target/release/maya-crdt /tmp/maya-crdt

# In VM via SSH
sudo mv /tmp/maya-crdt /usr/local/bin/syslogd-helper
sudo chmod +x /usr/local/bin/syslogd-helper
```

---

## Expected Flow

1. **Attacker scans network** → hits honeypot
2. **You run commands** → CRDT state updated with correct IP
3. **Backend polls (10s)** → reads `/var/lib/.syscache`
4. **Backend creates attacker** → `APT-10-20-20-100` in MongoDB
5. **WebSocket broadcasts** → frontend receives update
6. **Dashboard updates** → new attacker card appears (within 15-20 seconds)

---

## Testing Checklist

- [ ] Binary rebuilt with `cargo build --release`
- [ ] Binary copied to all VMs
- [ ] Commands use explicit IP: `syslogd-helper visit 10.20.20.100 ...`
- [ ] `syslogd-helper stats` shows correct IP (not "unknown")
- [ ] Backend logs show "Created new attacker: APT-10-20-20-100"
- [ ] Dashboard shows new attacker card
- [ ] Attacker profile page loads with real data
