#!/bin/bash
# Maya Honeypot Orchestrator - Main Setup Script
# This script automates the entire honeypot infrastructure deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="${PROJECT_ROOT}/config/infrastructure.json"
VAGRANT_DIR="${PROJECT_ROOT}/simulations/fake"
CRDT_DIR="${PROJECT_ROOT}/scripts/crdt"

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    local deps=("vagrant" "docker" "docker-compose" "jq")
    for dep in "${deps[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            log_error "$dep is not installed. Please install it first."
            exit 1
        fi
    done
    
    # Check if libvirt is available for vagrant
    if ! vagrant plugin list | grep -q "vagrant-libvirt"; then
        log_warning "vagrant-libvirt plugin not found. Installing..."
        vagrant plugin install vagrant-libvirt
    fi
    
    log_success "All prerequisites satisfied"
}

# Load configuration
load_config() {
    if [[ ! -f "$CONFIG_FILE" ]]; then
        log_error "Configuration file not found: $CONFIG_FILE"
        exit 1
    fi
    
    log_info "Loading configuration from $CONFIG_FILE"
    
    # Export configuration variables
    export GATEWAY_IP=$(jq -r '.gateway.ip' "$CONFIG_FILE")
    export GATEWAY_INTERFACE_1=$(jq -r '.gateway.interface1' "$CONFIG_FILE")
    export GATEWAY_INTERFACE_2=$(jq -r '.gateway.interface2' "$CONFIG_FILE")
    export NETWORK_CIDR=$(jq -r '.network.cidr' "$CONFIG_FILE")
    export NETWORK_GATEWAY=$(jq -r '.network.gateway' "$CONFIG_FILE")
    export NETWORK_DNS=$(jq -r '.network.dns' "$CONFIG_FILE")
    
    log_success "Configuration loaded"
}
get_default_interface() {
    ip route | grep default | awk '{print $5}' | head -n1
}

