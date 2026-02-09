use std::collections::HashMap;
use chrono::Utc;
use serde::{Serialize, Deserialize};
use std::fs;
use std::io::{Read, Write};

#[derive(Serialize, Deserialize, Clone)]
pub struct Entry {
    pub ts: i64,
    pub node: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ORSet {
    pub node_id: String,
    pub entries: HashMap<String, Entry>,
}

impl ORSet {
    pub fn new(node_id: &str) -> Self {
        Self {
            node_id: node_id.to_string(),
            entries: HashMap::new(),
        }
    }

    pub fn observe(&mut self, key: &str) {
        self.entries.insert(
            key.to_string(),
            Entry {
                ts: Utc::now().timestamp(),
                node: self.node_id.clone(),
            },
        );
    }

    pub fn merge(&mut self, remote: ORSet) {
        for (k, v) in remote.entries {
            match self.entries.get(&k) {
                Some(local) if local.ts >= v.ts => {}
                _ => {
                    self.entries.insert(k, v);
                }
            }
        }
    }

    pub fn load(path: &str, node_id: &str) -> Self {
        if let Ok(mut file) = fs::File::open(path) {
            let mut data = String::new();
            if file.read_to_string(&mut data).is_ok() {
                if let Ok(set) = serde_json::from_str(&data) {
                    return set;
                }
            }
        }
        ORSet::new(node_id)
    }

    pub fn save(&self, path: &str) {
        if let Ok(json) = serde_json::to_string(self) {
            let _ = fs::File::create(path)
                .and_then(|mut f| f.write_all(json.as_bytes()));
        }
    }
}


