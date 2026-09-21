# Maya — Epic 1: Kubernetes Migration Foundation

Translates the current Vagrant decoy VMs (`fake-web-03`, `fake-redis-01`,
`fake-jump-01`) into K8s-native decoys, plus a minimal Decoy Lifecycle
Manager and CI pipeline. `gateway-vm` and `fake-rdp-01` are intentionally
**not** migrated in this pass — see "What's deliberately left out" below.

## Layout

```
docker/                  # decoy container images, one dir per type
  web-decoy/
  redis-decoy/
  jump-decoy/
lifecycle-manager/        # Go service: provision/terminate/scale decoys
k8s/
  namespaces.yaml          # maya-decoys / maya-control / maya-telemetry + NetworkPolicy
  config/                  # shared: secrets, syslogd-helper, lifecycle-manager deploy
  decoy/
    web/
    reddis/
    jump/
.github/workflows/         # CI: matrix build + smoke test + push to GHCR
```

## Run it locally (kind)

```bash
# 1. Local cluster
kind create cluster --name maya-dev

# 2. Namespaces + network policy + shared config first
kubectl apply -f k8s/namespaces.yaml
kubectl apply -f k8s/config/breadcrumb-credentials.yaml
kubectl apply -f k8s/config/syslogd-helper-configmap.yaml

# 3. Build decoy images and load them into kind (no registry needed for local dev)
#    NOTE: run these three build commands from the repo root, not from
#    maya-k8s/ -- each Dockerfile has a stage that compiles the CRDT engine
#    from ../scripts/crdt/, which is only reachable from the root context.
#    (see scripts/1_Epic.sh for a version of this whole flow that does the
#    cd for you)
cd ..
docker build -t maya-web:dev -f maya-k8s/docker/web/Dockerfile .
docker build -t maya-redis:dev -f maya-k8s/docker/redis/Dockerfile .
docker build -t maya-jump:dev -f maya-k8s/docker/jump/Dockerfile .
cd maya-k8s
kind load docker-image maya-web:dev --name maya-dev
kind load docker-image maya-redis:dev --name maya-dev
kind load docker-image maya-jump:dev --name maya-dev

# 4. Point the manifests at the :dev tags before applying, e.g.:
#    kubectl set image deployment/fake-web-03 web-decoy=maya-web-decoy:dev -n maya-decoys
kubectl apply -f k8s/decoy/web/
kubectl apply -f k8s/decoy/reddis/
kubectl apply -f k8s/decoy/jump/

# 5. Verify
kubectl get pods -n maya-decoys
kubectl exec -n maya-decoys deploy/web-03 -- syslogd-helper stats
```

```bash 
kubectl port-forward -n maya-decoys svc/jump-01 2222:22
# in another terminal:
ssh admin@localhost -p 2222
# password: fakejump01!
```



## Before this touches anything real

- `k8s/config/breadcrumb-credentials.yaml` uses plain `Secret` (base64,
  not encrypted at rest by default). Swap for sealed-secrets or an
  external-secrets-operator + Vault/AWS Secrets Manager before any
  non-throwaway deployment.
- `ghcr.io/Maya/...` and `Maya` in the CI workflow are placeholders.
- The lifecycle manager has **no auth** on its HTTP endpoints yet — that's
  explicitly Epic 5's job (mTLS + JWT + RBAC, moved fully into
  `maya-control` with NetworkPolicy isolation). Don't expose it beyond
  the cluster in the meantime.

## What's deliberately left out of this pass

- **`gateway-vm`**: did NAT/traffic-steering via iptables. Its job is now
  split between K8s `NetworkPolicy` (this repo) and traffic-steering
  logic (Ingress/service mesh) — that's closer to Epic 1's "Phase 2:
  Traffic Steering" in the architecture doc, worth its own follow-up
  rather than folding into decoy containerization.
- **`fake-rdp-01`**: xrdp + xfce4 in a bare container is a poor fit —
  no real display server, dbus friction, minimal payoff at `runc` tier.
  Better suited to the Kata/Vagrant high-fidelity tier in Epic 2; revisit
  then rather than forcing it into a container now.

## What changed vs. the Vagrant provisioners

- `docker network create macvlan/bridge` (run *inside* each VM) is gone —
  that was VM-level Docker-in-Docker; K8s Services + NetworkPolicy replace
  it at the cluster level.
- `systemctl enable/start` → `supervisord` (web, redis — multi-process) or
  a plain foreground `exec` (jump — single-process).
- Hardcoded `chpasswd` calls → `DECOY_PASSWORD` env var sourced from a
  K8s `Secret`, set at container start.
- Fake web content (`echo ... > index.html`) → `ConfigMap`, mounted as a
  volume — content can change without a rebuild.
- `syslogd-helper` script is unchanged logic, just now shipped via
  `k8s/config/syslogd-helper-configmap.yaml` for consistency across
  decoy types (still baked into the image too, for now — Epic 4 replaces
  this with a real sidecar).

## Next after this Epic

Epic 2 (Kata + gVisor): every deployment above has a commented-out
`runtimeClassName: kata-containers` line — installing the Kata
RuntimeClass in-cluster and uncommenting that line is the entire
integration point, no manifest rewrites needed.
