# Maya Documentation

Start here. This directory is the current, authoritative reference —
`dev-notes/` is kept for historical debugging context but is not
guaranteed current; where the two disagree, trust the files here.

| File | What it's for |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | How the system fits together: the three-tier deception fabric, CRDT sync, backend services, frontend structure |
| [API.md](./API.md) | Every HTTP/WebSocket endpoint in the app and what actually calls it |
| [SETUP_AND_TESTING.md](./SETUP_AND_TESTING.md) | How to set the project up, restart it, rebuild after changes, and run simulated and manual tests |
| [EVALUATION_AND_TESTING.md](./EVALUATION_AND_TESTING.md) | Report-ready chapter: how the system was tested, the defects found, and the side-by-side benchmark results and analysis |
| [EVALUATION.md](./EVALUATION.md) | The benchmark/evaluation matrix: how Maya is compared against Cowrie and an unprotected host, and what the Benchmark page measures |
| [STATUS.md](./STATUS.md) | What's actually built vs. still pending, by epic — the honest project tracker |
| [dev-notes/](./dev-notes/) | Historical bug-investigation notes, kept for context. Several were superseded by fixes described in STATUS.md; check dates/status notes at the top of each before trusting one |

## Quick orientation

- **Two decoy fabrics, not one**: a Vagrant/libvirt honeynet (`simulations/`) and a Kubernetes fabric (`maya-k8s/`) with two tiers of its own (gVisor default, Kata escalation). See ARCHITECTURE.md for how they relate.
- **One backend, one dashboard**: `backend/` (Node/Express/MongoDB) is the control plane for both fabrics; `frontend/` (Next.js) is the one dashboard for both.
- **CRDT is the attacker-observation layer**: the Rust binary in `scripts/crdt/` is compiled into Vagrant VMs directly and into a separate `crdt-sync` sidecar container alongside each K8s decoy (not the decoy's own image/container, so an attacker who lands a shell in the decoy can't find it) — same binary, same subcommands, different transport (SSH vs. `kubectl exec`).
