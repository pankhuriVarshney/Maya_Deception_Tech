# Maya deception fabric




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
