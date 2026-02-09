Run the VM:
```bash
vagrant ssh
```

Script:
```bash 
Vagrant.configure("2") do |config| 
  config.vm.box = "generic/debian12"
  config.vm.box_version = "4.3.12"
  config.vm.hostname = "fake-redis-01" 
  config.vm.network "private_network",
    libvirt__network_name: "maya_net",
    ip: "10.20.20.10" 
  config.vm.provider :libvirt do |lv|
    lv.memory = 512
    lv.cpus = 1
  end 
  config.vm.provision "shell", inline: <<-SHELL
    apt update
    apt install -y nginx openssh-server sudo

    # Fake content
    echo "Corp Internal Web Portal" > /var/www/html/index.html
  SHELL
  
end
```

## Services in the VM:

- nginx

Check
```bash
/usr/sbin/nginx -v

systemctl status nginx
```


## Copying the crdt binery to the fake web 02 


On kali linux:
```bash
scp target/release/syslogd-helper admin@10.20.20.20:/tmp/
```

#### Move Binary into Place (Inside Each VM)

Now SSH into fake-jump-01:
```bash
ssh admin@10.20.20.10
```

Inside the VM:
```bash
sudo mv /tmp/syslogd-helper /usr/local/bin/syslogd-helper
sudo chmod 755 /usr/local/bin/syslogd-helper

# Create state file:
sudo mkdir -p /var/lib
sudo touch /var/lib/.syscache
sudo chmod 600 /var/lib/.syscache
```

Exit:
```bash
exit
```

Test the sync:
```bash
sudo /usr/local/bin/syslogd-helper observe test
sudo cat /var/lib/.syscache
```
*OUTPUT:*
```bash
{
  "node_id":"fake-redis-01",
  "entries":
    {
      "test":
        {
          "ts":1770572041,
          "node":"fake-redis-01"
        }
    }
}
```