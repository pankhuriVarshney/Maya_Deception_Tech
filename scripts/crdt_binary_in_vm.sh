#!/bin/bash

VMS="fake-ftp-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-01 fake-web-02 fake-web-03 gateway-vm"

for vm in $VMS; do
  if [ -d "../simulations/fake/$vm" ]; then
    echo "========================================="
    echo "Deploying syslogd-helper to $vm..."
    echo "========================================="
    
    cd "../simulations/fake/$vm"
    
    # Check if VM is running
    if vagrant status | grep -q "running"; then
      echo "  ✅ VM is running, deploying binary..."
      
      # Stop the service first
      if [ "$vm" = "fake-jump-01" ]; then
        vagrant ssh -c "sudo rc-service syslogd-helper stop 2>/dev/null" || true
      else
        vagrant ssh -c "sudo systemctl stop syslogd-helper.service 2>/dev/null" || true
      fi
      vagrant ssh -c "sudo pkill -f syslogd-helper 2>/dev/null" || true
      sleep 2
      
      # Copy the binary to VM
      cat ~/Documents/Maya/scripts/crdt/syslogd-helper | vagrant ssh -c "sudo tee /usr/local/bin/syslogd-helper > /dev/null"
      vagrant ssh -c "sudo chmod +x /usr/local/bin/syslogd-helper"
      
      # Verify installation
      echo "  Verifying installation:"
      vagrant ssh -c "ls -la /usr/local/bin/syslogd-helper"
      vagrant ssh -c "file /usr/local/bin/syslogd-helper"
      
      # Create initial state file
      vagrant ssh -c "sudo mkdir -p /var/lib && echo '{}' | sudo tee /var/lib/.syscache > /dev/null"
      vagrant ssh -c "sudo chmod 644 /var/lib/.syscache"
      
      # Restart the service
      if [ "$vm" = "fake-jump-01" ]; then
        vagrant ssh -c "sudo rc-service syslogd-helper start 2>/dev/null" || true
      else
        vagrant ssh -c "sudo systemctl start syslogd-helper.service 2>/dev/null" || true
      fi
      
      echo "  ✅ syslogd-helper deployed to $vm"
    else
      echo "  ⚠️  $vm is not running, skipping"
    fi
    
    cd - > /dev/null
    echo ""
  fi
done