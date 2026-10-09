/**
 * HR-S2 (owner decision, CERT-3 WP-1) at the two callers of assertDates:
 * createActivity judges the duration it will store (payload.duration ?? 0),
 * and updateActivity judges the row the update leaves (the payload's dates and
 * duration where given, the stored ones otherwise). A zero-duration activity
 * with start = end (a milestone, as CPM stores it) is created and edited; an
 * activity with a duration may not finish on its start. Every refusal comes
 * before anything is written. The mock set-up follows
 * activity-engineers.service.test.js.
 *
 * Evidence tier: Prisma is mocked here, so these pin the callers' wiring
 * (which duration each passes); the live checks in the WP-1 fix plan carry
 * the proof.
 */
const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  activityAssignment: { deleteMany: jest.fn(), createMany: jest.fn() },
  organizationMembership: { findMany: jest.fn(), count: jest.fn() },
  user: { findMany: jest.fn() },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../activity-boq-allocation.service', () => ({ getApprovedActivityAllocationTotals: jest.fn() }));
jest.mock('../cpm.service', () => ({ applyCpmToProject: jest.fn(), workingDayToDate: jest.fn(() => null) }));
jest.mock('../activity-dependency.service', () => ({ replaceActivityDependencies: jest.fn(), serializeDependencyDto: jest.fn() }));
jest.mock('../progress.service', () => ({
  serializeMethodConfig: jest.fn(() => null),
  serializeSubmission: jest.fn(() => null),
  serializeProgressSource: jest.fn(() => null),
}));

const activityService = require('../activity.service');

const ENGINEER = '05e40000-1111-4111-8111-111111111111';
const INSTANT = '2026-04-28T00:00:00.000Z';

// M900 as CPM stores it: duration 0, start = end (two Date instances).
const storedMilestone = () => ({
  id: 'm900',
  projectId: 'project-1',
  name: 'M900',
  activityCode: 'M900',
  duration: 0,
  startDate: new Date(INSTANT),
  endDate: new Date(INSTANT),
  isMilestone: true,
  progress: [],
});

// A100: a five-day activity.
const storedTask = () => ({
  id: 'a100',
  projectId: 'project-1',
  name: 'A100',
  activityCode: 'A100',
  duration: 5,
  startDate: new Date('2026-04-20T00:00:00.000Z'),
  endDate: new Date('2026-04-24T00:00:00.000Z'),
  isMilestone: false,
  progress: [],
});

const create = (payload) =>
  activityService.createActivity({
    orgId: 'org-1',
    projectId: 'project-1',
    payload: { name: 'M900', engineerIds: [ENGINEER], ...payload },
  });
const update = (activityId, payload) =>
  activityService.updateActivity({ orgId: 'org-1', projectId: 'project-1', activityId, payload });
const refusalOf = (promise) => promise.then(
  () => {
    throw new Error('expected a refusal');
  },
  (error) => error,
);

const expectNothingWritten = () => {
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  expect(mockPrisma.activity.create).not.toHaveBeenCalled();
  expect(mockPrisma.activity.update).not.toHaveBeenCalled();
  expect(mockPrisma.activityAssignment.createMany).not.toHaveBeenCalled();
};

describe('assertDates at createActivity and updateActivity — HR-S2', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1', orgId: 'org-1', startDate: null, endDate: null });
    mockPrisma.organizationMembership.findMany.mockResolvedValue([{ userId: ENGINEER }]);
    mockPrisma.organizationMembership.count.mockResolvedValue(0);
    mockPrisma.activity.create.mockImplementation(async ({ data }) => ({ id: 'created-1', ...data }));
    mockPrisma.activity.update.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
  });

  describe('createActivity', () => {
    it('refuses start = end with duration 5, 400 INVALID_DATES, before anything is written', async () => {
      const error = await refusalOf(create({ startDate: INSTANT, endDate: INSTANT, duration: 5 }));
      expect(error).toMatchObject({ status: 400, code: 'INVALID_DATES' });
      expectNothingWritten();
      // Refused before the engineers are even looked up.
      expect(mockPrisma.organizationMembership.findMany).not.toHaveBeenCalled();
    });

    it('creates start = end with duration 0 (a milestone)', async () => {
      mockPrisma.activity.findFirst.mockImplementation(async () => ({ ...storedMilestone(), id: 'created-1' }));
      const created = await create({ startDate: INSTANT, endDate: INSTANT, duration: 0, isMilestone: true });
      expect(mockPrisma.activity.create).toHaveBeenCalledTimes(1);
      const { data } = mockPrisma.activity.create.mock.calls[0][0];
      expect(data.duration).toBe(0);
      expect(data.startDate).toEqual(new Date(INSTANT));
      expect(data.endDate).toEqual(new Date(INSTANT));
      expect(created).toMatchObject({ id: 'created-1', duration: 0 });
    });

    it('creates start = end with no duration given: it is stored as duration 0, and judged so', async () => {
      mockPrisma.activity.findFirst.mockImplementation(async () => ({ ...storedMilestone(), id: 'created-1' }));
      await create({ startDate: INSTANT, endDate: INSTANT });
      expect(mockPrisma.activity.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.activity.create.mock.calls[0][0].data.duration).toBe(0);
    });
  });

  describe('updateActivity', () => {
    it('renames a stored milestone (duration 0, start = end) with only {name}', async () => {
      const row = storedMilestone();
      mockPrisma.activity.findFirst.mockImplementation(async () => ({ ...row, name: 'M900 Completion' }));
      const updated = await update('m900', { name: 'M900 Completion' });
      expect(mockPrisma.activity.update).toHaveBeenCalledWith({ where: { id: 'm900' }, data: { name: 'M900 Completion' } });
      expect(updated).toMatchObject({ id: 'm900', name: 'M900 Completion', duration: 0 });
      expect(new Date(updated.startDate).getTime()).toBe(new Date(updated.endDate).getTime());
    });

    it('refuses {duration: 5} with no dates on that milestone, 400 INVALID_DATES: the next row would have a duration and finish on its start', async () => {
      mockPrisma.activity.findFirst.mockResolvedValue(storedMilestone());
      const error = await refusalOf(update('m900', { duration: 5 }));
      expect(error).toMatchObject({ status: 400, code: 'INVALID_DATES' });
      expectNothingWritten();
    });

    it('refuses {endDate: <its startDate>} on a stored five-day activity, 400 INVALID_DATES', async () => {
      const row = storedTask();
      mockPrisma.activity.findFirst.mockResolvedValue(row);
      const error = await refusalOf(update('a100', { endDate: row.startDate.toISOString() }));
      expect(error).toMatchObject({ status: 400, code: 'INVALID_DATES' });
      expectNothingWritten();
    });

    it('judges the duration the update gives over the stored one: {endDate: <its startDate>, duration: 0} on the five-day activity is a milestone, valid', async () => {
      const row = storedTask();
      mockPrisma.activity.findFirst.mockResolvedValue(row);
      await update('a100', { endDate: row.startDate.toISOString(), duration: 0 });
      expect(mockPrisma.activity.update).toHaveBeenCalledWith({
        where: { id: 'a100' },
        data: { endDate: new Date(row.startDate.getTime()), duration: 0 },
      });
    });

    it('still refuses an end before the start on the milestone, before anything is written', async () => {
      mockPrisma.activity.findFirst.mockResolvedValue(storedMilestone());
      const error = await refusalOf(update('m900', { endDate: '2026-04-27T00:00:00.000Z' }));
      expect(error).toMatchObject({ status: 400, code: 'INVALID_DATES' });
      expectNothingWritten();
    });
  });
});
