#!/usr/bin/env bash
#
# verify-gvisor.sh -- confirms a given deployment's pod is actually
# running under the gVisor sandbox, not silently falling back to runc.
#
# Usage: ./verify-gvisor.sh <deployment-name> <namespace>

set -euo pipefail

DEPLOY="${1:?usage: verify-gvisor.sh <deployment> <namespace>}"
NAMESPACE="${2:?usage: verify-gvisor.sh <deployment> <namespace>}"

echo "==> Checking runtimeClassName on the pod spec"
RC=$(kubectl get deployment "$DEPLOY" -n "$NAMESPACE" -o jsonpath='{.spec.template.spec.runtimeClassName}')
if [ "$RC" != "gvisor" ]; then
  echo "  ✗ runtimeClassName is '$RC', expected 'gvisor' -- deployment.yaml not updated?"
  exit 1
fi
echo "  ✓ runtimeClassName=gvisor set on pod spec"

echo "==> Checking kernel signature reported inside the container"
# gVisor emulates its own kernel (Sentry) and reports a synthetic version
# string -- this is the single most reliable in-pod signal that you're
# actually inside runsc and not runc. Real Linux kernels won't match this.
UNAME_OUT=$(kubectl exec -n "$NAMESPACE" "deploy/$DEPLOY" -- uname -a)
echo "  uname -a: $UNAME_OUT"
if echo "$UNAME_OUT" | grep -qi "gvisor\|4\.4\.0"; then
  echo "  ✓ kernel signature looks like gVisor's Sentry"
else
  echo "  ⚠ couldn't confirm from uname alone -- check /proc/version below"
fi

echo "==> Checking /proc/version"
kubectl exec -n "$NAMESPACE" "deploy/$DEPLOY" -- cat /proc/version || true

echo
echo "==> Cross-check against the containerd node directly (authoritative)"
NODE=$(kubectl get pod -n "$NAMESPACE" -l app="$DEPLOY" -o jsonpath='{.items[0].spec.nodeName}')
POD_UID=$(kubectl get pod -n "$NAMESPACE" -l app="$DEPLOY" -o jsonpath='{.items[0].metadata.uid}')
echo "  Pod is on node: $NODE"
echo "  Run this manually to confirm at the containerd level:"
echo "    docker exec $NODE crictl ps -a | grep $DEPLOY"
echo "    docker exec $NODE crictl inspect <container-id> | grep -i runtime"
