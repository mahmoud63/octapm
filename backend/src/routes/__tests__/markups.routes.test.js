const express = require("express");
const request = require("supertest");

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: "user-1", orgId: "org-1", name: "Amal", role: req.get("x-role") || "site_engineer" };
    next();
  },
}));

const mockService = {
  MAX_SHAPES: 500,
  PIN_TARGETS: { rfi: { module: "rfi", create: true }, defect: { module: "ncr", create: true }, photo: { module: "document_control", create: false } },
  moduleForPinTarget: (type) => ({ rfi: "rfi", defect: "ncr", photo: "document_control" })[type],
  listMarkups: jest.fn(),
  getPersonalMarkup: jest.fn(),
  savePersonalMarkup: jest.fn(),
  updateMarkup: jest.fn(),
  publishMarkup: jest.fn(),
  deleteMarkup: jest.fn(),
  listPins: jest.fn(),
  listPinsForRecord: jest.fn(),
  createPin: jest.fn(),
  deletePin: jest.fn(),
};
jest.mock("../../services/markup.service", () => mockService);

const markupsRouter = require("../markups");
const pinsRouter = require("../pins");
const recordPinsRouter = require("../record-pins");

const SHEET_ID = "11111111-1111-4111-8111-111111111111";
const MARKUP_ID = "22222222-2222-4222-8222-222222222222";
const PIN_ID = "33333333-3333-4333-8333-333333333333";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/projects/:projectId/drawings/sheets/:sheetId/markups", markupsRouter);
  app.use("/projects/:projectId/drawings/sheets/:sheetId/pins", pinsRouter);
  app.use("/projects/:projectId/drawings/pins", recordPinsRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({ success: false, error: { code: err.code || "INTERNAL_ERROR", message: err.message } }),
  );
  return app;
};

describe("markup and pin routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockService.listMarkups.mockResolvedValue({ items: [] });
    mockService.getPersonalMarkup.mockResolvedValue({ id: MARKUP_ID, shapes: [] });
    mockService.savePersonalMarkup.mockResolvedValue({ id: MARKUP_ID, shapes: [] });
    mockService.publishMarkup.mockResolvedValue({ id: MARKUP_ID, visibility: "published" });
    mockService.deleteMarkup.mockResolvedValue({ deleted: true });
    mockService.listPins.mockResolvedValue({ items: [] });
    mockService.listPinsForRecord.mockResolvedValue({ items: [] });
    mockService.createPin.mockResolvedValue({ pin: { id: PIN_ID }, created: null });
    mockService.deletePin.mockResolvedValue({ deleted: true });
  });

  it("gives every reader a personal layer and saves it with a canManage flag for controllers", async () => {
    const app = buildApp();
    const mine = await request(app).get(`/projects/project-1/drawings/sheets/${SHEET_ID}/markups/mine`).set("x-role", "warehouse");
    expect(mine.status).toBe(200);
    expect(mockService.getPersonalMarkup).toHaveBeenCalledWith(
      expect.objectContaining({ sheetId: SHEET_ID, viewer: expect.objectContaining({ id: "user-1", canManage: false }) }),
    );

    const saved = await request(app)
      .put(`/projects/project-1/drawings/sheets/${SHEET_ID}/markups/mine`)
      .set("x-role", "pm")
      .send({ shapes: [{ type: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }], name: "Walkdown" });
    expect(saved.status).toBe(200);
    expect(mockService.savePersonalMarkup).toHaveBeenCalledWith(
      expect.objectContaining({ shapes: [{ type: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }], name: "Walkdown", viewer: expect.objectContaining({ canManage: true }) }),
    );

    const tooBig = await request(app)
      .put(`/projects/project-1/drawings/sheets/${SHEET_ID}/markups/mine`)
      .send({ shapes: Array.from({ length: 501 }, () => ({ type: "rect" })) });
    expect(tooBig.status).toBe(400);
  });

  it("requires document_control.create to publish a layer", async () => {
    const app = buildApp();
    const denied = await request(app).post(`/projects/project-1/drawings/sheets/${SHEET_ID}/markups/${MARKUP_ID}/publish`).set("x-role", "warehouse").send({});
    expect(denied.status).toBe(403);
    const ok = await request(app).post(`/projects/project-1/drawings/sheets/${SHEET_ID}/markups/${MARKUP_ID}/publish`).set("x-role", "site_engineer").send({ name: "Site walk" });
    expect(ok.status).toBe(200);
    expect(mockService.publishMarkup).toHaveBeenCalledWith(expect.objectContaining({ markupId: MARKUP_ID, name: "Site walk" }));
  });

  it("checks the target module when a pin creates or links a record", async () => {
    const app = buildApp();
    // site engineers may create RFIs
    const created = await request(app)
      .post(`/projects/project-1/drawings/sheets/${SHEET_ID}/pins`)
      .set("x-role", "site_engineer")
      .send({ x: 0.4, y: 0.6, recordType: "rfi", create: { subject: "Rebar" } });
    expect(created.status).toBe(201);
    expect(mockService.createPin).toHaveBeenCalledWith(
      expect.objectContaining({ sheetId: SHEET_ID, x: 0.4, y: 0.6, recordType: "rfi", create: { subject: "Rebar" }, actor: expect.objectContaining({ role: "site_engineer" }) }),
    );

    // warehouse cannot create RFIs but may link one it can read
    const cannotCreate = await request(app)
      .post(`/projects/project-1/drawings/sheets/${SHEET_ID}/pins`)
      .set("x-role", "warehouse")
      .send({ x: 0.4, y: 0.6, recordType: "rfi", create: { subject: "Rebar" } });
    expect(cannotCreate.status).toBe(403);
    const canLink = await request(app)
      .post(`/projects/project-1/drawings/sheets/${SHEET_ID}/pins`)
      .set("x-role", "warehouse")
      .send({ x: 0.4, y: 0.6, recordType: "rfi", recordId: "rfi-1" });
    expect(canLink.status).toBe(201);

    const outOfPage = await request(app).post(`/projects/project-1/drawings/sheets/${SHEET_ID}/pins`).send({ x: 1.4, y: 0.6, recordType: "rfi", recordId: "rfi-1" });
    expect(outOfPage.status).toBe(400);
  });

  it("lists pins per sheet or per record and deletes by id", async () => {
    const app = buildApp();
    const bySheet = await request(app).get(`/projects/project-1/drawings/sheets/${SHEET_ID}/pins`);
    expect(bySheet.status).toBe(200);
    expect(mockService.listPins).toHaveBeenCalledWith(expect.objectContaining({ sheetId: SHEET_ID }));

    const byRecord = await request(app).get("/projects/project-1/drawings/pins?recordType=rfi&recordId=rfi-1");
    expect(byRecord.status).toBe(200);
    expect(mockService.listPinsForRecord).toHaveBeenCalledWith(expect.objectContaining({ recordType: "rfi", recordId: "rfi-1" }));

    const missing = await request(app).get("/projects/project-1/drawings/pins");
    expect(missing.status).toBe(400);

    const removed = await request(app).delete(`/projects/project-1/drawings/pins/${PIN_ID}`);
    expect(removed.status).toBe(200);
    expect(mockService.deletePin).toHaveBeenCalledWith(expect.objectContaining({ pinId: PIN_ID }));
  });
});
