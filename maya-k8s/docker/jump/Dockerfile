# Build context is the repo root (see scripts/1_Epic.sh / CI) so this stage
# can reach scripts/crdt/, the single source of truth for the CRDT engine --
# same binary the Vagrant decoys use, statically linked (musl) so it runs
# unmodified on this alpine base.
FROM rust:1-alpine AS crdt-builder
RUN apk add --no-cache musl-dev
RUN rustup target add x86_64-unknown-linux-musl
WORKDIR /crdt
COPY scripts/crdt/Cargo.toml scripts/crdt/Cargo.lock ./
COPY scripts/crdt/src ./src
RUN cargo build --release --target x86_64-unknown-linux-musl

FROM alpine:3.18

# Mirrors fake-jump-01's Vagrant provisioner. Docker-in-Docker packages
# (docker, docker-cli-compose, openrc) are dropped -- that was for the VM
# to run its own nested macvlan/bridge networks, which K8s Services and
# NetworkPolicy now handle at the cluster level.

RUN apk update && \
    apk add --no-cache openssh bash shadow && \
    ssh-keygen -A

RUN adduser -D admin && \
    addgroup admin wheel && \
    echo "%wheel ALL=(ALL) ALL" >> /etc/sudoers

# Password is set at container start from the mounted Secret (see entrypoint.sh)
# rather than baked in, so k8s/config/breadcrumb-credentials.yaml is the
# single source of truth.

COPY maya-k8s/docker/jump/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY --from=crdt-builder /crdt/target/x86_64-unknown-linux-musl/release/maya-crdt /usr/local/bin/syslogd-helper
RUN chmod +x /usr/local/bin/syslogd-helper

EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]
