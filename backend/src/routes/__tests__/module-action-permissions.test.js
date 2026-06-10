const express = require("express");
const request = require("supertest");

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: "user-1",
      orgId: "org-1",
      role: req.get("x-role") || "site_engineer",
    };
    next();
  },
}));

const mockScheduleService = {
  approveRevision: jest.fn(),
};
const mockActivityService = {
  updateProgress: jest.fn(),
};
const mockCostService = {
  updateCostRecord: jest.fn(),
};
const mockProcurementService = {
  createPurchaseOrder: jest.fn(),
  recordDeliveryReceipt: jest.fn(),
  updateLeadTimeAlert: jest.fn(),
};
const mockMaterialService = {
  listMaterials: jest.fn(),
  addMaterial: jest.fn(),
  updateMaterial: jest.fn(),
  deleteMaterial: jest.fn(),
  recordMaterialUsage: jest.fn(),
};
const mockIpcService = {
  certifyIpcPeriod: jest.fn(),
  issueIpcInvoice: jest.fn(),
  recordIpcPayment: jest.fn(),
  releaseIpcRetention: jest.fn(),
};
const mockUserService = {
  createUser: jest.fn(),
};
const mockDailyReportService = {
  REPORT_STATUSES: ["draft", "submitted", "approved", "rejected"],
  createDailyReport: jest.fn(),
  updateDailyReport: jest.fn(),
  approveDailyReport: jest.fn(),
};
const mockSiteDiaryService = {
  DIARY_STATUSES: ["draft", "submitted", "approved", "rejected"],
  createSiteDiary: jest.fn(),
  approveSiteDiary: jest.fn(),
};
const mockRfiService = {
  listRfis: jest.fn(),
  createRfi: jest.fn(),
  updateRfi: jest.fn(),
  deleteRfi: jest.fn(),
};
const mockSubmittalService = {
  listSubmittals: jest.fn(),
  createSubmittal: jest.fn(),
  updateSubmittal: jest.fn(),
  deleteSubmittal: jest.fn(),
};
const mockNcrService = {
  listNcrs: jest.fn(),
  createNcr: jest.fn(),
  updateNcr: jest.fn(),
  deleteNcr: jest.fn(),
};
const mockSafetyService = {
  listSafetyIncidents: jest.fn(),
  createSafetyIncident: jest.fn(),
  updateSafetyIncident: jest.fn(),
  deleteSafetyIncident: jest.fn(),
};

jest.mock("../../services/schedule.service", () => mockScheduleService);
jest.mock("../../services/activity.service", () => mockActivityService);
jest.mock("../../services/cost.service", () => mockCostService);
jest.mock("../../services/procurement.service", () => mockProcurementService);
jest.mock("../../services/material.service", () => mockMaterialService);
jest.mock("../../services/ipc.service", () => mockIpcService);
jest.mock("../../services/user.service", () => mockUserService);
jest.mock("../../services/subscription.service", () => ({
  ensureSubscription: jest.fn().mockResolvedValue({
    id: "sub-1",
    orgId: "org-1",
    plan: "enterprise",
    status: "active",
  }),
  isExpired: jest.fn(() => false),
}));
jest.mock("../../services/daily-report.service", () => mockDailyReportService);
jest.mock("../../services/site-diary.service", () => mockSiteDiaryService);
jest.mock("../../services/rfi.service", () => mockRfiService);
jest.mock("../../services/submittal.service", () => mockSubmittalService);
jest.mock("../../services/ncr.service", () => mockNcrService);
jest.mock("../../services/safety.service", () => mockSafetyService);

const scheduleRouter = require("../schedule");
const activitiesRouter = require("../activities");
const costRouter = require("../cost");
const procurementRouter = require("../procurement");
const ipcRouter = require("../ipc");
const usersRouter = require("../users");
const dailyReportsRouter = require("../daily-reports");
const siteDiariesRouter = require("../site-diaries");
const rfiRouter = require("../rfi");
const submittalsRouter = require("../submittals");
const ncrRouter = require("../ncr");
const safetyRouter = require("../safety");

const roles = [
  "pm",
  "planning_eng",
  "qs",
  "cost_controller",
  "procurement",
  "warehouse",
  "site_engineer",
  "finance",
];

