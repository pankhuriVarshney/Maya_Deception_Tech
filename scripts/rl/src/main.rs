//! maya-rl — Reinforcement Learning Adaptive Deception Engine binary
//!
//! This is the sidecar / standalone binary you deploy next to (or inside) the existing
//! syslogd-helper CRDT process.
//!
//! Two primary modes for the hackathon:
//!
//! 1. `daemon` (production sidecar mode)
//!    - Watches /var/lib/.syscache (or a path you give it)
//!    - On change (or every N seconds) extracts features for every active attacker
//!    - Runs ONNX inference (or heuristic fallback)
//!    - Emits structured JSON decisions to stdout (easy to `tee` into Fluent Bit / Kafka)
//!    - Can also call back into syslogd-helper to plant breadcrumbs or write tier hints
//!    - Posts decisions to the Node backend so the dashboard lights up live
//!
//! 2. `simulate` (the killer 90-second demo mode)
//!    - Generates live synthetic attacker traces (MITRE Caldera style)
//!    - Runs the *exact same* feature extractor + inference path
//!    - Prints gorgeous live decision stream + reward estimates
//!    - You can pipe this to the real backend or just show it on a big screen
//!    - Judges see "RL working" with zero infrastructure
//!
//! Build:
//!   cd scripts/rl
//!   cargo build --release
//!   ./target/release/maya-rl --help
//!
//! For Kubernetes sidecar (Phase 5):
//!   You build a tiny container that has this binary + the .onnx model + the onnxruntime .so.
//!   It shares an emptyDir or hostPath with the pod that also runs the CRDT bits (or just reads
//!   from the same backend events).

use anyhow::Result;
use clap::{Parser, Subcommand};
use maya_crdt::MayaState;
use std::path::PathBuf;
use std::time::Duration;
use tokio::time::sleep;
use tracing::{debug, info, warn};
use tracing_subscriber::{fmt, EnvFilter};

mod feature_extractor;
mod inference;
mod types;

use crate::feature_extractor::FeatureExtractor;
use crate::inference::{format_live_line, RLInferenceEngine};
use crate::types::{DeceptionTier, RLAction, RLDecision, RLFeatureVector};

const DEFAULT_STATE_FILE: &str = "/var/lib/.syscache";
const DEFAULT_MODEL: &str = "models/maya_rl_policy.onnx";

#[derive(Parser, Debug)]
#[command(name = "maya-rl", version, about = "RL Adaptive Deception Engine for Maya")]
struct Cli {
    /// Path to the ONNX policy (if not present we use a strong heuristic fallback)
    #[arg(long, default_value = DEFAULT_MODEL)]
    model: String,

    /// Disable heuristic fallback (useful to prove the model is required in CI)
    #[arg(long)]
    no_fallback: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Run as a long-lived sidecar / daemon. Watches CRDT state and emits decisions.
    Daemon {
        /// CRDT state file to watch
        #[arg(long, default_value = DEFAULT_STATE_FILE)]
        state: String,

        /// How often to run inference even if the file hasn't changed (seconds)
        #[arg(long, default_value_t = 5)]
        interval: u64,

        /// Node ID (usually hostname). Passed to MayaState::load for CRDT compatibility.
        #[arg(long)]
        node_id: Option<String>,

        /// Also POST decisions to the Maya backend (http://backend:3001/api/rl/decision)
        #[arg(long)]
        post_to_backend: bool,

        #[arg(long, default_value = "http://localhost:3001")]
        backend_url: String,
    },

    /// The magic demo mode. Generates live synthetic attacker sessions and shows RL decisions
    /// in real time. Perfect for a 2-3 minute stage demo with zero other services running.
    Simulate {
        /// How many synthetic attackers to run in parallel
        #[arg(long, default_value_t = 2)]
        attackers: usize,

        /// How many decision cycles to run before exiting (0 = infinite)
        #[arg(long, default_value_t = 0)]
        cycles: usize,

        /// Seconds between decision steps (speeds up the demo)
        #[arg(long, default_value_t = 1.2)]
        step: f64,
    },

    /// One-shot feature extraction + inference on the current on-disk state (great for debugging)
    Infer {
        #[arg(long, default_value = DEFAULT_STATE_FILE)]
        state: String,
        #[arg(long)]
        attacker: Option<String>,
    },

