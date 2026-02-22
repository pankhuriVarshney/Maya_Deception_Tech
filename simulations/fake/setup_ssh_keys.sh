#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Setting up SSH keys between VMs${NC}"
echo -e "${GREEN}=========================================${NC}"

VMS="fake-web-01 fake-ftp-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-02 fake-web-03 gateway-vm"

# First, generate SSH keys on each VM and collect public keys
declare -A VM_PUBKEYS

for vm in $VMS; do
    if [ ! -d "$vm" ]; then
        continue
    fi
    
    echo -e "\n${YELLOW}Setting up $vm...${NC}"
    cd "$vm"
    
    # Generate SSH key if it doesn't exist
    vagrant ssh << EOF
        if [ ! -f ~/.ssh/id_rsa ]; then
            ssh-keygen -t rsa -N "" -f ~/.ssh/id_rsa
        fi
        cat ~/.ssh/id_rsa.pub
EOF
    
    cd ..
done

# Now distribute keys to all VMs
for vm in $VMS; do
    if [ ! -d "$vm" ]; then
        continue
    fi
    
    echo -e "\n${YELLOW}Configuring authorized_keys on $vm...${NC}"
    cd "$vm"
    
    # Create a temporary file with all public keys
    > /tmp/all_keys.txt
    
    for other_vm in $VMS; do
        if [ ! -d "../$other_vm" ] || [ "$other_vm" = "$vm" ]; then
            continue
        fi
        
        cd "../$other_vm"
        pubkey=$(vagrant ssh -c "cat ~/.ssh/id_rsa.pub" 2>/dev/null | tr -d '\r')
        if [ -n "$pubkey" ]; then
            echo "$pubkey" >> /tmp/all_keys.txt
        fi
        cd - > /dev/null
    done
    
    # Add own key too (for completeness)
    cd "../$vm"
    own_key=$(vagrant ssh -c "cat ~/.ssh/id_rsa.pub" 2>/dev/null | tr -d '\r')
    echo "$own_key" >> /tmp/all_keys.txt
    
    # Copy all keys to the VM's authorized_keys
    cat /tmp/all_keys.txt | vagrant ssh -c "cat >> ~/.ssh/authorized_keys && sort -u ~/.ssh/authorized_keys -o ~/.ssh/authorized_keys"
    
    # Set proper permissions
    vagrant ssh -c "chmod 600 ~/.ssh/authorized_keys"
    
    echo "  ✅ SSH keys configured on $vm"
    cd ..
    
    rm -f /tmp/all_keys.txt
done

echo -e "\n${GREEN}=========================================${NC}"
echo -e "${GREEN}SSH key setup complete!${NC}"
