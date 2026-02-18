#!/bin/bash
# Helper script to simulate attacker activity on honeypot VMs
# Usage: ./simulate-attack.sh <vm-name> <attacker-ip> [action]

set -e

VM_NAME="${1:-fake-jump-01}"
ATTACKER_IP="${2:-10.20.20.100}"
ACTION="${3:-full}"

echo "=== Simulating Attacker Activity ==="
echo "VM: $VM_NAME"
echo "Attacker IP: $ATTACKER_IP"
echo "Action: $ACTION"
echo ""

# Get the SSH command
SSH_CMD="./manage-vms.sh ssh $VM_NAME"

case "$ACTION" in
    "visit")
        echo "Recording attacker visit..."
        $SSH_CMD "sudo syslogd-helper visit $ATTACKER_IP $(hostname)"
        ;;
    
    "action")
        echo "Recording attacker action..."
        $SSH_CMD "sudo syslogd-helper action $ATTACKER_IP $(hostname) 'manual_test_action'"
        ;;
    
    "full")
        echo "Simulating full attack sequence..."
        
        # Step 1: Record visit
        echo "[1/4] Recording initial access..."
        $SSH_CMD "sudo syslogd-helper visit $ATTACKER_IP fake-web-01"
        
        # Step 2: Record action
        echo "[2/4] Recording command execution..."
        $SSH_CMD "sudo syslogd-helper action $ATTACKER_IP fake-web-01 'ssh_login_attempt'"
        
        # Step 3: Record credential theft
        echo "[3/4] Recording credential theft..."
        $SSH_CMD "sudo syslogd-helper cred 'admin:Winter2023!'"
        
        # Step 4: Show stats
        echo "[4/4] Current CRDT state:"
        $SSH_CMD "sudo syslogd-helper stats"
        
        echo ""
        echo "=== Attack Simulation Complete ==="
        echo "Wait 10-15 seconds for CRDT sync to backend"
        echo "Then check: http://localhost:3000"
        ;;
    
    "lateral")
        echo "Simulating lateral movement..."
        $SSH_CMD "sudo syslogd-helper move $ATTACKER_IP 'fake-jump-01'"
        $SSH_CMD "sudo syslogd-helper action $ATTACKER_IP fake-jump-01 'ssh_pivot'"
        ;;
    
    "clear")
        echo "Clearing CRDT state..."
        $SSH_CMD "sudo rm -f /var/lib/.syscache"
        echo "State cleared"
        ;;
    
    *)
        echo "Unknown action: $ACTION"
        echo "Usage: $0 <vm-name> <attacker-ip> [visit|action|full|lateral|clear]"
        exit 1
        ;;
esac
