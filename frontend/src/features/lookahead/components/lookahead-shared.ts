import type {
  LookaheadItemStatus,
  LookaheadStatus,
} from '../hooks/use-lookaheads'

export const LOOKAHEAD_STATUS_CLASS: Record<LookaheadStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  published:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  archived: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
}

export const ITEM_STATUS_CLASS: Record<LookaheadItemStatus, string> = {
  planned: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  in_progress:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  done: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  not_done: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
}

export const ITEM_BAR_CLASS: Record<LookaheadItemStatus, string> = {
  planned: 'bg-sky-400/70',
  in_progress: 'bg-amber-400/80',
  done: 'bg-emerald-500/70',
  not_done: 'bg-rose-400/80',
}

export const WEEK_START_OPTIONS = [
  { value: 1, label: 'Monday' },
  { value: 0, label: 'Sunday' },
  { value: 6, label: 'Saturday' },
] as const

/** `2026-09-14` → `14 Sep` (UTC, the API's date-only strings). */
export const fmtDate = (value: string | null | undefined) =>
  value
    ? new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      })
    : '—'

export const todayKey = () => new Date().toISOString().slice(0, 10)

/** The next occurrence of the week-start day (today when today is that day). */
export const nextWeekStart = (weekStartDay: number) => {
  const today = new Date()
  const date = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  )
  const shift = (weekStartDay - date.getUTCDay() + 7) % 7
  date.setUTCDate(date.getUTCDate() + shift)
  return date.toISOString().slice(0, 10)
}

export const addDaysKey = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `${Math.round(value)}%`
