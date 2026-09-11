#!/bin/bash
# Fix CRDT Monitoring on All VMs - Simple Version

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAKE_DIR="$SCRIPT_DIR/../simulations/fake"

echo "========================================="
echo "Installing CRDT Monitoring Hooks"
echo "========================================="

VMS=("fake-jump-01" "fake-web-01" "fake-web-02" "fake-ftp-01" "fake-rdp-01" "fake-smb-01")

for vm in "${VMS[@]}"; do
    vm_path="$FAKE_DIR/$vm"
    
    if [ ! -d "$vm_path" ]; then
        echo "⚠️  Skipping $vm - directory not found"
        continue
    fi
    
    echo ""
    echo "📡 Configuring $vm..."
    
    # Check if VM is running
    if ! cd "$vm_path" && vagrant status --machine-readable 2>/dev/null | grep -q "state-running,running"; then
        echo "  ⚠️  VM is not running, skipping..."
        continue
    fi
    
    echo "  ✅ VM is running"
    cd "$vm_path"
    
    # Copy SSH hook to profile.d
    echo "  📝 Installing SSH login hook..."
    vagrant ssh -c "sudo tee /etc/profile.d/10-sys-audit.sh > /dev/null" < "$SCRIPT_DIR/10-sys-audit.sh"
    vagrant ssh -c "sudo chmod +x /etc/profile.d/10-sys-audit.sh"
    
    # Also add to bash.bashrc for non-login shells
    echo "  📝 Adding hook to bash.bashrc..."
    vagrant ssh -c 'sudo bash -c "grep -q '\''syslogd-helper visit'\'' /etc/bash.bashrc || cat /etc/profile.d/10-sys-audit.sh >> /etc/bash.bashrc"'

    # Copy command hook
    echo "  📝 Installing command monitoring..."
    vagrant ssh -c "sudo tee /etc/profile.d/20-sys-command-audit.sh > /dev/null" < "$SCRIPT_DIR/20-sys-command-audit.sh"
    vagrant ssh -c "sudo chmod +x /etc/profile.d/20-sys-command-audit.sh"
    vagrant ssh -c 'sudo bash -c "grep -q '\''syslogd-helper action'\'' /etc/bash.bashrc || cat /etc/profile.d/20-sys-command-audit.sh >> /etc/bash.bashrc"'

    # NOTE: this used to also cron a `syslogd-helper sync` call every minute.
    # That subcommand does not exist (see scripts/crdt/src/main.rs) and was a
    # silent no-op. Continuous peer sync is handled by the syslogd-helper
    # daemon -- run `./scripts/setup-infrastructure.sh setup` (or `fix` on an
    # already-provisioned VM) so deploy_crdt installs and starts it on every VM.

    # Verify
    echo "  🔍 Verifying installation..."
    vagrant ssh -c 'test -f /etc/profile.d/10-sys-audit.sh && echo "    ✅ SSH Hook installed" || echo "    ❌ SSH Hook missing"'
    vagrant ssh -c 'test -f /etc/profile.d/20-sys-command-audit.sh && echo "    ✅ Command Hook installed" || echo "    ❌ Command Hook missing"'
    vagrant ssh -c 'test -x /usr/local/bin/syslogd-helper && echo "    ✅ CRDT Binary found" || echo "    ❌ CRDT Binary missing"'
    
    echo "  ✅ $vm configured!"
done

echo ""
echo "========================================="
echo "✅ Installation Complete!"
echo "========================================="
echo ""
echo "Test it now:"
echo "1. SSH into a VM: ./manage-vms.sh ssh fake-web-01"
echo "2. Run commands: whoami, cat /etc/passwd"
echo "3. Check CRDT stats: vagrant ssh -c 'sudo syslogd-helper stats'"
echo "4. Watch the dashboard for real-time alerts!"
echo ""
