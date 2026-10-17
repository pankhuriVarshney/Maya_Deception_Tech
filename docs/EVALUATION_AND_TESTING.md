# Evaluation and Testing

This chapter describes how Maya was tested and evaluated, what the tests found, and what the results do and
do not show. It has two parts: functional and integration testing of the system, and a comparative
evaluation in which Maya, a Cowrie honeypot and an unprotected host were attacked side by side. Table and
figure numbers are local to this chapter and can be renumbered when it is merged into the report.

The method behind the comparison (metric definitions, scoring formula, protocol) is specified in
`docs/EVALUATION.md`. This chapter reports what was measured.

## 1. Objectives

1. Verify that attacker activity on a Kubernetes decoy is recorded completely and exactly once, carried through to the dashboard, mapped to MITRE ATT&CK, and flagged when dangerous.
2. Measure attacker **dwell time**: how long an attacker stays engaged, and how that is affected by how convincing the target is.
3. Compare Maya against an established honeypot (Cowrie) and an unprotected host on telemetry quality, intelligence quality and deception effectiveness, and be explicit about where Maya is weaker.

## 2. Test environment

| Item | Value |
|---|---|
| Host | Linux (Arch), kernel 7.2.6-arch2-1, Docker |
| Kubernetes | kind cluster `maya-dev`, one control-plane node, Kubernetes v1.36.1, containerd 2.3.1 |
| Decoy sandbox | gVisor RuntimeClass `gvisor`; the sandbox reports kernel `4.19.0-gvisor` |
| Decoys | `jump-01` (Alpine 3.18, OpenSSH), `web-03`, `redis-01`, `ftp-01` (Debian 12 slim); each pod also runs a `crdt-sync` sidecar |
| Application | Node.js 20 backend (TypeScript), Next.js dashboard, MongoDB 7, run with Docker Compose |
| Baseline honeypot | Cowrie (`cowrie/cowrie:latest`) with its default configuration, which accepts any credential |
| Unprotected host | Alpine 3.18 with OpenSSH, built from the same base and packages as `jump-01` but with no logging wrapper, audit log or CRDT sidecar |

The gVisor version was not recorded; the sandbox's kernel string is quoted where relevant.

## 3. Testing strategy

| Level | What it covers | Method |
|---|---|---|
| Unit | Probe evaluation, event matching, metric computation, scoring | 16 automated tests (Jest) covering the benchmark logic; all pass |
| Integration | SSH activity on a decoy to the CRDT state, MongoDB and the dashboard | Scripted red-team battery and a hand-typed interactive session |
| Simulation | The six scripted attack scenarios in the dashboard | Run against the live decoys; synthetic attackers appear in the decoys' state |
| Comparative | Maya against Cowrie and an unprotected host | Benchmark page: the same adaptive attack run against all three at once |

Code was also reviewed independently before the benchmark was first run. That review found a defect that
would have made every run against Maya and the unprotected host abort (Table 2, item 10).

## 4. Functional and integration testing

### 4.1 Scripted red-team battery

A fixed attack was run against the `jump-01` decoy and, for comparison, a Cowrie container: a port scan,
16 wrong-password logins, nine post-login commands (one SSH connection each) and a base64 exfiltration
command. The battery records its own ground truth, so what each system captured can be checked against what
was actually done.

The first real run exposed the central defect of the project at that point: after a genuine successful login
and nine commands, Maya's `jump-01` reported **0 attackers, 0 credentials and 0 sessions**. After the fix
described in Table 2 it reported 1 attacker, 1 credential and 1 session, and after two further runs 20
sessions, matching the 20 successful logins made.

### 4.2 Interactive (hand-typed) session

A person logged in to `jump-01` over SSH and typed `whoami`, two blank Enters, `ls /`, `cat /etc/passwd`,
`uname -a` and `exit`. The decoy's recorded state contained exactly four actions (`whoami`, `ls /`,
`cat /etc/passwd`, `uname -a`): each once, with the blank Enters and `exit` not recorded. The dashboard showed
the same commands tagged T1033, T1083, T1087.001 and T1082 respectively. This confirms the interactive path
as well as the one-command-per-connection path used by the scripts.

### 4.3 Simulated scenarios

