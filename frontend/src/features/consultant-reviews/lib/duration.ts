/** A duration as people read it: "6d 4h", "5h 12m", "12m", "<1m". Computed from stored timestamps, never stored. */
export const formatDuration = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—'
  const total = Math.max(0, ms)
  const days = Math.floor(total / 86_400_000)
  const hours = Math.floor((total % 86_400_000) / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m`
  return '<1m'
}

/** The same duration in words for headlines: "6 days 4 hours". */
export const formatDurationLong = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return '—'
  const total = Math.max(0, ms)
  const days = Math.floor(total / 86_400_000)
  const hours = Math.floor((total % 86_400_000) / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const part = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'}`
  if (days) return `${part(days, 'day')} ${part(hours, 'hour')}`
  if (hours) return `${part(hours, 'hour')} ${part(minutes, 'minute')}`
  return minutes ? part(minutes, 'minute') : 'less than a minute'
}

export const formatStamp = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

export const formatDay = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

/** A live clock: the client's elapsed time since the server's reading, so durations keep running between refreshes. */
export const tick = (ms: number, serverNow: string | undefined, running: boolean) => (running && serverNow ? ms + Math.max(0, Date.now() - new Date(serverNow).getTime()) : ms)
