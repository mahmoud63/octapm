/**
 * CERT-2 (group trivial-7): the conversion between working-day offsets and
 * dates ends on any input, in constant time, with the walk's own answers.
 *
 * workingDayToDate and dateToWorkingDay walked one day at a time: 36,500
 * working days took about 20 ms, a million 0.5 s (a PATCH of a million-day
 * activity held its transaction past five seconds and answered 500), and past
 * about 71 million days the Date became invalid — never a working day — and
 * the walk never ended. They now work in whole weeks; a date outside years 1
 * to 9999 is no date (null).
 */
jest.mock('../../config/db', () => ({ prisma: {} }));

const { workingDayToDate, dateToWorkingDay, isWorkingDate } = require('../cpm.service');

// The walk as it was at f16c14f, as the reference (bounded: these tests keep to short offsets).
const startOfUtcDay = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};
const shift = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};
const walkNearest = (value, options, direction) => {
  let date = startOfUtcDay(value);
  if (!date) return null;
  while (!isWorkingDate(date, options)) date = shift(date, direction < 0 ? -1 : 1);
  return date;
};
const walkDate = (start, dayOffset, options) => {
  const offset = Math.round(Number(dayOffset));
  const direction = offset < 0 ? -1 : 1;
  let date = walkNearest(start, options, direction);
  let remaining = Math.abs(offset);
  while (remaining > 0) {
    date = shift(date, direction);
    if (isWorkingDate(date, options)) remaining -= 1;
  }
  return date;
};
const walkOffset = (start, value, options) => {
  const from = walkNearest(start, options, 1);
  const raw = startOfUtcDay(value);
  const target = walkNearest(raw, options, raw < from ? -1 : 1);
  if (target.getTime() === from.getTime()) return 0;
  const direction = target > from ? 1 : -1;
  let date = from;
  let offset = 0;
  while (date.getTime() !== target.getTime()) {
    date = shift(date, direction);
    if (isWorkingDate(date, options)) offset += direction;
  }
  return offset;
};

let seed = 20261004;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const CALENDARS = [
  { calendarId: 'five_day' },
  { calendarId: 'six_day' },
  { calendarId: 'seven_day' },
  { calendarId: 'custom', projectCalendar: 'six_day' },
  { calendarId: null, projectCalendar: null },
  { calendarId: 'mon-sat' },
];
const day = (date) => (date ? date.toISOString().slice(0, 10) : date);
const randomStart = () => new Date(Date.UTC(1995 + Math.floor(random() * 50), Math.floor(random() * 12), 1 + Math.floor(random() * 28), Math.floor(random() * 24)));

describe('working-day conversion (CERT-2 trivial-7)', () => {
  it('workingDayToDate gives the walk\'s date for 3,000 offsets within 2,500 working days either way, every calendar, every weekday', () => {
    const differences = [];
    for (let i = 0; i < 3000; i += 1) {
      const start = randomStart();
      const options = CALENDARS[i % CALENDARS.length];
      const offset = Math.round((random() * 2 - 1) * (i % 3 === 0 ? 2500 : 40));
      const expected = day(walkDate(start, offset, options));
      const actual = day(workingDayToDate(start, offset, options));
      if (expected !== actual) differences.push({ start: start.toISOString(), offset, options, expected, actual });
    }
    expect(differences).toEqual([]);
  });

  it('dateToWorkingDay gives the walk\'s offset for 3,000 dates within 3,500 days either way, and reads a converted date back as its offset', () => {
    const differences = [];
    for (let i = 0; i < 3000; i += 1) {
      const start = randomStart();
      const options = CALENDARS[i % CALENDARS.length];
      const target = new Date(start.getTime() + Math.round((random() * 2 - 1) * (i % 3 === 0 ? 3500 : 60)) * 86_400_000 + Math.floor(random() * 86_400_000));
      const expected = walkOffset(start, target, options);
      const actual = dateToWorkingDay(start, target, options);
      if (expected !== actual) differences.push({ start: start.toISOString(), target: target.toISOString(), options, expected, actual });
      const offset = Math.floor(random() * 3000);
      const back = dateToWorkingDay(start, workingDayToDate(start, offset, options), options);
      if (back !== offset) differences.push({ start: start.toISOString(), offset, options, back });
    }
    expect(differences).toEqual([]);
  });

  it('keeps the dates the walk gave for long offsets (36,500 and a million working days, five-day week from Monday 2026-01-05)', () => {
    const monday = new Date('2026-01-05T00:00:00.000Z');
    expect(day(workingDayToDate(monday, 36_500, { calendarId: 'five_day' }))).toBe('2165-12-02');
    expect(day(workingDayToDate(monday, 1_000_000, { calendarId: 'five_day' }))).toBe('5859-01-31');
    expect(dateToWorkingDay(monday, new Date('2165-12-02T00:00:00.000Z'), { calendarId: 'five_day' })).toBe(36_500);
  });

  it('ends at once on any offset: past year 9999, past what a Date holds, INT4 either way, not a number', () => {
    const monday = new Date('2026-01-05T00:00:00.000Z');
    const started = Date.now();
    for (const offset of [10_000_000, 71_000_000, 100_000_000, 2_147_483_647, -2_147_483_648, 1e300, -1e300]) {
      expect([offset, workingDayToDate(monday, offset, { calendarId: 'five_day' })]).toEqual([offset, null]);
    }
    for (const offset of [Infinity, NaN, 'x', '', null, undefined]) expect(workingDayToDate(monday, offset, {})).toBeNull();
    expect(workingDayToDate(null, 5, {})).toBeNull();
    expect(workingDayToDate('not a date', 5, {})).toBeNull();
    // The last day a Date holds is a Saturday: the walk to the next working day stepped off it, for ever.
    expect(new Date(8.64e15).getUTCDay()).toBe(6);
    expect(workingDayToDate(new Date(8.64e15), 1, { calendarId: 'five_day' })).toBeNull();
    expect(dateToWorkingDay(new Date(8.64e15), monday, { calendarId: 'five_day' })).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('counts the working days to the year 9999 and back at once', () => {
    const monday = new Date('2026-01-05T00:00:00.000Z');
    const started = Date.now();
    const far = dateToWorkingDay(monday, new Date('9999-12-31T00:00:00.000Z'), { calendarId: 'six_day' });
    expect(Date.now() - started).toBeLessThan(100);
    expect(far).toBeGreaterThan(2_400_000);
    const back = workingDayToDate(monday, far, { calendarId: 'six_day' });
    expect(day(back)).toBe('9999-12-31');
  });
});
