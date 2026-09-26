#!/bin/bash
set -e

if [ -n "$DECOY_PASSWORD" ]; then
  echo "admin:${DECOY_PASSWORD}" | chpasswd
fi

ssh-keygen -A

mkdir -p /var/lib/.state /usr/local/etc
printf 'DECOY_NAME=%s\n' "${MAYA_DECOY_NAME:-unknown}" > /usr/local/etc/maya-decoy.conf

# ForceCommand fires for EVERY session (interactive or a single scripted
# `ssh host "cmd"`), unlike a profile.d hook -- see
# maya-k8s/docker/common/decoy-audit-wrapper.sh for why that distinction
# matters. Appended at runtime so re-running this idempotently on
# container restart never double-appends.
if ! grep -q '^Match User admin$' /etc/ssh/sshd_config 2>/dev/null; then
  {
    echo ""
    echo "Match User admin"
    echo "    ForceCommand /usr/local/bin/decoy-audit-wrapper.sh"
  } >> /etc/ssh/sshd_config
fi

# Some breadcrumb bait for anyone who gets in over FTP.
mkdir -p /srv/ftp
[ -f /srv/ftp/README.txt ] || cat > /srv/ftp/README.txt << 'EOF'
Internal file transfer node. Contact IT if you need write access outside
your home directory.
EOF

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/ftp.conf
