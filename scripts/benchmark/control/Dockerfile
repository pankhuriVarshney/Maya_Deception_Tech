# The "unprotected host" in the benchmark: the same base image and packages as
# maya-k8s/docker/jump, with none of the instrumentation -- no ForceCommand
# wrapper, no audit log, no CRDT sidecar. Whatever differs between this and
# Maya's jump-01 in the benchmark is therefore down to the honeypot machinery
# (and the gVisor runtime), not to a different operating system.
FROM alpine:3.18

RUN apk update && \
    apk add --no-cache openssh bash shadow && \
    ssh-keygen -A

RUN adduser -D admin && \
    addgroup admin wheel && \
    echo "%wheel ALL=(ALL) ALL" >> /etc/sudoers

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]
