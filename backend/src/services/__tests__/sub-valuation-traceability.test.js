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

describe('Phase 21D — integrity (release challenge, tenth pass)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1', orgId: 'org-1', defaultRetentionRate: 5 });
    mockPrisma.subValuation.update.mockResolvedValue(stored({ status: 'paid' }));
  });

  it('CX21-513: a paid or certified valuation does not leave its status through an edit, so its agreed figures stay frozen', async () => {
    mockPrisma.subValuation.findFirst.mockResolvedValue(stored({ status: 'paid' }));
    await expect(
      subValuationService.updateSubValuation({ orgId: 'org-1', projectId: 'project-1', valuationId: 'sv-1', userId: 'qs-1', payload: { status: 'draft' } }),
    ).rejects.toMatchObject({ status: 409, code: 'SUB_VALUATION_HISTORICAL', details: { fields: ['status'] } });
    mockPrisma.subValuation.findFirst.mockResolvedValue(stored({ status: 'certified' }));
    await expect(
      subValuationService.updateSubValuation({ orgId: 'org-1', projectId: 'project-1', valuationId: 'sv-1', userId: 'qs-1', payload: { status: 'submitted', workDone: 5000 } }),
    ).rejects.toMatchObject({ code: 'SUB_VALUATION_HISTORICAL' });
    expect(mockPrisma.subValuation.update).not.toHaveBeenCalled();
    // an echo of the status, with a non-money field, still passes
    await subValuationService.updateSubValuation({ orgId: 'org-1', projectId: 'project-1', valuationId: 'sv-1', userId: 'qs-1', payload: { status: 'certified', period: '2026-07' } });
    expect(mockPrisma.subValuation.update).toHaveBeenCalledTimes(1);
  });
});

describe('Phase 21D — integrity (release challenge, eleventh pass)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1', orgId: 'org-1', defaultRetentionRate: 5 });
    mockPrisma.subValuation.update.mockResolvedValue(stored());
  });

  it('CX21-521: an edit or a delete decided on a submitted copy is refused once the valuation was certified meanwhile — the row is held and read again first', async () => {
    mockPrisma.$queryRaw = jest.fn(async () => []);
    mockPrisma.subValuation.findFirst
      .mockResolvedValueOnce(stored({ status: 'submitted' })) // the copy the checks were made on
      .mockResolvedValueOnce(stored({ status: 'certified' })); // the row as held
    await expect(
      subValuationService.updateSubValuation({ orgId: 'org-1', projectId: 'project-1', valuationId: 'sv-1', userId: 'qs-1', payload: { workDone: 500 } }),
    ).rejects.toMatchObject({ status: 409, code: 'SUB_VALUATION_CHANGED' });
    expect(mockPrisma.subValuation.update).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRaw.mock.calls[0][0].join('?')).toMatch(/"SubValuation".*FOR UPDATE/);
    mockPrisma.subValuation.findFirst
      .mockResolvedValueOnce(stored({ status: 'submitted' }))
      .mockResolvedValueOnce(stored({ status: 'certified' }));
    await expect(
      subValuationService.deleteSubValuation({ orgId: 'org-1', projectId: 'project-1', valuationId: 'sv-1', userId: 'pm-1' }),
    ).rejects.toMatchObject({ code: 'SUB_VALUATION_CHANGED' });
    expect(mockPrisma.subValuation.delete).not.toHaveBeenCalled();
    delete mockPrisma.$queryRaw;
  });

  it('CX21-527: paying and certifying need that authority on a change of status only — an editor repeating the status it has passes', async () => {
    mockPrisma.subValuation.findFirst.mockResolvedValue(stored({ status: 'submitted' }));
    await expect(
      subValuationService.updateSubValuation({ orgId: 'org-1', projectId: 'project-1', valuationId: 'sv-1', userId: 'qs-1', payload: { status: 'paid' }, authority: { pay: false, certify: false } }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      subValuationService.updateSubValuation({ orgId: 'org-1', projectId: 'project-1', valuationId: 'sv-1', userId: 'qs-1', payload: { status: 'certified' }, authority: { pay: false, certify: false } }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockPrisma.subValuation.update).not.toHaveBeenCalled();
    mockPrisma.subValuation.findFirst.mockResolvedValue(stored({ status: 'certified' }));
    await subValuationService.updateSubValuation({ orgId: 'org-1', projectId: 'project-1', valuationId: 'sv-1', userId: 'qs-1', payload: { status: 'certified', period: '2026-08' }, authority: { pay: false, certify: false } });
    expect(mockPrisma.subValuation.update).toHaveBeenCalledTimes(1);
    mockPrisma.subValuation.findFirst.mockResolvedValue(stored({ status: 'submitted' }));
    await subValuationService.updateSubValuation({ orgId: 'org-1', projectId: 'project-1', valuationId: 'sv-1', userId: 'pm-1', payload: { status: 'paid' }, authority: { pay: true, certify: true } });
    expect(mockPrisma.subValuation.update).toHaveBeenCalledTimes(2);
  });
});

