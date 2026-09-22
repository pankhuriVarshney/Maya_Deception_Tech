#!/usr/bin/env bash
#
# run-battery.sh -- Epic 4 Task 1+2: a fixed, identical attack battery that
# can be pointed at any SSH-speaking target (a Maya decoy OR the Cowrie
# baseline honeypot), so the SAME attacker behavior generates comparable
# data on both sides. This script is the ground truth of "what actually
# happened and when" -- everything downstream (Cowrie log parsing, Maya's
# MongoDB records, the comparison report) gets correlated against the
# timestamps this script writes, not against each other directly.
#
# Stages: recon (nmap) -> failed-credential brute force -> a real
# post-auth session with a battery of recon/exfil-flavored commands.
#
# Usage:
#   ./run-battery.sh --target HOST --ssh-port PORT --label LABEL \
#     --known-user USER --known-pass PASS [--out DIR]
#
# Example (against a Maya decoy):
#   ./run-battery.sh --target 127.0.0.1 --ssh-port 30022 --label maya-jump-01 \
#     --known-user admin --known-pass 'fakejump01!'
#
# Example (against Cowrie, which by default accepts any credential):
#   ./run-battery.sh --target 127.0.0.1 --ssh-port 2222 --label cowrie \
#     --known-user root --known-pass toor
#
# Requires: nmap, ssh, sshpass. Uses hydra for the brute-force phase if
# present, otherwise falls back to a plain sshpass loop (slower, but no
# extra dependency required for a minimal run).

set -euo pipefail

TARGET=""
SSH_PORT=22
LABEL=""
KNOWN_USER=""
KNOWN_PASS=""
OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/redteam-results"

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --ssh-port) SSH_PORT="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --known-user) KNOWN_USER="$2"; shift 2 ;;
    --known-pass) KNOWN_PASS="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

if [ -z "$TARGET" ] || [ -z "$LABEL" ] || [ -z "$KNOWN_USER" ] || [ -z "$KNOWN_PASS" ]; then
  echo "Usage: $0 --target HOST --ssh-port PORT --label LABEL --known-user USER --known-pass PASS [--out DIR]"
  exit 1
fi

mkdir -p "$OUT_DIR"
LOG_FILE="$OUT_DIR/${LABEL}-battery.jsonl"
: > "$LOG_FILE"

YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'

now_iso() { date -u +"%Y-%m-%dT%H:%M:%S.%3NZ"; }

# Appends one structured record to the battery log -- this is the ground
# truth every downstream metric gets correlated against.
log_action() {
  local phase="$1" action="$2" result="$3"
  printf '{"ts":"%s","label":"%s","phase":"%s","action":"%s","result":"%s"}\n' \
    "$(now_iso)" "$LABEL" "$phase" "$action" "$result" >> "$LOG_FILE"
}

step() { echo -e "\n${YELLOW}==>${NC} $1"; }
ok() { echo -e "  ${GREEN}✓${NC} $1"; }

for bin in nmap ssh sshpass; do
  command -v "$bin" >/dev/null 2>&1 || { echo "Missing required tool: $bin"; exit 1; }
done

echo "Battery run: target=$TARGET ssh_port=$SSH_PORT label=$LABEL log=$LOG_FILE"

# ---- Stage 1: Recon -------------------------------------------------------
step "Stage 1: Recon (nmap)"
log_action "recon" "nmap_start" "started"
NMAP_LOG="$OUT_DIR/${LABEL}-nmap.log"
nmap -sV -Pn -p 21,22,23,80,443,2222,3306,6379 "$TARGET" > "$NMAP_LOG" 2>&1 || true
log_action "recon" "nmap_scan" "completed"
ok "nmap scan complete, saved to $NMAP_LOG"

# ---- Stage 2: Failed-credential brute force -------------------------------
step "Stage 2: SSH brute force (deliberately wrong credentials)"
WRONG_USERS=(admin root guest test)
WRONG_PASSWORDS=(password123 letmein qwerty12345 changeme123)

