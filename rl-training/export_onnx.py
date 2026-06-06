#!/usr/bin/env python3
"""
Export a trained Stable-Baselines3 PPO actor (policy) to ONNX for the Rust ort inference engine.

The exported graph must accept exactly [1, 25] float32 and produce logits (and optionally a value).

After export, copy the .onnx into scripts/rl/models/ and the sidecar binary will pick it up.

Typical usage:
    python rl_training/export_onnx.py \
        --model-path logs/ppo_maya/best/best_model.zip \
        --out models/maya_rl_policy.onnx
"""

from __future__ import annotations

import argparse
from pathlib import Path
import torch as th
import torch.onnx
from stable_baselines3 import PPO
import numpy as np


def export_actor_to_onnx(
    model: PPO,
    onnx_path: Path,
    input_dim: int = 25,
    action_dim: int = 4,
    dummy_batch: int = 1,
):
    """
    Extract the actor (policy) network from SB3 PPO and export it.
    We export the part that goes from observations -> action logits (before the
    distribution sampling). The value head can be exported as a second output if desired.
    """
    onnx_path.parent.mkdir(parents=True, exist_ok=True)

    # SB3 keeps the policy under model.policy
    policy = model.policy
    policy.eval()

    # Create a dummy observation in the exact shape the Rust side will send
    dummy_obs = th.zeros((dummy_batch, input_dim), dtype=th.float32)

    # We will trace through the actor network (the part before the action distribution)
    # For SB3 MlpPolicy the forward is a bit involved. We use the internal _predict
    # or manually call the features extractor + action net.

    class OnnxPolicyWrapper(th.nn.Module):
        """Wraps just enough of the SB3 policy to produce logits + value for ONNX."""
        def __init__(self, sb3_policy):
            super().__init__()
            self.policy = sb3_policy
            self.features_extractor = sb3_policy.features_extractor
            self.mlp_extractor = sb3_policy.mlp_extractor
            self.action_net = sb3_policy.action_net
            self.value_net = sb3_policy.value_net

        def forward(self, obs: th.Tensor):
            # features
            features = self.features_extractor(obs)
            latent_pi, latent_vf = self.mlp_extractor(features)
            # action logits (what we argmax in Rust)
            action_logits = self.action_net(latent_pi)
            # value (optional but very useful for debugging / live dashboard)
            value = self.value_net(latent_vf)
            return action_logits, value

    wrapper = OnnxPolicyWrapper(policy)

    # Export
    input_names = ["input"]
    output_names = ["logits", "value"]

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
    )

    print(f"Exported ONNX policy to {onnx_path}")
    print(f"  Input : {input_names} shape [batch, {input_dim}]")
    print(f"  Outputs: {output_names}")

    # Quick sanity check with onnxruntime
    try:
        import onnxruntime as ort
        sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
        test_input = np.random.randn(1, input_dim).astype(np.float32)
        outs = sess.run(None, {"input": test_input})
        print(f"  Sanity check OK — logits shape {outs[0].shape}, value shape {outs[1].shape}")
    except Exception as e:
        print(f"  (onnxruntime sanity check skipped or failed: {e})")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", type=Path, required=True, help="Path to best_model.zip or final_model.zip")
    parser.add_argument("--out", type=Path, default=Path("models/maya_rl_policy.onnx"))
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