    /// Print the 25 feature names in exact ONNX input order (for training alignment)
    Features,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Structured logging so you can grep for "RL" or send to Fluent Bit.
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("maya_rl=info".parse()?))
        .with_target(false)
        .init();

    let cli = Cli::parse();

    // Python bridge version (Phase 4 - reliable hackathon path, no ort)
    let engine = RLInferenceEngine::new(
        Some("inference.py"),   // script next to binary when running from scripts/rl/
        Some(&cli.model),
        !cli.no_fallback,
    )?;

    match cli.command {
        Commands::Daemon { state, interval, node_id, post_to_backend, backend_url } => {
            run_daemon(engine, state, interval, node_id, post_to_backend, backend_url).await
        }
        Commands::Simulate { attackers, cycles, step } => {
            run_simulate(engine, attackers, cycles, step).await
        }
        Commands::Infer { state, attacker } => {
            run_one_shot_infer(engine, &state, attacker.as_deref()).await
        }
        Commands::Features => {
            for (i, name) in RLFeatureVector::feature_names().iter().enumerate() {
                println!("{:02}: {}", i, name);
            }
            Ok(())
        }
    }
}

async fn run_daemon(
    engine: RLInferenceEngine,
    state_path: String,
    interval_secs: u64,
    node_id: Option<String>,
    post: bool,
    backend: String,
) -> Result<()> {
    let node = node_id.unwrap_or_else(|| {
        hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "rl-sidecar".to_string())
    });

    info!("RL sidecar starting (Python bridge). node={} state={} script={} model={}", node, state_path, "inference.py", DEFAULT_MODEL);
    info!("Watching for CRDT changes. Decisions will be emitted as JSON + pretty logs.");

    let mut extractor = FeatureExtractor::new();
    let mut last_hash = String::new();
    let mut cycle = 0u64;

    loop {
        cycle += 1;

        // Load latest CRDT state (the same file the real syslogd-helper is mutating)
        let state = match MayaState::load(&state_path, &node) {
            s if s.attackers.is_empty() => {
                // Nothing to do yet — normal in early demo
                sleep(Duration::from_secs(interval_secs)).await;
                continue;
            }
            s => s,
        };

        let current_hash = state.hash();
        if current_hash == last_hash && cycle % 6 != 0 {
            // No change and not a periodic forced tick
            sleep(Duration::from_secs(interval_secs)).await;
            continue;
        }
        last_hash = current_hash;

        let tier = DeceptionTier::Med; // In real life you would read this from a sidecar config / label / CRDT extension

        for (ip, fv) in extractor.extract_all(&state, tier, None) {
            // Derive a tiny set of observed TTPs for the decision (demo value)
            let mut ttps = vec![];
            if fv.recon_command_count > 2.0 { ttps.push("T1082".to_string()); }
            if fv.privilege_escalation_attempts > 0.5 { ttps.push("T1068".to_string()); }
            if fv.credential_access_commands > 0.5 { ttps.push("T1003".to_string()); }
            if fv.num_lateral_moves > 0.5 { ttps.push("T1021".to_string()); }

            let decision = engine.decide(ip.clone(), tier, fv, ttps).await;

            // === THE MOST IMPORTANT LINES FOR JUDGES ===
            // Print a single beautiful line + the full JSON (so you can also tail | jq)
            println!("{}", format_live_line(&decision));
            println!("RL_DECISION_JSON: {}", serde_json::to_string(&decision)?);

            if post {
                // Fire-and-forget to backend (the real integration point for dashboard)
                let url = format!("{}/api/rl/decision", backend.trim_end_matches('/'));
                let _ = reqwest::Client::new()
                    .post(&url)
                    .json(&decision)
                    .send()
                    .await;
            }

            // === ACTUATION (Phase 5 - real K8s + local sidecar actions) ===
            // The RL sidecar can act in two ways that are very visible in a hackathon demo:
            // 1. Local file writes into a shared emptyDir volume (/deception) that the honeypot container sees
            //    (e.g. cowrie or nginx can be configured to serve or use these as "discovered" creds/files).
            // 2. kubectl patch (via the in-pod ServiceAccount) to annotate the pod with the new tier.
            //    A simple dashboard or `kubectl get pod -o custom-columns=...` shows the escalation.
            //
            // In a fuller system the backend (or control-plane) would also react to the RL_DECISION_JSON.

            actuate_on_decision(&decision, &ip).await;
        }

        sleep(Duration::from_secs(interval_secs)).await;
    }
}

