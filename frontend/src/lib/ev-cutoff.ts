/**
 * The earned-value cutoff, stated one way everywhere (owner decision D1).
 *
 * The server selects PV, EV and AC against one instant: the end of the
 * cutoff's calendar date in the project's time zone (the project's own, else
 * the workspace's default, else UTC). Every EV surface — the EV tab, the
 * Overview's health card and controls strip, the Forecast tab — states that
 * cutoff with these two functions, so they never disagree about the day or
 * leave the reader to guess the zone.
 *
 * The calendar date is the server's `cutoffLocalDate` when it gives one; a
 * locked period stored before the zone was recorded has none, and its date
 * is then read in UTC and says the zone was not recorded.
 *
 * When the project has no zone of its own the server says so in
 * `timeZoneNote` ("Project timezone is not configured; UTC is being used",
 * or the organisation default it used); every surface shows that sentence
 * beside the cutoff with evCutoffNote — the text is the server's, so web and
 * mobile say the same thing.
 */
import { formatLongDate } from '@/lib/dates'

export type EvCutoff = {
  cutoffDate?: string | null
  cutoffLocalDate?: string | null
  /** IANA zone name, e.g. America/Chicago. */
  timeZone?: string | null
  timeZoneSource?: string | null
  /** The server's note when the project's own zone did not apply; else null. */
  timeZoneNote?: string | null
}

/** The server's note on the cutoff's zone, to show beside it; null when none. */
export function evCutoffNote(cutoff: EvCutoff | null | undefined): string | null {
  const note = cutoff?.timeZoneNote?.trim()
  return note ? note : null
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const instantUtc = (value: string | null | undefined) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`
}

/** The cutoff's calendar date, as the project's zone has it ("Nov 1, 2026"). */
export function formatEvCutoffDate(
  cutoff: EvCutoff | null | undefined
): string {
  if (!cutoff) return 'No cutoff'
  if (cutoff.cutoffLocalDate && DATE_ONLY.test(cutoff.cutoffLocalDate)) {
    // A bare YYYY-MM-DD is UTC midnight; formatLongDate reads it back in UTC.
    return formatLongDate(cutoff.cutoffLocalDate)
  }
  if (cutoff.cutoffDate && cutoff.timeZone) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: cutoff.timeZone,
      }).format(new Date(cutoff.cutoffDate))
    } catch {
      // An unknown zone name: fall through to the UTC reading.
    }
  }
  return cutoff.cutoffDate ? formatLongDate(cutoff.cutoffDate) : 'No cutoff'
}

/**
 * The whole statement: "end of Nov 1, 2026 (America/Chicago) · 2026-11-02
 * 05:59:59 UTC" — the calendar date, the zone it ends in, and the instant.
 */
export function formatEvCutoff(cutoff: EvCutoff | null | undefined): string {
  if (!cutoff?.cutoffDate) return 'No cutoff'
  const date = formatEvCutoffDate(cutoff)
  const instant = instantUtc(cutoff.cutoffDate)
  const zone = cutoff.timeZone ? cutoff.timeZone : 'time zone not recorded'
  return `end of ${date} (${zone})${instant ? ` · ${instant}` : ''}`
}
