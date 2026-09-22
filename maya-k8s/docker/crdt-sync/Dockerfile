# Sidecar-only image for the CRDT engine. It runs as a second container in
# the same Pod as each decoy (see k8s/decoy/*/deployment.yaml), sharing only
# the `syscache` emptyDir volume with the decoy container -- never the decoy
# container's own filesystem or PID namespace. An attacker with a shell in
# the decoy container has no binary, no process, and no /proc entry to find
# here: separate rootfs and separate PID namespace are what Kubernetes
# already gives sibling containers in a Pod by default.
#
# Build context is the repo root (see scripts/1_Epic.sh / CI) so this stage
# can reach scripts/crdt/, the single source of truth for the CRDT engine --
# same binary the Vagrant decoys and (previously) the K8s decoy images used,
# statically linked (musl).
FROM rust:1-alpine AS crdt-builder
RUN apk add --no-cache musl-dev
RUN rustup target add x86_64-unknown-linux-musl
WORKDIR /crdt
COPY scripts/crdt/Cargo.toml scripts/crdt/Cargo.lock ./
COPY scripts/crdt/src ./src
RUN cargo build --release --target x86_64-unknown-linux-musl

FROM debian:12-slim

# openssh-client only -- the binary's own `daemon`/`sync` modes shell out to
# scp/ssh for peer-to-peer gossip (see scripts/crdt/README.md). No server,
# no listening port: this container stays silent on the Pod's shared network
# namespace on purpose, since anything it listened on would be visible to
# the decoy container's own `ss -tlnp`.
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      openssh-client && \
    rm -rf /var/lib/apt/lists/*

RUN useradd -r -u 10001 -m -d /home/crdt -s /usr/sbin/nologin crdt && \
    mkdir -p /var/log && touch /var/log/syslogd-helper.log && \
    chown crdt:crdt /var/log/syslogd-helper.log

COPY --from=crdt-builder /crdt/target/x86_64-unknown-linux-musl/release/maya-crdt /usr/local/bin/syslogd-helper
RUN chmod +x /usr/local/bin/syslogd-helper

USER crdt

# `daemon` mode reloads state, gossips with any configured peers, and saves
# on a loop -- no cron, no timer unit, matches the "no persistent footprint"
# philosophy in scripts/crdt/README.md, just relocated to a container the
# decoy's own shell can't see into.
ENTRYPOINT ["/usr/local/bin/syslogd-helper"]
CMD ["daemon"]
