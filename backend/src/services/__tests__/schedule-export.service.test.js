const PROJECT = { id: "p1", orgId: "org-1", name: "Riverside Tower", contractNumber: "RT-2026", currency: "AED", startDate: new Date("2026-09-07T00:00:00Z"), endDate: new Date("2027-03-31T00:00:00Z"), dataDate: new Date("2026-09-16T00:00:00Z"), projectCalendar: "five_day" };
const day = (value) => new Date(`${value}T00:00:00.000Z`);
const ACTIVITIES = [
  { id: "act-1", projectId: "p1", name: "Mobilise <site>", activityCode: "A1000", wbsCode: "1", duration: 5, originalDuration: 5, earlyStart: 0, earlyFinish: 4, lateStart: 0, lateFinish: 4, totalFloat: 0, isCritical: true, isMilestone: false, sortOrder: 0, progress: [{ pctComplete: 100, actualStart: day("2026-09-07"), actualFinish: day("2026-09-11") }] },
  { id: "act-2", projectId: "p1", name: "Excavate footings", activityCode: "A1010", wbsCode: "1.1", duration: 10, originalDuration: 10, earlyStart: 5, earlyFinish: 14, lateStart: 5, lateFinish: 14, totalFloat: 0, isCritical: true, isMilestone: false, sortOrder: 1, progress: [{ pctComplete: 40, actualStart: day("2026-09-14"), actualFinish: null }] },
  { id: "act-3", projectId: "p1", name: "Site fence", activityCode: "A1020", wbsCode: "2", duration: 3, originalDuration: 3, earlyStart: 0, earlyFinish: 2, lateStart: 12, lateFinish: 14, totalFloat: 12, isCritical: false, isMilestone: false, sortOrder: 2, progress: [] },
  { id: "act-4", projectId: "p1", name: "Footings complete", activityCode: "A1030", wbsCode: "1.1", duration: 0, originalDuration: 0, earlyStart: 15, earlyFinish: 15, lateStart: 15, lateFinish: 15, totalFloat: 0, isCritical: true, isMilestone: true, sortOrder: 3, progress: [] },
];
const DEPENDENCIES = [
  { id: "d1", projectId: "p1", predecessorId: "act-1", successorId: "act-2", relationshipType: "FS", lagDays: 0 },
  { id: "d2", projectId: "p1", predecessorId: "act-1", successorId: "act-3", relationshipType: "SS", lagDays: 1 },
  { id: "d3", projectId: "p1", predecessorId: "act-2", successorId: "act-4", relationshipType: "FS", lagDays: 0 },
  { id: "d4", projectId: "p1", predecessorId: "act-9", successorId: "act-4", relationshipType: "FS", lagDays: 0 },
];
const REVISION = { id: "rev-1", label: "Rev 2", snapshotJson: { wbs: [{ code: "1", name: "Substructure", children: [{ code: "1.1", name: "Footings" }] }, { code: "2", name: "Site works" }] } };

const mockPrisma = {
  project: { findFirst: jest.fn(async ({ where }) => (where.id === "p1" ? PROJECT : null)) },
  activity: { findMany: jest.fn(async () => ACTIVITIES.map((activity) => ({ ...activity }))) },
  activityDependency: { findMany: jest.fn(async () => DEPENDENCIES) },
  scheduleRevision: { findFirst: jest.fn(async ({ where }) => (where.isActive ? null : REVISION)) },
};
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const service = require("../schedule-export.service");
const { parseXer, extractActivities, extractRelationships } = require("../../parsers/xer-parser");
const { parseP6Xml } = require("../../parsers/p6xml-parser");
const { parseMspXml, parseDurationDays, parseLagDays, tenthsOfMinutesToDays } = require("../../parsers/msp-parser");

const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

