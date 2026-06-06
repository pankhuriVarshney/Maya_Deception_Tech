//! Python-bridge inference for the RL policy (reliable hackathon solution).
//!
//! We deliberately avoid the `ort` crate for now to eliminate external .data file
//! headaches and onnxruntime.so distribution problems during the demo.
//!
//! Instead:
//! - Rust calls a small Python script (inference.py) via `tokio::process::Command`.
//! - The script loads the ONNX with onnxruntime (Python side) and returns JSON.
//! - Full fallback to the excellent heuristic policy on any failure.
//!
//! This is extremely reliable for a live 5-minute demo:
//! - Python env is easy to set up on the judge laptop.
//! - No Rust <-> C FFI / ort version / .so path issues.
//! - Same feature vector (25 floats) and action space as before.
//!
//! The Python script must be next to the binary or path provided via CLI/env.

use crate::types::{RLAction, RLFeatureVector, DeceptionTier, RLDecision};
use std::path::Path;
use tokio::process::Command;
use tracing::{debug, warn};

pub const NUM_FEATURES: usize = 25;
pub const NUM_ACTIONS: usize = 4;

#[derive(Clone)]
pub struct RLInferenceEngine {
    /// Path to the Python inference bridge script (e.g. "inference.py")
    python_script: String,
    /// Path passed to the Python script via --model
    model_path: String,
    allow_fallback: bool,
}

impl RLInferenceEngine {
    /// Create engine for Python bridge.
    /// `python_script` defaults to "inference.py" (run the binary from scripts/rl/ dir).
    /// `model_path` is the onnx passed to python (defaults to "models/maya_rl_policy.onnx").
    pub fn new(
        python_script: Option<&str>,
        model_path: Option<&str>,
        allow_fallback: bool,
    ) -> anyhow::Result<Self> {
        let script = python_script
            .unwrap_or("inference.py")
            .to_string();
        let model = model_path
            .unwrap_or("models/maya_rl_policy.onnx")
            .to_string();

        debug!("RL Python bridge configured: script={} model={}", script, model);

        if !Path::new(&script).exists() {
            warn!("Python inference script not found at '{}'. Will rely on heuristic fallback.", script);
        }
        if !Path::new(&model).exists() {
            warn!("ONNX model not found at '{}'. Python calls will fail and fall back to heuristic.", model);
        }

        Ok(Self {
            python_script: script,
            model_path: model,
            allow_fallback,
        })
    }

    /// Async decide using Python bridge + heuristic fallback.
    /// This is the main entry point used by daemon and simulate.
    pub async fn decide(
        &self,
        attacker_id: String,
        current_tier: DeceptionTier,
        features: RLFeatureVector,
        observed_ttps: Vec<String>,
    ) -> RLDecision {
        let feature_vec: Vec<f32> = features.to_array().to_vec();
        let feature_map = features.to_map();

        match self.call_python_bridge(&feature_vec).await {
            Ok((action, confidence)) => {
                let mut decision = RLDecision::new(
                    attacker_id.clone(),
                    current_tier,
                    action,
                    confidence,
                    feature_map,
                );
                decision.observed_ttps = observed_ttps;
                decision.rationale = self.generate_rationale(&action, confidence, &features);
                decision.predicted_reward_delta = self.estimate_reward_delta(&action, &features);
                decision
            }
            Err(e) => {
                warn!("Python RL bridge failed for {}: {}. Using heuristic.", attacker_id, e);
                self.heuristic_decide(attacker_id, current_tier, features, observed_ttps)
            }
        }
    }

    /// Call the Python inference script via tokio::process::Command.
    /// Passes the 25 features as a JSON array on the command line.
    async fn call_python_bridge(&self, features: &[f32]) -> anyhow::Result<(RLAction, f32)> {
        let features_json = serde_json::to_string(features)?;

        let output = Command::new("python3")
            .arg(&self.python_script)
            .arg("--model")
            .arg(&self.model_path)
            .arg(&features_json)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("python bridge exited with error: {}", stderr.trim());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let trimmed = stdout.trim();
        if trimmed.is_empty() {
            anyhow::bail!("python bridge produced no output");
        }

        let parsed: serde_json::Value = serde_json::from_str(trimmed)?;

        if let Some(err) = parsed.get("error") {
            anyhow::bail!("python error: {}", err);
        }

        let action_str = parsed["action"].as_str().unwrap_or("maintain");
        let confidence = parsed["confidence"].as_f64().unwrap_or(0.5) as f32;

        let action = match action_str {
            "escalate_tier" => RLAction::EscalateTier,
            "plant_breadcrumb" => RLAction::PlantBreadcrumb,
            "observe_only" => RLAction::ObserveOnly,
            _ => RLAction::Maintain,
        };

        Ok((action, confidence))
    }

