"use client"

import { Navbar } from "@/components/dashboard/navbar"
import { AttackersList } from "@/components/dashboard/attackers-list"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAttackersList } from "@/hooks/use-attackers-list"
import type { AttackerSummary } from "@/types"

type AttackersOverviewProps = {
  initialAttackers?: AttackerSummary[] | null
}

export function AttackersOverview({ initialAttackers }: AttackersOverviewProps) {
  const { data, loading, error, refresh } = useAttackersList(initialAttackers)

  return (
    <div className="min-h-screen bg-background">
      <Navbar
        title="MAYA | Attackers"
        onRefresh={refresh}
        exportDisabled
      />

      <div className="px-4 py-4 space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div className="space-y-1">
            <div className="text-lg font-semibold text-foreground">Attackers Overview</div>
            <div className="text-sm text-muted-foreground">
              Active attacker sessions in deception infrastructure.
            </div>
          </div>
          {Array.isArray(data) && (
            <div className="text-sm text-muted-foreground">
              Showing <span className="text-foreground font-medium">{data.length}</span>
            </div>
          )}
        </div>

        {error ? (
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base">Failed To Load</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {(error as Error)?.message ?? "Unknown error"}
            </CardContent>
          </Card>
        ) : (
          <AttackersList attackers={data} loading={loading} />
        )}
      </div>
    </div>
  )
}
