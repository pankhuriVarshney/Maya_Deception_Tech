// use std::env;
// use maya_crdt::MayaState;
// use std::thread;
// use std::time::Duration;
// use std::process::Command;
// use sha2::{Sha256, Digest};

// const STATE_FILE: &str = "/var/lib/.syscache";


// fn hash_file(path: &str) -> String {
//     let data = std::fs::read(path).unwrap_or_default();
//     let mut hasher = Sha256::new();
//     hasher.update(data);
//     format!("{:x}", hasher.finalize())
// }

// fn sync_with_peers(state_file: &str, last_hash: &mut String) {
//     let current_hash = hash_file(state_file);

//     // Only sync if state changed
//     if *last_hash == current_hash {
//         return;
//     }

//     *last_hash = current_hash;

//     let peers = std::fs::read_to_string("/etc/syslogd-helper/peers.conf");
//     if peers.is_err() {
//         return;
//     }

//     for peer in peers.unwrap().lines() {
//         if peer.trim().is_empty() {
//             continue;
//         }

//         // Push state
//         let _ = Command::new("scp")
//             .arg(state_file)
//             .arg(format!("{}:/tmp/maya.state", peer))
//             .output();

//         // Remote merge
//         let _ = Command::new("ssh")
//             .arg(peer)
//             .arg("sudo syslogd-helper merge /tmp/maya.state")
//             .output();
//     }
// }

// fn detect_attacker_id() -> String {
//     // Try SSH_CONNECTION first
//     if let Ok(conn) = std::env::var("SSH_CONNECTION") {
//         if let Some(ip) = conn.split_whitespace().next() {
//             return ip.to_string();
//         }
//     }

//     // Fallback: SSH_CLIENT
//     if let Ok(client) = std::env::var("SSH_CLIENT") {
//         if let Some(ip) = client.split_whitespace().next() {
//             return ip.to_string();
//         }
//     }

//     // Final fallback (manual/debug mode)
//     "unknown".to_string()
// }


// fn main() {
//     let args: Vec<String> = env::args().collect();
//     let node_id = hostname::get()
//         .unwrap()
//         .to_string_lossy()
//         .to_string();

//     let mut state = MayaState::load(STATE_FILE, &node_id);
//     let state_file = STATE_FILE.to_string();
//     let mut last_hash = state.hash();


//     match args.get(1).map(|s| s.as_str()) {

//         Some("visit") => {
//             if let Some(decoy) = args.get(2) {
//                 let attacker = detect_attacker_id();
//                 state.observe_visit(&attacker, decoy);
//                 state.save(STATE_FILE);
//             }
//         }


//         Some("action") => {
//             if let (Some(decoy), Some(action)) =
//                 (args.get(2), args.get(3))
//             {
//                 let attacker = detect_attacker_id();
//                 state.record_action(&attacker, decoy, action);
//                 state.save(STATE_FILE);
//             }
//         }


//         Some("move") => {
//             if let Some(location) = args.get(2) {
//                 let attacker = detect_attacker_id();
//                 state.update_location(&attacker, location);
//                 state.save(STATE_FILE);
//             }
//         }


//         Some("cred") => {
//             // syslogd-helper cred root:password123
//             if let Some(cred) = args.get(2) {
//                 state.add_cred(cred);
//                 state.save(STATE_FILE);
//             }
//         }

//         Some("session") => {
//             // syslogd-helper session redis sess_abc123
//             if let (Some(host), Some(session)) =
//                 (args.get(2), args.get(3))
//             {
//                 state.add_session(host, session);
//                 state.save(STATE_FILE);
//             }
//         }

//         Some("merge") => {
//             // syslogd-helper merge /tmp/remote.state
//             if let Some(path) = args.get(2) {
//                 let remote = MayaState::load(path, &node_id);
//                 state.merge(remote);
//                 state.save(STATE_FILE);
//             }
//         }

//         Some("daemon") => {
//             run_daemon(state);
//         }

//         Some("hash") => println!("{}", state.hash()),

//         Some("stats") => {
//             println!("===============================");
//             println!("Node: {}", state.node_id);
//             println!("Lamport Clock: {}", state.clock.counter);
//             println!("Attackers: {}", state.attackers.len());
//             println!("Credentials: {}", state.stolen_creds.elements().len());
//             println!("Sessions: {}", state.active_sessions.entries.len());

//             let total_decoys: usize = state.attackers
//                 .values()
//                 .map(|a| a.visited_decoys.elements.len())
//                 .sum();

//             println!("Decoys visited: {}", total_decoys);
//             println!("State hash: {}", state.hash());
//             println!("===============================");
//         }



//         Some("show") => {
//             state.print_summary();
//         }

//         None => {
//             println!("Usage: syslogd-helper <visit|show|stats|merge>");
//         }
//         _ => {
//             println!("Unknown command");
//         }

