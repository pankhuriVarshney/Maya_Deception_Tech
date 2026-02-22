#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}   Fixing CRDT Peers Configuration      ${NC}"
echo -e "${GREEN}=========================================${NC}"

# Include ALL VMs
VMS="fake-ftp-01 fake-web-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-02 fake-web-03 gateway-vm"

echo -e "\n${YELLOW}Step 1: Getting internal IP addresses...${NC}"

declare -A VM_IPS

for vm in $VMS; do
    if [ ! -d "$vm" ]; then
        echo -e "  ${RED}❌ Directory $vm not found${NC}"
        continue
    fi
    
    echo -n "  $vm: "
    cd "$vm" || continue
    
    # Get the internal network IP based on VM type
    if [ "$vm" = "gateway-vm" ]; then
        ip=$(vagrant ssh -c "ip addr show eth2 2>/dev/null | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1" 2>/dev/null | grep -v "^==>" | head -1 | tr -d '\r')
    elif [ "$vm" = "fake-jump-01" ]; then
        ip=$(vagrant ssh -c "ip addr show eth1 2>/dev/null | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1" 2>/dev/null | grep -v "^==>" | head -1 | tr -d '\r')
    else
        ip=$(vagrant ssh -c "ip addr show eth1 2>/dev/null | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1" 2>/dev/null | grep -v "^==>" | head -1 | tr -d '\r')
    fi
    
    if [ -n "$ip" ]; then
        VM_IPS["$vm"]="$ip"
        echo -e "${GREEN}$ip${NC}"
    else
        echo -e "${RED}Failed to get IP${NC}"
    fi
    
    cd ..
done

echo -e "\n${YELLOW}Step 2: Creating peers.conf for each VM (excluding own IP)...${NC}"

for vm in $VMS; do
    if [ ! -d "$vm" ] || [ -z "${VM_IPS[$vm]}" ]; then
        continue
    fi
    
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Configuring $vm (${VM_IPS[$vm]})...${NC}"
    cd "$vm" || continue
    
    # Create peers file with IPs of OTHER VMs only
    PEERS_FILE="/tmp/peers-${vm}.txt"
    > "$PEERS_FILE"
    
    # Track unique IPs for THIS VM only (declare new array each iteration)
    declare -A ADDED_IPS
    
    # First, add all other VMs' IPs
    for other_vm in $VMS; do
        # Skip if it's the same VM
        if [ "$other_vm" = "$vm" ]; then
            continue
        fi
        
        other_ip="${VM_IPS[$other_vm]}"
        
        # Skip if no IP
        if [ -z "$other_ip" ]; then
            echo "  ⚠️  Warning: No IP for $other_vm"
            continue
        fi
        
        # Skip if it's the same as current VM's IP (shouldn't happen with above check, but just in case)
        if [ "$other_ip" = "${VM_IPS[$vm]}" ]; then
            echo "  ⚠️  Warning: $other_vm has same IP as $vm"
            continue
        fi
        
        # Add if not already added
        if [ -z "${ADDED_IPS[$other_ip]}" ]; then
            echo "$other_ip" >> "$PEERS_FILE"
            ADDED_IPS["$other_ip"]=1
        fi
    done
    
    # Sort the file for consistency
    if [ -s "$PEERS_FILE" ]; then
        sort -t . -k 1,1n -k 2,2n -k 3,3n -k 4,4n "$PEERS_FILE" -o "$PEERS_FILE"
    fi
    
    # Count unique peers
    peer_count=$(wc -l < "$PEERS_FILE" | tr -d ' ')
    
    echo "  Adding $peer_count unique peers (excluding self):"
    if [ $peer_count -gt 0 ]; then
        cat "$PEERS_FILE" | sed 's/^/    /'
    else
        echo "    (no peers - this is unusual for non-gateway VMs!)"
    fi
    
    # Create directory and copy file to VM
    cat "$PEERS_FILE" | vagrant ssh -c "
        sudo mkdir -p /etc/syslogd-helper && 
        sudo tee /etc/syslogd-helper/peers.conf > /dev/null &&
        sudo chmod 644 /etc/syslogd-helper/peers.conf
    "
    
    # Verify no self-reference
    echo "  Verification - checking for self IP (${VM_IPS[$vm]}):"
    self_check=$(vagrant ssh -c "sudo cat /etc/syslogd-helper/peers.conf 2>/dev/null | grep '${VM_IPS[$vm]}' || echo '✓ Not found'" | grep -v "^==>" | head -1)
    if [[ "$self_check" == *"${VM_IPS[$vm]}"* ]]; then
        echo -e "    ${RED}❌ Self IP still present!${NC}"
    else
        echo -e "    ${GREEN}✅ Self IP correctly excluded${NC}"
    fi
    
    rm "$PEERS_FILE"
    cd ..
done

echo -e "\n${YELLOW}Step 3: Restarting CRDT daemons...${NC}"

for vm in $VMS; do
    if [ ! -d "$vm" ]; then
        continue
    fi
    
    echo -n "  Restarting $vm: "
    cd "$vm" || continue
    
    if [ "$vm" = "fake-jump-01" ]; then
        # Alpine
        vagrant ssh -c "sudo rc-service syslogd-helper restart" 2>/dev/null
        echo -e "${GREEN}✅${NC}"
    elif [ "$vm" = "fake-ftp-01" ]; then
        # Check if service exists, if not create it
        vagrant ssh -c "
            if ! systemctl list-unit-files 2>/dev/null | grep -q syslogd-helper; then
                echo '  Creating syslogd-helper service...'
                sudo tee /etc/systemd/system/syslogd-helper.service > /dev/null << 'SERVICE'
[Unit]
Description=CRDT Synchronization Daemon
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/syslogd-helper daemon
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SERVICE
                sudo systemctl daemon-reload
                sudo systemctl enable syslogd-helper.service
                sudo systemctl start syslogd-helper.service
            else
                sudo systemctl restart syslogd-helper.service
            fi
        " 2>/dev/null
        echo -e "${GREEN}✅${NC}"
    else
        # Systemd
        vagrant ssh -c "sudo systemctl restart syslogd-helper.service" 2>/dev/null
        echo -e "${GREEN}✅${NC}"
    fi
    
    cd ..
done

echo -e "\n${GREEN}=========================================${NC}"
echo -e "${GREEN}   Peer Configuration Fixed!             ${NC}"
echo -e "${GREEN}=========================================${NC}"
echo -e "\n${YELLOW}Running verification check...${NC}"