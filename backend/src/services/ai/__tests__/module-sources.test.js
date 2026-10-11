jest.mock("../../../config/db", () => ({ prisma: { project: { findFirst: jest.fn(async () => ({ name: "Riverside Tower", dataDate: null })) }, activity: { findMany: jest.fn() } } }));
jest.mock("../../../middleware/rbac", () => ({ hasPermission: jest.fn(), getEffectiveRole: jest.fn(() => "pm") }));
jest.mock("../../cost.service", () => ({ getCostSummary: jest.fn(async () => ({ totals: { budget: 100, committed: 90, actual: 120, forecast: 130 }, budget: {}, eac: {}, records: [] })) }));
jest.mock("../../change-order.service", () => ({ listChangeOrders: jest.fn(async () => ({ orders: [{ id: "co1", ref: "VO-02", status: "pending", description: "Drainage", value: 96500, scheduleImpact: 0 }, { id: "co2", ref: "VO-01", status: "approved", description: "Glazing", value: 185000, scheduleImpact: 5 }] })) }));
jest.mock("../../change-event.service", () => ({ listChangeEvents: jest.fn(async () => ({ items: [], summary: { count: 0 } })) }));
jest.mock("../../exception.service", () => ({ changeEventAnswerFor: jest.fn(async ({ answer }) => answer) }));
jest.mock("../sources/workspace-snapshot", () => ({ authorizedWorkspaceDashboard: jest.fn(async () => ({ workflowQueues: [{ key: "procurementRisks", count: 1, items: [{ projectId: "11111111-1111-4111-8111-111111111111", title: "Glazing panel", severity: "critical", meta: "order by missed" }] }] })) }));
jest.mock("../../procurement.service", () => ({ getProcurementOverview: jest.fn(async () => ({ orders: [{ ref: "PO-0001", item: "Formwork", supplier: "Riverstone", status: "issued" }], suppliers: [], packages: [] })), listLeadTimeAlerts: jest.fn(async () => []) }));
jest.mock("../../long-lead.service", () => ({ listLongLeadItems: jest.fn(async () => []) }));
jest.mock("../../bid.service", () => ({ listPackages: jest.fn(async () => [{ id: "pk1", ref: "BP-01", title: "Facade", status: "open" }]), leveling: jest.fn(async () => ({ estimateTotal: 100, bidders: [{ companyName: "Acme", total: 90, normalizedTotal: 95, pluggedLines: 1, status: "submitted" }] })) }));
jest.mock("../../inventory-analytics.service", () => ({ getAnalytics: jest.fn(async () => ({ headline: { totalValue: 56988.03, itemCount: 6, lowStock: 1 }, byWarehouse: [], lowStock: [{ sku: "SLC-PU25", name: "Polyurethane joint sealant", onHand: 24, reorderLevel: 60, shortfall: 36 }], outOfStock: [], overstock: [] })) }));
jest.mock("../../quality.service", () => ({ getQualityDashboard: jest.fn(async () => ({ metrics: { qualityScore: 92, majorNcrs: 0, minorNcrs: 1, failedItps: 0, openDefects: 0, testsPassed: 0, testsFailed: 0, overdue: 1 } })) }));
jest.mock("../../ncr.service", () => ({ listNcrs: jest.fn(async () => ({ rows: [{ id: "n1", ref: "NCR-001", severity: "minor", status: "open", activityId: "a1", description: "Cover to reinforcement 18mm" }] })) }));
jest.mock("../../itp.service", () => ({ listItps: jest.fn(async () => ({ rows: [{ id: "i1", ref: "ITP-003", title: "Riser first fix", pointType: "hold", status: "pending", activityId: "a2" }] })) }));
jest.mock("../../punch.service", () => ({ listPunchItems: jest.fn(async () => ({ items: [] })) }));
jest.mock("../../submittal.service", () => ({ listSubmittals: jest.fn(async () => ({ rows: [{ id: "s1", ref: "SUB-001", title: "Curtain wall shop drawings", status: "under_review", dueDate: "2026-01-01T00:00:00.000Z", ballInCourtUser: { name: "Dana" } }], summary: { underReview: 1 } })) }));
jest.mock("../../safety.service", () => ({ listSafetyIncidents: jest.fn(async () => ({ rows: [{ id: "x1", ref: "SAF-001", title: "Fall from ladder", incidentType: "first_aid", status: "open", date: "2026-09-12T00:00:00.000Z", lostDays: 0 }, { id: "x2", ref: "SAF-002", title: "Near miss crane", incidentType: "near_miss", status: "closed", date: "2026-10-01T00:00:00.000Z", lostDays: 0 }], summary: { open: 1, closed: 1 } })) }));
jest.mock("../../forecast.service", () => ({ buildForecast: jest.fn(async () => ({ available: true, cost: { eac: 150, topRisks: [] }, schedule: {} })) }));
jest.mock("../../progress.service", () => ({ listProgressSubmissions: jest.fn() }));
jest.mock("../../../utils/boq-figures", () => ({ boqFigureAccess: jest.fn(() => ({ boq: false, budget: false })), withheldProgressSubmissions: jest.fn((rows) => rows), canReadBoq: jest.fn(), exceptionAccess: jest.fn(() => ({})), withheldCostSummary: jest.fn((summary) => ({ ...summary, withheld: true })), withheldForecast: jest.fn((forecast) => forecast), withheldAllocationLinks: jest.fn((order) => order) }));
jest.mock("../../activity-boq-allocation.service", () => ({ getCoverage: jest.fn() }));

