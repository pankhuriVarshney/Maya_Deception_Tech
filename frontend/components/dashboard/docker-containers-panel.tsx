"use client"

import { Container, Box, ExternalLink, PauseCircle, PlayCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useVMStatus } from "@/hooks/use-vm-status"
import { cn } from "@/lib/utils"

type DockerContainersPanelProps = {
  className?: string
}

function ContainerCard({ container, vmName }: { container: { id: string; name: string; image: string; status: string; ports: string[] }; vmName: string }) {
  const isRunning = container.status === 'running'
  
  return (
    <div className={cn(
      "flex items-center justify-between p-3 rounded-lg border",
      isRunning ? "bg-card border-border" : "bg-muted/30 border-muted"
    )}>
      <div className="flex items-start gap-3 min-w-0">
        <div className={cn(
          "p-2 rounded-md shrink-0",
          isRunning ? "bg-emerald-500/10" : "bg-rose-500/10"
        )}>
          <Box className={cn(
            "h-4 w-4",
            isRunning ? "text-emerald-500" : "text-rose-500"
          )} />
        </div>
        
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-sm truncate">{container.name}</h4>
            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
              {vmName}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground font-mono truncate">{container.image}</p>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="font-mono">{container.id.substring(0, 12)}</span>
            {container.ports.length > 0 && (
              <span>• {container.ports.length} ports</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isRunning ? (
          <PlayCircle className="h-5 w-5 text-emerald-500" />
        ) : (
          <PauseCircle className="h-5 w-5 text-rose-500" />
        )}
      </div>
    </div>
  )
}

export function DockerContainersPanel({ className }: DockerContainersPanelProps) {
  const { vms, loading } = useVMStatus()

  // Flatten all containers from all VMs
  const allContainers = vms.flatMap(vm => 
    (vm.dockerContainers || []).map(container => ({
      ...container,
      vmName: vm.name,
      vmStatus: vm.status
    }))
  ).filter(c => c.vmStatus === 'running')

  const runningContainers = allContainers.filter(c => c.status === 'running')
  const stoppedContainers = allContainers.filter(c => c.status !== 'running')

  return (
    <Card className={cn("border bg-card", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Container className="h-4 w-4 text-primary" />
            Docker Containers
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
              {runningContainers.length} running
            </Badge>
            {stoppedContainers.length > 0 && (
              <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-500 border-rose-500/20">
                {stoppedContainers.length} stopped
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-2">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))
            ) : allContainers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Container className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No containers found</p>
                <p className="text-xs">Start VMs to see containers</p>
              </div>
            ) : (
              allContainers.map((container) => (
                <ContainerCard 
                  key={`${container.vmName}-${container.id}`} 
                  container={container} 
                  vmName={container.vmName}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}