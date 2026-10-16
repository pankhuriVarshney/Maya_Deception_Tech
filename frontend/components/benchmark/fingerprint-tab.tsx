"use client"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { RunSnapshot, ScenarioInfo } from "@/lib/benchmark/types"

// P1 is judged during the password-guessing stage, so it isn't in the scenario's probe list.
const P1 = {
  id: "P1",
  name: "Weak password accepted",
  kind: "tell" as const,
  description: "the server accepted a clearly wrong password",
}

export function FingerprintTab({ run, scenario }: { run: RunSnapshot; scenario: ScenarioInfo | null }) {
  const probes = [P1, ...(scenario?.probes ?? [])]

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Honeypot-detection probes</CardTitle>
        <CardDescription>
          Each probe runs real commands on the target and judges the real output, so every system is held to the same
          checks. A red result means the attacker would have a reason to think the host is fake (a tell), or the shell
          behaved unlike a real one (fidelity). If the attacker left early, later probes show as not run.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[220px]">Probe</TableHead>
              {run.targets.map((t) => (
                <TableHead key={t.id}>{t.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {probes.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="align-top">
                  <span className="font-mono text-xs text-muted-foreground">{p.id}</span>{" "}
                  <span className="text-sm">{p.name}</span>
                  <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                    {p.kind}
                  </Badge>
                  <p className="mt-0.5 text-xs text-muted-foreground">{p.description}</p>
                </TableCell>
                {run.targets.map((t) => {
                  const reps = run.results[t.id]?.repetitions ?? []
                  const outcomes = reps
                    .map((r) => r.record.probes.find((o) => o.id === p.id))
                    .filter((o): o is NonNullable<typeof o> => o !== undefined)
                  const failed = outcomes.filter((o) => o.failed)
                  const shown = failed.length > 0 ? failed[failed.length - 1] : outcomes[outcomes.length - 1]

                  return (
                    <TableCell key={t.id} className="align-top">
                      {outcomes.length === 0 ? (
                        <span className="text-xs text-muted-foreground">not run</span>
                      ) : (
                        <>
                          <Badge variant={failed.length > 0 ? "destructive" : "secondary"} className="text-[10px]">
                            {failed.length > 0 ? (p.kind === "tell" ? "TELL" : "FAILED") : "ok"}
                            {outcomes.length > 1 ? ` ${failed.length}/${outcomes.length}` : ""}
                          </Badge>
                          {shown && <p className="mt-1 break-words text-xs text-muted-foreground">{shown.evidence}</p>}
                        </>
                      )}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
