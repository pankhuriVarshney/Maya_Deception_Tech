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
COPY maya-k8s/docker/common/decoy-audit-wrapper.sh /usr/local/bin/decoy-audit-wrapper.sh
COPY maya-k8s/docker/common/maya-audit-bashrc.sh /etc/maya-audit-bashrc
RUN chmod +x /entrypoint.sh /usr/local/bin/decoy-audit-wrapper.sh

# The CRDT engine (scripts/crdt/) no longer lives in this image -- it runs
# in a separate crdt-sync sidecar container in the same Pod (see
# k8s/decoy/jump/deployment.yaml), sharing only the syscache volume, so it
# never appears in this container's own filesystem or process list.

EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]
