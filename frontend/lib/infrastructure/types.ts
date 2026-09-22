export type NodePlatform = "vagrant" | "k8s"
export type NodeTier = "low" | "gvisor" | "kata"
export type NodeStatus = "running" | "stopped" | "unknown" | "error"

export type DockerContainerInfo = {
  id: string
  name: string
  image: string
  status: "running" | "exited" | "paused"
  ports: string[]
  created: string
}

export type CrdtState = {
  attackers: number
  credentials: number
  sessions: number
  hash: string
}

export type InfrastructureNodeSummary = {
  name: string
  hostname: string
  status: NodeStatus
  ip?: string
  platform: NodePlatform
  tier?: NodeTier
  lastSeen: string
  crdtState?: CrdtState
  dockerContainers: DockerContainerInfo[]
  attackerCount: number
}

export type NodeAttacker = {
  attackerId: string
  ipAddress: string
  riskLevel: "Low" | "Medium" | "High" | "Critical"
  status: "Active" | "Inactive" | "Contained"
  currentPrivilege: string
  firstSeen: string
  lastSeen: string
  dwellTime: number
}

export type NodeResourceSpec = {
  source?: "declared"
  requests?: { cpu?: string; memory?: string }
  limits?: { cpu?: string; memory?: string }
}

export type InfrastructureNodeDetail = {
  name: string
  status: NodeStatus
  lastSeen: string
  crdtState?: CrdtState
  dockerContainers: DockerContainerInfo[]
  config: Record<string, unknown>
  resources: NodeResourceSpec | null
  attackers: NodeAttacker[]
}
