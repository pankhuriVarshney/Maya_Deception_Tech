# Maya deception fabric



### Static

```bash
sudo apt install musl-tools

rustup target add x86_64-unknown-linux-musl

cargo clean

cargo build --release --target x86_64-unknown-linux-musl

# Verify
    file target/x86_64-unknown-linux-musl/release/maya-crdt
```

# crdt binary
```bash
cp target/x86_64-unknown-linux-musl/release/maya-crdt syslogd-helper
scp syslogd-helper admin@10.20.20.10:/tmp/

# Inside the VM
sudo mv /tmp/syslogd-helper /usr/local/bin/
sudo chmod 755 /usr/local/bin/syslogd-helper

```

Sanity Tests
```bash
sudo syslogd-helper visit attacker1 redis
sudo syslogd-helper action attacker1 redis "ran redis-cli"
sudo syslogd-helper move attacker1 redis
sudo syslogd-helper cred root:toor
sudo syslogd-helper session redis sess1
sudo syslogd-helper show
```


Merge Check
Copy from node-1 to node-2

On fake-jump-01:
```bash
scp /var/lib/.syscache admin@10.20.20.20:/tmp/jump.state
```

Then on fake-redis-01:
```bash
sudo syslogd-helper merge /tmp/jump.state
sudo syslogd-helper show
```