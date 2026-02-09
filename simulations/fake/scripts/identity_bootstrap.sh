#!/bin/bash
set -e

REDIS_HOST=10.20.20.1
REDIS_PORT=6379
REDIS_AUTH="maya_secret"

LOG="/var/log/maya_identity.log"

echo "[+] Maya identity bootstrap starting" >> $LOG

# Pull attacker identity
ATTACKER_USER=$(redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_AUTH get attacker:username)
ATTACKER_PASS=$(redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_AUTH get attacker:password)
ATTACKER_ROLE=$(redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_AUTH get attacker:role)

# Safety check
if [ -z "$ATTACKER_USER" ] || [ -z "$ATTACKER_PASS" ]; then
  echo "[!] No attacker identity found, skipping" >> $LOG
  exit 0
fi

# Ensure sudo exists (Alpine compatibility)
if ! command -v sudo &>/dev/null; then
  apt update && apt install -y sudo || true
fi

# Create user if not exists
if ! id "$ATTACKER_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$ATTACKER_USER"
  echo "$ATTACKER_USER:$ATTACKER_PASS" | chpasswd
  echo "[+] Created user $ATTACKER_USER" >> $LOG
fi

# Privilege sync
if [ "$ATTACKER_ROLE" = "sysadmin" ]; then
  usermod -aG sudo "$ATTACKER_USER"
  echo "[+] Granted sudo to $ATTACKER_USER" >> $LOG
fi

echo "[+] Identity sync complete for $ATTACKER_USER" >> $LOG
