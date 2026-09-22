"use client"

import { getApiHttpBase } from "@/lib/api-base"
import type { InfrastructureNodeDetail, InfrastructureNodeSummary } from "./types"

export async function fetchInfrastructureNodes(): Promise<InfrastructureNodeSummary[]> {
  const res = await fetch(`${getApiHttpBase()}/api/infrastructure/nodes`, { cache: "no-store" })
  if (!res.ok) throw new Error(`Failed to fetch nodes: HTTP ${res.status}`)
  const json = await res.json() as { success: boolean; data: InfrastructureNodeSummary[] }
  if (!json.success) throw new Error("Failed to fetch nodes")
  return json.data
}

export async function fetchInfrastructureNodeDetail(name: string): Promise<InfrastructureNodeDetail> {
  const res = await fetch(`${getApiHttpBase()}/api/infrastructure/nodes/${encodeURIComponent(name)}`, { cache: "no-store" })
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Node '${name}' not found`)
    throw new Error(`Failed to fetch node detail: HTTP ${res.status}`)
  }
  const json = await res.json() as { success: boolean; data: InfrastructureNodeDetail }
  if (!json.success) throw new Error("Failed to fetch node detail")
  return json.data
}

export async function stopInfrastructureNode(name: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${getApiHttpBase()}/api/infrastructure/nodes/${encodeURIComponent(name)}/stop`, {
    method: "POST",
  })
  const json = await res.json() as { success: boolean; message?: string; error?: string }
  if (!res.ok || !json.success) throw new Error(json.error || `Failed to stop ${name}`)
  return { success: true, message: json.message || "Stopped" }
}

export async function resyncInfrastructureNode(name: string): Promise<InfrastructureNodeSummary> {
  const res = await fetch(`${getApiHttpBase()}/api/infrastructure/nodes/${encodeURIComponent(name)}/resync`, {
    method: "POST",
  })
  const json = await res.json() as { success: boolean; data: InfrastructureNodeSummary; error?: string }
  if (!res.ok || !json.success) throw new Error(json.error || `Failed to resync ${name}`)
  return json.data
}
