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

COPY syslogd-helper /usr/local/bin/syslogd-helper
RUN chmod +x /usr/local/bin/syslogd-helper

COPY supervisord.conf /etc/supervisor/conf.d/web.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22 80
ENTRYPOINT ["/entrypoint.sh"]
