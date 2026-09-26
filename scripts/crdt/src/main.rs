// scripts/crdt/src/main.rs
use std::env;
use maya_crdt::MayaState;
use std::thread;
use std::time::Duration;
use std::process::Command;
use sha2::{Sha256, Digest};
use std::fs::OpenOptions;
use std::io::Write;

// Overridable via MAYA_STATE_FILE so this same binary can run inside a K8s
// pod (where /var/lib can't be safely replaced wholesale by an emptyDir
// mount -- it would shadow apt/dpkg/ssh state baked into the image) as well
// as on a Vagrant VM (where /var/lib/.syscache is just a normal file on the
// VM's own persistent disk, no volume gymnastics needed). Computed once via
// OnceLock so every call site can keep using a plain &str, unchanged.
fn state_file() -> &'static str {
    static STATE_FILE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    STATE_FILE.get_or_init(|| {
        std::env::var("MAYA_STATE_FILE").unwrap_or_else(|_| "/var/lib/.syscache".to_string())
    })
}
const LOG_FILE: &str = "/var/log/syslogd-helper.log";

// Simple logging function that writes to a file instead of stderr
fn log_to_file(message: &str) {
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(LOG_FILE) 
    {
        let _ = writeln!(file, "[{}] {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), message);
    }
}

fn hash_file(path: &str) -> String {
    let data = std::fs::read(path).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

fn sync_with_peers(state_file: &str, last_hash: &mut String) {
    let current_hash = hash_file(state_file);
    if *last_hash == current_hash { return; }
    *last_hash = current_hash;
    
    let peers_content = std::fs::read_to_string("/etc/syslogd-helper/peers.conf");
    if peers_content.is_err() { 
        log_to_file("No peers.conf file found");
        return; 
    }
    
    let peers = peers_content.unwrap();
    let mut successful_syncs = 0;
    let mut failed_syncs = 0;
    
    for peer in peers.lines() {
        let peer = peer.trim();
        if peer.is_empty() { continue; }
        
        log_to_file(&format!("Attempting to sync with peer: {}", peer));
        
        // Copy state file to peer - suppress all output
        let scp_result = Command::new("scp")
            .arg("-o")
            .arg("StrictHostKeyChecking=no")
            .arg("-o")
            .arg("ConnectTimeout=5")
            .arg("-o")
            .arg("LogLevel=QUIET")
            .arg(state_file)
            .arg(format!("root@{}:/tmp/maya.state", peer))
            .output();
        
        match scp_result {
            Ok(output) if output.status.success() => {
                log_to_file(&format!("SCP to {} successful", peer));
                
                // Trigger merge on peer - suppress all output
                let merge_result = Command::new("ssh")
                    .arg("-o")
                    .arg("StrictHostKeyChecking=no")
                    .arg("-o")
                    .arg("ConnectTimeout=5")
                    .arg("-o")
                    .arg("LogLevel=QUIET")
                    .arg(format!("root@{}", peer))
                    .arg("sudo /usr/local/bin/syslogd-helper merge /tmp/maya.state && sudo rm /tmp/maya.state")
                    .output();
                
                match merge_result {
                    Ok(merge_output) if merge_output.status.success() => {
                        log_to_file(&format!("Merge on {} successful", peer));
                        successful_syncs += 1;
                    },
                    Ok(merge_output) => {
                        let stderr = String::from_utf8_lossy(&merge_output.stderr);
                        log_to_file(&format!("Merge failed on {}: {}", peer, stderr));
                        failed_syncs += 1;
                    },
                    Err(e) => {
                        log_to_file(&format!("Merge command failed for {}: {}", peer, e));
                        failed_syncs += 1;
                    }
                }
            },
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                log_to_file(&format!("SCP failed to {}: {}", peer, stderr));
                failed_syncs += 1;
            },
            Err(e) => {
                log_to_file(&format!("SCP command failed for {}: {}", peer, e));
                failed_syncs += 1;
            }
        }
    }
    
    log_to_file(&format!("Sync cycle complete: {} successful, {} failed", successful_syncs, failed_syncs));
}

fn state_dir() -> String {
    std::path::Path::new(state_file())
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string())
}

