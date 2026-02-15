import type { DashboardData } from '@/lib/dashboard/types'
import { workbookXml, type Worksheet } from '@/lib/export/spreadsheet-xml'

function kvSheet(name: string, record: Record<string, unknown>): Worksheet {
  const rows: (string | number | boolean | null | undefined)[][] = [['Key', 'Value']]
  for (const [k, v] of Object.entries(record)) {
    rows.push([k, v == null ? '' : (v as any)])
  }
  return { name, rows }
}

function flattenToRows(value: unknown) {
  const rows: (string | number | boolean | null | undefined)[][] = [['Path', 'Value']]

  const seen = new Set<unknown>()

  const walk = (v: unknown, path: string) => {
    if (v === null || v === undefined) {
      rows.push([path, ''])
      return
    }

    const t = typeof v
    if (t === 'string' || t === 'number' || t === 'boolean') {
      rows.push([path, v as any])
      return
    }

    if (t !== 'object') {
      rows.push([path, String(v)])
      return
    }

    // Avoid cycles defensively.
    if (seen.has(v)) {
      rows.push([path, '[Circular]'])
      return
    }
    seen.add(v)

    if (Array.isArray(v)) {
      if (v.length === 0) rows.push([path, '[]'])
      v.forEach((item, i) => walk(item, `${path}[${i}]`))
      return
    }

    const obj = v as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    if (keys.length === 0) rows.push([path, '{}'])
    for (const k of keys) {
      walk(obj[k], path ? `${path}.${k}` : k)
    }
  }

  walk(value, '')
  return rows
}

export function dashboardToSpreadsheetXml(data: DashboardData, generatedAt: string | null) {
  const sheets: Worksheet[] = []

  const meta = {
    exportedAt: new Date().toISOString(),
    generatedAt: generatedAt ?? '',
  }

  // First sheet is an "everything" view so users immediately see all data,
  // even if their Excel is hiding worksheet tabs.
  sheets.push({
    name: 'All (Flattened)',
    rows: flattenToRows({ meta, ...data }),
  })

  sheets.push(kvSheet('Overview', data.overview as any))
  sheets.push(kvSheet('Attacker', data.attacker as any))

  sheets.push({
    name: 'Timeline',
    rows: [
      ['time', 'label', 'detail', 'severity'],
      ...data.timeline.map((e) => [e.time, e.label, e.detail ?? '', e.severity]),
    ],
  })

  sheets.push({
    name: 'Credential Usage',
    rows: [
      ['name', 'alerts', 'sessions'],
      ...data.credentialUsage.credentials.map((c) => [c.name, c.alerts, c.sessions]),
    ],
  })

  sheets.push({
    name: 'Credential Warnings',
    rows: [
      ['label', 'kind'],
      ...data.credentialUsage.warnings.map((w) => [w.label, w.kind]),
    ],
  })

  sheets.push({
    name: 'Deception Metrics',
    rows: [
      ['label', 'value', 'kind'],
      ...data.deceptionMetrics.items.map((m) => [m.label, m.value ?? '', m.kind]),
    ],
  })

  // MITRE matrix
  sheets.push({
    name: 'MITRE Matrix',
    rows: [
      ['', ...data.mitre.tactics],
      ...data.mitre.matrix.map((row, idx) => [`Row ${idx + 1}`, ...row]),
    ],
  })

  sheets.push({
    name: 'Lateral Nodes',
    rows: [
      ['id', 'label', 'x', 'y'],
      ...data.lateralMovement.nodes.map((n) => [n.id, n.label, n.x, n.y]),
    ],
  })

  sheets.push({
    name: 'Lateral Edges',
    rows: [
      ['from', 'to'],
      ...data.lateralMovement.edges.map((e) => [e.from, e.to]),
    ],
  })

  sheets.push({
    name: 'Command Activity',
    rows: [
      ['name', 'severity'],
      ...data.commandActivity.map((c) => [c.name, c.severity]),
    ],
  })

  sheets.push({
    name: 'Behavior Analysis',
    rows: [
      ['threatConfidencePct', data.behaviorAnalysis.threatConfidencePct],
      [],
      ['label', 'kind'],
      ...data.behaviorAnalysis.behaviors.map((b) => [b.label, b.kind]),
    ],
  })

  sheets.push({
    name: 'Incident Slices',
    rows: [
      ['name', 'value'],
      ...data.incidentSummary.slices.map((s) => [s.name, s.value]),
    ],
  })

  sheets.push({
    name: 'Incident Legend',
    rows: [
      ['label', 'kind', 'pct'],
      ...data.incidentSummary.legend.map((l) => [l.label, l.kind, l.pct ?? '']),
    ],
  })

  sheets.push({
    name: 'Activity Chart',
    rows: [
      ['name', 'value'],
      ...data.activityChart.map((b) => [b.name, b.value]),
    ],
  })

  sheets.push(kvSheet('Meta', meta))

  return workbookXml(sheets)
}
