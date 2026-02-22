#!/bin/bash

# List all VM directories
VMS="fake-ftp-01 fake-jump-01 fake-rdp-01 fake-smb-01 fake-ssh-01 fake-web-01 fake-web-02 fake-web-03 gateway-vm"

for vm in $VMS; do
  if [ -d "$vm" ]; then
    echo "========================================="
    echo "Processing $vm..."
    echo "========================================="
    cd "$vm"
    
    # Try vagrant destroy first (cleanest)
    echo "  Attempting vagrant destroy..."
    vagrant destroy -f 2>/dev/null
    
    # Destroy libvirt domain if still exists
    echo "  Removing libvirt domain..."
    virsh destroy "$vm"_default 2>/dev/null
    virsh undefine "$vm"_default --remove-all-storage 2>/dev/null
    
    # Also try without _default suffix
    virsh destroy "$vm" 2>/dev/null
    virsh undefine "$vm" --remove-all-storage 2>/dev/null
    
    # Remove any leftover storage volumes
    echo "  Removing storage volumes..."
    virsh vol-delete --pool default "$vm"_default.img 2>/dev/null
    virsh vol-delete --pool default "$vm.img" 2>/dev/null
    
    # Remove vagrant state
    echo "  Cleaning vagrant data..."
    rm -rf .vagrant
    rm -f vagrant_provisioners/* 2>/dev/null
    
    # Also clean up any VirtualBox stuff (for fake-jump-01)
    VBoxManage controlvm "$vm"_default poweroff 2>/dev/null
    VBoxManage unregistervm "$vm"_default --delete 2>/dev/null
    
    cd ..
    echo "  ✅ Done with $vm"
    echo ""
  fi
done

echo "========================================="
echo "Checking remaining libvirt domains:"
virsh list --all

echo ""
echo "Checking remaining Vagrant state:"
for vm in $VMS; do
  if [ -d "$vm" ]; then
    cd "$vm"
    echo -n "$vm: "
    vagrant status | grep "default" | head -1
    cd ..
  fi
done
