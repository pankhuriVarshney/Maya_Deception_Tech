#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Testing CRDT sync between two VMs${NC}"
echo -e "${GREEN}=========================================${NC}"

VM1="fake-web-03"
VM2="fake-smb-01"

get_attacker_count() {
    local vm=$1
    cd "$vm" 2>/dev/null || echo "0"
    count=$(vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats 2>/dev/null | grep 'Attackers:' | awk '{print \$2}'" 2>/dev/null | tr -d '\r')
    cd ..
    echo "${count:-0}"
}

get_hash() {
    local vm=$1
    cd "$vm" 2>/dev/null || echo ""
    hash=$(vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats 2>/dev/null | grep 'State hash:' | awk '{print \$3}'" 2>/dev/null | tr -d '\r')
    cd ..
    echo "$hash"
}

# Step 1: Initial state
echo -e "\n${YELLOW}Step 1: Initial state${NC}"
V1_COUNT=$(get_attacker_count "$VM1")
V1_HASH=$(get_hash "$VM1")
V2_COUNT=$(get_attacker_count "$VM2")
V2_HASH=$(get_hash "$VM2")

echo "  $VM1: Attackers=$V1_COUNT, Hash=${V1_HASH:0:20}..."
echo "  $VM2: Attackers=$V2_COUNT, Hash=${V2_HASH:0:20}..."

# Step 2: Create attacker on VM1
echo -e "\n${YELLOW}Step 2: Creating attacker on $VM1${NC}"
cd "$VM1"
vagrant ssh -c "sudo /usr/local/bin/syslogd-helper visit 192.179.20.75 /fake-web-02"
vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats"
cd ..

# Step 3: Wait for sync
echo -e "\n${YELLOW}Step 3: Waiting 30 seconds for sync...${NC}"
sleep 30

# Step 4: Check VM2
echo -e "\n${YELLOW}Step 4: Checking $VM2 after sync${NC}"
cd "$VM2"
vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats"
cd ..

V2_COUNT=$(get_attacker_count "$VM2")
V2_HASH=$(get_hash "$VM2")
V1_COUNT=$(get_attacker_count "$VM1")
V1_HASH=$(get_hash "$VM1")

echo -e "\n${YELLOW}Results after first sync:${NC}"
echo "  $VM1: Attackers=$V1_COUNT, Hash=${V1_HASH:0:20}..."
echo "  $VM2: Attackers=$V2_COUNT, Hash=${V2_HASH:0:20}..."

if [ "$V1_HASH" = "$V2_HASH" ] && [ "$V1_COUNT" -gt 0 ] && [ "$V2_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✅ First sync successful!${NC}"
else
    echo -e "${RED}❌ First sync failed!${NC}"
fi

# Step 5: Create attacker on VM2
echo -e "\n${YELLOW}Step 5: Creating attacker on $VM2${NC}"
cd "$VM2"
vagrant ssh -c "sudo /usr/local/bin/syslogd-helper visit 192.178.10.75 /fake-ftp-01"
vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats"
cd ..

# Step 6: Wait for sync
echo -e "\n${YELLOW}Step 6: Waiting 30 seconds for sync...${NC}"
sleep 30

# Step 7: Check both VMs
echo -e "\n${YELLOW}Step 7: Final state after second sync${NC}"
cd "$VM1"
echo "$VM1 stats:"
vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats"
cd ..

cd "$VM2"
echo "$VM2 stats:"
vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats"
cd ..

V1_COUNT=$(get_attacker_count "$VM1")
V1_HASH=$(get_hash "$VM1")
V2_COUNT=$(get_attacker_count "$VM2")
V2_HASH=$(get_hash "$VM2")

echo -e "\n${YELLOW}Final Results:${NC}"
echo "  $VM1: Attackers=$V1_COUNT, Hash=${V1_HASH:0:20}..."
echo "  $VM2: Attackers=$V2_COUNT, Hash=${V2_HASH:0:20}..."

if [ "$V1_HASH" = "$V2_HASH" ] && [ "$V1_COUNT" -eq 2 ] && [ "$V2_COUNT" -eq 2 ]; then
    echo -e "${GREEN}✅✅ CRDT SYNC WORKING PERFECTLY! Both VMs have 2 attackers and same hash${NC}"
elif [ "$V1_HASH" = "$V2_HASH" ]; then
    echo -e "${YELLOW}⚠️  Same hash but counts off: V1=$V1_COUNT, V2=$V2_COUNT${NC}"
else
    echo -e "${RED}❌ CRDT sync still broken - hashes differ${NC}"
fi
