#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Deploying CRDT syslogd-helper to all VMs${NC}"
echo -e "${GREEN}=========================================${NC}"

# Path to the compiled binary
CRDT_BIN="/home/maria/Documents/Maya/scripts/crdt/syslogd-helper"

if [ ! -f "$CRDT_BIN" ]; then
    echo -e "${RED}❌ CRDT binary not found at $CRDT_BIN${NC}"
    echo "Please compile it first: cd ~/Documents/Maya/scripts/crdt && cargo build --release --target x86_64-unknown-linux-musl"
    exit 1
fi

echo -e "Using CRDT binary: $CRDT_BIN"
file "$CRDT_BIN"

cd /home/maria/Documents/Maya/simulations/fake

# Fix: Remove duplicate fake-ftp-01 from the list
VMS="fake-ftp-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-01 fake-web-02 fake-web-03 gateway-vm"
DEPLOYED=0
FAILED=0
SKIPPED=0

for vm in $VMS; do
    if [ ! -d "$vm" ]; then
        echo -e "${YELLOW}⚠️  Directory $vm not found, skipping${NC}"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi
    
    echo -e "\n${YELLOW}Processing $vm...${NC}"
    cd "$vm"
    
    # Check if VM is running
    if ! vagrant status | grep -q "running"; then
        echo -e "${YELLOW}  ⚠️  $vm is not running, skipping${NC}"
        SKIPPED=$((SKIPPED + 1))
        cd ..
        continue
    fi
    
    echo -e "  ✅ VM is running, deploying binary..."
    
    # Stop the service if it's running
    echo "  Stopping syslogd-helper service..."
    if [ "$vm" = "fake-jump-01" ]; then
        vagrant ssh -c "sudo rc-service syslogd-helper stop 2>/dev/null" || true
    else
        vagrant ssh -c "sudo systemctl stop syslogd-helper.service 2>/dev/null" || true
    fi
    
    # Kill any running processes just to be sure
    vagrant ssh -c "sudo pkill -f syslogd-helper 2>/dev/null" || true
    sleep 2
    
    # Copy the binary
    echo "  Copying new binary..."
    cat "$CRDT_BIN" | vagrant ssh -c "sudo tee /usr/local/bin/syslogd-helper > /dev/null"
    if [ $? -ne 0 ]; then
        echo -e "${RED}  ❌ Failed to copy binary to $vm${NC}"
        FAILED=$((FAILED + 1))
        cd ..
        continue
    fi
    
    # Set permissions
    vagrant ssh -c "sudo chmod +x /usr/local/bin/syslogd-helper"
    
    # Create state directory if it doesn't exist
    vagrant ssh -c "sudo mkdir -p /var/lib"
    
    # Initialize state file if it doesn't exist
    vagrant ssh -c "if [ ! -f /var/lib/.syscache ]; then echo '{}' | sudo tee /var/lib/.syscache > /dev/null; fi"
    vagrant ssh -c "sudo chmod 644 /var/lib/.syscache"
    
    # Restart the service
    echo "  Restarting syslogd-helper service..."
    if [ "$vm" = "fake-jump-01" ]; then
        vagrant ssh -c "sudo rc-service syslogd-helper start 2>/dev/null" || true
    else
        vagrant ssh -c "sudo systemctl start syslogd-helper.service 2>/dev/null" || true
    fi
    
    sleep 2
    
    # Test the binary
    echo -e "  Testing binary on $vm:"
    TEST_OUTPUT=$(vagrant ssh -c "/usr/local/bin/syslogd-helper stats 2>/dev/null || echo 'FAILED'")
    if [ "$TEST_OUTPUT" = "FAILED" ]; then
        echo -e "${RED}  ❌ Binary test failed on $vm${NC}"
        FAILED=$((FAILED + 1))
    else
        echo -e "  ${GREEN}✅ Test successful${NC}"
        DEPLOYED=$((DEPLOYED + 1))
    fi
    
    cd ..
done

echo -e "\n${GREEN}=========================================${NC}"
echo -e "${GREEN}Deployment Summary:${NC}"
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}✅ Successfully deployed: $DEPLOYED VMs${NC}"
echo -e "${RED}❌ Failed: $FAILED VMs${NC}"
echo -e "${YELLOW}⚠️  Skipped: $SKIPPED VMs${NC}"

if [ $FAILED -eq 0 ]; then
    echo -e "\n${GREEN}✅ All running VMs now have syslogd-helper installed!${NC}"
else
    echo -e "\n${YELLOW}⚠️  Some deployments failed. Check the errors above.${NC}"
fi