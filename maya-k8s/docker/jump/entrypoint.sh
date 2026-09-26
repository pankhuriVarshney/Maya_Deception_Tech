#!/bin/bash
set -e

# Password comes from the mounted Secret (env vars injected by the pod spec),
# not hardcoded -- see k8s/config/breadcrumb-credentials.yaml
if [ -n "$DECOY_PASSWORD" ]; then
  echo "admin:${DECOY_PASSWORD}" | chpasswd
fi

STATE_DIR="/var/lib/.state"
mkdir -p "$STATE_DIR"

# Lets decoy-audit-wrapper.sh / maya-audit-bashrc know their own decoy name
# without depending on sshd forwarding K8s env vars into login sessions
# (it doesn't, by default) -- entrypoint.sh is PID 1's own script, so it
# sees $MAYA_DECOY_NAME directly and just writes it to a plain file instead.
mkdir -p /usr/local/etc
printf 'DECOY_NAME=%s\n' "${MAYA_DECOY_NAME:-unknown}" > /usr/local/etc/maya-decoy.conf

# ForceCommand fires for EVERY session (interactive or a single scripted
# `ssh host "cmd"`), unlike a profile.d hook -- see
# maya-k8s/docker/common/decoy-audit-wrapper.sh for why that distinction
# matters. Appended at runtime (not baked into the image) so re-running
# this idempotently on container restart never double-appends.
if ! grep -q '^Match User admin$' /etc/ssh/sshd_config 2>/dev/null; then
  {
    echo ""
    echo "Match User admin"
    echo "    ForceCommand /usr/local/bin/decoy-audit-wrapper.sh"
  } >> /etc/ssh/sshd_config
fi

# sshd's own Accepted/Failed-password log lines (the -e flag already sent
# them to stderr for `kubectl logs`) also get a copy on the shared volume,
# so process_sshd_log() in scripts/crdt/src/main.rs can pick up login
# attempts even where the attacker never got a shell at all.
exec /usr/sbin/sshd -D -e 2> >(tee -a "$STATE_DIR/.sshd_auth.log" >&2)
