// use serde::{Serialize, Deserialize};
// use std::collections::{HashMap, HashSet};
// use std::fs;
// use std::io::{Read, Write};

// //
// // --------------------
// // Lamport Clock
// // --------------------
// //

// #[derive(Serialize, Deserialize, Clone)]
// pub struct LamportClock {
//     pub counter: u64,
//     pub node_id: String,
// }

// impl LamportClock {
//     pub fn new(node_id: &str) -> Self {
//         Self {
//             counter: 0,
//             node_id: node_id.to_string(),
//         }
//     }

//     pub fn tick(&mut self) -> u64 {
//         self.counter += 1;
//         self.counter
//     }

//     pub fn merge(&mut self, remote: &LamportClock) {
//         self.counter = std::cmp::max(self.counter, remote.counter) + 1;
//     }
// }

// //
// // --------------------
// // G-Set (Grow-only Set)
// // --------------------
// //

// #[derive(Serialize, Deserialize, Clone)]
// pub struct GSet<T>
// where
//     T: std::hash::Hash + Eq,
// {
//     pub elements: HashSet<T>,
// }


// impl<T: std::hash::Hash + Eq + Clone> GSet<T> {
//     pub fn new() -> Self {
//         Self {
//             elements: HashSet::new(),
//         }
//     }

//     pub fn add(&mut self, value: T) {
//         self.elements.insert(value);
//     }

//     pub fn merge(&mut self, other: GSet<T>) {
//         for v in other.elements {
//             self.elements.insert(v);
//         }
//     }
// }

// //
// // --------------------
// // AWOR-Set
// // --------------------
// //

// #[derive(Serialize, Deserialize, Clone)]
// pub struct AWORSet<T>
// where
//     T: std::hash::Hash + Eq,
// {
//     pub adds: HashMap<T, HashSet<(String, u64)>>, // value -> unique tags
//     pub removes: HashSet<(String, u64)>,
// }

// impl<T: std::hash::Hash + Eq + Clone> AWORSet<T> {
//     pub fn new() -> Self {
//         Self {
//             adds: HashMap::new(),
//             removes: HashSet::new(),
//         }
//     }

//     pub fn add(&mut self, value: T, tag: (String, u64)) {
//         self.adds.entry(value).or_insert_with(HashSet::new).insert(tag);
//     }

//     pub fn remove(&mut self, value: &T) {
//         if let Some(tags) = self.adds.get(value) {
//             for tag in tags {
//                 self.removes.insert(tag.clone());
//             }
//         }
//     }

//     pub fn merge(&mut self, other: AWORSet<T>) {
//         for (val, tags) in other.adds {
//             self.adds.entry(val).or_insert_with(HashSet::new).extend(tags);
//         }
//         self.removes.extend(other.removes);
//     }

//     pub fn elements(&self) -> HashSet<T> {
//         let mut result = HashSet::new();
//         for (val, tags) in &self.adds {
//             if tags.iter().any(|t| !self.removes.contains(t)) {
//                 result.insert(val.clone());
//             }
//         }
//         result
//     }
// }

// //
// // --------------------
// // LWW Register
// // --------------------
// //

// #[derive(Serialize, Deserialize, Clone)]
// pub struct LWWRegister<T> {
//     pub value: Option<T>,
//     pub ts: u64,
//     pub node: String,
// }

// impl<T: Clone> LWWRegister<T> {
//     pub fn new() -> Self {
//         Self {
//             value: None,
//             ts: 0,
//             node: String::new(),
//         }
//     }

//     pub fn set(&mut self, value: T, ts: u64, node: String) {
//         self.value = Some(value);
//         self.ts = ts;
//         self.node = node;
//     }

//     pub fn merge(&mut self, other: LWWRegister<T>) {
//         if other.ts > self.ts ||
//             (other.ts == self.ts && other.node > self.node)
//         {
//             *self = other;
//         }
//     }
// }

