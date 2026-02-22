#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Setting up CRDT Systemd Service${NC}"
echo -e "${GREEN}=========================================${NC}"

VMS="fake-ftp-01 fake-web-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-02 fake-web-03 gateway-vm"

for vm in $VMS; do
    if [ ! -d "$vm" ]; then
        continue
    fi
    
    echo -e "\n${YELLOW}Setting up service on $vm...${NC}"
    cd "$vm"
    
    # Create systemd service file
    vagrant ssh << 'EOFSERVICE'
    # Create systemd service
    sudo tee /etc/systemd/system/syslogd-helper.service > /dev/null << 'EOF'
[Unit]
Description=CRDT Synchronization Daemon
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/syslogd-helper daemon
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

    # Reload systemd, enable and start service
    sudo systemctl daemon-reload
    sudo systemctl enable syslogd-helper.service
    sudo systemctl restart syslogd-helper.service
    sleep 2
    
    # Check status
    if sudo systemctl is-active --quiet syslogd-helper.service; then
        echo "  ✅ Service running on $(hostname)"
        sudo systemctl status syslogd-helper.service --no-pager | head -3
    else
        echo "  ❌ Service failed to start on $(hostname)"
        sudo journalctl -u syslogd-helper.service -n 5 --no-pager
    fi
EOFSERVICE
    
    cd ..
done

echo -e "\n${GREEN}=========================================${NC}"
echo -e "${GREEN}Service setup complete!${NC}"
