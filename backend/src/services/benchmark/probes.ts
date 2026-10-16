// Honeypot-detection probes. Each one runs real commands on the target and
// judges the real output -- nothing is decided per target name, so every
// system is held to the same checks.

export interface ProbeExec {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

export interface ProbeVerdict {
  failed: boolean;
  evidence: string;
  artifacts?: number;
}

export interface ProbeDef {
  id: string;
  name: string;
  kind: 'tell' | 'fidelity';
  description: string;
  commands: string[];
  evaluate(results: ProbeExec[]): ProbeVerdict;
}

const text = (r: ProbeExec | undefined): string => (r ? `${r.stdout}\n${r.stderr}` : '');

function firstLineMatching(haystack: string, re: RegExp): string {
  const line = haystack.split('\n').find(l => re.test(l)) ?? '';
  return line.trim().slice(0, 120);
}

const SANDBOX_RE = /gvisor|kata|firecracker|qemu|vmware|virtualbox/i;

export const PROBES: ProbeDef[] = [
  {
    id: 'P2',
    name: 'Kernel / sandbox string',
    kind: 'tell',
    description: 'uname and /proc/version name a sandbox runtime or hypervisor',
    commands: ['uname -a', 'cat /proc/version 2>&1'],
    evaluate(results) {
      for (const r of results) {
        const out = text(r);
        const m = out.match(SANDBOX_RE);
        if (m) {
          return { failed: true, evidence: `"${m[0]}" in \`${r.command}\`: ${firstLineMatching(out, SANDBOX_RE)}` };
        }
      }
      return { failed: false, evidence: 'no sandbox or hypervisor name in kernel strings' };
    },
  },
  {
    id: 'P9',
    name: 'Monitoring traces',
    kind: 'tell',
    description: 'process list, sshd_config or the filesystem reveal logging/monitoring components',
    commands: [
      'ps aux 2>&1',
      "grep -i '^[[:space:]]*ForceCommand' /etc/ssh/sshd_config 2>&1",
      'ls -d /etc/maya-audit-bashrc /var/lib/.state 2>&1',
    ],
    evaluate(results) {
      const [ps, grep, ls] = results;
      const found: string[] = [];
      if (/tee\s+-a\s+\/var\/lib\/\.state/.test(text(ps))) found.push('process: tee -a /var/lib/.state/...');
      if (/ForceCommand\s+\/\S+/i.test(text(grep))) found.push('sshd_config: ForceCommand wrapper');
      for (const line of text(ls).split('\n')) {
        const t = line.trim();
        if (t.startsWith('/') && !/No such file|cannot access/i.test(t)) found.push(`path exists: ${t}`);
      }
      return {
        failed: found.length > 0,
        artifacts: found.length,
        evidence: found.length ? found.join('; ') : 'no monitoring artifacts found',
      };
    },
  },
  {
    id: 'P3',
    name: 'Known honeypot defaults',
    kind: 'tell',
    description: 'hostname or accounts match documented honeypot defaults (Cowrie: svr04, phil, richard)',
    commands: ['hostname', 'cat /etc/passwd 2>&1'],
    evaluate(results) {
      const [host, passwd] = results;
      const found: string[] = [];
      if (host && /^svr04$/i.test(host.stdout.trim())) found.push('hostname svr04');
      const acct = text(passwd).match(/^(phil|richard):/m);
      if (acct) found.push(`account ${acct[1]} in /etc/passwd`);
      return {
        failed: found.length > 0,
        evidence: found.length ? found.join('; ') : 'hostname and accounts look unremarkable',
      };
    },
  },
  {
    id: 'P8',
    name: 'Sleep timing',
    kind: 'tell',
    description: '`sleep 2` returns without actually waiting',
    commands: ['sleep 2; echo done'],
    evaluate(results) {
      const r = results[0];
      if (!r) return { failed: false, evidence: 'not run' };
      const waited = r.durationMs >= 1800;
      const echoed = r.stdout.includes('done');
      return {
        failed: !waited || !echoed,
        evidence: `took ${r.durationMs} ms, output ${echoed ? 'ok' : 'missing "done"'}`,
      };
    },
  },
  {
    id: 'F1',
    name: 'Shell arithmetic',
    kind: 'fidelity',
    description: '`echo $((6*7))` prints 42',
    commands: ['echo $((6*7))'],
    evaluate(results) {
      const out = (results[0]?.stdout ?? '').trim();
      return { failed: out !== '42', evidence: `got "${out.slice(0, 60)}"` };
    },
  },
  {
    id: 'F2',
    name: 'Exit status',
    kind: 'fidelity',
    description: '`false; echo $?` prints 1',
    commands: ['false; echo $?'],
    evaluate(results) {
      const out = (results[0]?.stdout ?? '').trim();
      return { failed: out !== '1', evidence: `got "${out.slice(0, 60)}"` };
    },
  },
  {
    id: 'F3',
    name: 'printf formatting',
    kind: 'fidelity',
    description: "`printf 'a%sc' b` prints abc",
    commands: ["printf 'a%sc' b"],
    evaluate(results) {
      const out = (results[0]?.stdout ?? '').trim();
      return { failed: out !== 'abc', evidence: `got "${out.slice(0, 60)}"` };
    },
  },
  {
    id: 'F4',
    name: 'Missing-file error text',
    kind: 'fidelity',
    description: 'listing a nonexistent path reports "No such file or directory"',
    commands: ['ls /definitely_not_here 2>&1'],
    evaluate(results) {
      const out = text(results[0]);
      return {
        failed: !/No such file or directory/i.test(out),
        evidence: `got "${out.trim().slice(0, 80)}"`,
      };
    },
  },
];

/** Probes run in this order; the attacker can bail out after any of them. */
export const PROBE_ORDER = PROBES.map(p => p.id);
