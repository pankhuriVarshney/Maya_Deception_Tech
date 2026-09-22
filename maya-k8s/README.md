# Maya — Kubernetes Decoy Fabric

K8s-native decoys (web, redis, jump, ftp) running under gVisor by default,
with a Kata-containers escalation tier for a bare-metal cluster (see
`kata-*.sh`). This is the **default** deception fabric — see
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) at the repo root for how it
relates to the Vagrant fabric (reserved as the final, human-approved
escalation tier).

Status against the original Epic 1-9 migration plan this README used to
describe: see [docs/STATUS.md](../docs/STATUS.md) — this file now just
documents how to run what's here, not what's still pending.

## Layout

```
docker/                  # decoy container images, one dir per type
  web/  redis/  jump/  ftp/
  crdt-sync/              # CRDT engine sidecar -- shares each decoy Pod, not its container
lifecycle-manager/        # Go service: provision/terminate/scale/status decoys
k8s/
  namespaces.yaml          # maya-decoys / maya-control / maya-telemetry + NetworkPolicy
  runtimeclass.yaml         # gvisor (works in kind) + kata-containers (bare-metal only)
  config/                  # shared: secrets, syslogd-helper, lifecycle-manager deploy
  decoy/
    web/    # + ingress.yaml -- the HTTP front door
    redis/  # NodePort (30222 ssh / 30637 redis)
    jump/   # NodePort (30022 ssh)
    ftp/    # NodePort (30122 ssh / 30021 ftp)
.github/workflows/         # CI: matrix build + smoke test + push to GHCR
```

## Run it locally (kind)

The easy way — does everything below in one shot, plus verification:

```bash
# from the repo root, not maya-k8s/
./scripts/1_Epic.sh
```

