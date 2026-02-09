# Setup

Installation:
```bash
sudo apt update
sudo apt install -y qemu-kvm libvirt-daemon-system libvirt-clients virt-manager
```

Add yourself to libvirt group:
```bash
sudo usermod -aG libvirt $USER
newgrp libvirt
```

Verify:
```bash
virsh list --all
```

Install Vargrant:
```bash
wget https://releases.hashicorp.com/vagrant/2.4.9/vagrant_2.4.9-1_amd64.deb
sudo apt install ./vagrant_2.4.9-1_amd64.deb
```


Install Dependencies:
```bash
sudo apt install -y \
  build-essential libssl-dev libreadline-dev zlib1g-dev \
  libyaml-dev libxml2-dev libxslt1-dev libffi-dev
```

```bash
git clone https://github.com/rbenv/rbenv.git ~/.rbenv
git clone https://github.com/rbenv/ruby-build.git ~/.rbenv/plugins/ruby-build
```

```bash
echo 'export PATH="$HOME/.rbenv/bin:$PATH"' >> ~/.bashrc
echo 'eval "$(rbenv init - bash)"' >> ~/.bashrc
source ~/.bashrc
```

Install Ruby:
```bash
rbenv install 3.2.2
rbenv global 3.2.2
```

Verify:
```bash
ruby -v
```

Install libvirt provider
```bash
sudo apt install -y ruby-libvirt libvirt-dev
vagrant plugin install vagrant-libvirt
```

Verify:
```bash
vagrant plugin list
```

Sanity Check:
```bash
vagrant up --provider=libvirt
```

Verify the machine:
```bash
vagrant ssh
```
To reload the VM after making changes in the Vagrantfile:
```bash
vagrant reload
```

# Networking


virbr1 → 192.168.121.0/24


## 1. corp_net (Real Internal Network)
Internal employee systems
Real servers
Things attackers shouldn’t reach easily

Private
No internet access
Looks like a real internal subnet
Traffic here is valuable

10.10.10.0/24

## 2. maya_net (Deception Fabric)
The fake world
Honeynet
Where attackers get trapped

Isolated
Heavily monitored
Cred reuse allowed
DNS lies allowed

10.20.20.0/24


## Network Architecture 

                    Internet
                        │
                  [ Kali Host ]
                        │
        ┌───────────────┴───────────────┐
        │                               │
   corp_net (real)                maya_net (fake)
   10.10.10.0/24                 10.20.20.0/24
        │                               │
   corp-web-01                  fake-jump-01
   corp-db-01                   fake-db-01

Kali can see both.
They cannot see each other unless you allow it.

That’s deception control.

## YML Files


### 1. corp 

Creates bridge: virbr-corp
Gateway: 10.10.10.1
DHCP for convenience
No NAT
No external routing

```xml
<network>
  <name>corp_net</name>

  <!-- No internet access -->
  <forward mode='none'/>

  <bridge name='virbr-corp' stp='on' delay='0'/>

  <ip address='10.10.10.1' netmask='255.255.255.0'>
    <dhcp>
      <range start='10.10.10.100' end='10.10.10.200'/>
    </dhcp>
  </ip>
</network>
```

### 2. maya

```xml
<network>
  <name>maya_net</name>

  <!-- Completely isolated deception fabric -->
  <forward mode='none'/>

  <bridge name='virbr-maya' stp='on' delay='0'/>

  <ip address='10.20.20.1' netmask='255.255.255.0'>
    <dhcp>
      <range start='10.20.20.100' end='10.20.20.200'/>
    </dhcp>
  </ip>
</network>

```

## Activating the Networks:

Start
```bash
sudo virsh net-define corp_net.xml
sudo virsh net-define maya_net.xml

sudo virsh net-start corp_net
sudo virsh net-start maya_net

sudo virsh net-autostart corp_net
sudo virsh net-autostart maya_net
```

Verify
```bash
sudo virsh net-list --all
```
*OUTPUT:*
```txt
 Name              State      Autostart   Persistent
------------------------------------------------------
 corp_net          active     yes         yes
 default           inactive   no          yes
 maya_net          active     yes         yes
 vagrant-libvirt   active     no          yes
```

Verify on Kali
```bash
ip a | grep virbr
```
*OUTPUT*
```txt
5: virbr1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default qlen 1000
    inet 192.168.121.1/24 brd 192.168.121.255 scope global virbr1
6: vnet0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue master virbr1 state UNKNOWN group default qlen 1000
7: virbr-corp: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 qdisc noqueue state DOWN group default qlen 1000
    inet 10.10.10.1/24 brd 10.10.10.255 scope global virbr-corp
8: virbr-maya: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 qdisc noqueue state DOWN group default qlen 1000
    inet 10.20.20.1/24 brd 10.20.20.255 scope global virbr-maya
```

*With this setup you can:*
✔ Redirect attackers at network level
✔ Mirror corp services into maya_net
✔ Preserve attacker identity across nodes
✔ Observe lateral movement cleanly
✔ Prevent real damage

*This is the foundation for:*
DNS deception
Credential reuse traps
Lateral pivot illusions
CRDT identity propagation




## Trouble Shooting

if the vm seems paused and its not a RAM issues, then the vargrant service itself is paused

Verify:
```bash
vagrant status
vagrant resume
```

## Redis
Password: mayaC2

On Kali to access redis-cli:
```bash
redis-cli -a mayaC2
```


In-memory (fast)
Central truth
Easy to extend later into CRDT sets
Perfect for identity + state propagation


Install
```bash
sudo apt install -y redis-server
```

Bind Redis to maya:
```bash
sudo nano /etc/redis/redis.conf

bind 127.0.0.1
protected-mode yes
```

Restart
```bash
sudo systemctl restart redis
sudo systemctl enable redis
```

Verify:
```bash
redis-cli ping
```


### Define Attack Identity

Open Redis CLI:
```bash
redis-cli
```

Set User info:
```bash
SET attacker:username admin
SET attacker:password Winter2023!
SET attacker:role sysadmin
SET attacker:first_seen fake-web-01
SET attacker:confidence medium
```

To print all the sets:
```bash
KEYS *
```


