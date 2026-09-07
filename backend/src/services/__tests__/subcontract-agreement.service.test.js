/**
 * The subcontract agreement.
 *
 * The point is that nothing in it is typed: every clause and every figure is
 * read off a record somebody already approved. So the tests are about what the
 * assembly pulls together, and about the readiness list — because a document
 * that looks finished but is missing its scope or its insurance is the one
 * that gets signed by mistake.
 */

const mockPrisma = {
  commitment: { findFirst: jest.fn() },
  project: { findFirst: jest.fn() },
  organisation: { findFirst: jest.fn() },
  primeContract: { findFirst: jest.fn() },
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const service = require("../subcontract-agreement.service");

const line = (over = {}) => ({
  id: "sov-1",
  lineNumber: 1,
  description: "Formwork to columns and slabs",
  unit: "m2",
  qty: 9400,
  rate: 62,
  amount: 582_800,
  activity: {
    id: "act-1",
    name: "Reinforced concrete frame",
    activityCode: "A-2000",
    startDate: new Date("2026-03-09"),
    endDate: new Date("2026-07-31"),
  },
  costCode: { code: "03-300", name: "Concrete" },
  ...over,
});

const scopeItem = (over = {}) => ({
  id: "si-1",
  kind: "scope",
  section: "Works",
  description: "Installation",
  responsibility: "subcontractor",
  notes: null,
  sortOrder: 0,
  ...over,
});

const commitment = (over = {}) => ({
  id: "cm-1",
  ref: "SC-0001",
  title: "Reinforced concrete frame",
  type: "subcontract",
  status: "executed",
  currency: "USD",
  retentionRate: 10,
  paymentTerms: "30 days from certification",
  startDate: new Date("2026-03-09"),
  endDate: new Date("2026-07-31"),
  vendorCompanyId: "vendor-1",
  supplier: null,
  insuranceJson: [
    { type: "general_liability", required: true, documentId: "doc-1", expiresAt: "2027-01-01" },
  ],
  vendorCompany: {
    id: "vendor-1",
    name: "Meridian Concrete Services",
    legalName: "Meridian Concrete Services Ltd",
    registrationNumber: "12345678",
    taxNumber: "GB123",
    address: "12 Quarry Road",
    contactName: "Ana Silva",
    email: "contracts@meridian.example",
    phone: "+44 20 7000 0000",
  },
  lines: [line()],
  changeOrders: [{ ref: "SC-0001-CO01", title: "Extra formwork", value: 74_400 }],
  scopeMatrix: {
    status: "agreed",
    items: [
      scopeItem(),
      scopeItem({ id: "si-2", kind: "responsibility", description: "Shop drawings", responsibility: "subcontractor" }),
      scopeItem({ id: "si-3", kind: "exclusion", description: "Painting", responsibility: null }),
      scopeItem({ id: "si-4", kind: "interface", description: "Coordinate with M&E", responsibility: null }),
    ],
  },
  ...over,
});

const setup = (over = {}) => {
  mockPrisma.commitment.findFirst.mockResolvedValue(commitment(over));
  mockPrisma.project.findFirst.mockResolvedValue({
    id: "project-1",
    name: "Riverside Tower",
    location: "Riverside, Docklands",
    contractNumber: "RT-2026-014",
    currency: "USD",
    startDate: new Date("2026-01-12"),
    endDate: new Date("2026-11-27"),
  });
  mockPrisma.organisation.findFirst.mockResolvedValue({ id: "org-1", name: "OctaPM Demo Contracting" });
  mockPrisma.primeContract.findFirst.mockResolvedValue({ ref: "RT-2026-014", title: "Client contract" });
};

const build = () =>
  service.buildAgreement({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1" });

describe("assembling the agreement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setup();
  });

  it("names both parties from records rather than from typing", async () => {
    const agreement = await build();
    expect(agreement.parties.contractor.name).toBe("OctaPM Demo Contracting");
    expect(agreement.parties.subcontractor.legalName).toBe("Meridian Concrete Services Ltd");
    expect(agreement.parties.subcontractor.registrationNumber).toBe("12345678");
  });

  it("takes the sum from the schedule of values and the approved changes", async () => {
    const agreement = await build();
    expect(agreement.money.original).toBe(582_800);
    expect(agreement.money.approvedChanges).toBe(74_400);
    expect(agreement.money.revised).toBe(657_200);
  });

  it("sorts the scope matrix into the sections the contract needs", async () => {
    const agreement = await build();
    expect(agreement.scope.works.map((row) => row.description)).toEqual(["Installation"]);
    expect(agreement.scope.responsibilities.map((row) => row.description)).toEqual(["Shop drawings"]);
    expect(agreement.scope.exclusions).toEqual(["Painting"]);
    expect(agreement.scope.interfaces).toEqual(["Coordinate with M&E"]);
  });

  it("takes the programme off the activities the schedule of values is tied to", async () => {
    const agreement = await build();
    expect(agreement.milestones).toEqual([
      expect.objectContaining({ code: "A-2000", name: "Reinforced concrete frame" }),
    ]);
  });

  it("writes the retention clause from the commitment's own rate", async () => {
    const agreement = await build();
    const retention = agreement.clauses.find((clause) => clause.heading === "Retention");
    expect(retention.body[0]).toContain("10%");
  });

  it("says so plainly when no retention is held", async () => {
    setup({ retentionRate: 0 });
    const agreement = await build();
    const retention = agreement.clauses.find((clause) => clause.heading === "Retention");
    expect(retention.body[0]).toBe("No retention is deducted under this Agreement.");
  });
});

