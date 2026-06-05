#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

chmod +x "$SCRIPT_DIR/deploy.sh" "$SCRIPT_DIR/teardown.sh"

check_tool() {
  local tool="$1"
  local linux_install="$2"
  local mac_install="$3"

  if ! command -v "$tool" &>/dev/null; then
    echo "Error: '$tool' is not installed."
    echo "  Linux:   $linux_install"
    echo "  macOS:   $mac_install"
    exit 1
  fi
}

check_tool "docker" \
  "curl -fsSL https://get.docker.com | sh" \
  "brew install --cask docker"

check_tool "kind" \
  "[ $(uname -m) = x86_64 ] && curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.24.0/kind-linux-amd64 && chmod +x ./kind && sudo mv ./kind /usr/local/bin/kind" \
  "brew install kind"

check_tool "kubectl" \
  "curl -LO https://dl.k8s.io/release/\$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl && chmod +x kubectl && sudo mv kubectl /usr/local/bin/" \
  "brew install kubectl"

if kind get clusters 2>/dev/null | grep -qx 'maya-honeynet'; then
  echo "Cluster already exists, skipping creation"
else
  kind create cluster --config "$SCRIPT_DIR/kind-config.yaml"
fi

kubectl config use-context kind-maya-honeynet

kubectl apply -f "$SCRIPT_DIR/namespace.yaml"
sleep 2
kubectl apply -f "$SCRIPT_DIR/configmap.yaml"
kubectl apply -f "$SCRIPT_DIR/configmap-web.yaml"
kubectl apply -f "$SCRIPT_DIR/configmap-haproxy.yaml"
kubectl apply -f "$SCRIPT_DIR/network-policy.yaml"
kubectl apply -f "$SCRIPT_DIR/honeypots/"

kubectl wait --for=condition=Ready pods --all \
  -n maya-honeynet --timeout=180s

echo ""
echo "=== Maya Honeynet Summary ==="
kubectl get pods -n maya-honeynet
echo ""
kubectl get services -n maya-honeynet
echo ""
echo "Gateway (attacker entry): http://localhost:8080"
echo "HAProxy stats (breadcrumb): http://localhost:8081/stats"
echo "Backend API: http://localhost:3001"
echo "Dashboard: http://localhost:3000"
echo ""
echo "Maya honeynet is live. Run 'kubectl logs -n maya-honeynet deployment/fake-jump-01 -c crdt-sync' to watch CRDT heartbeats."
