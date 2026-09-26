FROM debian:12-slim

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
      redis-server openssh-server sudo supervisor && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /var/run/sshd

RUN useradd -m -s /bin/bash admin && \
    usermod -aG sudo admin

# The CRDT engine (scripts/crdt/) no longer lives in this image -- it runs
# in a separate crdt-sync sidecar container in the same Pod (see
# k8s/decoy/redis/deployment.yaml), sharing only the syscache volume, so it
# never appears in this container's own filesystem or process list.

COPY maya-k8s/docker/redis/supervisord.conf /etc/supervisor/conf.d/redis.conf
COPY maya-k8s/docker/redis/entrypoint.sh /entrypoint.sh
COPY maya-k8s/docker/common/decoy-audit-wrapper.sh /usr/local/bin/decoy-audit-wrapper.sh
COPY maya-k8s/docker/common/maya-audit-bashrc.sh /etc/maya-audit-bashrc
RUN chmod +x /entrypoint.sh /usr/local/bin/decoy-audit-wrapper.sh

EXPOSE 22 6379
ENTRYPOINT ["/entrypoint.sh"]
