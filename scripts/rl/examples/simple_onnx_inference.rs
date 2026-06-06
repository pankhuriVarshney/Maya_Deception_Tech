//! Simple standalone-style example showing how to load the exported ONNX policy
//! with the `ort` crate and run inference.
//!
//! This matches exactly what the main maya-rl binary does in inference.rs.
//!
//! To try it quickly:
//!   1. Copy this file content into a new temporary bin or add as example.
//!   2. In scripts/rl/Cargo.toml add under [[example]] or just `cargo run --example ...` after adjusting.
//!   3. Make sure you have the .onnx and onnxruntime lib available.
//!
//! Example (after placing model):
//!   cargo run --example simple_onnx_inference --features=...  (or just build the logic)

use ort::{Environment, Session, SessionBuilder, Value};
use ndarray::{Array2, Axis};
use std::path::Path;

fn main() -> anyhow::Result<()> {
    // 1. Create environment (once per process)
    let env = Environment::builder()
        .with_name("maya_rl_quick_test")
        .build()?;

    let model_path = "models/maya_rl_policy.onnx";   // adjust path

    if !Path::new(model_path).exists() {
        eprintln!("Model not found at {}. Copy your exported .onnx here.", model_path);
        return Ok(());
    }

    // 2. Build session (load-dynamic means we rely on libonnxruntime.so being findable)
    let session = SessionBuilder::new(&env)?
        .with_optimization_level(ort::GraphOptimizationLevel::Level3)?
        .with_intra_threads(1)?
        .with_model_from_file(model_path)?;

    println!("Loaded ONNX model: {}", model_path);
    println!("Inputs: {:?}", session.inputs.iter().map(|i| &i.name).collect::<Vec<_>>());
    println!("Outputs: {:?}", session.outputs.iter().map(|o| &o.name).collect::<Vec<_>>());

    // 3. Create a realistic 25-dim feature vector (same order as Rust RLFeatureVector)
    // This example represents a "careful attacker with priv esc + lateral"
    let features: [f32; 25] = [
        4.0,  // visited
        9.0,  // distinct actions
        2.0,  // stolen creds
        2.0,  // lateral moves
        420.0, // clock ticks
        2.25, // actions per decoy
        6.0,  // recon
        2.5,
        2.8,
        3.0,
        3.5,
        2.0,  // priv esc
        1.5,  // cred access
        1.2,
        0.8,
        1.0,
        14.0, // avg interval (careful)
        1.9,  // burstiness
        9.5,  // dwell minutes
        2.8,
        3.0,  // ttp coverage
        1.0,  // susp tools
        0.5,
        1.2,  // fp risk
        3.9,  // command entropy
    ];

    let input_array: Array2<f32> = Array2::from_shape_vec((1, 25), features.to_vec())?;
    let input_value = Value::from_array(session.allocator(), &input_array)?;

    // 4. Run inference
    let outputs = session.run(vec![input_value])?;

    let logits = outputs[0].try_extract::<f32>()?.view().to_owned();
    let logits_1d = logits.index_axis(Axis(0), 0).to_owned();

    // Softmax for confidence
    let max_logit = logits_1d.fold(f32::NEG_INFINITY, |a, &b| a.max(b));
    let exp: Vec<f32> = logits_1d.iter().map(|x| (x - max_logit).exp()).collect();
    let sum: f32 = exp.iter().sum();
    let probs: Vec<f32> = exp.iter().map(|e| e / sum).collect();

    let (best_idx, &confidence) = probs
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
        .unwrap();

    let action = match best_idx {
        0 => "maintain",
        1 => "escalate_tier",
        2 => "plant_breadcrumb",
        _ => "observe_only",
    };

    let value = if outputs.len() > 1 {
        outputs[1].try_extract::<f32>().map(|v| v.view()[0]).unwrap_or(0.0)
    } else {
        0.0
    };

    println!("\n=== Quick ONNX Inference Result ===");
    println!("Action: {} (index {})", action, best_idx);
    println!("Confidence: {:.3}", confidence);
    println!("Value (critic): {:.3}", value);
    println!("Probs: {:?}", probs.iter().map(|p| format!("{:.3}", p)).collect::<Vec<_>>());
    println!("\nThis is what the sidecar will emit as RLDecision in real time.");

    Ok(())
}