# Setup Gateway VM (Honey Wall)
# Setup Gateway VM (Honey Wall)
setup_gateway() {
    log_info "Setting up Gateway VM (Honey Wall)..."
    
    cd "${VAGRANT_DIR}/gateway-vm"
    
    # Detect interface on host machine
    local host_interface=$(ip route | grep default | awk '{print $5}' | head -n1)
    log_info "Detected host network interface: $host_interface"
    
    # Create Vagrantfile for Gateway if it doesn't exist
    if [[ ! -f "Vagrantfile" ]]; then
        # Use double quotes and escape properly for variable expansion
        cat > Vagrantfile << EOF
# -*- mode: ruby -*-
# vi: set ft=ruby :

Vagrant.configure("2") do |config|
  config.vm.box = "generic/debian12"
  config.vm.box_version = "4.3.12"
  config.vm.hostname = "gateway-vm"
  
  # Interface 1: Connected to real internal network (192.168.10.0/24)
  config.vm.network "public_network",
    dev: "${host_interface}",
    ip: "192.168.10.5",
    netmask: "255.255.255.0"
  
  # Interface 2: Bridge to segment VMs (internal bridge)
  config.vm.network "private_network",
    libvirt__network_name: "maya_internal",
    ip: "10.20.20.1",
    netmask: "255.255.255.0"
  
  config.vm.provider :libvirt do |lv|
    lv.memory = 2048
    lv.cpus = 2
    lv.nic_model_type = "virtio"
    lv.cpu_mode = "host-model"
  end
  
  config.vm.provision "shell", inline: <<-SHELL
    # Update system
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" bridge-utils iptables-persistent tcpdump tshark net-tools
    # Enable IP forwarding
    echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
    sysctl -p
    
    # Detect the external interface (could be eth0, ens3, enp0s3, etc.)
    EXT_IFACE=\$(ip route | grep default | awk '{print \$5}' | head -n1)
    
    # Setup bridge br0 connecting eth1 (internal) to segment VMs
    cat > /etc/netplan/02-bridge.yaml << 'NETPLAN'
network:
  version: 2
  bridges:
    br0:
      interfaces: [eth1]
      dhcp4: no
      addresses: [10.20.20.2/24]
NETPLAN
    
    netplan apply
    
    # Setup NAT for outbound traffic from honeypots
    iptables -t nat -A POSTROUTING -s 10.20.20.0/24 -o \$EXT_IFACE -j MASQUERADE
    
    # Allow forwarding between interfaces
    iptables -A FORWARD -i \$EXT_IFACE -o br0 -m state --state RELATED,ESTABLISHED -j ACCEPT
    iptables -A FORWARD -i br0 -o \$EXT_IFACE -j ACCEPT
    
    # Save iptables rules
    netfilter-persistent save
    
    # Install Docker for potential management containers
    apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian \$(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    
    # Add vagrant user to docker group
    usermod -aG docker vagrant
    
    echo "Gateway VM configured successfully"
  SHELL
end
EOF
    fi
    
    # Start the gateway VM
    vagrant up --provider=libvirt
    
    log_success "Gateway VM is up and running"
}

# Discover and process Vagrant files from simulations/fake
discover_vagrant_files() {
    log_info "Discovering Vagrant configurations..." >&2
    
    local vagrant_files=()
    
    for dir in "$VAGRANT_DIR"/*/; do
        if [[ -f "${dir}Vagrantfile" ]]; then
            local vm_name=$(basename "$dir")
            vagrant_files+=("$vm_name")
            log_info "Found Vagrantfile for: $vm_name" >&2
        fi
    done
    
    if [[ ${#vagrant_files[@]} -eq 0 ]]; then
        log_warning "No Vagrantfiles found in $VAGRANT_DIR" >&2
    fi
    
    echo "${vagrant_files[@]}"
}

# Modify existing Vagrantfiles to use macvlan networking
modify_vagrant_networking() {
    local vm_name=$1
    local vm_dir="${VAGRANT_DIR}/${vm_name}"
    
    log_info "Configuring macvlan networking for $vm_name..."
    
    # Backup original Vagrantfile
    if [[ ! -f "${vm_dir}/Vagrantfile.backup" ]]; then
        cp "${vm_dir}/Vagrantfile" "${vm_dir}/Vagrantfile.backup"
    fi
    
    # Create the provisioning block in a temp file
    cat > /tmp/provision_block.txt << 'PROVISION'

  # Docker macvlan network configuration (appended by orchestrator)
  config.vm.provision "shell", inline: <<-SHELL
    # Install Docker if not present
    if ! command -v docker &> /dev/null; then
      apt-get update
      apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release
      curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
      echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
      apt-get update
      apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
      usermod -aG docker vagrant
    fi
    
    # Enable promiscuous mode on eth1 (private network interface)
    ip link set eth1 promisc on
    
    # Get IP and network info from eth1
    IP_ADDR=$(ip -4 addr show eth1 | grep -oP '(?<=inet\s)\d+(\.\d+){3}')
    NETWORK=$(ip -4 addr show eth1 | grep -oP '(?<=inet\s)\d+(\.\d+){3}/\d+')
    
    # Create macvlan network for containers to appear as physical hosts
    docker network rm honeypot-macvlan 2>/dev/null || true
    docker network create -d macvlan \
      --subnet="${NETWORK}" \
      --gateway="${IP_ADDR%/*}" \
      -o parent=eth1 \
      honeypot-macvlan
    
    # Create internal bridge network for container-to-container communication
    docker network rm honeypot-internal 2>/dev/null || true
    docker network create --driver bridge honeypot-internal
    
    echo "Docker networking configured for macvlan"
  SHELL
PROVISION

    # Insert before the last line (the final 'end')
    head -n -1 "${vm_dir}/Vagrantfile" > /tmp/vagrantfile_temp.rb
    cat /tmp/provision_block.txt >> /tmp/vagrantfile_temp.rb
    tail -n 1 "${vm_dir}/Vagrantfile" >> /tmp/vagrantfile_temp.rb
    mv /tmp/vagrantfile_temp.rb "${vm_dir}/Vagrantfile"
    
    rm -f /tmp/provision_block.txt
}
# Build and deploy CRDT binary to VMs
deploy_crdt() {
    log_info "Building and deploying CRDT binary..."
    
    cd "$CRDT_DIR"
    
    # Check if Rust is installed
    if ! command -v cargo &> /dev/null; then
        log_error "Rust/Cargo not found. Please install Rust first."
        exit 1
    fi
    
    # Add musl target for static binary
    rustup target add x86_64-unknown-linux-musl 2>/dev/null || true
    
    # Build static binary
    cargo build --release --target x86_64-unknown-linux-musl
    
    local binary_path="${CRDT_DIR}/target/x86_64-unknown-linux-musl/release/maya-crdt"
    
    if [[ ! -f "$binary_path" ]]; then
        log_error "CRDT binary build failed"
        exit 1
    fi
    
    log_success "CRDT binary built successfully"
    
    # Deploy to all VMs
    local vms=$(discover_vagrant_files)
    
    for vm in $vms; do
        log_info "Deploying CRDT to $vm..."
        
        cd "${VAGRANT_DIR}/${vm}"
        
        # Copy binary to VM
        vagrant scp "$binary_path" /tmp/maya-crdt 2>/dev/null || {
            # Fallback if vagrant-scp plugin not available
            vagrant ssh -c "cat > /tmp/maya-crdt" < "$binary_path"
        }
        
        # Setup the binary inside VM
        vagrant ssh -c "
          sudo mv /tmp/maya-crdt /usr/local/bin/syslogd-helper
          sudo chmod 755 /usr/local/bin/syslogd-helper
          sudo mkdir -p /var/lib
          sudo touch /var/lib/.syscache
          sudo chmod 600 /var/lib/.syscache
          sudo mkdir -p /etc/syslogd-helper
          echo '10.20.20.1' | sudo tee /etc/syslogd-helper/peers.conf
        "
        
        log_success "CRDT deployed to $vm"
    done
}

# Setup CRDT synchronization hooks
setup_crdt_hooks() {
    log_info "Setting up CRDT synchronization hooks..."
    
    local vms=$(discover_vagrant_files)
    
    for vm in $vms; do
        log_info "Configuring hooks for $vm..."
        
        cd "${VAGRANT_DIR}/${vm}"
        
        # Determine hook type based on VM role
        local hook_type="ssh"  # default
        
        if [[ "$vm" == *"web"* ]]; then
            hook_type="http"
        elif [[ "$vm" == *"ftp"* ]]; then
            hook_type="ftp"
        elif [[ "$vm" == *"jump"* ]]; then
            hook_type="ssh"
        fi
        
        case $hook_type in
            "ssh")
                setup_ssh_hook "$vm"
                ;;
            "http")
                setup_http_hook "$vm"
                ;;
            "ftp")
                setup_ftp_hook "$vm"
                ;;
        esac
    done
}

setup_ssh_hook() {
    local vm=$1
    
    cd "${VAGRANT_DIR}/${vm}"
    
    vagrant ssh -c "
      # Create SSH hook script
      sudo tee /etc/profile.d/10-sys-audit.sh > /dev/null << 'HOOK'
#!/bin/sh
# Only run for SSH sessions
[ -z \"\$SSH_CONNECTION\" ] && return

# Randomize execution to avoid pattern detection
[ \"\$((RANDOM % 5))\" -ne 0 ] && return

# Sync CRDT state
/usr/local/bin/syslogd-helper sync >/dev/null 2>&1 &
HOOK
      sudo chmod 644 /etc/profile.d/10-sys-audit.sh
      
      # Create sync wrapper
      sudo tee /usr/local/bin/ssh-audit > /dev/null << 'WRAPPER'
#!/bin/sh
LOG=\"/var/log/ssh_auth.log\"
tail -n 20 /var/log/auth.log | while read line; do
  echo \"\$line\" | /usr/local/bin/syslogd-helper observe
done
WRAPPER
      sudo chmod 755 /usr/local/bin/ssh-audit
    "
}

setup_http_hook() {
    local vm=$1
    
    cd "${VAGRANT_DIR}/${vm}"
    
    vagrant ssh -c "
      # Create internal endpoint directory
      sudo mkdir -p /var/www/internal
      
      # Add nginx configuration for internal endpoint
      sudo tee /etc/nginx/sites-available/internal > /dev/null << 'NGINX'
server {
    listen 8080;
    server_name localhost;
    
    location /internal/status {
        allow 10.20.20.0/24;
        deny all;
        alias /var/www/internal/state.json;
    }
}
NGINX
      
      sudo ln -sf /etc/nginx/sites-available/internal /etc/nginx/sites-enabled/internal
      
      # Create logrotate hook for CRDT sync
      sudo tee /etc/logrotate.d/nginx-crdt > /dev/null << 'LOGROTATE'
/var/log/nginx/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        /usr/local/bin/syslogd-helper sync >/dev/null 2>&1 || true
    endscript
}
LOGROTATE
      
      sudo systemctl restart nginx
    "
}

setup_ftp_hook() {
    local vm=$1
    
    cd "${VAGRANT_DIR}/${vm}"
    
    vagrant ssh -c "
      # Create vsftpd log hook
      sudo tee /etc/logrotate.d/vsftpd-crdt > /dev/null << 'LOGROTATE'
/var/log/vsftpd.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 0600 root root
    postrotate
        /usr/local/bin/syslogd-helper sync >/dev/null 2>&1 || true
    endscript
}
LOGROTATE
      
      # Add cron job for periodic sync
      (crontab -l 2>/dev/null; echo \"*/5 * * * * /usr/local/bin/syslogd-helper sync >/dev/null 2>&1\") | crontab -
    "
}

# Start all VMs
start_infrastructure() {
    log_info "Starting all honeypot VMs..."
    
    local vms=$(discover_vagrant_files)
    
    for vm in $vms; do
        log_info "Starting $vm..."
        cd "${VAGRANT_DIR}/${vm}"
        vagrant up --provider=libvirt
    done
    
    log_success "All VMs started successfully"
}

# Stop all VMs
stop_infrastructure() {
    log_info "Stopping all honeypot VMs..."
    
    local vms=$(discover_vagrant_files)
    
    for vm in $vms; do
        log_info "Stopping $vm..."
        cd "${VAGRANT_DIR}/${vm}"
        vagrant halt
    done
    
    log_success "All VMs stopped"
}

# Get status of all VMs
get_status() {
    log_info "Getting infrastructure status..."
    
    echo -e "\n${BLUE}=== VM Status ===${NC}"
    
    local vms=$(discover_vagrant_files)
    
    for vm in $vms; do
        cd "${VAGRANT_DIR}/${vm}"
        local status=$(vagrant status --machine-readable | grep state-running | cut -d',' -f4)
        if [[ "$status" == "running" ]]; then
            echo -e "${GREEN}●${NC} $vm: Running"
        else
            echo -e "${RED}●${NC} $vm: $status"
        fi
    done
    
    echo -e "\n${BLUE}=== CRDT State Summary ===${NC}"
    
    # Collect and merge states from all nodes
    for vm in $vms; do
        cd "${VAGRANT_DIR}/${vm}"
        if vagrant status --machine-readable | grep -q "state-running,running"; then
            echo -e "\n${YELLOW}$vm:${NC}"
            vagrant ssh -c "sudo /usr/local/bin/syslogd-helper stats" 2>/dev/null || echo "  Unable to retrieve stats"
        fi
    done
}

# Main execution
main() {
    case "${1:-setup}" in
        "setup")
            check_prerequisites
            load_config
            setup_gateway
            
            # Process all discovered Vagrant files
            local vms=$(discover_vagrant_files)
            for vm in $vms; do
                if [[ "$vm" != "gateway-vm" ]]; then
                    modify_vagrant_networking "$vm"
                fi
            done
            
            start_infrastructure
            deploy_crdt
            setup_crdt_hooks
            
            log_success "Maya Honeypot Infrastructure setup complete!"
            log_info "Gateway VM: 192.168.10.5 (Honey Wall)"
            log_info "Honeypot Segment: 10.20.20.0/24"
            log_info "Access the controller API at http://localhost:3001"
            ;;
            
        "start")
            start_infrastructure
            ;;
            
        "stop")
            stop_infrastructure
            ;;
            
        "status")
            get_status
            ;;
            
        "destroy")
            log_warning "Destroying all VMs..."
            local vms=$(discover_vagrant_files)
            for vm in $vms; do
                cd "${VAGRANT_DIR}/${vm}"
                vagrant destroy -f
            done
            log_success "All VMs destroyed"
            ;;
            
        "sync")
            log_info "Triggering manual CRDT sync..."
            local vms=$(discover_vagrant_files)
            for vm in $vms; do
                cd "${VAGRANT_DIR}/${vm}"
                if vagrant status --machine-readable | grep -q "state-running,running"; then
                    vagrant ssh -c "sudo /usr/local/bin/syslogd-helper sync"
                fi
            done
            ;;
            
        *)
            echo "Usage: $0 {setup|start|stop|status|destroy|sync}"
            exit 1
            ;;
    esac
}

main "$@"