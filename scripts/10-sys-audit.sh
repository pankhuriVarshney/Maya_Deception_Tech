#!/bin/bash
# Maya Deception Tech - SSH Audit Hook
# Triggered on every SSH login

if [ -n "$SSH_CLIENT" ] || [ -n "$SSH_CONNECTION" ]; then
    # Get attacker IP
    ATTACKER_IP=$(echo $SSH_CONNECTION | awk '{ print $1 }')
    HOSTNAME_SHORT=$(hostname -s)

    # Record visited decoy
    /usr/local/bin/syslogd-helper visit "$ATTACKER_IP" "$HOSTNAME_SHORT" 2>/dev/null || true

    # Record the login as an explicit action (there is no `observe`/`sync`
    # subcommand -- see scripts/crdt/src/main.rs; those calls used to fail
    # silently here). Continuous peer sync is handled by the syslogd-helper
    # daemon, started once via scripts/setup-infrastructure.sh.
    /usr/local/bin/syslogd-helper action "$ATTACKER_IP" "$HOSTNAME_SHORT" "ssh_login" 2>/dev/null || true
fi
