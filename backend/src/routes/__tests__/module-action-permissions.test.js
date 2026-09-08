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
const mockGoodsReceiptService = { receiveAgainstOrder: jest.fn() };
const mockProcurementService = {
  createPurchaseOrder: jest.fn(),
  // Delivery receipts are written by goods-receipt.service now; the
  // procurement route delegates to it, so that is what this asserts against.
  syncLeadTimeAlert: jest.fn(),
  acknowledgeLeadTimeAlert: jest.fn(),
  resolveLeadTimeAlert: jest.fn(),
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
  inviteUser: jest.fn(),
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
  submitRfi: jest.fn(),
  answerRfi: jest.fn(),
  closeRfi: jest.fn(),
  reopenRfi: jest.fn(),
  approveRfi: jest.fn(),
  rejectRfi: jest.fn(),
  deleteRfi: jest.fn(),
};
const mockSubmittalService = {
  listSubmittals: jest.fn(),
  createSubmittal: jest.fn(),
  updateSubmittal: jest.fn(),
  submitSubmittal: jest.fn(),
  reviewSubmittal: jest.fn(),
  resubmitSubmittal: jest.fn(),
  approveSubmittal: jest.fn(),
  rejectSubmittal: jest.fn(),
  deleteSubmittal: jest.fn(),
};
const mockNcrService = {
  listNcrs: jest.fn(),
  createNcr: jest.fn(),
  updateNcr: jest.fn(),
  submitNcrCloseout: jest.fn(),
  closeNcr: jest.fn(),
  approveNcr: jest.fn(),
  rejectNcr: jest.fn(),
  reopenNcr: jest.fn(),
  deleteNcr: jest.fn(),
};
const mockSafetyService = {
  listSafetyIncidents: jest.fn(),
  createSafetyIncident: jest.fn(),
  updateSafetyIncident: jest.fn(),
  submitSafetyCloseout: jest.fn(),
  closeSafetyIncident: jest.fn(),
  approveSafetyIncident: jest.fn(),
  rejectSafetyIncident: jest.fn(),
  reopenSafetyIncident: jest.fn(),
  deleteSafetyIncident: jest.fn(),
};
const mockRiskService = {
  listRisks: jest.fn(),
  createRisk: jest.fn(),
  updateRisk: jest.fn(),
  submitRiskCloseout: jest.fn(),
  approveRiskCloseout: jest.fn(),
  rejectRiskCloseout: jest.fn(),
  reopenRisk: jest.fn(),
  deleteRisk: jest.fn(),
};
const mockMeetingService = {
  MEETING_STATUSES: ["draft", "finalized", "distributed", "archived"],
  MEETING_TYPES: [
    "coordination",
    "progress",
    "commercial",
    "quality",
    "safety",
    "design",
    "client",
    "other",
  ],
  ATTENDANCE_STATUSES: ["invited", "attended", "absent", "apology"],
  AGENDA_STATUSES: ["open", "covered", "deferred"],
  ACTION_STATUSES: ["open", "in_progress", "closed", "canceled"],
  ACTION_PRIORITIES: ["low", "medium", "high", "critical"],
  listMeetings: jest.fn(),
  createMeeting: jest.fn(),
  updateMeeting: jest.fn(),
  distributeMeeting: jest.fn(),
  addMeetingComment: jest.fn(),
  deleteMeeting: jest.fn(),
  getMeetingById: jest.fn(),
};
const mockTaskService = {
  TASK_STATUSES: [
    "todo",
    "in_progress",
    "blocked",
    "done",
    "canceled",
    "archived",
  ],
  TASK_PRIORITIES: ["low", "medium", "high", "critical"],
  TASK_LABELS: [
    "action",
    "field",
    "procurement",
    "quality",
    "safety",
    "commercial",
    "document",
  ],
  listTasks: jest.fn(),
  createTask: jest.fn(),
  updateTask: jest.fn(),
  closeTask: jest.fn(),
  addTaskComment: jest.fn(),
  deleteTask: jest.fn(),
};
const mockChangeOrderService = {
  submitChangeOrder: jest.fn(),
  approveChangeOrder: jest.fn(),
  rejectChangeOrder: jest.fn(),
  reopenChangeOrder: jest.fn(),
};
const mockEotService = {
  submitEotClaim: jest.fn(),
  approveEotClaim: jest.fn(),
  rejectEotClaim: jest.fn(),
};
const mockDocControlService = {
  getDocControlDashboard: jest.fn(),
  listDocumentRegister: jest.fn(),
  uploadDocumentRevision: jest.fn(),
  submitDocumentRevisionForReview: jest.fn(),
  approveDocumentRevision: jest.fn(),
  supersedeDocumentRevision: jest.fn(),
  getRevisionDownloadFile: jest.fn(),
  getRevisionPreviewFile: jest.fn(),
};

