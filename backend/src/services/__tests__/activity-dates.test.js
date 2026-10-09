const { collectDateWarnings, assertDates } = require('../activity.service');

const project = {
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
};

describe('collectDateWarnings', () => {
  it('returns no warnings when activity dates sit inside the project', () => {
    const w = collectDateWarnings({
      project,
      startDate: new Date('2026-02-01'),
      endDate: new Date('2026-03-01'),
    });
    expect(w).toEqual([]);
  });

  it('warns when the activity starts before the project', () => {
    const w = collectDateWarnings({
      project,
      startDate: new Date('2025-12-01'),
      endDate: new Date('2026-03-01'),
    });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/before the project/i);
  });

  it('warns when the activity ends after the project', () => {
    const w = collectDateWarnings({
      project,
      startDate: new Date('2026-02-01'),
      endDate: new Date('2027-01-15'),
    });
    expect(w[0]).toMatch(/after the project/i);
  });
});

// HR-S2 (owner decision, CERT-3 WP-1): a zero-duration element (a milestone)
// is a point in time, and CPM stores it with start = end: valid. A finish
// before the start is refused, and so is a finish on the start of an activity
// that has a duration. Every "same instant" case below uses two distinct Date
// instances, so a reference comparison (===) of the dates cannot pass them.
describe('assertDates — HR-S2', () => {
  const INSTANT = '2026-04-28T00:00:00.000Z';
  const sameInstant = () => {
    const startDate = new Date(INSTANT);
    const endDate = new Date(INSTANT);
    // Guard the fixture itself: one instant, two objects.
    expect(startDate).not.toBe(endDate);
    expect(startDate.getTime()).toBe(endDate.getTime());
    return { startDate, endDate };
  };
  const refusal = (args) => {
    let error;
    try {
      assertDates(args);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeDefined();
    return error;
  };

  it('A1: start = end with duration 0 (a milestone) is valid', () => {
    expect(() => assertDates({ ...sameInstant(), duration: 0 })).not.toThrow();
  });

  it('A2: start = end with no duration given is judged as duration 0, valid', () => {
    expect(() => assertDates(sameInstant())).not.toThrow();
    // A null or undefined duration is no duration.
    expect(() => assertDates({ ...sameInstant(), duration: null })).not.toThrow();
    expect(() => assertDates({ ...sameInstant(), duration: undefined })).not.toThrow();
  });

  it('A3: start = end with duration 5 is refused 400 INVALID_DATES', () => {
    const error = refusal({ ...sameInstant(), duration: 5 });
    expect(error).toMatchObject({
      status: 400,
      code: 'INVALID_DATES',
      message: 'endDate must be after startDate',
    });
    // The same with the instant given as two ISO strings (a route's input).
    expect(refusal({ startDate: INSTANT, endDate: INSTANT, duration: 5 })).toMatchObject({ status: 400, code: 'INVALID_DATES' });
  });

  it('A4: an end before the start is refused for duration 0 and for duration 5', () => {
    for (const duration of [0, 5]) {
      const error = refusal({
        startDate: new Date('2026-04-28T00:00:00.000Z'),
        endDate: new Date('2026-04-27T00:00:00.000Z'),
        duration,
      });
      expect([duration, error.status, error.code]).toEqual([duration, 400, 'INVALID_DATES']);
    }
    // One millisecond before is before.
    expect(
      refusal({ startDate: new Date(INSTANT), endDate: new Date(Date.parse(INSTANT) - 1), duration: 0 }),
    ).toMatchObject({ status: 400, code: 'INVALID_DATES' });
  });

  it('A5: an end after the start with duration 5 is valid; a missing start or end is not judged', () => {
    expect(() =>
      assertDates({
        startDate: new Date('2026-04-28T00:00:00.000Z'),
        endDate: new Date('2026-05-04T00:00:00.000Z'),
        duration: 5,
      }),
    ).not.toThrow();
    for (const args of [
      { startDate: null, endDate: new Date(INSTANT), duration: 5 },
      { startDate: new Date(INSTANT), endDate: null, duration: 5 },
      { startDate: undefined, endDate: undefined, duration: 5 },
    ]) {
      expect(() => assertDates(args)).not.toThrow();
    }
  });
});
