#!/usr/bin/env python3
"""
Reliable Python bridge for RL inference.

Called by the Rust maya-rl binary via subprocess (tokio::process::Command).

Usage:
    python3 inference.py '[0.0, 1.0, 2.0, ...25 values...]'
    python3 inference.py --model /path/to/model.onnx '[0.0, ...]'

Outputs a single JSON line:
    {"action": "escalate_tier", "confidence": 0.87, "probabilities": [...] }

The script resolves the model path relative to its own location so it works
regardless of the Rust binary's current working directory.
"""

import sys
import json
import os
import argparse
import numpy as np

try:
    import onnxruntime as ort
except ImportError as e:
    print(json.dumps({"error": f"onnxruntime not available: {e}"}), file=sys.stderr)
    sys.exit(1)

# Resolve model relative to this script for reliability
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL = os.path.join(SCRIPT_DIR, "models", "maya_rl_policy.onnx")

def load_session(model_path: str):
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model not found at {model_path}")
    # Use CPU provider only for maximum compatibility in hackathon envs
    return ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])

def predict(session, features_list):
    if len(features_list) != 25:
        raise ValueError(f"Expected 25 features, got {len(features_list)}")
    input_data = np.array([features_list], dtype=np.float32)
    outputs = session.run(None, {"input": input_data})
    logits = outputs[0][0]
    # Stable softmax
    logits = logits - np.max(logits)
    exp = np.exp(logits)
    probs = exp / np.sum(exp)
    action_idx = int(np.argmax(probs))
    confidence = float(probs[action_idx])

    actions = ["maintain", "escalate_tier", "plant_breadcrumb", "observe_only"]
    return {
        "action": actions[action_idx],
        "confidence": round(confidence, 4),
        "probabilities": [round(float(p), 4) for p in probs],
        "logits": [round(float(l), 4) for l in logits],
    }

def main():
    parser = argparse.ArgumentParser(description="Maya RL Python inference bridge")
    parser.add_argument("--model", type=str, default=None,
                        help="Path to maya_rl_policy.onnx (defaults to script-relative models/)")
    parser.add_argument("features", nargs="?", default=None,
                        help="JSON array of 25 floats, e.g. '[1.0, 2.0, ...]'")
    args = parser.parse_args()

    model_path = args.model or os.environ.get("MAYA_RL_MODEL", DEFAULT_MODEL)
    model_path = os.path.abspath(model_path)

    try:
        session = load_session(model_path)

        if args.features:
            features = json.loads(args.features)
        else:
            # Fallback: read from stdin (useful for piping)
            features = json.loads(sys.stdin.read().strip())

        result = predict(session, features)
        print(json.dumps(result))
    except Exception as e:
        # Always emit JSON error so Rust can parse and fallback
        err = {"error": str(e), "model_path": model_path}
        print(json.dumps(err), file=sys.stderr)
        # Exit non-zero so Rust knows it failed
        sys.exit(2)

if __name__ == "__main__":
    main()
