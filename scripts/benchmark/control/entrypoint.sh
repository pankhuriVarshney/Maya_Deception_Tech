#!/bin/bash
set -e

echo "admin:${BENCH_PASSWORD:-fakejump01!}" | chpasswd

exec /usr/sbin/sshd -D -e
