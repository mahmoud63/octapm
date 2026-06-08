const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  ipcCertificate: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  activityBoqAllocation: { findMany: jest.fn() },
  ipcItem: { findMany: jest.fn(), createMany: jest.fn(), update: jest.fn() },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));

const ipcService = require('../ipc.service');

describe('IPC allocation impact', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates IPC lines from approved activity BOQ allocations', async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    mockPrisma.ipcCertificate.findMany.mockResolvedValue([]);
    mockPrisma.ipcCertificate.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'ipc-1',
        projectId: 'project-1',
        period: 'IPC-1',
        status: 'draft',
        items: [],
      });
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([
      {
        id: 'allocation-1',
        projectId: 'project-1',
        boqItemId: 'boq-1',
        activityId: 'activity-1',
        quantity: 4,
        amount: 200,
        boqItem: { id: 'boq-1', rate: 60, sortOrder: 1 },
        activity: { id: 'activity-1', name: 'Excavate', sortOrder: 1 },
      },
    ]);
    mockPrisma.ipcItem.findMany.mockResolvedValue([]);
    mockPrisma.ipcCertificate.create.mockResolvedValue({
      id: 'ipc-1',
      period: 'IPC-1',
    });

    await ipcService.createIpcPeriod({
      orgId: 'org-1',
      projectId: 'project-1',
    });

    expect(mockPrisma.activityBoqAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: 'project-1',
          status: 'approved',
          isActive: true,
        },
      }),
    );
    expect(mockPrisma.ipcItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          boqItemId: 'boq-1',
          allocationId: 'allocation-1',
          qty: 0,
          rate: 50,
          previousCert: 0,
          cumulativeCert: 0,
        }),
      ],
    });
  });
});