The six dashboard scenarios (SSH brute force, lateral movement, credential dumping, network discovery,
privilege escalation, full campaign) were run against the live decoys. Synthetic attackers with `10.30.30.x`
addresses appeared alongside the real attacker in the decoy state, confirming the scenarios ran on the
Kubernetes decoys and not on mock data. These scenarios write into the decoys' state directly, so they do not
exercise the SSH logging path; the battery and interactive tests do.

## 5. Defects found by testing

Table 2 lists the defects that testing exposed, the evidence, and the fix. Each was re-tested after the fix.

| # | Defect | Evidence | Fix | Result after fix |
|---|---|---|---|---|
| 1 | No passive detection on Kubernetes decoys | 0 attackers, credentials and sessions after a real login and 9 commands | `ForceCommand` wrapper in each decoy's sshd writes an audit log to a shared volume; the `crdt-sync` sidecar (invisible to the attacker) turns it into CRDT state | 1 attacker, 1 credential, 1 session |
| 2 | Session count capped at one per decoy | Session count stuck at 1 despite 10 successful logins per run | Sessions changed from a last-write-wins map keyed by decoy to a grow-only set of `decoy\|session_id` | 20 sessions after two runs; raw state and API agree |
| 3 | Only the latest command per decoy retained | No command history available | Command history changed to a grow-only set of records with real timestamps | Full ordered history per attacker |
| 4 | Runaway duplication | 12,190 recorded actions after 6.5 h, later 76,010 for one attacker, and 70,990 stored events against 20 real commands | The daemon re-read the same audit lines every 30 s cycle. Each line is now recorded once, keyed by session or by attacker, decoy, command and timestamp; the backend's existence check was batched | 20 recorded actions for 20 commands, stable across cycles |
| 5 | Decoy name recorded as `unknown` | Every record carried `decoy: "unknown"` | The manifest change adding the decoy name had been edited but not applied to the cluster; applied | `DECOY_NAME=jump-01` |
| 6 | Interactive logging repeated the last command on every blank Enter | Code inspection before the interactive test | Logging now fires only when the shell's history number advances | Each typed command recorded once (Section 4.2) |
| 7 | MITRE mapping mostly the generic fallback | Nearly every command (all except `netstat` and `whoami`) mapped to the generic T1082 fallback at 0.3 confidence; the signature list was Windows-only | Added Linux signatures and patterns | `whoami`/`id` T1033, `ps aux` T1057, `ls`/`find` T1083, `cat /etc/hosts` T1016, `cat /etc/passwd` T1087.001, `netstat` T1049, base64 exfil T1132.001 |
| 8 | Dwell time always 0 for simulated attackers | Attacker page showed "0h 0m" | Dwell time now computed from an attacker's first to last event (seconds shown under one minute) | Non-zero values (see limitation in Section 8) |
| 9 | Simulations reported mock data | The page targeted Vagrant VM names that do not exist on Kubernetes | Page now maps to the running Kubernetes decoys | Synthetic attackers recorded on the decoys |
| 10 | Benchmark attacker aborted on the first wrong password | Found in review before the first run: a prompt-count option changed ssh's exit status, so a rejected password looked like a connection failure | Rejected-password detection now handles both exit codes | Maya and the unprotected host reject 4 wrong passwords and then authenticate (Figure 1) |

Two operational lessons came out of the same testing. Rebuilding an image changes nothing until the pod or
container is recreated, and editing a manifest changes nothing until it is applied; defects 4, 5 and 6 were
all first seen on a pod still running an older image or manifest.

## 6. Comparative evaluation

### 6.1 Design

The same attack was run at the same moment against three targets: Maya's `jump-01` decoy, a Cowrie
honeypot, and an unprotected host. One repetition was run with the adaptive attacker enabled. The suspicion
threshold was **3**, as recorded in the attack log ("threshold 3"). Commands were spaced about 1.5 to 2 s
apart in the log timestamps, consistent with the default think time of 1,500 ms plus command execution.

**The attacker** follows a fixed kill chain: an eight-port scan, four wrong passwords and then the real
credential, honeypot checks, then 12 labeled commands covering discovery, credential access, collection,
exfiltration and defense evasion. Nothing destructive is run.

