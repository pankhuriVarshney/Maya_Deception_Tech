//! Reinforcement Learning Feature Extractor (Rust side)
//!
//! This module is the **core of Phase 2** but we provide a complete, production-grade
//! implementation already in Phase 1 so the rest of the pipeline can be built on top.
//!
//! Responsibilities:
//! - Load MayaState directly from the existing CRDT (via the path dependency on maya-crdt).
//! - For a specific attacker (IP), turn the CRDT view + supplementary logs into a
//!   fixed 25-dimensional feature vector (RLFeatureVector).
//! - Classify commands into behavioral categories (recon, priv-esc, credential access, lateral,
//!   collection, exfil, suspicious tools) using a lightweight port of the backend's
//!   commandPatterns.ts signatures. This gives us immediate MITRE signal without calling TS.
//! - Compute entropy, timing proxies, breadth metrics, and a "fingerprint risk" score.
//!
//! Design goals for hackathon:
//! - Zero false positives on feature extraction (conservative keyword lists).
//! - Explainable: every feature has a clear security meaning that maps to "why we escalated".
//! - Fast: <1ms per attacker even with hundreds of actions.
//! - Works with *today's* CRDT state (actions_per_decoy is last-write, visited GSet, etc.)
//!   while also being ready to consume richer per-command timed logs when we add them.
//!
//! Future enhancement (easy): add a "record_detailed_action(ip, decoy, cmd, timestamp, exit_code)"
//! to the CRDT lib. The extractor already has hooks for a command_history: Vec<(String, u64)>.

use crate::types::{DeceptionTier, RLFeatureVector};
use maya_crdt::MayaState;
use std::collections::{HashMap, HashSet};

/// Lightweight command taxonomy for feature extraction.
/// Mirrors (a strict subset of) backend/src/utils/commandPatterns.ts so the two systems stay in sync.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandCategory {
    Recon,
    PrivilegeEscalation,
    CredentialAccess,
    LateralMovement,
    Execution,
    Collection,
    Exfiltration,
    DefenseEvasion,
    SuspiciousTool,
    Other,
}

/// Static signatures (lowercase contains match). Expanded for Phase 2 with high-signal patterns
/// from backend/src/utils/commandPatterns.ts + real red team behavior.
/// Conservative to avoid false positives on benign admin work.
const RECON_KEYWORDS: &[&str] = &[
    "whoami", "id ", "uname", "hostname", "systeminfo", "cat /etc/os-release",
    "lsb_release", "cat /proc/", "netstat", "ss -", "ip addr", "ip link", "ip route",
    "arp -a", "route -n", "nslookup", "dig ", "host ", "ping ", "traceroute",
    "find /", "ls -la /", "ls /home", "ls /root", "cat /etc/passwd", "cat /etc/group",
    "cat /etc/hosts", "cat /etc/shadow", "getent", "last", "lastlog", "w ", "who ",
    "ps aux", "ps -ef", "top -b", "lsof", "netstat -an", "ss -tuln", "cat /etc/issue",
    "dmidecode", "lspci", "lscpu", "env", "printenv", "cat ~/.bash_history",
];

const PRIV_ESC_KEYWORDS: &[&str] = &[
    "sudo ", "sudo -l", "su -", "su root", "pkexec", "doas ", "setuid", "chmod u+s",
    "chown root", "passwd ", "usermod", "adduser", "useradd", "/etc/sudoers",
    "visudo", "kernel exploit", "dirtyc0w", "cve-20", "pwnkit", "sudoedit",
    "getcap ", "setcap ", "capsh", "newgrp ", "sg ",
];

const CRED_ACCESS_KEYWORDS: &[&str] = &[
    "mimikatz", "sekurlsa", "lsadump", "kerberos::", "dpapi::", "cred dump",
    "cat /etc/shadow", "cat /etc/gshadow", "samdump", "pwdump", "hashdump",
    "procdump", "lsass", "keychain", "security find-generic-password",
    "grep -i pass", "grep -i cred", "cat .ssh/id_", "cat ~/.aws/credentials",
    "cat ~/.config/gcloud/", "cat /root/.ssh/", "cat /etc/passwd | grep",
    "find / -name id_rsa 2>/dev/null", "cat /var/lib/cloud/instance",
];

