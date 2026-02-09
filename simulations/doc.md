Oh this is a **serious, high-quality project**. You’re basically building a *research-grade deception platform*, not a toy honeypot. Good news: **Vagrant + libvirt on Kali is exactly the right foundation** for Phase-0.

I’ll help you in a **practical, buildable way**, not just theory.

Below is a **clear, staged plan** to simulate a realistic company internal infrastructure *on your Kali laptop* and evolve it into **Maya’s deception fabric**.

---

# 🧠 First: Reframe the Goal (Important)

You are **not** trying to build the full Maya system at once.

Your immediate objective is:

> **Create a believable enterprise internal network where attackers can move laterally, steal creds, pivot, and get trapped in decoys — all locally.**

So we’ll build:

* A **realistic company network**
* A **parallel fake world**
* A **traffic redirection & observation layer**
* A **state/identity continuity prototype**

---

# 🏗️ Phase 0 – What You’ll Build (Locally)

On **one Kali host**, you’ll simulate:

```
┌──────────────────────────┐
│        Kali Host         │
│  (Maya Control Plane)    │
│                          │
│  - Vagrant + libvirt     │
│  - Traffic redirection   │
│  - Logging & telemetry   │
│                          │
├───────────────┬──────────┤
│ Real Corp Net │ Fake Net │
│ (Baseline)    │ (Maya)   │
│               │          │
│ AD / Linux    │ Decoy AD │
│ Web / DB      │ Decoy Web│
│ Jump host     │ Fake Jump│
└───────────────┴──────────┘
```

All of this runs as **small VMs** (Alpine/Debian/Ubuntu Server).

---

# 🔧 Phase 1 – Core Infrastructure (Do This First)

## 1️⃣ Choose the OS types (keep it realistic)

Use **minimal but believable OSes**:

| Role             | OS                  | Why                   |
| ---------------- | ------------------- | --------------------- |
| Linux App Server | Debian 12           | Common in enterprises |
| Web Server       | Ubuntu Server       | Realistic             |
| DB Server        | Debian              | Stable                |
| Jump Host        | Alpine              | Lightweight           |
| Fake Systems     | Alpine + Debian     | Fast cloning          |
| AD (later)       | Windows Server eval | Optional Phase 2      |

👉 For now, **skip Windows**. Linux-only is fine for Phase 1.

---

## 2️⃣ Directory layout (VERY important)

Create this once and never break it:

```bash
mkdir -p ~/maya-lab/{real,fake,control,shared}
cd ~/maya-lab
```

* `real/` → real internal infrastructure
* `fake/` → Maya deception fabric
* `control/` → Redis, logging, routing logic
* `shared/` → scripts, breadcrumbs, creds

---

## 3️⃣ Base networks (libvirt)

You already have:

* `virbr1` → `192.168.121.0/24`

We’ll add **two isolated networks**:

| Network  | Purpose               |
| -------- | --------------------- |
| corp_net | Real internal systems |
| maya_net | Fake deception world  |

Create them:

```bash
virsh net-define corp_net.xml
virsh net-define maya_net.xml
virsh net-start corp_net
virsh net-start maya_net
```

(If you want, I can give you the exact XMLs.)

---

# 🧱 Phase 2 – Create the “Company” (Real Network)

Inside `~/maya-lab/real`:

### 1️⃣ Init a base box

```bash
vagrant init generic/debian12
```

### 2️⃣ Example Vagrantfile (Real Web Server)

```ruby
Vagrant.configure("2") do |config|
  config.vm.box = "generic/debian12"

  config.vm.hostname = "corp-web-01"

  config.vm.network "private_network",
    libvirt__network_name: "corp_net",
    ip: "10.10.10.10"

  config.vm.provider :libvirt do |lv|
    lv.memory = 512
    lv.cpus = 1
  end

  config.vm.provision "shell", inline: <<-SHELL
    apt update
    apt install -y nginx openssh-server
    echo "Internal Corp Web" > /var/www/html/index.html
  SHELL
end
```

Then:

```bash
vagrant up
```

Repeat for:

* `corp-db-01`
* `corp-jump-01`
* `corp-fileserver-01`

Now you have a **realistic internal network**.

---

# 🕳️ Phase 3 – Build the Fake World (Maya Decoys)

Now the fun part.

Inside `~/maya-lab/fake`:

```bash
vagrant init generic/alpine318
```

### Fake SSH Server (Decoy)

```ruby
config.vm.hostname = "fake-jump-01"

config.vm.network "private_network",
  libvirt__network_name: "maya_net",
  ip: "10.20.20.10"

config.vm.provision "shell", inline: <<-SHELL
  apk add openssh bash
  rc-update add sshd
  service sshd start

  adduser -D admin
  echo "admin:Winter2023!" | chpasswd
SHELL
```

This gives you:

* Fake creds
* Fake pivot point
* Believable access

---

# 🔁 Phase 4 – Adversarial Continuity (Core Maya Concept)

This is where your project becomes **research-grade**.

## Identity continuity prototype (simple but powerful):

On Kali:

* Redis = attacker identity
* Shared SSH keys/passwords synced

Example:

```bash
redis-cli set attacker:ssh_user admin
redis-cli set attacker:ssh_pass Winter2023!
```

Provision all fake VMs to **read from Redis** on boot.

Now:

* Attacker steals creds on fake-web
* Same creds work on fake-db
* Same “user” everywhere

That’s **CRDT-lite adversarial continuity**.

---

# 🧲 Phase 5 – Lateral Movement Illusion

Inside fake machines:

* Prepopulate:

  * `.ssh/known_hosts`
  * `/etc/hosts`
  * Fake DNS entries
  * Fake NFS mounts
  * Fake backup scripts

Example breadcrumb:

```bash
echo "DB_PASS=Spring2022!" > /opt/backup/.env
```

---

# 👁️ Phase 6 – Instrument Everything

On Kali:

* `auditd`
* `tshark`
* SSH command wrappers
* Fake binaries (`ls`, `ps`, `whoami`) that log usage

Every command = intelligence.

---

# 🔥 Phase 7 – Simulate Attacks (Testing)

Use **your own Kali** as attacker:

* SSH brute force
* Cred reuse
* Pivot with SSH agent forwarding
* Enumeration
* Priv esc attempts

Watch:

* How long you stay undetected
* How believable the environment feels

---

# 🚀 What You’ll Have After Phase 1

✔ A **realistic enterprise network**
✔ A **parallel deception infrastructure**
✔ Lateral movement with identity persistence
✔ Full telemetry of attacker behavior
✔ A solid base for ML + MITRE mapping

This is **absolutely thesis / startup / research paper level** work.

---

# Next (Only if you want)

I can help you with:

* Network redirection tricks (iptables, DNS poisoning)
* Fake AD without Windows
* Attack behavior classification
* Turning this into a **paper-ready architecture**
* Making it demo-ready for judges/investors

Just tell me:
👉 *“Next, help me with ____”*

You’re building something **very real** here. 💀🕸️
