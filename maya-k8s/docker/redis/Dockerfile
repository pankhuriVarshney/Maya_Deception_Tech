FROM debian:12-slim

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
      redis-server openssh-server sudo supervisor && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /var/run/sshd

RUN useradd -m -s /bin/bash admin && \
    usermod -aG sudo admin

COPY syslogd-helper /usr/local/bin/syslogd-helper
RUN chmod +x /usr/local/bin/syslogd-helper

COPY supervisord.conf /etc/supervisor/conf.d/redis.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22 6379
ENTRYPOINT ["/entrypoint.sh"]
