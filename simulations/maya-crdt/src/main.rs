use std::env;
use maya_crdt::ORSet;

const STATE_FILE: &str = "/var/lib/.syscache";

fn main() {
    let args: Vec<String> = env::args().collect();
    let node_id = hostname::get().unwrap().to_string_lossy().to_string();

    let mut set = ORSet::load(STATE_FILE, &node_id);

    match args.get(1).map(|s| s.as_str()) {
        Some("observe") => {
            if let Some(val) = args.get(2) {
                set.observe(val);
                set.save(STATE_FILE);
            }
        }
        Some("merge") => {
            if let Some(path) = args.get(2) {
                let remote = ORSet::load(path, &node_id);
                set.merge(remote);
                set.save(STATE_FILE);
            }
        }
        _ => {}
    }
}
