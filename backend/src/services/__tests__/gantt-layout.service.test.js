const mockPrisma = {
  ganttLayout: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  user: { findMany: jest.fn() },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));

const service = require('../gantt-layout.service');

const ORG = 'org-1';
const PROJECT = 'project-1';
const PLANNER = { id: 'user-planner', role: 'planning_eng', name: 'Ravi Menon' };
const QS = { id: 'user-qs', role: 'qs', name: 'Sofia Lindqvist' };
const PM = { id: 'user-pm', role: 'pm', name: 'Dana Okafor' };

const row = (over = {}) => ({
  id: 'layout-1',
  orgId: ORG,
  projectId: PROJECT,
  name: 'Site review',
  visibility: 'private',
  layoutJson: { timeScale: 'week' },
  createdBy: PLANNER.id,
  updatedBy: PLANNER.id,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  ...over,
});

describe('gantt layout service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.findMany.mockResolvedValue([]);
  });

  it('shows a planner their own layouts plus anything shared with the project', async () => {
    mockPrisma.ganttLayout.findMany.mockResolvedValue([]);

    await service.listLayouts({ orgId: ORG, projectId: PROJECT, user: QS });

    const { where } = mockPrisma.ganttLayout.findMany.mock.calls[0][0];
    expect(where).toMatchObject({ orgId: ORG, projectId: PROJECT });
    expect(where.OR).toEqual([
      { createdBy: QS.id },
      { visibility: 'project' },
    ]);
  });

  it('keeps a layout out of another org and another project', async () => {
    mockPrisma.ganttLayout.findMany.mockResolvedValue([]);
    await service.listLayouts({ orgId: ORG, projectId: PROJECT, user: QS });

    const { where } = mockPrisma.ganttLayout.findMany.mock.calls[0][0];
    // Scoping is on the query, not applied afterwards in memory.
    expect(where.orgId).toBe(ORG);
    expect(where.projectId).toBe(PROJECT);
  });

  it('takes only the fields a layout may carry, at sane values', () => {
    const layout = service.normalizeLayout({
      timeScale: 'fortnight',
      pxPerDay: 9000,
      gridWidth: 640,
      showBaseline: 'yes',
      showHistogram: false,
      histogramGroup: 'colour',
      collapsed: ['summary:a', 42, 'summary:b'],
      // Anything else a client sends is dropped rather than stored and then
      // handed to every other member of the project.
      onLoad: 'alert(1)',
    });

    expect(layout).toEqual({
      timeScale: 'week',
      pxPerDay: 24,
      gridWidth: 640,
      showBaseline: true,
      showHistogram: false,
      histogramGroup: 'type',
      collapsed: ['summary:a', 'summary:b'],
    });
    expect(layout).not.toHaveProperty('onLoad');
  });

  it('refuses a layout that is not an object, and one that is enormous', () => {
    expect(() => service.normalizeLayout(null)).toThrow(
      expect.objectContaining({ status: 400, code: 'LAYOUT_INVALID' }),
    );
    expect(() =>
      service.normalizeLayout({
        collapsed: Array.from({ length: 500 }, () => 'x'.repeat(200)),
      }),
    ).toThrow(expect.objectContaining({ status: 400, code: 'LAYOUT_TOO_LARGE' }));
  });

  it('saving the same name again updates rather than duplicating', async () => {
    mockPrisma.ganttLayout.findFirst.mockResolvedValue(row());
    mockPrisma.ganttLayout.update.mockResolvedValue(
      row({ visibility: 'project' }),
    );

    const saved = await service.saveLayoutFor({
      orgId: ORG,
      projectId: PROJECT,
      user: PLANNER,
      payload: { name: 'Site review', visibility: 'project', layout: {} },
    });

    expect(mockPrisma.ganttLayout.create).not.toHaveBeenCalled();
    expect(mockPrisma.ganttLayout.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'layout-1' } }),
    );
    expect(saved.visibility).toBe('project');
    expect(saved.isOwner).toBe(true);
  });

  it('rejects a visibility the product does not have', async () => {
    await expect(
      service.saveLayoutFor({
        orgId: ORG,
        projectId: PROJECT,
        user: PLANNER,
        payload: { name: 'Everything', visibility: 'org', layout: {} },
      }),
    ).rejects.toThrow(
      expect.objectContaining({ status: 400, code: 'LAYOUT_VISIBILITY' }),
    );
  });

  it('will not let one person edit or delete another person’s shared layout', async () => {
    mockPrisma.ganttLayout.findFirst.mockResolvedValue(
      row({ visibility: 'project' }),
    );

    await expect(
      service.updateLayout({
        orgId: ORG,
        projectId: PROJECT,
        user: QS,
        layoutId: 'layout-1',
        payload: { name: 'Mine now' },
      }),
    ).rejects.toThrow(
      expect.objectContaining({ status: 403, code: 'LAYOUT_FORBIDDEN' }),
    );

    await expect(
      service.deleteLayout({
        orgId: ORG,
        projectId: PROJECT,
        user: QS,
        layoutId: 'layout-1',
      }),
    ).rejects.toThrow(
      expect.objectContaining({ status: 403, code: 'LAYOUT_FORBIDDEN' }),
    );
    expect(mockPrisma.ganttLayout.delete).not.toHaveBeenCalled();
  });

  it('lets the PM tidy up a shared layout its author left behind', async () => {
    mockPrisma.ganttLayout.findFirst.mockResolvedValue(
      row({ visibility: 'project' }),
    );
    mockPrisma.ganttLayout.delete.mockResolvedValue(row());

    await expect(
      service.deleteLayout({
        orgId: ORG,
        projectId: PROJECT,
        user: PM,
        layoutId: 'layout-1',
      }),
    ).resolves.toEqual({ id: 'layout-1' });
  });

  it('answers 404 for a layout the caller cannot see', async () => {
    mockPrisma.ganttLayout.findFirst.mockResolvedValue(null);

    await expect(
      service.updateLayout({
        orgId: ORG,
        projectId: PROJECT,
        user: QS,
        layoutId: 'layout-1',
        payload: {},
      }),
    ).rejects.toThrow(
      expect.objectContaining({ status: 404, code: 'LAYOUT_NOT_FOUND' }),
    );
  });
});
