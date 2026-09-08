const mockPrisma = {
  project: { findFirst: jest.fn() },
  sheet: { findFirst: jest.fn() },
  sheetRevision: { findFirst: jest.fn() },
  markup: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  pin: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), delete: jest.fn() },
  photo: { findFirst: jest.fn() },
  user: { findMany: jest.fn(async () => []) },
};
const mockAudit = {
  ENTITY_TYPES: { SHEET: "sheet" },
  ACTIONS: {},
  recordEvent: jest.fn(async () => ({})),
};
const mockLoadRecord = jest.fn();
const mockCreateComment = jest.fn(async () => ({}));
const mockCreateRfi = jest.fn();
const mockCreateDefect = jest.fn();

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../attachment.service", () => ({ RECORD_TYPE_MODULES: { rfi: "rfi", defect: "ncr" } }));
jest.mock("../comment.service", () => ({
  loadRecord: (...args) => mockLoadRecord(...args),
  createComment: (...args) => mockCreateComment(...args),
}));
jest.mock("../rfi.service", () => ({ createRfi: (...args) => mockCreateRfi(...args) }));
jest.mock("../defect.service", () => ({ createDefect: (...args) => mockCreateDefect(...args) }));

const service = require("../markup.service");

const ORG = "org-1";
const PROJECT = "project-1";
const SHEET_ID = "sheet-1";
const ME = { id: "user-me", name: "Amal", canManage: false };
const PM = { id: "user-pm", name: "Priya", canManage: true, role: "pm" };

const sheet = { id: SHEET_ID, orgId: ORG, projectId: PROJECT, number: "A-101", title: "Ground floor", discipline: "Architectural" };

