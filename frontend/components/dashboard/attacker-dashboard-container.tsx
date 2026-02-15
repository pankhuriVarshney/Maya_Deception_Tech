"use client"

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
import { useAttackerDetail } from "@/hooks/use-attacker-detail"
import type { AttackerDetails } from "@/types"

type AttackerDashboardContainerProps = {
  attackerId: string
  initialDetails?: AttackerDetails | null
}

export function AttackerDashboardContainer({ attackerId, initialDetails }: AttackerDashboardContainerProps) {
  const { data, loading: isLoading, refresh } = useAttackerDetail(attackerId, initialDetails)
  const dashboard = data?.dashboard ?? null
  const generatedAt = data?.generatedAt ?? null
  const loading = isLoading && !dashboard

  return (
    <div className="min-h-screen bg-background">
      <Navbar
        title={`MAYA | ${attackerId}`}
        onRefresh={() => {
          refresh()
          toast({ title: "Refresh", description: "Reloading dashboard…" })
        }}
        onExport={() => {
          if (!dashboard) {
            toast({ title: "Export failed", description: "Dashboard data not loaded yet." })
            return
          }

          const xml = dashboardToSpreadsheetXml(dashboard, generatedAt)
          const blob = new Blob([xml], { type: "application/vnd.ms-excel" })

          const date = new Date().toISOString().slice(0, 19).replaceAll(":", "-")
          // SpreadsheetML (Excel 2003 XML). Using .xls ensures it opens in Excel/LibreOffice by default.
          const filename = `maya-dashboard-export-${attackerId}-${date}.xls`

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
        exportDisabled={!dashboard}
      />

      <MetricsRow overview={dashboard?.overview ?? null} loading={loading} />

      <div className="px-4 pb-4 space-y-3">
        <StatusBar overview={dashboard?.overview ?? null} loading={loading} />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <div className="lg:col-span-3 space-y-3">
            <AttackerProfile attacker={dashboard?.attacker ?? null} loading={loading} />
            <CredentialUsage data={dashboard?.credentialUsage ?? null} loading={loading} />
            <DeceptionMetrics data={dashboard?.deceptionMetrics ?? null} loading={loading} />
          </div>

          <div className="lg:col-span-5 space-y-3">
            <AttackTimeline events={dashboard?.timeline ?? null} loading={loading} />
            <LateralMovement data={dashboard?.lateralMovement ?? null} loading={loading} />
            <ActivityChart data={dashboard?.activityChart ?? null} loading={loading} />
          </div>

          <div className="lg:col-span-4 space-y-3">
            <MitreMatrix data={dashboard?.mitre ?? null} loading={loading} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CommandActivity data={dashboard?.commandActivity ?? null} loading={loading} />
              <BehaviorAnalysis data={dashboard?.behaviorAnalysis ?? null} loading={loading} />
            </div>
            <IncidentSummary data={dashboard?.incidentSummary ?? null} loading={loading} />
          </div>
        </div>
      </div>
    </div>
  )
}