**The honeypot checks** run real commands and judge the real output; nothing is decided by target name. A
failed check is a "tell". When the attacker has seen as many tells as the threshold, it concludes the host is
a honeypot and disengages. The checks are: a weak password accepted (P1), a sandbox or hypervisor name in the
kernel strings (P2), monitoring traces visible (P9), known honeypot defaults (P3) and a `sleep` that returns
early (P8), plus four shell-fidelity checks (F1 to F4).

**Metrics and scoring** follow `docs/EVALUATION.md`: each measured metric is scored 0 to 5 relative to the
best target on that metric, averaged within a category, and combined with category weights (telemetry 25,
intelligence 20, deception 25). Categories the harness cannot measure (containment, operations) are excluded
and the remaining weights rescaled. The unprotected host is scored like the others, so it marks the ceiling
for realism and the floor for visibility.

**Dwell time** is measured two ways. Attacker-side is the interval from the first authenticated session to
the attacker's last action or the moment it left, measured by the attacker itself. Defender-observed is the
interval between the first and last events the target's own telemetry recorded.

### 6.2 Results

**Table 3. Outcome per target (one run)**

| | Maya | Cowrie | Unprotected host |
|---|---|---|---|
| Attacker outcome | Ran the full chain | Left early | Ran the full chain |
| Tells seen | 2 (P2, P9) | 3 (P1, P3, F1) | 0 |
| Attacker-side dwell time | 42.5 s | 10.5 s | 38.0 s |
| Defender-observed dwell time | 42.0 s | 10.5 s | not recorded |
| Commands recorded by the defender | 100% | 100% | 0% |
| Composite score | **75%** | **77%** | 35% |

**Table 4. Metrics**

| ID | Metric | Maya | Cowrie | Unprotected host |
|---|---|---|---|---|
| A1 | Command capture recall | 100% | 100% | 0% |
| A2 | Session count accuracy | 100% | 100% | 0% |
| A4 | Login telemetry (recorded / sent) | 86% | 100% | 0% |
| A5 | Detection latency (median) | 24.5 s | 207 ms | not applicable |
| A7 | Attacker attribution (true source address) | 0% | 100% | 0% |
| B1 | MITRE tagging accuracy | 100% | not exercised | 0% |
| B1c | MITRE non-fallback coverage | 100% | not exercised | 0% |
| B3 | Dangerous-command recall | 100% | not exercised | 0% |
| B3f | Benign commands flagged dangerous | 0% | 0% | not applicable |
| C1 | Dwell time, attacker-side | 42.5 s | 10.5 s | 38.0 s |
| C1d | Dwell time, defender-observed (informational) | 42.0 s | 10.5 s | not recorded |
| C2 | Engagement depth (labeled commands run) | 12 | 0 | 12 |
| C3 | Fingerprint resistance | 60% | 60% | 100% |
| C4 | Output fidelity | 100% | 0% | 100% |
| C5 | Monitoring artifacts visible | 4 | 0 | 0 |

"Not exercised" means the attacker left before reaching the commands the metric needs; the metric is
excluded for that target, not scored as zero.

**Table 5. Category scores (0 to 5), recomputed from Table 4**

| Category (weight) | Maya | Cowrie | Unprotected host |
|---|---|---|---|
| A. Telemetry fidelity (25) | 2.87 | 5.00 | 0.00 |
| B. Intelligence quality (20) | 5.00 | 5.00 | 0.00 |
| C. Deception effectiveness (25) | 3.60 | 1.85 | 4.89 |
| Composite (0 to 5) | 3.74 | 3.87 | 1.75 |

**Table 6. What the attacker saw on each target**

| Check | Maya | Cowrie | Unprotected host |
|---|---|---|---|
| P1 weak password | Rejected 4 wrong passwords | Accepted `123456` on the first attempt | Rejected 4 wrong passwords |
| P2 kernel / sandbox | **Tell**: `uname -a` reports `4.19.0-gvisor` | ok | ok |
| P9 monitoring traces | **Tell**: 4 artifacts (a `tee` process writing under `/var/lib/.state`, a `ForceCommand` line in `sshd_config`, `/etc/maya-audit-bashrc`, `/var/lib/.state`) | ok | ok |
| P3 known defaults | ok | **Tell**: hostname `svr04`, account `phil` | ok |
| P8 sleep timing | ok (2,539 ms) | ok (2,120 ms) | ok (2,217 ms) |
| F1 shell arithmetic | ok | **Failed**: `-bash: 6*7: command not found` | ok |
| F2 to F4 | ok | not run (attacker had left) | ok |