const LATERAL_KEYWORDS: &[&str] = &[
    "ssh ", "scp ", "sftp ", "rsync ", "mstsc", "xfreerdp", "rdesktop",
    "psexec", "wmiexec", "smbexec", "crackmapexec", "impacket", "evil-winrm",
    "winrm ", "net use \\\\", "net view", "mount -t cifs", "sshpass",
    "ssh -i ", "scp -i ", "curl .* | bash", "wget .* | sh",
];

const SUSPICIOUS_TOOLS: &[&str] = &[
    "bloodhound", "sharphound", "neo4j", "crackmapexec", "impacket", "empire",
    "cobalt", "metasploit", "msfvenom", "sliver", "havoc", "brute", "hydra",
    "john ", "hashcat", "responder", "mitm6", "ntlmrelayx", "secretsdump",
    "rubeus", "certipy", "enum4linux", "ldapsearch", "gobuster", "ffuf ",
    "sqlmap", "nuclei", "linpeas", "linenum", "pspy", "chisel ", "frp ",
];

const EXFIL_COLLECTION: &[&str] = &[
    "tar ", "zip ", "7z ", "rar ", "base64 -w", "curl -F", "curl --upload",
    "wget --post", "nc -w", "socat", "python -m http.server", "scp .* root@",
    "aws s3 cp", "az storage", "gsutil cp", "exfil", "data.zip", "loot",
    "compress-archive", "Start-BitsTransfer",
];

const DEFENSE_EVASION: &[&str] = &[
    "history -c", "unset HISTFILE", "echo '' > ~/.bash_history",
    "kill -9", "pkill ", "rm -rf /var/log", "echo 0 > /proc/sys/kernel/randomize_va_space",
    "sysctl -w kernel.randomize_va_space=0",
];

/// Classify a single raw command string (as stored by syslogd-helper "action").
/// Phase 2: richer and aligned with the project's existing MITRE commandPatterns.
pub fn classify_command(cmd: &str) -> CommandCategory {
    let c = cmd.to_lowercase();

    // Order matters: more specific first
    if SUSPICIOUS_TOOLS.iter().any(|k| c.contains(k)) {
        return CommandCategory::SuspiciousTool;
    }
    if EXFIL_COLLECTION.iter().any(|k| c.contains(k)) {
        return CommandCategory::Exfiltration;
    }
    if DEFENSE_EVASION.iter().any(|k| c.contains(k)) {
        return CommandCategory::DefenseEvasion;
    }
    if CRED_ACCESS_KEYWORDS.iter().any(|k| c.contains(k)) {
        return CommandCategory::CredentialAccess;
    }
    if PRIV_ESC_KEYWORDS.iter().any(|k| c.contains(k)) {
        return CommandCategory::PrivilegeEscalation;
    }
    if LATERAL_KEYWORDS.iter().any(|k| c.contains(k)) {
        return CommandCategory::LateralMovement;
    }
    if RECON_KEYWORDS.iter().any(|k| c.contains(k)) {
        return CommandCategory::Recon;
    }
    if c.contains("powershell") || c.contains("cmd.exe") || c.contains("bash -c") || c.contains("sh -c") || c.contains("python -c") {
        return CommandCategory::Execution;
    }
    CommandCategory::Other
}

/// Compute Shannon entropy over the token distribution of the command list.
/// Good proxy for "how scripted vs how exploratory / human" the attacker is.
fn shannon_entropy(tokens: &[String]) -> f32 {
    if tokens.is_empty() {
        return 0.0;
    }
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for t in tokens {
        *counts.entry(t.as_str()).or_default() += 1;
    }
    let n = tokens.len() as f32;
    let mut h = 0.0f32;
    for &cnt in counts.values() {
        let p = cnt as f32 / n;
        if p > 0.0 {
            h -= p * p.log2();
        }
    }
    h
}

