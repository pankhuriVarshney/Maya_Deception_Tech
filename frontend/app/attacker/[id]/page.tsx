import { AttackerDashboardContainer } from "@/components/dashboard/attacker-dashboard-container"
import { getMockAttackerDetails } from "@/lib/attackers/mock"

export default async function AttackerDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const details = getMockAttackerDetails(id, new Date())
  return <AttackerDashboardContainer attackerId={id} initialDetails={details} />
}
