for vm in fake-web-01 fake-ftp-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-02 fake-web-03 gateway-vm; do
    echo -n "$vm: "
    cd "$vm"
    
    if [ "$vm" = "fake-jump-01" ]; then
        # Alpine check
        vagrant ssh -c "ps aux | grep -v grep | grep -q 'syslogd-helper daemon' && echo '✅ Running' || echo '❌ Not running'"
    else
        # Systemd check
        vagrant ssh -c "systemctl is-active syslogd-helper.service 2>/dev/null | grep -q active && echo '✅ Running' || echo '❌ Not running'"
    fi
    
    cd ..
done
