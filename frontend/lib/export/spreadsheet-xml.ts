function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

type CellValue = string | number | boolean | null | undefined
type CellType = 'String' | 'Number' | 'Boolean'

function inferType(value: CellValue): CellType {
  if (typeof value === 'number' && Number.isFinite(value)) return 'Number'
  if (typeof value === 'boolean') return 'Boolean'
  return 'String'
}

function toStringValue(value: CellValue) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return String(value)
}

export type Worksheet = {
  name: string
  rows: CellValue[][]
}

function sanitizeWorksheetName(name: string) {
  // Excel worksheet names: max 31 chars, no: : \ / ? * [ ]
  const cleaned = name.replaceAll(/[:\\/?*\[\]]/g, ' ').trim()
  return (cleaned.length ? cleaned : 'Sheet').slice(0, 31)
}

function renderCell(value: CellValue) {
  const type = inferType(value)
  const content = escapeXml(toStringValue(value))
  return `<Cell><Data ss:Type="${type}">${content}</Data></Cell>`
}

function renderRow(values: CellValue[]) {
  return `<Row>${values.map(renderCell).join('')}</Row>`
}

function renderWorksheet(sheet: Worksheet) {
  const name = sanitizeWorksheetName(sheet.name)
  const rows = sheet.rows.map(renderRow).join('')
  return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${rows}</Table></Worksheet>`
}

export function workbookXml(sheets: Worksheet[]) {
  // SpreadsheetML 2003 XML that Excel can open.
  return [
    '<?xml version="1.0"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook',
    ' xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
    ' xmlns:o="urn:schemas-microsoft-com:office:office"',
    ' xmlns:x="urn:schemas-microsoft-com:office:excel"',
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"',
    ' xmlns:html="http://www.w3.org/TR/REC-html40"',
    '>',
    sheets.map(renderWorksheet).join(''),
    '</Workbook>',
  ].join('')
}

