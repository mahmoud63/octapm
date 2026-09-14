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
    mockPrisma.costRecord.findFirst.mockResolvedValueOnce(null); // no row, as held
    mockPrisma.costRecord.create.mockClear();
    mockPrisma.costRecord.update.mockClear();
    await service.upsertCostRecord({ orgId: 'org-1', projectId: 'p1', activityId: 'act-1', payload: { budget: 500 } });
    const held = mockPrisma.$executeRaw.mock.calls.find(([strings, ...values]) => Array.isArray(strings) && strings.join('?').includes('pg_advisory_xact_lock') && values.includes('cost-record:p1:act-1'));
    expect(held).toBeDefined();
    const lockOrder = mockPrisma.$executeRaw.mock.invocationCallOrder[0];
    // the row is looked for under the lock only (since CX21-497 there is no read before it): a
    // posting that created it meanwhile is found and updated, not duplicated; absent, it is created
    expect(mockPrisma.costRecord.findFirst.mock.invocationCallOrder.at(-1)).toBeGreaterThan(lockOrder);
    expect(mockPrisma.costRecord.update).not.toHaveBeenCalled();
    expect(mockPrisma.costRecord.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.costRecord.create.mock.calls[0][0].data).toMatchObject({ projectId: 'p1', activityId: 'act-1', budget: 500, committed: 0 });
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

describe('the row a commitment created keeps its committed', () => {
  it('CX21-482: a budget-only upsert that found no row before the lock, and one under it, updates that row without touching committed', async () => {
    mockPrisma.$executeRaw = jest.fn(async () => 0);
    mockPrisma.costRecord.findFirst.mockResolvedValueOnce({ id: 'cr-9', projectId: 'p1', activityId: 'act-1', budget: 0, actual: 0, committed: 250000, forecast: 0, labour: 0, material: 0, equipment: 0, subcontract: 0, indirect: 0, overhead: 0, contingency: 0 }); // under it
    mockPrisma.costRecord.update.mockClear();
    mockPrisma.costRecord.create.mockClear();
    await service.upsertCostRecord({ orgId: 'org-1', projectId: 'p1', activityId: 'act-1', payload: { budget: 900 } });
    expect(mockPrisma.costRecord.create).not.toHaveBeenCalled();
    const written = mockPrisma.costRecord.update.mock.calls.at(-1)[0].data;
    expect(Object.prototype.hasOwnProperty.call(written, 'committed')).toBe(false);
    expect(Number(written.budget)).toBe(900);
  });
});

describe('Phase 21D — integrity (release challenge, ninth pass)', () => {
  const written = () => mockPrisma.costRecord.update.mock.calls.at(-1)[0].data;
  const has = (data, field) => Object.prototype.hasOwnProperty.call(data, field);

  it('CX21-497: an edit writes only the fields it was given, decided on the row as held under the pair lock', async () => {
    mockPrisma.$executeRaw = jest.fn(async () => 0);
    mockPrisma.costRecord.update.mockClear();
    await service.updateCostRecord({ orgId: 'org-1', projectId: 'p1', costRecordId: 'cr-1', payload: { material: 250 } });
    const data = written();
    expect(data).toEqual({ material: 250 });
    for (const field of ['labour', 'equipment', 'subcontract', 'indirect', 'overhead', 'contingency', 'budget', 'committed', 'actual', 'actualThroughDate', 'forecast']) expect(has(data, field)).toBe(false);
    const lock = mockPrisma.$executeRaw.mock.calls.find(([strings, ...values]) => Array.isArray(strings) && strings.join('?').includes('pg_advisory_xact_lock') && values.includes('cost-record:p1:act-1'));
    expect(lock).toBeDefined();
    expect(mockPrisma.costRecord.findFirst.mock.invocationCallOrder.at(-1)).toBeGreaterThan(mockPrisma.$executeRaw.mock.invocationCallOrder[0]);
    // the forecast follows a budget that is set, from the row's own actual
    mockPrisma.costRecord.update.mockClear();
    await service.updateCostRecord({ orgId: 'org-1', projectId: 'p1', costRecordId: 'cr-1', payload: { budget: 2000 } });
    expect(written()).toEqual({ budget: 2000, forecast: 240 }); // 2000 + (400 - 2000) × 1.1, to the cent
  });

  it('CX21-497: an upsert on an existing row that names one category leaves the budget and the rest alone', async () => {
    mockPrisma.$executeRaw = jest.fn(async () => 0);
    mockPrisma.costRecord.update.mockClear();
    mockPrisma.costRecord.create.mockClear();
    await service.upsertCostRecord({ orgId: 'org-1', projectId: 'p1', activityId: 'act-1', payload: { material: 5 } });
    expect(mockPrisma.costRecord.create).not.toHaveBeenCalled();
    expect(written()).toEqual({ material: 5 });
  });

  it("CX21-493: a committed that differs from the row's is refused where an executed commitment names the activity, and kept where none does", async () => {
    mockPrisma.$executeRaw = jest.fn(async () => 0);
    mockPrisma.commitmentSovLine = { findFirst: jest.fn(async () => ({ id: 'line-1' })), findMany: jest.fn(async () => []) };
    mockPrisma.costRecord.update.mockClear();
    await expect(service.updateCostRecord({ orgId: 'org-1', projectId: 'p1', costRecordId: 'cr-1', payload: { committed: 999 } })).rejects.toMatchObject({ status: 400, code: 'COST_COMMITTED_IS_DERIVED' });
    await expect(service.upsertCostRecord({ orgId: 'org-1', projectId: 'p1', activityId: 'act-1', payload: { committed: 999 } })).rejects.toMatchObject({ code: 'COST_COMMITTED_IS_DERIVED' });
    expect(mockPrisma.costRecord.update).not.toHaveBeenCalled();
    expect(mockPrisma.commitmentSovLine.findFirst.mock.calls[0][0].where).toMatchObject({ activityId: 'act-1', commitment: { projectId: 'p1' } });
    // an echo of the row's own figure passes, and an activity no commitment names keeps a typed figure
    await service.updateCostRecord({ orgId: 'org-1', projectId: 'p1', costRecordId: 'cr-1', payload: { committed: 0, material: 1 } });
    expect(written()).toEqual({ material: 1, committed: 0 });
    mockPrisma.commitmentSovLine.findFirst.mockResolvedValue(null);
    await service.updateCostRecord({ orgId: 'org-1', projectId: 'p1', costRecordId: 'cr-1', payload: { committed: 999 } });
    expect(written()).toEqual({ committed: 999 });
    delete mockPrisma.commitmentSovLine;
  });
});
