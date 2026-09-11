#!/usr/bin/env bash
#
# kata-migrate-decoys.sh -- Stage 3: fix the kubeconfig collision from
# kubeadm init, then deploy fresh copies of the decoys onto the bare-metal
# cluster under Kata, leaving the kind/gVisor decoys running untouched.
#
# Background: kata-baremetal-cluster.sh's init-cluster stage copied
# /etc/kubernetes/admin.conf directly over ~/.kube/config. kind also writes
# its own context into that same file, so this almost certainly overwrote
# (not merged) the kind-maya-dev context. The kind cluster itself is fine --
# only the local credentials file needs fixing.
#
# After this script: two named contexts, switchable with
# `kubectl config use-context <name>` or explicit `--context` flags.
#   - kind-maya-dev     -> the original kind cluster (gVisor decoys)
#   - kata-baremetal     -> this bare-metal kubeadm cluster (Kata decoys)
#
# Run individual stages: ./kata-migrate-decoys.sh <stage>
# Stages: fix-kubeconfig | import-images | deploy | verify | all (default)
#
# Requires: JUMP_DIR / WEB_DIR / REDIS_DIR env vars pointing at your existing
# manifest directories (defaults assume the layout used in earlier epics).
# Requires: IMAGES env var, a space-separated list of local docker image
# tags to make available to the bare-metal containerd (defaults below).

set -euo pipefail

KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME:-maya-dev}"
BAREMETAL_CONTEXT_NAME="${BAREMETAL_CONTEXT_NAME:-kata-baremetal}"
NAMESPACE="${NAMESPACE:-maya-decoys}"

JUMP_DIR="${JUMP_DIR:-k8s/decoy/jump}"
WEB_DIR="${WEB_DIR:-k8s/decoy/web}"
REDIS_DIR="${REDIS_DIR:-k8s/decoy/redis}"

IMAGES="${IMAGES:-maya-web:dev maya-redis:dev maya-jump:dev}"

STAGE="${1:-all}"

stage_fix_kubeconfig() {
  echo "==> Current contexts in ~/.kube/config"
  kubectl config get-contexts || true

  echo
  echo "==> Re-merging the kind cluster's context back in (non-destructive -- kind only touches its own entry)"
  if command -v kind >/dev/null && kind get clusters | grep -q "^${KIND_CLUSTER_NAME}\$"; then
    kind export kubeconfig --name "$KIND_CLUSTER_NAME"
    echo "  ✓ kind-${KIND_CLUSTER_NAME} context restored"
  else
    echo "  ! kind cluster '${KIND_CLUSTER_NAME}' not found by 'kind get clusters' -- skipping restore"
    echo "    (if this is unexpected, run: kind get clusters   -- to see actual names)"
  fi

  echo
  echo "==> Renaming the bare-metal context for clarity"
  CURRENT_BM_CONTEXT=$(kubectl config get-contexts -o name | grep -i 'kubernetes-admin@kubernetes' || true)
  if [ -n "$CURRENT_BM_CONTEXT" ] && [ "$CURRENT_BM_CONTEXT" != "$BAREMETAL_CONTEXT_NAME" ]; then
    kubectl config rename-context "$CURRENT_BM_CONTEXT" "$BAREMETAL_CONTEXT_NAME"
    echo "  ✓ renamed '$CURRENT_BM_CONTEXT' -> '$BAREMETAL_CONTEXT_NAME'"
  else
    echo "  context already named '${BAREMETAL_CONTEXT_NAME}' or not found under the expected default name -- check manually with:"
    echo "    kubectl config get-contexts"
  fi

  echo
  echo "==> Final context list"
  kubectl config get-contexts
  echo
  echo "  Switch anytime with: kubectl config use-context <name>"
  echo "  Or pass --context explicitly per command (what the rest of this script does, to avoid ambiguity)."
}

stage_import_images() {
  echo "==> Exporting local docker images and importing into bare-metal containerd (namespace k8s.io)"
  for img in $IMAGES; do
    SAFE_NAME=$(echo "$img" | tr ':/' '__')
    TAR_PATH="/tmp/${SAFE_NAME}.tar"
    echo "  -- $img"
    if ! docker image inspect "$img" >/dev/null 2>&1; then
      echo "     ✗ not found in local docker images -- skipping (build it first if this is unexpected)"
      continue
    fi
    docker save "$img" -o "$TAR_PATH"
    sudo ctr -n k8s.io images import "$TAR_PATH"
    rm -f "$TAR_PATH"
    echo "     ✓ imported"
  done

  echo
  echo "==> Verifying images are visible to containerd's k8s.io namespace"
  sudo crictl images | grep -E "$(echo "$IMAGES" | tr ' ' '|' | sed 's/:[^|]*//g')" || \
    echo "  ! none matched in crictl images -- check tags/import above"
}

