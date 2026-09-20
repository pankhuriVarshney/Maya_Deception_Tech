#!/usr/bin/env bash
#
# kata-baremetal-prep.sh -- Stage 1 of bare-metal Kata Containers setup.
#
# Unlike gVisor-in-kind, Kata needs to run against a containerd instance
# that has real access to /dev/kvm on the actual host -- so this script
# operates directly on your Arch machine, not inside a kind node container.
#
# What it does:
#   1. Verifies KVM is actually usable (module loaded + /dev/kvm permissions)
#   2. Finds the containerd that Docker installed and enables its CRI plugin
#      (Docker disables CRI by default since dockerd doesn't need it -- this
#      is the #1 reason "kubeadm init" fails on a fresh Docker+containerd box)
#   3. Downloads the official Kata static release tarball and installs it
#      to /opt/kata (upstream's recommended distro-agnostic method)
#   4. Registers kata as a containerd runtime (io.containerd.kata.v2)
#   5. Runs a standalone smoke test via `ctr` (no Kubernetes involved yet)
#      that proves a container really boots inside a Kata VM by comparing
#      the guest kernel version against the host's.
#
# This intentionally stops BEFORE touching swap/sysctl/kubeadm -- those are
# cluster-wide, harder-to-undo changes and belong in stage 2, run only after
# this stage confirms Kata+KVM actually works.
#
# Run individual stages: ./kata-baremetal-prep.sh <stage>
# Stages: kvm-check | fix-containerd | install-kata | register-runtime | verify | all (default)

set -euo pipefail

KATA_VERSION="${KATA_VERSION:-3.10.0}"  # override with KATA_VERSION=x.y.z env var if needed
KATA_TARBALL="kata-static-${KATA_VERSION}-amd64.tar.xz"
KATA_URL="https://github.com/kata-containers/kata-containers/releases/download/${KATA_VERSION}/${KATA_TARBALL}"
CONTAINERD_CONF="/etc/containerd/config.toml"

STAGE="${1:-all}"

need_root() {
  if [ "$EUID" -ne 0 ]; then
    echo "This stage needs root. Re-run with sudo."
    exit 1
  fi
}

stage_kvm_check() {
  echo "==> Checking KVM availability"
  if ! lsmod | grep kvm; then
    echo "  ✗ no kvm kernel module loaded (kvm_intel or kvm_amd)"
    echo "    Try: sudo modprobe kvm_intel   (or kvm_amd on AMD)"
    exit 1
  fi
  echo "  ✓ kvm module loaded: $(lsmod | grep ^kvm | awk '{print $1}' | tr '\n' ' ')"

  if [ ! -e /dev/kvm ]; then
    echo "  ✗ /dev/kvm does not exist -- virtualization may be disabled in BIOS"
    exit 1
  fi

  if [ ! -r /dev/kvm ] || [ ! -w /dev/kvm ]; then
    echo "  ✗ /dev/kvm exists but current user lacks rw access"
    echo "    Try: sudo usermod -aG kvm \$USER   (then re-login)"
    exit 1
  fi
  echo "  ✓ /dev/kvm present and accessible: $(ls -l /dev/kvm)"
}

stage_fix_containerd() {
  need_root
  echo "==> Locating containerd (installed as Docker's dependency)"
  if ! command -v containerd >/dev/null; then
    echo "  ✗ containerd binary not found -- is Docker actually installed? (pacman -Qi docker)"
    exit 1
  fi
  echo "  ✓ containerd found: $(containerd --version)"

  mkdir -p /etc/containerd
  if [ ! -f "$CONTAINERD_CONF" ]; then
    echo "==> No existing containerd config -- generating default"
    containerd config default > "$CONTAINERD_CONF"
  else
    echo "==> Existing containerd config found at $CONTAINERD_CONF -- backing up"
    cp "$CONTAINERD_CONF" "${CONTAINERD_CONF}.bak.$(date +%s)"
  fi

  echo "==> Checking whether CRI plugin is disabled (Docker's default does this)"
  if grep -q 'disabled_plugins.*cri' "$CONTAINERD_CONF" 2>/dev/null; then
    echo "  Found disabled_plugins referencing cri -- removing it"
    sed -i '/disabled_plugins/d' "$CONTAINERD_CONF"
    echo "  ✓ CRI plugin re-enabled"
  else
    echo "  ✓ CRI plugin already enabled (not in disabled_plugins)"
  fi

  echo "==> Ensuring SystemdCgroup = true (required by kubeadm)"
  if grep -q 'SystemdCgroup' "$CONTAINERD_CONF"; then
    sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' "$CONTAINERD_CONF"
  fi
  grep -q 'SystemdCgroup = true' "$CONTAINERD_CONF" && echo "  ✓ SystemdCgroup = true set" \
    || echo "  ! could not confirm SystemdCgroup=true -- check $CONTAINERD_CONF manually"

  echo "==> Restarting containerd"
  systemctl enable --now containerd
  systemctl restart containerd
  sleep 2
  systemctl is-active --quiet containerd && echo "  ✓ containerd is running" \
    || { echo "  ✗ containerd failed to start -- check: journalctl -u containerd -n 50"; exit 1; }
}

