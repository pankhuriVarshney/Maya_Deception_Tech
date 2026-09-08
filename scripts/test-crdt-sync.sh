#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}CRDT Full Synchronization Test${NC}"
echo -e "${GREEN}=========================================${NC}"

cd ~/Documents/Maya/simulations/fake

# Function to get CRDT state from a VM
get_crdt_state() {
    local vm=$1
    cd "$vm"
    vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats 2>/dev/null" 2>/dev/null
    cd ..
}

# Function to get state hash
get_hash() {
    local vm=$1
    cd "$vm"
    hash=$(vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats 2>/dev/null | grep 'State hash:' | awk '{print \$3}'" 2>/dev/null | tr -d '\r')
    cd ..
    echo "$hash"
}

# Function to get attacker count
get_attacker_count() {
    local vm=$1
    cd "$vm"
    count=$(vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats 2>/dev/null | grep 'Attackers:' | awk '{print \$2}'" 2>/dev/null | tr -d '\r')
    cd ..
    echo "${count:-0}"
}

echo -e "${YELLOW}Step 1: Recording initial state...${NC}"
echo "Initial State:" > /tmp/crdt-test.log
for vm in fake-web-01 fake-ftp-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-02 fake-web-03 gateway-vm; do
    if [ -d "$vm" ]; then
        hash=$(get_hash "$vm")
        attackers=$(get_attacker_count "$vm")
        echo "$vm: Attackers=$attackers, Hash=$hash" >> /tmp/crdt-test.log
        echo "  $vm: Attackers=$attackers"
    fi
done

echo -e "\n${YELLOW}Step 2: Simulating attacker on fake-web-01...${NC}"
cd fake-web-01
vagrant ssh << 'EOF' > /dev/null 2>&1
  # Clear any existing state
  sudo rm -f /var/lib/.syscache
  
  # Simulate multiple attacker actions
  echo "Simulating attacker 10.20.20.100..."
  sudo /usr/local/bin/syslogd-helper visit 10.20.20.100 /web-admin
  sudo /usr/local/bin/syslogd-helper action 10.20.20.100 /web-admin "nmap scan"
  sudo /usr/local/bin/syslogd-helper move 10.20.20.100 /tmp
  sudo /usr/local/bin/syslogd-helper cred "admin:Winter2025!"
  
  echo "Simulating attacker 10.20.20.101..."
  sudo /usr/local/bin/syslogd-helper visit 10.20.20.101 /ssh
  sudo /usr/local/bin/syslogd-helper action 10.20.20.101 /ssh "bruteforce"
  
  # Show final state
  echo "=== fake-web-01 after simulation ==="
  sudo /usr/local/bin/syslogd-helper stats
EOF
cd ..

echo -e "\n${YELLOW}Step 3: Waiting for CRDT sync (60 seconds)...${NC}"
echo "The daemon syncs every 10 seconds, waiting for propagation..."
sleep 60

echo -e "\n${YELLOW}Step 4: Checking all VMs for synchronized state...${NC}"
echo -e "\nFinal State:" >> /tmp/crdt-test.log
SYNC_SUCCESS=true
FIRST_HASH=""
FIRST_VM=""

for vm in fake-web-01 fake-ftp-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-02 fake-web-03 gateway-vm; do
    if [ -d "$vm" ]; then
        hash=$(get_hash "$vm")
        attackers=$(get_attacker_count "$vm")
        
        if [ -z "$FIRST_HASH" ]; then
            FIRST_HASH="$hash"
            FIRST_VM="$vm"
        fi
        
        if [ "$hash" != "$FIRST_HASH" ]; then
            SYNC_SUCCESS=false
        fi
        
        echo "$vm: Attackers=$attackers, Hash=$hash" >> /tmp/crdt-test.log
        
        if [ "$attackers" -gt 0 ]; then
            echo -e "  ${GREEN}$vm: Attackers=$attackers${NC} - Hash=$hash"
        else
            echo -e "  ${RED}$vm: Attackers=$attackers${NC} - Hash=$hash"
        fi
    fi
done

echo -e "\n${YELLOW}Step 5: Detailed state from each VM:${NC}"
for vm in fake-web-01 fake-jump-01; do
    if [ -d "$vm" ]; then
        echo -e "\n${GREEN}=== $vm Detailed Stats ===${NC}"
        cd "$vm"
        vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats"
        cd ..
    fi
done

echo -e "\n${YELLOW}Step 6: Checking backend detection...${NC}"
echo "Waiting 10 seconds for backend sync..."
sleep 10

echo -e "\nAttackers in MongoDB (via API):"
curl -s http://localhost:3001/api/dashboard/attackers | python3 -m json.tool 2>/dev/null || echo "No attackers detected yet"

echo -e "\n${GREEN}=========================================${NC}"
echo -e "${GREEN}Test Results:${NC}"
echo -e "${GREEN}=========================================${NC}"
cat /tmp/crdt-test.log

echo ""
if [ "$SYNC_SUCCESS" = true ]; then
    echo -e "${GREEN}✅ CRDT SYNC SUCCESSFUL - All VMs have the same state hash${NC}"
    echo -e "${GREEN}   All VMs show attackers=$attackers${NC}"
else
    echo -e "${RED}❌ CRDT SYNC FAILED - State hashes differ across VMs${NC}"
    echo -e "${YELLOW}   First VM ($FIRST_VM): $FIRST_HASH${NC}"
fi

# Cleanup suggestion
echo -e "\n${YELLOW}To clean up test data:${NC}"
echo "  Run on each VM: sudo rm -f /var/lib/.syscache"
