const numberFormat = new Intl.NumberFormat()
export const fmtNumber = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : numberFormat.format(value)

export const fmtPercent = (value: number | null | undefined) =>
  value === null || value === undefined
    ? '—'
    : `${Math.round(value * 1000) / 10}%`

export const fmtBytes = (bytes: number | null | undefined) => {
  if (bytes === null || bytes === undefined) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

export const fmtDate = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '—'

/** A day bucket from the API (UTC midnight): that calendar day, not shifted to local time. */
export const fmtDay = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : '—'

export const fmtDateTime = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

/** "3 days ago" style, for last-activity columns. */
export const fmtRelative = (value: string | null | undefined) => {
  if (!value) return 'None'
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.round(diff / 60000)
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

export const humanize = (value: string | null | undefined) =>
  value
    ? value.replace(/[_.]/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
    : '—'