### 6.3 Analysis

**Dwell time.** Against Cowrie the attacker disengaged after about ten seconds, having seen three tells.
Against Maya it completed the full chain in 42.5 s with two tells, one short of the threshold. The
unprotected host behaved as the realism ceiling: no tells, full chain, 38.0 s. Maya's 4.5 s longer total
against the unprotected host should not be read as better realism. In full-chain runs dwell time is dominated
by the attacker's fixed think time, so the meaningful result is whether the attacker left. Maya's own
telemetry measured dwell time to within a second of the attacker's own clock (42.0 s against 42.5 s; Cowrie
10.5 s against 10.5 s), which supports computing dwell time from recorded events.

**Telemetry.** Maya and Cowrie each recorded every command the attacker sent. They differ in latency and
attribution, both of which follow from Maya's design:

- *Detection latency* (24.5 s against 207 ms). Maya's events travel from the decoy's log to the sidecar every 30 s and from the sidecar to the backend every 15 s, so a delay of tens of seconds is expected. Cowrie writes its log as events happen.
- *Attribution* (0% against 100%). Traffic reaches the decoy through a Kubernetes NodePort that rewrites the source address, so Maya recorded every attacker as the same internal address. This is a property of the test network and also limits Maya in any deployment that sits behind a NodePort.
- *Login telemetry* (86%). Maya records successful sessions only. Failed logins never reach its logging wrapper, so 4 of the 29 login attempts were not recorded.

**Intelligence.** On the 12 labeled commands Maya assigned the expected MITRE technique to all of them and
flagged all three dangerous ones (`cat /etc/shadow`, the base64 exfiltration, `history -c`) with no false
flags among the benign commands. Cowrie does not tag commands itself, and the attacker left before any
labeled command, so it could not be scored. Section 7 explains why the Maya figures should be read with
care.

**Deception effectiveness.** The unprotected host scored best, as it should. Maya scored 3.60 and Cowrie 1.85
in this category. Maya's score was held down by the monitoring artifacts (C5 = 4) and the sandbox kernel
string, which are the two tells the attacker found. Cowrie's was held down mostly by leaving early, which
meant zero labeled commands run and a fidelity score based on a single check.

**Overall.** The composite put Cowrie (77%) marginally ahead of Maya (75%), with the unprotected host far
behind (35%) because it records nothing. This should not be read as Cowrie being the better system. Cowrie's
intelligence score rests on one metric (no false flags), because it left before the labeled commands, so that
category was not truly exercised. Its lead comes from telemetry latency and attribution, where Maya is weaker
by design. Maya led on dwell time, on engagement depth, and on output fidelity (the last on a single Cowrie
check).

### 6.4 Sensitivity to the suspicion threshold

The result depends on the threshold. Table 7 is derived from the order in which tells appeared in the
recorded attack log; it is not a set of separate runs.

**Table 7. When each target would have ended the attack, by threshold (derived from the logged tells)**

| Threshold | Maya | Cowrie | Unprotected host |
|---|---|---|---|
| 1 | After P2, within seconds of logging in | Immediately after P1 | Never |
| 2 | After P9, a few seconds in | After P3, a few seconds in | Never |
| 3 (the run) | Completes (only 2 tells) | After F1 (measured: 10.5 s) | Never |

At a threshold of 3 Maya outlasts Cowrie. At a threshold of 2, which is the dashboard's default setting, both
would have been abandoned within a few seconds of each other. The claim that Maya keeps an attacker longer
than Cowrie therefore holds for an attacker that needs three independent signs, and not for one that acts on
two. A sweep of thresholds, run as separate attacks with repetitions, is needed to turn this into a firm
result.

## 7. Threats to validity

