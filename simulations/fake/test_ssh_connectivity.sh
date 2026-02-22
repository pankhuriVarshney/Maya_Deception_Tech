#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Testing SSH Connectivity Between VMs${NC}"
echo -e "${GREEN}=========================================${NC}"

VMS="fake-web-01 fake-ftp-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-02 fake-web-03 gateway-vm"

# First, get all IPs
declare -A IPS

for vm in $VMS; do
    if [ ! -d "$vm" ]; then
        continue
    fi
    
    cd "$vm"
    
    if [ "$vm" = "fake-jump-01" ]; then
        ip=$(vagrant ssh -c "ip addr show eth1 | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1" 2>/dev/null | tr -d '\r')
    else
        ip=$(vagrant ssh -c "ip addr show eth1 | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1" 2>/dev/null | tr -d '\r')
    fi
    
    IPS["$vm"]="$ip"
    cd ..
done

# Test from fake-web-01 to others
echo -e "\n${YELLOW}Testing from fake-web-01:${NC}"
cd fake-web-01

for target in fake-jump-01 fake-rdp-01 fake-smb-01; do
    target_ip=${IPS[$target]}
    if [ -n "$target_ip" ]; then
        echo -n "  To $target ($target_ip): "
        if vagrant ssh -c "ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no vagrant@$target_ip 'echo OK'" 2>/dev/null | grep -q "OK"; then
            echo -e "${GREEN}✅ Success${NC}"
        else
            echo -e "${RED}❌ Failed${NC}"
        fi
    fi
done
cd ..

# Test from fake-jump-01 to others
echo -e "\n${YELLOW}Testing from fake-jump-01:${NC}"
cd fake-jump-01

for target in fake-web-01 fake-rdp-01; do
    target_ip=${IPS[$target]}
    if [ -n "$target_ip" ]; then
        echo -n "  To $target ($target_ip): "
        if vagrant ssh -c "ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no vagrant@$target_ip 'echo OK'" 2>/dev/null | grep -q "OK"; then
            echo -e "${GREEN}✅ Success${NC}"
        else
            echo -e "${RED}❌ Failed${NC}"
        fi
    fi
done
cd ..

echo -e "\n${GREEN}=========================================${NC}"
