#!/usr/bin/env python3
"""
Fixed ONNX export for hackathon reliability.

This script:
- Exports the SB3 policy using the same wrapper as before.
- Then forces the ONNX model to be saved **with all weights inlined** (no external .data file).
- This avoids "External data path validation failed" when the .onnx is moved/copied to scripts/rl/models/.

Usage (from rl-training/ after training):
    python export_onnx_fixed.py \
        --model-path logs/ppo_maya/best/best_model.zip \
        --out ../scripts/rl/models/maya_rl_policy.onnx
"""

from __future__ import annotations

import argparse
from pathlib import Path
import torch as th
import torch.onnx
from stable_baselines3 import PPO
import numpy as np
import onnx
import os

def export_actor_to_onnx(
    model: PPO,
    onnx_path: Path,
    input_dim: int = 25,
    action_dim: int = 4,
    dummy_batch: int = 1,
):
    onnx_path.parent.mkdir(parents=True, exist_ok=True)

    policy = model.policy
    policy.eval()

    dummy_obs = th.zeros((dummy_batch, input_dim), dtype=th.float32)

    class OnnxPolicyWrapper(th.nn.Module):
        def __init__(self, sb3_policy):
            super().__init__()
            self.features_extractor = sb3_policy.features_extractor
            self.mlp_extractor = sb3_policy.mlp_extractor
            self.action_net = sb3_policy.action_net
            self.value_net = sb3_policy.value_net

        def forward(self, obs: th.Tensor):
            features = self.features_extractor(obs)
            latent_pi, latent_vf = self.mlp_extractor(features)
            action_logits = self.action_net(latent_pi)
            value = self.value_net(latent_vf)
            return action_logits, value

    wrapper = OnnxPolicyWrapper(policy)

    input_names = ["input"]
    output_names = ["logits", "value"]

    # Export with params inlined as much as possible
    th.onnx.export(
        wrapper,
        dummy_obs,
        onnx_path,
        input_names=input_names,
        output_names=output_names,
        dynamic_axes={
            "input": {0: "batch"},
            "logits": {0: "batch"},
            "value": {0: "batch"},
        },
        opset_version=17,
        do_constant_folding=True,
        export_params=True,
        keep_initializers_as_inputs=False,
    )

    print(f"Initial export to {onnx_path}")

    # === FORCE INLINE EXTERNAL DATA (the key fix for hackathon) ===
    try:
        # Load including any external data
        onnx_model = onnx.load(str(onnx_path), load_external_data=True)

        # Save forcing everything inside the .onnx (no .data sibling file)
        onnx.save_model(
            onnx_model,
            str(onnx_path),
            save_as_external_data=False,
        )

        # Remove any leftover .data file if it was created
        data_file = onnx_path.with_suffix(onnx_path.suffix + ".data")
        if data_file.exists():
            data_file.unlink()
            print(f"Removed external data file: {data_file}")

        print("Model successfully re-saved with fully inlined weights (no external data).")
    except Exception as e:
        print(f"Warning: could not force inline data ({e}). The model may still require the .data file next to it.")
        print("Try copying both .onnx and .onnx.data together if this happens.")

    # Sanity check
    try:
        import onnxruntime as ort
        sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
        test_input = np.random.randn(1, input_dim).astype(np.float32)
        outs = sess.run(None, {"input": test_input})
        print(f"  Sanity check OK — logits shape {outs[0].shape}, value shape {outs[1].shape}")
    except Exception as e:
        print(f"  (onnxruntime sanity check skipped or failed: {e})")

    print(f"Final model ready at: {onnx_path}")
    print(f"  Input : {input_names} shape [batch, {input_dim}]")
    print(f"  Outputs: {output_names}")


def main():
    parser = argparse.ArgumentParser(description="Export SB3 model to inline ONNX (no external data)")
    parser.add_argument("--model-path", type=Path, required=True, help="Path to best_model.zip or final_model.zip from SB3")
    parser.add_argument("--out", type=Path, default=Path("../scripts/rl/models/maya_rl_policy.onnx"))
    parser.add_argument("--input-dim", type=int, default=25)
    parser.add_argument("--action-dim", type=int, default=4)
    args = parser.parse_args()

    print(f"Loading SB3 model from {args.model_path}")
    model = PPO.load(args.model_path, device="cpu")

    export_actor_to_onnx(
        model,
        args.out,
        input_dim=args.input_dim,
        action_dim=args.action_dim,
    )


if __name__ == "__main__":
    main()
