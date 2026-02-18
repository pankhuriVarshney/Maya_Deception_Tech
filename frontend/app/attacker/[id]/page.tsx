import { AttackerDashboardContainer } from "@/components/dashboard/attacker-dashboard-container"
import { getAttackerDetailsFromApi } from "@/lib/attackers/api"

export default async function AttackerDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  
  // Try to fetch initial data from API (server-side)
  // This provides initial SSR data, then client takes over with real-time updates
  const initialDetails = await getAttackerDetailsFromApi(id).catch(() => null)
  
  return (
    <AttackerDashboardContainer 
      attackerId={id} 
      initialDetails={initialDetails} 
    />
  )
}
