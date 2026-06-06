//! Core types for the RL Adaptive Deception Engine.
//! These are the "contract" between FeatureExtractor <-> Inference <-> Orchestrator.
//! They are designed to be:
//! - Serde-friendly for WebSocket / dashboard events
//! - Easy to log as structured JSON for judges (hackathon requirement)
//! - Directly mappable to Kubernetes tiering concepts (gVisor / Kata / Kata+Vagrant)

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Deception fidelity / isolation tier.
/// Maps to real deployment primitives in Maya:
/// - Low  : gVisor (fast, observable, lower fidelity)
/// - Med  : Kata Containers (stronger isolation, better realism)
/// - High : Kata + Vagrant full VM (highest fidelity, hardest to fingerprint, highest cost)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "lowercase")]
pub enum DeceptionTier {
    Low,  // gVisor
    Med,  // Kata
    High, // Kata + Vagrant / full isolation
}

impl DeceptionTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            DeceptionTier::Low => "low-gvisor",
            DeceptionTier::Med => "med-kata",
            DeceptionTier::High => "high-kata-vagrant",
        }
    }

    pub fn next(&self) -> Self {
        match self {
            DeceptionTier::Low => DeceptionTier::Med,
            DeceptionTier::Med => DeceptionTier::High,
            DeceptionTier::High => DeceptionTier::High,
        }
    }

    pub fn prev(&self) -> Self {
        match self {
            DeceptionTier::Low => DeceptionTier::Low,
            DeceptionTier::Med => DeceptionTier::Low,
            DeceptionTier::High => DeceptionTier::Med,
        }
    }
}

/// Discrete actions the RL policy can take.
/// Per the project spec (pages 6-7 / requirements):
/// - Maintain current tier (do nothing aggressive)
/// - Escalate tier (increase fidelity to keep sophisticated attacker engaged longer)
/// - PlantBreadcrumb (inject a new honey credential / file / service that increases
///   observed TTPs and dwell time inside the fake network)
///
/// For the first model we keep the action space small (4) for fast training + demo clarity.
/// Later we can expand to parameterized actions (which breadcrumb, which specific tier delta).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RLAction {
    /// Do nothing / keep current deception parameters. Good for low-sophistication or noisy probes.
    Maintain,
    /// Move the attacker session (or the whole decoy) to the next higher fidelity tier.
    EscalateTier,
    /// Inject one or more realistic breadcrumbs (fake creds, fake sudo rules, fake lateral paths,
    /// fake database entries, etc.). Increases "interestingness" signal for the attacker.
    PlantBreadcrumb,
    /// (Reserved / future) Force a controlled de-escalation or add noise. Currently treated as Maintain.
    ObserveOnly,
}

impl RLAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            RLAction::Maintain => "maintain",
            RLAction::EscalateTier => "escalate_tier",
            RLAction::PlantBreadcrumb => "plant_breadcrumb",
            RLAction::ObserveOnly => "observe_only",
        }
    }

    /// Human friendly label for dashboard / judges.
    pub fn description(&self) -> &'static str {
        match self {
            RLAction::Maintain => "Maintain current tier - no change",
            RLAction::EscalateTier => "Escalate deception tier (gVisor → Kata → Vagrant)",
            RLAction::PlantBreadcrumb => "Plant new breadcrumb / honey token to prolong engagement",
            RLAction::ObserveOnly => "Observe only (collect more evidence)",
        }
    }
}

/// The full decision the engine emits after each inference cycle.
/// This is what gets:
///   1. Logged (JSON lines for live demo visibility)
///   2. Sent over WebSocket to the dashboard (Phase 6)
///   3. Acted upon by the orchestration layer (Phase 5)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RLDecision {
    pub timestamp: chrono::DateTime<chrono::Utc>,
    /// Which attacker (IP or stable attacker_id from CRDT)
    pub attacker_id: String,
    /// Current observed state summary (for explainability)
    pub current_tier: DeceptionTier,
    /// What the policy decided
    pub action: RLAction,
    /// Which breadcrumb(s) were chosen (only meaningful for PlantBreadcrumb)
    pub breadcrumb_target: Option<String>,
    /// Model confidence (softmax of the chosen action)
    pub confidence: f32,
    /// Estimated value / advantage from the critic head (if exported). Useful for debugging reward model.
    pub estimated_value: Option<f32>,
    /// The 25 raw (or lightly normalized) features that drove this decision. Great for judges.
    pub features: HashMap<String, f32>,
    /// Why (textual rule-of-thumb + model). Helps demo narrative.
    pub rationale: String,
    /// MITRE techniques observed in the window that contributed to features.
    pub observed_ttps: Vec<String>,
    /// Reward signal estimate (for live curve plotting on dashboard)
    pub predicted_reward_delta: f32,
}

