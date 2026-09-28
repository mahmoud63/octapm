import type { Forecast } from '@/api/types'
import { eacQualifier, evCutoffLine, evCutoffZoneNote, forecastNotes } from '@/utilities/forecast'

const forecast = (cpi: number | null, eac: number | null, notes?: string[]) =>
  ({ available: true, schedule: { spi: null, cpi }, cost: { budget: 641_500, eac, actual: 0 }, dataQuality: notes }) as unknown as Forecast

describe('what the forecast-at-completion figure is', () => {
  it('says it is the budget when there is no cost performance to project from', () => {
    // EAC is budget ÷ CPI; with no CPI the engine hands the budget straight back.
    expect(eacQualifier(forecast(null, 641_500))).toBe('the budget — no cost performance yet')
  })

  it('says nothing extra once CPI exists and the figure is a real projection', () => {
    expect(eacQualifier(forecast(0.94, 682_447))).toBeUndefined()
  })

  it('has nothing to qualify when there is no figure at all', () => {
    expect(eacQualifier(forecast(null, null))).toBeUndefined()
    expect(eacQualifier(null)).toBeUndefined()
  })

  it('states the EV cutoff SPI and CPI were measured through, in the project zone, with the instant', () => {
    const withCutoff = {
      ...forecast(0.9, 100_000),
      earnedValueCutoff: { cutoffDate: '2026-09-01T04:59:59.999Z', cutoffLocalDate: '2026-08-31', timeZone: 'America/Chicago', timeZoneNote: null },
    } as unknown as Forecast
    // The calendar date is the server's (31 Aug in Chicago), not the instant's UTC date (1 Sep).
    expect(evCutoffLine(withCutoff)).toBe('SPI and CPI through the end of 31 Aug 2026 (America/Chicago) · 2026-09-01 04:59 UTC')
    expect(evCutoffZoneNote(withCutoff)).toBeNull()
    const utc = {
      ...forecast(null, 100_000),
      earnedValueCutoff: { cutoffDate: '2026-09-27T23:59:59.999Z', cutoffLocalDate: '2026-09-27', timeZone: 'UTC', timeZoneNote: 'Project timezone is not configured; UTC is being used' },
    } as unknown as Forecast
    expect(evCutoffLine(utc)).toBe('SPI and CPI through the end of 27 Sep 2026 (UTC) · 2026-09-27 23:59 UTC')
    expect(evCutoffZoneNote(utc)).toBe('Project timezone is not configured; UTC is being used')
    expect(evCutoffLine(forecast(null, null))).toBeNull()
  })

  it("passes on the server's own notes exactly as written", () => {
    const note = 'SPI / CPI are not available yet (no approved cost loading or actuals through the cutoff).'
    expect(forecastNotes(forecast(null, 641_500, [note]))).toEqual([note])
    expect(forecastNotes(forecast(null, 641_500))).toEqual([])
  })
})
