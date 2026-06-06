# Maya RL Training Pipeline (Python → ONNX)

This directory contains the **offline training** side of the Reinforcement Learning Adaptive Deception Engine.

## Philosophy (matches the hackathon requirements exactly)

- Training is 100% Python (Stable-Baselines3 PPO + Gymnasium).
- Inference is 100% Rust using `ort` (ONNX Runtime) — tiny, fast (< 50ms target, usually 1-5ms), no Python in the sidecar.
- The feature vector is exactly 25 dimensions and is defined in one place:
  `scripts/rl/src/types.rs` → `RLFeatureVector::to_array()` + `feature_names()`.
  The Python env must produce vectors in **identical order**.

## Quick Start (Get a Working .onnx TODAY - Hackathon Speed Run)

```bash
cd rl-training

# 1. One-time setup
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. (Optional but recommended) Generate mixed traces (scripted bots vs careful agents)
python data_generator.py --num-episodes 800 --out data/synthetic/

# 3. Train a small PPO policy (80k steps is fast on CPU and produces a usable policy)
python train_ppo.py --total-timesteps 80000 --log-dir logs/ppo_maya

# 4. Export to ONNX (exact [batch, 25] input shape expected by Rust ort)
python export_onnx.py \
    --model-path logs/ppo_maya/best/best_model.zip \
    --out models/maya_rl_policy.onnx

# 5. Verify the exported model works (roundtrip test)
python test_roundtrip_onnx.py --model models/maya_rl_policy.onnx
```

**Copy the resulting** `models/maya_rl_policy.onnx` **into** `scripts/rl/models/`

Then in the Rust side:
```bash
cd ../scripts/rl
cargo run -- simulate   # will automatically use the real ONNX if present (falls back to heuristic otherwise)
```

You should see the policy start making sensible decisions (more escalations + breadcrumbs on sophisticated traces).

**Expected runtime on a normal laptop:**
- Trace gen: < 10s
- 80k PPO steps: 1-4 minutes (depending on CPU)
- Export + test: < 15s

TensorBoard logs (great screenshots for judges) are in `logs/ppo_maya/tb/`. Look at `rollout/ep_rew_mean` and custom info metrics for dwell time improvement.

## RL Formulation (exact per project spec)

**State (25 features)** — see `RLFeatureVector` in the Rust crate for the canonical definition and order.

**Actions (Discrete 4)**
- 0: Maintain (current tier)
- 1: EscalateTier (Low=gVisor → Med=Kata → High=Kata+Vagrant)
- 2: PlantBreadcrumb (inject cred, fake file, fake service, etc.)
- 3: ObserveOnly (collect more evidence before acting)

**Reward**
- + for dwell time inside the fake network
- + for successful lateral movement (attacker stays engaged and moves between decoys)
- + for new TTPs observed (recon → cred access → lateral → collection)
- − for session drop (attacker gets bored or gives up)
- − for fingerprint detection (attacker realizes it's fake and bails or becomes noisy)

The custom Gymnasium environment (`environments/maya_deception_env.py`) simulates an attacker trajectory using the synthetic traces + a simple but effective model of "how believable the current tier is" and "how much extra dwell a breadcrumb buys".

## Directory Layout

```
rl-training/
├── requirements.txt
├── README.md
├── train_ppo.py
├── export_onnx.py
├── data_generator.py
├── environments/
│   └── maya_deception_env.py
├── data/
│   └── synthetic/
├── models/          # .onnx files go here (gitignored)
├── utils/
└── logs/            # tensorboard + model checkpoints
```

## Making the Demo Pop (for judges)

1. Train for long enough that you have a clear "RL vs Baseline" dwell time graph.
2. During the live demo run `cargo run --bin maya-rl -- simulate --attackers 3 --step 0.8` in one terminal.
   It uses the **exact same** Rust feature extractor + inference code path the sidecar will use.
3. Pipe the JSON lines (`RL_DECISION_JSON: ...`) into the real backend or just show the pretty printed lines + a small Flask/FastAPI page that renders the reward curve in real time.
4. On the dashboard (Phase 6) show:
   - Current RL decision + confidence
   - The 25 features as a small table or radar
   - Live reward delta estimate
   - "Because of RL we kept this attacker for 4m12s instead of 47s on a static tier"

## Alignment with Rust side

The single source of truth for the 25 features is the Rust struct.
When you change the order or add/remove features, you **must** keep `feature_names()` and `to_array()` in sync with the Gym observation space and the ONNX export.

We also recommend writing a tiny test that loads the exported .onnx with onnxruntime in Python and runs it on a vector produced by the Gym env — this catches 95% of shape/order bugs before you even try the Rust binary.
