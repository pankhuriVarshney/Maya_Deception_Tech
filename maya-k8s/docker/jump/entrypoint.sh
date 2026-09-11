#!/bin/bash
set -e

# Password comes from the mounted Secret (env vars injected by the pod spec),
# not hardcoded -- see k8s/config/breadcrumb-credentials.yaml
if [ -n "$DECOY_PASSWORD" ]; then
  echo "admin:${DECOY_PASSWORD}" | chpasswd
fi

mkdir -p /var/lib/misc
[ -f /var/lib/misc/.state ] || echo '{"attackers":{},"stolen_creds":{},"active_sessions":{}}' > /var/lib/misc/.state

exec /usr/sbin/sshd -D -e
