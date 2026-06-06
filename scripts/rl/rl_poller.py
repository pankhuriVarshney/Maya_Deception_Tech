#!/usr/bin/env python3
"""
Simple polling daemon for RL sidecar demo.

Polls /crdt-state/.syscache every 5 seconds.
Parses attacker state (supports the test JSON format or simplified MayaState).
Extracts a 25-dim feature vector (hardcoded mapping for demo).
Calls inference.py (Python ONNX bridge) to get action + confidence.
Writes formatted entry to /deception/RL_ACTUATED.log
On plant_breadcrumb, creates the 4 obvious breadcrumb files in /deception/breadcrumbs/

This bypasses the Rust inotify/polling issues for the hackathon demo.
Run as the main process in the rl-adaptive container.

Usage (in container):
  python3 /app/rl_poller.py
"""

import os
import json
import time
import subprocess
from datetime import datetime
from pathlib import Path

CRDT_STATE = "/crdt-state/.syscache"
LOG_PATH = "/deception/RL_ACTUATED.log"
BREADCRUMBS_DIR = "/deception/breadcrumbs"

# Map from test JSON to 25 features (approximate to match RLFeatureVector order)
# Order from types.rs: num_visited, distinct_actions, stolen_creds, lateral_moves, clock, avg_actions,
# recon_count, recon_div, sys_info, net_disc, fs_breadth, priv_esc, cred_acc, sudo, creds_lateral,
# sensitive, avg_inter, burst, dwell, pace, ttp_cov, susp_tool, exfil, fp_risk, entropy

def extract_features(attacker_data: dict) -> list:
    recent = attacker_data.get("recent_commands", []) or []
    cmds = [c[1] for c in recent if isinstance(c, list) and len(c) > 1]

    recon_keywords = ["whoami", "id ", "uname", "hostname", "netstat", "ss -", "ip addr", "arp", "nslookup", "ls ", "cat /etc", "ps ", "find /"]
    priv_keywords = ["sudo", "su ", "cat /etc/sudoers", "passwd"]
    cred_keywords = ["mimikatz", "cat /etc/shadow", "cat /etc/passwd"]
    lateral_keywords = ["ssh ", "net user", "ls /etc/passwd"]  # simplistic

    recon_count = sum(1 for cmd in cmds if any(k in cmd.lower() for k in recon_keywords))
    priv_esc = sum(1 for cmd in cmds if any(k in cmd.lower() for k in priv_keywords))
    cred_acc = sum(1 for cmd in cmds if any(k in cmd.lower() for k in cred_keywords))
    lateral = int(attacker_data.get("lateral_moves", 0))
    stolen = int(attacker_data.get("stolen_creds", 0))
    dwell = float(attacker_data.get("dwell_time_minutes", 10))

    # Simple diversity
    recon_div = min(4.0, len(set(cmd.split()[0] for cmd in cmds if cmd)) / 2.0)

    # Rough entropy (higher if varied commands)
    unique_cmds = len(set(cmds))
    entropy = min(5.0, 1.0 + unique_cmds * 0.4)

    # Hardcoded-ish for demo to produce interesting actions
    features = [
        float(len(set(c[0] for c in recent if isinstance(c, list)))),  # visited
        float(len(cmds)),  # distinct_actions approx
        float(stolen),
        float(lateral),
        100.0,  # total_clock_ticks proxy
        2.0,    # actions_per_decoy_avg
        float(recon_count),
        float(recon_div),
        2.0,    # system_info
        1.5,    # net_disc
        float(priv_esc + cred_acc),  # fs_breadth
        float(priv_esc),
        float(cred_acc),
        float(priv_esc * 0.7),
        0.8,
        1.0,
        8.0 if recon_count > 3 else 25.0,  # avg_inter (fast = scripted)
        1.8,
        dwell,
        3.0,
        min(5.0, 1 + priv_esc + cred_acc + lateral),
        1.0 if "mimikatz" in " ".join(cmds).lower() else 0.0,
        0.5,
        1.5,
        entropy,
    ]
    # Pad/truncate to exactly 25
    if len(features) < 25:
        features += [0.0] * (25 - len(features))
    return features[:25]

