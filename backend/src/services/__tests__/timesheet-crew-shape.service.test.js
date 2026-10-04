/**
 * CERT-2 (group people-evidence-3): a timesheet's crew is named by one id.
 * crewId ["<id>"] or [["<id>"]] reached prisma.crew.findFirst as a list — a
 * 500. Any value that is not one text now names no crew: the 404 of a crew
 * that does not exist, whoever's id it wraps, before any lookup or write. (The
 * route refuses it first as invalid input; this is the service's own guard.)
 */
const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  crew: { findFirst: jest.fn() },
  timesheet: { findFirst: jest.fn(), create: jest.fn() },
  timeEntry: { createMany: jest.fn() },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../audit.service', () => ({ recordEvent: jest.fn(async () => null), ACTIONS: { CREATED: 'created' } }));
jest.mock('../cost-ledger.service', () => ({}));
jest.mock('../notification.service', () => ({}));

const service = require('../timesheet.service');

const CREW = '0c0e0000-1111-4111-8111-111111111111';
const pm = { id: 'pm-1', role: 'pm', projectAccess: null };

describe('timesheet crewId shape (CERT-2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1', name: 'Project' });
    mockPrisma.timesheet.findFirst.mockResolvedValue(null);
  });

  it.each([
    ['a list', [CREW]],
    ['a list inside a list', [[CREW]]],
    ['an object', { id: CREW }],
    ['a number', 12345],
  ])('answers crewId as %s as a crew that does not exist, before any lookup or write', async (_label, crewId) => {
    await expect(
      service.createTimesheet({ orgId: 'org-1', projectId: 'project-1', payload: { date: '2026-09-07', crewId }, actor: pm, viewer: pm }),
    ).rejects.toMatchObject({ status: 404, code: 'CREW_NOT_FOUND', message: 'Crew not found' });
    expect(mockPrisma.crew.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.timesheet.create).not.toHaveBeenCalled();
  });

  it('looks a crew named by one id up in this organisation and project, as before', async () => {
    mockPrisma.crew.findFirst.mockResolvedValue(null);
    await expect(
      service.createTimesheet({ orgId: 'org-1', projectId: 'project-1', payload: { date: '2026-09-07', crewId: CREW }, actor: pm, viewer: pm }),
    ).rejects.toMatchObject({ status: 404, code: 'CREW_NOT_FOUND' });
    expect(mockPrisma.crew.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: CREW, orgId: 'org-1', projectId: 'project-1' } }));
  });
});
