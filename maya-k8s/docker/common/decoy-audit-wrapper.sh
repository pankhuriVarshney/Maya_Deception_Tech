#!/bin/sh
# ForceCommand target for every Maya K8s decoy's SSH login user (see the
# `Match User admin` block each decoy's entrypoint.sh appends to
# /etc/ssh/sshd_config). Unlike a profile.d hook, sshd enforces
# ForceCommand for EVERY session regardless of how the client connects --
# including a single non-interactive `ssh host "cmd"` invocation, which a
# profile.d/PROMPT_COMMAND hook never sees.
#
# Deliberately dumb: no CRDT logic, no syslogd-helper binary, just appends
# plain JSON lines to the shared state directory. The crdt-sync sidecar --
# which this container can't see into, separate rootfs/PID namespace, see
# maya-k8s/docker/crdt-sync/Dockerfile -- is what turns these into real
# CRDT state (scripts/crdt/src/main.rs's process_audit_log()).
set -eu

STATE_DIR="/var/lib/.state"
AUDIT_LOG="$STATE_DIR/.audit.jsonl"

DECOY="unknown"
[ -f /usr/local/etc/maya-decoy.conf ] && . /usr/local/etc/maya-decoy.conf
[ -n "${DECOY_NAME:-}" ] && DECOY="$DECOY_NAME"

ATTACKER_IP="${SSH_CLIENT%% *}"
[ -n "$ATTACKER_IP" ] || ATTACKER_IP="${SSH_CONNECTION%% *}"
[ -n "$ATTACKER_IP" ] || ATTACKER_IP="unknown"

_json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

SESSION_ID="$(date -u +%Y%m%dT%H%M%S 2>/dev/null || echo unknown)-$$"
printf '{"kind":"session","attacker_ip":"%s","decoy":"%s","session_id":"%s"}\n' \
  "$(_json_escape "$ATTACKER_IP")" "$(_json_escape "$DECOY")" "$(_json_escape "$SESSION_ID")" \
  >> "$AUDIT_LOG" 2>/dev/null || true

if [ -n "${SSH_ORIGINAL_COMMAND:-}" ]; then
  printf '{"kind":"action","attacker_ip":"%s","decoy":"%s","action":"%s"}\n' \
    "$(_json_escape "$ATTACKER_IP")" "$(_json_escape "$DECOY")" "$(_json_escape "$SSH_ORIGINAL_COMMAND")" \
    >> "$AUDIT_LOG" 2>/dev/null || true
  exec /bin/sh -c "$SSH_ORIGINAL_COMMAND"
fi

# No original command -- attacker wants an interactive shell. Force bash
# to read our own rcfile (not /etc/profile.d, which isn't guaranteed to
# exist the same way on Alpine vs Debian) so per-command logging keeps
# going for the rest of the session, then behave like a normal shell.
export MAYA_ATTACKER_IP="$ATTACKER_IP"
export DECOY_NAME="$DECOY"
exec /bin/bash --rcfile /etc/maya-audit-bashrc -i
