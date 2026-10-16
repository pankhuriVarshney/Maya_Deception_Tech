# Setup and Testing Guide

How to get Maya running and how to test it, both with simulated attacks and by
hand. Everything here was run on Linux (Arch) with Docker and kind. The
Kubernetes fabric runs gVisor inside a kind node, which needs a Linux Docker
host; the dashboard on its own works anywhere Docker does.

Commands are plain, single-line shell and work in bash and fish.

## 1. What runs where

| Piece | Runs as | Reached at |
|---|---|---|
| Dashboard (Next.js) | container `frontend` | http://localhost:3000 |
| Backend API (Node/Express) | container `backend` | http://localhost:3001 |
| MongoDB | container `mongodb` | localhost:27017 |
| Decoys `jump-01`, `web-03`, `redis-01`, `ftp-01` | pods in the kind cluster `maya-dev` (namespace `maya-decoys`), each with a `crdt-sync` sidecar | see ports below |
| Benchmark targets `bench-cowrie`, `bench-control` | containers on the compose network | not published to the host |
| Standalone Cowrie (optional, for the command-line battery) | container `cowrie-ssh` from `scripts/docker/docker-compose.yml` | localhost:2223 |

Decoy ports on the host (mapped through the kind node):

| Decoy | Port | Service | Login |
|---|---|---|---|
| jump-01 | 30022 | SSH | `admin` / `fakejump01!` |
| redis-01 | 30222 (SSH), 30637 (Redis) | SSH, Redis | `admin` / `fakeredis01!` |
| ftp-01 | 30122 (SSH), 30021 (FTP) | SSH, FTP | `admin` / `fakeftp01!` |
| web-03 | 80 / 443 via the Ingress | HTTP | SSH is cluster-internal only (`admin` / `fakeweb03!`) |

The decoy passwords come from `maya-k8s/k8s/config/breadcrumb-credentials.yaml`.

How a command typed on a decoy reaches the dashboard:

1. sshd's `ForceCommand` wrapper (`maya-k8s/docker/common/decoy-audit-wrapper.sh`) appends a JSON line for the session and each command to a file on a shared volume.
2. The `crdt-sync` sidecar, which the attacker cannot see, reads it every **30 s** and records it in the CRDT state.
3. The backend reads that state every **15 s**, turns each command into an `AttackEvent`, tags it with MITRE and a danger flag, and the dashboard shows it.

So anything you do on a decoy takes **up to about 45 seconds** to appear.

## 2. Prerequisites

Required:
- Docker (with the compose plugin: `docker compose`)
- `kind` and `kubectl` (for the Kubernetes fabric)
- Several GB of free RAM (a kind node running four sandboxed decoys plus the app stack), and free host ports 80, 443, 3000, 3001, 27017, 30021, 30022, 30122, 30222, 30637

Needed only for some tests:
- `sshpass` and `nmap` (the command-line battery, `scripts/redteam/run-battery.sh`)
- `jq` (reading the JSON in the commands below)
- Node.js and `npm install` inside `backend/` (the comparison report script and `npm test`)

You do **not** need Rust, Vagrant or KVM. The CRDT binary is compiled inside Docker.

## 3. First-time setup

### 3a. Dashboard only (no Kubernetes)

```bash
docker network create kind
docker compose up -d --build
```

Open http://localhost:3000. With the default `SIMULATION_MODE=true` it loads demo attacker data.

`docker-compose.yml` declares the Docker network `kind` as external, so the
stack will not start unless it exists. A cluster creates it; if you have none,
the first command above creates an empty one. Without a cluster the Benchmark
page's Maya target and the K8s simulations will not work.

### 3b. Full setup (decoys, simulations, benchmark)

From the repo root:

```bash
./scripts/1_Epic.sh
```

This creates the kind cluster `maya-dev` with the host ports mapped, installs
gVisor and its RuntimeClass, installs the nginx Ingress, builds and loads every
decoy image, deploys the four decoys, and runs a health check. It takes several
minutes and prints a pass/fail summary at the end. To re-run only the checks:

```bash
./scripts/1_Epic.sh verify
```

Then give the backend container access to the cluster. It reads an *internal*
kubeconfig that addresses the kind node by name:

```bash
mkdir -p .kube
kind get kubeconfig --internal --name maya-dev > .kube/kind-internal-config
```

`.kube/` is git-ignored. Start the application stack, which also starts the two
benchmark targets:

```bash
docker compose up -d --build
```

### 3c. Check it all works

```bash
kubectl get pods -n maya-decoys
curl -s http://localhost:3001/health | jq
curl -s http://localhost:3001/api/simulation/k8s-targets | jq
curl -s http://localhost:3001/api/benchmark/targets | jq '.data[] | {id, reachable}'
```

