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
    if ! docker port "${CLUSTER_NAME}-control-plane" 2>/dev/null | grep -q "^80/tcp"; then
      echo "  (note: this cluster was created without the host port mappings this script"
      echo "   now sets up (80/443 for ingress, 30022/30222/30637/30122/30021 for the"
      echo "   jump/redis/ftp NodePorts), so those won't be reachable from your host."
      echo "   Re-create it with: 'kind delete cluster --name $CLUSTER_NAME && ./scripts/1_Epic.sh' to pick them up.)"
    fi
  else
    # Maps host 80/443 to the node so the nginx Ingress installed below is
    # actually reachable from outside the cluster -- this is what plays
    # gateway-vm's "default front door" role for K8s decoys (Epic 5 Task 3).
    kind create cluster --name "$CLUSTER_NAME" --config - << 'EOF'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    extraPortMappings:
      - containerPort: 80
        hostPort: 80
        protocol: TCP
      - containerPort: 443
        hostPort: 443
        protocol: TCP
      # Fixed NodePorts for the non-HTTP decoys (jump/redis/ftp -- see
      # their Service definitions under k8s/decoy/*/service.yaml).
      - containerPort: 30022
        hostPort: 30022
        protocol: TCP
      - containerPort: 30222
        hostPort: 30222
        protocol: TCP
      - containerPort: 30637
        hostPort: 30637
        protocol: TCP
      - containerPort: 30122
        hostPort: 30122
        protocol: TCP
      - containerPort: 30021
        hostPort: 30021
        protocol: TCP
