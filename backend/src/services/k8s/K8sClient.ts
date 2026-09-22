import * as k8s from '@kubernetes/client-node';
import { PassThrough } from 'stream';
import { logger } from '../../utils/logger';

export type DecoyTier = 'gvisor' | 'kata' | 'unknown';

export interface TierCluster {
  tier: DecoyTier;
  context: string;
  kc: k8s.KubeConfig;
  core: k8s.CoreV1Api;
  apps: k8s.AppsV1Api;
  exec: k8s.Exec;
}

export interface K8sResourceSpec {
  requests?: { cpu?: string; memory?: string };
  limits?: { cpu?: string; memory?: string };
}

export interface K8sPodInfo {
  podName: string; // current pod instance name -- changes on every restart, only usable for kubectl exec right now
  appName: string; // stable name from the "app" label (web-03, jump-01, ...) -- matches the Deployment/Service name, use this as the target/vmName identifier
  decoyType: string; // from label maya.decoy/type (web/redis/jump/...)
  tier: DecoyTier;
  context: string;
  phase: string; // Running/Pending/...
  ready: boolean;
  podIp?: string;
  containerName: string;
  image?: string;
  ports?: number[];
  runtimeClassName?: string;
  // Declared requests/limits from the pod spec -- not live usage. Getting
  // live usage would need metrics-server installed in-cluster, which kind
  // doesn't ship by default; this is the honest, always-available subset.
  resources?: K8sResourceSpec;
}

const DECOY_NAMESPACE = process.env.MAYA_DECOY_NAMESPACE || 'maya-decoys';

/**
 * Parses K8S_TIER_CONTEXTS="gvisor=kind-maya-dev,kata=kata-baremetal" into
 * tier->context pairs. Both clusters live as separate contexts in the same
 * kubeconfig (see maya-k8s/kata-migrate.sh), so one kubeconfig covers both.
 *
 * Falls back to a single entry using the kubeconfig's own current-context,
 * tagged as the "gvisor" tier -- a reasonable default while the bare-metal
 * Kata cluster isn't provisioned yet (see maya-k8s/kata-*.sh).
 */
function parseTierContexts(kc: k8s.KubeConfig): Array<{ tier: DecoyTier; context: string }> {
  const raw = process.env.K8S_TIER_CONTEXTS;
  if (raw) {
    return raw.split(',').map(pair => {
      const [tier, context] = pair.split('=').map(s => s.trim());
      return { tier: (tier as DecoyTier) || 'unknown', context };
    }).filter(entry => entry.context);
  }

  const current = kc.getCurrentContext();
  if (!current) return [];
  return [{ tier: 'gvisor', context: current }];
}

let cachedClusters: TierCluster[] | null = null;

/**
 * Builds one client per configured tier/context. Not fatal if kubeconfig is
 * missing or a context can't be reached -- K8s decoys are additive to the
 * existing Vagrant fabric, so the rest of the backend (and SIMULATION_MODE)
 * keeps working with zero K8s access at all.
 */
