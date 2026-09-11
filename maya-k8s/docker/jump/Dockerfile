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

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY syslogd-helper /usr/local/bin/syslogd-helper
RUN chmod +x /usr/local/bin/syslogd-helper

EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]
