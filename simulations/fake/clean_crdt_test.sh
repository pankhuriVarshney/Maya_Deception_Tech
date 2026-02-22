#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Clean CRDT Synchronization Test${NC}"
echo -e "${GREEN}=========================================${NC}"

# cd ~/Documents/Maya/simulations/fake || exit 1

VMS="fake-web-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-02 fake-web-03 gateway-vm fake-ftp-01"

# Function to get attacker count
get_attacker_count() {
    local vm=$1
    cd "$vm" 2>/dev/null || echo "0"
    count=$(vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats 2>/dev/null | grep 'Attackers:' | awk '{print \$2}'" 2>/dev/null | tr -d '\r')
    cd ..
    echo "${count:-0}"
}

# Function to get state hash
get_hash() {
    local vm=$1
    cd "$vm" 2>/dev/null || echo ""
    hash=$(vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats 2>/dev/null | grep 'State hash:' | awk '{print \$3}'" 2>/dev/null | tr -d '\r')
    cd ..
    echo "$hash"
}

echo -e "\n${YELLOW}Step 1: Recording initial state (should all be 0)...${NC}"
for vm in $VMS; do
    attackers=$(get_attacker_count "$vm")
    hash=$(get_hash "$vm")
    echo "  $vm: Attackers=$attackers, Hash=${hash:0:12}..."
done

echo -e "\n${YELLOW}Step 2: Creating attacker on fake-web-01...${NC}"
cd fake-web-01
vagrant ssh -c "sudo /usr/local/bin/syslogd-helper visit 10.20.20.100 /test"
vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats | head -5"
cd ..

echo -e "\n${YELLOW}Step 3: Waiting 60 seconds for CRDT sync...${NC}"
sleep 60

echo -e "\n${YELLOW}Step 4: Checking all VMs for synchronized state...${NC}"
SYNC_SUCCESS=true
FIRST_HASH=""

for vm in $VMS; do
    attackers=$(get_attacker_count "$vm")
    hash=$(get_hash "$vm")
    
    if [ -z "$FIRST_HASH" ] && [ -n "$hash" ]; then
        FIRST_HASH="$hash"
    fi
    
    if [ -n "$hash" ] && [ "$hash" != "$FIRST_HASH" ]; then
        SYNC_SUCCESS=false
    fi
    
    if [ "$attackers" -gt 0 ]; then
        echo -e "  ${GREEN}$vm: Attackers=$attackers${NC} - Hash=${hash:0:12}..."
    else
        echo -e "  ${RED}$vm: Attackers=$attackers${NC} - Hash=${hash:0:12}..."
    fi
done

echo ""
if [ "$SYNC_SUCCESS" = true ]; then
    echo -e "${GREEN}✅ CRDT SYNC WORKING! All VMs have same hash${NC}"
else
    echo -e "${RED}❌ CRDT SYNC FAILED - State hashes differ${NC}"
fi
