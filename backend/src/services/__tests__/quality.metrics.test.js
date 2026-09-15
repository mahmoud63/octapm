/**
 * Quality KPIs count live records only (Phase 22B).
 *
 * The Phase 22B audit found "Safety Open 80" on a project whose eighty
 * incidents were all archived suite residue: the dashboard counted anything
 * not closed as open, and scored archived NCRs against the quality score.
 * Archived and void records are withdrawn — they are neither open nor a mark
 * against the project.
 */
const mockPrisma = {
  project: { findFirst: jest.fn(async () => ({ id: "project-1", orgId: "org-1" })) },
  ncrRecord: { findMany: jest.fn(async () => []) },
  itpRecord: { findMany: jest.fn(async () => []) },
  defectRecord: { findMany: jest.fn(async () => []) },
  materialTest: { findMany: jest.fn(async () => []) },
  safetyIncident: { findMany: jest.fn(async () => []) },
  punchItem: { findMany: jest.fn(async () => []) },
};
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const service = require("../quality.service");

describe("Phase 22B — quality metrics", () => {
  it("counts open safety incidents and scores NCRs without the archived ones", async () => {
    mockPrisma.safetyIncident.findMany.mockResolvedValue([
      { status: "open", incidentType: "near_miss" },
      { status: "investigating", incidentType: "first_aid" },
      ...Array.from({ length: 80 }, (_, i) => ({ status: "archived", incidentType: "near_miss", title: `E2E deep link ${i}` })),
      { status: "closed", incidentType: "near_miss" },
    ]);
    mockPrisma.ncrRecord.findMany.mockResolvedValue([
      { status: "open", severity: "major" },
      { status: "archived", severity: "major" },
      { status: "void", severity: "minor" },
    ]);
    mockPrisma.itpRecord.findMany.mockResolvedValue([{ status: "failed" }, { status: "archived" }]);

    const metrics = await service.getQualityDashboard({ orgId: "org-1", projectId: "project-1" });
    const summary = metrics.summary || metrics.metrics || metrics;
    expect(summary.safetyOpen).toBe(2);
    expect(summary.majorNcrs).toBe(1);
    expect(summary.failedItps).toBe(1);
    // one major NCR (20) and one failed ITP (15): 65 — the archived major NCR would have made it 45
    expect(summary.qualityScore).toBe(65);
  });
});
