"use client"

import { useDashboard } from "@/hooks/use-dashboard"
import { toast } from "@/hooks/use-toast"
import { Navbar } from "@/components/dashboard/navbar"
import { MetricsRow } from "@/components/dashboard/metrics-row"
import { StatusBar } from "@/components/dashboard/status-bar"
import { AttackerProfile } from "@/components/dashboard/attacker-profile"
import { CredentialUsage } from "@/components/dashboard/credential-usage"
import { DeceptionMetrics } from "@/components/dashboard/deception-metrics"
import { AttackTimeline } from "@/components/dashboard/attack-timeline"
import { MitreMatrix } from "@/components/dashboard/mitre-matrix"
import { LateralMovement } from "@/components/dashboard/lateral-movement"
import { CommandActivity } from "@/components/dashboard/command-activity"
import { BehaviorAnalysis } from "@/components/dashboard/behavior-analysis"
import { IncidentSummary } from "@/components/dashboard/incident-summary"
import { ActivityChart } from "@/components/dashboard/activity-chart"
import { dashboardToSpreadsheetXml } from "@/lib/export/dashboard-export"

export function DashboardContainer() {
  const { data, isLoading, refresh, generatedAt } = useDashboard({ pollIntervalMs: 5000 })
  const loading = isLoading && !data

  return (
    <div className="min-h-screen bg-background">
      <Navbar
        onRefresh={() => {
          refresh()
          toast({ title: "Refresh", description: "Reloading dashboard…" })
        }}
        onExport={() => {
          if (!data) {
            toast({ title: "Export failed", description: "Dashboard data not loaded yet." })
            return
          }

          const xml = dashboardToSpreadsheetXml(data, generatedAt)
          const blob = new Blob([xml], { type: "application/vnd.ms-excel" })

          const date = new Date().toISOString().slice(0, 19).replaceAll(":", "-")
          // SpreadsheetML (Excel 2003 XML). Using .xls ensures it opens in Excel/LibreOffice by default.
          const filename = `maya-dashboard-export-${date}.xls`

          const url = URL.createObjectURL(blob)
          const a = document.createElement("a")
          a.href = url
          a.download = filename
          document.body.appendChild(a)
          a.click()
          a.remove()
          URL.revokeObjectURL(url)

          toast({ title: "Export", description: `Downloaded ${filename}` })
        }}
        exportDisabled={!data}
      />
      <MetricsRow overview={data?.overview ?? null} loading={loading} />

      <div className="px-4 pb-4 space-y-3">
        <StatusBar overview={data?.overview ?? null} loading={loading} />

        {/* Main grid layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* Left column - Attacker info */}
          <div className="lg:col-span-3 space-y-3">
            <AttackerProfile attacker={data?.attacker ?? null} loading={loading} />
            <CredentialUsage data={data?.credentialUsage ?? null} loading={loading} />
            <DeceptionMetrics data={data?.deceptionMetrics ?? null} loading={loading} />
          </div>

          {/* Center column - Timeline & Movement */}
          <div className="lg:col-span-5 space-y-3">
            <AttackTimeline events={data?.timeline ?? null} loading={loading} />
            <LateralMovement data={data?.lateralMovement ?? null} loading={loading} />
            <ActivityChart data={data?.activityChart ?? null} loading={loading} />
          </div>

          {/* Right column - MITRE, Commands, Summary */}
          <div className="lg:col-span-4 space-y-3">
            <MitreMatrix data={data?.mitre ?? null} loading={loading} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CommandActivity data={data?.commandActivity ?? null} loading={loading} />
              <BehaviorAnalysis data={data?.behaviorAnalysis ?? null} loading={loading} />
            </div>
            <IncidentSummary data={data?.incidentSummary ?? null} loading={loading} />
          </div>
        </div>
      </div>
    </div>
  )
}