Expected:
- four pods, each `2/2 Running`;
- `status: healthy` with `mongodb: connected`;
- the four decoys listed as K8s targets;
- `maya`, `cowrie` and `control` all `reachable: true`.

## 4. Starting again after a reboot

Nothing needs to be set up again; the cluster, images and compose images all survive. Start in this order, because the compose file joins the `kind` network that only exists while the cluster is up:

```bash
docker start maya-dev-control-plane
kubectl get nodes
kubectl get pods -n maya-decoys
docker compose up -d
```

If `kubectl` cannot connect, the node's published API port changed. Run `kind export kubeconfig --name maya-dev`. The backend is unaffected, because it uses the internal kubeconfig.

If pods show `ImagePullBackOff`, the node lost its loaded images. Rebuild and reload them (section 5), then `kubectl delete pod -n maya-decoys --all`.

## 5. After you change code

Code changes only take effect where the thing runs. A rebuilt image does nothing until the container or pod is recreated.

| You changed | Run |
|---|---|
| backend or frontend code | `docker compose up -d --build` |
| a decoy image (`maya-k8s/docker/<type>/`, `maya-k8s/docker/common/`) | build it, `kind load` it, then delete the pod (below) |
| the Rust CRDT daemon (`scripts/crdt/`) | rebuild `maya-crdt-sync:dev`, `kind load` it, delete **all** decoy pods |
| a Kubernetes manifest (`maya-k8s/k8s/decoy/*/deployment.yaml`) | `kubectl apply -f` it; an image rebuild alone does not change the Deployment |

Build from the **repo root**, because the Dockerfiles copy from `scripts/crdt/` and `maya-k8s/docker/common/`:

```bash
docker build -f maya-k8s/docker/jump/Dockerfile -t maya-jump:dev .
kind load docker-image maya-jump:dev --name maya-dev
kubectl delete pod -n maya-decoys -l app=jump-01
```

The same pattern applies to `ftp`, `redis`, `web` and `crdt-sync` (`-f maya-k8s/docker/crdt-sync/Dockerfile -t maya-crdt-sync:dev`). A rebuild that prints `Using cache` on every step means your source file did not change.

`kubectl rollout restart` did not reliably replace pods in this setup; deleting the pod does.

## 6. Simulated tests

### 6a. Dashboard simulations

