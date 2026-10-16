# Maya Evaluation Matrix

How to benchmark Maya against baseline honeypots, metric by metric. Every
cell marked "measured" comes from a real run on the kind cluster; anything
else is a hypothesis or a to-do, and says so. "Better" is only claimed
where the numbers support it.

## 1. Systems compared

| System | Class | Used for |
|---|---|---|
| **Maya** (K8s fabric: gVisor decoys + `crdt-sync` sidecar + backend/dashboard) | Real-OS decoys, tiered isolation, CRDT-correlated telemetry | Subject |
| **Cowrie** | Medium-interaction SSH/Telnet honeypot (emulated shell) | Primary baseline for every SSH metric |
| **Dionaea** | Low-interaction multi-protocol malware-capture honeypot | Baseline for protocol coverage and artifact capture only |

Fairness rules:
- Dionaea has no SSH shell, so shell/command metrics are **N/A for it, not zero**. Exclude N/A metrics and renormalise weights (section 5).
- Record the exact Cowrie config. Its default accepts any credential, which inflates session counts compared with Maya's single real login.
- Record versions: Cowrie image digest, Maya git SHA, gVisor version.

## 2. Protocol

- Same attacker host, same network, clocks NTP-synced.
- **Fresh state per run:** `docker restart cowrie-ssh`; `kubectl delete pod -n maya-decoys -l app=jump-01`.
- Attack drivers: (1) `scripts/redteam/run-battery.sh` (scripted, repeatable); (2) one human red-team session following a written script; (3) real tooling (`hydra`, `nmap -sV`, a metasploit `ssh_login`) for traffic the battery doesn't produce.
- **n >= 10 runs per system per driver.** Report median and min/max, never a single run.
- Store raw results under `redteam-results/<system>/<run-id>/`.

## 3. The matrix

Readiness: **Ready** = measurable with current scripts, **Script** = needs a new measurement script, **Feature** = Maya doesn't implement the underlying capability yet.

### A. Telemetry fidelity (weight 25)

| ID | Metric | How measured | Better | Maya today | Cowrie | Dionaea | Ready |
|---|---|---|---|---|---|---|---|
| A1 | Command capture recall | commands logged / commands sent (battery ground truth) | higher | **20/20** over two runs (measured) | native | N/A | Ready |
| A2 | Session count accuracy | sessions reported / real connections that authenticated | closer to 1.0 | **20/20** (measured) | counts every connection, incl. accepted-any-credential ones | per-connection | Ready |
| A3 | Command history completeness | full ordered list with real timestamps | qualitative | yes, wall-clock to the second; no session-end time | yes, plus TTY replay and session duration | N/A | Ready |
| A4 | Auth-attempt telemetry | usernames/passwords captured for failed logins | higher | **weak**: failed attempts never reach `ForceCommand`; only attacker IP via sshd log, no passwords | full user/pass for every attempt | protocol logins | Ready |
| A5 | Detection latency | canary command sent at T0 -> visible via API at T1 | lower | up to ~45 s by design (30 s daemon cycle + 15 s backend poll); **not yet measured** | near-real-time in `cowrie.json` | near-real-time | Script |
| A6 | Artifact capture | files downloaded/uploaded by attacker saved + hashed | higher | **none** | yes (downloads dir) | yes (core feature) | Feature |
| A7 | Attacker attribution | distinct attackers identified / distinct source IPs used (>= 2 sources) | closer to 1.0 | **fails behind NodePort SNAT**: every attacker appears as `10.244.0.1` | depends on Docker port publishing; measure | measure | Script |
| A8 | Telemetry durability | events lost when a pod is recreated | lower | state lives in `emptyDir`; wiped on recreation (observed); Mongo copy survives only if synced first | log file on volume | log file on volume | Script |

### B. Intelligence quality (weight 20)

| ID | Metric | How measured | Better | Maya today | Cowrie | Dionaea | Ready |
|---|---|---|---|---|---|---|---|
| B1 | MITRE tagging accuracy | exact-match vs labeled corpus (section 6) | higher | all 10 battery commands get a specific technique (measured); accuracy vs labels **not yet scored** | none native | none | Script |
| B2 | Technique coverage breadth | distinct technique IDs the classifier can emit | higher | count of `COMMAND_SIGNATURES` + regex IDs; was Windows-heavy, Linux added 2026-10-17 | none | none | Ready |
| B3 | Dangerous-command precision / recall | labeled malicious + benign corpora (>= 50 each) | higher | battery: 1/1 flagged (the base64 exfil); recall on a wider corpus **unknown, likely low** | none | none | Script |
| B4 | False-flag rate (stand-in for "false escalation") | benign admin commands flagged dangerous / benign total | lower | **not measured**; real escalation logic doesn't exist (Epic 3) | N/A | N/A | Script |
| B5 | Cross-decoy attacker correlation | same attacker tracked across >= 2 decoys, no manual join | yes/no | implemented via CRDT; verified only with simulated attackers, **not with real traffic** | no (single host) | no | Script |
| B6 | Kill-chain stage attribution | % of battery stages (recon/cred/lateral/exfil) labeled correctly | higher | `stage` field exists; not scored | none | none | Script |