if command -v hydra >/dev/null 2>&1; then
  log_action "bruteforce" "hydra_start" "started"
  HYDRA_LOG="$OUT_DIR/${LABEL}-hydra.log"
  {
    printf '%s\n' "${WRONG_USERS[@]}" > "$OUT_DIR/.users.tmp"
    printf '%s\n' "${WRONG_PASSWORDS[@]}" > "$OUT_DIR/.passwords.tmp"
  }
  hydra -L "$OUT_DIR/.users.tmp" -P "$OUT_DIR/.passwords.tmp" -t 4 -f \
    -s "$SSH_PORT" "ssh://$TARGET" > "$HYDRA_LOG" 2>&1 || true
  rm -f "$OUT_DIR/.users.tmp" "$OUT_DIR/.passwords.tmp"
  log_action "bruteforce" "hydra_run" "completed"
  ok "hydra brute force complete, saved to $HYDRA_LOG"
else
  ok "hydra not found, falling back to a plain sshpass loop"
  for user in "${WRONG_USERS[@]}"; do
    for pass in "${WRONG_PASSWORDS[@]}"; do
      log_action "bruteforce" "ssh_login_attempt:${user}" "attempting"
      sshpass -p "$pass" ssh -p "$SSH_PORT" \
        -o StrictHostKeyChecking=no -o ConnectTimeout=3 -o BatchMode=no \
        "$user@$TARGET" "true" > /dev/null 2>&1 \
        && log_action "bruteforce" "ssh_login_attempt:${user}" "unexpected_success" \
        || log_action "bruteforce" "ssh_login_attempt:${user}" "failed_as_expected"
    done
  done
  ok "brute force loop complete (${#WRONG_USERS[@]}x${#WRONG_PASSWORDS[@]} attempts)"
fi

# ---- Stage 3: Successful login + post-auth command battery ---------------
step "Stage 3: Authenticated session (known credential)"
log_action "postauth" "ssh_login" "attempting"

POSTAUTH_LOG="$OUT_DIR/${LABEL}-postauth.log"
: > "$POSTAUTH_LOG"

# Same command battery run identically against both targets -- this is
# what proves (or disproves) each system captures post-auth behavior with
# comparable fidelity.
COMMANDS=(
  "whoami"
  "uname -a"
  "id"
  "cat /etc/passwd"
  "ls -la /"
  "ps aux"
  "netstat -tulpn || ss -tulpn"
  "cat /etc/hosts"
  "find / -maxdepth 2 -name '*.conf' 2>/dev/null"
)

for cmd in "${COMMANDS[@]}"; do
  log_action "postauth" "command:${cmd}" "sent"
  {
    echo "=== $cmd ==="
    sshpass -p "$KNOWN_PASS" ssh -p "$SSH_PORT" \
      -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=no \
      "$KNOWN_USER@$TARGET" "$cmd" 2>&1 || echo "(command failed or connection dropped)"
  } >> "$POSTAUTH_LOG"
  log_action "postauth" "command:${cmd}" "completed"
  sleep 1
done

log_action "postauth" "ssh_session" "closed"
ok "post-auth command battery complete, saved to $POSTAUTH_LOG"

# ---- Stage 4: Simulated exfiltration --------------------------------------
step "Stage 4: Simulated data exfiltration"
log_action "exfil" "large_transfer_attempt" "sent"
sshpass -p "$KNOWN_PASS" ssh -p "$SSH_PORT" \
  -o StrictHostKeyChecking=no -o ConnectTimeout=5 \
  "$KNOWN_USER@$TARGET" "cat /etc/passwd | base64 | head -c 2000" >> "$POSTAUTH_LOG" 2>&1 || true
log_action "exfil" "large_transfer_attempt" "completed"
ok "exfil simulation complete"

echo
echo "Battery complete. Ground-truth log: $LOG_FILE"
echo "Next: run this same script against the other target with the same --label"
echo "convention, then run scripts/redteam/build-report.* (Task 5) to compare."