/// The main extractor. In real usage this runs inside the sidecar (or same process as a
/// future combined syslogd-helper + rl binary).
pub struct FeatureExtractor {
    /// Optional richer history we can feed when the hooks / CRDT are extended.
    /// For Phase 1 we primarily derive everything from MayaState + simple heuristics.
    pub command_history: HashMap<String, Vec<(String, u64)>>, // attacker_ip -> vec<(cmd, clock_tick)>
}

impl Default for FeatureExtractor {
    fn default() -> Self {
        Self {
            command_history: HashMap::new(),
        }
    }
}

impl FeatureExtractor {
    pub fn new() -> Self {
        Self::default()
    }

    /// Load state from the canonical CRDT location used by syslogd-helper.
    /// In a Kubernetes sidecar you would typically volume-mount the same path
    /// or have the CRDT process write to an emptyDir that this container also sees.
    pub fn load_state_from_disk(&self, path: &str, node_id: &str) -> anyhow::Result<MayaState> {
        Ok(MayaState::load(path, node_id))
    }

    /// Primary entry point for Phase 2.
    /// Produces a deterministic 25-dimensional feature vector from real CRDT state.
    ///
    /// Now (with the CRDT enhancement) heavily prefers `attacker.recent_commands` which contains
    /// (decoy, command, lamport_ts) tuples. This enables:
    /// - Real inter-command timing (using lamport deltas as proxy + wall clock if provided)
    /// - Proper Shannon entropy over the actual command stream the attacker typed
    /// - Sequence awareness (though we currently use counts + diversity for speed/simplicity)
    ///
    /// Falls back gracefully to the summarized LWWMap + global state when history is empty.
    pub fn extract_for_attacker(
        &mut self,
        state: &MayaState,
        attacker_ip: &str,
        current_tier: DeceptionTier,
        wall_clock_start: Option<chrono::DateTime<chrono::Utc>>,
    ) -> RLFeatureVector {
        let attacker = match state.attackers.get(attacker_ip) {
            Some(a) => a,
            None => return RLFeatureVector::default(),
        };

        // === 1. Volume & Breadth from core CRDT structures (always available) ===
        let visited: Vec<String> = attacker.visited_decoys.elements.iter().cloned().collect();
        let num_visited_decoys = visited.len() as f32;

        let last_actions: Vec<String> = attacker
            .actions_per_decoy
            .entries
            .values()
            .map(|(v, _, _)| v.clone())
            .collect();
        let num_distinct_actions = last_actions.len() as f32;

        let num_stolen_creds = state.stolen_creds.elements().len() as f32;

        // Lateral movement signal: distinct visited hosts is the strongest cheap signal we have
        let num_lateral_moves = (visited.len().saturating_sub(1)) as f32;

        let total_clock_ticks = state.clock.counter as f32;

        let actions_per_decoy_avg = if num_visited_decoys > 0.0 {
            num_distinct_actions / num_visited_decoys
        } else {
            0.0
        };

        // === 2. Rich command stream: prefer recent_commands (Phase 2 win), fall back to summarized ===
        let mut commands_with_ts: Vec<(String, u64)> = Vec::new(); // (cmd, ts)

        // Primary source after our lib.rs enhancement
        for (decoy, cmd, ts) in &attacker.recent_commands {
            commands_with_ts.push((cmd.clone(), *ts));
        }

        // Augment with any in-memory history we collected via integrate_command (log tailing etc.)
        if let Some(hist) = self.command_history.get(attacker_ip) {
            for (cmd, ts) in hist {
                commands_with_ts.push((cmd.clone(), *ts));
            }
        }

        // Fallback: at least use the last actions we have (no ts, so we synthesize increasing ts)
        if commands_with_ts.is_empty() {
            let mut synthetic_ts = total_clock_ticks as u64 - last_actions.len() as u64;
            for cmd in &last_actions {
                commands_with_ts.push((cmd.clone(), synthetic_ts));
                synthetic_ts += 1;
            }
        }

        // Dedup while preserving order (recent last)
        let mut seen = HashSet::new();
        commands_with_ts.retain(|(cmd, ts)| seen.insert((cmd.clone(), *ts)));

        let all_cmds: Vec<String> = commands_with_ts.iter().map(|(c, _)| c.clone()).collect();
        let num_cmds = all_cmds.len() as f32;

        // === 3. Command classification + counts (the heart of the 25 features) ===
        let mut recon = 0f32;
        let mut priv_esc = 0f32;
        let mut cred_acc = 0f32;
        let mut lateral = 0f32;
        let mut susp_tool = 0f32;
        let mut exfil = 0f32;
        let mut defense_evasion = 0f32;

        let mut file_breadth = 0f32;
        let mut net_disc = 0f32;
        let mut sys_info = 0f32;
        let mut sudo_count = 0f32;
        let mut sensitive_reads = 0f32;

        let mut recon_subtypes: HashSet<&'static str> = HashSet::new();

        for (cmd, _) in &commands_with_ts {
            let cat = classify_command(cmd);
            match cat {
                CommandCategory::Recon => {
                    recon += 1.0;
                    let cl = cmd.to_lowercase();
                    if cl.contains("whoami") || cl.contains("id ") { recon_subtypes.insert("id"); }
                    if cl.contains("netstat") || cl.contains("ss ") || cl.contains("ip ") || cl.contains("arp") { recon_subtypes.insert("net"); }
                    if cl.contains("ls ") || cl.contains("find ") || cl.contains("cat /") { recon_subtypes.insert("fs"); }
                    if cl.contains("cat /etc") || cl.contains("passwd") || cl.contains("shadow") { recon_subtypes.insert("etc"); }
                    if cl.contains("ps ") || cl.contains("top") { recon_subtypes.insert("proc"); }
                }
                CommandCategory::PrivilegeEscalation => priv_esc += 1.0,
                CommandCategory::CredentialAccess => cred_acc += 1.0,
                CommandCategory::LateralMovement => lateral += 1.0,
                CommandCategory::SuspiciousTool => susp_tool += 1.0,
                CommandCategory::Exfiltration => exfil += 1.0,
                CommandCategory::DefenseEvasion => defense_evasion += 1.0,
                _ => {}
            }

            let cl = cmd.to_lowercase();
            if cl.contains("sudo") || cl.contains("su ") { sudo_count += 1.0; }
            if cl.contains("/etc/") || cl.contains("/root") || cl.contains("/home/") || cl.contains("shadow") || cl.contains(".ssh") {
                file_breadth += 1.0;
            }
            if cl.contains("netstat") || cl.contains("ss -") || cl.contains("ip ") || cl.contains("arp") || cl.contains("nslookup") || cl.contains("dig ") {
                net_disc += 1.0;
            }
            if cl.contains("whoami") || cl.contains("hostname") || cl.contains("uname") || cl.contains("systeminfo") || cl.contains("cat /proc") {
                sys_info += 1.0;
            }
            if cl.contains("shadow") || cl.contains("passwd") || cl.contains("id_rsa") || cl.contains("authorized_keys") || cl.contains(".aws") || cl.contains("credentials") {
                sensitive_reads += 1.0;
            }
        }

        let recon_diversity = recon_subtypes.len() as f32;

        // === 4. Timing features using lamport timestamps (best data we have) ===
        // Compute deltas between consecutive commands for the same attacker.
        let mut inter_deltas: Vec<f32> = Vec::new();
        for w in commands_with_ts.windows(2) {
            let delta = (w[1].1 as f32 - w[0].1 as f32).max(0.5);
            inter_deltas.push(delta);
        }

        let avg_inter_action_seconds = if !inter_deltas.is_empty() {
            let sum: f32 = inter_deltas.iter().sum();
            (sum / inter_deltas.len() as f32).clamp(0.8, 180.0)
        } else {
            35.0
        };

        // Burstiness = coefficient of variation of inter-command time (high = human-like pauses or careful attacker)
        let burstiness = if inter_deltas.len() >= 3 {
            let mean = avg_inter_action_seconds;
            let var: f32 = inter_deltas.iter().map(|d| (d - mean).powi(2)).sum::<f32>() / inter_deltas.len() as f32;
            let std = var.sqrt();
            (std / mean.max(1.0)).min(4.0)
        } else {
            1.0
        };

        // Dwell proxy: prefer wall clock if the caller (sidecar) tracked login time.
        // Otherwise use lamport ticks scaled by average pace (rough but directionally correct).
        let dwell_time_minutes_proxy = if let Some(start) = wall_clock_start {
            ((chrono::Utc::now() - start).num_seconds() as f32 / 60.0).max(0.2)
        } else if num_cmds > 1.0 {
            (total_clock_ticks / 25.0).max(0.3) // ~25 ticks per real minute in busy sessions (tunable)
        } else {
            1.5
        };

        let session_pace_score = if dwell_time_minutes_proxy > 0.3 {
            num_cmds / dwell_time_minutes_proxy.sqrt()
        } else {
            num_cmds
        };

        // === 5. Entropy over the actual command stream (excellent "human vs scripted" signal) ===
        // We compute token entropy on the recent command list.
        let command_entropy = if !all_cmds.is_empty() {
            // Simple tokenization: split on whitespace + common separators
            let mut tokens: Vec<String> = Vec::new();
            for cmd in &all_cmds {
                for t in cmd.split_whitespace() {
                    let t = t.trim_matches(|c: char| !c.is_alphanumeric() && c != '-' && c != '_');
                    if !t.is_empty() && t.len() > 1 {
                        tokens.push(t.to_lowercase());
                    }
                }
            }
            shannon_entropy(&tokens)
        } else {
            0.0
        };

        // === 6. TTP coverage + fingerprint risk (the policy's "sophistication" and "danger" signals) ===
        let mut ttp_set: HashSet<&str> = HashSet::new();
        if recon > 1.5 { ttp_set.insert("recon"); }
        if priv_esc > 0.0 { ttp_set.insert("priv"); }
        if cred_acc > 0.0 { ttp_set.insert("cred"); }
        if lateral > 0.0 { ttp_set.insert("lateral"); }
        if exfil > 0.0 { ttp_set.insert("exfil"); }
        if susp_tool > 0.0 { ttp_set.insert("tool"); }
        if defense_evasion > 0.0 { ttp_set.insert("evasion"); }
        let mitre_ttp_coverage = ttp_set.len() as f32;

        // Fingerprint risk: attacker is doing things that are classic "I suspect this is a honeypot"
        let mut fp_risk = 0.0f32;
        for (cmd, _) in &commands_with_ts {
            let cl = cmd.to_lowercase();
            if cl.contains("cowrie") || cl.contains("conpot") || cl.contains("dionaea") || cl.contains("honeypot") || cl.contains("fake") {
                fp_risk += 4.0;
            }
            if cl.contains("dmidecode") || cl.contains("virtual") || cl.contains("vmware") || cl.contains("qemu") || cl.contains("kvm") || cl.contains("hypervisor") {
                fp_risk += 2.0;
            }
            if cl.contains(".git") || cl.contains(".env") || cl.contains("wp-config") || cl.contains("config.php") {
                fp_risk += 1.0;
            }
            if cl.contains("ps ") && (cl.contains("python") || cl.contains("cowrie")) {
                fp_risk += 1.5;
            }
        }
        let fingerprint_risk_score = fp_risk.min(12.0);

        // === 7. Assemble the exact 25-feature vector ===
        // Order is sacred — must match RLFeatureVector::to_array() and the ONNX model input.
        let mut fv = RLFeatureVector::default();

        fv.num_visited_decoys = num_visited_decoys;
        fv.num_distinct_actions = num_distinct_actions;
        fv.num_stolen_creds = num_stolen_creds;
        fv.num_lateral_moves = num_lateral_moves;
        fv.total_clock_ticks = total_clock_ticks;
        fv.actions_per_decoy_avg = actions_per_decoy_avg;

        fv.recon_command_count = recon;
        fv.recon_diversity = recon_diversity;
        fv.system_info_gathered = sys_info;
        fv.network_discovery_count = net_disc;
        fv.file_system_breadth = file_breadth;

        fv.privilege_escalation_attempts = priv_esc;
        fv.credential_access_commands = cred_acc;
        fv.sudo_or_su_count = sudo_count;
        fv.creds_used_for_lateral = if lateral > 0.5 && cred_acc > 0.0 { 1.0 } else { 0.0 };
        fv.sensitive_file_reads = sensitive_reads;

        fv.avg_inter_action_seconds = avg_inter_action_seconds;
        fv.action_burstiness = burstiness;
        fv.dwell_time_minutes_proxy = dwell_time_minutes_proxy;
        fv.session_pace_score = session_pace_score;

        fv.mitre_ttp_coverage = mitre_ttp_coverage;
        fv.suspicious_tool_count = susp_tool;
        fv.exfil_or_collection_signals = exfil;
        fv.fingerprint_risk_score = fingerprint_risk_score;

        // 25th dimension - command entropy (critical signal)
        fv.command_entropy = command_entropy.clamp(0.0, 8.0);

        // Clip outliers for stability
        fv.recon_command_count = fv.recon_command_count.min(35.0);
        fv.privilege_escalation_attempts = fv.privilege_escalation_attempts.min(12.0);
        fv.credential_access_commands = fv.credential_access_commands.min(10.0);
        fv.suspicious_tool_count = fv.suspicious_tool_count.min(6.0);

        fv
    }