const ids = {
  activity: "11111111-1111-4111-8111-111111111111",
  cost: "22222222-2222-4222-8222-222222222222",
  revision: "33333333-3333-4333-8333-333333333333",
  report: "44444444-4444-4444-8444-444444444444",
  diary: "55555555-5555-4555-8555-555555555555",
  rfi: "66666666-6666-4666-8666-666666666666",
  submittal: "77777777-7777-4777-8777-777777777777",
  ncr: "88888888-8888-4888-8888-888888888888",
  incident: "99999999-9999-4999-8999-999999999999",
  order: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  material: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  line: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  alert: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/projects/:projectId/schedule", scheduleRouter);
  app.use("/projects/:projectId/activities", activitiesRouter);
  app.use("/projects/:projectId/cost", costRouter);
  app.use("/projects/:projectId/procurement", procurementRouter);
  app.use("/projects/:projectId/ipc", ipcRouter);
  app.use("/projects/:projectId/daily-reports", dailyReportsRouter);
  app.use("/projects/:projectId/site-diaries", siteDiariesRouter);
  app.use("/projects/:projectId/rfi", rfiRouter);
  app.use("/projects/:projectId/submittals", submittalsRouter);
  app.use("/projects/:projectId/ncr", ncrRouter);
  app.use("/projects/:projectId/safety", safetyRouter);
  app.use("/users", usersRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: {
        code: err.code || "INTERNAL_ERROR",
        message: err.message,
        details: err.details,
      },
    }),
  );
  return app;
}

function buildProjectRoleApp(projectRole) {
  const app = express();
  app.use(express.json());
  app.use(
    "/projects/:projectId/daily-reports",
    (req, _res, next) => {
      req.projectAccess = {
        id: req.params.projectId,
        role: projectRole,
      };
      next();
    },
    dailyReportsRouter,
  );
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: {
        code: err.code || "INTERNAL_ERROR",
        message: err.message,
        details: err.details,
      },
    }),
  );
  return app;
}

