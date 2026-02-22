#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}     CRDT Peers Configuration Check     ${NC}"
echo -e "${GREEN}=========================================${NC}"

# Define all VMs
VMS="fake-ftp-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-01 fake-web-02 fake-web-03 gateway-vm"

# Arrays to store data
declare -A VM_IPS
declare -A VM_PEERS
declare -A VM_PEER_COUNTS

echo -e "\n${YELLOW}Gathering peer configurations...${NC}\n"

# First, get all VM IPs for reference
for vm in $VMS; do
    if [ ! -d "$vm" ]; then
        continue
    fi
    
    cd "$vm" || continue
    
    # Get IP based on VM type, filtering warnings
    if [ "$vm" = "gateway-vm" ]; then
        ip=$(vagrant ssh -c "ip addr show eth2 2>/dev/null | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1" 2>/dev/null | grep -v "^==>" | head -1 | tr -d '\r')
    elif [ "$vm" = "fake-jump-01" ]; then
        ip=$(vagrant ssh -c "ip addr show eth1 2>/dev/null | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1" 2>/dev/null | grep -v "^==>" | head -1 | tr -d '\r')
    else
        ip=$(vagrant ssh -c "ip addr show eth1 2>/dev/null | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1" 2>/dev/null | grep -v "^==>" | head -1 | tr -d '\r')
    fi
    
    if [ -n "$ip" ]; then
        VM_IPS["$vm"]="$ip"
        echo -e "  ${GREEN}✅ $vm: $ip${NC}"
    else
        echo -e "  ${RED}❌ $vm: Failed to get IP${NC}"
    fi
    
    cd ..
done

# Create a reverse lookup map from IP to VM
declare -A IP_TO_VM
for vm in "${!VM_IPS[@]}"; do
    IP_TO_VM["${VM_IPS[$vm]}"]="$vm"
done

echo -e "\n${YELLOW}Checking peers on each VM...${NC}\n"