fn audit_log_path() -> String {
    format!("{}/.audit.jsonl", state_dir())
}

// K8s decoys have no rsyslog/auth.log -- their entrypoint.sh redirects
// sshd's own `-e` stderr debug stream into this file on the same shared
// volume instead (see maya-k8s/docker/jump/entrypoint.sh and the
// supervisord.conf stderr_logfile overrides for ftp/redis/web). Vagrant
// VMs still have a real /var/log/auth.log, so prefer whichever exists.
fn sshd_log_path() -> String {
    let shared = format!("{}/.sshd_auth.log", state_dir());
    if std::path::Path::new(&shared).exists() {
        shared
    } else {
        "/var/log/auth.log".to_string()
    }
}

fn extract_ip(line: &str) -> Option<String> {
    line.split_whitespace()
        .find(|part| part.parse::<std::net::Ipv4Addr>().is_ok())
        .map(|s| s.to_string())
}

fn extract_user_after<'a>(line: &'a str, marker: &str) -> Option<&'a str> {
    let idx = line.find(marker)?;
    line[idx + marker.len()..].split_whitespace().next()
}

// Ground-truth per-command/session detail from a K8s decoy's ForceCommand
// wrapper and interactive-session bashrc hook (maya-k8s/docker/common/) --
// both just append plain JSON lines here, since the decoy container never
// has this binary or any CRDT logic available to an attacker with a shell
// in it (see maya-k8s/docker/crdt-sync/Dockerfile's security rationale).
// No-op if the file doesn't exist -- the Vagrant path is unaffected.
fn process_audit_log(state: &mut MayaState) {
    let path = audit_log_path();
    let Ok(contents) = std::fs::read_to_string(&path) else { return };
    if contents.trim().is_empty() { return; }

    for line in contents.lines() {
        let Ok(event) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let attacker_ip = event.get("attacker_ip").and_then(|v| v.as_str()).unwrap_or("unknown");
        let decoy = event.get("decoy").and_then(|v| v.as_str()).unwrap_or("unknown");
        match event.get("kind").and_then(|v| v.as_str()) {
            Some("session") => {
                let session_id = event.get("session_id").and_then(|v| v.as_str()).unwrap_or("unknown");
                state.observe_visit(attacker_ip, decoy);
                state.add_session(decoy, session_id);
            }
            Some("action") => {
                if let Some(action) = event.get("action").and_then(|v| v.as_str()) {
                    let wall_ts = event.get("ts").and_then(|v| v.as_str());
                    state.record_action(attacker_ip, decoy, action, wall_ts);
                }
            }
            _ => {}
        }
    }

    // Consumed, not a growing log -- each line is a real event, replaying
    // the same line on the next cycle would double-count it. Deleting
    // (not truncating in place) on purpose: the wrapper/bashrc hook that
    // creates this file runs as the decoy's own login user, not this
    // daemon's user, so this process may only have GROUP write access via
    // fsGroup -- which covers unlinking a file from a shared directory,
    // but not necessarily overwriting the content of a file it doesn't
    // own. The next append just recreates the file fresh. Logged, not
    // silently swallowed, so a permission regression like this shows up
    // immediately instead of quietly reprocessing the same lines forever.
    if let Err(e) = std::fs::remove_file(&path) {
        log_to_file(&format!("Failed to remove processed audit log {}: {} -- falling back to truncate", path, e));
        if let Err(e2) = std::fs::write(&path, "") {
            log_to_file(&format!("Truncate fallback for {} also failed: {} -- audit lines will be reprocessed next cycle", path, e2));
        }
    }
}