// //
// // --------------------
// // LWW Map
// // --------------------
// //

// #[derive(Serialize, Deserialize, Clone)]
// pub struct LWWMap<K, V>
// where
//     K: std::hash::Hash + Eq,
// {
//     pub entries: HashMap<K, (V, u64, String)>,
// }

// impl<K: std::hash::Hash + Eq + Clone, V: Clone> LWWMap<K, V> {
//     pub fn new() -> Self {
//         Self {
//             entries: HashMap::new(),
//         }
//     }

//     pub fn insert(&mut self, key: K, value: V, ts: u64, node: String) {
//         self.entries.insert(key, (value, ts, node));
//     }

//     pub fn merge(&mut self, other: LWWMap<K, V>) {
//         for (k, (v, ts, node)) in other.entries {
//             match self.entries.get(&k) {
//                 Some((_, local_ts, local_node))
//                     if *local_ts > ts ||
//                        (*local_ts == ts && *local_node > node) => {}
//                 _ => {
//                     self.entries.insert(k, (v, ts, node));
//                 }
//             }
//         }
//     }
// }

// //
// // --------------------
// // Attacker State
// // --------------------
// //

// #[derive(Serialize, Deserialize, Clone)]
// pub struct AttackerState {
//     pub visited_decoys: GSet<String>,               // history
//     pub actions_per_decoy: LWWMap<String, String>, // decoy -> action
//     pub location: LWWRegister<String>,             // current location
// }

// impl AttackerState {
//     pub fn new() -> Self {
//         Self {
//             visited_decoys: GSet::new(),
//             actions_per_decoy: LWWMap::new(),
//             location: LWWRegister::new(),
//         }
//     }

//     pub fn merge(&mut self, other: AttackerState) {
//         self.visited_decoys.merge(other.visited_decoys);
//         self.actions_per_decoy.merge(other.actions_per_decoy);
//         self.location.merge(other.location);
//     }
// }

// //
// // --------------------
// // Global Maya State
// // --------------------
// //

// #[derive(Serialize, Deserialize, Clone)]
// pub struct MayaState {
//     pub node_id: String,
//     pub clock: LamportClock,

//     pub attackers: HashMap<String, AttackerState>, // attacker_id -> state
//     pub stolen_creds: AWORSet<String>,
//     pub active_sessions: LWWMap<String, String>, // host -> session_id
// }

// impl MayaState {
//     pub fn new(node_id: &str) -> Self {
//         Self {
//             node_id: node_id.to_string(),
//             clock: LamportClock::new(node_id),
//             attackers: HashMap::new(),
//             stolen_creds: AWORSet::new(),
//             active_sessions: LWWMap::new(),
//         }
//     }

//     fn ensure_attacker(&mut self, attacker_id: &str) {
//         self.attackers
//             .entry(attacker_id.to_string())
//             .or_insert_with(AttackerState::new);
//     }

//     pub fn observe_visit(&mut self, attacker_id: &str, decoy: &str) {
//         self.ensure_attacker(attacker_id);
//         self.clock.tick();   // ← ADD THIS
//         self.attackers
//             .get_mut(attacker_id)
//             .unwrap()
//             .visited_decoys
//             .add(decoy.to_string());
//     }


//     pub fn record_action(&mut self, attacker_id: &str, decoy: &str, action: &str) {
//         self.ensure_attacker(attacker_id);
//         let ts = self.clock.tick();
//         self.attackers
//             .get_mut(attacker_id)
//             .unwrap()
//             .actions_per_decoy
//             .insert(decoy.to_string(), action.to_string(), ts, self.node_id.clone());
//     }

//     pub fn update_location(&mut self, attacker_id: &str, location: &str) {
//         self.ensure_attacker(attacker_id);
//         let ts = self.clock.tick();
//         self.attackers
//             .get_mut(attacker_id)
//             .unwrap()
//             .location
//             .set(location.to_string(), ts, self.node_id.clone());
//     }

