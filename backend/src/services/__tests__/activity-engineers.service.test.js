/**
 * CERT-2 (group people-evidence-3): an activity's engineers are people of this
 * organisation by membership, with the standing they hold here.
 *
 * They were looked up by User.orgId (the person's home workspace), so a member
 * of this company whose home is another company was refused as an engineer
 * here. A person is now an engineer here when they hold an active membership
 * here and their account is active; another company's person, a person who
 * exists nowhere, a member this company has deactivated and a value that is
 * not an identifier all get the same 400 INVALID_ENGINEERS, before anything
 * is written.
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

const MEMBER = '05e40000-1111-4111-8111-111111111111';
const BOTH = '05e40000-3333-4333-8333-333333333333'; // home workspace another company, a member here
const FOREIGN = '05e40000-2222-4222-8222-222222222222'; // another company's only
const DEACTIVATED = '05e40000-6666-4666-8666-666666666666'; // a member here this company deactivated
const NOWHERE = '05e40000-4444-4444-8444-444444444444';

// Memberships of org-1: [userId, membership status, account status].
const MEMBERSHIPS = [
  [MEMBER, 'active', 'active'],
  [BOTH, 'active', 'active'],
  [DEACTIVATED, 'suspended', 'active'],
];

const membershipRows = ({ where }) =>
  MEMBERSHIPS.filter(([userId, status, account]) => {
    if (where.orgId !== 'org-1' || !where.userId.in.includes(userId)) return false;
    if (where.status?.not && status === where.status.not) return false;
    if (where.OR) return status !== 'active' || account !== 'active';
    return true;
  }).map(([userId]) => ({ userId }));

const createActivity = (engineerIds) =>
  activityService.createActivity({ orgId: 'org-1', projectId: 'project-1', payload: { name: 'Pour slab', duration: 2, engineerIds } });
const updateActivity = (engineerIds) =>
  activityService.updateActivity({ orgId: 'org-1', projectId: 'project-1', activityId: 'activity-1', payload: { engineerIds } });

describe('activity engineers by membership (CERT-2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1', orgId: 'org-1', startDate: null, endDate: null });
    mockPrisma.activity.findFirst.mockResolvedValue({ id: 'activity-1', projectId: 'project-1', name: 'Pour slab' });
    mockPrisma.activity.create.mockResolvedValue({ id: 'activity-1', projectId: 'project-1', name: 'Pour slab' });
    mockPrisma.activity.update.mockResolvedValue({ id: 'activity-1' });
    mockPrisma.organizationMembership.findMany.mockImplementation(async (args) => membershipRows(args));
    mockPrisma.organizationMembership.count.mockImplementation(async (args) => membershipRows(args).length);
  });

  it('assigns a member whose home workspace is another company, by the membership held here', async () => {
    await createActivity([MEMBER, BOTH]);
    expect(mockPrisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ assignments: { create: [{ userId: MEMBER }, { userId: BOTH }] } }),
    });
    await updateActivity([BOTH]);
    expect(mockPrisma.activityAssignment.createMany).toHaveBeenCalledWith({ data: [{ activityId: 'activity-1', userId: BOTH }] });
    // The home workspace (User.orgId) is never what decides.
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.organizationMembership.findMany).toHaveBeenCalledWith({
      // Active or suspended here: an invitation not yet accepted is not membership (L38).
      where: { orgId: 'org-1', userId: { in: [BOTH] }, status: { in: ['active', 'suspended'] } },
      select: { userId: true },
    });
    expect(mockPrisma.organizationMembership.count).toHaveBeenCalledWith({
      where: { orgId: 'org-1', userId: { in: [BOTH] }, OR: [{ status: { not: 'active' } }, { user: { status: { not: 'active' } } }] },
    });
  });

  it.each([
    ['another company\'s person', [FOREIGN]],
    ['a person who exists nowhere', [NOWHERE]],
    ['a member this company has deactivated', [DEACTIVATED]],
    ['another company\'s person beside a member', [MEMBER, FOREIGN]],
    ['a member named twice', [MEMBER, MEMBER]],
    ['a list in place of an id', [[MEMBER]]],
    ['an object in place of an id', [{ id: MEMBER }]],
  ])('refuses %s with the one 400 INVALID_ENGINEERS, on create and on update, writing nothing', async (_label, engineerIds) => {
    for (const call of [createActivity, updateActivity]) {
      const error = await call(engineerIds).catch((thrown) => thrown);
      expect(error).toMatchObject({ status: 400, code: 'INVALID_ENGINEERS', message: 'One or more engineer IDs are invalid' });
      expect(error.details).toBeUndefined();
    }
    expect(mockPrisma.activity.create).not.toHaveBeenCalled();
    expect(mockPrisma.activity.update).not.toHaveBeenCalled();
    expect(mockPrisma.activityAssignment.createMany).not.toHaveBeenCalled();
  });
});
