"use client"

import { Server, Container, Activity, AlertCircle, CheckCircle, XCircle, Clock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Progress } from "@/components/ui/progress"
import { useVMStatus, type VMStatus as VMStatusType } from "@/hooks/use-vm-status"
import { cn } from "@/lib/utils"

type VMStatusPanelProps = {
  className?: string
}

function VMStatusBadge({ status }: { status: VMStatusType['status'] }) {
  const configs = {
    running: { icon: CheckCircle, color: "text-emerald-500", bg: "bg-emerald-500/10", label: "Running" },
    stopped: { icon: XCircle, color: "text-rose-500", bg: "bg-rose-500/10", label: "Stopped" },
    unknown: { icon: AlertCircle, color: "text-amber-500", bg: "bg-amber-500/10", label: "Unknown" },
  }
  
  const config = configs[status]
  const Icon = config.icon
  
  return (
    <Badge variant="outline" className={cn("gap-1.5", config.bg)}>
      <Icon className={cn("h-3 w-3", config.color)} />
      <span className={config.color}>{config.label}</span>
    </Badge>
  )
}

function ContainerStatus({ containers }: { containers?: VMStatusType['dockerContainers'] }) {
  if (!containers || containers.length === 0) {
    return <span className="text-xs text-muted-foreground">No containers</span>
  }

  const running = containers.filter(c => c.status === 'running').length
  const total = containers.length

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Containers</span>
        <span className="font-medium">{running}/{total} running</span>
      </div>
      <div className="flex gap-1">
        {containers.slice(0, 4).map((container) => (
          <div
            key={container.id}
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              container.status === 'running' ? "bg-emerald-500" : "bg-rose-500"
            )}
            title={`${container.name} (${container.image})`}
          />
        ))}
        {containers.length > 4 && (
          <span className="text-[10px] text-muted-foreground">+{containers.length - 4}</span>
        )}
      </div>
    </div>
  )
}

function VMStatusCard({ vm }: { vm: VMStatusType }) {
  return (
    <Card className={cn(
      "border transition-colors",
      vm.status === 'running' ? "bg-card border-border" : "bg-muted/50 border-muted"
    )}>
      <CardContent className="p-3 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Server className={cn(
              "h-4 w-4 shrink-0",
              vm.status === 'running' ? "text-primary" : "text-muted-foreground"
            )} />
            <div className="min-w-0">
              <h4 className="font-medium text-sm truncate">{vm.name}</h4>
              {vm.ip && <p className="text-xs text-muted-foreground font-mono">{vm.ip}</p>}
            </div>
          </div>
          <VMStatusBadge status={vm.status} />
        </div>

        {vm.status === 'running' && vm.crdtState && (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-secondary/50 rounded px-2 py-1 text-center">
              <div className="font-bold text-foreground">{vm.crdtState.attackers}</div>
              <div className="text-[10px] text-muted-foreground">Attackers</div>
            </div>
            <div className="bg-secondary/50 rounded px-2 py-1 text-center">
              <div className="font-bold text-foreground">{vm.crdtState.credentials}</div>
              <div className="text-[10px] text-muted-foreground">Creds</div>
            </div>
            <div className="bg-secondary/50 rounded px-2 py-1 text-center">
              <div className="font-bold text-foreground">{vm.crdtState.sessions}</div>
              <div className="text-[10px] text-muted-foreground">Sessions</div>
            </div>
          </div>
        )}

        {vm.status === 'running' && (
          <ContainerStatus containers={vm.dockerContainers} />
        )}

        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>Updated {new Date(vm.lastSeen).toLocaleTimeString()}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function VMStatusSkeleton() {
  return (
    <Card className="border bg-card">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Skeleton className="h-10 rounded" />
          <Skeleton className="h-10 rounded" />
          <Skeleton className="h-10 rounded" />
        </div>
      </CardContent>
    </Card>
  )
}

export function VMStatusPanel({ className }: VMStatusPanelProps) {
  const { 
    vms, 
    loading, 
    error, 
    lastUpdate, 
    wsConnected,
    runningCount, 
    stoppedCount,
    totalAttackers,
    totalCredentials,
    totalContainers,
    refresh 
  } = useVMStatus(10000)

  const totalVMs = vms.length
  const healthPercentage = totalVMs > 0 ? (runningCount / totalVMs) * 100 : 0

  return (
    <div className={cn("space-y-3", className)}>
      {/* Summary Card */}
      <Card className="border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Infrastructure Health
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={wsConnected ? "default" : "secondary"} className="text-[10px]">
                {wsConnected ? "● Live" : "○ Polling"}
              </Badge>
              {lastUpdate && (
                <span className="text-[10px] text-muted-foreground">
                  {lastUpdate.toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && !vms.length ? (
            <Skeleton className="h-20 w-full" />
          ) : error ? (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          ) : (
            <>
              {/* Health Overview */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">VM Health</span>
                  <span className="font-medium">{runningCount}/{totalVMs} running</span>
                </div>
                <Progress value={healthPercentage} className="h-2" />
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-secondary/30 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    <Server className="h-3 w-3" />
                    VMs
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-foreground">{runningCount}</span>
                    <span className="text-xs text-muted-foreground">/ {totalVMs}</span>
                  </div>
                  {stoppedCount > 0 && (
                    <span className="text-xs text-rose-500">{stoppedCount} stopped</span>
                  )}
                </div>

                <div className="bg-secondary/30 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    <Container className="h-3 w-3" />
                    Containers
                  </div>
                  <div className="text-2xl font-bold text-foreground">{totalContainers}</div>
                </div>

                <div className="bg-secondary/30 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    <Activity className="h-3 w-3" />
                    Attackers
                  </div>
                  <div className="text-2xl font-bold text-destructive">{totalAttackers}</div>
                </div>

                <div className="bg-secondary/30 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    <AlertCircle className="h-3 w-3" />
                    Credentials
                  </div>
                  <div className="text-2xl font-bold text-chart-3">{totalCredentials}</div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* VM List */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground px-1">Virtual Machines</h3>
        <div className="grid gap-2">
          {loading && !vms.length ? (
            <>
              <VMStatusSkeleton />
              <VMStatusSkeleton />
              <VMStatusSkeleton />
            </>
          ) : (
            vms.map((vm) => (
              <VMStatusCard key={vm.name} vm={vm} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}