#!/bin/bash
set -e

if [ -n "$DECOY_PASSWORD" ]; then
  echo "admin:${DECOY_PASSWORD}" | chpasswd
fi

ssh-keygen -A

mkdir -p /var/lib/misc
[ -f /var/lib/misc/.state ] || echo '{"attackers":{},"stolen_creds":{},"active_sessions":{}}' > /var/lib/misc/.state

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/web.conf
