export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export type CsvCell = string | number | boolean | null | undefined

/** RFC 4180-style quoting: wrap in quotes when a field has a comma, quote or newline. */
export function toCsv(rows: CsvCell[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cell === null || cell === undefined ? "" : String(cell)
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(","),
    )
    .join("\n")
}

export function timestampForFilename(): string {
  return new Date().toISOString().slice(0, 19).replaceAll(":", "-")
}
