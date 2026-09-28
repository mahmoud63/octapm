import type { Forecast } from '@/api/types'

/**
 * What the forecast-at-completion figure actually is.
 *
 * The server's EAC comes from earned value: budget divided by CPI. Until there
 * is cost performance to divide by — no approved cost loading, no actual cost
 * through the reporting cutoff — CPI does not exist and the engine hands back
 * the budget unchanged. That is the right answer to give; it is the wrong thing
 * to print under "Forecast at completion" with nothing else, because it reads
 * as a projection someone made. So the figure stays, and says what it is.
 */
export const eacQualifier = (forecast: Forecast | null | undefined): string | undefined => {
  if (!forecast?.cost || forecast.cost.eac == null) return undefined
  if (forecast.schedule?.cpi == null) return 'the budget — no cost performance yet'
  return undefined
}

/**
 * The server's own account of why its figures look the way they do — for
 * instance that SPI and CPI cannot exist until cost is loaded through the
 * cutoff, which is also why "actual" can read nought beside real spending.
 * Shown as written rather than paraphrased: it is the authority on its maths.
 */
export const forecastNotes = (forecast: Forecast | null | undefined): string[] => forecast?.dataQuality ?? []

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The earned-value cutoff SPI and CPI were measured through, stated the way
 * the web states it: the calendar date in the project's zone, the zone, and
 * the instant — "SPI and CPI through the end of 31 Aug 2026 (America/Chicago)
 * · 2026-09-01 04:59 UTC". The date is the server's own calendar date, never
 * re-read in the phone's zone. Null when the server gave no cutoff.
 */
export const evCutoffLine = (forecast: Forecast | null | undefined): string | null => {
  const cutoff = forecast?.earnedValueCutoff
  if (!cutoff?.cutoffDate) return null
  const local = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cutoff.cutoffLocalDate ?? '')
  const instant = new Date(cutoff.cutoffDate)
  const iso = Number.isNaN(instant.getTime()) ? null : instant.toISOString()
  const date = local
    ? `${Number(local[3])} ${MONTHS[Number(local[2]) - 1]} ${local[1]}`
    : iso
      ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
      : null
  if (!date) return null
  const zone = cutoff.timeZone || 'time zone not recorded'
  return `SPI and CPI through the end of ${date} (${zone})${iso ? ` · ${iso.slice(0, 16).replace('T', ' ')} UTC` : ''}`
}

/** The server's note when the project has no zone of its own; null otherwise. */
export const evCutoffZoneNote = (forecast: Forecast | null | undefined): string | null =>
  forecast?.earnedValueCutoff?.timeZoneNote?.trim() || null
