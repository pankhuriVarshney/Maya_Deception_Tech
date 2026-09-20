#!/usr/bin/env bash
#
# install-gvisor-kind.sh -- installs gVisor (runsc) onto every node of an
# existing kind cluster and registers it as a containerd runtime, so K8s
# can schedule pods against it via RuntimeClass.
#
# kind nodes are just Docker containers running containerd+kubelet, so
# "installing gVisor on the node" means docker exec-ing in and dropping
# the binaries + a containerd config patch, then restarting containerd
# inside that container. No host-level changes needed -- this is why
# gVisor works in kind while Kata does not (Kata needs real KVM passthrough,
# which kind's nodes-as-containers model doesn't provide).
#
# Binaries are downloaded to a temp path and then `mv`'d into place rather
# than written directly over /usr/local/bin/runsc. This avoids ETXTBSY
# ("Text file busy") if the binary is currently open/in-use (e.g. a
# previous install already succeeded and containerd is running it) --
# `mv` on the same filesystem just swaps the directory entry and doesn't
# touch the inode a running process still holds open. This also makes
# the script safe to re-run for upgrades.

set -euo pipefail

CLUSTER_NAME="${1:-maya-dev}"
GVISOR_VERSION="latest" # pin to a specific release tag later if you want reproducibility

NODES=$(kind get nodes --name "$CLUSTER_NAME")
if [ -z "$NODES" ]; then
  echo "No nodes found for cluster '$CLUSTER_NAME'. Is it running?"
  exit 1
fi

for node in $NODES; do
  echo "==> Installing gVisor on node: $node"

  docker exec "$node" bash -c "
    set -e
    ARCH=\$(uname -m)
    case \$ARCH in
      x86_64) GVISOR_ARCH=x86_64 ;;
      aarch64) GVISOR_ARCH=aarch64 ;;
      *) echo \"Unsupported arch: \$ARCH\"; exit 1 ;;
    esac

    URL_BASE=https://storage.googleapis.com/gvisor/releases/release/${GVISOR_VERSION}/\${GVISOR_ARCH}

    TMP_DIR=\$(mktemp -d)
    trap 'rm -rf \"\$TMP_DIR\"' EXIT

    # As of 2026-07, gVisor stopped publishing runsc / containerd-shim-runsc-v1
    # as loose files -- they're now bundled into a single tarball alongside a
    # gvisor-bin/ sidecar directory that runsc looks for next to itself at
    # runtime. Using .tar.bz2 (not .tar.zstd) since it doesn't depend on a
    # zstd binary being present on the minimal kind node image.
    curl -fsSL \${URL_BASE}/gvisor.tar.bz2 -o \"\$TMP_DIR/gvisor.tar.bz2\"
    curl -fsSL \${URL_BASE}/gvisor.tar.bz2.sha512 -o \"\$TMP_DIR/gvisor.tar.bz2.sha512\"
    (cd \"\$TMP_DIR\" && sha512sum -c gvisor.tar.bz2.sha512)

    # The kind node image doesn't ship bzip2 by default -- tar shells out to
    # it for -j/--bzip2 rather than linking it in, so without the binary
    # present tar fails with 'Cannot exec: No such file or directory' even
    # though the tarball downloaded and verified fine.
    if ! command -v bzip2 >/dev/null 2>&1; then
      apt-get update -qq && apt-get install -y -qq bzip2 >/dev/null
    fi

    mkdir -p \"\$TMP_DIR/extracted\"
    tar -xjf \"\$TMP_DIR/gvisor.tar.bz2\" -C \"\$TMP_DIR/extracted\"
    chmod +x \"\$TMP_DIR/extracted/runsc\" \"\$TMP_DIR/extracted/containerd-shim-runsc-v1\"

    # Atomic swap -- immune to ETXTBSY even if the old binary is
    # currently running/open under containerd.
    mv \"\$TMP_DIR/extracted/runsc\" /usr/local/bin/runsc
    mv \"\$TMP_DIR/extracted/containerd-shim-runsc-v1\" /usr/local/bin/containerd-shim-runsc-v1
    rm -rf /usr/local/bin/gvisor-bin
    mv \"\$TMP_DIR/extracted/gvisor-bin\" /usr/local/bin/gvisor-bin

    /usr/local/bin/runsc --version
  "

  echo "==> Registering runsc as a containerd runtime on $node"
  docker exec "$node" bash -c "
    set -e
    CONF=/etc/containerd/config.toml

    if grep -q 'plugins.\"io.containerd.grpc.v1.cri\".containerd.runtimes.runsc' \$CONF; then
      echo 'runsc runtime already registered, skipping'
    else
      cat >> \$CONF << 'EOF'

[plugins.\"io.containerd.grpc.v1.cri\".containerd.runtimes.runsc]
  runtime_type = \"io.containerd.runsc.v1\"
EOF
    fi
  "

  echo "==> Restarting containerd on $node"
  docker exec "$node" bash -c "systemctl restart containerd"

  echo "==> Waiting for kubelet/containerd to settle on $node"
  sleep 3
done

echo
echo "gVisor installed on all nodes of cluster '$CLUSTER_NAME'."
echo "Next: kubectl apply -f k8s/runtimeclass.yaml"