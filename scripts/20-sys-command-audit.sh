#!/bin/bash
# Maya Deception Tech - Command Audit Hook
# Records commands executed by attackers

if [ -n "$SSH_CLIENT" ] || [ -n "$SSH_CONNECTION" ]; then
    ATTACKER_IP=$(echo $SSH_CONNECTION | awk '{ print $1 }')
    HOSTNAME_SHORT=$(hostname -s)
    
    # Function to record command
    record_command() {
        local cmd="$1"
        if [[ -n "$cmd" && ! "$cmd" =~ ^[[:space:]]*$ ]]; then
            # Skip common benign commands
            if [[ ! "$cmd" =~ ^(ls|cd|pwd|echo|cat|clear|exit|history)$ ]]; then
                # `observe` is not a real subcommand (see
                # scripts/crdt/src/main.rs) -- it used to fail silently here.
                # `action` is the real, working call and already records this.
                /usr/local/bin/syslogd-helper action "$ATTACKER_IP" "$HOSTNAME_SHORT" "$cmd" 2>/dev/null || true
            fi
        fi
    }
    
    # Set PROMPT_COMMAND to record each command
    export PROMPT_COMMAND='if [ -n "$LAST_COMMAND" ]; then record_command "$LAST_COMMAND"; fi; LAST_COMMAND=$(history 1 | sed "s/^[ ]*[0-9]*[ ]*//")' 
fi
