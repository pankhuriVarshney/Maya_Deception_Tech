import { InfrastructureNodeDetail } from "@/components/dashboard/infrastructure-node-detail"

export default async function InfrastructureNodePage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params

  return (
    <div className="px-4 py-4">
      <InfrastructureNodeDetail name={name} />
    </div>
  )
}