describe("markup service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: PROJECT });
    mockPrisma.sheet.findFirst.mockResolvedValue(sheet);
    mockPrisma.markup.create.mockImplementation(({ data }) => Promise.resolve({ id: "markup-new", createdAt: new Date(), updatedAt: new Date(), ...data }));
    mockPrisma.markup.update.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, orgId: ORG, projectId: PROJECT, sheetId: SHEET_ID, authorId: ME.id, visibility: "personal", shapesJson: [], shapeCount: 0, ...data }));
    mockPrisma.pin.create.mockImplementation(({ data }) => Promise.resolve({ id: "pin-1", createdAt: new Date(), ...data }));
  });

  describe("shapes", () => {
    it("keeps known shapes, clamps coordinates and drops junk", () => {
      const shapes = service.normalizeShapes([
        { type: "rect", x: -0.2, y: 0.1, w: 1.5, h: 0.2, color: "#ff0000", strokeWidth: 99 },
        { type: "arrow", points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.9 }] },
        { type: "text", x: 0.3, y: 0.3, text: "  Check rebar  ", fontSize: 200 },
        { type: "measure", points: [[0, 0], [0.5, 0]], label: "12.5 m" },
        { type: "hexagon", x: 0.1, y: 0.1 },
        { type: "line", points: [{ x: 0.1, y: 0.1 }] },
        { type: "text", x: 0.1, y: 0.1, text: "   " },
        "nope",
      ]);
      expect(shapes.map((shape) => shape.type)).toEqual(["rect", "arrow", "text", "measure"]);
      expect(shapes[0]).toEqual(expect.objectContaining({ x: 0, y: 0.1, w: 1, h: 0.2, color: "#ff0000", strokeWidth: 20 }));
      expect(shapes[1].points).toHaveLength(2);
      expect(shapes[2]).toEqual(expect.objectContaining({ text: "Check rebar", fontSize: 96 }));
      expect(shapes[3]).toEqual(expect.objectContaining({ points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }], label: "12.5 m" }));
    });

    it("rejects oversized layers", () => {
      expect(() => service.normalizeShapes(Array.from({ length: 501 }, () => ({ type: "rect", x: 0, y: 0 })))).toThrow(
        expect.objectContaining({ code: "MARKUP_TOO_MANY_SHAPES" }),
      );
      expect(() => service.normalizeShapes("nope")).toThrow(expect.objectContaining({ code: "MARKUP_SHAPES_INVALID" }));
    });
  });

  describe("personal and published layers", () => {
    it("lists published layers plus only my personal layer", async () => {
      mockPrisma.markup.findMany.mockResolvedValue([
        { id: "m-pub", authorId: PM.id, visibility: "published", shapesJson: [{ type: "rect" }], shapeCount: 1, name: "Coordination" },
        { id: "m-mine", authorId: ME.id, visibility: "personal", shapesJson: [], shapeCount: 0 },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([{ id: PM.id, name: "Priya" }]);
      const result = await service.listMarkups({ orgId: ORG, projectId: PROJECT, sheetId: SHEET_ID, viewer: ME });
      expect(mockPrisma.markup.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ OR: [{ visibility: "published" }, { authorId: ME.id }] }) }),
      );
      expect(result.items[0]).toEqual(expect.objectContaining({ id: "m-pub", authorName: "Priya", isMine: false, canEdit: false }));
      expect(result.items[1]).toEqual(expect.objectContaining({ id: "m-mine", isMine: true, canEdit: true }));
    });

    it("saves my layer (creating it on first use) and publishes it with an audit trail", async () => {
      mockPrisma.markup.findFirst.mockResolvedValueOnce(null);
      const saved = await service.savePersonalMarkup({
        orgId: ORG,
        projectId: PROJECT,
        sheetId: SHEET_ID,
        viewer: ME,
        shapes: [{ type: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.1 }],
        sheetRevisionId: "rev-1",
      });
      expect(mockPrisma.markup.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ authorId: ME.id, visibility: "personal", shapeCount: 1, sheetRevisionId: "rev-1" }) }),
      );
      expect(saved.visibility).toBe("personal");

      mockPrisma.markup.findFirst.mockResolvedValue({ id: "markup-new", orgId: ORG, projectId: PROJECT, sheetId: SHEET_ID, authorId: ME.id, visibility: "personal", shapeCount: 1, shapesJson: [{ type: "rect" }] });
      await expect(service.publishMarkup({ orgId: ORG, projectId: PROJECT, markupId: "markup-new", viewer: PM })).rejects.toMatchObject({ code: "MARKUP_FORBIDDEN" });

      const published = await service.publishMarkup({ orgId: ORG, projectId: PROJECT, markupId: "markup-new", name: "Site walk", viewer: ME });
      expect(mockPrisma.markup.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ visibility: "published", name: "Site walk", publishedAt: expect.any(Date) }) }),
      );
      expect(published.visibility).toBe("published");
      expect(mockAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: "sheet", entityId: SHEET_ID, action: "markup_published", actorId: ME.id }),
      );
    });

    it("refuses to publish an empty layer and lets document controllers remove published ones", async () => {
      mockPrisma.markup.findFirst.mockResolvedValue({ id: "m-empty", authorId: ME.id, visibility: "personal", shapeCount: 0, sheetId: SHEET_ID });
      await expect(service.publishMarkup({ orgId: ORG, projectId: PROJECT, markupId: "m-empty", viewer: ME })).rejects.toMatchObject({ code: "MARKUP_EMPTY" });

      mockPrisma.markup.findFirst.mockResolvedValue({ id: "m-pub", authorId: "someone", visibility: "published", shapeCount: 3, sheetId: SHEET_ID });
      await expect(service.deleteMarkup({ orgId: ORG, projectId: PROJECT, markupId: "m-pub", viewer: ME })).rejects.toMatchObject({ code: "MARKUP_FORBIDDEN" });
      mockPrisma.markup.delete.mockResolvedValue({});
      expect(await service.deleteMarkup({ orgId: ORG, projectId: PROJECT, markupId: "m-pub", viewer: PM })).toEqual({ deleted: true, id: "m-pub" });
      expect(mockAudit.recordEvent).toHaveBeenLastCalledWith(expect.objectContaining({ action: "markup_removed" }));
    });
  });

  describe("pins", () => {
    it("creates an RFI from a pin, notes the sheet on the record and audits", async () => {
      mockPrisma.sheetRevision.findFirst.mockResolvedValue({ id: "rev-b", revision: "B" });
      mockCreateRfi.mockResolvedValue({ id: "rfi-9", ref: "RFI-009" });
      mockLoadRecord.mockResolvedValue({ record: { id: "rfi-9", status: "open", ref: "RFI-009" }, display: "RFI RFI-009 – Rebar spacing" });

      const result = await service.createPin({
        orgId: ORG,
        projectId: PROJECT,
        sheetId: SHEET_ID,
        sheetRevisionId: "rev-b",
        x: 0.42,
        y: 0.61,
        recordType: "rfi",
        create: { subject: "Rebar spacing", question: "Confirm 200mm centres" },
        actor: { ...PM, projectAccess: { role: "pm" } },
      });

      expect(mockCreateRfi).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            subject: "Rebar spacing",
            question: "Confirm 200mm centres\n\nRaised from Sheet A-101 rev B.",
            discipline: "Architectural",
          }),
          userId: PM.id,
          userRole: "pm",
        }),
      );
      expect(mockPrisma.pin.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sheetId: SHEET_ID, sheetRevisionId: "rev-b", x: 0.42, y: 0.61, recordType: "rfi", recordId: "rfi-9", createdBy: PM.id }) }),
      );
      expect(mockCreateComment).toHaveBeenCalledWith(
        expect.objectContaining({ recordType: "rfi", recordId: "rfi-9", body: "Raised on sheet A-101 rev B." }),
      );
      expect(mockAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: "sheet", action: "pin_added", summary: expect.objectContaining({ recordType: "rfi", created: true }) }),
      );
      expect(result.created).toEqual({ id: "rfi-9", ref: "RFI-009" });
      expect(result.pin).toEqual(
        expect.objectContaining({
          recordType: "rfi",
          recordLabel: "RFI",
          record: expect.objectContaining({ display: "RFI RFI-009 – Rebar spacing", status: "open" }),
          recordPath: `/projects/${PROJECT}/doc-control/rfi?recordId=rfi-9&source=rfi`,
          sheetPath: `/projects/${PROJECT}/doc-control/drawings?recordId=${SHEET_ID}&source=sheet&pin=pin-1`,
        }),
      );
    });

    it("links existing records, rejects unknown targets and photos that do not exist", async () => {
      mockLoadRecord.mockResolvedValue({ record: { id: "def-1", status: "open" }, display: "Defect DEF-001 – Crack" });
      const linked = await service.createPin({ orgId: ORG, projectId: PROJECT, sheetId: SHEET_ID, x: 0.5, y: 0.5, recordType: "defect", recordId: "def-1", actor: ME });
      expect(linked.created).toBeNull();
      expect(mockCreateDefect).not.toHaveBeenCalled();
      expect(mockCreateComment).toHaveBeenCalledWith(expect.objectContaining({ body: "Pinned on sheet A-101." }));

      await expect(
        service.createPin({ orgId: ORG, projectId: PROJECT, sheetId: SHEET_ID, x: 0.5, y: 0.5, recordType: "invoice", recordId: "x", actor: ME }),
      ).rejects.toMatchObject({ code: "PIN_RECORD_TYPE_INVALID" });
      await expect(
        service.createPin({ orgId: ORG, projectId: PROJECT, sheetId: SHEET_ID, x: 0.5, y: 0.5, recordType: "photo", create: { title: "x" }, actor: ME }),
      ).rejects.toMatchObject({ code: "PIN_CREATE_UNSUPPORTED" });
      mockPrisma.photo.findFirst.mockResolvedValue(null);
      await expect(
        service.createPin({ orgId: ORG, projectId: PROJECT, sheetId: SHEET_ID, x: 0.5, y: 0.5, recordType: "photo", recordId: "photo-x", actor: ME }),
      ).rejects.toMatchObject({ code: "PIN_RECORD_NOT_FOUND" });
    });

    it("lists pins with record state and lets only the dropper or a controller remove them", async () => {
      mockPrisma.pin.findMany.mockResolvedValue([
        { id: "pin-1", projectId: PROJECT, sheetId: SHEET_ID, x: 0.1, y: 0.2, recordType: "photo", recordId: "photo-1", createdBy: ME.id, createdAt: new Date() },
      ]);
      mockPrisma.photo.findFirst.mockResolvedValue({ id: "photo-1", caption: "Crack at column", documentId: "doc-1" });
      const list = await service.listPins({ orgId: ORG, projectId: PROJECT, sheetId: SHEET_ID });
      expect(list.items[0].record).toEqual(
        expect.objectContaining({ display: "Crack at column", thumbnailUrl: `/api/v1/projects/${PROJECT}/photos/photo-1/thumbnail` }),
      );

      mockPrisma.pin.findFirst.mockResolvedValue({ id: "pin-1", sheetId: SHEET_ID, recordType: "photo", recordId: "photo-1", createdBy: ME.id });
      await expect(service.deletePin({ orgId: ORG, projectId: PROJECT, pinId: "pin-1", actor: { id: "other", canManage: false } })).rejects.toMatchObject({ code: "PIN_FORBIDDEN" });
      mockPrisma.pin.delete.mockResolvedValue({});
      expect(await service.deletePin({ orgId: ORG, projectId: PROJECT, pinId: "pin-1", actor: ME })).toEqual({ deleted: true, id: "pin-1" });
      expect(mockAudit.recordEvent).toHaveBeenLastCalledWith(expect.objectContaining({ action: "pin_removed" }));
    });
  });
});