impl RLDecision {
    pub fn new(
        attacker_id: String,
        current_tier: DeceptionTier,
        action: RLAction,
        confidence: f32,
        features: HashMap<String, f32>,
    ) -> Self {
        Self {
            timestamp: chrono::Utc::now(),
            attacker_id,
            current_tier,
            action,
            breadcrumb_target: None,
            confidence,
            estimated_value: None,
            features,
            rationale: String::new(),
            observed_ttps: vec![],
            predicted_reward_delta: 0.0,
        }
    }
}

/// The exact feature vector contract (~25 dimensions).
/// Order is **critical** and must match the ONNX model input shape [1, 25].
/// All values should be in reasonable numeric ranges (we normalize in the extractor or in the model).
///
/// Mapping to spec:
/// State = command entropy, timing patterns, recon commands, privilege attempts,
///         lateral moves, credential access, exfil signals, dwell signals, etc.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RLFeatureVector {
    // === 1-6: Volume & Breadth (how much the attacker is doing) ===
    pub num_visited_decoys: f32,
    pub num_distinct_actions: f32,
    pub num_stolen_creds: f32,
    pub num_lateral_moves: f32,
    pub total_clock_ticks: f32,           // proxy for "engagement duration"
    pub actions_per_decoy_avg: f32,

    // === 7-12: Recon / Discovery intensity (very important for "sophistication") ===
    pub recon_command_count: f32,
    pub recon_diversity: f32,             // unique recon subtypes seen
    pub system_info_gathered: f32,        // whoami + hostname + systeminfo + uname etc.
    pub network_discovery_count: f32,     // netstat, ip, arp, nslookup, ss ...
    pub file_system_breadth: f32,         // /etc, /root, /home/*, /var, /opt, downloads

    // === 13-17: Privilege & Credential signals ===
    pub privilege_escalation_attempts: f32,
    pub credential_access_commands: f32,  // mimikatz, lsadump, cat /etc/shadow, etc.
    pub sudo_or_su_count: f32,
    pub creds_used_for_lateral: f32,
    pub sensitive_file_reads: f32,

    // === 18-21: Timing & Behavioral dynamics (dwell / burstiness) ===
    pub avg_inter_action_seconds: f32,    // lower = more automated / scripted
    pub action_burstiness: f32,           // variance in inter-command delta (high = human-like or careful)
    pub dwell_time_minutes_proxy: f32,
    pub session_pace_score: f32,          // actions / sqrt(dwell) or similar

    // === 22-25: Sophistication / TTP coverage + risk signals ===
    pub mitre_ttp_coverage: f32,          // count of distinct high-level tactics observed
    pub suspicious_tool_count: f32,       // bloodhound, crackmapexec, empire, impacket, etc.
    pub exfil_or_collection_signals: f32,
    pub fingerprint_risk_score: f32,      // high if attacker is doing things that look like "I know this is fake"

    /// 25th dimension (index 24): command entropy (Shannon over tokenized recent commands).
    /// Extremely valuable signal for "scripted/automated vs careful human attacker".
    /// The RL policy learns to treat very low or strangely high entropy differently.
    pub command_entropy: f32,
}

impl RLFeatureVector {
    /// Convert to fixed-size array in the exact order expected by the ONNX model.
    /// This array is what gets fed to `ort` inference (shape [1, 25]).
    pub fn to_array(&self) -> [f32; 25] {
        [
            self.num_visited_decoys,
            self.num_distinct_actions,
            self.num_stolen_creds,
            self.num_lateral_moves,
            self.total_clock_ticks,
            self.actions_per_decoy_avg,
            self.recon_command_count,
            self.recon_diversity,
            self.system_info_gathered,
            self.network_discovery_count,
            self.file_system_breadth,
            self.privilege_escalation_attempts,
            self.credential_access_commands,
            self.sudo_or_su_count,
            self.creds_used_for_lateral,
            self.sensitive_file_reads,
            self.avg_inter_action_seconds,
            self.action_burstiness,
            self.dwell_time_minutes_proxy,
            self.session_pace_score,
            self.mitre_ttp_coverage,
            self.suspicious_tool_count,
            self.exfil_or_collection_signals,
            self.fingerprint_risk_score,
            self.command_entropy, // 25th dimension — real Shannon entropy over attacker commands
        ]
    }

    /// Nice names in same order as to_array (for dashboard tables + feature importance viz).
    /// This list must stay in perfect sync with the Python Gym env observation space and the ONNX export.
    pub fn feature_names() -> &'static [&'static str] {
        &[
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
            "command_entropy",   // 25th — Shannon entropy over tokenized recent commands (key sophistication signal)
        ]
    }

    /// Return as HashMap for RLDecision.features (excellent for live JSON logging + React rendering).
    pub fn to_map(&self) -> HashMap<String, f32> {
        let names = Self::feature_names();
        let vals = self.to_array();
        names.iter().zip(vals.iter()).map(|(k, v)| (k.to_string(), *v)).collect()
    }
}