    /// Helper you can call from the sidecar / daemon when you see a new command line
    /// (e.g. by tailing syslogd-helper.log or by enhancing the hooks to also write a
    /// structured command log). This makes features dramatically richer.
    pub fn integrate_command(&mut self, attacker_ip: &str, cmd: &str, clock_tick: u64) {
        self.command_history
            .entry(attacker_ip.to_string())
            .or_default()
            .push((cmd.to_string(), clock_tick));
        // Keep history bounded so we don't grow forever in a long demo
        let hist = self.command_history.get_mut(attacker_ip).unwrap();
        if hist.len() > 200 {
            let drain = hist.len() - 150;
            hist.drain(0..drain);
        }
    }

    /// Phase 2 bonus: parse the traditional syslogd-helper.log for "Command executed" or "action" lines.
    /// This gives the extractor access to history even on nodes that haven't had the recent_commands
    /// CRDT field for very long.
    ///
    /// Expected log lines look like:
    ///   [2026-...] Command executed: whoami
    ///   or lines containing "action <ip> <decoy> <cmd>"
    pub fn augment_from_syslogd_log(&mut self, attacker_ip: &str, log_path: &str) {
        let Ok(contents) = std::fs::read_to_string(log_path) else { return; };

        let mut tick = 1u64;
        for line in contents.lines().rev().take(300) { // recent lines only
            if line.contains("Command executed:") || line.contains("action ") {
                // crude but effective extraction for hackathon
                let cmd = if let Some(idx) = line.find("Command executed:") {
                    line[idx + "Command executed:".len()..].trim().to_string()
                } else if let Some(idx) = line.find("action ") {
                    // format often: ... action <ip> <decoy> <rest of line as command>
                    let rest = &line[idx + "action ".len()..];
                    let parts: Vec<&str> = rest.splitn(3, ' ').collect();
                    if parts.len() >= 3 { parts[2].trim().to_string() } else { rest.to_string() }
                } else {
                    continue;
                };

                if !cmd.is_empty() && cmd.len() < 200 {
                    self.integrate_command(attacker_ip, &cmd, tick);
                    tick += 1;
                }
            }
        }
    }

