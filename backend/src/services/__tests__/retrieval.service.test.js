/**
 * What the AI retrieval layer may say about a project in a prompt
 * (certification L25 and L46, follow-up): the contract sum only to a reader
 * who may read it on that project (ipc:read, decided by the real permission
 * catalogue), and nothing at all from a project the reader cannot open.
 */

const mockPrisma = { project: { findMany: jest.fn() } };
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
const mockSearch = { globalSearch: jest.fn() };
jest.mock("../search.service", () => mockSearch);
const mockAuthorization = { assertProjectAccess: jest.fn() };
jest.mock("../project-authorization.service", () => mockAuthorization);
jest.mock("../permission-template.service", () => ({ resolveTemplateContext: jest.fn().mockResolvedValue(null), templateAllows: jest.fn() }));

const { retrieve } = require("../retrieval.service");
const { can, canParty } = require("../../config/permissions");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const hit = (id, projectId, score) => ({ id, type: "note", title: `Hit ${id}`, projectId, subtitle: "snippet", metadata: { score } });
const ask = (user) => retrieve({ orgId: "org-1", user, query: "slab pour" });
const valueOf = (result, projectId) => result.projects.find((p) => p.id === projectId)?.contractValue;

describe("retrieval: the contract sum in a prompt", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch.globalSearch.mockResolvedValue({ items: [hit("r1", A, 2), hit("r2", B, 1)], meta: {} });
    mockPrisma.project.findMany.mockResolvedValue([
      { id: A, name: "Tower A", status: "active", currency: "USD", contractValue: 1000000, clientName: "Client A" },
      { id: B, name: "Tower B", status: "active", currency: "USD", contractValue: 2000000, clientName: "Client B" },
    ]);
  });

  it("the catalogue gives ipc:read to a PM and not to a planner or a subcontractor party (the premise)", () => {
    expect(can({ role: "pm", module: "ipc", action: "read" })).toBe(true);
    expect(can({ role: "planning_eng", module: "ipc", action: "read" })).toBe(false);
    expect(canParty({ partyRole: "subcontractor", module: "ipc", action: "read" })).toBe(false);
  });

  it("keeps it for a reader with ipc:read on the project", async () => {
    mockAuthorization.assertProjectAccess.mockResolvedValue({ role: "pm", partyAccess: [] });
    const result = await ask({ id: "u1", role: "pm" });
    expect(valueOf(result, A)).toBe(1000000);
    expect(valueOf(result, B)).toBe(2000000);
  });

  it("withholds it from a planner, who has no ipc:read, and keeps the rest of the summary", async () => {
    mockAuthorization.assertProjectAccess.mockResolvedValue({ role: "planning_eng", partyAccess: [] });
    const result = await ask({ id: "u2", role: "planning_eng" });
    expect(valueOf(result, A)).toBeNull();
    expect(valueOf(result, B)).toBeNull();
    expect(result.projects.find((p) => p.id === A)).toMatchObject({ name: "Tower A", clientName: "Client A" });
  });

  it("withholds it from a subcontractor-party guest", async () => {
    mockAuthorization.assertProjectAccess.mockResolvedValue({ role: "external_party", partyAccess: [{ role: "subcontractor" }] });
    const result = await ask({ id: "u3", role: "external_party" });
    expect(valueOf(result, A)).toBeNull();
  });

  it("reads a document as its record's own rule reads the guest: no text of a file on another party's RFI (certification R15)", async () => {
    const document = {
      id: "doc-y", orgId: "org-1", projectId: A, fileName: "y.pdf", originalName: "y.pdf", mimeType: "application/pdf", documentType: "attachment", storageKey: "key-y", uploadedAt: new Date("2026-09-01"),
      text: { status: "ready", extractor: "pdf", wordCount: 9, pageCount: 1, excerpt: null, embeddingStatus: "none" },
      documentRevisions: [], attachments: [{ recordType: "rfi", recordId: "rfi-y", role: null }], commitmentsExecuted: [], subPayAppWaivers: [], commercialAttachmentRefs: [], closeoutEvidence: [], dailyLogPdfs: [], taskAttachments: [], signatures: [],
    };
    mockSearch.globalSearch.mockResolvedValue({ items: [], meta: {} });
    mockPrisma.$queryRaw = jest.fn(async () => [{ documentId: "doc-y", projectId: A, rank: 0.9, headline: "the [[cobalt]] valve is priced at 41,000" }]);
    mockPrisma.projectDocument = { findMany: jest.fn(async () => [{ ...document }]) };
    mockPrisma.workflowAttachment = { findMany: jest.fn(async () => []) };
    // Company Y's RFI is routed to party Y only.
    mockPrisma.rfi = { findMany: jest.fn(async ({ where }) => (JSON.stringify(where).includes('"party-y"') ? [{ id: "rfi-y" }] : [])) };
    const guest = (party, company) => ({ id: A, role: "external_party", assignmentRole: null, scope: "party", partyAccess: [{ projectPartyId: party, companyId: company, role: "subcontractor" }] });
    const askAs = (userId, access) => retrieve({ orgId: "org-1", user: { id: userId, role: "site_engineer" }, projectId: A, query: "cobalt", projectAccess: access });

    const x = await askAs("guest-x", guest("party-x", "company-x"));
    expect(x.sources.find((source) => source.id === "doc-y")).toBeUndefined();
    // The RFI's own rule was asked, as the guest of party X.
    expect(mockPrisma.rfi.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["rfi-y"] } }) }));
    expect(JSON.stringify(mockPrisma.rfi.findMany.mock.calls[0][0].where)).toContain('"party-x"');

    const y = await askAs("guest-y", guest("party-y", "company-y"));
    expect(y.sources.find((source) => source.id === "doc-y")).toMatchObject({ kind: "document", text: expect.stringContaining("cobalt") });
  });

  it("grants nothing from a project the reader cannot open — no fallback to the company role", async () => {
    mockAuthorization.assertProjectAccess.mockImplementation(async ({ projectId }) => {
      if (projectId === B) throw Object.assign(new Error("Project not found"), { status: 404 });
      return { role: "pm", partyAccess: [] };
    });
    const result = await ask({ id: "u1", role: "pm" });
    expect(valueOf(result, A)).toBe(1000000);
    expect(valueOf(result, B)).toBeNull();
  });
});
