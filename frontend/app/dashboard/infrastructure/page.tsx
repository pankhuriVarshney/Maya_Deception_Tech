import { VMStatusPanel } from "@/components/dashboard/vm-status-panel"
import { DockerContainersPanel } from "@/components/dashboard/docker-containers-panel"

export default function InfrastructurePage() {
  return (
    <div className="px-4 py-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <VMStatusPanel />
        <DockerContainersPanel />
      </div>
    </div>
  )
}
