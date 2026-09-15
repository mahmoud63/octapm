/**
 * Evidence already on the project's records can be cited on a change order
 * (Phase 22B). The search sees only what the viewer may see: a module the
 * viewer cannot read is skipped before any record rule runs, and a
 * party-scoped viewer keeps the Phase 21 record rules. The same file attached
 * to two records is offered once; the search matches the record's reference
 * and title, not only the file name.
 */
const mockPrisma = {
  project: { findFirst: jest.fn(async () => ({ id: "project-1", orgId: "org-1" })) },
  attachment: { findMany: jest.fn(async () => []) },
};
const mockLoadRecord = jest.fn();
const mockRecordRuleVisibleIds = jest.fn(async () => new Set());
const mockAttachmentVisible = jest.fn(() => true);
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../comment.service", () => ({ loadRecord: (...args) => mockLoadRecord(...args) }));
jest.mock("../document-text.service", () => ({
  recordRuleVisibleIds: (...args) => mockRecordRuleVisibleIds(...args),
  attachmentVisible: (...args) => mockAttachmentVisible(...args),
}));
jest.mock("../file-storage.service", () => ({ DOCUMENT_TYPES: { WORKFLOW_ATTACHMENT: "workflow_attachment" } }));
jest.mock("../audit.service", () => ({ recordEvent: jest.fn() }));
jest.mock("../../jobs/job.service", () => ({ enqueue: jest.fn() }));
jest.mock("../../utils/image-metadata", () => ({ readImageMetadata: jest.fn(async () => null) }));

const service = require("../attachment.service");

const doc = (id, fileName) => ({ id, fileName, originalName: fileName, mimeType: "text/plain", sizeBytes: 12, status: "linked", uploadedAt: new Date("2026-09-01T00:00:00Z") });
const row = (id, recordType, recordId, document, caption = null) => ({ id, recordType, recordId, documentId: document.id, role: "attachment", caption, createdAt: new Date("2026-09-02T00:00:00Z"), document });

describe("Phase 22B — searchProjectEvidence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadRecord.mockImplementation(async ({ recordType, recordId }) => {
      if (recordType === "rfi") return { record: { ref: "RFI-001", status: "closed" }, display: "Founding level at grid A-D" };
      if (recordType === "ncr") return { record: { ref: "NCR-003", status: "open" }, display: "Honeycombing at column C2" };
      throw Object.assign(new Error("gone"), { status: 404 });
    });
  });

  it("finds a file by its record's reference, labels it, and offers a file attached twice only once", async () => {
    const letter = doc("doc-letter", "instruction.txt");
    mockPrisma.attachment.findMany.mockResolvedValue([
      row("a1", "rfi", "rfi-1", letter),
      row("a2", "change_order", "co-9", letter), // the same letter, cited on an earlier change order
      row("a3", "ncr", "ncr-3", doc("doc-photo", "honeycomb.jpg"), "Column C2 after strike"),
    ]);
    const viewer = { id: "u1", canRead: () => true, partyIds: null };
    const all = await service.searchProjectEvidence({ orgId: "org-1", projectId: "project-1", viewer });
    expect(all.items.map((item) => item.documentId)).toEqual(["doc-letter", "doc-photo"]);
    expect(all.items[0]).toEqual(expect.objectContaining({ recordType: "rfi", recordRef: "RFI-001", recordTitle: "Founding level at grid A-D", fileName: "instruction.txt", fileUrl: expect.stringContaining("doc-letter") }));

    const byRef = await service.searchProjectEvidence({ orgId: "org-1", projectId: "project-1", viewer, q: "ncr-003" });
    expect(byRef.items.map((item) => item.documentId)).toEqual(["doc-photo"]);
    const byCaption = await service.searchProjectEvidence({ orgId: "org-1", projectId: "project-1", viewer, q: "after strike" });
    expect(byCaption.items.map((item) => item.documentId)).toEqual(["doc-photo"]);
    const none = await service.searchProjectEvidence({ orgId: "org-1", projectId: "project-1", viewer, q: "nothing like this" });
    expect(none.items).toEqual([]);
  });

  it("never offers a file from a module the viewer cannot read, and keeps the record rules for a party-scoped viewer", async () => {
    mockPrisma.attachment.findMany.mockResolvedValue([
      row("a1", "rfi", "rfi-1", doc("doc-letter", "instruction.txt")),
      row("a3", "ncr", "ncr-3", doc("doc-photo", "honeycomb.jpg")),
    ]);
    // a person without NCR access: the NCR photo is not even considered
    const noNcr = { id: "u2", canRead: (moduleName) => moduleName !== "ncr", partyIds: null };
    const seen = await service.searchProjectEvidence({ orgId: "org-1", projectId: "project-1", viewer: noNcr });
    expect(seen.items.map((item) => item.documentId)).toEqual(["doc-letter"]);
    expect(mockRecordRuleVisibleIds).toHaveBeenCalledWith(expect.objectContaining({ viewer: noNcr }));
    // a party-scoped viewer: the record rule decides, row by row
    mockAttachmentVisible.mockImplementation((attachment) => attachment.recordType === "rfi");
    const party = { id: "u3", canRead: () => true, partyIds: ["party-1"], companyIds: ["company-1"] };
    const ruled = await service.searchProjectEvidence({ orgId: "org-1", projectId: "project-1", viewer: party });
    expect(ruled.items.map((item) => item.documentId)).toEqual(["doc-letter"]);
  });
});
