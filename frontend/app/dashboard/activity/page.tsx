import { CRDTSyncStatusPanel } from "@/components/dashboard/crdt-sync-status"
import { LiveActivityFeed } from "@/components/dashboard/live-activity-feed"
import { AttackTimelinePanel } from "@/components/dashboard/attack-timeline-panel"
import { NetworkAttackGraph } from "@/components/dashboard/network-attack-graph"

export default function ActivityPage() {
  return (
    <div className="px-4 py-4 space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4">
          <CRDTSyncStatusPanel />
        </div>
        <div className="lg:col-span-8">
          <LiveActivityFeed />
        </div>
      </div>

      <AttackTimelinePanel />
      <NetworkAttackGraph />
    </div>
  )
}
