#!/usr/bin/env python3
"""
Roundtrip test for the exported ONNX policy.

Usage (after you have trained + exported):
    python test_roundtrip_onnx.py --model models/maya_rl_policy.onnx

It will:
- Construct several realistic 25-dim feature vectors (mimicking what the Rust extractor produces)
- Run inference via onnxruntime
- Print the chosen action, confidence, and value
- This proves the exported model has the exact input shape the Rust side expects.

You can also use it to sanity-check before copying the .onnx to the Rust sidecar.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import numpy as np

try:
    import onnxruntime as ort
except ImportError:
    print("onnxruntime not installed. pip install onnxruntime")
    raise

# Exact order from Rust RLFeatureVector (must stay in sync!)
FEATURE_NAMES = [
    "num_visited_decoys",
    "num_distinct_actions",
    "num_stolen_creds",
    "num_lateral_moves",
    "total_clock_ticks",
    "actions_per_decoy_avg",
    "recon_command_count",
    "recon_diversity",
    "system_info_gathered",
    "network_discovery_count",
    "file_system_breadth",
    "privilege_escalation_attempts",
    "credential_access_commands",
    "sudo_or_su_count",
    "creds_used_for_lateral",
    "sensitive_file_reads",
    "avg_inter_action_seconds",
    "action_burstiness",
    "dwell_time_minutes_proxy",
    "session_pace_score",
    "mitre_ttp_coverage",
    "suspicious_tool_count",
    "exfil_or_collection_signals",
    "fingerprint_risk_score",
    "command_entropy",
]

ACTION_NAMES = ["maintain", "escalate_tier", "plant_breadcrumb", "observe_only"]


def softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - np.max(x))
    return e / e.sum()


def make_feature_vector(profile: str) -> np.ndarray:
    """
    Create a plausible 25-dim vector that the Rust feature extractor would produce
    for different attacker profiles. These are hand-crafted to exercise the policy.
    """
    v = np.zeros(25, dtype=np.float32)

    if profile == "noisy_script_kiddie":
        # Lots of recon, fast, low entropy, low lateral, low priv
        v[0] = 2.0   # visited
        v[1] = 5.0
        v[3] = 1.0
        v[6] = 9.0   # recon
        v[7] = 2.0
        v[16] = 4.2  # fast avg interval
        v[17] = 0.9  # low burstiness = scripted
        v[18] = 3.5  # short dwell
        v[20] = 1.0
        v[24] = 1.8  # low entropy
    elif profile == "careful_recon_lateral":
        # Good recon + some priv + lateral + decent dwell
        v[0] = 4.0
        v[1] = 11.0
        v[3] = 2.5
        v[6] = 7.0
        v[11] = 2.0
        v[12] = 1.0
        v[16] = 18.0
        v[17] = 1.8
        v[18] = 11.0
        v[20] = 3.0
        v[21] = 1.0
        v[24] = 4.1
    elif profile == "high_soph_priv_cred":
        # Dangerous: priv esc + cred dump + lateral + tools
        v[0] = 5.0
        v[3] = 3.0
        v[11] = 4.0
        v[12] = 3.5
        v[14] = 1.0
        v[17] = 2.1
        v[18] = 14.0
        v[20] = 4.0
        v[21] = 2.0
        v[23] = 1.8  # some fp risk
        v[24] = 3.7
    else:  # default medium
        v[0] = 3.0
        v[6] = 5.0
        v[16] = 12.0
        v[18] = 7.0
        v[20] = 2.0
        v[24] = 3.2

    # Fill some safe defaults for the rest so vector is full
    v[2] = min(3.0, v[3] * 0.6)   # stolen creds proxy
    v[4] = v[18] * 55.0           # clock ticks rough proxy
    v[5] = v[1] / max(1.0, v[0])
    v[8] = min(3.5, v[6] * 0.4)
    v[9] = min(4.0, v[6] * 0.3)
    v[10] = min(4.0, v[11] + v[12])
    v[13] = v[11] * 0.6
    v[15] = min(2.5, v[12] * 0.7)
    v[19] = v[1] / max(0.7, np.sqrt(v[18] + 0.2))
    v[22] = min(1.5, v[3] * 0.3)

    return np.clip(v, -1.0, 180.0).astype(np.float32)


def run_inference(sess: ort.InferenceSession, features: np.ndarray) -> dict:
    """Run the model. Expects input name 'input'."""
    input_name = sess.get_inputs()[0].name
    outputs = sess.run(None, {input_name: features.reshape(1, -1)})

    logits = outputs[0][0]
    value = float(outputs[1][0]) if len(outputs) > 1 else 0.0

    probs = softmax(logits)
    action_idx = int(np.argmax(probs))
    confidence = float(probs[action_idx])

    return {
        "action": ACTION_NAMES[action_idx],
        "action_idx": action_idx,
        "confidence": round(confidence, 4),
        "value": round(value, 3),
        "logits": [round(float(x), 3) for x in logits],
        "probs": [round(float(p), 3) for p in probs],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, default=Path("models/maya_rl_policy.onnx"))
    parser.add_argument("--profiles", nargs="+",
                        default=["noisy_script_kiddie", "careful_recon_lateral", "high_soph_priv_cred"],
                        help="Which synthetic attacker profiles to test")
    args = parser.parse_args()

    if not args.model.exists():
        print(f"Model not found: {args.model}")
        print("Train + export first, or point --model to an existing .onnx")
        return

    print(f"Loading ONNX model: {args.model}")
    sess = ort.InferenceSession(str(args.model), providers=["CPUExecutionProvider"])
    print(f"Input shape expected: {sess.get_inputs()[0].shape}")
    print(f"Output names: {[o.name for o in sess.get_outputs()]}")
    print()

    for profile in args.profiles:
        vec = make_feature_vector(profile)
        result = run_inference(sess, vec)

        print(f"Profile: {profile}")
        print(f"  Features (first 8): {np.round(vec[:8], 2).tolist()} ... (last: entropy={vec[24]:.2f})")
        print(f"  -> Action: {result['action']} (idx={result['action_idx']})")
        print(f"     Confidence: {result['confidence']:.3f}")
        print(f"     Value est:  {result['value']}")
        print(f"     Probs: {result['probs']}")
        print()

    print("Roundtrip test complete. If you see reasonable actions (e.g. escalate or plant for sophisticated profiles), the export is good.")


if __name__ == "__main__":
    main()
