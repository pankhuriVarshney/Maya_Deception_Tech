import { InfrastructureOverview } from "@/components/dashboard/infrastructure-overview"
import { RealTimeAlerts } from "@/components/dashboard/real-time-alerts"
import { SecurityPostureCard } from "@/components/dashboard/security-posture-card"

export default function OverviewPage() {
  return (
    <div className="px-4 py-4 space-y-4">
      <InfrastructureOverview />
      <RealTimeAlerts />
      <SecurityPostureCard />
    </div>
  )
}