const { prisma } = require("../../../config/db");
const { hasPermission } = require("../../../middleware/rbac");
const progressService = require("../../progress.service");
const { withheldProgressSubmissions } = require("../../../utils/boq-figures");
const { moduleSources } = require("../sources/module-sources");

const P = "11111111-1111-4111-8111-111111111111";
const view = { user: { id: "u-1", orgId: "org-1" }, projectAccess: { id: P } };
const TODAY = new Date();

describe("module sources (AI-7)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.activity.findMany.mockResolvedValue([
      { id: "a1", name: "Piling", activityCode: "A1100", startDate: new Date("2026-01-01"), endDate: new Date("2026-02-01"), physComplete: 40, totalFloat: 0, isCritical: true, isMilestone: false },
      { id: "a2", name: "Frame", activityCode: "A1200", startDate: new Date("2026-02-01"), endDate: new Date(TODAY.getTime() + 30 * 86_400_000), physComplete: 100, totalFloat: 5, isCritical: false, isMilestone: false },
    ]);
  });

  test("schedule: none without schedule read; CPM results as stored, the Delayed rule applied", async () => {
    hasPermission.mockReturnValue(false);
    expect(await moduleSources({ view, projectId: P, moduleKey: "schedule" })).toEqual([]);
    expect(prisma.activity.findMany).not.toHaveBeenCalled();

    hasPermission.mockImplementation((_view, moduleName) => moduleName === "schedule");
    const sources = await moduleSources({ view, projectId: P, moduleKey: "schedule", child: "critical" });
    expect(sources[0]).toMatchObject({ type: "schedule_facts" });
    expect(sources[0].text).toMatch(/1 open activities on the critical path/);
    expect(sources[0].text).toMatch(/1 activities delayed/);
    expect(sources[0].text).toMatch(/Delayed \d+ calendar days past finish: A1100 Piling/);
    expect(sources.map((source) => source.id)).toEqual([`${P}:schedule`, "a1"]);
    expect(prisma.activity.findMany.mock.calls[0][0].select.budget).toBeUndefined();
  });

  test("BOQ: nothing for a caller who may not read the BOQ; the coverage summary and its gaps for one who may", async () => {
    const { canReadBoq } = require("../../../utils/boq-figures");
    const allocationService = require("../../activity-boq-allocation.service");
    canReadBoq.mockReturnValue(false);
    expect(await moduleSources({ view, projectId: P, moduleKey: "boq" })).toEqual([]);
    expect(allocationService.getCoverage).not.toHaveBeenCalled();

    canReadBoq.mockReturnValue(true);
    allocationService.getCoverage.mockResolvedValue({
      totalBoqAmount: 1000, activeAllocatedAmount: 600, approvedAllocatedAmount: 500, pendingAllocatedAmount: 100, unallocatedAmount: 400,
      counts: { complete: 1, partial: 1, unmapped: 1, over: 0, notApplicable: 0 },
      items: [
        { boqItemId: "b1", code: "01", description: "Piling", mappingState: "complete", unallocatedAmount: 0, pendingAllocatedAmount: 0, allocationCount: 1 },
        { boqItemId: "b2", code: "02", description: "Frame", mappingState: "partial", unallocatedAmount: 100, pendingAllocatedAmount: 100, allocationCount: 1 },
        { boqItemId: "b3", code: "03", description: "Facade", mappingState: "unmapped", unallocatedAmount: 300, pendingAllocatedAmount: 0, allocationCount: 0 },
      ],
    });
    const sources = await moduleSources({ view, projectId: P, moduleKey: "boq" });
    expect(allocationService.getCoverage).toHaveBeenCalledWith({ orgId: "org-1", projectId: P });
    expect(sources[0].text).toMatch(/3 BOQ rows: 1 fully allocated, 1 partly, 1 unallocated/);
    expect(sources.slice(1).map((source) => source.id)).toEqual(["b3", "b2"]);
  });

  test("cost: each part only with its own module's read, through the route's withholding", async () => {
    const costService = require("../../cost.service");
    const forecastService = require("../../forecast.service");
    const { withheldCostSummary } = require("../../../utils/boq-figures");
    hasPermission.mockReturnValue(false);
    expect(await moduleSources({ view, projectId: P, moduleKey: "cost", child: "overview" })).toEqual([]);
    expect(costService.getCostSummary).not.toHaveBeenCalled();
    expect(forecastService.buildForecast).not.toHaveBeenCalled();

    hasPermission.mockImplementation((_view, moduleName) => moduleName === "cost");
    const sources = await moduleSources({ view, projectId: P, moduleKey: "cost", child: "overview" });
    expect(sources.map((item) => item.type)).toEqual(["cost_facts"]);
    expect(withheldCostSummary).toHaveBeenCalled();
    expect(sources[0].text).toMatch(/budget 100, committed 90, actual 120, forecast 130/);
    expect(forecastService.buildForecast).not.toHaveBeenCalled();

    hasPermission.mockImplementation((_view, moduleName) => moduleName === "schedule");
    const forecastOnly = await moduleSources({ view, projectId: P, moduleKey: "schedule", child: "forecast" });
    expect(forecastOnly.map((item) => item.type)).toEqual(["forecast_facts"]);
  });

  test("change: each register only with its own read; pending orders are records, never stated as approved", async () => {
    const changeOrders = require("../../change-order.service");
    const changeEvents = require("../../change-event.service");
    const { withheldAllocationLinks } = require("../../../utils/boq-figures");
    hasPermission.mockReturnValue(false);
    expect(await moduleSources({ view, projectId: P, moduleKey: "commercial", child: "change-orders" })).toEqual([]);
    expect(changeOrders.listChangeOrders).not.toHaveBeenCalled();
    expect(changeEvents.listChangeEvents).not.toHaveBeenCalled();

    hasPermission.mockImplementation((_view, moduleName) => moduleName === "change_order");
    const sources = await moduleSources({ view, projectId: P, moduleKey: "commercial", child: "change-orders" });
    expect(changeEvents.listChangeEvents).not.toHaveBeenCalled();
    expect(withheldAllocationLinks).toHaveBeenCalledTimes(2);
    expect(sources[0].text).toMatch(/Only an approved change order changes the contract/);
    expect(sources[0].text).toMatch(/2 change orders: 1 pending, 1 approved/);
    expect(sources.slice(1).map((item) => [item.id, item.status])).toEqual([["co1", "pending"]]);
    expect(sources[1].text).toMatch(/Status: pending \(not approved\)/);
  });

  test("procurement: orders only with procurement read, bids only with bid read, risks from the caller's own dashboard", async () => {
    const procurementService = require("../../procurement.service");
    const bidService = require("../../bid.service");
    const { authorizedWorkspaceDashboard } = require("../sources/workspace-snapshot");
    hasPermission.mockReturnValue(false);
    const none = await moduleSources({ view, projectId: P, moduleKey: "procurement" });
    expect(authorizedWorkspaceDashboard).toHaveBeenCalledWith(view, { projectId: P });
    expect(procurementService.getProcurementOverview).not.toHaveBeenCalled();
    expect(bidService.listPackages).not.toHaveBeenCalled();
    expect(none[0].text).not.toMatch(/PO-0001|Acme/);
    expect(none[0].text).toMatch(/At risk \(critical\): Glazing panel/);

    hasPermission.mockImplementation((_view, moduleName) => moduleName === "procurement");
    const orders = await moduleSources({ view, projectId: P, moduleKey: "procurement" });
    expect(orders[0].text).toMatch(/PO PO-0001 Formwork/);
    expect(bidService.listPackages).not.toHaveBeenCalled();

    hasPermission.mockImplementation((_view, moduleName) => moduleName === "bid");
    const bids = await moduleSources({ view, projectId: P, moduleKey: "commercial", child: "bids" });
    expect(bids[0].text).toMatch(/Bid from Acme: total 90, normalised 95, 1 plugged lines/);
  });

  test("inventory (a company screen): nothing without inventory read; the analytics with it", async () => {
    const analytics = require("../../inventory-analytics.service");
    const { orgModuleSources } = require("../sources/inventory-snapshot");
    const req = { user: { id: "u-1", orgId: "org-1" } };
    hasPermission.mockReturnValue(false);
    expect(await orgModuleSources({ req, moduleKey: "inventory" })).toEqual([]);
    expect(analytics.getAnalytics).not.toHaveBeenCalled();
    hasPermission.mockImplementation((_req, moduleName) => moduleName === "inventory");
    const [source] = await orgModuleSources({ req, moduleKey: "inventory" });
    expect(analytics.getAnalytics).toHaveBeenCalledWith({ orgId: "org-1", projectId: null, projectIds: null });
    expect(source.text).toMatch(/LOW STOCK: SLC-PU25 Polyurethane joint sealant: on hand 24/);
    expect(await orgModuleSources({ req, moduleKey: "unknown" })).toEqual([]);
  });

  test("quality: each register only with its own read; activity names only with schedule read", async () => {
    const ncrService = require("../../ncr.service");
    const itpService = require("../../itp.service");
    const quality = require("../../quality.service");
    hasPermission.mockReturnValue(false);
    expect(await moduleSources({ view, projectId: P, moduleKey: "quality" })).toEqual([]);
    expect(quality.getQualityDashboard).not.toHaveBeenCalled();

    hasPermission.mockImplementation((_view, moduleName) => moduleName === "inspection");
    const [itpOnly] = await moduleSources({ view, projectId: P, moduleKey: "quality", child: "itp" });
    expect(ncrService.listNcrs).not.toHaveBeenCalled();
    expect(itpOnly.text).toMatch(/Quality score 92/);
    expect(itpOnly.text).toMatch(/Inspection ITP-003 Riser first fix \(hold point, pending\) on activity \(activity you cannot see\).*HOLD point/);
    expect(itpOnly.text).not.toMatch(/NCR-001/);

    hasPermission.mockImplementation((_view, moduleName) => ["ncr", "schedule"].includes(moduleName));
    const [withNcr] = await moduleSources({ view, projectId: P, moduleKey: "quality", child: "ncr" });
    expect(itpService.listItps).toHaveBeenCalledTimes(1);
    expect(withNcr.text).toMatch(/NCR NCR-001 \(minor, open\) on activity A1100 Piling/);
  });

  test("submittals: only with submittal read, through the register with the caller's party access", async () => {
    const { listSubmittals } = require("../../submittal.service");
    hasPermission.mockReturnValue(false);
    expect(await moduleSources({ view, projectId: P, moduleKey: "docControl", child: "submittals" })).toEqual([]);
    expect(listSubmittals).not.toHaveBeenCalled();
    hasPermission.mockImplementation((_view, moduleName) => moduleName === "submittal");
    const sources = await moduleSources({ view, projectId: P, moduleKey: "docControl", child: "submittals" });
    expect(listSubmittals).toHaveBeenCalledWith({ orgId: "org-1", projectId: P, query: { limit: 100 }, projectAccess: view.projectAccess });
    expect(sources[0].text).toMatch(/Submittal SUB-001 Curtain wall shop drawings — under_review; due 2026-01-01 \(OVERDUE\); ball in court Dana/);
    expect(sources[1]).toMatchObject({ id: "s1", type: "submittal" });
  });

  test("safety: only with safety read; counts by type and month, open incidents listed", async () => {
    const { listSafetyIncidents } = require("../../safety.service");
    hasPermission.mockReturnValue(false);
    expect(await moduleSources({ view, projectId: P, moduleKey: "quality", child: "safety" })).toEqual([]);
    expect(listSafetyIncidents).not.toHaveBeenCalled();
    hasPermission.mockImplementation((_view, moduleName) => moduleName === "safety");
    const [source] = await moduleSources({ view, projectId: P, moduleKey: "quality", child: "safety" });
    expect(source.text).toMatch(/By type: 1 first aid, 1 near miss/);
    expect(source.text).toMatch(/By month: 2026-09: 1, 2026-10: 1/);
    expect(source.text).toMatch(/Open incident SAF-001 Fall from ladder/);
    expect(source.text).not.toMatch(/Open incident SAF-002/);
  });

  test("official progress is the latest approved submission over a stale stored figure", async () => {
    hasPermission.mockImplementation((_view, moduleName) => moduleName === "progress");
    prisma.activity.findMany.mockResolvedValue([
      { id: "a1", physComplete: 0, progress: [{ pctComplete: 100 }] },
      { id: "a2", physComplete: 0, progress: [] },
      { id: "a3", physComplete: 30, progress: [] },
    ]);
    progressService.listProgressSubmissions.mockResolvedValue([{ id: "s9", activityId: "a2", activity: { name: "Frame" }, status: "submitted", pctComplete: 50, submittedAt: TODAY }]);
    const [facts] = await moduleSources({ view, projectId: P, moduleKey: "schedule", child: "progress" });
    expect(facts.text).toMatch(/OFFICIAL: 3 activities: 1 complete, 1 in progress, 1 not started/);
    expect(facts.text).toMatch(/SUBMITTED \(not official\): Frame — 50% .*official now 0%/);
  });

  test("progress: submitted is never official, drafts are not read, the route's withholding applies", async () => {
    hasPermission.mockImplementation((_view, moduleName) => moduleName === "progress");
    progressService.listProgressSubmissions.mockResolvedValue([
      { id: "s1", activityId: "a1", activity: { name: "Piling", p6ActivityId: "A1100" }, status: "submitted", pctComplete: 60, submittedAt: TODAY },
      { id: "s2", activityId: "a2", activity: { name: "Frame" }, status: "approved", pctComplete: 100, reviewedAt: TODAY },
      { id: "s3", activityId: "a1", activity: { name: "Piling" }, status: "draft", pctComplete: 90, notes: "private draft" },
    ]);
    const sources = await moduleSources({ view, projectId: P, moduleKey: "schedule", child: "progress" });
    expect(progressService.listProgressSubmissions).toHaveBeenCalledWith({ orgId: "org-1", projectId: P });
    expect(withheldProgressSubmissions).toHaveBeenCalled();
    const text = sources[0].text;
    expect(text).toMatch(/SUBMITTED \(not official\): A1100 Piling — 60% submitted .*; official now 40%/);
    expect(text).toMatch(/APPROVED \(official\): Frame — 100%/);
    expect(JSON.stringify(sources)).not.toMatch(/private draft|90%/);
    expect(sources[1]).toMatchObject({ id: "s1", status: "submitted" });
    // The official figure is the latest APPROVED submission (as the product reads it), not a stale stored %.
    expect(prisma.activity.findMany.mock.calls[0][0].select.progress).toEqual({ where: { status: "approved" }, orderBy: { updatedAt: "desc" }, take: 1, select: { pctComplete: true } });

    hasPermission.mockReturnValue(false);
    progressService.listProgressSubmissions.mockClear();
    expect(await moduleSources({ view, projectId: P, moduleKey: "schedule", child: "progress" })).toEqual([]);
    expect(progressService.listProgressSubmissions).not.toHaveBeenCalled();
  });
});
