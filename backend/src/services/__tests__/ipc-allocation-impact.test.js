const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  $queryRaw: jest.fn(async () => []), // row locks (Phase 21D): nothing to lock in a fake
  project: { findFirst: jest.fn() },
  ipcCertificate: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    // Read back by recomputeCertificateTotals to apply the client contract's
    // terms (OCTA-COM-PRIME-051).
    findUnique: jest.fn(async () => ({
      id: "cert-1",
      projectId: "project-1",
      materialsOnSite: 0,
      deductions: 0,
      totalRet: 0,
    })),
    aggregate: jest.fn(async () => ({ _sum: { totalRet: 0 } })),
    create: jest.fn(),
    update: jest.fn(),
  },
  // No contract on this project, so the certificate bills as it always did:
  // certified work less retention.
  primeContract: { findFirst: jest.fn(async () => null) },
  activityBoqAllocation: { findMany: jest.fn() },
  activityProgress: { findFirst: jest.fn() },
  changeOrderAllocationLink: { findMany: jest.fn() },
  ipcItem: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  ipcInvoice: {
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  ipcPayment: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  ipcRetentionRelease: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  ipcItemProgressLink: {
    deleteMany: jest.fn(),
    create: jest.fn(),
  },
  approvalWorkflowEvent: {
    create: jest.fn(),
  },
};
const mockAuditService = {
  ACTIONS: {
    CERTIFIED: "certified",
    STATUS_CHANGED: "status_changed",
    UPDATED: "updated",
  },
  ENTITY_TYPES: {
    IPC_CERTIFICATE: "ipc_certificate",
    IPC_ITEM: "ipc_item",
  },
  recordEvent: jest.fn(),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAuditService);

const ipcService = require("../ipc.service");

