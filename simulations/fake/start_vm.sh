#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Starting Maya Deception Fabric VMs${NC}"
echo -e "${GREEN}=========================================${NC}"

# Function to check if VM is really running (using virsh)
is_vm_running() {
    local vm=$1
    # Check both with and without _default suffix
    if sudo virsh domstate "${vm}_default" 2>/dev/null | grep -q "running"; then
        return 0
    elif sudo virsh domstate "$vm" 2>/dev/null | grep -q "running"; then
        return 0
    else
        return 1
    fi
}

# Function to start a VM
start_vm() {
    local vm=$1
    local provider=${2:-libvirt}
    
    if [ ! -d "$vm" ]; then
        echo -e "${RED}❌ Directory $vm not found${NC}"
        return 1
    fi
    
    echo -e "${YELLOW}Starting $vm with provider: $provider...${NC}"
    cd "$vm"
    
    # Check if VM is really running using virsh
    if is_vm_running "$vm"; then
        echo -e "${GREEN}✅ $vm is already running (confirmed by virsh)${NC}"
        cd ..
        return 0
    fi
    
    # Try to start the VM
    echo "  Running vagrant up..."
    vagrant up --provider="$provider"
    
    if [ $? -eq 0 ]; then
        # Wait a bit for VM to fully boot
        sleep 5
        
        # Verify it's running with virsh
        if is_vm_running "$vm"; then
            echo -e "${GREEN}✅ Successfully started $vm${NC}"
            
            # Get IP address
            ip=$(vagrant ssh -c "hostname -I | awk '{print \$1}'" 2>/dev/null | tr -d '\r')
            if [ -n "$ip" ]; then
                echo -e "   IP Address: $ip"
            fi
        else
            echo -e "${RED}❌ VM $vm started but not detected by virsh${NC}"
        fi
    else
        echo -e "${RED}❌ Failed to start $vm${NC}"
    fi
    
    cd ..
    echo ""
}

# Start gateway-vm first
echo -e "${GREEN}Step 1: Starting Gateway VM (Honey Wall)${NC}"
start_vm "gateway-vm" "libvirt"

# Give gateway VM time to initialize networking
echo -e "${YELLOW}Waiting 10 seconds for gateway VM to initialize...${NC}"
sleep 10

# Start all fake VMs
echo -e "${GREEN}Step 2: Starting Honeypot VMs${NC}"

FAKE_VMS="fake-ftp-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-01 fake-web-02 fake-web-03"

for vm in $FAKE_VMS; do
    if [ -d "$vm" ]; then
        start_vm "$vm" "libvirt"
    else
        echo -e "${RED}❌ Directory $vm not found${NC}"
    fi
done

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Final VM Status:${NC}"
echo -e "${GREEN}=========================================${NC}"
sudo virsh list --all | grep -E "(fake-|gateway)"