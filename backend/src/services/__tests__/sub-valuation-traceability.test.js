const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  company: { findFirst: jest.fn(), findMany: jest.fn(async () => []) },
  subValuation: {
    count: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(async () => []),
    update: jest.fn(),
    delete: jest.fn(),
  },
  activity: { findMany: jest.fn() },
  activityBoqAllocation: { findMany: jest.fn() },
  boqItem: { findMany: jest.fn() },
  subValuationActivityLink: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  subValuationAllocationLink: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
};

const mockAuditService = {
  ACTIONS: {
    CREATED: 'created',
    DELETED: 'deleted',
    STATUS_CHANGED: 'status_changed',
    UPDATED: 'updated',
  },
  ENTITY_TYPES: { SUB_VALUATION: 'sub_valuation' },
  recordEvent: jest.fn(),
  serializeEvent: jest.fn((event) => event),
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../audit.service', () => mockAuditService);

const subValuationService = require('../sub-valuation.service');

const stored = (overrides = {}) => ({
  id: 'sv-1',
  projectId: 'project-1',
  ref: 'SV-01',
  subcontractor: 'Concrete Sub',
  companyId: null,
  period: '2026-06',
  workDone: 1000,
  materialsOnSite: 200,
  grossPayable: 1200,
  retentionRate: 5,
  retention: 60,
  backCharges: 0,
  netPayable: 1140,
  status: 'draft',
  activityLinks: [],
  allocationLinks: [],
  ...overrides,
});

describe('sub valuation traceability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({
      id: 'project-1',
      orgId: 'org-1',
      defaultRetentionRate: 5,
    });
    mockPrisma.subValuation.findFirst.mockResolvedValue(stored());
    mockPrisma.subValuation.update.mockResolvedValue(stored());
    mockPrisma.subValuation.findMany.mockResolvedValue([]);
    mockPrisma.company.findMany.mockResolvedValue([]);
  });

  it('links sub valuations to activities and approved BOQ allocations', async () => {
    mockPrisma.activity.findMany.mockResolvedValue([{ id: 'activity-1' }]);
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([
      { id: 'alloc-1', boqItemId: 'boq-1' },
    ]);
    mockPrisma.boqItem.findMany.mockResolvedValue([]);

    await subValuationService.updateSubValuation({
      orgId: 'org-1',
      projectId: 'project-1',
      valuationId: 'sv-1',
      userId: 'qs-1',
      payload: {
        workDone: 1000,
        materialsOnSite: 200,
        activityLinks: [{ activityId: 'activity-1', amount: 1200 }],
        allocationLinks: [
          {
            allocationId: 'alloc-1',
            quantity: 4,
            workDoneAmount: 1000,
            materialsOnSiteAmount: 200,
          },
        ],
      },
    });

    expect(mockPrisma.subValuationActivityLink.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            subValuationId: 'sv-1',
            activityId: 'activity-1',
            amount: 1200,
          }),
        ],
      }),
    );
    expect(mockPrisma.subValuationAllocationLink.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            subValuationId: 'sv-1',
            allocationId: 'alloc-1',
            boqItemId: 'boq-1',
            workDoneAmount: 1000,
            materialsOnSiteAmount: 200,
          }),
        ],
      }),
    );
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'sub_valuation', entityId: 'sv-1' }),
    );
  });

  /**
   * Retained read-only (OCTA-FIN-SUBVAL-064): the rows stay and stay finishable,
   * but a free-text party is the record nothing downstream can follow, so no new
   * ones are made and the name on an old one is never rewritten.
   */
  describe('retired in favour of payment applications', () => {
    it('refuses to create, and says what to use instead', async () => {
      await expect(
        subValuationService.createSubValuation({
          orgId: 'org-1',
          projectId: 'project-1',
          payload: { subcontractor: 'Concrete Sub', period: '2026-07' },
        }),
      ).rejects.toMatchObject({
        code: 'SUB_VALUATION_RETIRED',
        details: expect.objectContaining({ replacedBy: 'sub_pay_app' }),
      });
      expect(mockPrisma.subValuation.create).not.toHaveBeenCalled();
    });

    it('lets an in-flight valuation be finished', async () => {
      mockPrisma.subValuation.update.mockResolvedValue(stored({ status: 'certified' }));
      const updated = await subValuationService.updateSubValuation({
        orgId: 'org-1',
        projectId: 'project-1',
        valuationId: 'sv-1',
        payload: { status: 'certified', certDate: '2026-07-31' },
      });
      expect(updated.status).toBe('certified');
    });

    it('will not rewrite the name it was raised against', async () => {
      await expect(
        subValuationService.updateSubValuation({
          orgId: 'org-1',
          projectId: 'project-1',
          valuationId: 'sv-1',
          payload: { subcontractor: 'Concrete Subcontractors LLC' },
        }),
      ).rejects.toMatchObject({
        code: 'SUB_VALUATION_NAME_IMMUTABLE',
        details: expect.objectContaining({ attributeWith: 'companyId' }),
      });
      // Sending the same name back unchanged is not a rename.
      await expect(
        subValuationService.updateSubValuation({
          orgId: 'org-1',
          projectId: 'project-1',
          valuationId: 'sv-1',
          payload: { subcontractor: 'Concrete Sub', period: '2026-06' },
        }),
      ).resolves.toBeTruthy();
    });

    it('attributes a row to a company that exists, and refuses one that does not', async () => {
      mockPrisma.company.findFirst.mockResolvedValueOnce({ id: 'co-1' });
      await subValuationService.updateSubValuation({
        orgId: 'org-1',
        projectId: 'project-1',
        valuationId: 'sv-1',
        payload: { companyId: 'co-1' },
      });
      expect(mockPrisma.subValuation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ companyId: 'co-1' }) }),
      );

      mockPrisma.company.findFirst.mockResolvedValueOnce(null);
      await expect(
        subValuationService.updateSubValuation({
          orgId: 'org-1',
          projectId: 'project-1',
          valuationId: 'sv-1',
          payload: { companyId: 'co-missing' },
        }),
      ).rejects.toMatchObject({ code: 'COMPANY_NOT_FOUND' });
    });

    /**
     * Attribution is bookkeeping about a record, not a change to it. Found by
     * driving it: the save recomputed the figures on the way through, so
     * attaching a company to a paid valuation quietly restated what was paid.
     */
    it('does not restate the money on a certified or paid record', async () => {
      mockPrisma.subValuation.findFirst.mockResolvedValue(
        stored({ status: 'paid', workDone: 1140, retentionRate: 5, retention: 0, grossPayable: 1140, netPayable: 1140 }),
      );
      mockPrisma.company.findFirst.mockResolvedValue({ id: 'co-1' });
      await subValuationService.updateSubValuation({
        orgId: 'org-1',
        projectId: 'project-1',
        valuationId: 'sv-1',
        payload: { companyId: 'co-1' },
      });
      // The agreed figures go back unchanged — not recomputed to 1083.
      expect(mockPrisma.subValuation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId: 'co-1', netPayable: 1140, retention: 0 }),
        }),
      );

      await expect(
        subValuationService.updateSubValuation({
          orgId: 'org-1',
          projectId: 'project-1',
          valuationId: 'sv-1',
          payload: { workDone: 2000 },
        }),
      ).rejects.toMatchObject({
        code: 'SUB_VALUATION_HISTORICAL',
        details: expect.objectContaining({ fields: ['workDone'] }),
      });
    });

    it('deletes a draft but never a certified or paid record', async () => {
      for (const status of subValuationService.HISTORICAL_STATUSES) {
        mockPrisma.subValuation.findFirst.mockResolvedValue(stored({ status }));
        await expect(
          subValuationService.deleteSubValuation({
            orgId: 'org-1',
            projectId: 'project-1',
            valuationId: 'sv-1',
          }),
        ).rejects.toMatchObject({ code: 'SUB_VALUATION_HISTORICAL' });
      }
      expect(mockPrisma.subValuation.delete).not.toHaveBeenCalled();

      mockPrisma.subValuation.findFirst.mockResolvedValue(stored({ status: 'draft' }));
      await subValuationService.deleteSubValuation({
        orgId: 'org-1',
        projectId: 'project-1',
        valuationId: 'sv-1',
      });
      expect(mockPrisma.subValuation.delete).toHaveBeenCalled();
    });
  });

  describe('attribution report', () => {
    const companies = [
      { id: 'co-1', name: 'Concrete Sub', nameKey: 'concrete sub' },
      { id: 'co-2', name: 'Al-Rashid Steel L.L.C.', nameKey: 'al rashid steel llc' },
      { id: 'co-3', name: 'Al Rashid Steel Ltd', nameKey: 'al rashid steel ltd' },
      { id: 'co-4', name: 'Twin Trades', nameKey: 'twin trades' },
      { id: 'co-5', name: 'Twin Trades', nameKey: 'twin trades' },
    ];

    it('suggests only an unambiguous match, and never merges', async () => {
      mockPrisma.company.findMany.mockResolvedValue(companies);
      mockPrisma.subValuation.findMany.mockResolvedValue([
        { id: 'a', ref: 'SV-01', subcontractor: 'Concrete Sub', companyId: null, status: 'paid', netPayable: 1140, company: null },
        { id: 'b', ref: 'SV-02', subcontractor: 'Twin Trades', companyId: null, status: 'paid', netPayable: 500, company: null },
        { id: 'c', ref: 'SV-03', subcontractor: 'Nobody Ltd', companyId: null, status: 'draft', netPayable: 10, company: null },
        { id: 'd', ref: 'SV-04', subcontractor: 'Concrete Sub', companyId: 'co-1', status: 'paid', netPayable: 20, company: { id: 'co-1', name: 'Concrete Sub' } },
      ]);

      const report = await subValuationService.attributionReport({
        orgId: 'org-1',
        projectId: 'project-1',
      });

      expect(report.summary).toMatchObject({ total: 4, attributed: 1, suggested: 1, ambiguous: 1, unmatched: 1 });
      expect(report.items[0].suggested).toEqual({ id: 'co-1', name: 'Concrete Sub' });
      // Two companies share the name; a report proposes, it does not pick.
      expect(report.items[1].suggested).toBeNull();
      expect(report.items[1].candidates).toHaveLength(2);
      expect(report.items[2].candidates).toHaveLength(0);
      // Already attributed rows are left alone.
      expect(report.items[3].suggested).toBeNull();
      expect(report.items[3].attributed).toEqual({ id: 'co-1', name: 'Concrete Sub' });
    });

    it('keeps ABC Steel LLC and ABC Steel Ltd apart', async () => {
      mockPrisma.company.findMany.mockResolvedValue(companies);
      mockPrisma.subValuation.findMany.mockResolvedValue([
        { id: 'a', ref: 'SV-01', subcontractor: "Al Rashid Steel L.L.C.", companyId: null, status: 'paid', netPayable: 1, company: null },
      ]);
      const report = await subValuationService.attributionReport({
        orgId: 'org-1',
        projectId: 'project-1',
      });
      // The legal form is deliberately not folded, so only the LLC matches.
      expect(report.items[0].suggested).toEqual({ id: 'co-2', name: 'Al-Rashid Steel L.L.C.' });
      expect(report.items[0].candidates).toHaveLength(1);
    });
  });
});