// Successful/failed SSH auth attempts. Real sshd never exposes the
// attempted password itself to userspace, so this only ever gives us
// attacker IPs (any attempt, successful or not) and, for a *successful*
// login, the username used (recorded as a credential). That's an honest,
// disclosed asymmetry vs Cowrie's full clear-text capture (see
// docs/STATUS.md), not a bug -- fixing it would mean a custom PAM module
// or replacing sshd with a fake server entirely.
fn process_sshd_log(state: &mut MayaState) {
    let path = sshd_log_path();
    let Ok(contents) = std::fs::read_to_string(&path) else { return };

    for line in contents.lines() {
        let is_accepted = line.contains("Accepted password") || line.contains("Accepted publickey");
        let is_failed = line.contains("Failed password") || line.contains("Invalid user");
        if !is_accepted && !is_failed { continue; }

        let Some(ip) = extract_ip(line) else { continue };
        // Guard, not a truncate -- this log isn't consumed like the audit
        // one (Vagrant's real auth.log shouldn't be truncated), so dedupe
        // by checking whether we've already recorded this attacker/cred.
        if !state.attackers.contains_key(&ip) {
            state.observe_visit(&ip, "ssh");
            state.update_location(&ip, "ssh");
        }

        if is_accepted {
            let user = extract_user_after(line, "Accepted password for ")
                .or_else(|| extract_user_after(line, "Accepted publickey for "));
            if let Some(user) = user {
                if !state.stolen_creds.elements().contains(user) {
                    state.add_cred(user);
                }
            }
        }
    }
}