describe("schedule export", () => {
  it("builds one model from the schedule: calendars, a WBS tree with names, activities with dates, status and remaining duration, valid relationships only", async () => {
    const model = await service.loadExportModel({ orgId: "org-1", projectId: "p1" });
    expect(model.project).toMatchObject({ id: 1, code: "RT-2026", name: "Riverside Tower", currency: "AED" });
    expect(model.calendars).toEqual([{ id: 1, key: "five_day", name: "Five-day workweek", workingDays: [1, 2, 3, 4, 5] }]);
    expect(model.wbs.map((node) => [node.code, node.name, node.parentId])).toEqual([
      ["RT-2026", "Riverside Tower", null],
      ["1", "Substructure", 1],
      ["1.1", "Footings", 2],
      ["2", "Site works", 1],
    ]);
    const byCode = Object.fromEntries(model.activities.map((activity) => [activity.code, activity]));
    expect(byCode.A1000).toMatchObject({ id: 1001, name: "Mobilise <site>", wbsId: 2, status: "complete", pct: 100, originalDurationDays: 5, remainingDurationDays: 0 });
    expect(byCode.A1000.actualFinish.toISOString()).toBe("2026-09-11T00:00:00.000Z");
    expect(byCode.A1010).toMatchObject({ status: "in_progress", pct: 40, remainingDurationDays: 6, wbsId: 3 });
    expect(byCode.A1010.earlyStart.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(byCode.A1010.earlyFinish.toISOString()).toBe("2026-09-25T00:00:00.000Z");
    expect(byCode.A1020).toMatchObject({ status: "not_started", totalFloatDays: 12, isCritical: false });
    expect(byCode.A1020.lateFinish.toISOString()).toBe("2026-09-25T00:00:00.000Z");
    expect(byCode.A1030).toMatchObject({ isMilestone: true, originalDurationDays: 0 });
    expect(model.relationships).toEqual([
      { id: 1, predId: 1001, succId: 1002, type: "FS", lagDays: 0 },
      { id: 2, predId: 1001, succId: 1003, type: "SS", lagDays: 1 },
      { id: 3, predId: 1002, succId: 1004, type: "FS", lagDays: 0 },
    ]);
    await expect(service.exportSchedule({ orgId: "org-1", projectId: "p1", format: "csv" })).rejects.toMatchObject({ code: "EXPORT_FORMAT_INVALID" });
    mockPrisma.activity.findMany.mockResolvedValueOnce([]);
    await expect(service.exportSchedule({ orgId: "org-1", projectId: "p1", format: "xer" })).rejects.toMatchObject({ code: "SCHEDULE_EMPTY" });
  });

  it("writes a P6 XER that our own XER parser reads back (hours = days × 8)", async () => {
    const result = await service.exportSchedule({ orgId: "org-1", projectId: "p1", format: "xer" });
    expect(result).toMatchObject({ filename: "riverside-tower-schedule.xer", contentType: "application/octet-stream", activities: 4, relationships: 3 });
    expect(result.content.startsWith("ERMHDR\t19.12\t")).toBe(true);
    expect(result.content.trim().endsWith("%E")).toBe(true);
    const tables = parseXer(result.content);
    expect(Object.keys(tables)).toEqual(expect.arrayContaining(["CURRTYPE", "CALENDAR", "PROJECT", "PROJWBS", "TASK", "TASKPRED"]));
    expect(tables.PROJECT[0]).toMatchObject({ proj_id: "1", proj_short_name: "RT-2026", plan_start_date: "2026-09-07 08:00", last_recalc_date: "2026-09-16 08:00" });
    expect(tables.PROJWBS.map((row) => [row.wbs_short_name, row.wbs_name, row.parent_wbs_id, row.proj_node_flag])).toEqual([
      ["RT-2026", "Riverside Tower", "", "Y"],
      ["1", "Substructure", "1", "N"],
      ["1.1", "Footings", "2", "N"],
      ["2", "Site works", "1", "N"],
    ]);
    const { activities, wbsNodes, calendars } = extractActivities(tables);
    expect(calendars).toEqual([{ calendarId: "1", name: "Five-day workweek" }]);
    expect(wbsNodes).toHaveLength(4);
    expect(activities.map((activity) => [activity.p6ActivityId, activity.name, activity.wbsCode, activity.originalDuration, activity.remainingDuration, activity.physComplete, activity.totalFloat])).toEqual([
      ["A1000", "Mobilise <site>", "1", 5, 0, 100, 0],
      ["A1010", "Excavate footings", "1.1", 10, 6, 40, 0],
      ["A1020", "Site fence", "2", 3, 3, 0, 12],
      ["A1030", "Footings complete", "1.1", 0, 0, 0, 0],
    ]);
    expect(localDate(activities[1].earlyStartDate)).toBe("2026-09-14");
    expect(localDate(activities[1].earlyFinishDate)).toBe("2026-09-25");
    expect(localDate(activities[2].lateFinishDate)).toBe("2026-09-25");
    expect(tables.TASK.map((row) => [row.task_code, row.status_code, row.task_type, row.act_start_date, row.act_end_date])).toEqual([
      ["A1000", "TK_Complete", "TT_Task", "2026-09-07 08:00", "2026-09-11 17:00"],
      ["A1010", "TK_Active", "TT_Task", "2026-09-14 08:00", ""],
      ["A1020", "TK_NotStart", "TT_Task", "", ""],
      ["A1030", "TK_NotStart", "TT_FinMile", "", ""],
    ]);
    expect(extractRelationships(tables)).toEqual([
      { succTaskId: "1002", predTaskId: "1001", relType: "FS", lagDays: 0 },
      { succTaskId: "1003", predTaskId: "1001", relType: "SS", lagDays: 1 },
      { succTaskId: "1004", predTaskId: "1002", relType: "FS", lagDays: 0 },
    ]);
    expect(tables.CALENDAR[0].clndr_data).toContain("(0||2()(0||0(s|08:00|f|12:00))(1||0(s|13:00|f|17:00)))");
    expect(tables.CALENDAR[0].clndr_data).toContain("(0||1())");
  });

  it("writes a P6 XML that our own P6 XML parser reads back", async () => {
    const result = await service.exportSchedule({ orgId: "org-1", projectId: "p1", format: "p6xml" });
    expect(result).toMatchObject({ filename: "riverside-tower-schedule-p6.xml", contentType: "application/xml; charset=utf-8" });
    expect(result.content).toContain('xmlns="http://xmlns.oracle.com/Primavera/P6/V8.3/API/BusinessObjects"');
    expect(result.content).toContain("<Name>Mobilise &lt;site&gt;</Name>");
    const parsed = await parseP6Xml(result.content);
    expect(parsed.activities.map((activity) => [activity.p6ActivityId, activity.sourceActivityId, activity.name, activity.wbsId, activity.plannedDurationHours, activity.remainingDurationHours, activity.physComplete, activity.totalFloatHours, activity.status])).toEqual([
      ["A1000", "1001", "Mobilise <site>", "2", 40, 0, 100, 0, "Completed"],
      ["A1010", "1002", "Excavate footings", "3", 80, 48, 40, 0, "In Progress"],
      ["A1020", "1003", "Site fence", "4", 24, 24, 0, 96, "Not Started"],
      ["A1030", "1004", "Footings complete", "3", 0, 0, 0, 0, "Not Started"],
    ]);
    expect(parsed.activities[1].earlyStart).toBe("2026-09-14T08:00:00");
    expect(parsed.activities[1].earlyFinish).toBe("2026-09-25T17:00:00");
    expect(parsed.relationships).toEqual([
      { succId: "1002", predId: "1001", type: "FS", lagDays: 0 },
      { succId: "1003", predId: "1001", type: "SS", lagDays: 1 },
      { succId: "1004", predId: "1002", type: "FS", lagDays: 0 },
    ]);
    expect(parsed.wbsNodes.map((node) => [node.objectId, node.code, node.name, node.parentObjectId])).toEqual([
      ["1", "RT-2026", "Riverside Tower", null],
      ["2", "1", "Substructure", "1"],
      ["3", "1.1", "Footings", "2"],
      ["4", "2", "Site works", "1"],
    ]);
    expect(result.content).toContain("<Type>Finish Milestone</Type>");
    expect(result.content).toContain("<DayOfWeek>Monday</DayOfWeek><WorkTime><Start>08:00:00</Start>");
  });

  it("writes a Microsoft Project XML (MSPDI) that our own MSP parser reads back: ISO durations, slack and lag in tenths of minutes", async () => {
    const result = await service.exportSchedule({ orgId: "org-1", projectId: "p1", format: "mspxml" });
    expect(result).toMatchObject({ filename: "riverside-tower-schedule-msproject.xml" });
    expect(result.content).toContain('<Project xmlns="http://schemas.microsoft.com/project">');
    const parsed = await parseMspXml(result.content);
    const summaries = parsed.tasks.filter((task) => task.isSummary);
    expect(summaries.map((task) => [task.uid, task.name, task.wbsCode, task.outlineLevel])).toEqual([
      ["0", "Riverside Tower", null, 0],
      ["2", "Substructure", "1", 1],
      ["3", "Footings", "1.1", 2],
      ["4", "Site works", "2", 1],
    ]);
    const work = parsed.tasks.filter((task) => !task.isSummary);
    expect(work.map((task) => [task.uid, task.name, task.outlineLevel, parseDurationDays(task.durationIso), task.percentComplete, tenthsOfMinutesToDays(task.totalSlackMinutes), task.isMilestone])).toEqual([
      ["1001", "Mobilise <site>", 2, 5, 100, 0, false],
      ["1002", "Excavate footings", 3, 10, 40, 0, false],
      ["1004", "Footings complete", 3, 0, 0, 0, true],
      ["1003", "Site fence", 2, 3, 0, 12, false],
    ]);
    expect(work[1].start).toBe("2026-09-14T08:00:00");
    expect(work[1].finish).toBe("2026-09-25T17:00:00");
    const fence = work.find((task) => task.uid === "1003");
    expect(fence.predecessors).toEqual([{ predUid: "1001", type: "SS", lagDurationIso: "4800" }]);
    expect(parseLagDays(fence.predecessors[0].lagDurationIso)).toBe(1);
    expect(result.content).toContain("<Duration>PT80H0M0S</Duration>");
    expect(result.content).toContain("<TotalSlack>57600</TotalSlack>");
    expect(result.content).toContain("<DayType>1</DayType><DayWorking>0</DayWorking>");
    expect(result.content).toContain("<DayType>2</DayType><DayWorking>1</DayWorking><WorkingTimes>");
  });
});
