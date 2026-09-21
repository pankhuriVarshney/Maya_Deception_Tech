# Build context is the repo root (see scripts/1_Epic.sh / CI) so this stage
# can reach scripts/crdt/, the single source of truth for the CRDT engine --
# same binary the Vagrant decoys use, statically linked (musl) so it runs
# unmodified on this debian-slim base.
FROM rust:1-alpine AS crdt-builder
RUN apk add --no-cache musl-dev
RUN rustup target add x86_64-unknown-linux-musl
WORKDIR /crdt
COPY scripts/crdt/Cargo.toml scripts/crdt/Cargo.lock ./
COPY scripts/crdt/src ./src
RUN cargo build --release --target x86_64-unknown-linux-musl

FROM debian:12-slim

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
      nginx openssh-server redis-tools sudo supervisor && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /var/run/sshd /var/lib/nginx/body /var/lib/nginx/fastcgi /var/lib/nginx/proxy /var/lib/nginx/scgi /var/lib/nginx/uwsgi

RUN useradd -m -s /bin/bash admin && \
    usermod -aG sudo admin

# Fake content now comes from a mounted ConfigMap (see k8s/decoy/web/configmap.yaml)
# instead of being echoed into the image at build time -- lets breadcrumb
# content change without a rebuild.

COPY --from=crdt-builder /crdt/target/x86_64-unknown-linux-musl/release/maya-crdt /usr/local/bin/syslogd-helper
RUN chmod +x /usr/local/bin/syslogd-helper

COPY maya-k8s/docker/web/supervisord.conf /etc/supervisor/conf.d/web.conf
COPY maya-k8s/docker/web/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22 80
ENTRYPOINT ["/entrypoint.sh"]
