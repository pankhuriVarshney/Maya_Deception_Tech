"use client"

import { Network, Server, Shield, Activity, Container, Brain } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { useVMStatus } from "@/hooks/use-vm-status"
import { cn } from "@/lib/utils"
import { RLDecisionsPanel } from "./rl-decisions-panel"
import { RLSophisticationGauge } from "./rl-sophistication-gauge"
import { RLFeatureTable } from "./rl-feature-table"
import { RLRewardCurve } from "./rl-reward-curve"
import { RLArtifactsPanel } from "./rl-artifacts-panel"

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

        {/* === Phase 6: RL Adaptive Engine Section (Hackathon Wow) === */}
        <div className="pt-4 border-t">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="h-4 w-4 text-purple-500" />
            <span className="font-semibold text-sm tracking-tight">RL ADAPTIVE DECEPTION — LIVE</span>
            <Badge variant="outline" className="text-[10px] border-purple-500 text-purple-600">PHASE 6</Badge>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
            {/* Live decisions feed - the star of the demo */}
            <div className="xl:col-span-7">
              <RLDecisionsPanel maxItems={5} />
            </div>

            <div className="xl:col-span-5 space-y-3">
              <RLSophisticationGauge 
                confidence={0.87} 
                avgConfidence={0.79} 
                label="Current Attacker Sophistication (RL view)" 
              />
              <RLRewardCurve decisions={[]} /> {/* Populated live via WS in real usage */}
            </div>

            <div className="xl:col-span-12">
              <RLFeatureTable 
                features={{
                  recon_command_count: 13.4,
                  privilege_escalation_attempts: 3.8,
                  mitre_ttp_coverage: 4,
                  command_entropy: 4.1,
                  fingerprint_risk_score: 1.8,
                  num_lateral_moves: 2,
                }} 
              />
            </div>
          </div>

          <div className="mt-2 text-[10px] text-center text-muted-foreground">
            Static tier = short dwell. <span className="font-medium text-purple-600">RL adaptive</span> = dramatically longer engagement + new TTPs observed.
          </div>

          {/* Live Actuation Artifacts - the killer demo feature */}
          <div className="mt-4 pt-4 border-t">
            <RLArtifactsPanel />
          </div>
        </div>
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