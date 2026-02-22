#!/bin/bash

declare -A VM_IPS
VMS="fake-web-01 fake-jump-01 fake-ftp-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-02 fake-web-03 gateway-vm"

echo "=== VM IP Addresses ==="
for vm in $VMS; do
    if [ ! -d "$vm" ]; then
        continue
    fi
    
    cd "$vm"
    
    # Get the internal network IP (10.20.20.x)
    if [ "$vm" = "fake-jump-01" ]; then
        # Alpine Linux
        ip=$(vagrant ssh -c "ip addr show eth1 | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1" 2>/dev/null | tr -d '\r')
    else
        # Debian/Ubuntu - try to get eth1 IP specifically
        ip=$(vagrant ssh -c "ip addr show eth1 | grep 'inet ' | awk '{print \$2}' | cut -d/ -f1" 2>/dev/null | tr -d '\r')
        if [ -z "$ip" ]; then
            # Fallback to hostname -I
            ip=$(vagrant ssh -c "hostname -I | awk '{print \$1}'" 2>/dev/null | tr -d '\r')
        fi
    fi
    
    VM_IPS["$vm"]="$ip"
    echo "$vm: $ip"
    cd ..
done

# Save to a file for other scripts
declare -p VM_IPS > /tmp/vm_ips.txt