That script: creates the kind cluster (with host ports mapped for the
Ingress and each decoy's NodePort), installs gVisor + the RuntimeClass,
installs nginx-ingress, builds and deploys the lifecycle-manager, builds
and deploys all four decoys, and runs a full health check.

### Doing it by hand

```bash
# 1. Local cluster -- with port mappings so the Ingress/NodePorts below are
#    actually reachable from your host (skip the --config block to fall
#    back to kubectl port-forward instead)
kind create cluster --name maya-dev --config - << 'EOF'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    extraPortMappings:
      - {containerPort: 80, hostPort: 80, protocol: TCP}
      - {containerPort: 443, hostPort: 443, protocol: TCP}
      - {containerPort: 30022, hostPort: 30022, protocol: TCP}
      - {containerPort: 30222, hostPort: 30222, protocol: TCP}
      - {containerPort: 30637, hostPort: 30637, protocol: TCP}
      - {containerPort: 30122, hostPort: 30122, protocol: TCP}
      - {containerPort: 30021, hostPort: 30021, protocol: TCP}
EOF

# 2. gVisor + RuntimeClass
../maya-k8s/install-gvisor-kind.sh maya-dev   # or: bash install-gvisor-kind.sh maya-dev
kubectl apply -f k8s/runtimeclass.yaml

# 3. nginx Ingress controller (kind-specific manifest)
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
kubectl wait --namespace ingress-nginx --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller --timeout=120s

# 4. Namespaces, lifecycle-manager, shared config
kubectl apply -f k8s/namespaces.yaml
docker build -t maya-lifecycle-manager:dev lifecycle-manager
kind load docker-image maya-lifecycle-manager:dev --name maya-dev
kubectl apply -f k8s/config/lifecycle-manager-deployment.yaml
kubectl apply -f k8s/config/breadcrumb-credentials.yaml
kubectl apply -f k8s/config/syslogd-helper-configmap.yaml

# 5. Build decoy images and load them into kind (run from the repo root --
#    the crdt-sync sidecar image compiles the CRDT engine from
#    ../scripts/crdt/, only reachable from the root context; the decoy
#    images themselves no longer contain it at all)
cd ..
docker build -t maya-web:dev   -f maya-k8s/docker/web/Dockerfile .
docker build -t maya-redis:dev -f maya-k8s/docker/redis/Dockerfile .
docker build -t maya-jump:dev  -f maya-k8s/docker/jump/Dockerfile .
docker build -t maya-ftp:dev   -f maya-k8s/docker/ftp/Dockerfile .
docker build -t maya-crdt-sync:dev -f maya-k8s/docker/crdt-sync/Dockerfile .
cd maya-k8s
kind load docker-image maya-web:dev maya-redis:dev maya-jump:dev maya-ftp:dev maya-crdt-sync:dev --name maya-dev

# 6. Deploy the decoys
kubectl apply -f k8s/decoy/web/
kubectl apply -f k8s/decoy/redis/
kubectl apply -f k8s/decoy/jump/
kubectl apply -f k8s/decoy/ftp/

# 7. Verify
kubectl get pods -n maya-decoys
# syslogd-helper lives in the crdt-sync sidecar container, not web-03's own
# "web" container -- see "CRDT binary placement" below.
kubectl exec -n maya-decoys deploy/web-03 -c crdt-sync -- syslogd-helper stats
curl http://localhost/                          # web-03, via Ingress
ssh admin@localhost -p 30022                     # jump-01, password: fakejump01!
curl http://localhost:18081/status &              # lifecycle-manager, needs port-forward first:
kubectl port-forward -n maya-control deploy/decoy-lifecycle-manager 18081:8081
```

## Before this touches anything real

- `k8s/config/breadcrumb-credentials.yaml` uses plain `Secret` (base64,
  not encrypted at rest by default). Swap for sealed-secrets or an
  external-secrets-operator + Vault/AWS Secrets Manager before any
  non-throwaway deployment.
- `ghcr.io/<org>/...` in the CI workflow is still a placeholder — set it to
  a real org before relying on the pushed images; locally everything runs
  off `:dev` tags built and `kind load`-ed directly, no registry needed.
- The lifecycle manager has **no auth** on its HTTP endpoints. Don't
  expose it beyond the cluster (it isn't — `maya-control`'s NetworkPolicy
  keeps it unreachable from `maya-decoys`, but there's still no
  authentication on the endpoints themselves for anything that *can*
  reach it).

## Intentionally not in scope

- **RDP and SMB decoys**: not containerized, on purpose, not as a gap.
  RDP needs a real display server (xrdp+xfce4 in a bare container is a
  poor, easily-fingerprinted fit) and SMB has similar friction; both are
  reserved for the Vagrant tier, which already runs them with full VM
  fidelity. This fits the tiering design: simple/common services default
  to K8s, complex/exotic ones live in the high-fidelity escalation tier.
- **Kata for local dev**: needs real `/dev/kvm` passthrough that kind's
  container-based nodes can't provide. See `kata-prep.sh` / `kata-cluster.sh`
  / `kata-migrate.sh` for the bare-metal path — a separate cluster, not a
  kind flag.
- **Automatic tier escalation** (gVisor → Kata → Vagrant based on attacker
  behavior): the tiers exist and can all run decoys; the classifier that
  moves an attacker between them doesn't exist yet.

## What changed vs. the Vagrant provisioners

- `docker network create macvlan/bridge` (run *inside* each VM) is gone —
  that was VM-level Docker-in-Docker; K8s Services + NetworkPolicy replace
  it at the cluster level.
- `gateway-vm`'s NAT/traffic-steering role is now split between K8s
  `NetworkPolicy` (unchanged from before) and the nginx Ingress + fixed
  NodePorts (new) — every decoy has a real front door now, not just
  `kubectl port-forward`.
- `systemctl enable/start` → `supervisord` (web, redis, ftp — multi-process)
  or a plain foreground `exec` (jump — single-process).
- Hardcoded `chpasswd` calls → `DECOY_PASSWORD` env var sourced from a
  K8s `Secret`, set at container start.
- Fake web content (`echo ... > index.html`) → `ConfigMap`, mounted as a
  volume — content can change without a rebuild.
- `syslogd-helper` is the **real** Rust CRDT binary now (compiled from
  `scripts/crdt/` via a multi-stage Docker build), not a stub shell
  script — same binary the Vagrant decoys use, state file at
  `/var/lib/.state/.syscache` (configurable via `MAYA_STATE_FILE`;
  deliberately not `/var/lib/maya/...` — a directory literally named
  "maya" would be its own fingerprint). It no longer lives inside the
  decoy image at all — see "CRDT binary placement" below.

## CRDT binary placement (hiding it from an in-pod attacker)

`runtimeClassName: gvisor`/`kata-containers` isolates a decoy Pod from the
*host* — it says nothing about what's visible to someone who already has a
shell *inside* that Pod's own decoy container. Baking `syslogd-helper` into
the decoy image (the old approach) meant an attacker who landed a shell
could trivially `ls /usr/local/bin`, `file syslogd-helper`, or `strings` it
and find an oddly-large "syslog" binary that isn't a real syslog tool.

The CRDT engine now runs in a separate `crdt-sync` sidecar container
(`docker/crdt-sync/Dockerfile`) inside the *same Pod* as each decoy, not
inside the decoy's own container. Sibling containers in a Pod get their own
filesystem and PID namespace by default in Kubernetes — no `nsenter`,
`hostPID`, or `shareProcessNamespace` involved, all of which would leak the
sidecar's process list back to the decoy container and defeat the point.
The two containers share only the `syscache` `emptyDir` volume (unchanged
from before), so the decoy container's own `ls`, `ps`, and `/proc` show
nothing related to CRDT at all. The sidecar also never listens on a
network port, since containers in a Pod share the network namespace and a
listening socket would show up in the decoy container's own `ss -tlnp`
even with PID attribution stripped away — it just runs `syslogd-helper
daemon` in a loop (reload state, gossip with configured peers over
outbound scp/ssh, save), the same "no cron, no persistent footprint"
design already described in `scripts/crdt/README.md`.

Query it the same way as before, just naming the sidecar container:

```bash
kubectl exec -n maya-decoys deploy/web-03 -c crdt-sync -- syslogd-helper stats
```
