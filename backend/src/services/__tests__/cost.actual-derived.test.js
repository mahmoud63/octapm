/**
 * Activity actual cost is posted by the ledger, never typed (Phase 21D, CX21-412).
 */
const mockPrisma = {
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn(async () => ({ id: 'p1', orgId: 'org-1' })) },
  activity: { findFirst: jest.fn(async () => ({ id: 'act-1', projectId: 'p1' })) },
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
    expect(mockPrisma.costRecord.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actualThroughDate: new Date('2027-02-02T00:00:00.000Z') }) }));
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
