"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { RefreshCw, Square, AlertTriangle, ArrowLeft, Cpu, MemoryStick, Container as ContainerIcon } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import { useInfrastructureNodeDetail } from "@/hooks/use-infrastructure-node-detail"
import { resyncInfrastructureNode, stopInfrastructureNode } from "@/lib/infrastructure/api"
import { TierBadge } from "./tier-badge"
import type { DecoyPlatform, DecoyTier } from "@/types"

export function InfrastructureNodeDetail({ name }: { name: string }) {
  const { data, loading, error, refresh } = useInfrastructureNodeDetail(name)
  const { toast } = useToast()
  const router = useRouter()
  const [stopping, setStopping] = useState(false)
  const [resyncing, setResyncing] = useState(false)

  const handleStop = async () => {
    setStopping(true)
    try {
      const result = await stopInfrastructureNode(name)
      toast({ title: "Stop requested", description: result.message })
      await refresh()
    } catch (e) {
      toast({ title: "Stop failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" })
    } finally {
      setStopping(false)
    }
  }

  const handleResync = async () => {
    setResyncing(true)
    try {
      await resyncInfrastructureNode(name)
      await refresh()
      toast({ title: "Resynced", description: `${name} status refreshed` })
    } catch (e) {
      toast({ title: "Resync failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" })
    } finally {
      setResyncing(false)
    }
  }

  if (loading && !data) {
    return <p className="text-sm text-muted-foreground px-4 py-6">Loading {name}…</p>
  }

  if (error && !data) {
    return (
      <div className="px-4 py-6 space-y-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/infrastructure")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Infrastructure
        </Button>
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      </div>
    )
  }

  if (!data) return null

  const platform = (data.config.platform as string) || "vagrant"
  const isRunning = data.status === "running"

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/infrastructure")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <h1 className="text-xl font-bold">{data.name}</h1>
          <Badge variant={isRunning ? "default" : data.status === "error" ? "destructive" : "secondary"} className="capitalize">
            {data.status}
          </Badge>
          <TierBadge platform={data.config.platform as DecoyPlatform} tier={data.config.tier as DecoyTier | undefined} />
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleResync} disabled={resyncing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${resyncing ? "animate-spin" : ""}`} />
            Resync
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={stopping || !isRunning}>
                <Square className="h-4 w-4 mr-2" />
                Stop
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Stop {data.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  {platform === "k8s"
                    ? "This scales the decoy's Deployment to 0 replicas. Its CRDT state resets on the next start (fresh emptyDir)."
                    : "This runs `vagrant halt` on the VM. Any in-progress attacker session on it will be dropped."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleStop} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Stop {data.name}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border bg-card">
          <CardHeader>
            <CardTitle className="text-base">Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              {Object.entries(data.config).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, " $1")}</dt>
                  <dd className="font-mono text-right break-all">
                    {Array.isArray(value) ? value.join(", ") || "—" : String(value ?? "—")}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card className="border bg-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              Resources
            </CardTitle>
            <CardDescription>
              {data.resources?.source === "declared"
                ? "Declared requests/limits from the pod spec, not live usage"
                : "Not available for Vagrant VMs yet"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.resources ? (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground flex items-center gap-1"><Cpu className="h-3.5 w-3.5" /> CPU request / limit</dt>
                  <dd className="font-mono">{data.resources.requests?.cpu || "—"} / {data.resources.limits?.cpu || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground flex items-center gap-1"><MemoryStick className="h-3.5 w-3.5" /> Memory request / limit</dt>
                  <dd className="font-mono">{data.resources.requests?.memory || "—"} / {data.resources.limits?.memory || "—"}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No resource data for this node.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {data.dockerContainers.length > 0 && (
        <Card className="border bg-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ContainerIcon className="h-4 w-4" />
              Docker Containers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Image</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ports</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.dockerContainers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{c.image}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === "running" ? "default" : "secondary"}>{c.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{c.ports.join(", ") || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="border bg-card">
        <CardHeader>
          <CardTitle className="text-base">
            Attackers on this node {data.attackers.length > 0 && <Badge variant="destructive" className="ml-2">{data.attackers.length}</Badge>}
          </CardTitle>
          <CardDescription>Derived from attack events with this node as source or target</CardDescription>
        </CardHeader>
        <CardContent>
          {data.attackers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No attacker activity recorded on this node yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Attacker ID</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Dwell Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.attackers.map((a) => (
                  <TableRow key={a.attackerId}>
                    <TableCell className="p-0">
                      <Link
                        href={`/attacker/${encodeURIComponent(a.attackerId)}`}
                        className="flex h-full w-full px-4 py-3 font-medium hover:underline"
                      >
                        {a.attackerId}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{a.ipAddress}</TableCell>
                    <TableCell>
                      <Badge variant={a.riskLevel === "Critical" || a.riskLevel === "High" ? "destructive" : "secondary"}>
                        {a.riskLevel}
                      </Badge>
                    </TableCell>
                    <TableCell>{a.status}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{a.dwellTime}m</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