describe("IPC allocation impact", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.changeOrderAllocationLink.findMany.mockResolvedValue([]);
    mockPrisma.ipcInvoice.findFirst.mockResolvedValue(null);
    mockPrisma.ipcInvoice.count.mockResolvedValue(0);
    mockPrisma.ipcPayment.findMany.mockResolvedValue([]);
    mockPrisma.ipcRetentionRelease.findMany.mockResolvedValue([]);
    mockPrisma.approvalWorkflowEvent.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: "workflow-event-1",
        ...data,
      }),
    );
  });

  it("creates IPC lines from approved activity BOQ allocations", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.ipcCertificate.findMany.mockResolvedValue([]);
    mockPrisma.ipcCertificate.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "ipc-1",
        projectId: "project-1",
        period: "IPC-1",
        status: "draft",
        items: [],
      });
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([
      {
        id: "allocation-1",
        projectId: "project-1",
        boqItemId: "boq-1",
        activityId: "activity-1",
        quantity: 4,
        amount: 200,
        status: "approved",
        isActive: true,
        boqItem: { id: "boq-1", rate: 60, sortOrder: 1 },
        activity: { id: "activity-1", name: "Excavate", sortOrder: 1 },
      },
    ]);
    mockPrisma.ipcItem.findMany.mockResolvedValue([]);
    mockPrisma.ipcCertificate.create.mockResolvedValue({
      id: "ipc-1",
      period: "IPC-1",
    });

    await ipcService.createIpcPeriod({
      orgId: "org-1",
      projectId: "project-1",
    });

    expect(mockPrisma.activityBoqAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: "project-1",
          status: "approved",
          isActive: true,
          activity: { isActive: true },
        },
      }),
    );
    expect(mockPrisma.ipcItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          boqItemId: "boq-1",
          allocationId: "allocation-1",
          qty: 0,
          rate: 50,
          previousCert: 0,
          cumulativeCert: 0,
          retentionRate: 5,
        }),
      ],
    });
  });

  it("uses the project retention default for new IPC lines", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({
      id: "project-1",
      defaultRetentionRate: 7.5,
    });
    mockPrisma.ipcCertificate.findMany.mockResolvedValue([]);
    mockPrisma.ipcCertificate.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "ipc-1",
        projectId: "project-1",
        period: "IPC-1",
        status: "draft",
        items: [],
      });
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([
      {
        id: "allocation-1",
        projectId: "project-1",
        boqItemId: "boq-1",
        activityId: "activity-1",
        quantity: 2,
        amount: 100,
        status: "approved",
        isActive: true,
        boqItem: { id: "boq-1", rate: 50, sortOrder: 1 },
        activity: { id: "activity-1", name: "Excavate", sortOrder: 1 },
      },
    ]);
    mockPrisma.ipcItem.findMany.mockResolvedValue([]);
    mockPrisma.ipcCertificate.create.mockResolvedValue({
      id: "ipc-1",
      period: "IPC-1",
    });

    await ipcService.createIpcPeriod({
      orgId: "org-1",
      projectId: "project-1",
    });

    expect(mockPrisma.ipcItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          allocationId: "allocation-1",
          retentionRate: 7.5,
        }),
      ],
    });
  });

  it("certifies an IPC period with certifier metadata and audit history", async () => {
    const certificate = {
      id: "ipc-1",
      projectId: "project-1",
      period: "IPC-1",
      status: "submitted",
      totalCert: 1000,
      totalRet: 50,
      netPayable: 950,
    };
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.ipcCertificate.findFirst.mockResolvedValue(certificate);
    mockPrisma.ipcItem.findMany.mockResolvedValue([]);
    mockPrisma.ipcItem.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.ipcCertificate.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...certificate, ...data }),
    );

    const result = await ipcService.certifyIpcPeriod({
      orgId: "org-1",
      projectId: "project-1",
      period: "IPC-1",
      userId: "finance-1",
      comment: "Certified for payment",
    });

    expect(result.status).toBe("certified");
    expect(mockPrisma.ipcCertificate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ipc-1" },
        data: expect.objectContaining({
          status: "certified",
          certifiedBy: "finance-1",
          certifiedAt: expect.any(Date),
          certificationComment: "Certified for payment",
        }),
      }),
    );
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        projectId: "project-1",
        entityType: "ipc_certificate",
        entityId: "ipc-1",
        action: "certified",
        actorId: "finance-1",
        oldStatus: "submitted",
        newStatus: "certified",
        reason: "Certified for payment",
      }),
    );
  });

  it("reconciles IPC item certification to latest approved allocation progress", async () => {
    const certificate = {
      id: "ipc-1",
      projectId: "project-1",
      period: "IPC-1",
      status: "draft",
    };
    const existingItem = {
      id: "item-1",
      projectId: "project-1",
      boqItemId: "boq-1",
      allocationId: "allocation-1",
      ipcPeriod: "IPC-1",
      qty: 0,
      rate: 100,
      previousCert: 200,
      currentCert: 0,
      cumulativeCert: 200,
      retentionRate: 5,
      retention: 0,
      netPayable: 0,
      status: "draft",
      allocation: {
        id: "allocation-1",
        activityId: "activity-1",
        quantity: 10,
        amount: 1000,
        status: "approved",
        isActive: true,
      },
    };
    const progress = {
      id: "progress-1",
      pctComplete: 60,
      quantityComplete: null,
      quantityPlanned: null,
      quantityUnit: null,
      progressMethod: "percent_complete",
      status: "approved",
      approvedAt: new Date("2026-06-01T00:00:00Z"),
      updatedAt: new Date("2026-06-01T00:00:00Z"),
    };
    const updatedItem = {
      ...existingItem,
      qty: 3,
      currentCert: 300,
      cumulativeCert: 500,
      retention: 15,
      netPayable: 285,
      progressLinks: [
        {
          id: "link-1",
          approvedPctComplete: 60,
          progress,
        },
      ],
    };

    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.ipcCertificate.findFirst.mockResolvedValue(certificate);
    mockPrisma.ipcItem.findFirst
      .mockResolvedValueOnce(existingItem)
      .mockResolvedValueOnce(updatedItem);
    mockPrisma.activityProgress.findFirst.mockResolvedValue(progress);
    mockPrisma.ipcItem.update.mockResolvedValue(updatedItem);
    mockPrisma.ipcItem.findMany.mockResolvedValue([updatedItem]);
    mockPrisma.ipcCertificate.update.mockResolvedValue(certificate);
    mockPrisma.ipcItemProgressLink.create.mockResolvedValue({
      id: "link-1",
      progress,
    });

    const result = await ipcService.updateIpcItem({
      orgId: "org-1",
      projectId: "project-1",
      period: "IPC-1",
      itemId: "item-1",
      payload: { qty: 3, rate: 100 },
    });

    expect(result.progressLinks).toHaveLength(1);
    expect(mockPrisma.ipcItemProgressLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ipcItemId: "item-1",
          allocationId: "allocation-1",
          activityId: "activity-1",
          progressId: "progress-1",
          approvedPctComplete: 60,
          certifiedAmount: 300,
          previousCertifiedAmount: 200,
        }),
      }),
    );
  });

  it("rejects IPC item updates when the linked allocation is not approved and active", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.ipcCertificate.findFirst.mockResolvedValue({
      id: "ipc-1",
      projectId: "project-1",
      period: "IPC-1",
      status: "draft",
    });
    mockPrisma.ipcItem.findFirst.mockResolvedValue({
      id: "item-1",
      projectId: "project-1",
      boqItemId: "boq-1",
      allocationId: "allocation-1",
      ipcPeriod: "IPC-1",
      qty: 0,
      rate: 100,
      previousCert: 0,
      currentCert: 0,
      cumulativeCert: 0,
      retentionRate: 5,
      retention: 0,
      netPayable: 0,
      status: "draft",
      allocation: {
        id: "allocation-1",
        activityId: "activity-1",
        boqItemId: "boq-1",
        quantity: 10,
        amount: 1000,
        status: "draft",
        isActive: true,
      },
    });

    await expect(
      ipcService.updateIpcItem({
        orgId: "org-1",
        projectId: "project-1",
        period: "IPC-1",
        itemId: "item-1",
        payload: { qty: 1, rate: 100 },
      }),
    ).rejects.toMatchObject({ code: "IPC_ALLOCATION_NOT_APPROVED" });

    expect(mockPrisma.activityProgress.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.ipcItem.update).not.toHaveBeenCalled();
  });

  it("rejects direct item status changes outside the period workflow", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.ipcCertificate.findFirst.mockResolvedValue({
      id: "ipc-1",
      projectId: "project-1",
      period: "IPC-1",
      status: "draft",
    });
    mockPrisma.ipcItem.findFirst.mockResolvedValue({
      id: "item-1",
      projectId: "project-1",
      boqItemId: "boq-1",
      allocationId: null,
      ipcPeriod: "IPC-1",
      qty: 0,
      rate: 100,
      previousCert: 0,
      currentCert: 0,
      cumulativeCert: 0,
      retentionRate: 5,
      retention: 0,
      netPayable: 0,
      status: "draft",
      allocation: null,
    });

    await expect(
      ipcService.updateIpcItem({
        orgId: "org-1",
        projectId: "project-1",
        period: "IPC-1",
        itemId: "item-1",
        payload: { status: "certified" },
      }),
    ).rejects.toMatchObject({
      code: "IPC_ITEM_STATUS_DIRECT_UPDATE_FORBIDDEN",
    });

    expect(mockPrisma.ipcItem.update).not.toHaveBeenCalled();
  });

  it("blocks certification unless the IPC period was submitted first", async () => {
    const certificate = {
      id: "ipc-1",
      projectId: "project-1",
      period: "IPC-1",
      status: "draft",
      totalCert: 0,
      totalRet: 0,
      netPayable: 0,
    };
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.ipcCertificate.findFirst.mockResolvedValue(certificate);

    await expect(
      ipcService.certifyIpcPeriod({
        orgId: "org-1",
        projectId: "project-1",
        period: "IPC-1",
        userId: "finance-1",
      }),
    ).rejects.toMatchObject({ code: "IPC_INVALID_CERTIFICATION_STATE" });

    expect(mockPrisma.ipcCertificate.update).not.toHaveBeenCalled();
  });

  it("requires a PM override reason before certifying above earned or approved value", async () => {
    const certificate = {
      id: "ipc-1",
      projectId: "project-1",
      period: "IPC-1",
      status: "submitted",
      totalCert: 1100,
      totalRet: 55,
      netPayable: 1045,
    };
    const item = {
      id: "item-1",
      projectId: "project-1",
      boqItemId: "boq-1",
      allocationId: "allocation-1",
      ipcPeriod: "IPC-1",
      qty: 11,
      currentCert: 1100,
      previousCert: 0,
      cumulativeCert: 1100,
      allocation: {
        id: "allocation-1",
        activityId: "activity-1",
        boqItemId: "boq-1",
        quantity: 10,
        amount: 1000,
        status: "approved",
        isActive: true,
      },
    };

    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.ipcCertificate.findFirst.mockResolvedValue(certificate);
    mockPrisma.ipcItem.findMany
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([]);
    mockPrisma.activityProgress.findFirst.mockResolvedValue({
      id: "progress-1",
      pctComplete: 100,
      updatedAt: new Date("2026-06-01T00:00:00Z"),
      status: "approved",
    });

    await expect(
      ipcService.certifyIpcPeriod({
        orgId: "org-1",
        projectId: "project-1",
        period: "IPC-1",
        userId: "finance-1",
        userRole: "finance",
      }),
    ).rejects.toMatchObject({ code: "IPC_PM_OVERRIDE_REASON_REQUIRED" });

    expect(mockPrisma.ipcCertificate.update).not.toHaveBeenCalled();
  });

  it("records PM override metadata for over-limit IPC certification", async () => {
    const certificate = {
      id: "ipc-1",
      projectId: "project-1",
      period: "IPC-1",
      status: "submitted",
      totalCert: 1100,
      totalRet: 55,
      netPayable: 1045,
    };
    const item = {
      id: "item-1",
      projectId: "project-1",
      boqItemId: "boq-1",
      allocationId: "allocation-1",
      ipcPeriod: "IPC-1",
      qty: 11,
      currentCert: 1100,
      previousCert: 0,
      cumulativeCert: 1100,
      allocation: {
        id: "allocation-1",
        activityId: "activity-1",
        boqItemId: "boq-1",
        quantity: 10,
        amount: 1000,
        status: "approved",
        isActive: true,
      },
    };

    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.ipcCertificate.findFirst.mockResolvedValue(certificate);
    mockPrisma.ipcItem.findMany
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([]);
    mockPrisma.activityProgress.findFirst.mockResolvedValue({
      id: "progress-1",
      pctComplete: 100,
      updatedAt: new Date("2026-06-01T00:00:00Z"),
      status: "approved",
    });
    mockPrisma.ipcItem.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.ipcCertificate.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...certificate, ...data }),
    );

    await ipcService.certifyIpcPeriod({
      orgId: "org-1",
      projectId: "project-1",
      period: "IPC-1",
      userId: "pm-1",
      userRole: "pm",
      overrideReason: "Client-agreed acceleration works pending VO signature",
    });

    expect(mockPrisma.ipcCertificate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "certified",
          earnedValueAtCertification: 1000,
          approvedLimitAtCertification: 1000,
          overCertificationAmount: 100,
          certificationOverrideReason:
            "Client-agreed acceleration works pending VO signature",
          certificationOverrideBy: "pm-1",
          certificationOverrideAt: expect.any(Date),
        }),
      }),
    );
  });

  it("includes approved variation allowance when enforcing IPC item limits", async () => {
    const certificate = {
      id: "ipc-1",
      projectId: "project-1",
      period: "IPC-1",
      status: "draft",
    };
    const existingItem = {
      id: "item-1",
      projectId: "project-1",
      boqItemId: "boq-1",
      allocationId: "allocation-1",
      ipcPeriod: "IPC-1",
      qty: 0,
      rate: 100,
      previousCert: 900,
      currentCert: 0,
      cumulativeCert: 900,
      retentionRate: 5,
      retention: 0,
      netPayable: 0,
      status: "draft",
      allocation: {
        id: "allocation-1",
        activityId: "activity-1",
        boqItemId: "boq-1",
        quantity: 10,
        amount: 1000,
        status: "approved",
        isActive: true,
      },
    };
    const progress = {
      id: "progress-1",
      pctComplete: 100,
      quantityComplete: null,
      quantityPlanned: null,
      quantityUnit: null,
      progressMethod: "percent_complete",
      status: "approved",
      approvedAt: new Date("2026-06-01T00:00:00Z"),
      updatedAt: new Date("2026-06-01T00:00:00Z"),
    };
    const updatedItem = {
      ...existingItem,
      qty: 2,
      currentCert: 200,
      cumulativeCert: 1100,
      retention: 10,
      netPayable: 190,
      progressLinks: [{ id: "link-1", progress }],
    };

    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.ipcCertificate.findFirst.mockResolvedValue(certificate);
    mockPrisma.ipcItem.findFirst
      .mockResolvedValueOnce(existingItem)
      .mockResolvedValueOnce(updatedItem);
    mockPrisma.activityProgress.findFirst.mockResolvedValue(progress);
    mockPrisma.changeOrderAllocationLink.findMany.mockResolvedValue([
      {
        id: "variation-1",
        allocationId: "allocation-1",
        boqItemId: "boq-1",
        quantity: 2,
        amount: 200,
        changeOrder: { id: "co-1", status: "approved" },
      },
    ]);
    mockPrisma.ipcItem.update.mockResolvedValue(updatedItem);
    mockPrisma.ipcItem.findMany.mockResolvedValue([updatedItem]);
    mockPrisma.ipcCertificate.update.mockResolvedValue(certificate);
    mockPrisma.ipcItemProgressLink.create.mockResolvedValue({
      id: "link-1",
      progress,
    });

    const result = await ipcService.updateIpcItem({
      orgId: "org-1",
      projectId: "project-1",
      period: "IPC-1",
      itemId: "item-1",
      payload: { qty: 2, rate: 100 },
    });

    expect(result.cumulativeCert).toBe(1100);
    expect(mockPrisma.changeOrderAllocationLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: "project-1",
          changeOrder: { status: "approved" },
        }),
      }),
    );
  });

  it.each(["pending", "rejected"])(
    "ignores %s variation allowance when enforcing IPC item limits",
    async (changeOrderStatus) => {
      const certificate = {
        id: "ipc-1",
        projectId: "project-1",
        period: "IPC-1",
        status: "draft",
      };
      const existingItem = {
        id: "item-1",
        projectId: "project-1",
        boqItemId: "boq-1",
        allocationId: "allocation-1",
        ipcPeriod: "IPC-1",
        qty: 0,
        rate: 100,
        previousCert: 900,
        currentCert: 0,
        cumulativeCert: 900,
        retentionRate: 5,
        retention: 0,
        netPayable: 0,
        status: "draft",
        allocation: {
          id: "allocation-1",
          activityId: "activity-1",
          boqItemId: "boq-1",
          quantity: 10,
          amount: 1000,
          status: "approved",
          isActive: true,
        },
      };
      const progress = {
        id: "progress-1",
        pctComplete: 100,
        status: "approved",
        updatedAt: new Date("2026-06-01T00:00:00Z"),
      };

      mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
      mockPrisma.ipcCertificate.findFirst.mockResolvedValue(certificate);
      mockPrisma.ipcItem.findFirst.mockResolvedValue(existingItem);
      mockPrisma.activityProgress.findFirst.mockResolvedValue(progress);
      mockPrisma.changeOrderAllocationLink.findMany.mockImplementation(
        ({ where }) =>
          Promise.resolve(
            where.changeOrder?.status === changeOrderStatus
              ? [
                  {
                    allocationId: "allocation-1",
                    boqItemId: "boq-1",
                    quantity: 2,
                    amount: 200,
                  },
                ]
              : [],
          ),
      );

      await expect(
        ipcService.updateIpcItem({
          orgId: "org-1",
          projectId: "project-1",
          period: "IPC-1",
          itemId: "item-1",
          payload: { qty: 2, rate: 100 },
        }),
      ).rejects.toMatchObject({ code: "IPC_ALLOCATION_AMOUNT_EXCEEDED" });

      expect(
        mockPrisma.changeOrderAllocationLink.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: "project-1",
            changeOrder: { status: "approved" },
          }),
        }),
      );
      expect(mockPrisma.ipcItem.update).not.toHaveBeenCalled();
    },
  );

  it("allows only the partially allocated approved variation allowance", async () => {
    const certificate = {
      id: "ipc-1",
      projectId: "project-1",
      period: "IPC-1",
      status: "draft",
    };
    const existingItem = {
      id: "item-1",
      projectId: "project-1",
      boqItemId: "boq-1",
      allocationId: "allocation-1",
      ipcPeriod: "IPC-1",
      qty: 0,
      rate: 100,
      previousCert: 1000,
      currentCert: 0,
      cumulativeCert: 1000,
      retentionRate: 5,
      retention: 0,
      netPayable: 0,
      status: "draft",
      allocation: {
        id: "allocation-1",
        activityId: "activity-1",
        boqItemId: "boq-1",
        quantity: 10,
        amount: 1000,
        status: "approved",
        isActive: true,
      },
    };
    const progress = {
      id: "progress-1",
      pctComplete: 100,
      quantityComplete: null,
      quantityPlanned: null,
      quantityUnit: null,
      progressMethod: "percent_complete",
      status: "approved",
      approvedAt: new Date("2026-06-01T00:00:00Z"),
      updatedAt: new Date("2026-06-01T00:00:00Z"),
    };
    const updatedItem = {
      ...existingItem,
      qty: 0.5,
      currentCert: 50,
      cumulativeCert: 1050,
      retention: 2.5,
      netPayable: 47.5,
      progressLinks: [{ id: "link-1", progress }],
    };

    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.ipcCertificate.findFirst.mockResolvedValue(certificate);
    mockPrisma.ipcItem.findFirst
      .mockResolvedValueOnce(existingItem)
      .mockResolvedValueOnce(updatedItem);
    mockPrisma.activityProgress.findFirst.mockResolvedValue(progress);
    mockPrisma.changeOrderAllocationLink.findMany.mockResolvedValue([
      {
        allocationId: "allocation-1",
        boqItemId: "boq-1",
        quantity: 0.5,
        amount: 50,
      },
    ]);
    mockPrisma.ipcItem.update.mockResolvedValue(updatedItem);
    mockPrisma.ipcItem.findMany.mockResolvedValue([updatedItem]);
    mockPrisma.ipcCertificate.update.mockResolvedValue(certificate);
    mockPrisma.ipcItemProgressLink.create.mockResolvedValue({
      id: "link-1",
      progress,
    });

    const result = await ipcService.updateIpcItem({
      orgId: "org-1",
      projectId: "project-1",
      period: "IPC-1",
      itemId: "item-1",
      payload: { qty: 0.5, rate: 100 },
    });

    expect(result.cumulativeCert).toBe(1050);
    expect(mockPrisma.ipcItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentCert: 50,
          cumulativeCert: 1050,
        }),
      }),
    );
  });

  it("issues invoices only after certification and snapshots the certified value", async () => {
    const submittedCertificate = {
      id: "ipc-1",
      projectId: "project-1",
      period: "IPC-1",
      status: "submitted",
      totalCert: 1000,
      totalRet: 50,
      netPayable: 950,
    };
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.ipcCertificate.findFirst.mockResolvedValueOnce(
      submittedCertificate,
    );

    await expect(
      ipcService.issueIpcInvoice({
        orgId: "org-1",
        projectId: "project-1",
        period: "IPC-1",
        payload: { invoiceNumber: "INV-001" },
        userId: "finance-1",
      }),
    ).rejects.toMatchObject({ code: "IPC_CERTIFICATE_NOT_CERTIFIED" });

    const certifiedCertificate = {
      ...submittedCertificate,
      status: "certified",
    };
    const invoice = {
      id: "invoice-1",
      projectId: "project-1",
      ipcCertificateId: "ipc-1",
      invoiceNumber: "INV-001",
      grossAmount: 1000,
      retentionHeld: 50,
      retentionReleased: 0,
      netAmount: 950,
      status: "issued",
    };
    mockPrisma.ipcCertificate.findFirst.mockResolvedValueOnce(
      certifiedCertificate,
    );
    mockPrisma.ipcInvoice.create.mockResolvedValue(invoice);
    mockPrisma.ipcInvoice.update.mockResolvedValue(invoice);
    mockPrisma.ipcCertificate.update.mockResolvedValue({
      ...certifiedCertificate,
      invoiceStatus: "issued",
    });

    const result = await ipcService.issueIpcInvoice({
      orgId: "org-1",
      projectId: "project-1",
      period: "IPC-1",
      payload: { invoiceNumber: "INV-001" },
      userId: "finance-1",
    });

    expect(result.netAmount).toBe(950);
    expect(mockPrisma.ipcInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceNumber: "INV-001",
          grossAmount: 1000,
          retentionHeld: 50,
          netAmount: 950,
          status: "issued",
        }),
      }),
    );
  });

  it("rejects payments above the payable balance", async () => {
    const certificate = {
      id: "ipc-1",
      projectId: "project-1",
      period: "IPC-1",
      status: "certified",
      totalCert: 1000,
      totalRet: 50,
      netPayable: 950,
      retentionReleased: 0,
      amountPaid: 900,
      paymentStatus: "partially_paid",
    };
    const invoice = {
      id: "invoice-1",
      ipcCertificateId: "ipc-1",
      netAmount: 950,
      retentionReleased: 0,
      amountPaid: 900,
      balanceDue: 50,
      status: "issued",
    };

    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.ipcCertificate.findFirst.mockResolvedValue(certificate);
    mockPrisma.ipcInvoice.findFirst.mockResolvedValue(invoice);

    await expect(
      ipcService.recordIpcPayment({
        orgId: "org-1",
        projectId: "project-1",
        period: "IPC-1",
        payload: {
          amount: 100,
          paymentDate: "2026-06-10",
          paymentReference: "BANK-100",
        },
        userId: "finance-1",
      }),
    ).rejects.toMatchObject({ code: "IPC_PAYMENT_EXCEEDS_PAYABLE_BALANCE" });

    expect(mockPrisma.ipcPayment.create).not.toHaveBeenCalled();
  });

  it("limits retention releases to the held retention balance with cent precision", async () => {
    const certificate = {
      id: "ipc-1",
      projectId: "project-1",
      period: "IPC-1",
      status: "paid",
      totalCert: 12345.67,
      totalRet: 617.28,
      netPayable: 11728.39,
      retentionReleased: 100,
      amountPaid: 11728.39,
      retentionStatus: "partially_released",
    };
    const invoice = {
      id: "invoice-1",
      ipcCertificateId: "ipc-1",
      netAmount: 11728.39,
      retentionReleased: 100,
      amountPaid: 11728.39,
      balanceDue: 0,
      status: "issued",
    };

    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.ipcCertificate.findFirst.mockResolvedValue(certificate);
    mockPrisma.ipcInvoice.findFirst.mockResolvedValue(invoice);

    await expect(
      ipcService.releaseIpcRetention({
        orgId: "org-1",
        projectId: "project-1",
        period: "IPC-1",
        payload: { amount: 517.29, reason: "Final account closeout" },
        userId: "finance-1",
      }),
    ).rejects.toMatchObject({ code: "IPC_RETENTION_RELEASE_EXCEEDS_HELD" });

    expect(mockPrisma.ipcRetentionRelease.create).not.toHaveBeenCalled();
    // The release holds the certificate like a payment does, so two releases at
    // once are checked one after the other (Phase 21D, CX21-205).
    expect(mockPrisma.$queryRaw.mock.calls.some((call) => Array.isArray(call[0]) && /FROM "IpcCertificate" WHERE id = \? FOR UPDATE/.test(call[0].join("?")))).toBe(true);
  });
});
