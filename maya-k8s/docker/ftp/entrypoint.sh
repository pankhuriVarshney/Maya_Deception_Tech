#!/bin/bash
set -e

if [ -n "$DECOY_PASSWORD" ]; then
  echo "admin:${DECOY_PASSWORD}" | chpasswd
fi

ssh-keygen -A

# Some breadcrumb bait for anyone who gets in over FTP.
mkdir -p /srv/ftp
[ -f /srv/ftp/README.txt ] || cat > /srv/ftp/README.txt << 'EOF'
Internal file transfer node. Contact IT if you need write access outside
your home directory.
EOF

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/ftp.conf
