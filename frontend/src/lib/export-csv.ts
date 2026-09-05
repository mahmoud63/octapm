/** CSV download of whatever a register is currently showing (OCTA-RPT-BUILDER-023). */

export interface CsvColumn<T> {
  key: string
  label: string
  value?: (row: T) => unknown
}

export const toCsvValue = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const buildCsv = <T>(columns: CsvColumn<T>[], rows: T[]): string => {
  const header = columns.map((column) => toCsvValue(column.label)).join(',')
  const lines = rows.map((row) =>
    columns
      .map((column) =>
        toCsvValue(
          column.value
            ? column.value(row)
            : (row as unknown as Record<string, unknown>)[column.key]
        )
      )
      .join(',')
  )
  return [header, ...lines].join('\r\n')
}

export const downloadCsv = <T>(
  fileName: string,
  columns: CsvColumn<T>[],
  rows: T[]
) => {
  // BOM so Excel opens UTF-8 correctly.
  const BOM = String.fromCharCode(0xfeff)
  const csv = `${BOM}${buildCsv(columns, rows)}`
  const url = URL.createObjectURL(
    new Blob([csv], { type: 'text/csv;charset=utf-8' })
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export const csvFileName = (base: string) =>
  `${
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'export'
  }-${new Date().toISOString().slice(0, 10)}.csv`
