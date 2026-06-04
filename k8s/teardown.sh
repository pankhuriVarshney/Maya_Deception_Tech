#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

chmod +x "$SCRIPT_DIR/deploy.sh" "$SCRIPT_DIR/teardown.sh"

kubectl delete namespace maya-honeynet --ignore-not-found

read -r -p "Delete kind cluster too? (y/N): " reply
if [[ "${reply:-N}" =~ ^[Yy]$ ]]; then
  kind delete cluster --name maya-honeynet
fi

echo "Maya honeynet torn down."
