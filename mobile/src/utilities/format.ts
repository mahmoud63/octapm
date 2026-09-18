/**
 * Numbers, dates and money, as the person expects to read them.
 *
 * Units and currency come from the record; nothing here assumes metric,
 * imperial, pounds or dollars. Dates are shown in the device's locale and
 * time zone with the day always present, because "14:00" on a site diary is
 * not a time, it is a question.
 */
import { differenceInCalendarDays, format as formatDate, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns'

const locale = () => (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : 'en')

export function money(amount: number | string | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—'
  const n = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(n)) return '—'
  try {
    return new Intl.NumberFormat(locale(), { style: currency ? 'currency' : 'decimal', currency: currency || undefined, maximumFractionDigits: 2 }).format(n)
  } catch {
    return `${currency ? `${currency} ` : ''}${n.toFixed(2)}`
  }
}

export function quantity(value: number | string | null | undefined, unit: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '—'
  const text = new Intl.NumberFormat(locale(), { maximumFractionDigits: 3 }).format(n)
  return unit ? `${text} ${unit}` : text
}

export function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

const asDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null
  const d = typeof value === 'string' ? parseISO(value) : value
  return isValid(d) ? d : null
}

/** "17 Sep 2026" */
export function day(value: string | Date | null | undefined): string {
  const d = asDate(value)
  return d ? formatDate(d, 'd MMM yyyy') : '—'
}

/** "17 Sep 2026, 14:05" — always with the day. */
export function dateTime(value: string | Date | null | undefined): string {
  const d = asDate(value)
  return d ? formatDate(d, 'd MMM yyyy, HH:mm') : '—'
}

/** "3 days ago", "in 2 hours" — for age and freshness, never for deadlines. */
export function relative(value: string | Date | null | undefined): string {
  const d = asDate(value)
  return d ? formatDistanceToNowStrict(d, { addSuffix: true }) : '—'
}

/** How a due date should be read: overdue by N days, due today, or due in N. */
export function dueState(value: string | Date | null | undefined, now = new Date()): { label: string; tone: 'error' | 'warning' | 'muted' } {
  const d = asDate(value)
  if (!d) return { label: 'No due date', tone: 'muted' }
  const days = differenceInCalendarDays(d, now)
  if (days < 0) return { label: `${-days}d overdue`, tone: 'error' }
  if (days === 0) return { label: 'Due today', tone: 'warning' }
  if (days === 1) return { label: 'Due tomorrow', tone: 'warning' }
  return { label: `Due in ${days}d`, tone: 'muted' }
}

/** A person's initials for an avatar. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/** "in_progress" -> "In progress". Status words come from the server; this only makes them readable. */
export function humanise(value: string | null | undefined): string {
  if (!value) return ''
  const words = value.replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