### C. Deception effectiveness (weight 25)

| ID | Metric | How measured | Better | Maya today | Cowrie | Dionaea | Ready |
|---|---|---|---|---|---|---|---|
| C1 | Dwell time | median seconds from first to last event per attacker (human + scripted) | higher | dashboard shows 0 h 0 m: **not computed for real attackers**; derivable from first/last `AttackEvent` | session duration in log | per-connection | Feature |
| C2 | Engagement depth | commands per session; kill-chain stages reached | higher | derivable from `AttackEvent` | derivable | N/A | Script |
| C3 | Fingerprint resistance | honeypot-detection probes that do NOT distinguish it from a real host / total probes | higher | **known tells:** `uname -a` reports `4.19.0-gvisor ... 2016`; `ps aux` shows our own `tee` process; `/entrypoint.sh` at `/` | emulated-shell tells (canned output, limited command set); measure | measure | Script |
| C4 | Output fidelity | battery commands whose output matches a real reference host of the same image | higher | real execution by construction; gVisor differences in `/proc`, `uname` | emulated subset | N/A | Script |
| C5 | Monitoring-artifact visibility | attacker-visible traces of the monitoring (count) | lower | >= 5: `ForceCommand` in `sshd_config`, wrapper script, `/etc/maya-audit-bashrc`, `/usr/local/etc/maya-decoy.conf`, `/var/lib/.state/` | n/a (it is the server) | n/a | Ready |

### D. Containment and integrity (weight 15)

| ID | Metric | How measured | Better | Maya today | Cowrie | Dionaea | Ready |
|---|---|---|---|---|---|---|---|
| D1 | Isolation strength | checklist: sandbox runtime, non-root, no SA token, read-only rootfs, seccomp | higher | gVisor default, Kata available, `automountServiceAccountToken: false`; rootfs is writable | no real shell; process in container | process in container | Ready |
| D2 | Egress containment | outbound probes from the decoy to internal subnets and internet | blocked | **unverified**; no NetworkPolicy test run | measure | measure | Script |
| D3 | Telemetry tamper resistance | can the attacker delete or forge audit data? | no | **weak:** `.audit.jsonl` is written by the attacker's own user, so it can be deleted or forged | attacker can't touch logs | same | Script |

### E. Operations (weight 15)

| ID | Metric | How measured | Better | Maya today | Cowrie | Dionaea | Ready |
|---|---|---|---|---|---|---|---|
| E1 | Resource footprint | CPU/memory idle and under battery (`kubectl top`, `docker stats`) | lower | limits: jump 500m/512Mi, crdt-sync 100m/64Mi; **actuals not measured** | measure | measure | Script |
| E2 | Deploy / recover time | seconds from `kubectl delete pod` to `2/2 Running` | lower | ~20 s observed | seconds | seconds | Ready |
| E3 | Setup effort | prerequisite count and commands to a working decoy | lower | Docker + kind + kubectl + gVisor + 5 images + manifests | one container | one container | Ready |
| E4 | Ingest robustness | events/s sustained; time to ingest an N-event backlog | higher | one real incident: 76k-record state stalled the poll loop for a long time; now batched, **not re-benchmarked** | N/A | N/A | Script |
| E5 | Operator UX | task time: "find what attacker X ran and which techniques" | lower | dashboard with MITRE matrix, command history | grep JSON | web UI | Script |

### F. Capability checklist (not scored)

| Capability | Maya | Cowrie | Dionaea |
|---|---|---|---|
| Real OS shell interaction | yes | emulated | no |
| Multi-protocol decoys | SSH + FTP + Redis + HTTP | SSH, Telnet | many (SMB, FTP, HTTP, MSSQL, ...) |
| Native MITRE ATT&CK mapping | yes | no | no |
| Cross-host correlation (CRDT) | yes (see B5) | no | no |
| Malware / file capture | no | yes | yes |
| TTY session replay | no | yes | no |
| Tiered isolation (gVisor -> Kata -> VM) | infra yes | no | no |
| Human-approved escalation | **not built (Epic 2/3)** | no | no |
| Learned attacker classifier | **not built (Epic 3)** | no | no |
| Dashboard auth / RBAC | **not built (Epic 2)** | n/a | n/a |

## 4. Where Maya should win, tie, lose

These are hypotheses until section 3 is filled in with measurements.

**Likely to win:** output fidelity (C4), MITRE-tagged intelligence (B1, B3), cross-decoy correlation (B5), isolation tiering (D1). That is the defensible story: *a real OS plus ATT&CK-tagged, correlated telemetry*.

