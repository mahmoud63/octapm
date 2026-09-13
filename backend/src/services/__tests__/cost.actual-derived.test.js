/**
 * Activity actual cost is posted by the ledger, never typed (Phase 21D, CX21-412).
 */
const mockPrisma = {
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn(async () => ({ id: 'p1', orgId: 'org-1' })) },
  activity: { findFirst: jest.fn(async () => ({ id: 'act-1', projectId: 'p1' })) },
  activityBoqAllocation: { findMany: jest.fn(async () => []) },
  budgetLineActivityAllocation: { findMany: jest.fn(async () => []) },
  boqItem: { findMany: jest.fn(async () => []) },
  costRecord: {
    findFirst: jest.fn(async () => ({ id: 'cr-1', projectId: 'p1', activityId: 'act-1', budget: 1000, actual: 400, committed: 0, forecast: 1000, labour: 0, material: 0, equipment: 0, subcontract: 0, indirect: 0, overhead: 0, contingency: 0, actualThroughDate: null })),
    update: jest.fn(async ({ data }) => ({ id: 'cr-1', ...data })),
    create: jest.fn(async ({ data }) => ({ id: 'cr-2', ...data })),
  },
};
jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../audit.service', () => ({ ACTIONS: {}, ENTITY_TYPES: {}, recordEvent: jest.fn() }));

const service = require('../cost.service');

describe('activity actual cost is derived', () => {
  it('refuses a changed actual on update, lets an unchanged one through', async () => {
    await expect(service.updateCostRecord({ orgId: 'org-1', projectId: 'p1', costRecordId: 'cr-1', payload: { actual: 0 } })).rejects.toMatchObject({ code: 'COST_ACTUAL_IS_DERIVED' });
    expect(mockPrisma.costRecord.update).not.toHaveBeenCalled();
    await expect(service.updateCostRecord({ orgId: 'org-1', projectId: 'p1', costRecordId: 'cr-1', payload: { actual: 400, budget: 1200 } })).resolves.toBeTruthy();
    // and the echo does not move the date the actual is good through (T-15)
    mockPrisma.costRecord.findFirst.mockResolvedValueOnce({ id: 'cr-1', projectId: 'p1', activityId: 'act-1', budget: 1000, actual: 400, committed: 0, forecast: 1000, labour: 0, material: 0, equipment: 0, subcontract: 0, indirect: 0, overhead: 0, contingency: 0, actualThroughDate: new Date('2027-02-02T00:00:00.000Z') });
    mockPrisma.costRecord.update.mockClear();
    await service.updateCostRecord({ orgId: 'org-1', projectId: 'p1', costRecordId: 'cr-1', payload: { actual: 400 } });
    // — since CX21-436 the date is not written at all unless the caller supplies one
    expect(Object.prototype.hasOwnProperty.call(mockPrisma.costRecord.update.mock.calls.at(-1)[0].data, 'actualThroughDate')).toBe(false);
  });
});

describe('a cost-record edit never writes actual', () => {
  it('CX21-422: a budget-only update leaves actual to the ledger', async () => {
    mockPrisma.costRecord.update.mockClear();
    await service.updateCostRecord({ orgId: 'org-1', projectId: 'p1', costRecordId: 'cr-1', payload: { budget: 1500 } });
    const written = mockPrisma.costRecord.update.mock.calls.at(-1)[0].data;
    expect(Object.prototype.hasOwnProperty.call(written, 'actual')).toBe(false);
    expect(written).toMatchObject({ budget: 1500 });
  });
});

describe("the through-date is the ledger's", () => {
  it('CX21-436: an edit writes no through-date it did not supply, and writes the one it did', async () => {
    mockPrisma.costRecord.update.mockClear();
    await service.updateCostRecord({ orgId: 'org-1', projectId: 'p1', costRecordId: 'cr-1', payload: { budget: 1300 } });
    expect(Object.prototype.hasOwnProperty.call(mockPrisma.costRecord.update.mock.calls.at(-1)[0].data, 'actualThroughDate')).toBe(false);
    await service.updateCostRecord({ orgId: 'org-1', projectId: 'p1', costRecordId: 'cr-1', payload: { actualThroughDate: '2027-03-03' } });
    expect(new Date(mockPrisma.costRecord.update.mock.calls.at(-1)[0].data.actualThroughDate).toISOString()).toBe('2027-03-03T00:00:00.000Z');
  });
});

describe('one projection row per activity, whoever creates it', () => {
  it('CX21-464: a cost-record upsert holds the (project, activity) pair before it looks for the row', async () => {
    mockPrisma.$executeRaw = jest.fn(async () => 0);
    mockPrisma.costRecord.findFirst.mockResolvedValueOnce(null);
    mockPrisma.costRecord.create.mockClear();
    await service.upsertCostRecord({ orgId: 'org-1', projectId: 'p1', activityId: 'act-1', payload: { budget: 500 } });
    const held = mockPrisma.$executeRaw.mock.calls.find(([strings, ...values]) => Array.isArray(strings) && strings.join('?').includes('pg_advisory_xact_lock') && values.includes('cost-record:p1:act-1'));
    expect(held).toBeDefined();
    const lockOrder = mockPrisma.$executeRaw.mock.invocationCallOrder[0];
    // looked for again under the lock: the row a posting created meanwhile is updated, not duplicated
    expect(mockPrisma.costRecord.findFirst.mock.invocationCallOrder.at(-1)).toBeGreaterThan(lockOrder);
    expect(mockPrisma.costRecord.create).not.toHaveBeenCalled();
    expect(mockPrisma.costRecord.update).toHaveBeenCalled();
  });
});

describe('committed is the commitments\' projection', () => {
  it('CX21-475: a budget-only edit writes no committed; the upsert of a new record leaves it to the commitments too', async () => {
    mockPrisma.costRecord.update.mockClear();
    await service.updateCostRecord({ orgId: 'org-1', projectId: 'p1', costRecordId: 'cr-1', payload: { budget: 1400 } });
    expect(Object.prototype.hasOwnProperty.call(mockPrisma.costRecord.update.mock.calls.at(-1)[0].data, 'committed')).toBe(false);
    mockPrisma.costRecord.update.mockClear();
    await service.upsertCostRecord({ orgId: 'org-1', projectId: 'p1', activityId: 'act-1', payload: { budget: 700 } });
    expect(Object.prototype.hasOwnProperty.call(mockPrisma.costRecord.update.mock.calls.at(-1)[0].data, 'committed')).toBe(false);
  });
});
