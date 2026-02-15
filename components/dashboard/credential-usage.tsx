"use client"

import { AlertTriangle, UserRound, ChevronRight } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import type { DashboardData } from "@/lib/dashboard/types"

type CredentialUsageProps = {
  data: DashboardData["credentialUsage"] | null
  loading?: boolean
}

function warningClasses(kind: "destructive" | "accent") {
  return kind === "destructive"
    ? {
        dot: "bg-destructive",
        row: "bg-destructive/20 text-destructive",
      }
    : {
        dot: "bg-accent",
        row: "bg-accent/20 text-accent",
      }
}

export function CredentialUsage({ data, loading }: CredentialUsageProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <span className="w-1 h-4 rounded-full bg-chart-3" />
          Credential Usage
        </h3>
        <div className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
        </div>
      </div>
      <div className="space-y-2">
        {loading || !data
          ? Array.from({ length: 3 }).map((_, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-muted-foreground" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-chart-3" />
                  <Skeleton className="h-5 w-5 rounded" />
                  <Skeleton className="h-5 w-5 rounded" />
                </div>
              </div>
            ))
          : data.credentials.map((cred) => (
              <div
                key={cred.name}
                className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{cred.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-chart-3" />
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-destructive text-destructive-foreground text-xs font-bold">
                    {cred.alerts}
                  </span>
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-accent text-accent-foreground text-xs font-bold">
                    {cred.sessions}
                  </span>
                </div>
              </div>
            ))}
      </div>
      <div className="mt-3 space-y-1.5">
        {loading || !data
          ? Array.from({ length: 2 }).map((_, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-md px-3 py-2 bg-secondary/30 text-muted-foreground"
              >
                <div className="flex items-center gap-2">
                  <Skeleton className="w-2 h-2 rounded-full" />
                  <Skeleton className="h-4 w-40" />
                </div>
                <ChevronRight className="h-4 w-4" />
              </div>
            ))
          : data.warnings.map((w) => {
              const cls = warningClasses(w.kind)
              return (
                <div
                  key={w.label}
                  className={`flex items-center justify-between rounded-md px-3 py-2 ${cls.row}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${cls.dot}`} />
                    <span className="text-sm font-medium">{w.label}</span>
                  </div>
                  <ChevronRight className="h-4 w-4" />
                </div>
              )
            })}
      </div>
    </div>
  )
}