**Likely to lose today:** auth-attempt capture (A4), artifact capture (A6), detection latency (A5), setup effort (E3), attribution behind SNAT (A7), telemetry tamper resistance (D3), fingerprint resistance (C3), dwell time (C1, because it isn't computed yet).

**Not benchmarkable yet:** anything depending on tiered escalation or the learned classifier. Those are the project's headline novelty, and they're not built, so no comparison should claim them.

## 5. Scoring

For each applicable metric, normalise to 0-5 against the best performer:
- higher-is-better: `s = 5 * x / x_best`
- lower-is-better: `s = 5 * x_best / x`
- yes/no and checklist metrics: 5 / 0, partial = 2.5

Category score = mean of its metric scores. Composite = weighted mean using the weights above, **excluding N/A metrics and renormalising**.

Report the per-category profile (a radar chart or table) alongside the composite. A single number would hide exactly the categories where Maya loses.

## 6. Ground-truth labels for the battery

Used for B1 and B3. These are one reviewer's judgment, so have the team confirm them before treating them as ground truth.

| Command | Expected technique | Dangerous |
|---|---|---|
| `whoami` | T1033 | no |
| `uname -a` | T1082 | no |
| `id` | T1033 | no |
| `cat /etc/passwd` | T1087.001 (alt: T1003.008) | no |
| `ls -la /` | T1083 | no |
| `ps aux` | T1057 | no |
| `netstat -tulpn \|\| ss -tulpn` | T1049 | no |
| `cat /etc/hosts` | T1016 | no |
| `find / -maxdepth 2 -name '*.conf'` | T1083 | no |
| `cat /etc/passwd \| base64 \| head -c 2000` | T1132.001 | **yes** |

Still to build: a benign admin corpus (~50 commands) and a malicious corpus (~50 commands from public red-team references) for B3/B4.

## 7. Harness gaps, in priority order

1. **Repeat-run driver** that runs the battery n times against each system, resets state between runs, and writes one CSV row per metric per run.
2. **Latency probe** (A5): send a uniquely-named canary command, poll the API/log until it appears, record the delta.
3. **Dwell time** (C1): compute first-to-last `AttackEvent` per attacker in the backend; record session end in the audit wrapper.
4. **Fingerprint-probe script** (C3): the stretch task from Epic 4. Probes kernel string, `/proc`, process list, filesystem oddities, SSH banner/kex, timing.
5. **Labeled corpora + scorer** (B1, B3, B4).
6. **Resource sampler** (E1): record `kubectl top` / `docker stats` during runs.
7. **Attribution test** (A7): attack from two source IPs; decide on `externalTrafficPolicy: Local` or `hostNetwork` for the NodePort.
8. **Tamper test** (D3): from inside a decoy, delete and forge `.audit.jsonl` and see what the dashboard shows.

## 8. Threats to validity

- A scripted battery is not a real attacker. The human session and real tooling exist to reduce this.
- The battery opens one SSH connection per command, which Cowrie's accept-any-credential default turns into one "session" each. Compare Maya's A2 against ground truth, not against Cowrie's session count.
- The kind cluster uses SNAT for NodePort traffic, so absolute attribution numbers won't match a production ingress.
- gVisor's fingerprint depends on version; record it.

## 9. Running it from the dashboard

**Dashboard > Benchmark** runs one simulated attack at the same time against
three targets and fills in the matrix above where it can:

| Target | What it is |
|---|---|
| Maya | the `jump-01` decoy, reached through the kind NodePort |
| Cowrie | a Cowrie container (`bench-cowrie` in the root `docker-compose.yml`); stands in for T-Pot, which bundles Cowrie |
| Unprotected host | `bench-control`: same alpine:3.18 + openssh as `jump-01`, with no ForceCommand, audit log or CRDT sidecar |

Bring everything up with `docker compose up -d --build`. `GET /api/benchmark/targets`
shows whether the backend can reach each one (if Maya isn't reachable, set
`BENCHMARK_MAYA_HOST=host.docker.internal`).

**The attacker is adaptive.** Every target gets the same kill chain, but the
attacker first runs the honeypot-detection probes in section 3 (C3/C4/C5) and
leaves once it has seen `suspicion threshold` tells (default 2). Switch
"Adaptive attacker" off to run the full chain everywhere and compare only what
each system *records*. With it on, **dwell time (C1)** measures how convincing
each target is: the unprotected host is the ceiling, and a honeypot's distance
from it is how much it gives away. The probe set and threshold are fixed by the
code (`backend/src/services/benchmark/probes.ts`), not tuned per target.

Metrics the page computes: A1, A2, A4, A5, A7, B1, B3 (plus coverage and the
false-flag rate), C1 (attacker-side, and defender-observed for information),
C2, C3, C4, C5. Everything else in section 3 shows as "not measured by this
harness" and is left out of the composite. Results are stored in the
`benchmark_runs` collection and exportable as JSON or CSV.

Caveats specific to this harness:
- Cowrie's MITRE tags and danger flags are computed by running Maya's own
  classifier over Cowrie's logged commands (Cowrie doesn't tag), and are labeled
  as post-hoc.
- Cowrie's accept-any-credential default makes the weak-password probe (P1) fire
  on its first guess. That is a real tell, but it is configuration-dependent.
- The unprotected host records nothing, so its telemetry metrics are 0 by
  definition; read it as the floor for visibility and the ceiling for realism.
- Maya's telemetry reaches the backend after up to ~45 s, so each run waits up to
  the "telemetry wait" setting before scoring it.