describe("readiness", () => {
  beforeEach(() => jest.clearAllMocks());

  it("is ready when the scope is agreed, the values are in and the cover is on file", async () => {
    setup();
    const agreement = await build();
    expect(agreement.readiness.ready).toBe(true);
    expect(agreement.readiness.gaps).toEqual([]);
  });

  it("names an unagreed scope rather than only refusing", async () => {
    setup({ scopeMatrix: { status: "draft", items: [scopeItem()] } });
    const agreement = await build();
    expect(agreement.readiness.ready).toBe(false);
    expect(agreement.readiness.gaps).toContain("The scope matrix has not been agreed");
  });

  it("counts scope rows that still have nobody against them", async () => {
    setup({
      scopeMatrix: {
        status: "draft",
        items: [scopeItem({ responsibility: null }), scopeItem({ id: "si-9", responsibility: null })],
      },
    });
    const agreement = await build();
    expect(agreement.readiness.gaps).toContain("2 scope rows still have nobody against them");
  });

  it("flags a required insurance with no certificate on file", async () => {
    setup({
      insuranceJson: [
        { type: "general_liability", required: true, documentId: null },
        { type: "bond", required: false, documentId: null },
      ],
    });
    const agreement = await build();
    expect(agreement.readiness.gaps).toContain(
      "A required insurance certificate is not on file"
    );
  });

  it("flags an empty schedule of values and a missing vendor", async () => {
    setup({ lines: [], vendorCompanyId: null, vendorCompany: null });
    const agreement = await build();
    expect(agreement.readiness.gaps).toContain("The schedule of values is empty");
    expect(agreement.readiness.gaps).toContain(
      "No subcontractor company is named on the commitment"
    );
  });

  it("flags a commitment with no scope matrix at all", async () => {
    setup({ scopeMatrix: null });
    const agreement = await build();
    expect(agreement.readiness.gaps).toContain(
      "No scope and responsibility matrix has been drawn up"
    );
  });
});

describe("printing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setup();
  });

  it("renders a PDF named after the commitment", async () => {
    const result = await service.exportAgreementPdf({
      orgId: "org-1",
      projectId: "project-1",
      commitmentId: "cm-1",
    });
    expect(result.fileName).toBe("SC-0001-subcontract-agreement.pdf");
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("renders even when the commitment is not ready, so a draft can be reviewed", async () => {
    setup({ scopeMatrix: null, lines: [] });
    const result = await service.exportAgreementPdf({
      orgId: "org-1",
      projectId: "project-1",
      commitmentId: "cm-1",
    });
    expect(result.buffer.length).toBeGreaterThan(1000);
  });
});