    /// Heuristic fallback (identical logic to previous versions, kept here for self-containment).
    fn heuristic_decide(
        &self,
        attacker_id: String,
        current_tier: DeceptionTier,
        features: RLFeatureVector,
        observed_ttps: Vec<String>,
    ) -> RLDecision {
        let f = &features;

        let sophistication = f.recon_command_count * 0.6
            + f.privilege_escalation_attempts * 1.2
            + f.credential_access_commands * 1.5
            + f.suspicious_tool_count * 2.0
            + f.mitre_ttp_coverage * 3.0;

        let is_bursty_automated = f.action_burstiness > 2.5 && f.avg_inter_action_seconds < 8.0;
        let high_risk = f.fingerprint_risk_score > 2.0;

        let action = if high_risk || (sophistication > 12.0 && current_tier != DeceptionTier::High) {
            if current_tier == DeceptionTier::Low && sophistication > 8.0 {
                RLAction::EscalateTier
            } else {
                RLAction::PlantBreadcrumb
            }
        } else if sophistication > 7.0 && current_tier == DeceptionTier::Low {
            RLAction::EscalateTier
        } else if f.num_lateral_moves > 1.5 && f.num_stolen_creds > 0.5 && current_tier != DeceptionTier::High {
            RLAction::EscalateTier
        } else if f.recon_diversity > 3.0 || f.exfil_or_collection_signals > 0.5 {
            RLAction::PlantBreadcrumb
        } else if is_bursty_automated && f.recon_command_count > 5.0 {
            RLAction::PlantBreadcrumb
        } else {
            RLAction::Maintain
        };

        let confidence = if matches!(action, RLAction::Maintain) { 0.65 } else { 0.82 };

        let mut decision = RLDecision::new(
            attacker_id,
            current_tier,
            action,
            confidence,
            f.to_map(),
        );
        decision.observed_ttps = observed_ttps;
        decision.rationale = format!(
            "[HEURISTIC] sophistication={:.1} fp_risk={:.1} lateral={} -> {:?}",
            sophistication, f.fingerprint_risk_score, f.num_lateral_moves, action
        );
        decision.predicted_reward_delta = self.estimate_reward_delta(&action, f);
        decision
    }

    fn generate_rationale(&self, action: &RLAction, confidence: f32, features: &RLFeatureVector) -> String {
        match action {
            RLAction::EscalateTier => format!(
                "Escalating tier (conf {:.0}%) — high priv/cred activity ({:.0} + {:.0}) + lateral moves ({:.0})",
                confidence * 100.0,
                features.privilege_escalation_attempts,
                features.credential_access_commands,
                features.num_lateral_moves
            ),
            RLAction::PlantBreadcrumb => format!(
                "Planting breadcrumb (conf {:.0}%) — recon diversity {:.0}, suspicious tools {:.0}, to increase dwell",
                confidence * 100.0,
                features.recon_diversity,
                features.suspicious_tool_count
            ),
            _ => format!(
                "Maintaining (conf {:.0}%) — low sophistication signals ({:.1})",
                confidence * 100.0,
                features.mitre_ttp_coverage + features.suspicious_tool_count
            ),
        }
    }

    fn estimate_reward_delta(&self, action: &RLAction, features: &RLFeatureVector) -> f32 {
        match action {
            RLAction::EscalateTier => {
                (features.mitre_ttp_coverage * 12.0 + features.privilege_escalation_attempts * 8.0).min(180.0)
            }
            RLAction::PlantBreadcrumb => {
                45.0 + features.recon_diversity * 10.0 + features.num_lateral_moves * 15.0
            }
            _ => 5.0,
        }
    }
}

/// Small helper so the binary can print a one-line "RL live" line for judges watching the terminal.
pub fn format_live_line(decision: &RLDecision) -> String {
    format!(
        "[RL] {} | {} | action={} conf={:.0}% tier={} | dwell_proxy={:.0}m recon={:.0} priv={:.0} lat={:.0} | {}",
        decision.timestamp.format("%H:%M:%S"),
        decision.attacker_id,
        decision.action.as_str(),
        decision.confidence * 100.0,
        decision.current_tier.as_str(),
        decision.features.get("dwell_time_minutes_proxy").unwrap_or(&0.0),
        decision.features.get("recon_command_count").unwrap_or(&0.0),
        decision.features.get("privilege_escalation_attempts").unwrap_or(&0.0),
        decision.features.get("num_lateral_moves").unwrap_or(&0.0),
        decision.rationale
    )
}
