#!/usr/bin/env bash
#
# kata-baremetal-cluster.sh -- Stage 2 of bare-metal Kata Containers setup.
#
# Brings up a real (non-kind) single-node kubeadm cluster on this host,
# using the containerd + kata runtime already verified working in stage 1
# (kata-baremetal-prep.sh), then registers a kata-containers RuntimeClass
# so decoy pods can be scheduled onto it exactly like the gvisor ones.
#
# WARNING: unlike kind or the stage-1 script, this makes host-wide,
# persistent changes: disables swap, adds sysctl/kernel module config,
# and creates a real kubelet-managed cluster. It's all standard kubeadm
# territory and cleanly reversible with `kubeadm reset`, but it's not
# sandboxed the way kind or the standalone kata smoke test were.
#
# Run individual stages: ./kata-baremetal-cluster.sh <stage>
# Stages: host-prep | install-tools | init-cluster | cni | runtimeclass | verify | all (default)

set -euo pipefail

POD_CIDR="${POD_CIDR:-10.244.0.0/16}"   # matches flannel's default expectation
CONTAINERD_SOCK="unix:///run/containerd/containerd.sock"
REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)

STAGE="${1:-all}"

need_root() {
  if [ "$EUID" -ne 0 ]; then
    echo "This stage needs root. Re-run with sudo."
    exit 1
  fi
}

stage_host_prep() {
  need_root
  echo "==> Disabling swap (kubelet refuses to start with swap on)"
  swapoff -a
  # Comment out swap lines in fstab so this survives a reboot
  sed -i.bak '/\sswap\s/ s/^/#/' /etc/fstab
  echo "  ✓ swap disabled (persisted via /etc/fstab, backup at /etc/fstab.bak)"

  echo "==> Loading required kernel modules"
  cat > /etc/modules-load.d/k8s.conf << 'EOF'
overlay
br_netfilter
EOF
  modprobe overlay
  modprobe br_netfilter
  echo "  ✓ overlay + br_netfilter loaded and persisted"

  echo "==> Setting required sysctl values"
  cat > /etc/sysctl.d/k8s.conf << 'EOF'
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
  sysctl --system > /dev/null
  echo "  ✓ sysctl values applied"
}

stage_install_tools() {
  need_root
  echo "==> Installing kubeadm, kubelet, kubectl, crictl via pacman"
  # Note: the crictl CLI is packaged as 'crictl' in Arch's extra repo, not
  # 'cri-tools' (that name is legacy/points to a split-package details page,
  # not something pacman can install directly).
  pacman -Sy --needed --noconfirm kubeadm kubelet kubectl crictl
  echo "  ✓ installed: $(kubeadm version -o short 2>/dev/null || kubeadm version)"

  echo "==> Pointing crictl at containerd's CRI socket by default"
  cat > /etc/crictl.yaml << EOF
runtime-endpoint: ${CONTAINERD_SOCK}
image-endpoint: ${CONTAINERD_SOCK}
timeout: 10
EOF

  echo "==> Enabling kubelet (kubeadm init will actually start it)"
  systemctl enable kubelet
}

stage_init_cluster() {
  need_root
  echo "==> Running kubeadm init"
  echo "  This provisions a single-node control-plane cluster against containerd."
  kubeadm init \
    --pod-network-cidr="${POD_CIDR}" \
    --cri-socket="${CONTAINERD_SOCK}"

  echo "==> Writing kubeconfig for $REAL_USER"
  mkdir -p "${REAL_HOME}/.kube"
  if [ -f "${REAL_HOME}/.kube/config" ]; then
    # kind writes its contexts (kind-maya-dev, etc.) into this same default
    # file. A plain overwrite here would wipe those out of kubectl's view
    # entirely -- merge the new bare-metal context in instead.
    echo "  Existing kubeconfig found -- merging in this cluster's context (kind contexts preserved)"
    cp "${REAL_HOME}/.kube/config" "${REAL_HOME}/.kube/config.bak.$(date +%s)"
    KUBECONFIG="/etc/kubernetes/admin.conf:${REAL_HOME}/.kube/config" kubectl config view --flatten > /tmp/merged-kubeconfig
    mv /tmp/merged-kubeconfig "${REAL_HOME}/.kube/config"
  else
    cp -f /etc/kubernetes/admin.conf "${REAL_HOME}/.kube/config"
  fi
  chown "$(id -u "$REAL_USER")":"$(id -g "$REAL_USER")" "${REAL_HOME}/.kube/config"
  echo "  ✓ kubeconfig at ${REAL_HOME}/.kube/config (run 'kubectl config get-contexts' to see all clusters)"

  echo "==> Untainting control-plane node so pods can schedule on this single node"
  KUBECONFIG="${REAL_HOME}/.kube/config" kubectl taint nodes --all node-role.kubernetes.io/control-plane- || true
  echo "  ✓ done"

  echo
  echo "  NOTE: if you ever need to tear this down: 'sudo kubeadm reset' then re-run this script."
}

