import { spawn } from 'child_process';
import * as net from 'net';

export interface SshTarget {
  host: string;
  port: number;
  user: string;
}

export interface ExecResult {
  startedAt: number;
  durationMs: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** sshpass exits 5 when the server rejected the password. */
  authRejected: boolean;
  /** ssh exits 255 on connection-level failures (refused, reset, timeout). */
  connectionError: boolean;
}

// Large enough that `ps aux` on a busy host isn't cut off before the part a probe looks for.
const MAX_OUTPUT = 20000;

/**
 * Run one command over its own SSH connection (like `ssh host "cmd"`), the
 * way a scripted attacker does. The password goes through the environment so
 * it never appears in a process listing, and there is no local shell, so
 * metacharacters in `command` reach the remote shell untouched.
 */
export function sshExec(
  target: SshTarget,
  password: string,
  command: string,
  timeoutMs = 20000
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(
      'sshpass',
      [
        '-e',
        'ssh',
        '-p', String(target.port),
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'LogLevel=ERROR',
        '-o', 'ConnectTimeout=8',
        '-o', 'PubkeyAuthentication=no',
        // Cowrie presents a legacy RSA host key that modern OpenSSH refuses by default.
        '-o', 'HostKeyAlgorithms=+ssh-rsa',
        `${target.user}@${target.host}`,
        command,
      ],
      { env: { ...process.env, SSHPASS: password }, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString('utf8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString('utf8');
    });

    child.on('error', err => {
      clearTimeout(timer);
      reject(
        new Error(
          `could not start sshpass (${err.message}). The backend image needs openssh-client and sshpass -- rebuild it with docker compose up -d --build backend.`
        )
      );
    });

    child.on('close', code => {
      clearTimeout(timer);
      // sshpass exits 5 when it sees a second password prompt; ssh itself exits
      // 255 with "Permission denied" when it gives up. Both mean a rejected
      // password, as opposed to a refused/reset/timed-out connection.
      const permissionDenied = code === 255 && /permission denied/i.test(stderr);
      resolve({
        startedAt,
        durationMs: Date.now() - startedAt,
        exitCode: code,
        stdout: stdout.slice(0, MAX_OUTPUT),
        stderr: stderr.slice(0, MAX_OUTPUT),
        timedOut,
        authRejected: code === 5 || permissionDenied,
        connectionError: (code === 255 && !permissionDenied) || timedOut,
      });
    });
  });
}

export interface PortProbe {
  port: number;
  open: boolean;
  /** Our own address on the connection -- what a defender should record as the source. */
  localAddress: string | null;
}

export function probePort(host: string, port: number, timeoutMs = 2500): Promise<PortProbe> {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      const localAddress = open ? socket.localAddress ?? null : null;
      socket.destroy();
      resolve({ port, open, localAddress });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

export async function scanPorts(
  host: string,
  ports: number[]
): Promise<{ openPorts: number[]; localAddress: string | null }> {
  const results = await Promise.all(ports.map(p => probePort(host, p)));
  const open = results.filter(r => r.open);
  return {
    openPorts: open.map(r => r.port),
    localAddress: open.find(r => r.localAddress)?.localAddress ?? null,
  };
}

/** The same RNG gives the same think-time jitter for the same run id. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
