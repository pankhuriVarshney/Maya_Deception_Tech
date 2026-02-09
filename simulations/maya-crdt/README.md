
To initialise the cargo (rust) for crdt:
```bash
cargo new maya-crdt
cd maya-crdt
```

## fake-jump-01 (SSH-based sync)
*Behavior we emulate:*
Jump hosts routinely SSH into internal web servers

*Transport:*
- CRDT state copied via scp
- Merged locally
- No listener
- No open ports


To make Static Binary:
```bash
rustup target add x86_64-unknown-linux-musl
cargo build --release --target x86_64-unknown-linux-musl
# or


```

Binary:
```bash
target/x86_64-unknown-linux-musl/release/maya-crdt
```

Copy to jump (ssh) host:
```bash
scp maya-crdt admin@10.20.20.10:/usr/local/bin/
```

Jump host wrapper (/usr/local/bin/ssh-audit):
```bash
#!/bin/sh
LOG="/var/log/ssh_auth.log"

tail -n 20 /var/log/auth.log | while read line; do
  echo "$line" | /usr/local/bin/maya-crdt observe
done
```

### SSH Hook (Jump Host) 
Attackers expect SSH hooks on jump hosts.

*Where to hook:*
/etc/profile
/etc/profile.d/*.sh
/etc/ssh/sshrc
ForceCommand (selective)

 
/etc/profile.d/10-sys-audit.sh
```bash
#!/bin/sh

# Only run for real shells
[ -z "$SSH_CONNECTION" ] && return

# Randomize execution
[ $((RANDOM % 5)) -ne 0 ] && return

/usr/local/bin/maya-crdt sync >/dev/null 2>&1 &
```

*Why this works:*
- Runs only on SSH login
- Randomized
- Looks like audit tooling
- No cron
- No timers
- No persistent process
 

## fake-web-02 (HTTP-based sync)
*Behavior we emulate:*
Web servers pulling config / telemetry from peers

*Transport:*
- HTTP GET on localhost-like endpoint
- Piggybacks nginx


Add fake internal endpoint
```bash
mkdir -p /var/www/internal
```
Expose via nginx (NOT public):
```nginx
location /internal/status {
    allow 10.20.20.0/24;
    deny all;
    root /var/www;
}
```

CRDT exporter
```bash
/usr/local/bin/maya-crdt export > /var/www/internal/status/state.json
```

### Nginx Worker Piggyback
Instead of cron, tie sync to web traffic.
Logrotate hook

Edit:
```bash
sudo nano /etc/logrotate.d/nginx
```

Add:
```conf
postrotate
    /usr/local/bin/maya-crdt sync >/dev/null 2>&1 &
endscript
```

*Why this works:*
- Logrotate is expected
- Attackers almost never flag postrotate hooks
- Timing matches real infra behavior
- No persistent footprint


## Package Manager Hook (Extremely Realistic)
Many enterprises run apt/yum hooks.

Debian-based (fake-web-02)

Create:
```bash
/etc/apt/apt.conf.d/99sys-telemetry
```

```
DPkg::Post-Invoke {
  "/usr/local/bin/maya-crdt sync >/dev/null 2>&1 || true";
};
```

*Why this works:*
- Totally normal
- Triggered irregularly
- Looks like telemetry/compliance
- No scheduling artifact


# Making binary:

```bash
cargo build --release

ls -lh target/release/

cp target/release/maya-crdt target/release/syslogd-helper

sudo ./target/release/syslogd-helper observe 1.2.3.4

sudo ls -la /var/lib | grep syscache

sudo cat /var/lib/.syscache
```


