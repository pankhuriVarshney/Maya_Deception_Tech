#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Setting up CRDT Peers Configuration${NC}"
echo -e "${GREEN}=========================================${NC}"

# First, get all VM IPs (internal network only)
declare -A VM_IPS
VMS="fake-web-01 fake-ftp-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-02 fake-web-03 gateway-vm"

echo -e "\n${YELLOW}Getting VM internal IP addresses (10.20.20.x)...${NC}"
for vm in $VMS; do
    if [ ! -d "$vm" ]; then
        echo -e "  ${RED}❌ Directory $vm not found${NC}"
        continue
    fi
    
    cd "$vm" || continue
    
    # Get the internal network IP based on VM type
    # We need to get ONLY the IP, not the warnings
    if [ "$vm" = "gateway-vm" ]; then
        # Gateway has eth2 for internal network
        # Run command and extract just the last line (the IP)
        ip=$(vagrant ssh -c "ip addr show eth2 2>/dev/null | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1 | tail -1" 2>/dev/null | tail -1 | tr -d '\r' | xargs)
    elif [ "$vm" = "fake-jump-01" ]; then
        # Alpine Linux
        ip=$(vagrant ssh -c "ip addr show eth1 2>/dev/null | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1 | tail -1" 2>/dev/null | tail -1 | tr -d '\r' | xargs)
    else
        # Debian/Ubuntu - get eth1 IP specifically
        ip=$(vagrant ssh -c "ip addr show eth1 2>/dev/null | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1 | tail -1" 2>/dev/null | tail -1 | tr -d '\r' | xargs)
    fi
    
    # Clean the IP - remove any non-IP characters
    ip=$(echo "$ip" | grep -oE '10\.20\.20\.[0-9]+' | head -1)
    
    if [ -n "$ip" ]; then
        VM_IPS["$vm"]="$ip"
        echo -e "  ${GREEN}✅ $vm: $ip${NC}"
    else
        echo -e "  ${RED}❌ $vm: Failed to get internal IP${NC}"
    fi
    
    cd ..
done

# Create peers.conf on each VM
echo -e "\n${YELLOW}Creating peers.conf on each VM with internal IPs...${NC}"
for vm in $VMS; do
    if [ ! -d "$vm" ] || [ -z "${VM_IPS[$vm]}" ]; then
        echo -e "  ${RED}❌ Skipping $vm - no IP available${NC}"
        continue
    fi
    
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}Configuring $vm (${VM_IPS[$vm]})...${NC}"
    cd "$vm" || continue
    
    # Create peers file content with all OTHER VM internal IPs
    PEERS_CONTENT=""
    PEER_COUNT=0
    
    for other_vm in $VMS; do
        if [ "$other_vm" != "$vm" ] && [ -n "${VM_IPS[$other_vm]}" ]; then
            PEERS_CONTENT="${PEERS_CONTENT}${VM_IPS[$other_vm]}\n"
            PEER_COUNT=$((PEER_COUNT + 1))
        fi
    done
    
    echo -e "  Adding $PEER_COUNT peers:"
    # Show the peers we're adding (without the newline characters)
    if [ $PEER_COUNT -gt 0 ]; then
        printf "%b" "$PEERS_CONTENT" | sed 's/^/    /'
    else
        echo "    (no peers - this is unusual!)"
    fi
    
    # Create directory and write peers file
    printf "%b" "$PEERS_CONTENT" | vagrant ssh -c "sudo mkdir -p /etc/syslogd-helper && sudo tee /etc/syslogd-helper/peers.conf > /dev/null" 2>&1 | grep -v "^==>"
    
    # Verify the file
    echo -e "\n  Verification on $vm:"
    vagrant ssh -c "sudo cat /etc/syslogd-helper/peers.conf" 2>&1 | grep -v "^==>" | sed 's/^/    /'
    
    cd ..
done

# Summary
echo -e "\n${GREEN}=========================================${NC}"
echo -e "${GREEN}Peers configuration complete!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo -e "\n${YELLOW}Final IP assignments:${NC}"
for vm in $VMS; do
    if [ -n "${VM_IPS[$vm]}" ]; then
        echo -e "  ${GREEN}$vm: ${VM_IPS[$vm]}${NC}"
    else
        echo -e "  ${RED}$vm: No IP${NC}"
    fi
done