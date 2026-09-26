# Sourced explicitly via `bash --rcfile /etc/maya-audit-bashrc -i` from
# decoy-audit-wrapper.sh for interactive sessions only -- NOT relying on
# /etc/profile.d, since that's not guaranteed to exist/loop the same way
# on Alpine (jump) vs Debian (ftp/redis/web).
#
# Mirrors the ForceCommand wrapper's per-command logging for a genuinely
# interactive attacker session (someone who types commands one at a time
# after logging in), which a single ForceCommand invocation can't see.
[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"

MAYA_AUDIT_LOG="/var/lib/.state/.audit.jsonl"

_maya_log_command() {
  local last_cmd
  last_cmd="$(HISTTIMEFORMAT= history 1 2>/dev/null | sed -e 's/^[ ]*[0-9]*[ ]*//')"
  [ -n "$last_cmd" ] || return 0
  printf '{"kind":"action","attacker_ip":"%s","decoy":"%s","action":"%s","ts":"%s"}\n' \
    "${MAYA_ATTACKER_IP:-unknown}" "${DECOY_NAME:-unknown}" \
    "$(printf '%s' "$last_cmd" | sed 's/\\/\\\\/g; s/"/\\"/g')" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)" \
    >> "$MAYA_AUDIT_LOG" 2>/dev/null
}

case ";${PROMPT_COMMAND:-};" in
  *";_maya_log_command;"*) ;;
  *) PROMPT_COMMAND="_maya_log_command${PROMPT_COMMAND:+; $PROMPT_COMMAND}" ;;
esac