stage_cni() {
  echo "==> Installing flannel CNI (matches pod-network-cidr=${POD_CIDR})"
  KUBECONFIG="${REAL_HOME}/.kube/config" kubectl apply -f \
    https://github.com/flannel-io/flannel/releases/latest/download/kube-flannel.yml

  echo "==> Waiting for node to go Ready (up to 90s)"
  KUBECONFIG="${REAL_HOME}/.kube/config" kubectl wait --for=condition=Ready node --all --timeout=90s
  echo "  ✓ node Ready"
}

stage_runtimeclass() {
  echo "==> Applying kata-containers RuntimeClass"
  echo "  handler: kata  -- matches the runtime name registered in containerd during stage 1"
  KUBECONFIG="${REAL_HOME}/.kube/config" kubectl apply -f - << 'EOF'
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: kata-containers
handler: kata
EOF
  echo "  ✓ RuntimeClass applied"
}

stage_verify() {
  echo "==> Deploying a test pod under runtimeClassName: kata-containers"
  KUBECONFIG="${REAL_HOME}/.kube/config" kubectl delete pod kata-verify --ignore-not-found >/dev/null
  KUBECONFIG="${REAL_HOME}/.kube/config" kubectl apply -f - << 'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: kata-verify
spec:
  runtimeClassName: kata-containers
  containers:
  - name: busybox
    image: busybox:latest
    command: ["sleep", "3600"]
EOF

  echo "==> Waiting for pod to be Running (up to 60s -- Kata VMs boot slower than runc)"
  KUBECONFIG="${REAL_HOME}/.kube/config" kubectl wait --for=condition=Ready pod/kata-verify --timeout=60s

  echo "==> Comparing guest kernel to host kernel"
  echo "  Host kernel:  $(uname -r)"
  GUEST_KERNEL=$(KUBECONFIG="${REAL_HOME}/.kube/config" kubectl exec kata-verify -- uname -r)
  echo "  Guest kernel: $GUEST_KERNEL"

  if [ "$GUEST_KERNEL" != "$(uname -r)" ]; then
    echo "  ✓ guest kernel differs from host -- pod is really running inside a Kata VM"
  else
    echo "  ✗ guest kernel matches host -- check runtimeClassName / containerd runtime registration"
    exit 1
  fi

  echo "==> Cross-checking against containerd directly (authoritative, same as the gVisor check)"
  CONTAINER_ID=$(crictl ps -a | grep kata-verify | awk '{print $1}' | head -1)
  if [ -n "$CONTAINER_ID" ]; then
    echo "  Run manually to confirm: crictl inspect $CONTAINER_ID | grep -i runtime"
    crictl inspect "$CONTAINER_ID" | grep -i runtime || true
  fi

  echo
  echo "==> Cleaning up test pod"
  KUBECONFIG="${REAL_HOME}/.kube/config" kubectl delete pod kata-verify --ignore-not-found >/dev/null
  echo "  ✓ verification complete"
}

case "$STAGE" in
  host-prep)      stage_host_prep ;;
  install-tools)  stage_install_tools ;;
  init-cluster)   stage_init_cluster ;;
  cni)            stage_cni ;;
  runtimeclass)   stage_runtimeclass ;;
  verify)         stage_verify ;;
  all)
    stage_host_prep
    stage_install_tools
    stage_init_cluster
    stage_cni
    stage_runtimeclass
    stage_verify
    echo
    echo "Bare-metal kubeadm cluster is up, Kata RuntimeClass verified end to end."
    echo "Next: point your decoy manifests (jump/web/redis) at this cluster instead of kind,"
    echo "add runtimeClassName: kata-containers, and migrate over -- same pattern as the gVisor rollout."
    ;;
  *)
    echo "Unknown stage: $STAGE"
    echo "Usage: $0 [host-prep|install-tools|init-cluster|cni|runtimeclass|verify|all]"
    exit 1
    ;;
esac