//     pub fn add_cred(&mut self, cred: &str) {
//         let ts = self.clock.tick();
//         self.stolen_creds
//             .add(cred.to_string(), (self.node_id.clone(), ts));
//     }

//     pub fn add_session(&mut self, host: &str, session_id: &str) {
//         let ts = self.clock.tick();
//         self.active_sessions.insert(
//             host.to_string(),
//             session_id.to_string(),
//             ts,
//             self.node_id.clone(),
//         );
//     }

//     pub fn merge(&mut self, mut remote: MayaState) {
//         self.clock.merge(&remote.clock);

//         for (id, remote_attacker) in remote.attackers.drain() {
//             self.attackers
//                 .entry(id)
//                 .or_insert_with(AttackerState::new)
//                 .merge(remote_attacker);
//         }

//         self.stolen_creds.merge(remote.stolen_creds);
//         self.active_sessions.merge(remote.active_sessions);
//     }

//     pub fn save(&self, path: &str) {
//         if let Some(parent) = std::path::Path::new(path).parent() {
//             let _ = std::fs::create_dir_all(parent);
//         }

//         if let Ok(json) = serde_json::to_string(self) {
//             if let Err(e) = fs::File::create(path)
//                 .and_then(|mut f| f.write_all(json.as_bytes()))
//             {
//                 eprintln!("Failed to save state: {}", e);
//             }
//         }
//     }


//     pub fn load(path: &str, node_id: &str) -> Self {
//         if let Ok(mut file) = fs::File::open(path) {
//             let mut data = String::new();
//             if file.read_to_string(&mut data).is_ok() {
//                 if let Ok(state) = serde_json::from_str(&data) {
//                     return state;
//                 }
//             }
//         }
//         MayaState::new(node_id)
//     }

//     pub fn hash(&self) -> String {
//         use sha2::{Sha256, Digest};
//         let json = serde_json::to_string(self).unwrap();
//         let mut hasher = Sha256::new();
//         hasher.update(json);
//         format!("{:x}", hasher.finalize())
//     }

// }

// impl MayaState {
//     pub fn print_summary(&self) {
//         println!("===============================");
//         println!("Node: {}", self.node_id);
//         println!("Lamport Clock: {}", self.clock.counter);
//         println!("-------------------------------");

//         println!("Attackers:");
//         for (id, attacker) in &self.attackers {
//             println!("  Attacker: {}", id);

//             println!("    Visited Decoys:");
//             for d in &attacker.visited_decoys.elements {
//                 println!("      - {}", d);
//             }

//             println!("    Current Location: {:?}", attacker.location.value);

//             println!("    Actions:");
//             for (decoy, (action, ts, node)) in &attacker.actions_per_decoy.entries {
//                 println!(
//                     "      - {} => {} (ts: {}, node: {})",
//                     decoy, action, ts, node
//                 );
//             }
//         }

//         println!("-------------------------------");
//         println!("Stolen Credentials:");
//         for cred in self.stolen_creds.elements() {
//             println!("  - {}", cred);
//         }

//         println!("-------------------------------");
//         println!("Active Sessions:");
//         for (host, (session, ts, node)) in &self.active_sessions.entries {
//             println!(
//                 "  {} => {} (ts: {}, node: {})",
//                 host, session, ts, node
//             );
//         }

//         println!("===============================");
//     }
// }



use serde::{Serialize, Deserialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};

#[derive(Serialize, Deserialize, Clone)]
pub struct LamportClock {
    pub counter: u64,
    pub node_id: String,
}