jest.mock("../../services/schedule.service", () => mockScheduleService);
jest.mock("../../services/activity.service", () => mockActivityService);
jest.mock("../../services/cost.service", () => mockCostService);
jest.mock("../../services/procurement.service", () => mockProcurementService);
jest.mock("../../services/goods-receipt.service", () => mockGoodsReceiptService);
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
jest.mock("../../services/risk.service", () => mockRiskService);
jest.mock("../../services/meeting.service", () => mockMeetingService);
jest.mock("../../services/task.service", () => mockTaskService);
jest.mock("../../services/change-order.service", () => mockChangeOrderService);
jest.mock("../../services/eot.service", () => mockEotService);
jest.mock("../../services/doc-control.service", () => mockDocControlService);

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
const riskRouter = require("../risks");
const meetingRouter = require("../meetings");
const taskRouter = require("../tasks");
const changeOrdersRouter = require("../change-orders");
const eotRouter = require("../eot");
const docControlRouter = require("../doc-control");

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
  warehouse: "11111111-1111-4111-8111-111111111112",
  cost: "22222222-2222-4222-8222-222222222222",
  revision: "33333333-3333-4333-8333-333333333333",
  report: "44444444-4444-4444-8444-444444444444",
  diary: "55555555-5555-4555-8555-555555555555",
  rfi: "66666666-6666-4666-8666-666666666666",
  submittal: "77777777-7777-4777-8777-777777777777",
  ncr: "88888888-8888-4888-8888-888888888888",
  incident: "99999999-9999-4999-8999-999999999999",
  risk: "99999999-9999-4999-8999-999999999998",
  meeting: "99999999-9999-4999-8999-999999999996",
  task: "99999999-9999-4999-8999-999999999997",
  order: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  changeOrder: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  eotClaim: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  documentRevision: "12345678-1234-4234-8234-123456789abc",
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
  app.use("/projects/:projectId/risks", riskRouter);
  app.use("/projects/:projectId/meetings", meetingRouter);
  app.use("/projects/:projectId/tasks", taskRouter);
  app.use("/projects/:projectId/change-orders", changeOrdersRouter);
  app.use("/projects/:projectId/eot", eotRouter);
  app.use("/projects/:projectId/doc-control", docControlRouter);
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
  const attachProjectRole = (req, _res, next) => {
    req.projectAccess = {
      id: req.params.projectId,
      role: projectRole,
    };
    next();
  };
  app.use("/projects/:projectId/schedule", attachProjectRole, scheduleRouter);
  app.use(
    "/projects/:projectId/daily-reports",
    attachProjectRole,
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

function buildProjectPartyApp(partyRole) {
  const app = express();
  app.use(express.json());
  const attachProjectParty = (req, _res, next) => {
    req.projectAccess = {
      id: req.params.projectId,
      role: "external_party",
      assignmentRole: null,
      scope: "party",
      partyAccess: [
        {
          projectPartyId: "99999999-9999-4999-8999-999999999997",
          companyId: "99999999-9999-4999-8999-999999999996",
          companyName: "Consultant Co",
          role: partyRole,
          accessLevel: "reviewer",
          permissionProfile: `default_${partyRole}`,
        },
      ],
    };
    next();
  };
  app.use("/projects/:projectId/rfi", attachProjectParty, rfiRouter);
  app.use("/projects/:projectId/meetings", attachProjectParty, meetingRouter);
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
    allowed: ["finance"],
    expectedStatus: 201,
    mock: mockIpcService.recordIpcPayment,
    response: { payment: { paymentReference: "BANK-001", amount: 950 } },
  },
  {
    name: "IPC retention release",
    method: "post",
    path: "/projects/project-1/ipc/IPC-001/retention-release",
    body: { amount: 50, releaseReference: "RET-001" },
    allowed: ["finance"],
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
      warehouseId: ids.warehouse,
      lines: [{ poLineId: ids.line, acceptedQty: 1, issuedQty: 1 }],
    },
    allowed: ["pm", "procurement", "warehouse"],
    expectedStatus: 201,
    mock: mockGoodsReceiptService.receiveAgainstOrder,
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
    path: `/projects/project-1/procurement/lead-time-alerts/${ids.alert}/acknowledge`,
    body: { note: "Expediting with supplier" },
    allowed: ["pm", "planning_eng", "procurement", "warehouse"],
    expectedStatus: 200,
    mock: mockProcurementService.acknowledgeLeadTimeAlert,
    response: { id: ids.alert, status: "acknowledged" },
  },
  {
    name: "lead-time alert resolution",
    method: "patch",
    path: `/projects/project-1/procurement/lead-time-alerts/${ids.alert}/resolve`,
    body: { note: "Recovered before latest order date" },
    allowed: ["pm", "planning_eng", "procurement", "warehouse"],
    expectedStatus: 200,
    mock: mockProcurementService.resolveLeadTimeAlert,
    response: { id: ids.alert, status: "resolved" },
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
    name: "user invitation",
    method: "post",
    path: "/users/invitations",
    body: {
      email: "invited.engineer@example.com",
      role: "site_engineer",
      note: "Join the project team",
    },
    allowed: ["pm"],
    expectedStatus: 201,
    mock: mockUserService.inviteUser,
    response: { id: "invite-1", status: "pending" },
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
    name: "RFI submission",
    method: "post",
    path: `/projects/project-1/rfi/${ids.rfi}/submit`,
    body: { comment: "Ready for consultant response" },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 200,
    mock: mockRfiService.submitRfi,
    response: { id: ids.rfi, status: "open" },
  },
  {
    name: "RFI answer",
    method: "post",
    path: `/projects/project-1/rfi/${ids.rfi}/answer`,
    body: { response: "Use detail S-401/3" },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 200,
    mock: mockRfiService.answerRfi,
    response: { id: ids.rfi, status: "answered" },
  },
  {
    name: "RFI approval",
    method: "post",
    path: `/projects/project-1/rfi/${ids.rfi}/approve`,
    body: { comment: "Response accepted" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockRfiService.approveRfi,
    response: { id: ids.rfi, status: "closed" },
  },
  {
    name: "RFI close",
    method: "post",
    path: `/projects/project-1/rfi/${ids.rfi}/close`,
    body: { comment: "PM closeout accepted" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockRfiService.closeRfi,
    response: { id: ids.rfi, status: "closed" },
  },
  {
    name: "RFI reopen",
    method: "post",
    path: `/projects/project-1/rfi/${ids.rfi}/reopen`,
    body: { reason: "Response no longer matches field condition" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockRfiService.reopenRfi,
    response: { id: ids.rfi, status: "open" },
  },
  {
    name: "RFI rejection",
    method: "post",
    path: `/projects/project-1/rfi/${ids.rfi}/reject`,
    body: { reason: "Response does not answer the question" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockRfiService.rejectRfi,
    response: { id: ids.rfi, status: "open" },
  },
  {
    name: "RFI archive",
    method: "delete",
    path: `/projects/project-1/rfi/${ids.rfi}`,
    body: {},
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockRfiService.deleteRfi,
    response: {
      id: ids.rfi,
      status: "archived",
      archived: true,
      deleted: false,
    },
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
    name: "submittal submission",
    method: "post",
    path: `/projects/project-1/submittals/${ids.submittal}/submit`,
    body: { revision: "A", comment: "Ready for review" },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 200,
    mock: mockSubmittalService.submitSubmittal,
    response: { id: ids.submittal, status: "under_review" },
  },
  {
    name: "submittal review",
    method: "post",
    path: `/projects/project-1/submittals/${ids.submittal}/review`,
    body: { comment: "Consultant review comments recorded" },
    allowed: ["pm", "planning_eng", "qs"],
    expectedStatus: 200,
    mock: mockSubmittalService.reviewSubmittal,
    response: { id: ids.submittal, status: "under_review" },
  },
  {
    name: "submittal resubmit",
    method: "post",
    path: `/projects/project-1/submittals/${ids.submittal}/resubmit`,
    body: { revision: "B", comment: "Revised package uploaded" },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 200,
    mock: mockSubmittalService.resubmitSubmittal,
    response: { id: ids.submittal, status: "under_review" },
  },
  {
    name: "submittal approval",
    method: "post",
    path: `/projects/project-1/submittals/${ids.submittal}/approve`,
    body: { comment: "Approved for construction" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockSubmittalService.approveSubmittal,
    response: { id: ids.submittal, status: "approved" },
  },
  {
    name: "submittal rejection",
    method: "post",
    path: `/projects/project-1/submittals/${ids.submittal}/reject`,
    body: { reason: "Revise mix design" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockSubmittalService.rejectSubmittal,
    response: { id: ids.submittal, status: "rejected" },
  },
  {
    name: "submittal archive",
    method: "delete",
    path: `/projects/project-1/submittals/${ids.submittal}`,
    body: {},
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockSubmittalService.deleteSubmittal,
    response: {
      id: ids.submittal,
      status: "archived",
      archived: true,
      deleted: false,
    },
  },
  {
    name: "document register",
    method: "get",
    path: "/projects/project-1/doc-control/register",
    body: {},
    allowed: roles,
    expectedStatus: 200,
    mock: mockDocControlService.listDocumentRegister,
    response: { rows: [], summary: { records: 0 } },
  },
  {
    name: "document revision upload",
    method: "post",
    path: `/projects/project-1/doc-control/rfi/${ids.rfi}/revisions`,
    body: { revision: "B", projectDocumentId: ids.documentRevision },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 201,
    mock: mockDocControlService.uploadDocumentRevision,
    response: { id: ids.documentRevision, revision: "B", status: "uploaded" },
  },
  {
    name: "document revision approval",
    method: "post",
    path: `/projects/project-1/doc-control/revisions/${ids.documentRevision}/approve`,
    body: { comment: "Approved for use" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockDocControlService.approveDocumentRevision,
    response: { id: ids.documentRevision, revision: "B", status: "approved" },
  },
  {
    name: "document revision submit for review",
    method: "post",
    path: `/projects/project-1/doc-control/revisions/${ids.documentRevision}/submit-review`,
    body: { comment: "Ready for review" },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 200,
    mock: mockDocControlService.submitDocumentRevisionForReview,
    response: { id: ids.documentRevision, revision: "B", status: "submitted" },
  },
  {
    name: "document revision supersede",
    method: "post",
    path: `/projects/project-1/doc-control/revisions/${ids.documentRevision}/supersede`,
    body: { reason: "Revision C replaces this issue" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockDocControlService.supersedeDocumentRevision,
    response: {
      id: ids.documentRevision,
      revision: "B",
      status: "superseded",
    },
  },
  {
    name: "document revision download",
    method: "get",
    path: `/projects/project-1/doc-control/revisions/${ids.documentRevision}/download`,
    body: {},
    allowed: roles,
    expectedStatus: 302,
    mock: mockDocControlService.getRevisionDownloadFile,
    response: { redirectUrl: "https://example.com/private-revision" },
  },
  {
    name: "document revision preview",
    method: "get",
    path: `/projects/project-1/doc-control/revisions/${ids.documentRevision}/preview`,
    body: {},
    allowed: roles,
    expectedStatus: 302,
    mock: mockDocControlService.getRevisionPreviewFile,
    response: { redirectUrl: "https://example.com/private-revision-preview" },
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
    body: { severity: "minor" },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 200,
    mock: mockNcrService.updateNcr,
    response: { id: ids.ncr, severity: "minor" },
  },
  {
    name: "NCR closeout submission",
    method: "post",
    path: `/projects/project-1/ncr/${ids.ncr}/close`,
    body: {
      responsible: "Site QA Lead",
      dueDate: "2026-01-15",
      closureComment: "Corrective action complete",
      attachmentRefs: [{ fileName: "ncr-closeout.pdf", fileUrl: "/files/1" }],
    },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 200,
    mock: mockNcrService.closeNcr,
    response: { id: ids.ncr, status: "submitted" },
  },
  {
    name: "NCR approval",
    method: "post",
    path: `/projects/project-1/ncr/${ids.ncr}/approve`,
    body: { comment: "Corrective action accepted" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockNcrService.approveNcr,
    response: { id: ids.ncr, status: "closed" },
  },
  {
    name: "NCR rejection",
    method: "post",
    path: `/projects/project-1/ncr/${ids.ncr}/reject`,
    body: { reason: "Corrective action incomplete" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockNcrService.rejectNcr,
    response: { id: ids.ncr, status: "open" },
  },
  {
    name: "NCR reopen",
    method: "post",
    path: `/projects/project-1/ncr/${ids.ncr}/reopen`,
    body: { reason: "Recurring issue found during surveillance" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockNcrService.reopenNcr,
    response: { id: ids.ncr, status: "open" },
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
    name: "safety closeout submission",
    method: "post",
    path: `/projects/project-1/safety/${ids.incident}/close`,
    body: {
      responsible: "Safety Officer",
      dueDate: "2026-01-15",
      closureComment: "Toolbox talk and barricade evidence uploaded",
      attachmentRefs: [
        { fileName: "safety-closeout.pdf", fileUrl: "/files/2" },
      ],
    },
    allowed: ["pm", "site_engineer"],
    expectedStatus: 200,
    mock: mockSafetyService.closeSafetyIncident,
    response: { id: ids.incident, status: "submitted" },
  },
  {
    name: "safety incident approval",
    method: "post",
    path: `/projects/project-1/safety/${ids.incident}/approve`,
    body: { comment: "Investigation accepted" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockSafetyService.approveSafetyIncident,
    response: { id: ids.incident, status: "closed" },
  },
  {
    name: "safety incident rejection",
    method: "post",
    path: `/projects/project-1/safety/${ids.incident}/reject`,
    body: { reason: "Investigation evidence incomplete" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockSafetyService.rejectSafetyIncident,
    response: { id: ids.incident, status: "investigating" },
  },
  {
    name: "safety incident reopen",
    method: "post",
    path: `/projects/project-1/safety/${ids.incident}/reopen`,
    body: { reason: "Corrective action failed during follow-up" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockSafetyService.reopenSafetyIncident,
    response: { id: ids.incident, status: "investigating" },
  },
  {
    name: "safety incident archive",
    method: "delete",
    path: `/projects/project-1/safety/${ids.incident}`,
    body: {},
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockSafetyService.deleteSafetyIncident,
    response: {
      id: ids.incident,
      status: "archived",
      archived: true,
      deleted: false,
    },
  },
  {
    name: "risk creation",
    method: "post",
    path: "/projects/project-1/risks",
    body: {
      description: "Late utility diversion may delay excavation",
      activityIds: [ids.activity],
    },
    allowed: ["pm", "planning_eng", "qs"],
    expectedStatus: 201,
    mock: mockRiskService.createRisk,
    response: { id: ids.risk, status: "open" },
  },
  {
    name: "risk update",
    method: "patch",
    path: `/projects/project-1/risks/${ids.risk}`,
    body: { owner: "Planning Lead", status: "monitoring" },
    allowed: ["pm", "planning_eng", "qs"],
    expectedStatus: 200,
    mock: mockRiskService.updateRisk,
    response: { id: ids.risk, status: "monitoring" },
  },
  {
    name: "risk closeout submission",
    method: "post",
    path: `/projects/project-1/risks/${ids.risk}/submit`,
    body: {
      dueDate: "2026-01-15",
      responsePlan: "Diversion permit confirmed",
      closeoutComment: "Mitigation complete",
    },
    allowed: ["pm", "planning_eng", "qs"],
    expectedStatus: 200,
    mock: mockRiskService.submitRiskCloseout,
    response: { id: ids.risk, status: "submitted" },
  },
  {
    name: "risk closeout approval",
    method: "post",
    path: `/projects/project-1/risks/${ids.risk}/approve`,
    body: { comment: "Accepted" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockRiskService.approveRiskCloseout,
    response: { id: ids.risk, status: "closed" },
  },
  {
    name: "risk closeout rejection",
    method: "post",
    path: `/projects/project-1/risks/${ids.risk}/reject`,
    body: { reason: "Residual risk still high" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockRiskService.rejectRiskCloseout,
    response: { id: ids.risk, status: "monitoring" },
  },
  {
    name: "risk reopen",
    method: "post",
    path: `/projects/project-1/risks/${ids.risk}/reopen`,
    body: { reason: "Utility authority changed permit date" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockRiskService.reopenRisk,
    response: { id: ids.risk, status: "monitoring" },
  },
  {
    name: "risk archive",
    method: "delete",
    path: `/projects/project-1/risks/${ids.risk}`,
    body: {},
    allowed: ["pm", "planning_eng"],
    expectedStatus: 200,
    mock: mockRiskService.deleteRisk,
    response: {
      id: ids.risk,
      status: "archived",
      archived: true,
      deleted: false,
    },
  },
  {
    name: "meeting creation",
    method: "post",
    path: "/projects/project-1/meetings",
    body: {
      title: "Weekly coordination",
      meetingType: "coordination",
      actionItems: [
        {
          title: "Confirm gate access",
          ownerName: "Site Engineer",
          dueDate: "2026-06-20",
        },
      ],
    },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 201,
    mock: mockMeetingService.createMeeting,
    response: { id: ids.meeting, meetingNumber: "MTG-0001", status: "draft" },
  },
  {
    name: "meeting update",
    method: "patch",
    path: `/projects/project-1/meetings/${ids.meeting}`,
    body: { minutesText: "Updated minutes", status: "finalized" },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 200,
    mock: mockMeetingService.updateMeeting,
    response: {
      id: ids.meeting,
      meetingNumber: "MTG-0001",
      status: "finalized",
    },
  },
  {
    name: "meeting distribution",
    method: "post",
    path: `/projects/project-1/meetings/${ids.meeting}/distribute`,
    body: { includeAttendees: true, message: "Issued for action" },
    allowed: ["pm", "planning_eng"],
    expectedStatus: 200,
    mock: mockMeetingService.distributeMeeting,
    response: { meeting: { id: ids.meeting, status: "distributed" } },
  },
  {
    name: "meeting comment",
    method: "post",
    path: `/projects/project-1/meetings/${ids.meeting}/comments`,
    body: { body: "Noted by consultant" },
    allowed: roles,
    expectedStatus: 201,
    mock: mockMeetingService.addMeetingComment,
    response: { id: "comment-1", meetingId: ids.meeting, body: "Noted" },
  },
  {
    name: "meeting archive",
    method: "delete",
    path: `/projects/project-1/meetings/${ids.meeting}`,
    body: {},
    allowed: ["pm", "planning_eng"],
    expectedStatus: 200,
    mock: mockMeetingService.deleteMeeting,
    response: {
      id: ids.meeting,
      status: "archived",
      archived: true,
      deleted: false,
    },
  },
  {
    name: "task creation",
    method: "post",
    path: "/projects/project-1/tasks",
    body: {
      title: "Confirm access before concrete pour",
      priority: "high",
      status: "todo",
    },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 201,
    mock: mockTaskService.createTask,
    response: { id: ids.task, taskNumber: "TSK-0001", status: "todo" },
  },
  {
    name: "task update",
    method: "patch",
    path: `/projects/project-1/tasks/${ids.task}`,
    body: { status: "in_progress", comment: "Started on site" },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 200,
    mock: mockTaskService.updateTask,
    response: { id: ids.task, taskNumber: "TSK-0001", status: "in_progress" },
  },
  {
    name: "task comment",
    method: "post",
    path: `/projects/project-1/tasks/${ids.task}/comments`,
    body: { body: "Waiting on gate pass confirmation" },
    allowed: roles,
    expectedStatus: 201,
    mock: mockTaskService.addTaskComment,
    response: { id: "comment-1", taskId: ids.task, body: "Waiting" },
  },
  {
    name: "task close",
    method: "post",
    path: `/projects/project-1/tasks/${ids.task}/close`,
    body: { comment: "Closed in field" },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 200,
    mock: mockTaskService.closeTask,
    response: { id: ids.task, taskNumber: "TSK-0001", status: "done" },
  },
  {
    name: "task archive",
    method: "delete",
    path: `/projects/project-1/tasks/${ids.task}`,
    body: {},
    allowed: ["pm", "planning_eng"],
    expectedStatus: 200,
    mock: mockTaskService.deleteTask,
    response: {
      id: ids.task,
      status: "archived",
      archived: true,
      deleted: false,
    },
  },
  {
    name: "change order submission",
    method: "post",
    path: `/projects/project-1/change-orders/${ids.changeOrder}/submit`,
    body: { comment: "Ready for PM review" },
    allowed: ["pm", "qs"],
    expectedStatus: 200,
    mock: mockChangeOrderService.submitChangeOrder,
    response: { id: ids.changeOrder, status: "pending" },
  },
  {
    name: "change order approval",
    method: "post",
    path: `/projects/project-1/change-orders/${ids.changeOrder}/approve`,
    body: { comment: "Commercial approval recorded" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockChangeOrderService.approveChangeOrder,
    response: { id: ids.changeOrder, status: "approved" },
  },
  {
    name: "change order rejection",
    method: "post",
    path: `/projects/project-1/change-orders/${ids.changeOrder}/reject`,
    body: { reason: "Insufficient entitlement evidence" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockChangeOrderService.rejectChangeOrder,
    response: { id: ids.changeOrder, status: "rejected" },
  },
  {
    name: "change order reopen",
    method: "post",
    path: `/projects/project-1/change-orders/${ids.changeOrder}/reopen`,
    body: { comment: "Rework requested evidence" },
    allowed: ["pm", "qs"],
    expectedStatus: 200,
    mock: mockChangeOrderService.reopenChangeOrder,
    response: { id: ids.changeOrder, status: "draft" },
  },
  {
    name: "EOT submission",
    method: "post",
    path: `/projects/project-1/eot/${ids.eotClaim}/submit`,
    body: { comment: "Claim package ready" },
    allowed: ["pm", "planning_eng", "qs"],
    expectedStatus: 200,
    mock: mockEotService.submitEotClaim,
    response: { id: ids.eotClaim, status: "submitted" },
  },
  {
    name: "EOT approval",
    method: "post",
    path: `/projects/project-1/eot/${ids.eotClaim}/approve`,
    body: { comment: "Critical path proof accepted" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockEotService.approveEotClaim,
    response: { id: ids.eotClaim, status: "approved" },
  },
  {
    name: "EOT rejection",
    method: "post",
    path: `/projects/project-1/eot/${ids.eotClaim}/reject`,
    body: { reason: "Delay analysis is incomplete" },
    allowed: ["pm"],
    expectedStatus: 200,
    mock: mockEotService.rejectEotClaim,
    response: { id: ids.eotClaim, status: "rejected" },
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

  it.each(routeSpecs.filter((spec) => spec.name.includes("rejection")))(
    "requires a reason before $name service execution",
    async (spec) => {
      jest.clearAllMocks();
      spec.mock.mockResolvedValue(spec.response);

      const res = await request(buildApp())
        [spec.method](spec.path)
        .set("x-role", "pm")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toEqual(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: "VALIDATION_ERROR",
          }),
        }),
      );
      expect(spec.mock).not.toHaveBeenCalled();
    },
  );

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

  it("uses canonical PM project assignment values for schedule approval", async () => {
    jest.clearAllMocks();
    mockScheduleService.approveRevision.mockResolvedValue({
      id: ids.revision,
      status: "approved",
    });

    const res = await request(buildProjectRoleApp("Project Manager"))
      .post(`/projects/project-1/schedule/revisions/${ids.revision}/approve`)
      .set("x-role", "site_engineer")
      .send({ comment: "Approved by project PM" });

    expect(res.status).toBe(200);
    expect(mockScheduleService.approveRevision).toHaveBeenCalledTimes(1);
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

  it("allows project-party scoped workflow actions without internal role escalation", async () => {
    jest.clearAllMocks();
    mockRfiService.answerRfi.mockResolvedValue({
      id: ids.rfi,
      status: "answered",
    });
    mockRfiService.closeRfi.mockResolvedValue({
      id: ids.rfi,
      status: "closed",
    });

    const app = buildProjectPartyApp("consultant");

    const answerRes = await request(app)
      .post(`/projects/project-1/rfi/${ids.rfi}/answer`)
      .set("x-role", "finance")
      .send({ response: "Use detail S-401/3" });

    expect(answerRes.status).toBe(200);
    expect(mockRfiService.answerRfi).toHaveBeenCalledWith(
      expect.objectContaining({
        userRole: "external_party",
        projectAccess: expect.objectContaining({
          scope: "party",
        }),
      }),
    );

    const closeRes = await request(app)
      .post(`/projects/project-1/rfi/${ids.rfi}/close`)
      .set("x-role", "finance")
      .send({ comment: "Trying to close" });

    expect(closeRes.status).toBe(403);
    expect(mockRfiService.closeRfi).not.toHaveBeenCalled();
  });
});
