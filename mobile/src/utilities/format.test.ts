import { day, dateTime, dueState, humanise, initials, money, quantity } from './format'

describe('formatting for the field', () => {
  it('shows money in the record\u2019s currency and never invents one', () => {
    expect(money(4200, 'GBP')).toMatch(/4,200/)
    expect(money('1234.5', 'USD')).toMatch(/1,234\.5/)
    expect(money(null, 'GBP')).toBe('\u2014')
    expect(money(10, null)).toMatch(/^10/)
  })

  it('shows quantities with the unit the record carries', () => {
    expect(quantity(1100, 'm\u00b3')).toBe('1,100 m\u00b3')
    expect(quantity(12.5, null)).toBe('12.5')
    expect(quantity(undefined, 'kg')).toBe('\u2014')
  })

  it('always prints the day with a time', () => {
    expect(day('2026-09-17T13:05:00Z')).toMatch(/17 Sep 2026/)
    expect(dateTime('2026-09-17T13:05:00Z')).toMatch(/17 Sep 2026, \d\d:\d\d/)
    expect(dateTime('not a date')).toBe('\u2014')
  })

  it('reads a due date the way a site does, in the device’s own calendar', () => {
    // Local noon on each day, so the answer is the same in every time zone.
    const local = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0)
    const now = local(2026, 9, 17)
    expect(dueState(local(2026, 9, 15), now)).toEqual({ label: '2d overdue', tone: 'error' })
    expect(dueState(local(2026, 9, 17), now)).toEqual({ label: 'Due today', tone: 'warning' })
    expect(dueState(local(2026, 9, 18), now)).toEqual({ label: 'Due tomorrow', tone: 'warning' })
    expect(dueState(local(2026, 9, 24), now)).toEqual({ label: 'Due in 7d', tone: 'muted' })
    expect(dueState(null, now)).toEqual({ label: 'No due date', tone: 'muted' })
  })

  it('makes status words readable without changing them', () => {
    expect(humanise('in_progress')).toBe('In progress')
    expect(humanise('ready_for_review')).toBe('Ready for review')
    expect(initials('Dana Okafor')).toBe('DO')
    expect(initials('')).toBe('?')
  })
})
