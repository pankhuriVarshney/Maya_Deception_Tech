#!/usr/bin/env bash
#
# setup-and-verify.sh -- Epic 1: bring up the Maya decoy stack on a local
# kind cluster and verify all three decoy types are healthy.
#
# Usage:
#   ./setup-and-verify.sh          # full setup + verify
#   ./setup-and-verify.sh verify   # skip setup, just run the checks
#
# Run from the repo root (Maya_Deception_Tech/maya-k8s).

set -euo pipefail

CLUSTER_NAME="maya-dev"
NAMESPACE="maya-decoys"
MODE="${1:-full}"

# ---- output helpers --------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
PASS=0
FAIL=0

step() { echo -e "\n${YELLOW}==>${NC} $1"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
bad()  { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL+1)); }

check() {
  # check "description" -- command...
  local desc="$1"; shift
  if "$@" > /tmp/check_out.log 2>&1; then
    ok "$desc"
  else
    bad "$desc"
    sed 's/^/      /' /tmp/check_out.log
  fi
}

require_bin() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required tool: $1"; exit 1; }
}

# ---- setup -------------------------------------------------------------
run_setup() {
  step "Checking required tools"
  for bin in docker kind kubectl; do
    require_bin "$bin"
    ok "$bin found"
  done

  step "Ensuring kind cluster '$CLUSTER_NAME' exists"
  if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
    ok "cluster already exists"
  else
    kind create cluster --name "$CLUSTER_NAME"
    ok "cluster created"
  fi

  step "Installing gVisor on kind nodes and registering the RuntimeClass"
  # Every decoy Deployment requests runtimeClassName: gvisor. Without this,
  # pod creation is rejected at admission (no such RuntimeClass exists yet
  # on a fresh cluster) and `kubectl rollout status` just times out with
  # "0 out of 1 new replicas updated" -- looks like a hang, is actually a
  # missing prerequisite.
  if kubectl get runtimeclass gvisor >/dev/null 2>&1; then
    ok "gvisor RuntimeClass already present, skipping install"
  else
    bash maya-k8s/install-gvisor-kind.sh "$CLUSTER_NAME"
    kubectl apply -f maya-k8s/k8s/runtimeclass.yaml
    ok "gVisor installed on all nodes and RuntimeClass applied"
  fi

  step "Applying namespaces, network policy, and shared config"
  kubectl apply -f maya-k8s/k8s/namespaces.yaml
  kubectl apply -f maya-k8s/k8s/config/breadcrumb-credentials.yaml
  kubectl apply -f maya-k8s/k8s/config/syslogd-helper-configmap.yaml
  ok "base config applied"

  step "Building decoy images"
  # Build context is the repo root, not maya-k8s/docker/<type>/ -- each
  # Dockerfile now has a stage that compiles the real CRDT engine from
  # scripts/crdt/, which only the root context can reach.
  docker build -t maya-web:dev -f maya-k8s/docker/web/Dockerfile .
  docker build -t maya-redis:dev -f maya-k8s/docker/redis/Dockerfile .
  docker build -t maya-jump:dev -f maya-k8s/docker/jump/Dockerfile .
  ok "images built"

  step "Loading images into kind"
  kind load docker-image maya-web:dev --name "$CLUSTER_NAME"
  kind load docker-image maya-redis:dev --name "$CLUSTER_NAME"
  kind load docker-image maya-jump:dev --name "$CLUSTER_NAME"
  ok "images loaded into cluster"

  step "Applying decoy manifests"
  kubectl apply -f maya-k8s/k8s/decoy/web/
  kubectl apply -f maya-k8s/k8s/decoy/redis/
  kubectl apply -f maya-k8s/k8s/decoy/jump/
  ok "manifests applied"

  step "Rolling out deployments"
  kubectl rollout restart deployment/web-03 deployment/redis-01 deployment/jump-01 -n "$NAMESPACE"

  step "Waiting for pods to become ready (up to 90s each)"
  kubectl rollout status deployment/web-03 -n "$NAMESPACE" --timeout=90s
  kubectl rollout status deployment/redis-01 -n "$NAMESPACE" --timeout=90s
  kubectl rollout status deployment/jump-01 -n "$NAMESPACE" --timeout=90s
  ok "all deployments rolled out"

  step "Cleaning up completed/terminated pods from prior rollouts"
  kubectl delete pods -n "$NAMESPACE" --field-selector=status.phase=Succeeded --ignore-not-found=true

  # The above only catches phase=Succeeded pods. A pod mid-termination from
  # `rollout restart` is still phase=Running (it just has a deletionTimestamp
  # set) until its terminationGracePeriodSeconds elapses, so it's invisible
  # to that filter and lingers past "rollout status" success -- which only
  # confirms the *new* pods are ready, not that the *old* ones are gone.
  # Wait here so later per-pod checks and the HTTP check can't race a
  # still-terminating old pod.
  for dep in web-03 redis-01 jump-01; do
    want=$(kubectl get deployment "$dep" -n "$NAMESPACE" -o jsonpath='{.spec.replicas}')
    for _ in $(seq 1 30); do
      have=$(kubectl get pods -n "$NAMESPACE" -l "app=$dep" --field-selector=status.phase=Running --no-headers 2>/dev/null | wc -l | tr -d ' ')
      [ "$have" -eq "$want" ] && break
      sleep 1
    done
  done
  ok "stale pods swept"
}

