#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Testing SSH Connectivity Over Internal Network${NC}"
echo -e "${GREEN}=========================================${NC}"

# cd ~/Documents/Maya/simulations/fake || { echo -e "${RED}Failed to cd to simulations directory${NC}"; exit 1; }

# Define all VMs
VMS="fake-web-01 fake-ftp-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-02 fake-web-03 gateway-vm"

# Get internal IPs for all VMs
declare -A IPS

echo -e "\n${YELLOW}Gathering IP addresses...${NC}"
for vm in $VMS; do
    if [ ! -d "$vm" ]; then
        echo -e "  ${RED}❌ $vm directory not found${NC}"
        continue
    fi
    
    cd "$vm" || continue
    
    # Get IP based on VM type, filtering out Vagrant warnings
    if [ "$vm" = "gateway-vm" ]; then
        # Gateway uses eth2 for internal network - filter out lines starting with ==>
        ip=$(vagrant ssh -c "ip addr show eth2 2>/dev/null | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1" 2>/dev/null | grep -v "^==>" | tr -d '\r')
    elif [ "$vm" = "fake-jump-01" ]; then
        # Alpine Linux - filter out warnings
        ip=$(vagrant ssh -c "ip addr show eth1 2>/dev/null | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1" 2>/dev/null | grep -v "^==>" | tr -d '\r')
    else
        # Debian/Ubuntu - filter out warnings
        ip=$(vagrant ssh -c "ip addr show eth1 2>/dev/null | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1" 2>/dev/null | grep -v "^==>" | tr -d '\r')
    fi
    
    if [ -n "$ip" ]; then
        IPS["$vm"]="$ip"
        echo -e "  ${GREEN}✅ $vm: $ip${NC}"
    else
        echo -e "  ${RED}❌ $vm: Failed to get IP${NC}"
    fi
    
    cd ..
done

# Test from gateway-vm
echo -e "\n${GREEN}=== From gateway-vm ===${NC}"
if [ -d "gateway-vm" ] && [ -n "${IPS['gateway-vm']}" ]; then
    cd gateway-vm
    
    for target in fake-web-01 fake-ftp-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-02 fake-web-03; do
        target_ip=${IPS[$target]}
        if [ -n "$target_ip" ]; then
            echo -n "  To $target ($target_ip): "
            # Run SSH test and filter warnings
            result=$(vagrant ssh -c "ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o PasswordAuthentication=no vagrant@$target_ip 'echo OK' 2>/dev/null" 2>/dev/null | grep -v "^==>" | tr -d '\r')
            
            if [ "$result" = "OK" ]; then
                echo -e "${GREEN}✅ Success${NC}"
            else
                echo -e "${RED}❌ Failed (got: '$result')${NC}"
            fi
        else
            echo -e "  To $target: ${RED}❌ No IP available${NC}"
        fi
    done
    
    cd ..
fi


# Test from fake-jump-01
echo -e "\n${GREEN}=== From fake-jump-01 ===${NC}"
if [ -d "fake-jump-01" ] && [ -n "${IPS['fake-jump-01']}" ]; then
    cd fake-jump-01
    
    for target in fake-web-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-02 fake-web-03 gateway-vm; do
        target_ip=${IPS[$target]}
        if [ -n "$target_ip" ]; then
            echo -n "  To $target ($target_ip): "
            # Run SSH test and filter warnings
            result=$(vagrant ssh -c "ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o PasswordAuthentication=no vagrant@$target_ip 'echo OK' 2>/dev/null" 2>/dev/null | grep -v "^==>" | tr -d '\r')
            
            if [ "$result" = "OK" ]; then
                echo -e "${GREEN}✅ Success${NC}"
            else
                echo -e "${RED}❌ Failed (got: '$result')${NC}"
            fi
        else
            echo -e "  To $target: ${RED}❌ No IP available${NC}"
        fi
    done
    
    cd ..
fi


# Test SSH from fake-rdp-01
echo -e "\n${GREEN}=== From fake-rdp-01 ===${NC}"
if [ -d "fake-rdp-01" ] && [ -n "${IPS['fake-rdp-01']}" ]; then
    cd fake-rdp-01
    
    for target in fake-jump-01 fake-web-01 fake-smb-01 fake-ssh-01 fake-web-02 fake-web-03 gateway-vm; do
        target_ip=${IPS[$target]}
        if [ -n "$target_ip" ]; then
            echo -n "  To $target ($target_ip): "
            # Run SSH test and capture just the output, filtering warnings
            result=$(vagrant ssh -c "ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o PasswordAuthentication=no vagrant@$target_ip 'echo OK' 2>/dev/null" 2>/dev/null | grep -v "^==>" | tr -d '\r')
            
            if [ "$result" = "OK" ]; then
                echo -e "${GREEN}✅ Success${NC}"
            else
                echo -e "${RED}❌ Failed (got: '$result')${NC}"
            fi
        else
            echo -e "  To $target: ${RED}❌ No IP available${NC}"
        fi
    done
    
    cd ..
fi

