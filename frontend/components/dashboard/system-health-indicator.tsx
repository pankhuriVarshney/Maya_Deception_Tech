"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { useSharedWebSocket } from "@/hooks/use-shared-websocket"
import { Activity, Server, Database, Wifi, WifiOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { getApiHttpBase } from "@/lib/api-base"

export function SystemHealthIndicator() {
  const { connected } = useSharedWebSocket()

  const [backendHealth, setBackendHealth] = useState<"healthy" | "degraded" | "offline">("healthy")
  const [mongodbStatus, setMongodbStatus] = useState<"connected" | "disconnected">("connected")
  const [lastCheck, setLastCheck] = useState<Date | null>(null)
  const [responseTime, setResponseTime] = useState<number>(0)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)

    const checkHealth = async () => {
      const startTime = Date.now()

      try {
        const res = await fetch(`${getApiHttpBase()}/health`, {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        })

        const responseTimeMs = Date.now() - startTime
        setResponseTime(responseTimeMs)

        if (res.ok) {
          const data = await res.json()
          setBackendHealth("healthy")
          setMongodbStatus(
            data.mongodb === "connected" ? "connected" : "disconnected"
          )
        } else {
          setBackendHealth("degraded")
        }
      } catch {
        setBackendHealth("offline")
        setMongodbStatus("disconnected")
      }

      setLastCheck(new Date())
    }

    checkHealth()
    const interval = setInterval(checkHealth, 30000)

    return () => clearInterval(interval)
  }, [])

  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy":
      case "connected":
        return "text-green-600 bg-green-500/10 border-green-500/50"
      case "degraded":
        return "text-yellow-600 bg-yellow-500/10 border-yellow-500/50"
      case "offline":
      case "disconnected":
        return "text-red-600 bg-red-500/10 border-red-500/50"
      default:
        return "text-gray-600 bg-gray-500/10 border-gray-500/50"
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "offline":
      case "disconnected":
        return <Server className="h-3 w-3" />
      default:
        return <Activity className="h-3 w-3" />
    }
  }

  return (
    <div className="flex items-center gap-4 text-xs">
      {/* WebSocket Status */}
      <div className="flex items-center gap-1.5">
        {connected ? (
          <Wifi className="h-4 w-4 text-green-600" />
        ) : (
          <WifiOff className="h-4 w-4 text-red-600" />
        )}
        <span
          className={cn(
            "font-medium",
            connected ? "text-green-600" : "text-red-600"
          )}
        >
          {connected ? "WebSocket Connected" : "Disconnected"}
        </span>
      </div>

      {/* Backend Health */}
      <Badge
        variant="outline"
        className={cn("gap-1.5", getStatusColor(backendHealth))}
      >
        {getStatusIcon(backendHealth)}
        Backend: {backendHealth}
      </Badge>

      {/* MongoDB Status */}
      <Badge
        variant="outline"
        className={cn("gap-1.5", getStatusColor(mongodbStatus))}
      >
        <Database className="h-3 w-3" />
        MongoDB: {mongodbStatus}
      </Badge>

      {/* Response Time */}
      {backendHealth === "healthy" && (
        <span className="text-muted-foreground">{responseTime}ms</span>
      )}

      {/* Last Check (Hydration Safe) */}
      <span className="text-muted-foreground text-xs">
        Updated:{" "}
        {mounted && lastCheck
          ? lastCheck.toLocaleTimeString("en-GB", { hour12: false })
          : "--:--:--"}
      </span>
    </div>
  )
}