#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Fixing Gateway VM Peers Configuration${NC}"
echo -e "${GREEN}=========================================${NC}"

cd gateway-vm || { echo -e "${RED}❌ gateway-vm directory not found${NC}"; exit 1; }

# Get all VM IPs (except gateway itself)
echo -e "\n${YELLOW}Getting all VM internal IPs...${NC}"

declare -A VM_IPS
VMS="fake-web-01 fake-ftp-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-02 fake-web-03"

for vm in $VMS; do
    if [ ! -d "../$vm" ]; then
        echo -e "  ${RED}❌ $vm directory not found${NC}"
        continue
    fi
    
    cd "../$vm" || continue
    
    # Get internal IP
    if [ "$vm" = "fake-jump-01" ]; then
        ip=$(vagrant ssh -c "ip addr show eth1 2>/dev/null | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1 | head -1" 2>/dev/null | grep -v "^==>" | tr -d '\r' | xargs)
    else
        ip=$(vagrant ssh -c "ip addr show eth1 2>/dev/null | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1 | head -1" 2>/dev/null | grep -v "^==>" | tr -d '\r' | xargs)
    fi
    
    # Extract just the IP if it's in the right format
    ip=$(echo "$ip" | grep -oE '10\.20\.20\.[0-9]+' | head -1)
    
    if [ -n "$ip" ]; then
        VM_IPS["$vm"]="$ip"
        echo -e "  ${GREEN}✅ $vm: $ip${NC}"
    else
        echo -e "  ${RED}❌ $vm: Failed to get IP${NC}"
    fi
    
    cd - > /dev/null
done

# Now configure gateway-vm's peers.conf
echo -e "\n${YELLOW}Configuring gateway-vm peers.conf...${NC}"
cd gateway-vm || exit

# Create peers file with all other VMs' IPs
PEERS_FILE="/tmp/gateway-peers.txt"
> "$PEERS_FILE"

for vm in $VMS; do
    if [ -n "${VM_IPS[$vm]}" ]; then
        echo "${VM_IPS[$vm]}" >> "$PEERS_FILE"
    fi
done

# Sort the file
sort -t . -k 1,1n -k 2,2n -k 3,3n -k 4,4n "$PEERS_FILE" -o "$PEERS_FILE"

# Show what we're adding
echo -e "  Adding $(wc -l < "$PEERS_FILE" | tr -d ' ') peers:"
cat "$PEERS_FILE" | sed 's/^/    /'

# Copy to gateway-vm
cat "$PEERS_FILE" | vagrant ssh -c "
    sudo mkdir -p /etc/syslogd-helper &&
    sudo tee /etc/syslogd-helper/peers.conf > /dev/null &&
    sudo chmod 644 /etc/syslogd-helper/peers.conf
" 2>&1 | grep -v "^==>"

# Verify
echo -e "\n  Verification on gateway-vm:"
vagrant ssh -c "sudo cat /etc/syslogd-helper/peers.conf" 2>&1 | grep -v "^==>" | sed 's/^/    /'

# Check for self IP
self_check=$(vagrant ssh -c "sudo cat /etc/syslogd-helper/peers.conf | grep '10.20.20.1' || echo '✓ Not found'" 2>&1 | grep -v "^==>")
if [[ "$self_check" == *"10.20.20.1"* ]]; then
    echo -e "\n  ${RED}❌ Self IP still present!${NC}"
else
    echo -e "\n  ${GREEN}✅ Self IP correctly excluded${NC}"
fi

rm "$PEERS_FILE"
cd ..

echo -e "\n${GREEN}=========================================${NC}"
echo -e "${GREEN}Gateway VM peers configuration fixed!${NC}"
echo -e "${GREEN}=========================================${NC}"
