#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Maya Deception Fabric VM Status${NC}"
echo -e "${GREEN}=========================================${NC}"

# Function to check VM status
check_vm() {
    local vm=$1
    
    if [ ! -d "$vm" ]; then
        echo -e "${RED}❌ $vm: Directory not found${NC}"
        return
    fi
    
    cd "$vm"
    
    # Get status from vagrant
    status=$(vagrant status --machine-readable | grep ",state," | cut -d, -f4 | head -1)
    
    # Get status from virsh for more detail
    virsh_status=$(virsh domstate "$vm"_default 2>/dev/null | head -1)
    
    # Get IP if running
    ip="N/A"
    if [ "$status" = "running" ]; then
        ip=$(vagrant ssh -c "hostname -I | awk '{print \$1}'" 2>/dev/null | tr -d '\r')
        if [ -z "$ip" ]; then
            ip="No IP (still booting)"
        fi
    fi
    
    # Color based on status
    if [ "$status" = "running" ]; then
        echo -e "${GREEN}✅ $vm${NC}"
        echo -e "   Status: ${GREEN}$status${NC} (virsh: $virsh_status)"
        echo -e "   IP: $ip"
        
        # Check if syslogd-helper exists
        has_helper=$(vagrant ssh -c "command -v syslogd-helper" 2>/dev/null | tr -d '\r')
        if [ -n "$has_helper" ]; then
            echo -e "   ${GREEN}✓ syslogd-helper installed${NC}"
        else
            echo -e "   ${RED}✗ syslogd-helper missing${NC}"
        fi
        
        # Check Docker
        docker_status=$(vagrant ssh -c "sudo docker ps -q 2>/dev/null | wc -l" 2>/dev/null | tr -d '\r')
        if [ -n "$docker_status" ] && [ "$docker_status" -gt 0 ]; then
            echo -e "   ${GREEN}✓ $docker_status containers running${NC}"
        fi
    elif [ "$status" = "shutoff" ] || [ "$status" = "poweroff" ]; then
        echo -e "${RED}❌ $vm: Stopped${NC}"
    else
        echo -e "${YELLOW}⚠️  $vm: $status${NC}"
    fi
    
    cd ..
    echo ""
}

# Check gateway-vm first
check_vm "gateway-vm"

# Check all fake VMs
for vm in fake-ftp-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-01 fake-web-02 fake-web-03; do
    if [ -d "$vm" ]; then
        check_vm "$vm"
    fi
done

echo -e "${GREEN}=========================================${NC}"
echo -e "Libvirt domain list:"
virsh list --all | grep -E "(fake-|gateway)" || echo "No VMs found"