# Now check peers on each VM
for vm in $VMS; do
    if [ ! -d "$vm" ]; then
        echo -e "${RED}❌ $vm: Directory not found${NC}"
        continue
    fi
    
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}📋 VM:${NC} $vm ${GREEN}(${VM_IPS[$vm]:-N/A})${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    cd "$vm" || continue
    
    # Check if peers.conf exists
    peers_conf=$(vagrant ssh -c "if [ -f /etc/syslogd-helper/peers.conf ]; then echo 'EXISTS'; else echo 'MISSING'; fi" 2>/dev/null | grep -v "^==>" | tr -d '\r')
    
    if [ "$peers_conf" = "EXISTS" ]; then
        # Get peer list
        peers=$(vagrant ssh -c "sudo cat /etc/syslogd-helper/peers.conf 2>/dev/null" 2>/dev/null | grep -v "^==>" | grep -v '^$')
        
        # Count peers
        peer_count=$(echo "$peers" | grep -v '^$' | wc -l | tr -d ' ')
        VM_PEER_COUNTS["$vm"]=$peer_count
        VM_PEERS["$vm"]="$peers"
        
        echo -e "  ${GREEN}✅ peers.conf exists${NC}"
        echo -e "  📊 Peer count: ${YELLOW}$peer_count${NC}"
        
        if [ $peer_count -gt 0 ]; then
            echo -e "\n  ${CYAN}Peer IPs:${NC}"
            
            # Check each peer and verify if it's valid
            while IFS= read -r peer; do
                if [ -n "$peer" ]; then
                    # Clean the peer IP (remove any carriage returns)
                    peer_clean=$(echo "$peer" | tr -d '\r' | xargs)
                    
                    # Check if this is the VM's own IP
                    if [ "$peer_clean" = "${VM_IPS[$vm]}" ]; then
                        echo -e "    ${RED}❌ $peer_clean → WARNING: VM has its own IP in peers!${NC}"
                    
                    # Check if it maps to another VM
                    elif [ -n "${IP_TO_VM[$peer_clean]}" ]; then
                        echo -e "    ${GREEN}✅ $peer_clean → ${IP_TO_VM[$peer_clean]}${NC}"
                    
                    # Check if it's the gateway's IP (special case)
                    elif [ "$peer_clean" = "10.20.20.1" ] && [ "$vm" != "gateway-vm" ]; then
                        echo -e "    ${GREEN}✅ $peer_clean → gateway-vm${NC}"
                    
                    # Unknown IP
                    else
                        echo -e "    ${RED}❌ $peer_clean → UNKNOWN VM${NC}"
                    fi
                fi
            done <<< "$peers"
        else
            echo -e "  ${RED}⚠️  No peers configured!${NC}"
        fi
        
        # Check file permissions
        perms=$(vagrant ssh -c "stat -c '%a' /etc/syslogd-helper/peers.conf 2>/dev/null" 2>/dev/null | grep -v "^==>" | tr -d '\r')
        if [ -n "$perms" ]; then
            echo -e "\n  🔒 File permissions: $perms"
            if [ "$perms" = "644" ]; then
                echo -e "  ${GREEN}✅ Permissions OK${NC}"
            else
                echo -e "  ${RED}⚠️  Unexpected permissions: $perms (should be 644)${NC}"
            fi
        fi
    else
        echo -e "  ${RED}❌ peers.conf MISSING!${NC}"
        VM_PEER_COUNTS["$vm"]=0
    fi
    
    cd ..
    echo ""
done

# Summary section
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}            Summary Report              ${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""

# Display peer counts for all VMs
echo -e "${YELLOW}Peer Counts by VM:${NC}"
printf "%-15s %-15s %-10s %s\n" "VM" "IP Address" "Peers" "Self-Reference"
echo "------------------------------------------------"

for vm in $VMS; do
    if [ -d "$vm" ]; then
        ip="${VM_IPS[$vm]:-N/A}"
        count="${VM_PEER_COUNTS[$vm]:-0}"
        
        # Check for self-reference
        self_ref="No"
        if [ -n "${VM_PEERS[$vm]}" ] && [ -n "$ip" ] && [[ "${VM_PEERS[$vm]}" == *"$ip"* ]]; then
            self_ref="${RED}YES${NC}"
        else
            self_ref="${GREEN}No${NC}"
        fi
        
        printf "%-15s %-15s %-10s ${self_ref}\n" "$vm" "$ip" "$count"
    fi
done

echo ""

# Check for consistency issues
echo -e "${YELLOW}Consistency Check:${NC}"
ISSUES_FOUND=0

# Check if any VM has its own IP in peers
for vm in $VMS; do
    if [ -d "$vm" ] && [ -n "${VM_PEERS[$vm]}" ] && [ -n "${VM_IPS[$vm]}" ]; then
        if [[ "${VM_PEERS[$vm]}" == *"${VM_IPS[$vm]}"* ]]; then
            echo -e "  ${RED}❌ $vm has its own IP in peers.conf${NC}"
            ISSUES_FOUND=1
        fi
    fi
done

# Check if gateway-vm has correct peers
if [ -d "gateway-vm" ] && [ -n "${VM_PEERS['gateway-vm']}" ]; then
    # Gateway should have all other VMs except itself
    expected_count=$(echo "$VMS" | wc -w)
    expected_count=$((expected_count - 1)) # Subtract gateway itself
    
    actual_count=$(echo "${VM_PEERS['gateway-vm']}" | grep -v '^$' | wc -l | tr -d ' ')
    
    if [ "$actual_count" -ne "$expected_count" ]; then
        echo -e "  ${RED}❌ gateway-vm has $actual_count peers, expected $expected_count${NC}"
        ISSUES_FOUND=1
    fi
fi

if [ $ISSUES_FOUND -eq 0 ]; then
    echo -e "  ${GREEN}✅ All peer configurations look consistent!${NC}"
fi

echo -e "\n${GREEN}=========================================${NC}"
echo -e "${GREEN}   Peer Configuration Check Complete    ${NC}"
echo -e "${GREEN}=========================================${NC}"

# Provide helpful commands if issues found
if [ $ISSUES_FOUND -eq 1 ]; then
    echo -e "\n${YELLOW}🔧 Fix commands:${NC}"
    echo "  To fix peers on all VMs: ./fix_peers_internal_fixed.sh"
    echo "  To check SSH connectivity: ./test_internal_ssh_fixed.sh"
fi