    /// Convenience: extract features for *all* currently known attackers.
    pub fn extract_all(
        &mut self,
        state: &MayaState,
        current_tier: DeceptionTier,
        wall_start: Option<chrono::DateTime<chrono::Utc>>,
    ) -> HashMap<String, RLFeatureVector> {
        let mut out = HashMap::new();
        for ip in state.attackers.keys() {
            let fv = self.extract_for_attacker(state, ip, current_tier, wall_start);
            out.insert(ip.clone(), fv);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use maya_crdt::MayaState;

    #[test]
    fn test_classify() {
        assert_eq!(classify_command("whoami"), CommandCategory::Recon);
        assert_eq!(classify_command("sudo -l"), CommandCategory::PrivilegeEscalation);
        assert_eq!(classify_command("mimikatz sekurlsa::logonpasswords"), CommandCategory::CredentialAccess);
        assert_eq!(classify_command("bloodhound"), CommandCategory::SuspiciousTool);
        assert_eq!(classify_command("tar czf loot.tar /etc"), CommandCategory::Exfiltration);
        assert_eq!(classify_command("history -c && unset HISTFILE"), CommandCategory::DefenseEvasion);
    }

    #[test]
    fn test_extract_25_features_from_realistic_crdt_state() {
        // Build a realistic attacker session using the enhanced CRDT structures
        let mut state = MayaState::new("test-decoy-01");
        let ip = "10.20.20.133";

        // Simulate a moderately sophisticated attacker
        state.observe_visit(ip, "fake-jump-01");
        state.record_action(ip, "fake-jump-01", "whoami");
        state.record_action(ip, "fake-jump-01", "id");
        state.record_action(ip, "fake-jump-01", "uname -a");
        state.record_action(ip, "fake-jump-01", "ls -la /home");
        state.record_action(ip, "fake-jump-01", "cat /etc/passwd");

        state.record_action(ip, "fake-web-01", "sudo -l");
        state.record_action(ip, "fake-web-01", "cat /etc/sudoers");
        state.record_action(ip, "fake-web-01", "netstat -an");

        state.record_action(ip, "fake-db-01", "ssh admin@10.20.20.40");
        state.record_action(ip, "fake-db-01", "mimikatz sekurlsa::logonpasswords");

        // The recent_commands vec is populated by record_action thanks to our lib.rs change
        assert!(!state.attackers.get(ip).unwrap().recent_commands.is_empty());

        let mut extractor = FeatureExtractor::new();
        let fv = extractor.extract_for_attacker(&state, ip, DeceptionTier::Med, None);

        let arr = fv.to_array();
        assert_eq!(arr.len(), 25, "Must be exactly 25 features for ONNX contract");

        // Sanity assertions (these should be clearly non-zero for the trace above)
        assert!(fv.recon_command_count >= 4.0, "should have seen several recon commands");
        assert!(fv.privilege_escalation_attempts >= 1.0);
        assert!(fv.credential_access_commands >= 1.0);
        assert!(fv.num_lateral_moves >= 1.0);
        assert!(fv.command_entropy > 0.5, "should have some entropy from varied commands");
        assert!(fv.mitre_ttp_coverage >= 3.0, "recon + priv + cred + lateral");

        // Print for manual verification during development / judge prep
        println!("=== Phase 2 Feature Extractor Test Output ===");
        for (name, val) in RLFeatureVector::feature_names().iter().zip(arr.iter()) {
            println!("  {:<28} = {:.2}", name, val);
        }
        println!("Dwell proxy minutes: {:.1}", fv.dwell_time_minutes_proxy);
        println!("Fingerprint risk:    {:.1}", fv.fingerprint_risk_score);
    }

    #[test]
    fn test_feature_names_match_array_length() {
        assert_eq!(RLFeatureVector::feature_names().len(), 25);
    }
}
