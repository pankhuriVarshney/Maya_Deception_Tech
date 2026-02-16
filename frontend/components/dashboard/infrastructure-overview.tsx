"use client"

import { Network, Server, Shield, Activity, Container } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { useVMStatus } from "@/hooks/use-vm-status"
import { cn } from "@/lib/utils"

export function InfrastructureOverview() {
  const { 
    vms, 
    loading, 
    wsConnected,
    runningCount,
    totalAttackers,
    totalCredentials,
    totalSessions,
    totalContainers 
  } = useVMStatus()

  const totalVMs = vms.length
  const activeDecoys = runningCount
  const healthScore = totalVMs > 0 ? Math.round((runningCount / totalVMs) * 100) : 0

  return (
    <Card className="border bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Network className="h-5 w-5 text-primary" />
            Deception Infrastructure
          </CardTitle>
          <Badge variant={wsConnected ? "default" : "secondary"}>
            {wsConnected ? "🟢 Live" : "🟡 Polling"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Health Score */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Infrastructure Health</span>
            <span className={cn(
              "font-bold",
              healthScore > 80 ? "text-emerald-500" : 
              healthScore > 50 ? "text-amber-500" : "text-rose-500"
            )}>
              {healthScore}%
            </span>
          </div>
          <Progress 
            value={healthScore} 
            className="h-2"
          />
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard 
            icon={Server} 
            label="Active Decoys" 
            value={activeDecoys} 
            subValue={`/ ${totalVMs} total`}
            color="primary"
          />
          <StatCard 
            icon={Shield} 
            label="Sessions" 
            value={totalSessions} 
            subValue="active"
            color="accent"
          />
          <StatCard 
            icon={Activity} 
            label="Attackers" 
            value={totalAttackers} 
            subValue="detected"
            color="destructive"
          />
          <StatCard 
            icon={Container} 
            label="Containers" 
            value={totalContainers} 
            subValue="running"
            color="chart-3"
          />
        </div>

        {/* Credentials Alert */}
        {totalCredentials > 0 && (
          <div className="bg-chart-3/10 border border-chart-3/20 rounded-lg p-3 flex items-center gap-3">
            <Shield className="h-5 w-5 text-chart-3" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {totalCredentials} credentials harvested
              </p>
              <p className="text-xs text-muted-foreground">
                Across {runningCount} active honeypot VMs
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatCard({ 
  icon: Icon, 
  label, 
  value, 
  subValue,
  color 
}: { 
  icon: React.ElementType
  label: string
  value: number
  subValue: string
  color: "primary" | "accent" | "destructive" | "chart-3"
}) {
  const colorClasses = {
    primary: "bg-primary/10 text-primary",
    accent: "bg-accent/10 text-accent",
    destructive: "bg-destructive/10 text-destructive",
    "chart-3": "bg-chart-3/10 text-chart-3",
  }

  return (
    <div className="bg-secondary/30 rounded-lg p-3 space-y-2">
      <div className={cn("w-8 h-8 rounded-md flex items-center justify-center", colorClasses[color])}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-bold text-foreground">{value}</span>
          <span className="text-xs text-muted-foreground">{subValue}</span>
        </div>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}