fn detect_attacker_id() -> String {
    // Try SSH_CONNECTION first
    if let Ok(conn) = std::env::var("SSH_CONNECTION") {
        if let Some(ip) = conn.split_whitespace().next() {
            return ip.to_string();
        }
    }
    
    // Try SSH_CLIENT
    if let Ok(client) = std::env::var("SSH_CLIENT") {
        if let Some(ip) = client.split_whitespace().next() {
            return ip.to_string();
        }
    }
    
    // Try to get IP from auth.log as fallback
    if let Ok(log) = std::fs::read_to_string("/var/log/auth.log") {
        for line in log.lines().rev().take(20) {
            if line.contains("Accepted") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                for part in &parts {
                    if part.contains('.') && part.parse::<std::net::Ipv4Addr>().is_ok() {
                        return part.to_string();
                    }
                }
            }
        }
    }
    
    "unknown".to_string()
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let node_id = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    
    let mut state = MayaState::load(state_file(), &node_id);

    match args.get(1).map(|s| s.as_str()) {
        Some("visit") => {
            if let (Some(attacker_ip), Some(decoy)) = (args.get(2), args.get(3)) {
                state.observe_visit(attacker_ip, decoy);
                state.save(state_file());
                // Only print to stdout for direct commands, not for daemon
                println!("Recorded visit: attacker={} decoy={}", attacker_ip, decoy);
            } else if let Some(decoy) = args.get(2) {
                let attacker = detect_attacker_id();
                eprintln!("WARNING: Using auto-detected attacker IP: {}", attacker);
                state.observe_visit(&attacker, decoy);
                state.save(state_file());
            }
        }
        
        Some("action") => {
            if let (Some(attacker_ip), Some(decoy), Some(action)) = (args.get(2), args.get(3), args.get(4)) {
                state.record_action(attacker_ip, decoy, action, None);
                state.save(state_file());
                println!("Recorded action: attacker={} decoy={} action={}", attacker_ip, decoy, action);
            } else if let (Some(decoy), Some(action)) = (args.get(2), args.get(3)) {
                let attacker = detect_attacker_id();
                eprintln!("WARNING: Using auto-detected attacker IP: {}", attacker);
                state.record_action(&attacker, decoy, action, None);
                state.save(state_file());
            }
        }
        
        Some("move") => {
            if let (Some(attacker_ip), Some(location)) = (args.get(2), args.get(3)) {
                state.update_location(attacker_ip, location);
                state.save(state_file());
                println!("Recorded move: attacker={} location={}", attacker_ip, location);
            } else if let Some(location) = args.get(2) {
                let attacker = detect_attacker_id();
                eprintln!("WARNING: Using auto-detected attacker IP: {}", attacker);
                state.update_location(&attacker, location);
                state.save(state_file());
            }
        }
        
        Some("cred") => {
            if let Some(cred) = args.get(2) {
                state.add_cred(cred);
                state.save(state_file());
                println!("Recorded credential: {}", cred);
            }
        }
        
        Some("session") => {
            if let (Some(host), Some(session)) = (args.get(2), args.get(3)) {
                state.add_session(host, session);
                state.save(state_file());
                println!("Recorded session: {} -> {}", host, session);
            }
        }
        
        Some("merge") => {
            if let Some(path) = args.get(2) {
                let remote = MayaState::load(path, &node_id);
                let before_hash = state.hash();
                state.merge(remote);
                state.save(state_file());
                let after_hash = state.hash();
                println!("Merge complete: {} -> {}", before_hash, after_hash);
            }
        }
        
        Some("daemon") => { 
            // Redirect all output to log file
            run_daemon(state); 
        }
        
        Some("hash") => println!("{}", state.hash()),
        
        Some("stats") => {
            println!("===============================");
            println!("Node: {}", state.node_id);
            println!("Lamport Clock: {}", state.clock.counter);
            println!("Attackers: {}", state.attackers.len());
            println!("Credentials: {}", state.stolen_creds.elements().len());
            println!("Sessions: {}", state.active_sessions.elements.len());
            let total_decoys: usize = state.attackers.values().map(|a| a.visited_decoys.elements.len()).sum();
            println!("Decoys visited: {}", total_decoys);
            println!("State hash: {}", state.hash());
            println!("===============================");
            
            if !state.attackers.is_empty() {
                println!("\nTracked Attackers:");
                for (ip, attacker) in &state.attackers {
                    println!("  - IP: {} | Visited: {} decoys", 
                        ip, 
                        attacker.visited_decoys.elements.len()
                    );
                }
            }
        }
        
        Some("show") => { 
            state.print_summary(); 
        }
        
        Some("check-peers") => {
            if let Ok(peers) = std::fs::read_to_string("/etc/syslogd-helper/peers.conf") {
                println!("Peers configured:");
                for peer in peers.lines() {
                    let peer = peer.trim();
                    if !peer.is_empty() {
                        // Test connectivity
                        let test = Command::new("ssh")
                            .arg("-o")
                            .arg("ConnectTimeout=2")
                            .arg("-o")
                            .arg("StrictHostKeyChecking=no")
                            .arg("-o")
                            .arg("LogLevel=QUIET")
                            .arg(format!("root@{}", peer))
                            .arg("echo 'OK' 2>/dev/null")
                            .output();
                        
                        match test {
                            Ok(output) if output.status.success() => {
                                println!("  ✅ {} - reachable", peer);
                            },
                            _ => {
                                println!("  ❌ {} - unreachable", peer);
                            }
                        }
                    }
                }
            } else {
                println!("No peers.conf file found");
            }
        }
        
        None => { 
            println!("Usage: syslogd-helper <visit|action|move|cred|session|merge|daemon|hash|stats|show|check-peers>"); 
        }
        
        _ => { 
            println!("Unknown command: {}", args[1]); 
        }
    }
}

fn run_daemon(mut state: MayaState) {
    let mut last_hash = hash_file(state_file());
    let mut cycle_count = 0;

    log_to_file(&format!("Starting CRDT daemon on {}", state.node_id));

    loop {
        cycle_count += 1;
        log_to_file(&format!("Sync cycle {} starting...", cycle_count));

        // 🔥 1. ALWAYS reload latest state from disk
        state = MayaState::load(state_file(), &state.node_id);

        // 🔥 2. Sync if file changed
        sync_with_peers(state_file(), &mut last_hash);

        // 🔥 3. Reload again in case merge modified file
        state = MayaState::load(state_file(), &state.node_id);

        // 🔥 4. K8s decoys: ForceCommand/interactive-session audit events
        process_audit_log(&mut state);

        // 🔥 5. SSH auth attempts (K8s redirected sshd log, or Vagrant's real auth.log)
        process_sshd_log(&mut state);

        // 🔥 6. Save only if we actually changed state
        state.save(state_file());

        // 🔥 7. Update hash AFTER save
        last_hash = hash_file(state_file());

        log_to_file(&format!(
            "Sync cycle {} complete. Current attackers: {}",
            cycle_count,
            state.attackers.len()
        ));

        thread::sleep(Duration::from_secs(30));
    }
}