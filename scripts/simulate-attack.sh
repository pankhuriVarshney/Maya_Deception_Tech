    #!/bin/bash
    # Helper script to simulate attacker activity on honeypot VMs
    # Usage: ./simulate-attack.sh <vm-name> <attacker-ip> [action]

    set -e

    VM_NAME="${1:-fake-ssh-01}"
    ATTACKER_IP="${2:-10.20.20.100}"
    ACTION="${3:-full}"

    echo "=== Simulating Attacker Activity ==="
    echo "VM: $VM_NAME"
    echo "Attacker IP: $ATTACKER_IP"
    echo "Action: $ACTION"
    echo ""

    # Get the SSH command
    SSH_CMD="./manage-vms.sh ssh $VM_NAME"

    # Helper function to run syslogd-helper with correct argument order
    # Usage: syslogd_helper <command> [args...]
    syslogd_helper() {
        local cmd="$1"
        shift
        $SSH_CMD "sudo syslogd-helper $cmd $@"
    }

    case "$ACTION" in
        "visit")
            echo "Recording attacker visit..."
            # CORRECT: visit <attacker_ip> <decoy_name> (3 arguments)
            syslogd_helper "visit" "$ATTACKER_IP" "$(hostname)"
            ;;
        
        "action")
            echo "Recording attacker action..."
            # CORRECT: action <attacker_ip> <decoy_name> <action> (4 arguments)
            syslogd_helper "action" "$ATTACKER_IP" "$(hostname)" "manual_test_action"
            ;;
        
        "full")
            echo "Simulating full attack sequence..."
            
            # Step 1: Record visit
            echo "[1/4] Recording initial access..."
            syslogd_helper "visit" "$ATTACKER_IP" "fake-web-01"
            
            # Step 2: Record action
            echo "[2/4] Recording command execution..."
            syslogd_helper "action" "$ATTACKER_IP" "fake-web-01" "ssh_login_attempt"
            
            # Step 3: Record credential theft (no attacker IP needed)
            echo "[3/4] Recording credential theft..."
            syslogd_helper "cred" "admin:Winter2023!"
            
            # Step 4: Show stats
            echo "[4/4] Current CRDT state:"
            syslogd_helper "stats"
            
            echo ""
            echo "=== Attack Simulation Complete ==="
            echo "Wait 10-15 seconds for CRDT sync to backend"
            echo "Then check: http://localhost:3000"
            ;;
        
        "lateral")
            echo "Simulating lateral movement..."
            # CORRECT: move <attacker_ip> <location> (3 arguments)
            syslogd_helper "move" "$ATTACKER_IP" "fake-jump-01"
            syslogd_helper "action" "$ATTACKER_IP" "fake-jump-01" "ssh_pivot"
            ;;
        
        "clear")
            echo "Clearing CRDT state..."
            # This bypasses syslogd-helper and just removes the file
            $SSH_CMD "sudo rm -f /var/lib/.syscache"
            echo "State cleared. Restart syslogd-helper daemon if running."
            ;;
        
        *)
            echo "Unknown action: $ACTION"
            echo "Usage: $0 <vm-name> <attacker-ip> [visit|action|full|lateral|clear]"
            echo ""
            echo "Examples:"
            echo "  $0 fake-ftp-01 192.168.1.100 visit"
            echo "  $0 fake-jump-01 10.0.0.50 full"
            exit 1
            ;;
    esac

    echo "Command completed successfully"