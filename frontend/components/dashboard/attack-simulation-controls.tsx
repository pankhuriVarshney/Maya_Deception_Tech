"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { getApiHttpBase } from "@/lib/api-base"
import { 
  Play, 
  ShieldAlert, 
  Network, 
  KeyRound, 
  Terminal, 
  Loader2,
  RefreshCw,
  Target,
  Building2
} from "lucide-react"

interface SimulationScenario {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  endpoint: string
  payload: any
}

interface DecoyBlueprintSummary {
  blueprintId: string
  vmName: string
  companyName: string
  industry: string
  profile?: string
  employeeCount: number
  serverCount: number
  documentCount: number
  techStack: string[]
  applied?: {
    vmName: string
    created: boolean
    templateVmName: string
    usersCreated: number
    documentsDeployed: number
    servicesMarked: number
    warnings: string[]
  } | null
}

export function AttackSimulationControls() {
  const [isRunning, setIsRunning] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<Record<string, Date>>({})
  const [decoySummary, setDecoySummary] = useState<DecoyBlueprintSummary | null>(null)
  const [pendingApplyBlueprintId, setPendingApplyBlueprintId] = useState<string | null>(null)
  const { toast } = useToast()
  const decoyApiBaseUrl = getApiHttpBase()
  const industryBadgeLabel: Record<string, string> = {
    fintech: "FinTech",
    healthcare: "Healthcare",
    saas: "SaaS",
    enterprise: "Enterprise",
  }

  const generateVmName = (companyName: string, role: string) => {
    const normalizedCompany = (companyName || "decoy")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    const stopWords = new Set(["systems", "system", "health", "cloud", "enterprise", "group", "inc", "corp", "llc"])
    const words = normalizedCompany.split(" ").filter(Boolean)
    const companySlug = (words.find((word) => !stopWords.has(word)) || words[0] || "decoy").replace(/[^a-z0-9]/g, "")
    const roleSlug = (role || "web").toLowerCase().replace(/[^a-z0-9]/g, "") || "web"
    return `${companySlug}-${roleSlug}-01`
  }

  const getDecoyApiUrl = (path: string) => {
    if (typeof window === "undefined") return path
    return `${decoyApiBaseUrl}${path}`
  }

  const emitVmRefresh = () => {
    if (typeof window === "undefined") return
    window.dispatchEvent(new CustomEvent("maya:vm-refresh"))
  }

  const scenarios: SimulationScenario[] = [
    {
      id: "ssh-bruteforce",
      name: "SSH Brute Force Attack",
      description: "Simulate multiple failed SSH login attempts followed by successful credential use",
      icon: <Terminal className="h-5 w-5" />,
      endpoint: "/api/simulation/ssh-bruteforce",
      payload: { target: "fake-jump-01", attempts: 5 }
    },
    {
      id: "lateral-movement",
      name: "Lateral Movement",
      description: "Simulate attacker pivoting from one host to another using stolen credentials",
      icon: <Network className="h-5 w-5" />,
      endpoint: "/api/simulation/lateral-movement",
      payload: { source: "fake-web-01", targets: ["fake-jump-01", "fake-ftp-01"] }
    },
    {
      id: "credential-theft",
      name: "Credential Dumping",
      description: "Simulate Mimikatz-style credential extraction from memory",
      icon: <KeyRound className="h-5 w-5" />,
      endpoint: "/api/simulation/credential-theft",
      payload: { target: "fake-web-01", tool: "mimikatz" }
    },
    {
      id: "discovery",
      name: "Network Discovery",
      description: "Simulate attacker reconnaissance and network scanning activities",
      icon: <Target className="h-5 w-5" />,
      endpoint: "/api/simulation/discovery",
      payload: { source: "fake-jump-01", scanType: "internal" }
    },
    {
      id: "privilege-escalation",
      name: "Privilege Escalation",
      description: "Simulate attacker gaining elevated privileges on compromised host",
      icon: <ShieldAlert className="h-5 w-5" />,
      endpoint: "/api/simulation/privilege-escalation",
      payload: { target: "fake-ftp-01", method: "sudo-exploit" }
    },
    {
      id: "full-campaign",
      name: "Full Attack Campaign",
      description: "Simulate complete attack chain from initial access to data exfiltration",
      icon: <Play className="h-5 w-5" />,
      endpoint: "/api/simulation/full-campaign",
      payload: { complexity: "advanced" }
    }
  ]

  const runSimulation = async (scenario: SimulationScenario) => {
    setIsRunning(scenario.id)

    try {
      // FIRST: Refresh VM cache to ensure we have latest running VMs
      await fetch("/api/simulation/refresh-vms", { method: "POST" })

      const response = await fetch(scenario.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scenario.payload)
      })

      if (!response.ok) {
        throw new Error(`Simulation failed: ${response.status}`)
      }

      const result = await response.json()

      setLastRun(prev => ({ ...prev, [scenario.id]: new Date() }))

      const attackType = result.real ? "REAL" : "MOCK"
      toast({
        title: `${attackType} Simulation ${result.success ? "Started" : "Failed"}`,
        description: result.real
          ? `${scenario.name} simulation executed on REAL VM infrastructure`
          : `${scenario.name} simulation (VM not available - using mock data)`,
        variant: result.real ? "default" : "destructive"
      })

      // Trigger immediate CRDT sync to propagate the simulation data
      if (result.success) {
        await fetch("/api/simulation/trigger-sync", { method: "POST" })
      }

    } catch (error) {
      toast({
        title: "Simulation Error",
        description: error instanceof Error ? error.message : "Failed to run simulation",
        variant: "destructive"
      })
    } finally {
      setIsRunning(null)
    }
  }

  const triggerSync = async () => {
    setIsRunning("sync")
    
    try {
      const response = await fetch("/api/simulation/trigger-sync", {
        method: "POST"
      })

      if (!response.ok) {
        throw new Error("Failed to trigger sync")
      }

      toast({
        title: "CRDT Sync Triggered",
        description: "Synchronizing state across all VMs",
      })
    } catch (error) {
      toast({
        title: "Sync Error",
        description: error instanceof Error ? error.message : "Failed to trigger sync",
        variant: "destructive"
      })
    } finally {
      setIsRunning(null)
    }
  }

  const generateDecoyEnvironment = async () => {
    setIsRunning("decoy-generation")

    try {
      const response = await fetch(getDecoyApiUrl("/api/decoy/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry: "FinTech",
          companySize: 180,
          region: "US-East"
        })
      })

      const result = await response.json()
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || `Failed to generate blueprint (${response.status})`)
      }

      const blueprint = result.data?.blueprint
      const primaryRole = blueprint?.internalServers?.[0]?.type || "web"
      setDecoySummary({
        blueprintId: result.data?.blueprintId,
        vmName: generateVmName(blueprint?.companyName || "decoy", primaryRole),
        companyName: blueprint?.companyName || "Unknown Company",
        industry: blueprint?.industry || "Unknown",
        profile: blueprint?.profile || "",
        employeeCount: Array.isArray(blueprint?.employees) ? blueprint.employees.length : 0,
        serverCount: Array.isArray(blueprint?.internalServers) ? blueprint.internalServers.length : 0,
        documentCount: Array.isArray(blueprint?.documents) ? blueprint.documents.length : 0,
        techStack: Array.isArray(blueprint?.techStack) ? blueprint.techStack.slice(0, 5) : [],
        applied: null
      })

      toast({
        title: "Decoy environment blueprint generated",
        description: `Blueprint ${result.data?.blueprintId} is ready to apply`
      })
    } catch (error) {
      toast({
        title: "Generation Error",
        description: error instanceof Error ? error.message : "Failed to generate decoy blueprint",
        variant: "destructive"
      })
    } finally {
      setIsRunning(null)
    }
  }

  const sleep = (ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

  const applyDecoyResultToSummary = (result: any) => {
    const deployment = result?.data?.deployment
    const vmInfo = result?.data?.vm

    setDecoySummary((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        vmName: vmInfo?.vmName || prev.vmName,
        applied: {
          vmName: deployment?.vmName || vmInfo?.vmName || prev.vmName,
          created: Boolean(vmInfo?.created),
          templateVmName: vmInfo?.templateVmName || "fake-web-01",
          usersCreated: deployment?.usersCreated ?? 0,
          documentsDeployed: deployment?.documentsDeployed ?? 0,
          servicesMarked: deployment?.servicesMarked ?? 0,
          warnings: Array.isArray(deployment?.warnings) ? deployment.warnings : []
        }
      }
    })

    emitVmRefresh()

    return {
      deployment,
      vmInfo
    }
  }

  const pollBlueprintStatus = async (blueprintId: string, timeoutMs = 90000) => {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      try {
        const res = await fetch(getDecoyApiUrl(`/api/decoy/status/${blueprintId}`), { cache: "no-store" })
        const body = await res.json().catch(() => null)

        if (res.ok && body?.success) {
          const status = body?.data?.status
          if (status === "applied") {
            return body
          }
          if (status === "failed") {
            throw new Error(body?.data?.errorMessage || "Blueprint apply failed")
          }
        }
      } catch (error) {
        if (error instanceof Error && error.message.toLowerCase().includes("failed")) {
          throw error
        }
      }

      await sleep(1500)
    }

    return null
  }

  const monitorApplyCompletion = async (blueprintId: string, fallbackVmName: string) => {
    try {
      const recovered = await pollBlueprintStatus(blueprintId, 6 * 60 * 1000)
      if (recovered?.data?.status === "applied") {
        const { deployment, vmInfo } = applyDecoyResultToSummary(recovered)
        toast({
          title: "Apply Completed",
          description: `Decoy is running on ${deployment?.vmName || vmInfo?.vmName || fallbackVmName}`,
        })
        return
      }

      if (recovered?.data?.status === "failed") {
        toast({
          title: "Apply Error",
          description: recovered?.data?.errorMessage || "Blueprint apply failed",
          variant: "destructive"
        })
        return
      }

      toast({
        title: "Apply Pending",
        description: "Deployment is still running. You can refresh status from the dashboard.",
      })
    } catch (statusError) {
      const message = statusError instanceof Error ? statusError.message : String(statusError)
      toast({
        title: "Apply Error",
        description: message,
        variant: "destructive"
      })
    } finally {
      setPendingApplyBlueprintId((current) => (current === blueprintId ? null : current))
    }
  }

  const applyDecoyEnvironment = async () => {
    if (!decoySummary?.blueprintId) {
      toast({
        title: "No Blueprint Selected",
        description: "Generate a decoy blueprint first",
        variant: "destructive"
      })
      return
    }

    if (decoySummary.applied) {
      toast({
        title: "Blueprint Already Applied",
        description: `This blueprint is already applied to ${decoySummary.applied.vmName}. Generate a new blueprint for another decoy.`,
      })
      return
    }

    setIsRunning("decoy-apply")
    setPendingApplyBlueprintId(decoySummary.blueprintId)

    try {
      const payload = JSON.stringify({
        templateVmName: "fake-web-01"
      })
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 20000)
      let response: Response
      try {
        response = await fetch(getDecoyApiUrl(`/api/decoy/create-and-apply/${decoySummary.blueprintId}`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: controller.signal
        })
      } finally {
        clearTimeout(timeoutId)
      }
      const raw = await response.text()
      let result: any = null
      try {
        result = raw ? JSON.parse(raw) : null
      } catch {
        if (!response.ok) {
          throw new Error(raw || `Failed to apply blueprint (${response.status})`)
        }
      }

      if (!response.ok || !result?.success) {
        throw new Error(result?.error || raw || "Failed to apply blueprint")
      }

      const inlineApplied = result?.data?.status === "applied" || Boolean(result?.data?.deployment)
      if (inlineApplied) {
        const { deployment, vmInfo } = applyDecoyResultToSummary(result)
        toast({
          title: vmInfo?.created ? "Decoy VM created and blueprint applied" : "Blueprint applied",
          description: `Environment deployed to ${deployment?.vmName || vmInfo?.vmName || decoySummary.vmName}`
        })
        toast({
          title: "Apply Completed",
          description: "One decoy from this blueprint is now deployed. Generate a new blueprint to deploy another.",
        })
        setPendingApplyBlueprintId(null)
      } else {
        toast({
          title: "Apply Started",
          description: `Deploying decoy to ${result?.data?.vmName || decoySummary.vmName}. This runs in background.`,
        })
        void monitorApplyCompletion(decoySummary.blueprintId, decoySummary.vmName)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to apply decoy blueprint"
      toast({
        title: "Apply Request Interrupted",
        description: `${message}. Checking deployment status...`,
      })
      void monitorApplyCompletion(decoySummary.blueprintId, decoySummary.vmName)
    } finally {
      setIsRunning(null)
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5" />
              Attack Simulation Controls
            </CardTitle>
            <CardDescription className="mt-1">
              Manually trigger attack scenarios to demonstrate real-time detection and CRDT synchronization
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={generateDecoyEnvironment}
              disabled={isRunning === "decoy-generation"}
              className="gap-2"
            >
              {isRunning === "decoy-generation" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Building2 className="h-4 w-4" />
              )}
              Generate Decoy Environment
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={applyDecoyEnvironment}
              disabled={isRunning === "decoy-apply" || pendingApplyBlueprintId === decoySummary?.blueprintId || !decoySummary?.blueprintId || Boolean(decoySummary?.applied)}
              className="gap-2"
            >
              {isRunning === "decoy-apply" || pendingApplyBlueprintId === decoySummary?.blueprintId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : decoySummary?.applied ? (
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {decoySummary?.applied ? "Already Applied" : (pendingApplyBlueprintId === decoySummary?.blueprintId ? "Applying..." : "Apply Blueprint")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={triggerSync}
              disabled={isRunning === "sync"}
              className="gap-2"
            >
              {isRunning === "sync" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Force CRDT Sync
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {scenarios.map((scenario) => {
            const isCurrentlyRunning = isRunning === scenario.id
            const wasRun = lastRun[scenario.id]
            
            return (
              <div
                key={scenario.id}
                className="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-primary/10 rounded-md">
                      {scenario.icon}
                    </div>
                    <div>
                      <h4 className="font-medium text-sm">{scenario.name}</h4>
                      {wasRun && (
                        <p className="text-xs text-muted-foreground">
                          Last run: {wasRun.toLocaleTimeString()}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  {scenario.description}
                </p>
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => runSimulation(scenario)}
                  disabled={isCurrentlyRunning}
                >
                  {isCurrentlyRunning ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Run Simulation
                    </>
                  )}
                </Button>
              </div>
            )
          })}
        </div>

        <div className="mt-4 p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline" className="text-xs">
              ℹ️ Demo Mode
            </Badge>
            <p>
              Simulations create realistic attack events that are detected by the CRDT system and displayed in real-time on the dashboard.
            </p>
          </div>
        </div>

        {decoySummary && (
          <div className="mt-4 p-4 border rounded-lg bg-background">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Badge>Blueprint Ready</Badge>
              <span className="text-xs text-muted-foreground">{decoySummary.blueprintId}</span>
              {pendingApplyBlueprintId === decoySummary.blueprintId && (
                <Badge variant="secondary" className="gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Applying
                </Badge>
              )}
              {decoySummary.applied && (
                <Badge className="bg-emerald-600 hover:bg-emerald-600">Applied</Badge>
              )}
            </div>
            <h4 className="font-medium">{decoySummary.companyName}</h4>
            <div className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
              <span>{decoySummary.industry} decoy profile</span>
              {decoySummary.profile && (
                <Badge variant="secondary" className="text-[10px] uppercase">
                  {industryBadgeLabel[decoySummary.profile.toLowerCase()] || decoySummary.profile}
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
              <div>Employees: <span className="font-medium">{decoySummary.employeeCount}</span></div>
              <div>Internal Servers: <span className="font-medium">{decoySummary.serverCount}</span></div>
              <div>Documents: <span className="font-medium">{decoySummary.documentCount}</span></div>
            </div>
            {decoySummary.techStack.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Tech stack: {decoySummary.techStack.join(", ")}
              </p>
            )}
            {pendingApplyBlueprintId === decoySummary.blueprintId && (
              <div className="mt-3 border-t pt-3">
                <p className="text-xs text-muted-foreground">
                  Deployment in progress. VM boot and provisioning can take 1-2 minutes.
                </p>
              </div>
            )}
            {decoySummary.applied && (
              <div className="mt-3 border-t pt-3">
                <p className="text-xs font-medium mb-1">
                  Applied to {decoySummary.applied.vmName} ({decoySummary.applied.created ? "new VM" : "existing VM"})
                </p>
                <p className="text-xs text-muted-foreground">
                  Template used: {decoySummary.applied.templateVmName}
                </p>
                <p className="text-xs text-muted-foreground">
                  Users: {decoySummary.applied.usersCreated} | Docs: {decoySummary.applied.documentsDeployed} | Services: {decoySummary.applied.servicesMarked}
                </p>
                {decoySummary.applied.warnings.length > 0 && (
                  <p className="text-xs text-amber-500 mt-1">
                    Warnings: {decoySummary.applied.warnings.length}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
