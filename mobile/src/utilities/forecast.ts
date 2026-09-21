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
