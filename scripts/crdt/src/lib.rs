use serde::{Serialize, Deserialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Serialize, Deserialize, Clone)]
pub struct LamportClock {
    pub counter: u64,
    pub node_id: String,
}

impl LamportClock {
    pub fn new(node_id: &str) -> Self {
        Self { counter: 0, node_id: node_id.to_string() }
    }

    pub fn tick(&mut self) -> u64 {
        self.counter += 1;
        self.counter
    }

    pub fn merge(&mut self, remote: &LamportClock) {
        self.counter = std::cmp::max(self.counter, remote.counter);
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GSet<T: Ord> {
    pub elements: BTreeSet<T>
}

impl<T: Ord + Clone> GSet<T> {
    pub fn new() -> Self {
        Self { elements: BTreeSet::new() }
    }

    pub fn add(&mut self, value: T) {
        self.elements.insert(value);
    }

    pub fn merge(&mut self, other: GSet<T>) {
        self.elements.extend(other.elements);
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AWORSet<T: Ord> {
    pub adds: BTreeMap<T, BTreeSet<(String, u64)>>,
    pub removes: BTreeSet<(String, u64)>,
}

impl<T: Ord + Clone> AWORSet<T> {
    pub fn new() -> Self {
        Self {
            adds: BTreeMap::new(),
            removes: BTreeSet::new(),
        }
    }

    pub fn add(&mut self, value: T, tag: (String, u64)) {
        self.adds.entry(value)
            .or_insert_with(BTreeSet::new)
            .insert(tag);
    }

    pub fn remove(&mut self, value: &T) {
        if let Some(tags) = self.adds.get(value) {
            for tag in tags {
                self.removes.insert(tag.clone());
            }
        }
    }

    pub fn merge(&mut self, other: AWORSet<T>) {
        for (val, tags) in other.adds {
            self.adds.entry(val)
                .or_insert_with(BTreeSet::new)
                .extend(tags);
        }
        self.removes.extend(other.removes);
    }

    pub fn elements(&self) -> BTreeSet<T> {
        let mut result = BTreeSet::new();
        for (val, tags) in &self.adds {
            if tags.iter().any(|t| !self.removes.contains(t)) {
                result.insert(val.clone());
            }
        }
        result
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LWWRegister<T> {
    pub value: Option<T>,
    pub ts: u64,
    pub node: String,
}

impl<T: Clone> LWWRegister<T> {
    pub fn new() -> Self {
        Self { value: None, ts: 0, node: String::new() }
    }

    pub fn set(&mut self, value: T, ts: u64, node: String) {
        self.value = Some(value);
        self.ts = ts;
        self.node = node;
    }

    pub fn merge(&mut self, other: LWWRegister<T>) {
        if other.ts > self.ts ||
           (other.ts == self.ts && other.node > self.node) {
            *self = other;
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LWWMap<K: Ord, V> {
    pub entries: BTreeMap<K, (V, u64, String)>
}

impl<K: Ord + Clone, V: Clone> LWWMap<K, V> {
    pub fn new() -> Self {
        Self { entries: BTreeMap::new() }
    }

    pub fn insert(&mut self, key: K, value: V, ts: u64, node: String) {
        self.entries.insert(key, (value, ts, node));
    }

    pub fn merge(&mut self, other: LWWMap<K, V>) {
        for (k, (v, ts, node)) in other.entries {
            match self.entries.get(&k) {
                Some((_, local_ts, local_node))
                    if *local_ts > ts ||
                       (*local_ts == ts && *local_node > node) => {}
                _ => {
                    self.entries.insert(k, (v, ts, node));
                }
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
    pub fn new() -> Self {
        Self {
            visited_decoys: GSet::new(),
            actions_per_decoy: LWWMap::new(),
            location: LWWRegister::new(),
        }
    }

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
    pub attackers: BTreeMap<String, AttackerState>,
    pub stolen_creds: AWORSet<String>,
    pub active_sessions: LWWMap<String, String>,
}

impl MayaState {
    pub fn new(node_id: &str) -> Self {
        Self {
            node_id: node_id.to_string(),
            clock: LamportClock::new(node_id),
            attackers: BTreeMap::new(),
            stolen_creds: AWORSet::new(),
            active_sessions: LWWMap::new(),
        }
    }
}

use std::fs;
use std::path::Path;
use sha2::{Sha256, Digest};

impl MayaState {

    /* =========================
       Persistence
    ==========================*/

    pub fn load(path: &str, node_id: &str) -> Self {
        if Path::new(path).exists() {
            let data = fs::read_to_string(path).unwrap_or_default();
            serde_json::from_str(&data).unwrap_or_else(|_| Self::new(node_id))
        } else {
            Self::new(node_id)
        }
    }

    pub fn save(&self, path: &str) {
        if let Ok(data) = serde_json::to_string_pretty(self) {
            let _ = fs::write(path, data);
        }
    }

    pub fn hash(&self) -> String {
        let serialized = serde_json::to_string(self).unwrap_or_default();
        let mut hasher = Sha256::new();
        hasher.update(serialized);
        format!("{:x}", hasher.finalize())
    }

    /* =========================
       CRDT Merge
    ==========================*/

    pub fn merge(&mut self, other: MayaState) {
        self.clock.merge(&other.clock);

        for (ip, remote_attacker) in other.attackers {
            self.attackers
                .entry(ip)
                .and_modify(|local| local.merge(remote_attacker.clone()))
                .or_insert(remote_attacker);
        }

        self.stolen_creds.merge(other.stolen_creds);
        self.active_sessions.merge(other.active_sessions);
    }

    /* =========================
       Domain Operations
    ==========================*/

    fn get_or_create_attacker(&mut self, ip: &str) -> &mut AttackerState {
        self.attackers
            .entry(ip.to_string())
            .or_insert_with(AttackerState::new)
    }

    pub fn observe_visit(&mut self, ip: &str, decoy: &str) {
        let ts = self.clock.tick();
        let node_id = self.node_id.clone(); // clone first

        let attacker = self.get_or_create_attacker(ip);
        attacker.visited_decoys.add(decoy.to_string());
        attacker.location.set(decoy.to_string(), ts, node_id);
    }

    pub fn record_action(&mut self, ip: &str, decoy: &str, action: &str) {
        let ts = self.clock.tick();
        let node_id = self.node_id.clone(); // clone first

        let attacker = self.get_or_create_attacker(ip);

        attacker.actions_per_decoy.insert(
            decoy.to_string(),
            action.to_string(),
            ts,
            node_id,
        );
    }

    pub fn update_location(&mut self, ip: &str, location: &str) {
        let ts = self.clock.tick();
        let node_id = self.node_id.clone(); // clone first

        let attacker = self.get_or_create_attacker(ip);
        attacker.location.set(location.to_string(), ts, node_id);
    }

    pub fn add_cred(&mut self, cred: &str) {
        let ts = self.clock.tick();
        self.stolen_creds.add(
            cred.to_string(),
            (self.node_id.clone(), ts),
        );
    }

    pub fn add_session(&mut self, host: &str, session: &str) {
        let ts = self.clock.tick();
        self.active_sessions.insert(
            host.to_string(),
            session.to_string(),
            ts,
            self.node_id.clone(),
        );
    }

    /* =========================
       Display
    ==========================*/

    pub fn print_summary(&self) {
        println!("===== MAYA STATE =====");
        println!("Node: {}", self.node_id);
        println!("Clock: {}", self.clock.counter);
        println!("Attackers: {}", self.attackers.len());
        println!("Credentials: {}", self.stolen_creds.elements().len());
        println!("Sessions: {}", self.active_sessions.entries.len());

        for (ip, attacker) in &self.attackers {
            println!("\nAttacker: {}", ip);
            println!("  Visited: {:?}", attacker.visited_decoys.elements);
            println!("  Current Location: {:?}", attacker.location.value);
        }

        println!("======================");
    }
}