stage_install_kata() {
  need_root
  echo "==> Downloading Kata static release ${KATA_VERSION}"
  TMP_DIR=$(mktemp -d)
  trap 'rm -rf "$TMP_DIR"' EXIT

  curl -fL "$KATA_URL" -o "$TMP_DIR/$KATA_TARBALL"

  echo "==> Extracting to /opt/kata"
  rm -rf /opt/kata.new
  mkdir -p /opt/kata.new
  tar -xJf "$TMP_DIR/$KATA_TARBALL" -C /opt/kata.new

  # Atomic swap in case /opt/kata already exists from a previous run/version
  if [ -d /opt/kata ]; then
    mv /opt/kata "/opt/kata.old.$(date +%s)"
  fi
  mv /opt/kata.new/opt/kata /opt/kata
  rmdir /opt/kata.new 2>/dev/null || true

  echo "==> Symlinking kata binaries into /usr/local/bin"
  ln -sf /opt/kata/bin/kata-runtime /usr/local/bin/kata-runtime
  ln -sf /opt/kata/bin/containerd-shim-kata-v2 /usr/local/bin/containerd-shim-kata-v2

  echo "==> Verifying installation"
  /usr/local/bin/kata-runtime --version

  echo "==> Running kata-runtime's own hardware check"
  /usr/local/bin/kata-runtime kata-check || {
    echo "  ✗ kata-check reported problems -- see output above (commonly: KVM permissions, missing hardware virt)"
    exit 1
  }
  echo "  ✓ kata-check passed"
}

stage_register_runtime() {
  need_root
  echo "==> Detecting containerd config schema version"
  # containerd 2.x's 'containerd config default' generates a version-3 config
  # that uses the plugin id io.containerd.cri.v1.runtime. Versions before 2.0
  # (config version <=2) use the older io.containerd.grpc.v1.cri plugin id.
  # Appending the runtime block under the wrong id doesn't error -- containerd
  # just silently treats it as an unused table, which shows up later as
  # "no runtime for kata is configured" when a pod tries to use it.
  CONFIG_VERSION=$(grep -E '^version\s*=' "$CONTAINERD_CONF" | grep -o '[0-9]\+' | head -1)
  if [ "${CONFIG_VERSION:-2}" -ge 3 ]; then
    CRI_PLUGIN_ID="io.containerd.cri.v1.runtime"
  else
    CRI_PLUGIN_ID='io.containerd.grpc.v1.cri'
  fi
  echo "  config version=${CONFIG_VERSION:-2} -> using plugin id: ${CRI_PLUGIN_ID}"

  echo "==> Registering kata as a containerd runtime"
  # Clean up a block registered under the wrong plugin id from a previous run,
  # if present, so we don't end up with a stale/ignored duplicate.
  for OTHER_ID in "io.containerd.cri.v1.runtime" 'io.containerd.grpc.v1.cri'; do
    if [ "$OTHER_ID" != "$CRI_PLUGIN_ID" ]; then
      sed -i "\#\[plugins\.[\"']${OTHER_ID}[\"']\.containerd\.runtimes\.kata\]#,+1d" "$CONTAINERD_CONF"
    fi
  done

  if grep -q "plugins.'${CRI_PLUGIN_ID}'.containerd.runtimes.kata\|plugins.\"${CRI_PLUGIN_ID}\".containerd.runtimes.kata" "$CONTAINERD_CONF" 2>/dev/null; then
    echo "  kata runtime already registered under ${CRI_PLUGIN_ID}, skipping"
  else
    cat >> "$CONTAINERD_CONF" << EOF

[plugins.'${CRI_PLUGIN_ID}'.containerd.runtimes.kata]
  runtime_type = "io.containerd.kata.v2"
EOF
    echo "  ✓ kata runtime block appended under ${CRI_PLUGIN_ID} in $CONTAINERD_CONF"
  fi

  echo "==> Restarting containerd to pick up the new runtime"
  systemctl restart containerd
  sleep 2
  systemctl is-active --quiet containerd && echo "  ✓ containerd restarted cleanly" \
    || { echo "  ✗ containerd failed to restart -- check: journalctl -u containerd -n 50"; exit 1; }
}

stage_verify() {
  echo "==> Standalone smoke test: host kernel vs. Kata guest kernel"
  echo "  Host kernel:  $(uname -r)"

  echo "==> Pulling a small test image via ctr"
  ctr image pull docker.io/library/busybox:latest >/dev/null

  echo "==> Running container under the kata runtime"
  GUEST_KERNEL=$(ctr run --rm --runtime io.containerd.kata.v2 \
    docker.io/library/busybox:latest kata-smoke-test uname -r)

  echo "  Guest kernel: $GUEST_KERNEL"

  if [ "$GUEST_KERNEL" != "$(uname -r)" ]; then
    echo "  ✓ guest kernel differs from host -- this is a real Kata VM, not a shared-kernel container"
  else
    echo "  ✗ guest kernel matches host kernel exactly -- something's wrong, this looks like it ran as a normal container"
    exit 1
  fi
}

case "$STAGE" in
  kvm-check)        stage_kvm_check ;;
  fix-containerd)    stage_fix_containerd ;;
  install-kata)      stage_install_kata ;;
  register-runtime)  stage_register_runtime ;;
  verify)            stage_verify ;;
  all)
    stage_kvm_check
    stage_fix_containerd
    stage_install_kata
    stage_register_runtime
    stage_verify
    echo
    echo "All stages passed. Kata + KVM is verified working standalone on this host."
    echo "Next: bare-metal kubeadm cluster bring-up + kata RuntimeClass (stage 2, separate script)."
    ;;
  *)
    echo "Unknown stage: $STAGE"
    echo "Usage: $0 [kvm-check|fix-containerd|install-kata|register-runtime|verify|all]"
    exit 1
    ;;
esac