describe('Phase 21D — integrity (release challenge, twelfth pass)', () => {
  const party = { id: 'project-1', role: 'external_party', scope: 'party', assignmentRole: null, partyAccess: [{ projectPartyId: 'party-1', companyId: 'co-a', role: 'subcontractor' }] };
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1', orgId: 'org-1', defaultRetentionRate: 5 });
    mockPrisma.subValuation.update.mockResolvedValue(stored());
    mockPrisma.subValuation.findMany.mockResolvedValue([]);
  });

  it("CX21-531: a party-scoped person lists, edits and deletes the valuations of their own company only, and cannot re-attribute one", async () => {
    await subValuationService.listSubValuations({ orgId: 'org-1', projectId: 'project-1', projectAccess: party });
    expect(mockPrisma.subValuation.findMany.mock.calls.at(-1)[0].where).toMatchObject({ projectId: 'project-1', companyId: { in: ['co-a'] } });
    mockPrisma.subValuation.findFirst.mockResolvedValue(stored({ status: 'submitted', companyId: 'co-b' }));
    await expect(subValuationService.updateSubValuation({ orgId: 'org-1', projectId: 'project-1', valuationId: 'sv-1', userId: 'sub-1', payload: { workDone: 5 }, projectAccess: party })).rejects.toMatchObject({ status: 404 });
    await expect(subValuationService.deleteSubValuation({ orgId: 'org-1', projectId: 'project-1', valuationId: 'sv-1', userId: 'sub-1', projectAccess: party })).rejects.toMatchObject({ status: 404 });
    mockPrisma.subValuation.findFirst.mockResolvedValue(stored({ status: 'submitted', companyId: 'co-a' }));
    await expect(subValuationService.updateSubValuation({ orgId: 'org-1', projectId: 'project-1', valuationId: 'sv-1', userId: 'sub-1', payload: { companyId: 'co-b' }, projectAccess: party })).rejects.toMatchObject({ status: 403 });
    expect(mockPrisma.subValuation.update).not.toHaveBeenCalled();
    expect(mockPrisma.subValuation.delete).not.toHaveBeenCalled();
    // a member of the project is not narrowed
    await subValuationService.listSubValuations({ orgId: 'org-1', projectId: 'project-1', projectAccess: { id: 'project-1', role: 'qs', scope: 'assignment', assignmentRole: 'qs', partyAccess: [] } });
    expect(mockPrisma.subValuation.findMany.mock.calls.at(-1)[0].where).toEqual({ projectId: 'project-1' });
  });

  it('CX21-532: an edit is computed from the row as held — a figure changed since the copy was read is kept, not restated from the copy', async () => {
    mockPrisma.subValuation.findFirst
      .mockResolvedValueOnce(stored({ status: 'submitted', workDone: 100 })) // the copy
      .mockResolvedValueOnce(stored({ status: 'submitted', workDone: 200 })); // the row as held
    await subValuationService.updateSubValuation({ orgId: 'org-1', projectId: 'project-1', valuationId: 'sv-1', userId: 'pm-1', payload: { status: 'certified' }, authority: { pay: true, certify: true } });
    const data = mockPrisma.subValuation.update.mock.calls[0][0].data;
    expect(data.workDone).toBe(200);
    expect(data.status).toBe('certified');
  });
});

describe('Phase 21D — integrity (release challenge, thirteenth pass)', () => {
  const party = { id: 'project-1', role: 'external_party', scope: 'party', assignmentRole: null, partyAccess: [{ projectPartyId: 'party-1', companyId: 'co-a', role: 'subcontractor' }] };
  const member = { id: 'project-1', role: 'qs', scope: 'assignment', assignmentRole: 'qs', partyAccess: [] };
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1', orgId: 'org-1', defaultRetentionRate: 5 });
    mockPrisma.subValuation.update.mockResolvedValue(stored());
    mockPrisma.subValuation.findMany.mockResolvedValue([]);
    mockPrisma.company = { ...(mockPrisma.company || {}), findMany: jest.fn(async () => []) };
  });

  it("CX21-541: the attribution report is a party's own company's rows and candidates; a member's is the whole project", async () => {
    await subValuationService.attributionReport({ orgId: 'org-1', projectId: 'project-1', projectAccess: party });
    expect(mockPrisma.subValuation.findMany.mock.calls.at(-1)[0].where).toMatchObject({ projectId: 'project-1', companyId: { in: ['co-a'] } });
    expect(mockPrisma.company.findMany.mock.calls.at(-1)[0].where).toMatchObject({ orgId: 'org-1', id: { in: ['co-a'] } });
    await subValuationService.attributionReport({ orgId: 'org-1', projectId: 'project-1', projectAccess: member });
    expect(mockPrisma.subValuation.findMany.mock.calls.at(-1)[0].where).toEqual({ projectId: 'project-1' });
    expect(mockPrisma.company.findMany.mock.calls.at(-1)[0].where).toEqual({ orgId: 'org-1' });
  });

  it("CX21-542: the attribution is judged on the row as held — re-attributed to another company since the copy was read, a party's edit and delete are refused and nothing is written", async () => {
    mockPrisma.subValuation.findFirst
      .mockResolvedValueOnce(stored({ status: 'submitted', companyId: 'co-a' })) // the copy
      .mockResolvedValueOnce(stored({ status: 'submitted', companyId: 'co-b' })); // the row as held
    await expect(subValuationService.updateSubValuation({ orgId: 'org-1', projectId: 'project-1', valuationId: 'sv-1', userId: 'sub-1', payload: { workDone: 5 }, projectAccess: party })).rejects.toMatchObject({ status: 404 });
    expect(mockPrisma.subValuation.update).not.toHaveBeenCalled();
    mockPrisma.subValuation.findFirst
      .mockResolvedValueOnce(stored({ status: 'submitted', companyId: 'co-a' }))
      .mockResolvedValueOnce({ status: 'submitted', companyId: 'co-b' });
    await expect(subValuationService.deleteSubValuation({ orgId: 'org-1', projectId: 'project-1', valuationId: 'sv-1', userId: 'sub-1', projectAccess: party })).rejects.toMatchObject({ status: 404 });
    expect(mockPrisma.subValuation.delete).not.toHaveBeenCalled();
  });
});