Open **Simulations** (http://localhost:3000/dashboard/simulations). Six scenarios: SSH brute force, lateral movement, credential dumping, network discovery, privilege escalation, full campaign.

- The page asks the backend which K8s decoys are running and aims each scenario at the matching one (it was written for the old Vagrant names like `fake-jump-01`; those are mapped to `jump-01`, `web-03`, `ftp-01`).
- A toast says **REAL** when the scenario ran against live K8s decoys and **MOCK** when no running decoy matched.
- Each run creates a **synthetic attacker** with a random `10.30.30.x` address and the campaign "Simulated Attack (K8s)". It is recorded into the decoys' CRDT state by running commands inside the sidecar. It does not go through SSH, so it will not exercise the `ForceCommand` logging.
- Results appear under **Attackers** and on the attacker page (`/attacker/APT-10-30-30-<n>`).

The same scenarios over the API:

```bash
curl -s -X POST http://localhost:3001/api/simulation/ssh-bruteforce -H 'Content-Type: application/json' -d '{"target":"jump-01","attempts":5}' | jq
curl -s -X POST http://localhost:3001/api/simulation/discovery -H 'Content-Type: application/json' -d '{"source":"jump-01","scanType":"internal"}' | jq
curl -s -X POST http://localhost:3001/api/simulation/full-campaign -H 'Content-Type: application/json' -d '{"complexity":"advanced"}' | jq
```

Other endpoints: `lateral-movement` (`source`, `targets[]`), `credential-theft` (`target`, `tool`), `privilege-escalation` (`target`, `method`). The response has `real: true` when it ran on live decoys.

### 6b. The scripted battery (command line)

A fixed attack, identical against any SSH target: a port scan, 16 wrong-password logins, nine post-login commands (one SSH connection each), and a base64 exfil. It writes a ground-truth log you can compare against what the defender recorded.

Against Maya:

```bash
./scripts/redteam/run-battery.sh --target 127.0.0.1 --ssh-port 30022 --label maya-jump-01 --known-user admin --known-pass 'fakejump01!'
```

Against the standalone Cowrie baseline (restart it first so its log only holds this run):

```bash
docker compose -f scripts/docker/docker-compose.yml up -d cowrie
docker restart cowrie-ssh
./scripts/redteam/run-battery.sh --target 127.0.0.1 --ssh-port 2223 --label cowrie --known-user root --known-pass toor
docker cp cowrie-ssh:/cowrie/cowrie-git/var/log/cowrie/cowrie.json ./cowrie.json
```

Wait about 45 seconds for Maya's side to land, then build the comparison report (needs `npm install` in `backend/` once, and MongoDB reachable on localhost:27017, which compose publishes):

```bash
cd backend
npx ts-node scripts/redteamReport.ts --battery-log ../redteam-results/maya-jump-01-battery.jsonl --cowrie-log ../cowrie.json --maya-vm jump-01 --out ../redteam-results/report.md
```

Notes:
- Cowrie accepts any password by default, so all 16 "wrong" logins succeed there and its session count is much higher than Maya's. That is expected.
- The report's Maya section reads aggregate counts only; per-command detail is on the attacker page and in the Benchmark page.
- Run output goes to `redteam-results/` and `cowrie.json` in the repo root; both are generated, not source.

### 6c. The Benchmark page (side by side)

Open **Benchmark** (http://localhost:3000/dashboard/benchmark). It runs the same simulated attack, at the same time, against Maya, Cowrie (`bench-cowrie`) and an unprotected host (`bench-control`), then scores them. Full method and metric definitions: [EVALUATION.md](./EVALUATION.md).

1. All three targets should show **reachable**. If Maya does not, set `BENCHMARK_MAYA_HOST=host.docker.internal` in a `.env` file next to `docker-compose.yml` and run `docker compose up -d`.
2. Run once with **Adaptive attacker off**. Every target runs the full chain, so this compares what each system *records*.
3. Run again with it **on**. The attacker runs honeypot-detection probes and leaves when it has seen enough tells (default 2), so dwell time reflects how convincing each target is.
4. Read the tabs: Overview (scores, dwell chart, metrics), Timelines (every command and whether the defender saw it), Fingerprint (which probe fired where, with the evidence), Matrix (weighted categories), Raw. Export JSON or CSV from the toolbar.

A run takes a minute or two for the attack plus up to the "Telemetry wait" (default 90 s) for Maya's events to arrive. Only one run at a time is allowed. Use more repetitions (up to 10) for medians and ranges rather than trusting one run.

## 7. Manual tests

### 7a. Type commands on the Maya SSH decoy

```bash
sshpass -p 'fakejump01!' ssh -o StrictHostKeyChecking=no -p 30022 admin@127.0.0.1
```

(Or `ssh -p 30022 admin@127.0.0.1` and type the password.) At the prompt type, for example: `whoami`, a blank Enter twice, `ls /`, `cat /etc/passwd`, `uname -a`, `exit`.

After about a minute, check that each command arrived exactly once (blank Enters and `exit` are not logged):

```bash
kubectl exec -n maya-decoys deploy/jump-01 -c jump -- cat /var/lib/.state/.syscache | jq '[.attackers[].actions_per_decoy.elements[] | .action]'
```

Then open http://localhost:3000/dashboard/attackers and the attacker page. Over SSH through the kind NodePort every connection arrives as `10.244.0.1`, so your session lands on the attacker `APT-10-244-0-1`, together with every other SSH test. You should see the commands in **Command Activity** with MITRE technique badges (`whoami` T1033, `cat /etc/passwd` T1087.001, `ls /` T1083, `uname -a` T1082), and dangerous ones (for example `cat /etc/shadow`, `history -c`, `cat /etc/passwd | base64 ...`) flagged.

`/var/lib/.state/.audit.jsonl` is normally absent when you look: the sidecar processes and deletes it every 30 seconds. To catch it, read it within a few seconds of typing.

### 7b. The other decoys

```bash
curl -i http://localhost/
sshpass -p 'fakeredis01!' ssh -o StrictHostKeyChecking=no -p 30222 admin@127.0.0.1
sshpass -p 'fakeftp01!' ssh -o StrictHostKeyChecking=no -p 30122 admin@127.0.0.1
```

The HTTP decoy is `web-03`. Each decoy's SSH login is logged the same way as `jump-01`; the Redis and FTP protocols themselves are not command-logged.

### 7c. The comparison targets, by hand

Cowrie (the benchmark one) and the unprotected host are only reachable from inside the compose network. Use the backend container (it has `ssh` and `sshpass`) to type into Cowrie, and `exec` straight into the control host:

```bash
docker compose exec backend sshpass -p 'x' ssh -o StrictHostKeyChecking=no -p 2222 admin@bench-cowrie
docker compose exec -u admin bench-control sh
```

Watch what Cowrie recorded while you type:

```bash
docker compose exec bench-cowrie tail -f /cowrie/cowrie-git/var/log/cowrie/cowrie.json
```

The control host records nothing; that is the point of it.

A useful manual comparison is to run the same few commands on all three (`uname -a`, `ps aux`, `cat /etc/passwd`, `ls /definitely_not_here`) and see which ones give the game away. On Maya, `uname -a` names the gVisor kernel and `ps aux` shows a `tee` process; these are the tells the Benchmark's Fingerprint tab reports.

The Benchmark page does not score typed sessions, because it can only score attacks it sent itself. Typed sessions show up in Cowrie's log and on Maya's attacker page, not in the Benchmark results.

## 8. Where to look when something is off

| What | Command |
|---|---|
| Raw per-decoy state (what the sidecar recorded) | `kubectl exec -n maya-decoys deploy/jump-01 -c jump -- cat /var/lib/.state/.syscache \| jq` |
| Sidecar log (cycles, errors) | `kubectl exec -n maya-decoys deploy/jump-01 -c crdt-sync -- tail -20 /var/log/syslogd-helper.log` |
| Backend log | `docker compose logs backend --tail 100` |
| Events stored for an attacker | `docker compose exec mongodb mongosh maya_deception --quiet --eval 'db.attackevents.countDocuments({attackerId:"APT-10-244-0-1"})'` |
| Is the pod running the image you built? | `kubectl exec -n maya-decoys deploy/jump-01 -c jump -- grep -c _MAYA_LAST_HISTNUM /etc/maya-audit-bashrc` (should be 1 or more) |
| VM/decoy status and counts | `curl -s http://localhost:3001/api/vms \| jq` |

## 9. Resetting state

A decoy's recorded state lives in the pod's `emptyDir`, so deleting the pod clears it. Mongo keeps what the backend already stored, so clear both for a clean run:

```bash
kubectl delete pod -n maya-decoys -l app=jump-01
docker compose exec mongodb mongosh maya_deception --quiet --eval 'db.attackevents.deleteMany({attackerId:"APT-10-244-0-1"})'
docker compose exec mongodb mongosh maya_deception --quiet --eval 'db.attackers.deleteOne({attackerId:"APT-10-244-0-1"})'
```

Benchmark runs are stored in the `benchmark_runs` collection and can be left alone.

## 10. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `docker compose up` fails with "network kind … could not be found" | No cluster yet. Run `./scripts/1_Epic.sh`, or `docker network create kind` for a dashboard-only setup. |
| `kubectl` cannot connect after a reboot | `docker start maya-dev-control-plane`, then `kind export kubeconfig --name maya-dev`. |
| Pods `ImagePullBackOff` after a reboot or cluster rebuild | Images were lost. Rebuild and `kind load` them (section 5), then delete the pods. |
| Simulations say MOCK / "VM not available" | No running decoy matched the target name. Check `curl localhost:3001/api/simulation/k8s-targets` lists the four decoys, and that you rebuilt the frontend after pulling. |
| Benchmark target "unreachable" | Maya: set `BENCHMARK_MAYA_HOST=host.docker.internal`. Cowrie/control: `docker compose ps`; they start with the normal stack. Backend image missing `sshpass`: `docker compose up -d --build backend`. |
| My change does not seem to take effect | The image was rebuilt but the container or pod was not recreated, or `docker build` printed `Using cache` because your source file did not change. See section 5. |
| Typed commands do not show up | Wait up to 45 s. Then check the raw state (section 8). If the state has them but the dashboard does not, check `docker compose logs backend`. |
| Everything shows as `10.244.0.1` | Expected: the kind NodePort rewrites the source address, so separate SSH tests collapse into one attacker. |
| Dashboard shows "Disconnected" | The live WebSocket dropped (often after a backend restart). Hard-refresh the page. Most pages also poll, so data still loads. |
| Backend build fails with a TypeScript error | `docker compose build backend` prints the file and line. If it is in a file you did not edit, check your checkout matches the repo. |
| The dashboard still says "Dwell time 0" for an attacker | Rebuild the backend; dwell time is computed from the attacker's events on the attacker page. |

## 11. Known limits

- Failed-login passwords are **not** captured by Maya. Real sshd never exposes them; wrong-password attempts never reach the `ForceCommand` wrapper. Cowrie records them.
- Source addresses are lost behind the kind NodePort (all appear as `10.244.0.1`).
- Decoy state lives in `emptyDir`; recreating a pod loses whatever the backend had not yet stored.
- The human-approved escalation and the learned attacker classifier (Epics 2 and 3) are not built; the dashboard has no login.
- T-Pot is not run. Cowrie, the SSH honeypot inside it, stands in.

For what is built versus pending, see [STATUS.md](./STATUS.md).
