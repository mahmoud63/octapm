/**
 * Commercial evidence (change orders, EOT claims, weather delays, sub
 * valuations) cites stored documents; each citation is a read grant to the
 * record's readers, so it names only a document its writer may read
 * (certification R29). Who may read is decided in document-text.service.
 */

const mockPrisma = {};
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => ({}));
jest.mock("../approval-workflow.service", () => ({ listEventsForRecords: jest.fn(async () => new Map()) }));
const mockLinkable = jest.fn(async () => undefined);
jest.mock("../document-text.service", () => ({ assertDocumentsLinkable: (...args) => mockLinkable(...args) }));

const service = require("../commercial-traceability.service");

const DOC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const KEPT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const txFor = () => ({
  projectDocument: {
    findMany: jest.fn(async ({ where }) => where.id.in.map((id) => ({ id, fileName: `${id}.pdf`, storageKey: id, scanStatus: "clean" }))),
    updateMany: jest.fn(async () => ({})),
  },
  commercialAttachmentRef: {
    findMany: jest.fn(async () => [{ documentId: KEPT }]),
    deleteMany: jest.fn(async () => ({})),
    createMany: jest.fn(async () => ({})),
  },
});

const sync = (tx, attachmentRefs) =>
  service.syncEvidenceReferences({ tx, projectId: "project-1", recordType: "change_order", recordId: "co-1", payload: { attachmentRefs }, userId: "qs-1" });

describe("certification R29 — commercial evidence cites only documents its writer may read", () => {
  beforeEach(() => {
    mockLinkable.mockReset();
    mockLinkable.mockImplementation(async () => undefined);
  });

  it("asks about every cited document as the writer, keeping the record's own citations, before anything is written", async () => {
    const tx = txFor();
    await sync(tx, [{ documentId: DOC }, { documentId: KEPT }]);
    const call = mockLinkable.mock.calls[0][0];
    expect(call).toMatchObject({ projectId: "project-1", keys: [DOC, KEPT], userId: "qs-1" });
    expect(await call.unchanged()).toEqual([KEPT]);
    expect(tx.commercialAttachmentRef.findMany).toHaveBeenCalledWith({ where: { projectId: "project-1", recordType: "change_order", recordId: "co-1" }, select: { documentId: true } });
    expect(call.refuse()).toMatchObject({ status: 400, code: "COMMERCIAL_DOCUMENT_NOT_FOUND" });
    expect(tx.commercialAttachmentRef.createMany).toHaveBeenCalled();
  });

  it("a refused citation is answered as a missing document: nothing is replaced and no document is re-pointed", async () => {
    const tx = txFor();
    mockLinkable.mockImplementation(async ({ refuse }) => { throw refuse(); });
    await expect(sync(tx, [{ documentId: DOC }])).rejects.toMatchObject({ status: 400, code: "COMMERCIAL_DOCUMENT_NOT_FOUND" });
    expect(tx.commercialAttachmentRef.deleteMany).not.toHaveBeenCalled();
    expect(tx.commercialAttachmentRef.createMany).not.toHaveBeenCalled();
    expect(tx.projectDocument.updateMany).not.toHaveBeenCalled();
  });

  it("evidence that names no stored document (a URL only) is not asked about", async () => {
    const tx = txFor();
    await sync(tx, [{ fileUrl: "https://example.test/letter.pdf", fileName: "letter.pdf" }]);
    expect(mockLinkable).not.toHaveBeenCalled();
    expect(tx.commercialAttachmentRef.createMany).toHaveBeenCalled();
  });
});
