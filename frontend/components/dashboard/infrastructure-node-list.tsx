"use client"

import Link from "next/link"
import { Server, ShieldAlert, RefreshCw, AlertTriangle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { useInfrastructureNodes } from "@/hooks/use-infrastructure-nodes"
import type { NodeStatus } from "@/lib/infrastructure/types"
import { TierBadge } from "./tier-badge"

function statusBadge(status: NodeStatus) {
  const variant = status === "running" ? "default" : status === "error" ? "destructive" : "secondary"
  return <Badge variant={variant} className="capitalize">{status}</Badge>
}

export function InfrastructureNodeList() {
  const { nodes, loading, error, refresh } = useInfrastructureNodes()

  return (
    <Card className="border bg-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" />
            Infrastructure
          </CardTitle>
          <CardDescription>Every decoy VM and container, across Vagrant and Kubernetes</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => refresh()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive mb-3">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        )}

        {!loading && nodes.length === 0 && !error && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No decoy nodes discovered yet.
          </p>
        )}

        {nodes.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>
                  <div className="flex items-center gap-1">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Attackers
                  </div>
                </TableHead>
                <TableHead>Last Seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nodes.map((node) => (
                <TableRow key={node.name} className="cursor-pointer">
                  <TableCell className="p-0">
                    <Link
                      href={`/dashboard/infrastructure/${encodeURIComponent(node.name)}`}
                      className="flex h-full w-full px-4 py-3 font-medium hover:underline"
                    >
                      {node.name}
                    </Link>
                  </TableCell>
                  <TableCell><TierBadge platform={node.platform} tier={node.tier} /></TableCell>
                  <TableCell>{statusBadge(node.status)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{node.ip || "—"}</TableCell>
                  <TableCell>
                    {node.attackerCount > 0 ? (
                      <Badge variant="destructive">{node.attackerCount}</Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {node.lastSeen ? new Date(node.lastSeen).toLocaleTimeString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
