#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}CRDT Full Synchronization Test${NC}"
echo -e "${GREEN}=========================================${NC}"

LOG_FILE="$HOME/crdt-test.log"
echo "Using log file: $LOG_FILE"
> "$LOG_FILE"

# Function to get state hash
get_hash() {
    local vm=$1
    if [ ! -d "$vm" ]; then
        echo "VM $vm not found"
        return
    fi
    cd "$vm" || return
    hash=$(vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats 2>/dev/null | grep 'State hash:' | awk '{print \$3}'" 2>/dev/null | tr -d '\r')
    cd ..
    echo "$hash"
}

# Function to get attacker count
get_attacker_count() {
    local vm=$1
    if [ ! -d "$vm" ]; then
        echo "0"
        return
    fi
    cd "$vm" || return
    count=$(vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats 2>/dev/null | grep 'Attackers:' | awk '{print \$2}'" 2>/dev/null | tr -d '\r')
    cd ..
    echo "${count:-0}"
}

echo -e "\n${YELLOW}Step 1: Recording initial state...${NC}"
echo "Initial State:" >> "$LOG_FILE"

for vm in fake-web-01 fake-ftp-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-02 fake-web-03 gateway-vm; do
    if [ -d "$vm" ]; then
        hash=$(get_hash "$vm")
        attackers=$(get_attacker_count "$vm")
        echo "$vm: Attackers=$attackers, Hash=$hash" >> "$LOG_FILE"
        echo "  $vm: Attackers=$attackers"
    fi
done

echo -e "\n${YELLOW}Step 2: Simulating attacker on fake-web-03...${NC}"
if [ -d "fake-web-03" ]; then
    cd fake-web-03
    
    # Check if VM is running
    if vagrant status | grep -q "running"; then
        vagrant ssh << 'EOF'
          echo "Simulating attacker 192.20.100.100..."
          sudo /usr/local/bin/syslogd-helper visit 192.20.100.100 /fake-smb-01
          sudo /usr/local/bin/syslogd-helper action 192.20.100.100 /fake-smb-01 "nmap scan"
          sudo /usr/local/bin/syslogd-helper move 192.20.100.100 /tmp
          sudo /usr/local/bin/syslogd-helper cred "admin:Winter2023!"
          
          echo "Simulating attacker 192.40.20.201..."
          sudo /usr/local/bin/syslogd-helper visit 192.40.20.201 /fake-ssh-01
          sudo /usr/local/bin/syslogd-helper action 192.40.20.201 /fake-ssh-01 "bruteforce"
          
          echo "=== fake-web-03 after simulation ==="
          sudo /usr/local/bin/syslogd-helper stats
EOF
        echo -e "${GREEN}  Attack simulation complete${NC}"
    else
        echo -e "${RED}  fake-web-03 is not running!${NC}"
    fi
    cd ..
fi

echo -e "\n${YELLOW}Step 3: Waiting for CRDT sync (60 seconds)...${NC}"
echo "The daemon syncs every 10 seconds, waiting for propagation..."
sleep 60

echo -e "\n${YELLOW}Step 4: Checking all VMs for synchronized state...${NC}"
echo -e "\nFinal State:" >> "$LOG_FILE"
SYNC_SUCCESS=true
FIRST_HASH=""
FIRST_VM=""

for vm in fake-web-01 fake-ftp-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-02 fake-web-03 gateway-vm; do
    if [ -d "$vm" ]; then
        hash=$(get_hash "$vm")
        attackers=$(get_attacker_count "$vm")
        
        if [ -z "$FIRST_HASH" ] && [ -n "$hash" ]; then
            FIRST_HASH="$hash"
            FIRST_VM="$vm"
        fi
        
        if [ "$hash" != "$FIRST_HASH" ]; then
            SYNC_SUCCESS=false
        fi
        
        echo "$vm: Attackers=$attackers, Hash=$hash" >> "$LOG_FILE"
        
        if [ "$attackers" -gt 0 ]; then
            echo -e "  ${GREEN}$vm: Attackers=$attackers${NC} - Hash=${hash:0:20}..."
        else
            echo -e "  ${RED}$vm: Attackers=$attackers${NC} - Hash=${hash:0:20}..."
        fi
    fi
done

echo -e "\n${YELLOW}Step 5: Detailed state from source VM (fake-web-03):${NC}"
if [ -d "fake-web-03" ]; then
    cd fake-web-03
    vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats"
    cd ..
fi

echo -e "\n${YELLOW}Step 6: Checking fake-jump-01 for sync:${NC}"
if [ -d "fake-jump-01" ]; then
    cd fake-jump-01
    vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats | head -10"
    cd ..
fi

echo -e "\n${GREEN}=========================================${NC}"
echo -e "${GREEN}Test Results:${NC}"
echo -e "${GREEN}=========================================${NC}"
cat "$LOG_FILE"

echo ""
if [ "$SYNC_SUCCESS" = true ]; then
    echo -e "${GREEN}✅ CRDT SYNC SUCCESSFUL - All VMs have the same state hash${NC}"
else
    echo -e "${RED}❌ CRDT SYNC FAILED - State hashes differ across VMs${NC}"
    echo -e "${YELLOW}   First VM ($FIRST_VM): ${FIRST_HASH:0:40}...${NC}"
fi

echo -e "\n${YELLOW}To clean up test data:${NC}"
echo "  Run: cd ~/Documents/Maya/simulations/fake/fake-web-03 && vagrant ssh -c 'sudo rm -f /var/lib/.syscache'"