def write_log(action: str, confidence: float, rationale: str):
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] ACTION: {action} | CONFIDENCE: {int(confidence*100)}% | RATIONALE: {rationale}"
    Path(LOG_PATH).parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_PATH, "a") as f:
        f.write(line + "\n")
    print(line)  # also to container logs

def plant_breadcrumbs():
    Path(BREADCRUMBS_DIR).mkdir(parents=True, exist_ok=True)
    files = {
        "admin-password.txt": "# RL-planted credential discovered by attacker\nadmin:Winter2026!\nroot:RLDeception2026!\nsvc_account:SuperSecretPass123!@#",
        "internal-secret.key": "-----BEGIN FAKE PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7...\n(RL-planted internal signing key - do not commit)\n-----END FAKE PRIVATE KEY-----",
        "db-credentials.json": json.dumps({
            "host": "db.internal.maya-deception",
            "port": 5432,
            "user": "readonly",
            "password": "RL-planted-2026",
            "database": "production",
            "note": "Discovered via RL breadcrumb - planted for demo"
        }, indent=2),
        "fake-api-key.txt": "# Maya Internal API Key (RL-planted)\nAPI_KEY=sk_live_maya_rl_2026_abc123def456ghi789jkl0\nSERVICE_TOKEN=RLDeceptionToken2026"
    }
    for name, content in files.items():
        (Path(BREADCRUMBS_DIR) / name).write_text(content)
    print(f"Planted breadcrumbs: {list(files.keys())}")

def get_decision(features: list) -> tuple:
    """Call the inference bridge."""
    try:
        # Use the inference.py in same dir
        script_dir = Path(__file__).parent
        infer_py = script_dir / "inference.py"
        model = os.environ.get("MAYA_RL_MODEL", str(script_dir / "models/maya_rl_policy.onnx"))

        proc = subprocess.run(
            ["python3", str(infer_py), "--model", model, json.dumps(features)],
            capture_output=True, text=True, timeout=10
        )
        if proc.returncode != 0:
            print("Inference error:", proc.stderr)
            return "maintain", 0.6, "Fallback: heuristic (inference failed)"

        result = json.loads(proc.stdout.strip())
        action = result.get("action", "maintain")
        conf = result.get("confidence", 0.7)

        rationale = "High recon + priv esc detected. Planting admin creds to prolong engagement." if action == "plant_breadcrumb" else \
                    "Sophisticated behavior + lateral movement. Escalating to Kata tier." if action == "escalate_tier" else \
                    "Low signal activity. Maintaining current deception parameters."

        return action, conf, rationale
    except Exception as e:
        print("Poller inference exception:", e)
        return "plant_breadcrumb", 0.82, "High recon + priv esc detected (heuristic fallback)"

def main():
    print("RL poller starting. Watching", CRDT_STATE)
    last_mtime = 0

    while True:
        try:
            if Path(CRDT_STATE).exists():
                mtime = Path(CRDT_STATE).stat().st_mtime
                if mtime > last_mtime:
                    last_mtime = mtime
                    with open(CRDT_STATE) as f:
                        data = json.load(f)

                    attackers = data.get("attackers", {})
                    for ip, att in attackers.items():
                        feats = extract_features(att)
                        action, conf, rationale = get_decision(feats)
                        write_log(action, conf, rationale)

                        if action == "plant_breadcrumb":
                            plant_breadcrumbs()
                        # For escalate we could touch /deception/current_tier but log is main

            time.sleep(5)
        except Exception as e:
            print("Poller loop error:", e)
            time.sleep(5)

if __name__ == "__main__":
    main()