# ---- verification --------------------------------------------------------
run_verify() {
  step "Pod status"
  kubectl get pods -n "$NAMESPACE"

  step "web-03 checks"
  check "nginx directories present"      kubectl exec -n "$NAMESPACE" deploy/web-03 -- test -d /var/lib/nginx/body
  check "nginx config valid"             kubectl exec -n "$NAMESPACE" deploy/web-03 -- nginx -t
  check "supervisord socket reachable"   kubectl exec -n "$NAMESPACE" deploy/web-03 -- supervisorctl status
  check "syslogd-helper responds"        kubectl exec -n "$NAMESPACE" deploy/web-03 -- syslogd-helper stats

  step "redis-01 checks"
  check "supervisord socket reachable"   kubectl exec -n "$NAMESPACE" deploy/redis-01 -- supervisorctl status
  check "syslogd-helper responds"        kubectl exec -n "$NAMESPACE" deploy/redis-01 -- syslogd-helper stats
  check "redis responds to PING"         kubectl exec -n "$NAMESPACE" deploy/redis-01 -- redis-cli ping

  step "jump-01 checks"
  check "syslogd-helper responds"        kubectl exec -n "$NAMESPACE" deploy/jump-01 -- syslogd-helper stats
  # /proc/net/tcp is portable across busybox/alpine and glibc images with
  # no extra packages needed. Port 22 in hex (local_address column) is
  # 0016; state 0A means LISTEN.
  check "sshd listening on 22"           kubectl exec -n "$NAMESPACE" deploy/jump-01 -- sh -c "grep -q ':0016 .*:0000 0A' /proc/net/tcp"

  step "No unexpected extra mount on web-03 (fingerprint check)"
  if kubectl exec -n "$NAMESPACE" deploy/web-03 -- mount 2>/dev/null | grep -qi "maya-state\|syscache"; then
    bad "found a named deception-related mount -- fingerprintable"
  else
    ok "no named deception mount visible"
  fi

  step "HTTP check (in-sandbox, via /dev/tcp)"
  # kubectl port-forward can't be used here: gVisor runs its own userspace
  # netstack, so a process's sockets (nginx included) live inside the
  # Sentry, not in the host kernel's view of the pod's network namespace.
  # port-forward's nsenter-based loopback connect never sees them --
  # "connection refused" even when nginx is completely healthy. Talking to
  # it through the sandbox's own shell via runsc exec sidesteps that
  # entirely and is a legitimate reachability check either way.
  if kubectl exec -n "$NAMESPACE" deploy/web-03 -- bash -c \
      'exec 3<>/dev/tcp/127.0.0.1/80 && printf "GET / HTTP/1.0\r\n\r\n" >&3 && head -1 <&3' \
      2>/tmp/http_check.log | grep -q "200"; then
    ok "web-03 served HTTP 200"
  else
    bad "web-03 did not respond with HTTP 200"
    sed 's/^/      /' /tmp/http_check.log
  fi

  # ---- summary --------------------------------------------------------
  echo
  echo "-------------------------------------------"
  if [ "$FAIL" -eq 0 ]; then
    echo -e "${GREEN}All checks passed (${PASS}/${PASS})${NC}"
  else
    echo -e "${RED}${FAIL} check(s) failed${NC}, ${GREEN}${PASS} passed${NC}"
    exit 1
  fi
}

# ---- entrypoint -----------------------------------------------------------
if [ "$MODE" = "verify" ]; then
  run_verify
else
  run_setup
  run_verify
fi