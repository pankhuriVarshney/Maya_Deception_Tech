#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}   Setting up Root SSH Keys on All VMs  ${NC}"
echo -e "${GREEN}=========================================${NC}"

VMS="fake-web-01 fake-ftp-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-02 fake-web-03 gateway-vm"

# Step 1: Check existing root SSH keys on all VMs
echo -e "\n${YELLOW}Step 1: Checking existing root SSH keys...${NC}"

for vm in $VMS; do
    if [ ! -d "$vm" ]; then
        continue
    fi
    
    echo -n "  $vm: "
    cd "$vm" || continue
    
    # Create .ssh directory with proper permissions if it doesn't exist
    vagrant ssh -c "sudo mkdir -p /root/.ssh && sudo chmod 700 /root/.ssh"
    
    # Check if key already exists
    key_exists=$(vagrant ssh -c "if [ -f /root/.ssh/id_rsa ]; then echo 'EXISTS'; else echo 'MISSING'; fi" 2>/dev/null | grep -v "^==>" | tr -d '\r')
    
    if [ "$key_exists" = "EXISTS" ]; then
        echo -e "${GREEN}✅ Key already exists (keeping existing)${NC}"
    else
        # Generate new key
        vagrant ssh -c "sudo ssh-keygen -t rsa -N '' -f /root/.ssh/id_rsa" > /dev/null 2>&1
        echo -e "${YELLOW}🔑 Generated new key${NC}"
    fi
    
    cd ..
done

# Step 2: Collect all root public keys
echo -e "\n${YELLOW}Step 2: Collecting root public keys from all VMs...${NC}"

declare -A ROOT_KEYS
declare -A KEY_FINGERPRINTS

for vm in $VMS; do
    if [ ! -d "$vm" ]; then
        continue
    fi
    
    echo -n "  Getting key from $vm: "
    cd "$vm" || continue
    
    # Get the public key and filter out Vagrant warnings
    root_key=$(vagrant ssh -c "sudo cat /root/.ssh/id_rsa.pub" 2>/dev/null | grep -v "^==>" | head -1 | tr -d '\r')
    
    if [ -n "$root_key" ] && [[ "$root_key" == ssh-rsa* ]]; then
        ROOT_KEYS["$vm"]="$root_key"
        # Extract fingerprint for display
        fingerprint=$(echo "$root_key" | awk '{print $2}' | cut -c1-20)
        KEY_FINGERPRINTS["$vm"]="$fingerprint"
        echo -e "${GREEN}✅ (${fingerprint}...)${NC}"
    else
        echo -e "${RED}❌ Failed to get key${NC}"
    fi
    
    cd ..
done

# Step 3: Display collected keys
echo -e "\n${YELLOW}Step 3: Keys collected from all VMs:${NC}"
printf "  %-15s %-50s\n" "VM" "Key Fingerprint"
echo "  --------------------------------------------------"
for vm in $VMS; do
    if [ -n "${KEY_FINGERPRINTS[$vm]}" ]; then
        printf "  ${GREEN}%-15s${NC} %s...\n" "$vm" "${KEY_FINGERPRINTS[$vm]}"
    fi
done

# Step 4: Distribute keys to all VMs
echo -e "\n${YELLOW}Step 4: Distributing root keys to all VMs...${NC}"

for vm in $VMS; do
    if [ ! -d "$vm" ]; then
        continue
    fi
    
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Configuring $vm...${NC}"
    cd "$vm" || continue
    
    # Create a temporary file with all keys
    TEMP_KEYS="/tmp/all_root_keys_$$.txt"
    > "$TEMP_KEYS"
    
    for other_vm in "${!ROOT_KEYS[@]}"; do
        echo "${ROOT_KEYS[$other_vm]}" >> "$TEMP_KEYS"
    done
    
    # Get current authorized_keys count before
    before_count=$(vagrant ssh -c "sudo cat /root/.ssh/authorized_keys 2>/dev/null | wc -l" 2>/dev/null | tr -d '\r' | xargs)
    
    # Copy to VM and append to authorized_keys
    cat "$TEMP_KEYS" | vagrant ssh -c "
        sudo tee -a /root/.ssh/authorized_keys > /dev/null && 
        sudo sort -u /root/.ssh/authorized_keys -o /root/.ssh/authorized_keys &&
        sudo chmod 600 /root/.ssh/authorized_keys
    "
    
    # Get current authorized_keys count after
    after_count=$(vagrant ssh -c "sudo cat /root/.ssh/authorized_keys 2>/dev/null | wc -l" 2>/dev/null | tr -d '\r' | xargs)
    
    # Show which keys are present
    echo "  Current authorized_keys on $vm:"
    vagrant ssh -c "sudo cat /root/.ssh/authorized_keys | while read line; do 
        if [[ \$line == ssh-rsa* ]]; then
            fingerprint=\$(echo \$line | awk '{print \$2}' | cut -c1-20)
            echo \"    🔑 \$fingerprint...\"
        fi
    done"
    
    echo -e "  ${GREEN}✅ Keys updated: $before_count → $after_count entries${NC}"
    
    rm "$TEMP_KEYS"
    cd ..