impl LamportClock {
    pub fn new(node_id: &str) -> Self {
        Self { counter: 0, node_id: node_id.to_string() }
    }
    pub fn tick(&mut self) -> u64 { self.counter += 1; self.counter }
    pub fn merge(&mut self, remote: &LamportClock) {
        self.counter = std::cmp::max(self.counter, remote.counter) + 1;
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GSet<T: std::hash::Hash + Eq> { pub elements: HashSet<T> }

impl<T: std::hash::Hash + Eq + Clone> GSet<T> {
    pub fn new() -> Self { Self { elements: HashSet::new() } }
    pub fn add(&mut self, value: T) { self.elements.insert(value); }
    pub fn merge(&mut self, other: GSet<T>) { for v in other.elements { self.elements.insert(v); } }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AWORSet<T: std::hash::Hash + Eq> {
    pub adds: HashMap<T, HashSet<(String, u64)>>,
    pub removes: HashSet<(String, u64)>,
}

impl<T: std::hash::Hash + Eq + Clone> AWORSet<T> {
    pub fn new() -> Self { Self { adds: HashMap::new(), removes: HashSet::new() } }
    pub fn add(&mut self, value: T, tag: (String, u64)) {
        self.adds.entry(value).or_insert_with(HashSet::new).insert(tag);
    }
    pub fn remove(&mut self, value: &T) {
        if let Some(tags) = self.adds.get(value) {
            for tag in tags { self.removes.insert(tag.clone()); }
        }
    }
    pub fn merge(&mut self, other: AWORSet<T>) {
        for (val, tags) in other.adds { self.adds.entry(val).or_insert_with(HashSet::new).extend(tags); }
        self.removes.extend(other.removes);
    }
    pub fn elements(&self) -> HashSet<T> {
        let mut result = HashSet::new();
        for (val, tags) in &self.adds {
            if tags.iter().any(|t| !self.removes.contains(t)) { result.insert(val.clone()); }
        }
        result
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LWWRegister<T> { pub value: Option<T>, pub ts: u64, pub node: String }

impl<T: Clone> LWWRegister<T> {
    pub fn new() -> Self { Self { value: None, ts: 0, node: String::new() } }
    pub fn set(&mut self, value: T, ts: u64, node: String) { self.value = Some(value); self.ts = ts; self.node = node; }
    pub fn merge(&mut self, other: LWWRegister<T>) {
        if other.ts > self.ts || (other.ts == self.ts && other.node > self.node) { *self = other; }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LWWMap<K: std::hash::Hash + Eq, V> { pub entries: HashMap<K, (V, u64, String)> }

impl<K: std::hash::Hash + Eq + Clone, V: Clone> LWWMap<K, V> {
    pub fn new() -> Self { Self { entries: HashMap::new() } }
    pub fn insert(&mut self, key: K, value: V, ts: u64, node: String) { self.entries.insert(key, (value, ts, node)); }
    pub fn merge(&mut self, other: LWWMap<K, V>) {
        for (k, (v, ts, node)) in other.entries {
            match self.entries.get(&k) {
                Some((_, local_ts, local_node)) if *local_ts > ts || (*local_ts == ts && *local_node > node) => {}
                _ => { self.entries.insert(k, (v, ts, node)); }
            }
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AttackerState {
    pub visited_decoys: GSet<String>,
    pub actions_per_decoy: LWWMap<String, String>,
    pub location: LWWRegister<String>,
}

impl AttackerState {
    pub fn new() -> Self { Self { visited_decoys: GSet::new(), actions_per_decoy: LWWMap::new(), location: LWWRegister::new() } }
    pub fn merge(&mut self, other: AttackerState) {
        self.visited_decoys.merge(other.visited_decoys);
        self.actions_per_decoy.merge(other.actions_per_decoy);
        self.location.merge(other.location);
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MayaState {
    pub node_id: String,
    pub clock: LamportClock,
    pub attackers: HashMap<String, AttackerState>,
    pub stolen_creds: AWORSet<String>,
    pub active_sessions: LWWMap<String, String>,
}

impl MayaState {
    pub fn new(node_id: &str) -> Self {
        Self { node_id: node_id.to_string(), clock: LamportClock::new(node_id), attackers: HashMap::new(), stolen_creds: AWORSet::new(), active_sessions: LWWMap::new() }
    }
    fn ensure_attacker(&mut self, attacker_id: &str) { self.attackers.entry(attacker_id.to_string()).or_insert_with(AttackerState::new); }
    pub fn observe_visit(&mut self, attacker_id: &str, decoy: &str) {
        self.ensure_attacker(attacker_id); self.clock.tick();
        self.attackers.get_mut(attacker_id).unwrap().visited_decoys.add(decoy.to_string());
    }
    pub fn record_action(&mut self, attacker_id: &str, decoy: &str, action: &str) {
        self.ensure_attacker(attacker_id);
        let ts = self.clock.tick();
        self.attackers.get_mut(attacker_id).unwrap().actions_per_decoy.insert(decoy.to_string(), action.to_string(), ts, self.node_id.clone());
    }
    pub fn update_location(&mut self, attacker_id: &str, location: &str) {
        self.ensure_attacker(attacker_id);
        let ts = self.clock.tick();
        self.attackers.get_mut(attacker_id).unwrap().location.set(location.to_string(), ts, self.node_id.clone());
    }
    pub fn add_cred(&mut self, cred: &str) {
        let ts = self.clock.tick();
        self.stolen_creds.add(cred.to_string(), (self.node_id.clone(), ts));
    }
    pub fn add_session(&mut self, host: &str, session_id: &str) {
        let ts = self.clock.tick();
        self.active_sessions.insert(host.to_string(), session_id.to_string(), ts, self.node_id.clone());
    }
    pub fn merge(&mut self, mut remote: MayaState) {
        self.clock.merge(&remote.clock);
        for (id, remote_attacker) in remote.attackers.drain() {
            self.attackers.entry(id).or_insert_with(AttackerState::new).merge(remote_attacker);
        }
        self.stolen_creds.merge(remote.stolen_creds);
        self.active_sessions.merge(remote.active_sessions);
    }
    pub fn save(&self, path: &str) {
        if let Some(parent) = std::path::Path::new(path).parent() { let _ = std::fs::create_dir_all(parent); }
        if let Ok(json) = serde_json::to_string(self) {
            if let Err(e) = fs::File::create(path).and_then(|mut f| f.write_all(json.as_bytes())) { eprintln!("Failed to save state: {}", e); }
        }
    }
    pub fn load(path: &str, node_id: &str) -> Self {
        if let Ok(mut file) = fs::File::open(path) {
            let mut data = String::new();
            if file.read_to_string(&mut data).is_ok() {
                if let Ok(state) = serde_json::from_str(&data) { return state; }
            }
        }
        MayaState::new(node_id)
    }
    pub fn hash(&self) -> String {
        use sha2::{Sha256, Digest};
        let json = serde_json::to_string(self).unwrap();
        let mut hasher = Sha256::new();
        hasher.update(json);
        format!("{:x}", hasher.finalize())
    }
    pub fn print_summary(&self) {
        println!("===============================");
        println!("Node: {}", self.node_id);
        println!("Lamport Clock: {}", self.clock.counter);
        println!("-------------------------------");
        println!("Attackers:");
        for (id, attacker) in &self.attackers {
            println!("  Attacker: {}", id);
            println!("    Visited Decoys:");
            for d in &attacker.visited_decoys.elements { println!("      - {}", d); }
            println!("    Current Location: {:?}", attacker.location.value);
            println!("    Actions:");
            for (decoy, (action, ts, node)) in &attacker.actions_per_decoy.entries {
                println!("      - {} => {} (ts: {}, node: {})", decoy, action, ts, node);
            }
        }
        println!("-------------------------------");
        println!("Stolen Credentials:");
        for cred in self.stolen_creds.elements() { println!("  - {}", cred); }
        println!("-------------------------------");
        println!("Active Sessions:");
        for (host, (session, ts, node)) in &self.active_sessions.entries {
            println!("  {} => {} (ts: {}, node: {})", host, session, ts, node);
        }
        println!("===============================");
    }
}