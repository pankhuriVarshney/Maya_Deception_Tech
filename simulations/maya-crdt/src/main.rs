use std::env;
use maya_crdt::MayaState;

const STATE_FILE: &str = "/var/lib/.syscache";

fn main() {
    let args: Vec<String> = env::args().collect();
    let node_id = hostname::get()
        .unwrap()
        .to_string_lossy()
        .to_string();

    let mut state = MayaState::load(STATE_FILE, &node_id);

    match args.get(1).map(|s| s.as_str()) {

        Some("visit") => {
            // syslogd-helper visit attacker1 redis
            if let (Some(attacker), Some(decoy)) = (args.get(2), args.get(3)) {
                state.observe_visit(attacker, decoy);
                state.save(STATE_FILE);
            }
        }

        Some("action") => {
            // syslogd-helper action attacker1 redis "ran redis-cli"
            if let (Some(attacker), Some(decoy), Some(action)) =
                (args.get(2), args.get(3), args.get(4))
            {
                state.record_action(attacker, decoy, action);
                state.save(STATE_FILE);
            }
        }

        Some("move") => {
            // syslogd-helper move attacker1 mysql
            if let (Some(attacker), Some(location)) =
                (args.get(2), args.get(3))
            {
                state.update_location(attacker, location);
                state.save(STATE_FILE);
            }
        }

        Some("cred") => {
            // syslogd-helper cred root:password123
            if let Some(cred) = args.get(2) {
                state.add_cred(cred);
                state.save(STATE_FILE);
            }
        }

        Some("session") => {
            // syslogd-helper session redis sess_abc123
            if let (Some(host), Some(session)) =
                (args.get(2), args.get(3))
            {
                state.add_session(host, session);
                state.save(STATE_FILE);
            }
        }

        Some("merge") => {
            // syslogd-helper merge /tmp/remote.state
            if let Some(path) = args.get(2) {
                let remote = MayaState::load(path, &node_id);
                state.merge(remote);
                state.save(STATE_FILE);
            }
        }

        Some("show") => {
            state.print_summary();
        }

        _ => {
            println!("Commands:");
            println!("  visit <attacker> <decoy>");
            println!("  action <attacker> <decoy> <action>");
            println!("  move <attacker> <location>");
            println!("  cred <credential>");
            println!("  session <host> <session_id>");
            println!("  merge <path>");
            println!("  show");
        }
    }
}