# Test SSH from fake-smb-01
echo -e "\n${GREEN}=== From fake-smb-01 ===${NC}"
if [ -d "fake-smb-01" ] && [ -n "${IPS['fake-smb-01']}" ]; then
    cd fake-smb-01
    
    for target in fake-jump-01 fake-web-01 fake-rdp-01 fake-ssh-01 fake-web-02 fake-web-03 gateway-vm; do
        target_ip=${IPS[$target]}
        if [ -n "$target_ip" ]; then
            echo -n "  To $target ($target_ip): "
            # Run SSH test and capture just the output, filtering warnings
            result=$(vagrant ssh -c "ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o PasswordAuthentication=no vagrant@$target_ip 'echo OK' 2>/dev/null" 2>/dev/null | grep -v "^==>" | tr -d '\r')
            
            if [ "$result" = "OK" ]; then
                echo -e "${GREEN}✅ Success${NC}"
            else
                echo -e "${RED}❌ Failed (got: '$result')${NC}"
            fi
        else
            echo -e "  To $target: ${RED}❌ No IP available${NC}"
        fi
    done
    
    cd ..
fi

# Test SSH from fake-ssh-01
echo -e "\n${GREEN}=== From fake-ssh-01 ===${NC}"
if [ -d "fake-ssh-01" ] && [ -n "${IPS['fake-ssh-01']}" ]; then
    cd fake-ssh-01
    
    for target in fake-jump-01 fake-web-01 fake-smb-01 fake-rdp-01 fake-web-02 fake-web-03 gateway-vm; do
        target_ip=${IPS[$target]}
        if [ -n "$target_ip" ]; then
            echo -n "  To $target ($target_ip): "
            # Run SSH test and capture just the output, filtering warnings
            result=$(vagrant ssh -c "ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o PasswordAuthentication=no vagrant@$target_ip 'echo OK' 2>/dev/null" 2>/dev/null | grep -v "^==>" | tr -d '\r')
            
            if [ "$result" = "OK" ]; then
                echo -e "${GREEN}✅ Success${NC}"
            else
                echo -e "${RED}❌ Failed (got: '$result')${NC}"
            fi
        else
            echo -e "  To $target: ${RED}❌ No IP available${NC}"
        fi
    done
    
    cd ..
fi


# Test SSH from fake-web-01
echo -e "\n${GREEN}=== From fake-web-01 ===${NC}"
if [ -d "fake-web-01" ] && [ -n "${IPS['fake-web-01']}" ]; then
    cd fake-web-01
    
    for target in fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-ftp-01 fake-web-02 fake-web-03 gateway-vm; do
        target_ip=${IPS[$target]}
        if [ -n "$target_ip" ]; then
            echo -n "  To $target ($target_ip): "
            # Run SSH test and capture just the output, filtering warnings
            result=$(vagrant ssh -c "ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o PasswordAuthentication=no vagrant@$target_ip 'echo OK' 2>/dev/null" 2>/dev/null | grep -v "^==>" | tr -d '\r')
            
            if [ "$result" = "OK" ]; then
                echo -e "${GREEN}✅ Success${NC}"
            else
                echo -e "${RED}❌ Failed (got: '$result')${NC}"
            fi
        else
            echo -e "  To $target: ${RED}❌ No IP available${NC}"
        fi
    done
    
    cd ..
fi

# Test SSH from fake-web-02
echo -e "\n${GREEN}=== From fake-web-02 ===${NC}"
if [ -d "fake-web-02" ] && [ -n "${IPS['fake-web-02']}" ]; then
    cd fake-web-02
    
    for target in fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-ftp-01 fake-web-01 fake-web-03 gateway-vm; do
        target_ip=${IPS[$target]}
        if [ -n "$target_ip" ]; then
            echo -n "  To $target ($target_ip): "
            # Run SSH test and capture just the output, filtering warnings
            result=$(vagrant ssh -c "ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o PasswordAuthentication=no vagrant@$target_ip 'echo OK' 2>/dev/null" 2>/dev/null | grep -v "^==>" | tr -d '\r')
            
            if [ "$result" = "OK" ]; then
                echo -e "${GREEN}✅ Success${NC}"
            else
                echo -e "${RED}❌ Failed (got: '$result')${NC}"
            fi
        else
            echo -e "  To $target: ${RED}❌ No IP available${NC}"
        fi
    done
    
    cd ..
fi

# Test SSH from fake-web-03
echo -e "\n${GREEN}=== From fake-web-03 ===${NC}"
if [ -d "fake-web-03" ] && [ -n "${IPS['fake-web-03']}" ]; then
    cd fake-web-03
    
    for target in fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-ftp-01 fake-web-02 fake-web-01 gateway-vm; do
        target_ip=${IPS[$target]}
        if [ -n "$target_ip" ]; then
            echo -n "  To $target ($target_ip): "
            # Run SSH test and capture just the output, filtering warnings
            result=$(vagrant ssh -c "ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o PasswordAuthentication=no vagrant@$target_ip 'echo OK' 2>/dev/null" 2>/dev/null | grep -v "^==>" | tr -d '\r')
            
            if [ "$result" = "OK" ]; then
                echo -e "${GREEN}✅ Success${NC}"
            else
                echo -e "${RED}❌ Failed (got: '$result')${NC}"
            fi
        else
            echo -e "  To $target: ${RED}❌ No IP available${NC}"
        fi
    done
    
    cd ..
fi


echo -e "\n${GREEN}=========================================${NC}"
echo -e "${GREEN}SSH Connectivity Test Complete${NC}"
echo -e "${GREEN}=========================================${NC}"

# Summary of IPs (cleaned)
echo -e "\n${YELLOW}IP Address Summary (cleaned):${NC}"
for vm in $VMS; do
    if [ -n "${IPS[$vm]}" ]; then
        echo -e "  ${GREEN}$vm: ${IPS[$vm]}${NC}"
    else
        echo -e "  ${RED}$vm: No IP${NC}"
    fi
done