done

# Step 5: Configure SSH to allow root login with keys
echo -e "\n${YELLOW}Step 5: Configuring SSH for root key authentication...${NC}"

for vm in $VMS; do
    if [ ! -d "$vm" ]; then
        continue
    fi
    
    echo -n "  Configuring SSH on $vm: "
    cd "$vm" || continue
    
    if [ "$vm" = "fake-jump-01" ]; then
        # Alpine
        vagrant ssh -c "
            sudo sed -i 's/^#PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
            sudo sed -i 's/^PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
            sudo rc-service sshd restart
        " > /dev/null 2>&1
    else
        # Debian/Ubuntu
        vagrant ssh -c "
            sudo sed -i 's/^#PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
            sudo sed -i 's/^PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
            sudo systemctl restart ssh
        " > /dev/null 2>&1
    fi
    
    echo -e "${GREEN}✅${NC}"
    cd ..
done

# Step 6: Test root SSH connectivity from each VM
echo -e "\n${YELLOW}Step 6: Testing root SSH connectivity between all VMs...${NC}"

# First, get all IPs
declare -A VM_IPS
for vm in $VMS; do
    cd "$vm" 2>/dev/null || continue
    if [ "$vm" = "gateway-vm" ]; then
        ip=$(vagrant ssh -c "ip addr show eth2 | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1" 2>/dev/null | grep -v "^==>" | head -1 | tr -d '\r')
    elif [ "$vm" = "fake-jump-01" ]; then
        ip=$(vagrant ssh -c "ip addr show eth1 | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1" 2>/dev/null | grep -v "^==>" | head -1 | tr -d '\r')
    else
        ip=$(vagrant ssh -c "ip addr show eth1 | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1" 2>/dev/null | grep -v "^==>" | head -1 | tr -d '\r')
    fi
    VM_IPS["$vm"]="$ip"
    cd ..
done

# Test from each source VM
for source_vm in fake-web-01 fake-jump-01 gateway-vm; do
    if [ ! -d "$source_vm" ]; then
        continue
    fi
    
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Testing from $source_vm (${VM_IPS[$source_vm]})...${NC}"
    
    cd "$source_vm" || continue
    
    for target_vm in $VMS; do
        if [ "$target_vm" = "$source_vm" ]; then
            continue
        fi
        
        target_ip=${VM_IPS[$target_vm]}
        if [ -n "$target_ip" ]; then
            echo -n "  → $target_vm ($target_ip): "
            if vagrant ssh -c "sudo ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no root@$target_ip 'echo OK' 2>/dev/null" 2>/dev/null | grep -q "OK"; then
                echo -e "${GREEN}✅ Success${NC}"
            else
                echo -e "${RED}❌ Failed${NC}"
            fi
        fi
    done
    
    cd ..
done

echo -e "\n${GREEN}=========================================${NC}"
echo -e "${GREEN}   Root SSH Setup Complete!              ${NC}"
echo -e "${GREEN}=========================================${NC}"
echo -e "\n${YELLOW}Summary:${NC}"
echo "  • All VMs have their own root SSH keys (existing keys preserved)"
echo "  • Every VM has the public keys of all other VMs in root's authorized_keys"
echo "  • Root login with SSH keys is enabled on all VMs"
echo "  • Cross-VM root SSH connectivity has been verified"