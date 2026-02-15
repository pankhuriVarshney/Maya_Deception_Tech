import { AttackersOverview } from "@/components/dashboard/attackers-overview"
import { getMockAttackers } from "@/lib/attackers/mock"

export default function DashboardPage() {
  const attackers = getMockAttackers(new Date())
  return <AttackersOverview initialAttackers={attackers} />
}
