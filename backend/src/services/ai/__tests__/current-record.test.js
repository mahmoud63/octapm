jest.mock("../../../config/db", () => ({ prisma: { rfi: { findFirst: jest.fn() }, dailyLog: { findFirst: jest.fn() }, project: { findFirst: jest.fn(async () => ({ name: "Riverside Tower" })) } } }));
jest.mock("../../document-text.service", () => ({ documentViewer: jest.fn((args) => ({ ...args })), recordVisibleToViewer: jest.fn() }));
jest.mock("../../../middleware/rbac", () => ({ hasPermission: jest.fn(), getEffectiveRole: jest.fn(() => "pm") }));
jest.mock("../../meeting.service", () => ({ getMeetingById: jest.fn() }));
jest.mock("../../daily-log.service", () => ({ getLog: jest.fn(), renderText: jest.fn(() => "Daily log — Riverside Tower — 2026-10-09\nStatus: submitted") }));
jest.mock("../../../utils/boq-figures", () => ({ boqFigureAccess: jest.fn(() => ({ boq: false, budget: false })), withheldDailyLog: jest.fn((log) => ({ ...log, withheld: true })) }));

const { prisma } = require("../../../config/db");
const documentText = require("../../document-text.service");
const { hasPermission } = require("../../../middleware/rbac");
const dailyLogs = require("../../daily-log.service");
const { withheldDailyLog } = require("../../../utils/boq-figures");
const { currentRecordSource } = require("../sources/current-record");

const P = "11111111-1111-4111-8111-111111111111";
const R = "22222222-2222-4222-8222-222222222222";
const view = { user: { id: "u-1", orgId: "org-1" }, projectAccess: { id: P, partyAccess: [] } };

describe("the record on the caller's screen (AI UX correction)", () => {
  beforeEach(() => jest.clearAllMocks());

  test("a record the caller's viewer may not see is never read", async () => {
    documentText.recordVisibleToViewer.mockResolvedValue(false);
    expect(await currentRecordSource({ view, projectId: P, recordType: "rfi", recordId: R })).toBeNull();
    expect(documentText.recordVisibleToViewer).toHaveBeenCalledWith({ recordType: "rfi", recordId: R, viewer: expect.objectContaining({ userId: "u-1", canRead: expect.any(Function) }) });
    expect(prisma.rfi.findFirst).not.toHaveBeenCalled();
  });

  test("a visible record is read only within the project, as the source on screen", async () => {
    documentText.recordVisibleToViewer.mockResolvedValue(true);
    prisma.rfi.findFirst.mockResolvedValue({ id: R, subject: "Slab edge detail", question: "What is the detail?", response: null, status: "open" });
    const source = await currentRecordSource({ view, projectId: P, recordType: "rfi", recordId: R });
    expect(prisma.rfi.findFirst.mock.calls[0][0].where).toEqual({ id: R, projectId: P });
    expect(source).toMatchObject({ id: R, type: "rfi", title: "Slab edge detail", status: "open", url: `/projects/${P}?recordId=${R}` });
    expect(source.text).toMatch(/Question: What is the detail\?/);
  });

  test("no caller, no read", async () => {
    expect(await currentRecordSource({ view: { user: null }, projectId: P, recordType: "rfi", recordId: R })).toBeNull();
    expect(documentText.recordVisibleToViewer).not.toHaveBeenCalled();
  });

  test("a meeting is read through its route's own path, only with meeting read", async () => {
    const meetings = require("../../meeting.service");
    hasPermission.mockReturnValue(false);
    expect(await currentRecordSource({ view, projectId: P, recordType: "meeting", recordId: R })).toBeNull();
    expect(meetings.getMeetingById).not.toHaveBeenCalled();
    hasPermission.mockImplementation((_view, moduleName) => moduleName === "meeting");
    meetings.getMeetingById.mockResolvedValue({ id: R, meetingNumber: "MTG-004", title: "Site coordination", meetingType: "coordination", status: "held", attendees: [{ name: "Dana", companyName: "Acme" }], agendaItems: [{ title: "Facade", notes: "Panels late", status: "discussed" }], decisions: [{ title: "Resequence", decision: "Start level 9 first" }], actionItems: [{ itemNumber: 1, title: "Chase fabricator", ownerName: "Sam", dueDate: "2026-10-15T00:00:00.000Z", status: "open" }], minutesText: null });
    const source = await currentRecordSource({ view, projectId: P, recordType: "meeting", recordId: R });
    expect(meetings.getMeetingById).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", projectId: P, meetingId: R, userId: "u-1", projectAccess: view.projectAccess }));
    expect(source.text).toMatch(/Recorded decision: Resequence - Start level 9 first/);
    expect(source.text).toMatch(/Recorded action 1: Chase fabricator; owner Sam; due 2026-10-15; open/);
    meetings.getMeetingById.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
    expect(await currentRecordSource({ view, projectId: P, recordType: "meeting", recordId: R })).toBeNull();
  });

  test("a daily report needs progress read, and comes withheld as its route withholds it", async () => {
    hasPermission.mockReturnValue(false);
    expect(await currentRecordSource({ view, projectId: P, recordType: "daily_log", recordId: R })).toBeNull();
    expect(prisma.dailyLog.findFirst).not.toHaveBeenCalled();

    hasPermission.mockImplementation((_view, moduleName) => moduleName === "progress");
    prisma.dailyLog.findFirst.mockResolvedValue({ date: new Date("2026-10-09T00:00:00Z") });
    dailyLogs.getLog.mockResolvedValue({ id: R, date: "2026-10-09", status: "submitted" });
    const source = await currentRecordSource({ view, projectId: P, recordType: "daily_log", recordId: R });
    expect(dailyLogs.getLog).toHaveBeenCalledWith({ orgId: "org-1", projectId: P, date: "2026-10-09", viewer: { id: "u-1", projectAccess: view.projectAccess } });
    expect(withheldDailyLog).toHaveBeenCalled();
    expect(dailyLogs.renderText.mock.calls[0][0].log.withheld).toBe(true);
    expect(source).toMatchObject({ type: "daily_log", status: "submitted", ref: "2026-10-09" });
  });
});
