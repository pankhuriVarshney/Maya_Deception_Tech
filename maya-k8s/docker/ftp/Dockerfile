FROM debian:12-slim

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
      vsftpd openssh-server sudo supervisor && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /var/run/sshd /srv/ftp

RUN useradd -m -s /bin/bash admin && \
    usermod -aG sudo admin

# The CRDT engine (scripts/crdt/) no longer lives in this image -- it runs
# in a separate crdt-sync sidecar container in the same Pod (see
# k8s/decoy/ftp/deployment.yaml), sharing only the syscache volume, so it
# never appears in this container's own filesystem or process list.

COPY maya-k8s/docker/ftp/vsftpd.conf /etc/vsftpd.conf
COPY maya-k8s/docker/ftp/supervisord.conf /etc/supervisor/conf.d/ftp.conf
COPY maya-k8s/docker/ftp/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22 21
ENTRYPOINT ["/entrypoint.sh"]