stage_deploy() {
  echo "==> Ensuring namespace '$NAMESPACE' exists on $BAREMETAL_CONTEXT_NAME"
  kubectl --context "$BAREMETAL_CONTEXT_NAME" create namespace "$NAMESPACE" --dry-run=client -o yaml | \
    kubectl --context "$BAREMETAL_CONTEXT_NAME" apply -f -

  for entry in "jump-01:$JUMP_DIR" "web-03:$WEB_DIR" "redis-01:$REDIS_DIR"; do
    NAME="${entry%%:*}"
    DIR="${entry#*:}"
    echo
    echo "==> Deploying $NAME from $DIR onto $BAREMETAL_CONTEXT_NAME"
    if [ ! -d "$DIR" ]; then
      echo "  ✗ directory not found: $DIR -- set the right path via env var and re-run this stage"
      continue
    fi
    kubectl --context "$BAREMETAL_CONTEXT_NAME" apply -f "$DIR"

    echo "  Patching in runtimeClassName: kata-containers"
    kubectl --context "$BAREMETAL_CONTEXT_NAME" patch deployment "$NAME" -n "$NAMESPACE" --type merge -p \
      '{"spec":{"template":{"spec":{"runtimeClassName":"kata-containers"}}}}'

    echo "  Restarting rollout to pick up the runtime change"
    kubectl --context "$BAREMETAL_CONTEXT_NAME" rollout restart deployment/"$NAME" -n "$NAMESPACE"
    kubectl --context "$BAREMETAL_CONTEXT_NAME" rollout status deployment/"$NAME" -n "$NAMESPACE" --timeout=120s
  done
}

stage_verify() {
  echo "==> Pods on $BAREMETAL_CONTEXT_NAME in namespace $NAMESPACE"
  kubectl --context "$BAREMETAL_CONTEXT_NAME" get pods -n "$NAMESPACE" -o wide

  for NAME in jump-01 web-03 redis-01; do
    echo
    echo "==> Verifying $NAME is genuinely under Kata"
    POD=$(kubectl --context "$BAREMETAL_CONTEXT_NAME" get pods -n "$NAMESPACE" \
      -l app="$NAME" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
    if [ -z "$POD" ]; then
      # fall back to name-prefix match if there's no 'app' label
      POD=$(kubectl --context "$BAREMETAL_CONTEXT_NAME" get pods -n "$NAMESPACE" \
        -o name | grep "$NAME" | head -1 | cut -d/ -f2)
    fi
    if [ -z "$POD" ]; then
      echo "  ✗ could not find a pod for $NAME -- check labels/selectors"
      continue
    fi

    RUNTIME_CLASS=$(kubectl --context "$BAREMETAL_CONTEXT_NAME" get pod "$POD" -n "$NAMESPACE" \
      -o jsonpath='{.spec.runtimeClassName}')
    echo "  pod: $POD  runtimeClassName: $RUNTIME_CLASS"

    CONTAINER_ID=$(sudo crictl ps -a | grep "$POD" | awk '{print $1}' | head -1)
    if [ -n "$CONTAINER_ID" ]; then
      echo "  containerd runtime (authoritative):"
      sudo crictl inspect "$CONTAINER_ID" | grep -i runtimeType
    fi
  done
}

case "$STAGE" in
  fix-kubeconfig)  stage_fix_kubeconfig ;;
  import-images)   stage_import_images ;;
  deploy)          stage_deploy ;;
  verify)          stage_verify ;;
  all)
    stage_fix_kubeconfig
    stage_import_images
    stage_deploy
    stage_verify
    echo
    echo "Decoys deployed on bare-metal cluster under Kata. kind/gVisor decoys untouched."
    echo "Switch contexts anytime with: kubectl config use-context kind-${KIND_CLUSTER_NAME}  (or ${BAREMETAL_CONTEXT_NAME})"
    ;;
  *)
    echo "Unknown stage: $STAGE"
    echo "Usage: $0 [fix-kubeconfig|import-images|deploy|verify|all]"
    exit 1
    ;;
esac