- **One repetition.** There is no variance estimate. The protocol calls for at least 10 repetitions with medians and ranges.
- **Scripted attacker.** The attacker is deterministic and has a fixed think time. It does not reason about the host or vary its approach as a person would. A human session is part of the planned protocol.
- **Probe design.** The checks were chosen by the authors. The monitoring-traces check (P9) looks for specific files and strings in Maya's own implementation, which an attacker without that knowledge would not search for, so C5 measures exposure, not what a typical attacker would find. The known-defaults check (P3) uses publicly documented Cowrie defaults and carries less of that bias.
- **Circular labels.** The expected MITRE techniques were assigned by the team that wrote the classifier's signatures, so 100% accuracy mainly shows the two agree. It is not an independent accuracy figure.
- **Early exit distorts comparison.** When the attacker leaves a target early, some metrics are not exercised and others rest on very little data (Cowrie's fidelity score is one check). Composite scores are most comparable when the adaptive attacker is switched off so that every target runs the same commands.
- **Different environments.** The unprotected host runs on the host kernel in an ordinary container, Maya under gVisor, and Cowrie as an emulation, so some differences come from the runtime and not the honeypot logic.
- **Network effects.** The NodePort address rewriting affects attribution only for Maya. The first-guess acceptance that trips P1 on Cowrie is a feature of its default configuration, not of every deployment.

## 8. Limitations and future work

Findings from the testing that remain open:

- **Detectability.** The sandbox's kernel string and the logging helper's visibility are real weaknesses. The visible process is the simplest to remove; the kernel string is a property of the runtime.
- **Attribution and dwell time across sessions.** Behind a NodePort, separate attacks collapse into one attacker, so an attacker's dwell time can span unrelated sessions (a hand-typed test of about a minute produced "2h 12m" because earlier test traffic shared the same address). Dwell time should be computed per engagement, split where events are separated by a long idle gap.
- **Failed-login passwords.** Maya cannot record the passwords of failed logins; real sshd does not expose them, whereas Cowrie records every attempt.
- **Telemetry delay and durability.** Events take up to about 45 s to reach the dashboard, and a decoy's recorded state is lost when its pod is recreated.
- **Not built.** Human-approved escalation between decoy tiers and the learned attacker classifier, so neither could be evaluated.
- **Not evaluated.** Containment and operations metrics (isolation strength, egress control, tamper resistance, resource footprint), and T-Pot itself. Cowrie, the SSH honeypot it contains, stood in, so the comparison covers SSH behaviour only.

Planned next steps: run at least 10 repetitions per configuration; sweep the threshold; add a human-operated
session; compute dwell time per engagement; and re-run the comparison with the adaptive attacker off for a
like-for-like telemetry comparison.

## 9. Conclusion

Testing took the system from recording nothing on a real login to recording every command exactly once,
mapped to specific MITRE techniques and flagged when dangerous, with defects found and fixed along the way
(Table 2). In the side-by-side evaluation, Maya captured everything the attacker did, kept an attacker engaged
through the full attack chain where Cowrie lost it after about ten seconds, and produced a correct dwell
measurement from its own telemetry. It was weaker than Cowrie on detection latency and attribution, and it
exposes identifiable traces of its own monitoring and its sandbox. With a lower suspicion threshold the
dwell-time advantage over Cowrie disappears. The evidence supports the claim that a real operating system plus
MITRE-tagged telemetry yields richer and more convincing deception than an emulated shell. It does not yet
support a claim that Maya is better overall, and it points to specific, fixable weaknesses.

## Appendix A. Reproducing the evaluation

1. Start the stack and cluster (`docs/SETUP_AND_TESTING.md`, sections 3 and 4).
2. Open **Benchmark** in the dashboard, confirm all three targets show reachable, and run with the adaptive attacker on and off.
3. Export the run as JSON or CSV from the Benchmark page; the raw per-command results and per-target telemetry are included.
4. Method, metric definitions and the scoring formula: `docs/EVALUATION.md`.

## Appendix B. Suggested figures

- **Figure 1.** The Benchmark attack log for the three targets (shows Maya and the unprotected host rejecting four wrong passwords, Cowrie accepting the first, and Cowrie leaving after three tells).
- **Figure 2.** The Overview tab: composite scores and the dwell-time chart.
- **Figure 3.** The Fingerprint tab (which check fired on which target, with the evidence).
- **Figure 4.** The attacker page after the hand-typed session: Command Activity with MITRE badges.
- **Figure 5.** The Matrix tab with the weighted categories.