//     }
// }

// fn run_daemon(mut state: MayaState) {
//     let mut last_hash = state.hash();

//     loop {
//         sync_with_peers(STATE_FILE, &mut last_hash);

//         // existing SSH log code
//         if let Ok(log) = std::fs::read_to_string("/var/log/auth.log") {
//             for line in log.lines() {
//                 if line.contains("Accepted password") {
//                     if let Some(ip) = line.split_whitespace().nth(10) {
//                         state.observe_visit(ip, "ssh");
//                         state.update_location(ip, "ssh");
//                     }
//                 }
//             }
//         }

//         state.save(STATE_FILE);
//         thread::sleep(Duration::from_secs(10));
//     }
// }



use std::env;
use maya_crdt::MayaState;
use std::thread;
use std::time::Duration;
use std::process::Command;
use sha2::{Sha256, Digest};

const STATE_FILE: &str = "/var/lib/.syscache";

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
    let peers = std::fs::read_to_string("/etc/syslogd-helper/peers.conf");
    if peers.is_err() { return; }
    for peer in peers.unwrap().lines() {
        if peer.trim().is_empty() { continue; }
        let _ = Command::new("scp").arg(state_file).arg(format!("{}:/tmp/maya.state", peer)).output();
        let _ = Command::new("ssh").arg(peer).arg("sudo syslogd-helper merge /tmp/maya.state").output();
    }
}

fn detect_attacker_id() -> String {
    if let Ok(conn) = std::env::var("SSH_CONNECTION") {
        if let Some(ip) = conn.split_whitespace().next() { return ip.to_string(); }
    }
    if let Ok(client) = std::env::var("SSH_CLIENT") {
        if let Some(ip) = client.split_whitespace().next() { return ip.to_string(); }
    }
    "unknown".to_string()
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let node_id = hostname::get().unwrap().to_string_lossy().to_string();
    let mut state = MayaState::load(STATE_FILE, &node_id);
    let mut last_hash = state.hash();

    match args.get(1).map(|s| s.as_str()) {
        Some("visit") => {
            if let Some(decoy) = args.get(2) {
                let attacker = detect_attacker_id();
                state.observe_visit(&attacker, decoy);
                state.save(STATE_FILE);
            }
        }
        Some("action") => {
            if let (Some(decoy), Some(action)) = (args.get(2), args.get(3)) {
                let attacker = detect_attacker_id();
                state.record_action(&attacker, decoy, action);
                state.save(STATE_FILE);
            }
        }
        Some("move") => {
            if let Some(location) = args.get(2) {
                let attacker = detect_attacker_id();
                state.update_location(&attacker, location);
                state.save(STATE_FILE);
            }
        }
        Some("cred") => {
            if let Some(cred) = args.get(2) {
                state.add_cred(cred);
                state.save(STATE_FILE);
            }
        }
        Some("session") => {
            if let (Some(host), Some(session)) = (args.get(2), args.get(3)) {
                state.add_session(host, session);
                state.save(STATE_FILE);
            }
        }
        Some("merge") => {
            if let Some(path) = args.get(2) {
                let remote = MayaState::load(path, &node_id);
                state.merge(remote);
                state.save(STATE_FILE);
            }
        }
        Some("daemon") => { run_daemon(state); }
        Some("hash") => println!("{}", state.hash()),
        Some("stats") => {
            println!("===============================");
            println!("Node: {}", state.node_id);
            println!("Lamport Clock: {}", state.clock.counter);
            println!("Attackers: {}", state.attackers.len());
            println!("Credentials: {}", state.stolen_creds.elements().len());
            println!("Sessions: {}", state.active_sessions.entries.len());
            let total_decoys: usize = state.attackers.values().map(|a| a.visited_decoys.elements.len()).sum();
            println!("Decoys visited: {}", total_decoys);
            println!("State hash: {}", state.hash());
            println!("===============================");
        }
        Some("show") => { state.print_summary(); }
        None => { println!("Usage: syslogd-helper <visit|action|move|cred|session|merge|daemon|hash|stats|show>"); }
        _ => { println!("Unknown command"); }
    }
}

fn run_daemon(mut state: MayaState) {
    let mut last_hash = state.hash();
    loop {
        sync_with_peers(STATE_FILE, &mut last_hash);
        if let Ok(log) = std::fs::read_to_string("/var/log/auth.log") {
            for line in log.lines() {
                if line.contains("Accepted password") {
                    if let Some(ip) = line.split_whitespace().nth(10) {
                        state.observe_visit(ip, "ssh");
                        state.update_location(ip, "ssh");
                    }
                }
            }
        }
        state.save(STATE_FILE);
        thread::sleep(Duration::from_secs(10));
    }
}