const routeSpecs = [
  {
    name: "schedule revision approval",
    method: "post",
    path: `/projects/project-1/schedule/revisions/${ids.revision}/approve`,
    body: { comment: "Approved" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockScheduleService.approveRevision,
    response: { id: ids.revision, status: "approved" },
  },
  {
    name: "progress submission",
    method: "post",
    path: `/projects/project-1/activities/${ids.activity}/progress`,
    body: { pctComplete: 25, method: "percent" },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 200,
    mock: mockActivityService.updateProgress,
    response: { id: "submission-1", status: "submitted" },
  },
  {
    name: "IPC certification",
    method: "post",
    path: "/projects/project-1/ipc/IPC-001/certify",
    body: {},
    allowed: ["pm", "finance"],
    expectedStatus: 200,
    mock: mockIpcService.certifyIpcPeriod,
    response: { period: "IPC-001", status: "certified" },
  },
  {
    name: "IPC invoice issue",
    method: "post",
    path: "/projects/project-1/ipc/IPC-001/invoice/issue",
    body: { invoiceNumber: "INV-001" },
    allowed: ["pm", "finance"],
    expectedStatus: 201,
    mock: mockIpcService.issueIpcInvoice,
    response: { invoiceNumber: "INV-001", status: "issued" },
  },
  {
    name: "IPC payment receipt",
    method: "post",
    path: "/projects/project-1/ipc/IPC-001/payments",
    body: { amount: 950, paymentReference: "BANK-001" },
    allowed: ["pm", "finance"],
    expectedStatus: 201,
    mock: mockIpcService.recordIpcPayment,
    response: { payment: { paymentReference: "BANK-001", amount: 950 } },
  },
  {
    name: "IPC retention release",
    method: "post",
    path: "/projects/project-1/ipc/IPC-001/retention-release",
    body: { amount: 50, releaseReference: "RET-001" },
    allowed: ["pm", "finance"],
    expectedStatus: 201,
    mock: mockIpcService.releaseIpcRetention,
    response: { release: { releaseReference: "RET-001", amount: 50 } },
  },
  {
    name: "cost update",
    method: "patch",
    path: `/projects/project-1/cost/${ids.cost}`,
    body: { actual: 1200, actualThroughDate: "2026-01-31" },
    allowed: ["pm", "qs", "cost_controller"],
    expectedStatus: 200,
    mock: mockCostService.updateCostRecord,
    response: { id: ids.cost, actual: 1200 },
  },
  {
    name: "purchase order issue",
    method: "post",
    path: "/projects/project-1/procurement/purchase-orders",
    body: {
      ref: "PO-001",
      item: "Switchgear package",
      lines: [
        {
          activityId: ids.activity,
          description: "Switchgear",
          unit: "PCS",
          orderedQty: 1,
          unitCost: 1000,
        },
      ],
    },
    allowed: ["pm", "procurement"],
    expectedStatus: 201,
    mock: mockProcurementService.createPurchaseOrder,
    response: { id: ids.order, ref: "PO-001" },
  },
  {
    name: "delivery receipt post",
    method: "post",
    path: `/projects/project-1/procurement/purchase-orders/${ids.order}/receipts`,
    body: {
      receiptNumber: "GRN-001",
      lines: [{ poLineId: ids.line, acceptedQty: 1, issuedQty: 1 }],
    },
    allowed: ["pm", "procurement", "warehouse"],
    expectedStatus: 201,
    mock: mockProcurementService.recordDeliveryReceipt,
    response: { receipt: { receiptNumber: "GRN-001" } },
  },
  {
    name: "activity material usage",
    method: "post",
    path: `/projects/project-1/activities/${ids.activity}/materials/${ids.material}/usage`,
    body: { usedQty: 1, wasteQty: 0 },
    allowed: ["pm", "warehouse", "site_engineer"],
    expectedStatus: 201,
    mock: mockMaterialService.recordMaterialUsage,
    response: { usage: { id: "usage-1", usedQty: 1 } },
  },
  {
    name: "lead-time alert acknowledgement",
    method: "patch",
    path: `/projects/project-1/procurement/lead-time-alerts/${ids.alert}`,
    body: { status: "acknowledged" },
    allowed: ["pm", "planning_eng", "procurement", "warehouse"],
    expectedStatus: 200,
    mock: mockProcurementService.updateLeadTimeAlert,
    response: { id: ids.alert, status: "acknowledged" },
  },
  {
    name: "user creation",
    method: "post",
    path: "/users",
    body: {
      name: "Project Engineer",
      email: "project.engineer@example.com",
      password: "Password1",
      role: "site_engineer",
    },
    allowed: ["pm"],
    expectedStatus: 201,
    mock: mockUserService.createUser,
    response: { id: "new-user", role: "site_engineer" },
  },
  {
    name: "daily report submission",
    method: "post",
    path: "/projects/project-1/daily-reports",
    body: {
      activityId: ids.activity,
      date: "2026-01-01",
      status: "submitted",
    },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 201,
    mock: mockDailyReportService.createDailyReport,
    response: { id: ids.report, status: "submitted" },
  },
  {
    name: "daily report update",
    method: "patch",
    path: `/projects/project-1/daily-reports/${ids.report}`,
    body: { pctProgress: 35 },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 200,
    mock: mockDailyReportService.updateDailyReport,
    response: { id: ids.report, status: "draft", pctProgress: 35 },
  },
  {
    name: "daily report approval",
    method: "post",
    path: `/projects/project-1/daily-reports/${ids.report}/approve`,
    body: {},
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockDailyReportService.approveDailyReport,
    response: { id: ids.report, status: "approved" },
  },
  {
    name: "site diary submission",
    method: "post",
    path: "/projects/project-1/site-diaries",
    body: { date: "2026-01-01", workers: 10, status: "submitted" },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 201,
    mock: mockSiteDiaryService.createSiteDiary,
    response: { id: ids.diary, status: "submitted" },
  },
  {
    name: "site diary approval",
    method: "post",
    path: `/projects/project-1/site-diaries/${ids.diary}/approve`,
    body: {},
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockSiteDiaryService.approveSiteDiary,
    response: { id: ids.diary, status: "approved" },
  },
  {
    name: "RFI creation",
    method: "post",
    path: "/projects/project-1/rfi",
    body: { subject: "Confirm embed plate detail" },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 201,
    mock: mockRfiService.createRfi,
    response: { id: ids.rfi, subject: "Confirm embed plate detail" },
  },
  {
    name: "RFI update",
    method: "patch",
    path: `/projects/project-1/rfi/${ids.rfi}`,
    body: { status: "answered" },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 200,
    mock: mockRfiService.updateRfi,
    response: { id: ids.rfi, status: "answered" },
  },
  {
    name: "RFI deletion",
    method: "delete",
    path: `/projects/project-1/rfi/${ids.rfi}`,
    body: {},
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockRfiService.deleteRfi,
    response: { deleted: true },
  },
  {
    name: "submittal creation",
    method: "post",
    path: "/projects/project-1/submittals",
    body: { title: "Concrete mix design" },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 201,
    mock: mockSubmittalService.createSubmittal,
    response: { id: ids.submittal, title: "Concrete mix design" },
  },
  {
    name: "submittal update",
    method: "patch",
    path: `/projects/project-1/submittals/${ids.submittal}`,
    body: { status: "under_review" },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 200,
    mock: mockSubmittalService.updateSubmittal,
    response: { id: ids.submittal, status: "under_review" },
  },
  {
    name: "submittal deletion",
    method: "delete",
    path: `/projects/project-1/submittals/${ids.submittal}`,
    body: {},
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockSubmittalService.deleteSubmittal,
    response: { deleted: true },
  },
  {
    name: "NCR creation",
    method: "post",
    path: "/projects/project-1/ncr",
    body: { severity: "major" },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 201,
    mock: mockNcrService.createNcr,
    response: { id: ids.ncr, severity: "major" },
  },
  {
    name: "NCR update",
    method: "patch",
    path: `/projects/project-1/ncr/${ids.ncr}`,
    body: { status: "closed" },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 200,
    mock: mockNcrService.updateNcr,
    response: { id: ids.ncr, status: "closed" },
  },
  {
    name: "NCR deletion",
    method: "delete",
    path: `/projects/project-1/ncr/${ids.ncr}`,
    body: {},
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockNcrService.deleteNcr,
    response: { deleted: true },
  },
  {
    name: "safety incident creation",
    method: "post",
    path: "/projects/project-1/safety",
    body: {
      title: "Near miss at crane swing radius",
      incidentType: "near_miss",
    },
    allowed: ["pm", "site_engineer"],
    expectedStatus: 201,
    mock: mockSafetyService.createSafetyIncident,
    response: { id: ids.incident, incidentType: "near_miss" },
  },
  {
    name: "safety incident update",
    method: "patch",
    path: `/projects/project-1/safety/${ids.incident}`,
    body: { status: "investigating" },
    allowed: ["pm", "site_engineer"],
    expectedStatus: 200,
    mock: mockSafetyService.updateSafetyIncident,
    response: { id: ids.incident, status: "investigating" },
  },
  {
    name: "safety incident deletion",
    method: "delete",
    path: `/projects/project-1/safety/${ids.incident}`,
    body: {},
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockSafetyService.deleteSafetyIncident,
    response: { deleted: true },
  },
];

describe("module/action route permissions", () => {
  it.each(
    routeSpecs.flatMap((spec) =>
      roles.map((role) => ({
        role,
        spec,
        expectedAllowed: spec.allowed.includes(role),
      })),
    ),
  )("$role -> $spec.name", async ({ role, spec, expectedAllowed }) => {
    jest.clearAllMocks();
    spec.mock.mockResolvedValue(spec.response);

    const res = await request(buildApp())
      [spec.method](spec.path)
      .set("x-role", role)
      .send(spec.body);

    if (expectedAllowed) {
      expect(res.status).toBe(spec.expectedStatus);
      expect(spec.mock).toHaveBeenCalledTimes(1);
      return;
    }

    expect(res.status).toBe(403);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: "FORBIDDEN",
          message: "You do not have permission for this action",
        }),
      }),
    );
    expect(spec.mock).not.toHaveBeenCalled();
  });

  it("rejects over-precise monetary input before service persistence", async () => {
    jest.clearAllMocks();

    const res = await request(buildApp())
      .patch(`/projects/project-1/cost/${ids.cost}`)
      .set("x-role", "cost_controller")
      .send({ actual: 1200.999 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: "VALIDATION_ERROR",
        }),
      }),
    );
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "actual",
          message: expect.stringContaining("at most 2 decimal places"),
        }),
      ]),
    );
    expect(mockCostService.updateCostRecord).not.toHaveBeenCalled();
  });

  it("rejects invalid cost actual-through dates before service persistence", async () => {
    jest.clearAllMocks();

    const res = await request(buildApp())
      .patch(`/projects/project-1/cost/${ids.cost}`)
      .set("x-role", "cost_controller")
      .send({ actual: 1200, actualThroughDate: "not-a-date" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: "VALIDATION_ERROR",
        }),
      }),
    );
    expect(mockCostService.updateCostRecord).not.toHaveBeenCalled();
  });

  it("uses the project assignment role for module permissions when present", async () => {
    jest.clearAllMocks();
    mockDailyReportService.approveDailyReport.mockResolvedValue({
      id: ids.report,
      status: "approved",
    });

    const res = await request(buildProjectRoleApp("pm"))
      .post(`/projects/project-1/daily-reports/${ids.report}/approve`)
      .set("x-role", "site_engineer")
      .send({});

    expect(res.status).toBe(200);
    expect(mockDailyReportService.approveDailyReport).toHaveBeenCalledTimes(1);
  });

  it("rejects non-PM project assignment roles for daily report final approval", async () => {
    jest.clearAllMocks();
    mockDailyReportService.approveDailyReport.mockResolvedValue({
      id: ids.report,
      status: "approved",
    });

    const res = await request(buildProjectRoleApp("qs"))
      .post(`/projects/project-1/daily-reports/${ids.report}/approve`)
      .set("x-role", "site_engineer")
      .send({});

    expect(res.status).toBe(403);
    expect(mockDailyReportService.approveDailyReport).not.toHaveBeenCalled();
  });
});