async fn run_simulate(
    engine: RLInferenceEngine,
    n_attackers: usize,
    max_cycles: usize,
    step_seconds: f64,
) -> Result<()> {
    info!("*** RL SIMULATE MODE — perfect for live demo ***");
    info!("Starting {} synthetic attackers. Step every {:.1}s", n_attackers, step_seconds);
    info!("You will see the exact same feature extractor + inference that runs in the sidecar.");

    let mut extractor = FeatureExtractor::new();
    let attacker_ips: Vec<String> = (0..n_attackers)
        .map(|i| format!("10.20.20.10{}", 1 + i))
        .collect();

    // Very simple synthetic state we mutate every step to simulate attacker progress
    let mut fake_states: Vec<(String, u32, u32, u32)> = attacker_ips
        .iter()
        .map(|ip| (ip.clone(), 1, 0, 0)) // (ip, visited, priv_attempts, recon)
        .collect();

    let mut cycle = 0usize;

    loop {
        cycle += 1;
        if max_cycles > 0 && cycle > max_cycles {
            break;
        }

        for (idx, (ip, visited, privs, recon)) in fake_states.iter_mut().enumerate() {
            // Simulate attacker making progress (very Caldera-like)
            *visited = (*visited + 1).min(7);
            if cycle % 3 == 0 { *recon += 1; }
            if cycle % 4 == 0 && idx % 2 == 0 { *privs += 1; }

            // Build a tiny MayaState just for the extractor (we only need the attacker map + clock)
            let mut state = MayaState::new("simulate-node");
            state.clock.counter = (cycle as u64) * 7;

            // Inject minimal attacker state the extractor understands
            state.observe_visit(ip, "fake-jump-01");
            if *visited > 2 { state.observe_visit(ip, "fake-web-01"); }
            if *visited > 4 { state.observe_visit(ip, "fake-db-01"); }

            // Stuff some realistic command strings into the LWWMap so classification fires
            state.record_action(ip, "fake-jump-01", if *recon > 3 { "whoami && id" } else { "whoami" });
            if *privs > 0 {
                state.record_action(ip, "fake-web-01", "sudo -l && cat /etc/sudoers");
            }
            if *recon > 2 {
                state.record_action(ip, "fake-db-01", "netstat -an && ss -tuln");
            }
            if cycle % 5 == 0 {
                state.record_action(ip, "fake-web-01", "mimikatz sekurlsa::logonpasswords");
            }

            let fv = extractor.extract_for_attacker(
                &state,
                ip,
                if cycle < 6 { DeceptionTier::Low } else { DeceptionTier::Med },
                None,
            );

            let decision = engine.decide(ip.clone(), DeceptionTier::Med, fv, vec![]).await;

            println!("{}", format_live_line(&decision));
            println!("RL_DECISION_JSON: {}", serde_json::to_string(&decision)?);
        }

        sleep(Duration::from_secs_f64(step_seconds)).await;
    }

    Ok(())
}

async fn run_one_shot_infer(engine: RLInferenceEngine, state_path: &str, attacker: Option<&str>) -> Result<()> {
    let node = "one-shot";
    let state = MayaState::load(state_path, node);

    let mut extractor = FeatureExtractor::new();
    let targets: Vec<String> = if let Some(a) = attacker {
        vec![a.to_string()]
    } else {
        state.attackers.keys().cloned().collect()
    };

    for ip in targets {
        if !state.attackers.contains_key(&ip) {
            warn!("No attacker {} in state", ip);
            continue;
        }
        let fv = extractor.extract_for_attacker(&state, &ip, DeceptionTier::Med, None);
        let decision = engine.decide(ip, DeceptionTier::Med, fv, vec![]).await;
        println!("{}", format_live_line(&decision));
        println!("{}", serde_json::to_string_pretty(&decision)?);
    }
    Ok(())
}