export function getTierClusters(): TierCluster[] {
  if (cachedClusters) return cachedClusters;

  const kc = new k8s.KubeConfig();
  try {
    if (process.env.KUBECONFIG) {
      kc.loadFromFile(process.env.KUBECONFIG);
    } else {
      kc.loadFromDefault();
    }
  } catch (error) {
    logger.warn(`K8s: no usable kubeconfig found, K8s decoy discovery disabled: ${error instanceof Error ? error.message : String(error)}`);
    cachedClusters = [];
    return cachedClusters;
  }

  const entries = parseTierContexts(kc);
  const clusters: TierCluster[] = [];

  for (const { tier, context } of entries) {
    try {
      const contextKc = new k8s.KubeConfig();
      if (process.env.KUBECONFIG) {
        contextKc.loadFromFile(process.env.KUBECONFIG);
      } else {
        contextKc.loadFromDefault();
      }
      contextKc.setCurrentContext(context);

      clusters.push({
        tier,
        context,
        kc: contextKc,
        core: contextKc.makeApiClient(k8s.CoreV1Api),
        apps: contextKc.makeApiClient(k8s.AppsV1Api),
        exec: new k8s.Exec(contextKc),
      });
      logger.info(`K8s: configured ${tier} tier via context '${context}'`);
    } catch (error) {
      logger.warn(`K8s: failed to configure context '${context}' (tier ${tier}), skipping: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  cachedClusters = clusters;
  return clusters;
}

/** Test-only / hot-reload escape hatch. */
export function resetTierClustersCache() {
  cachedClusters = null;
}

export async function listDecoyPods(cluster: TierCluster): Promise<K8sPodInfo[]> {
  try {
    const res = await cluster.core.listNamespacedPod({
      namespace: DECOY_NAMESPACE,
      labelSelector: 'maya.decoy/type',
    });

    return res.items
      .filter(pod => pod.metadata?.name && pod.spec?.containers?.length)
      .map(pod => {
        const container = pod.spec!.containers[0];
        const conditions = pod.status?.conditions || [];
        const ready = conditions.some(c => c.type === 'Ready' && c.status === 'True');

        return {
          podName: pod.metadata!.name!,
          appName: pod.metadata?.labels?.['app'] || pod.metadata!.name!,
          decoyType: pod.metadata?.labels?.['maya.decoy/type'] || 'unknown',
          tier: cluster.tier,
          context: cluster.context,
          phase: pod.status?.phase || 'Unknown',
          ready,
          podIp: pod.status?.podIP,
          containerName: container.name,
          image: container.image,
          ports: (container.ports || []).map(p => p.containerPort).filter((p): p is number => typeof p === 'number'),
          runtimeClassName: pod.spec?.runtimeClassName,
          resources: {
            requests: {
              cpu: container.resources?.requests?.['cpu'],
              memory: container.resources?.requests?.['memory'],
            },
            limits: {
              cpu: container.resources?.limits?.['cpu'],
              memory: container.resources?.limits?.['memory'],
            },
          },
        };
      });
  } catch (error) {
    logger.warn(`K8s: failed to list pods on context '${cluster.context}': ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Scales a decoy Deployment (same name as the pod's stable "app" label,
 * e.g. "web-03") to the given replica count. 0 = stop, 1 = (re)start.
 * Scaling to 0 rather than deleting keeps the spec intact for fast
 * re-provisioning and gives a clean CRDT state on the next pod (fresh
 * emptyDir) -- same rationale as maya-k8s/lifecycle-manager's /terminate.
 */
export async function scaleDeployment(cluster: TierCluster, deploymentName: string, replicas: number): Promise<void> {
  const deploy = await cluster.apps.readNamespacedDeployment({ name: deploymentName, namespace: DECOY_NAMESPACE });
  deploy.spec!.replicas = replicas;
  await cluster.apps.replaceNamespacedDeployment({
    name: deploymentName,
    namespace: DECOY_NAMESPACE,
    body: deploy,
  });
}

/**
 * Runs a command inside a pod (the K8s equivalent of `vagrant ssh -c
 * "<cmd>"`). Resolves once the exec stream reports completion; does not
 * throw on a nonzero exit code (mirrors execAsync-style callers elsewhere
 * in this codebase that check stdout/stderr themselves).
 */
export function execInPod(
  cluster: TierCluster,
  podName: string,
  containerName: string,
  command: string[],
  timeoutMs = 10000
): Promise<{ stdout: string; stderr: string; code: number }> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let stdoutBuf = '';
  let stderrBuf = '';
  stdout.on('data', (chunk: Buffer) => { stdoutBuf += chunk.toString(); });
  stderr.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString(); });

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`K8s exec timed out after ${timeoutMs}ms: ${command.join(' ')}`));
    }, timeoutMs);

    cluster.exec.exec(
      DECOY_NAMESPACE,
      podName,
      containerName,
      command,
      stdout,
      stderr,
      null,
      false,
      (status: k8s.V1Status) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout: stdoutBuf,
          stderr: stderrBuf,
          code: status.status === 'Success' ? 0 : 1,
        });
      }
    ).catch((error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

export { DECOY_NAMESPACE };
