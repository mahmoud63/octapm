import { screen } from '@testing-library/react-native'
import { TimelineStrip, timelineScale } from '@/components/TimelineStrip'
import { activities } from '@/testing/fixtures-site'
import { renderScreen } from '@/testing/render'

describe('the timeline', () => {
  it('places every activity inside a window that also holds today', () => {
    const today = new Date('2026-09-18T00:00:00.000Z')
    const scale = timelineScale(activities, today)!
    expect(new Date(scale.start).toISOString().slice(0, 10)).toBe('2026-01-05')
    expect(new Date(scale.end).toISOString().slice(0, 10)).toBe('2030-06-01')
    expect(scale.at('2026-01-05T00:00:00.000Z')).toBe(0)
    expect(scale.at('2030-06-01T00:00:00.000Z')).toBe(1)
    expect(scale.todayAt).toBeGreaterThan(0)
    expect(scale.todayAt).toBeLessThan(1)
    expect(scale.at(null)).toBeNull()
    expect(timelineScale([{ startDate: null, endDate: null }])).toBeNull()
  })

  it('draws a row per activity with the critical ones marked', async () => {
    await renderScreen(<TimelineStrip activities={activities} />)
    expect(screen.getByTestId('timeline-row-a1')).toBeTruthy()
    expect(screen.getByText('● Foundation concrete')).toBeTruthy()
    expect(screen.getByText('Site clearance')).toBeTruthy()
    expect(screen.getAllByTestId(/timeline-row-/)).toHaveLength(4)
  })
})
