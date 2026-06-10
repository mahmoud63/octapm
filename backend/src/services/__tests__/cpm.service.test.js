jest.mock('../../config/db', () => ({ prisma: {} }));

const {
  buildCriticalPathExplanation,
  dateToWorkingDay,
  runCpm,
  workingDayToDate,
} = require('../cpm.service');

const activity = (id, duration, extra = {}) => ({
  id,
  projectId: 'project-1',
  name: id,
  duration,
  wbsCode: id,
  p6ActivityId: null,
  predecessors: null,
  isMilestone: false,
  ...extra,
});

describe('CPM structured dependencies', () => {
  it('calculates FS, SS, FF, SF, lag, and lead from dependency rows', () => {
    const activities = [
      activity('S', 5),
      activity('A', 5),
      activity('B', 3),
      activity('C', 4),
      activity('D', 2),
      activity('E', 1),
    ];

    const dependencies = [
      { predecessorId: 'S', successorId: 'A', relationshipType: 'FS', lagDays: 0 },
      { predecessorId: 'A', successorId: 'B', relationshipType: 'SS', lagDays: 2 },
      { predecessorId: 'A', successorId: 'C', relationshipType: 'FF', lagDays: 1 },
      { predecessorId: 'A', successorId: 'D', relationshipType: 'SF', lagDays: 3 },
      { predecessorId: 'B', successorId: 'E', relationshipType: 'FS', lagDays: -1 },
    ];

    const result = runCpm(activities, { dependencies });

    expect(result.A.earlyStart).toBe(5);
    expect(result.B.earlyStart).toBe(7);
    expect(result.C.earlyStart).toBe(7);
    expect(result.D.earlyStart).toBe(6);
    expect(result.E.earlyStart).toBe(9);
  });

  it('rejects dependency cycles with a clear CPM error code', () => {
    const activities = [activity('A', 1), activity('B', 1)];
    const dependencies = [
      { predecessorId: 'A', successorId: 'B', relationshipType: 'FS', lagDays: 0 },
      { predecessorId: 'B', successorId: 'A', relationshipType: 'FS', lagDays: 0 },
    ];

    let error;
    try {
      runCpm(activities, { dependencies });
    } catch (err) {
      error = err;
    }

    expect(error).toMatchObject({ code: 'CPM_DEPENDENCY_CYCLE' });
  });

  it('returns critical path explanation with chain, float drivers, and calendars', () => {
    const activities = [
      activity('A', 4, { calendarId: 'standard-5d' }),
      activity('B', 3, { calendarId: 'standard-5d' }),
      activity('C', 2, { calendarId: 'night-shift' }),
    ];
    const dependencies = [
      { predecessorId: 'A', successorId: 'B', relationshipType: 'FS', lagDays: 0 },
      { predecessorId: 'A', successorId: 'C', relationshipType: 'SS', lagDays: 1 },
    ];

    const explanation = buildCriticalPathExplanation(activities, {
      dependencies,
    });

    expect(explanation.calendars).toEqual(['standard-5d', 'night-shift']);
    expect(explanation.chain.map((item) => item.activityId)).toEqual([
      'A',
      'B',
    ]);
    expect(explanation.floatDrivers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activityId: 'C',
          driver: expect.objectContaining({ relationshipType: null }),
        }),
      ]),
    );
  });

  it('uses the project working calendar when converting CPM offsets to dates', () => {
    const projectStart = new Date('2026-01-02T00:00:00.000Z'); // Friday

    expect(
      workingDayToDate(projectStart, 1, { calendarId: 'five_day' })
        .toISOString()
        .slice(0, 10),
    ).toBe('2026-01-05');
    expect(
      workingDayToDate(projectStart, 1, { calendarId: 'six_day' })
        .toISOString()
        .slice(0, 10),
    ).toBe('2026-01-03');
    expect(
      workingDayToDate(projectStart, 1, { calendarId: 'seven_day' })
        .toISOString()
        .slice(0, 10),
    ).toBe('2026-01-03');
  });

  it('converts dates back to working-day offsets using the same calendar', () => {
    const projectStart = new Date('2026-01-05T00:00:00.000Z'); // Monday

    expect(
      dateToWorkingDay(projectStart, '2026-01-09T00:00:00.000Z', {
        calendarId: 'five_day',
      }),
    ).toBe(4);
    expect(
      dateToWorkingDay(projectStart, '2026-01-10T00:00:00.000Z', {
        calendarId: 'five_day',
      }),
    ).toBe(5);
    expect(
      dateToWorkingDay(projectStart, '2026-01-04T00:00:00.000Z', {
        calendarId: 'five_day',
      }),
    ).toBe(-1);
  });

  it('returns calendar-aware planned dates in the CPM result', () => {
    const activities = [
      activity('A', 1, { calendarId: 'five_day' }),
      activity('B', 2, { calendarId: 'five_day' }),
    ];
    const dependencies = [
      { predecessorId: 'A', successorId: 'B', relationshipType: 'FS', lagDays: 0 },
    ];

    const result = runCpm(activities, {
      dependencies,
      projectStartDate: '2026-01-02T00:00:00.000Z',
      projectCalendar: 'five_day',
    });

    expect(result.A.earlyStartDate.toISOString().slice(0, 10)).toBe(
      '2026-01-02',
    );
    expect(result.A.earlyFinishDate.toISOString().slice(0, 10)).toBe(
      '2026-01-05',
    );
    expect(result.B.earlyStartDate.toISOString().slice(0, 10)).toBe(
      '2026-01-05',
    );
    expect(result.B.earlyFinishDate.toISOString().slice(0, 10)).toBe(
      '2026-01-07',
    );
  });
});
