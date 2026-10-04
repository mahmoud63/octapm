const express = require("express");
const request = require("supertest");

/**
 * CERT-2: a reference to a person, a party or a company is an identifier.
 * express-validator's standard validators (isUUID…) check an array element by
 * element, so ["<id>"] passed them and reached the service, which read it as
 * the id inside. These routes refuse a value that is not a string at the
 * door, as invalid input, before the service is called.
 */

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: "user-1", orgId: "org-1", name: "Pat", role: "pm" };
    next();
  },
}));

const mockTimesheets = {
  TIME_TYPES: ["regular", "overtime", "double"],
  STATUS: { DRAFT: "draft", SUBMITTED: "submitted", APPROVED: "approved", REJECTED: "rejected" },
  importWorkers: jest.fn(async () => ({ created: 1, updated: 0, skipped: 0, errors: [] })),
  createWorker: jest.fn(async () => ({ id: "w-1" })),
  updateWorker: jest.fn(async () => ({ id: "w-1" })),
  createCrew: jest.fn(async () => ({ id: "crew-1" })),
  updateCrew: jest.fn(async () => ({ id: "crew-1" })),
};
jest.mock("../../services/timesheet.service", () => mockTimesheets);

const mockDailyLogs = {
  SECTION_KEYS: ["manpower", "equipment", "deliveries", "visitors", "delays", "notes", "quantities"],
  DELAY_TYPES: ["weather"],
  NOTE_KINDS: ["general"],
  DISTRIBUTION_ROLES: ["pm", "site_engineer"],
  distribute: jest.fn(async () => ({ id: "log-1", date: "2026-09-05", sections: {}, totals: {}, distribution: { userIds: [] } })),
};
jest.mock("../../services/daily-log.service", () => mockDailyLogs);
jest.mock("../../services/daily-log-assistant.service", () => ({}));

const timesheets = require("../timesheets");
const dailyLogs = require("../daily-logs");

const PROJECT = "33333333-3333-4333-8333-333333333333";
const ID = "44444444-4444-4444-8444-444444444444";
const CREW = "55555555-5555-4555-8555-555555555555";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/projects/:projectId/timesheets", timesheets);
  app.use("/projects/:projectId/daily-logs", dailyLogs);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ success: false, error: { code: err.code || "INTERNAL_ERROR", message: err.message } }));
  return app;
};

const SHAPES = [["an array holding the id", [ID]], ["an object", { id: ID }], ["a number", 12345]];

describe("CERT-2 — people, party and company references are identifiers", () => {
  beforeEach(() => jest.clearAllMocks());

  it("POST …/timesheets/workers/import: a row's userId or companyId that is not a string is invalid input; a string goes to the service", async () => {
    const app = buildApp();
    for (const field of ["userId", "companyId"]) {
      for (const [, value] of SHAPES) {
        const res = await request(app).post(`/projects/${PROJECT}/timesheets/workers/import`).send({ rows: [{ name: "Row one" }, { name: "Row two", [field]: value }] });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
      }
    }
    expect(mockTimesheets.importWorkers).not.toHaveBeenCalled();
    const ok = await request(app).post(`/projects/${PROJECT}/timesheets/workers/import`).send({ rows: [{ name: "Row one", userId: ID, companyId: ID }, { name: "Row two", userId: null }] });
    expect(ok.status).toBe(200);
    expect(mockTimesheets.importWorkers).toHaveBeenCalledWith(expect.objectContaining({ rows: [{ name: "Row one", userId: ID, companyId: ID }, { name: "Row two", userId: null }] }));
  });

  it("workers and crews: a userId, partyId or foremanUserId that is not a string is invalid input", async () => {
    const app = buildApp();
    for (const [, value] of SHAPES) {
      expect((await request(app).post(`/projects/${PROJECT}/timesheets/workers`).send({ name: "Worker", userId: value })).status).toBe(400);
      expect((await request(app).patch(`/projects/${PROJECT}/timesheets/workers/${ID}`).send({ userId: value })).status).toBe(400);
      for (const field of ["partyId", "foremanUserId", "companyId"]) {
        expect((await request(app).post(`/projects/${PROJECT}/timesheets/crews`).send({ name: "Crew", [field]: value })).status).toBe(400);
        expect((await request(app).patch(`/projects/${PROJECT}/timesheets/crews/${CREW}`).send({ [field]: value })).status).toBe(400);
      }
    }
    expect(mockTimesheets.createWorker).not.toHaveBeenCalled();
    expect(mockTimesheets.updateWorker).not.toHaveBeenCalled();
    expect(mockTimesheets.createCrew).not.toHaveBeenCalled();
    expect(mockTimesheets.updateCrew).not.toHaveBeenCalled();
  });

  it("POST …/daily-logs/{date}/distribute: a person in userIds that is not a string (an array holding an id, an object, a number) is invalid input; ids go to the service", async () => {
    const app = buildApp();
    for (const [, value] of SHAPES) {
      const res = await request(app).post(`/projects/${PROJECT}/daily-logs/2026-09-05/distribute`).send({ roles: [], emails: [], userIds: [value] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    // The list itself must be a list.
    for (const value of [ID, { id: ID }, 12345]) {
      expect((await request(app).post(`/projects/${PROJECT}/daily-logs/2026-09-05/distribute`).send({ userIds: value })).status).toBe(400);
    }
    expect(mockDailyLogs.distribute).not.toHaveBeenCalled();
    const ok = await request(app).post(`/projects/${PROJECT}/daily-logs/2026-09-05/distribute`).send({ roles: [], emails: [], userIds: [ID] });
    expect(ok.status).toBe(200);
    expect(mockDailyLogs.distribute).toHaveBeenCalledWith(expect.objectContaining({ to: { roles: [], userIds: [ID], emails: [] } }));
  });
});