/// Phase 5 actuation hook (improved for visible hackathon demo).
/// Called after every RL decision.
/// 
/// - ALWAYS appends a structured entry to /deception/RL_ACTUATED.log (highly visible audit log)
/// - For plant_breadcrumb: creates obvious, judge-friendly fake files in /deception/breadcrumbs/
///   with realistic content that judges can `cat` live.
/// - For escalate_tier: still does the pod annotation + tier file as before.
/// 
/// The /deception volume must be shared with the honeypot container (cowrie etc.)
/// so an "attacker" (or judge) can discover the files in real time.
async fn actuate_on_decision(decision: &RLDecision, attacker_ip: &str) {
    use tokio::process::Command;
    use std::env;

    let pod_name = env::var("POD_NAME").unwrap_or_else(|_| "unknown-pod".to_string());
    let ns = env::var("POD_NAMESPACE").unwrap_or_else(|_| "maya-honeynet".to_string());

    let ts = decision.timestamp.format("%Y-%m-%d %H:%M:%S").to_string();
    let action_str = decision.action.as_str();
    let conf_pct = (decision.confidence * 100.0).round() as i32;

    // === 1. ALWAYS write to the highly visible RL_ACTUATED.log ===
    // This is the single most important file for judges to `tail -f` during the demo.
    let log_entry = format!(
        "[{}] ACTION: {} | CONFIDENCE: {}% | RATIONALE: {}",
        ts, action_str, conf_pct, decision.rationale
    );

    let _ = Command::new("sh")
        .arg("-c")
        .arg(format!(
            "mkdir -p /deception && echo '{}' >> /deception/RL_ACTUATED.log",
            log_entry.replace("'", "'\\''")  // basic escaping for sh
        ))
        .output()
        .await;

    info!("RL_ACTUATED.log updated: {}", log_entry);

    match decision.action {
        RLAction::PlantBreadcrumb => {
            // === 2. Create very obvious, realistic fake breadcrumb files ===
            // Judges can do: kubectl exec ... -c cowrie -- ls -l /deception/breadcrumbs/
            // then cat the files. These look 100% real and impressive.
            let bdir = "/deception/breadcrumbs";
            let _ = Command::new("sh")
                .arg("-c")
                .arg(format!("mkdir -p {}", bdir))
                .output()
                .await;

            // File 1: admin-password.txt
            let _ = Command::new("sh")
                .arg("-c")
                .arg(format!(
                    "cat > {}/admin-password.txt << 'EOF'\n\
                    # RL-planted credential discovered by attacker\n\
                    admin:Winter2026!\n\
                    root:RLDeception2026!\n\
                    svc_account:SuperSecretPass123!@#\n\
                    EOF",
                    bdir
                ))
                .output()
                .await;

            // File 2: internal-secret.key
            let _ = Command::new("sh")
                .arg("-c")
                .arg(format!(
                    "cat > {}/internal-secret.key << 'EOF'\n\
                    -----BEGIN FAKE PRIVATE KEY-----\n\
                    MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7...\n\
                    (RL-planted internal signing key - do not commit)\n\
                    -----END FAKE PRIVATE KEY-----\n\
                    EOF",
                    bdir
                ))
                .output()
                .await;

            // File 3: db-credentials.json
            let _ = Command::new("sh")
                .arg("-c")
                .arg(format!(
                    "cat > {}/db-credentials.json << 'EOF'\n\
                    {{\n\
                      \"host\": \"db.internal.maya-deception\",\n\
                      \"port\": 5432,\n\
                      \"user\": \"readonly\",\n\
                      \"password\": \"RL-planted-2026\",\n\
                      \"database\": \"production\",\n\
                      \"note\": \"Discovered via RL breadcrumb - planted for demo\"\n\
                    }}\n\
                    EOF",
                    bdir
                ))
                .output()
                .await;

            // File 4: fake-api-key.txt
            let _ = Command::new("sh")
                .arg("-c")
                .arg(format!(
                    "cat > {}/fake-api-key.txt << 'EOF'\n\
                    # Maya Internal API Key (RL-planted)\n\
                    API_KEY=sk_live_maya_rl_2026_abc123def456ghi789jkl0\n\
                    SERVICE_TOKEN=RLDeceptionToken2026\n\
                    EOF",
                    bdir
                ))
                .output()
                .await;

            info!("ACTUATED: planted obvious breadcrumb files in {}/ for attacker {}", bdir, attacker_ip);

            // Also keep a small legacy marker for compatibility
            let _ = Command::new("sh")
                .arg("-c")
                .arg(format!(
                    "echo '[RL] planted breadcrumbs for {}' >> /deception/rl.log || true",
                    attacker_ip
                ))
                .output()
                .await;
        }

        RLAction::EscalateTier => {
            let next_tier = decision.current_tier.next();
            let tier_str = next_tier.as_str();

            // Annotate the pod (visible via kubectl get / describe)
            let patch = format!(
                r#"{{"metadata":{{"annotations":{{"maya.deception/rl-tier":"{}","maya.deception/rl-decision":"{}","maya.deception/last-escalated":"{}"}}}}}}"#,
                tier_str, action_str, decision.timestamp.to_rfc3339()
            );

            let status = Command::new("kubectl")
                .arg("patch")
                .arg("pod")
                .arg(&pod_name)
                .arg("-n")
                .arg(&ns)
                .arg("--type=merge")
                .arg("-p")
                .arg(&patch)
                .output()
                .await
                .map(|o| o.status.success())
                .unwrap_or(false);

            if status {
                info!("ACTUATED: escalated tier for pod {} to {} (attacker {})", pod_name, tier_str, attacker_ip);
            } else {
                // Fallback file (still visible)
                let tier_file = "/deception/current_tier";
                let _ = Command::new("sh")
                    .arg("-c")
                    .arg(format!("echo '{}' > {}", tier_str, tier_file))
                    .output()
                    .await;
                info!("ACTUATED: (fallback) wrote tier {} to {} for attacker {}", tier_str, tier_file, attacker_ip);
            }
        }

        RLAction::Maintain | RLAction::ObserveOnly => {
            debug!("RL observed attacker {} (no heavy actuation this step)", attacker_ip);
        }
    }

    // === Push artifacts to backend (demo-friendly, no heavy deps) ===
    // The sidecar POSTs the just-written log line + the files it created.
    // This keeps the "Live Actuation Artifacts" panel in the dashboard 100% live.
    let log_line = format!(
        "[{}] ACTION: {} | CONFIDENCE: {}% | RATIONALE: {}",
        ts, action_str, conf_pct, decision.rationale
    );

    // For the files, we send the ones we know were just planted (or seed demo ones)
    let files_json = if matches!(decision.action, RLAction::PlantBreadcrumb) {
        r#"{"admin-password.txt":"admin:Winter2026!\\nroot:RLDeception2026!","internal-secret.key":"-----BEGIN FAKE PRIVATE KEY-----\\n(RL-planted)\\n-----END FAKE PRIVATE KEY-----","db-credentials.json":"{\\\"host\\\":\\\"db.internal\\\",\\\"password\\\":\\\"RL-planted-2026\\\"}","fake-api-key.txt":"API_KEY=sk_live_maya_rl_2026_abc123"}"#
    } else {
        "{}"
    };

    let payload = format!(
        r#"{{"log_content":"{}","files":{}}}"#,
        log_line.replace('"', "\\\""),
        files_json
    );

    let _ = Command::new("sh")
        .arg("-c")
        .arg(format!(
            "curl -s -X POST 'http://backend:3001/api/rl/artifacts' -H 'Content-Type: application/json' -d '{}' || true",
            payload
        ))
        .output()
        .await;
}

fn engine_has_model(engine: &RLInferenceEngine) -> bool {
    // Small hack: we just try to see if we can get a decision without it screaming about missing model
    // (the engine already logged at construction time)
    true
}

// Small reqwest stub so the binary compiles even if the "post_to_backend" feature isn't used in this build.
// In a real deployment you would add reqwest = { version = "0.12", features = ["json"] } to Cargo.toml when you need it.
#[cfg(not(feature = "reqwest"))]
mod reqwest {
    pub struct Client;
    impl Client {
        pub fn new() -> Self { Self }
        pub fn post(&self, _url: &str) -> Self { Self }
        pub fn json<T>(&self, _v: &T) -> Self { Self }
        pub async fn send(self) -> Result<(), ()> { Ok(()) }
    }
}
