/**
 * CERT-2: the purchase-order list serves a delivery receipt's daily report
 * only when the report is on the receipt's own project.
 *
 * A receipt stored naming another company's daily report — residue of a
 * reproduction made before the write guard — served that report's id on
 * GET /projects/{p}/procurement/purchase-orders. The receipt and its lines
 * keep their shape: the report's id when it is the receipt's project's,
 * otherwise null, and nothing more of the report.
 */

const mockPrisma = {
  project: { findFirst: jest.fn() },
  procurementOrder: { findMany: jest.fn() },
};
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const procurementService = require("../procurement.service");

const project = { id: "project-1", orgId: "org-1", startDate: new Date("2026-01-01T00:00:00.000Z") };

const receipt = (over = {}) => ({
  id: "grn-1",
  projectId: "project-1",
  orderId: "order-1",
  receiptNumber: "GRN-00001",
  dailyReportId: null,
  dailyReport: null,
  lines: [],
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.project.findFirst.mockResolvedValue(project);
});

describe("CERT-2 — a receipt's daily report is served only when it is on the receipt's project", () => {
  it("another project's (or company's) report is blanked on the receipt and on its lines; the own report is kept; nothing more of the report is served", async () => {
    mockPrisma.procurementOrder.findMany.mockResolvedValue([
      {
        id: "order-1",
        projectId: "project-1",
        lines: [],
        deliveryReceipts: [
          receipt({
            id: "grn-theirs",
            dailyReportId: "dr-theirs",
            dailyReport: { projectId: "project-of-another-company" },
            lines: [{ id: "grl-1", projectId: "project-1", dailyReportId: "dr-theirs", dailyReport: { projectId: "project-of-another-company" } }],
          }),
          receipt({
            id: "grn-own",
            dailyReportId: "dr-own",
            dailyReport: { projectId: "project-1" },
            lines: [{ id: "grl-2", projectId: "project-1", dailyReportId: "dr-own", dailyReport: { projectId: "project-1" } }],
          }),
          // A report that no longer exists is not served either.
          receipt({ id: "grn-gone", dailyReportId: "dr-gone", dailyReport: null }),
          receipt({ id: "grn-none" }),
        ],
      },
    ]);

    const [order] = await procurementService.listPurchaseOrders({ orgId: "org-1", projectId: "project-1" });
    const byId = Object.fromEntries(order.deliveryReceipts.map((row) => [row.id, row]));
    expect(byId["grn-theirs"].dailyReportId).toBeNull();
    expect(byId["grn-theirs"].lines[0].dailyReportId).toBeNull();
    expect(byId["grn-own"].dailyReportId).toBe("dr-own");
    expect(byId["grn-own"].lines[0].dailyReportId).toBe("dr-own");
    expect(byId["grn-gone"].dailyReportId).toBeNull();
    expect(byId["grn-none"].dailyReportId).toBeNull();
    expect(JSON.stringify(order)).not.toMatch(/dr-theirs|project-of-another-company|dr-gone/);
    expect(order.deliveryReceipts.every((row) => !("dailyReport" in row) && row.lines.every((line) => !("dailyReport" in line)))).toBe(true);
  });

  it("the read asks for each report's project, on the receipt and on its lines", async () => {
    mockPrisma.procurementOrder.findMany.mockResolvedValue([]);
    await procurementService.listPurchaseOrders({ orgId: "org-1", projectId: "project-1" });
    const { include } = mockPrisma.procurementOrder.findMany.mock.calls[0][0];
    expect(include.deliveryReceipts.include).toEqual({
      lines: { include: { dailyReport: { select: { projectId: true } } } },
      dailyReport: { select: { projectId: true } },
    });
  });
});
