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

# The CRDT engine (scripts/crdt/) no longer lives in this image -- it runs
# in a separate crdt-sync sidecar container in the same Pod (see
# k8s/decoy/web/deployment.yaml), sharing only the syscache volume, so it
# never appears in this container's own filesystem or process list.

COPY maya-k8s/docker/web/supervisord.conf /etc/supervisor/conf.d/web.conf
COPY maya-k8s/docker/web/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22 80
ENTRYPOINT ["/entrypoint.sh"]
