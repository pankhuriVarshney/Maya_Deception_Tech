#!/bin/bash
# VM Management Script for Maya Honeypot Infrastructure

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VAGRANT_DIR="${SCRIPT_DIR}/../simulations/fake"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

list_vms() {
    log_info "Available VMs:"
    for dir in "$VAGRANT_DIR"/*/; do
        if [[ -f "${dir}Vagrantfile" ]]; then
            local vm_name=$(basename "$dir")
            # Fixed: Check for actual vagrant status properly
            # Machine-readable format is: timestamp,vm_name,state,running
            local status=""
            if cd "$dir" 2>/dev/null; then
                status=$(vagrant status --machine-readable 2>/dev/null | grep ",state," | head -1 | cut -d',' -f4)
                cd - >/dev/null 2>&1
            fi
            
            if [[ "$status" == "running" ]]; then
                echo -e "  ${GREEN}●${NC} $vm_name (Running)"
            else
                # Double-check with simple status in case machine-readable fails
                if cd "$dir" 2>/dev/null; then
                    local simple_status=$(vagrant status 2>/dev/null | grep -i "running" || true)
                    cd - >/dev/null 2>&1
                    if [[ -n "$simple_status" ]]; then
                        echo -e "  ${GREEN}●${NC} $vm_name (Running)"
                    else
                        echo -e "  ${RED}●${NC} $vm_name (Stopped)"
                    fi
                else
                    echo -e "  ${RED}●${NC} $vm_name (Unknown)"
                fi
            fi
        fi
    done
}

start_vm() {
    local vm=$1
    if [[ -z "$vm" ]]; then
        log_error "Please specify VM name"
        list_vms
        exit 1
    fi
    
    local vm_dir="${VAGRANT_DIR}/${vm}"
    if [[ ! -d "$vm_dir" ]]; then
        log_error "VM $vm not found"
        exit 1
    fi
    
    log_info "Starting $vm..."
    cd "$vm_dir"
    vagrant up --provider=libvirt
    log_success "$vm started"
}

stop_vm() {
    local vm=$1
    if [[ -z "$vm" ]]; then
        log_error "Please specify VM name"
        list_vms
        exit 1
    fi
    
    local vm_dir="${VAGRANT_DIR}/${vm}"
    cd "$vm_dir"
    vagrant halt
    log_success "$vm stopped"
}

restart_vm() {
    local vm=$1
    stop_vm "$vm"
    sleep 2
    start_vm "$vm"
}

ssh_vm() {
    local vm=$1
    if [[ -z "$vm" ]]; then
        log_error "Please specify VM name"
        list_vms
        exit 1
    fi
    
    local vm_dir="${VAGRANT_DIR}/${vm}"
    cd "$vm_dir"
    vagrant ssh
}

destroy_vm() {
    local vm=$1
    if [[ -z "$vm" ]]; then
        log_error "Please specify VM name"
        list_vms
        exit 1
    fi
    
    log_warning "This will destroy $vm and all its data!"
    read -p "Are you sure? (yes/no): " confirm
    if [[ "$confirm" == "yes" ]]; then
        local vm_dir="${VAGRANT_DIR}/${vm}"
        cd "$vm_dir"
        vagrant destroy -f
        log_success "$vm destroyed"
    else
        log_info "Cancelled"
    fi
}

provision_vm() {
    local vm=$1
    if [[ -z "$vm" ]]; then
        log_error "Please specify VM name"
        exit 1
    fi
    
    local vm_dir="${VAGRANT_DIR}/${vm}"
    cd "$vm_dir"
    vagrant provision
    log_success "$vm provisioned"
}

show_vm_info() {
    local vm=$1
    if [[ -z "$vm" ]]; then
        log_error "Please specify VM name"
        list_vms
        exit 1
    fi
    
    local vm_dir="${VAGRANT_DIR}/${vm}"
    cd "$vm_dir"
    
    echo -e "\n${BLUE}=== $vm Information ===${NC}"
    vagrant status
    echo ""
    vagrant ssh -c "ip addr show" 2>/dev/null || log_warning "VM not running"
}

case "${1:-list}" in
    "list")
        list_vms
        ;;
    "start")
        start_vm "$2"
        ;;
    "stop")
        stop_vm "$2"
        ;;
    "restart")
        restart_vm "$2"
        ;;
    "ssh")
        ssh_vm "$2"
        ;;
    "destroy")
        destroy_vm "$2"
        ;;
    "provision")
        provision_vm "$2"
        ;;
    "info")
        show_vm_info "$2"
        ;;
    *)
        echo "Usage: $0 {list|start|stop|restart|ssh|destroy|provision|info} [vm-name]"
        echo ""
        echo "Examples:"
        echo "  $0 list                    # List all VMs"
        echo "  $0 start fake-web-01       # Start specific VM"
        echo "  $0 stop fake-ftp-01        # Stop specific VM"
        echo "  $0 ssh fake-jump-01        # SSH into VM"
        echo "  $0 info gateway-vm         # Show VM info"
        exit 1
        ;;
esac