EOF
    ok "cluster created (with host ports mapped for ingress + decoy NodePorts)"
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

  step "Installing the nginx Ingress controller (K8s decoys' default front door)"
  # This is what plays gateway-vm's "everything lands here by default" role
  # for the K8s fabric -- previously nothing did, decoys were only reachable
  # via kubectl port-forward.
  if kubectl get deployment ingress-nginx-controller -n ingress-nginx >/dev/null 2>&1; then
    ok "ingress-nginx already installed, skipping"
  else
    kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
    kubectl wait --namespace ingress-nginx \
      --for=condition=ready pod \
      --selector=app.kubernetes.io/component=controller \
      --timeout=120s
    ok "ingress-nginx installed and ready"
  fi

  step "Applying namespaces and network policy"
  kubectl apply -f maya-k8s/k8s/namespaces.yaml
  ok "namespaces applied"

  step "Building and deploying the decoy lifecycle-manager"
  docker build -t maya-lifecycle-manager:dev maya-k8s/lifecycle-manager
  kind load docker-image maya-lifecycle-manager:dev --name "$CLUSTER_NAME"
  kubectl apply -f maya-k8s/k8s/config/lifecycle-manager-deployment.yaml
  kubectl rollout status deployment/decoy-lifecycle-manager -n maya-control --timeout=60s
  ok "lifecycle-manager running in maya-control"

  step "Applying shared decoy config"
  kubectl apply -f maya-k8s/k8s/config/breadcrumb-credentials.yaml
  kubectl apply -f maya-k8s/k8s/config/syslogd-helper-configmap.yaml
  ok "base config applied"

  step "Building decoy images"
  # Build context is the repo root, not maya-k8s/docker/<type>/ -- the
  # crdt-sync image compiles the real CRDT engine from scripts/crdt/, which
  # only the root context can reach. The decoy images themselves no longer
  # contain the CRDT engine at all (it runs in crdt-sync as a sidecar in
  # each decoy Pod, see k8s/decoy/*/deployment.yaml) -- kept in the same
  # build context for consistency.
  docker build -t maya-web:dev -f maya-k8s/docker/web/Dockerfile .
  docker build -t maya-redis:dev -f maya-k8s/docker/redis/Dockerfile .
  docker build -t maya-jump:dev -f maya-k8s/docker/jump/Dockerfile .
  docker build -t maya-ftp:dev -f maya-k8s/docker/ftp/Dockerfile .
  docker build -t maya-crdt-sync:dev -f maya-k8s/docker/crdt-sync/Dockerfile .
  ok "images built"

  step "Loading images into kind"
  kind load docker-image maya-web:dev --name "$CLUSTER_NAME"
  kind load docker-image maya-redis:dev --name "$CLUSTER_NAME"
  kind load docker-image maya-jump:dev --name "$CLUSTER_NAME"
  kind load docker-image maya-ftp:dev --name "$CLUSTER_NAME"
  kind load docker-image maya-crdt-sync:dev --name "$CLUSTER_NAME"
  ok "images loaded into cluster"

  step "Applying decoy manifests"
  kubectl apply -f maya-k8s/k8s/decoy/web/
  kubectl apply -f maya-k8s/k8s/decoy/redis/
  kubectl apply -f maya-k8s/k8s/decoy/jump/
  kubectl apply -f maya-k8s/k8s/decoy/ftp/
  ok "manifests applied"

  step "Rolling out deployments"
  kubectl rollout restart deployment/web-03 deployment/redis-01 deployment/jump-01 deployment/ftp-01 -n "$NAMESPACE"

  step "Waiting for pods to become ready (up to 90s each)"
  kubectl rollout status deployment/web-03 -n "$NAMESPACE" --timeout=90s
  kubectl rollout status deployment/redis-01 -n "$NAMESPACE" --timeout=90s
  kubectl rollout status deployment/jump-01 -n "$NAMESPACE" --timeout=90s
  kubectl rollout status deployment/ftp-01 -n "$NAMESPACE" --timeout=90s
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
  for dep in web-03 redis-01 jump-01 ftp-01; do
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

  step "lifecycle-manager checks"
  # Runs under the default runtime (no runtimeClassName set), so unlike the
  # gVisor decoy pods, port-forward works normally here.
  kubectl port-forward -n maya-control deploy/decoy-lifecycle-manager 18081:8081 > /tmp/lcm_pf.log 2>&1 &
  lcm_pf_pid=$!
  sleep 2
  if curl -fsS --max-time 5 http://localhost:18081/status 2>/tmp/lcm_status.log | grep -q '"decoys"'; then
    ok "lifecycle-manager /status responded"
  else
    bad "lifecycle-manager /status did not respond as expected"
    sed 's/^/      /' /tmp/lcm_status.log 2>/dev/null
  fi
  kill "$lcm_pf_pid" 2>/dev/null || true
  wait "$lcm_pf_pid" 2>/dev/null || true

  step "web-03 checks"
  check "nginx directories present"      kubectl exec -n "$NAMESPACE" deploy/web-03 -- test -d /var/lib/nginx/body
  check "nginx config valid"             kubectl exec -n "$NAMESPACE" deploy/web-03 -- nginx -t
  check "supervisord socket reachable"   kubectl exec -n "$NAMESPACE" deploy/web-03 -- supervisorctl status
  # syslogd-helper now lives in the crdt-sync sidecar, not the web
  # container -- see k8s/decoy/web/deployment.yaml.
  check "syslogd-helper responds"        kubectl exec -n "$NAMESPACE" deploy/web-03 -c crdt-sync -- syslogd-helper stats
  check "syslogd-helper absent from web container" \
    sh -c "! kubectl exec -n $NAMESPACE deploy/web-03 -c web -- sh -c 'command -v syslogd-helper' >/dev/null 2>&1"

  step "redis-01 checks"
  check "supervisord socket reachable"   kubectl exec -n "$NAMESPACE" deploy/redis-01 -- supervisorctl status
  check "syslogd-helper responds"        kubectl exec -n "$NAMESPACE" deploy/redis-01 -c crdt-sync -- syslogd-helper stats
  check "redis responds to PING"         kubectl exec -n "$NAMESPACE" deploy/redis-01 -- redis-cli ping

  step "jump-01 checks"
  check "syslogd-helper responds"        kubectl exec -n "$NAMESPACE" deploy/jump-01 -c crdt-sync -- syslogd-helper stats
  # /proc/net/tcp is portable across busybox/alpine and glibc images with
  # no extra packages needed. Port 22 in hex (local_address column) is
  # 0016; state 0A means LISTEN.
  check "sshd listening on 22"           kubectl exec -n "$NAMESPACE" deploy/jump-01 -- sh -c "grep -q ':0016 .*:0000 0A' /proc/net/tcp"

  step "ftp-01 checks"
  check "supervisord socket reachable"   kubectl exec -n "$NAMESPACE" deploy/ftp-01 -- supervisorctl status
  check "syslogd-helper responds"        kubectl exec -n "$NAMESPACE" deploy/ftp-01 -c crdt-sync -- syslogd-helper stats
  # Port 21 in hex is 0015.
  check "vsftpd listening on 21"         kubectl exec -n "$NAMESPACE" deploy/ftp-01 -- sh -c "grep -q ':0015 .*:0000 0A' /proc/net/tcp"

  step "Traffic entry: NodePorts reachable from the host"
  # Unlike port-forward, this is real network traffic through the normal
  # Service/CNI path, which gVisor's netstack handles correctly -- the
  # port-forward gVisor caveat above doesn't apply here.
  check "jump-01 SSH NodePort open (30022)"  bash -c 'exec 3<>/dev/tcp/127.0.0.1/30022'
  check "redis-01 NodePort open (30637)"     bash -c 'exec 3<>/dev/tcp/127.0.0.1/30637'
  check "ftp-01 FTP NodePort open (30021)"   bash -c 'exec 3<>/dev/tcp/127.0.0.1/30021'

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

  step "Traffic entry: Ingress front door reachable from the host"
  # The ingress-nginx controller pod itself runs under the default runtime
  # (not gvisor), and its connection onward to web-03 is real Service/CNI
  # traffic -- so unlike kubectl port-forward, this path actually works.
  if command -v curl >/dev/null 2>&1; then
    if curl -fsS --max-time 5 -o /dev/null -w '%{http_code}' http://localhost/ 2>/tmp/ingress_check.log | grep -q "200"; then
      ok "Ingress served HTTP 200 at http://localhost/"
    else
      bad "Ingress did not respond with HTTP 200 at http://localhost/"
      sed 's/^/      /' /tmp/ingress_check.log
    fi
  else
    echo -e "  ${YELLOW}!${NC} curl not found, skipping host-level Ingress check"
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