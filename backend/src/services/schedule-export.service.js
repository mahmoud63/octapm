const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { resolveCalendar, workingDayToDate } = require("./cpm.service");

/**
 * Schedule export in the planners' own formats (OCTA-SCH-LOOKAHEAD-041).
 *
 * The active activities, their dependencies, the WBS and the calendars are
 * written as a Primavera P6 XER file, a Primavera P6 XML file or a Microsoft
 * Project (MSPDI) XML file. Every writer round-trips through this project's
 * own parsers (`parsers/xer-parser`, `p6xml-parser`, `msp-parser`) so what
 * we send out is what we can read back.
 *
 * Units: P6 durations, floats and lags are hours (8 per working day); MSPDI
 * durations are ISO 8601 (`PT40H0M0S`), slack and link lag are tenths of a
 * minute (4800 per working day). Dates carry the working day's start
 * (08:00) or end (17:00).
 */

const HOURS_PER_DAY = 8;
const TENTHS_OF_MINUTES_PER_DAY = 4800;
const PROJECT_OBJECT_ID = 1;
const ACTIVITY_ID_BASE = 1000;
const SHIFTS = [
  ["08:00", "12:00"],
  ["13:00", "17:00"],
];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const FORMATS = Object.freeze({
  xer: { extension: "xer", contentType: "application/octet-stream", label: "Primavera P6 XER" },
  p6xml: { extension: "xml", contentType: "application/xml; charset=utf-8", label: "Primavera P6 XML", suffix: "p6" },
  mspxml: { extension: "xml", contentType: "application/xml; charset=utf-8", label: "Microsoft Project XML", suffix: "msproject" },
});

// ─── Small helpers ────────────────────────────────────────────────────────

const pad = (value) => String(value).padStart(2, "0");
const startOfUtcDay = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};
const datePart = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
/** `YYYY-MM-DD HH:MM` — the XER date format. */
const xerDate = (date, time = "08:00") => (date ? `${datePart(date)} ${time}` : "");
/** `YYYY-MM-DDTHH:MM:SS` — the XML date format both P6 and MS Project accept. */
const xmlDate = (date, time = "08:00") => (date ? `${datePart(date)}T${time}:00` : "");
const START = "08:00";
const END = "17:00";

const hours = (days) => Math.round(Number(days || 0) * HOURS_PER_DAY);
const tenths = (days) => Math.round(Number(days || 0) * TENTHS_OF_MINUTES_PER_DAY);
const isoDuration = (days) => `PT${hours(days)}H0M0S`;
const cleanText = (value) => String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
const xml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (value) =>
  String(value || "project")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "project";

const REL_TYPES = new Set(["FS", "SS", "FF", "SF"]);
const P6_REL_TYPE = { FS: "Finish to Start", SS: "Start to Start", FF: "Finish to Finish", SF: "Start to Finish" };
const XER_REL_TYPE = { FS: "PR_FS", SS: "PR_SS", FF: "PR_FF", SF: "PR_SF" };
const MSP_REL_TYPE = { FF: 0, FS: 1, SF: 2, SS: 3 };

// ─── Export model ─────────────────────────────────────────────────────────

const wbsParentCode = (code, codes) => {
  const parts = String(code).split(/[.\-/ ]/).filter(Boolean);
  for (let length = parts.length - 1; length > 0; length -= 1) {
    const candidates = [parts.slice(0, length).join("."), parts.slice(0, length).join("-"), parts.slice(0, length).join("/")];
    const parent = candidates.find((candidate) => codes.has(candidate) && candidate !== code);
    if (parent) return parent;
  }
  return null;
};

const wbsNamesFrom = (revision) => {
  const names = new Map();
  const nodes = Array.isArray(revision?.snapshotJson?.wbs) ? revision.snapshotJson.wbs : [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.code && node.name) names.set(String(node.code), String(node.name));
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return names;
};

const activityWindow = (activity, project) => {
  const options = { calendarId: activity.calendarId || project.projectCalendar, projectCalendar: project.projectCalendar };
  const fromDay = (day) => (project.startDate && day !== null && day !== undefined ? workingDayToDate(project.startDate, day, options) : null);
  let earlyStart = fromDay(activity.earlyStart) || startOfUtcDay(activity.startDate);
  let earlyFinish = fromDay(activity.earlyFinish) || startOfUtcDay(activity.endDate);
  const duration = Math.max(0, Number(activity.duration || 0));
  if (!earlyStart && earlyFinish) earlyStart = duration ? workingDayToDate(earlyFinish, -Math.max(duration - 1, 0), options) || earlyFinish : earlyFinish;
  if (!earlyStart) earlyStart = startOfUtcDay(project.startDate) || startOfUtcDay(new Date());
  if (!earlyFinish) earlyFinish = duration ? workingDayToDate(earlyStart, Math.max(duration - 1, 0), options) || earlyStart : earlyStart;
  const lateStart = fromDay(activity.lateStart) || earlyStart;
  const lateFinish = fromDay(activity.lateFinish) || earlyFinish;
  return { earlyStart, earlyFinish, lateStart, lateFinish, options };
};

/** Normalises the project's schedule into one model every writer reads. */
function buildExportModel({ project, activities, dependencies = [], revision = null, exportedAt = new Date() }) {
  const calendarKeys = new Set([resolveCalendar(project.projectCalendar).id]);
  activities.forEach((activity) => calendarKeys.add(resolveCalendar(activity.calendarId, project.projectCalendar).id));
  const calendars = [...calendarKeys].map((key, index) => {
    const definition = resolveCalendar(key);
    return { id: index + 1, key, name: definition.label, workingDays: [...definition.workingDays].sort() };
  });
  const calendarIdFor = (calendarId) => calendars.find((calendar) => calendar.key === resolveCalendar(calendarId, project.projectCalendar).id)?.id || calendars[0].id;

  const names = wbsNamesFrom(revision);
  const codes = new Set(activities.map((activity) => cleanText(activity.wbsCode)).filter(Boolean));
  const sortedCodes = [...codes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const rootWbs = { id: 1, code: cleanText(project.contractNumber) || slug(project.name).toUpperCase().slice(0, 20), name: cleanText(project.name), parentId: null, seq: 0, isProject: true };
  const wbs = [rootWbs];
  const wbsIdByCode = new Map();
  sortedCodes.forEach((code, index) => {
    const id = index + 2;
    wbsIdByCode.set(code, id);
    wbs.push({ id, code, name: names.get(code) || code, parentCode: wbsParentCode(code, codes), parentId: null, seq: (index + 1) * 10, isProject: false });
  });
  wbs.forEach((node) => {
    if (node.isProject) return;
    node.parentId = node.parentCode ? wbsIdByCode.get(node.parentCode) || rootWbs.id : rootWbs.id;
    delete node.parentCode;
  });

  const idByUuid = new Map();
  const rows = activities.map((activity, index) => {
    const id = ACTIVITY_ID_BASE + index + 1;
    idByUuid.set(activity.id, id);
    const progress = Array.isArray(activity.progress) ? activity.progress[0] || null : null;
    const pct = Math.min(100, Math.max(0, Number(progress?.pctComplete ?? activity.physComplete ?? 0)));
    const actualStart = startOfUtcDay(progress?.actualStart);
    const actualFinish = pct >= 100 ? startOfUtcDay(progress?.actualFinish) || null : null;
    const window = activityWindow(activity, project);
    const duration = activity.isMilestone ? 0 : Math.max(0, Number(activity.originalDuration ?? activity.duration ?? 0));
    const remaining = pct >= 100 ? 0 : activity.remainingDuration !== null && activity.remainingDuration !== undefined ? Math.max(0, Number(activity.remainingDuration)) : Math.round(duration * (1 - pct / 100));
    const status = pct >= 100 ? "complete" : pct > 0 || actualStart ? "in_progress" : "not_started";
    return {
      id,
      uuid: activity.id,
      code: cleanText(activity.activityCode || activity.p6ActivityId) || `A${ACTIVITY_ID_BASE + (index + 1) * 10}`,
      name: cleanText(activity.name) || `Activity ${index + 1}`,
      wbsId: wbsIdByCode.get(cleanText(activity.wbsCode)) || rootWbs.id,
      wbsCode: cleanText(activity.wbsCode) || null,
      calendarId: calendarIdFor(activity.calendarId),
      isMilestone: Boolean(activity.isMilestone),
      isCritical: Boolean(activity.isCritical),
      originalDurationDays: duration,
      remainingDurationDays: remaining,
      pct,
      status,
      earlyStart: window.earlyStart,
      earlyFinish: window.earlyFinish,
      lateStart: window.lateStart,
      lateFinish: window.lateFinish,
      actualStart,
      actualFinish,
      totalFloatDays: Number(activity.totalFloat ?? 0) || 0,
      sortOrder: Number(activity.sortOrder ?? index),
      seq: (index + 1) * 10,
    };
  });

  const relationships = [];
  const seen = new Set();
  dependencies.forEach((dependency) => {
    const predId = idByUuid.get(dependency.predecessorId);
    const succId = idByUuid.get(dependency.successorId);
    if (!predId || !succId || predId === succId) return;
    const key = `${predId}:${succId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const type = REL_TYPES.has(String(dependency.relationshipType || "").toUpperCase()) ? String(dependency.relationshipType).toUpperCase() : "FS";
    relationships.push({ id: relationships.length + 1, predId, succId, type, lagDays: Math.round(Number(dependency.lagDays || 0)) });
  });

  const starts = rows.map((row) => row.earlyStart).filter(Boolean);
  const finishes = rows.map((row) => row.earlyFinish).filter(Boolean);
  const minDate = (dates) => (dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null);
  const maxDate = (dates) => (dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : null);

  return {
    exportedAt,
    project: {
      id: PROJECT_OBJECT_ID,
      code: rootWbs.code,
      name: rootWbs.name,
      currency: project.currency || "USD",
      startDate: startOfUtcDay(project.startDate) || minDate(starts),
      finishDate: startOfUtcDay(project.endDate) || maxDate(finishes),
      scheduledFinish: maxDate(finishes) || startOfUtcDay(project.endDate),
      dataDate: startOfUtcDay(project.dataDate) || startOfUtcDay(exportedAt),
      calendarId: calendarIdFor(project.projectCalendar),
      revisionLabel: revision?.label || null,
    },
    calendars,
    wbs,
    activities: rows,
    relationships,
  };
}

// ─── Primavera P6 XER ─────────────────────────────────────────────────────

const xerCalendarData = (workingDays) => {
  const days = [];
  for (let day = 1; day <= 7; day += 1) {
    const working = workingDays.includes(day - 1);
    days.push(working ? `(0||${day}()${SHIFTS.map(([start, finish], index) => `(${index}||0(s|${start}|f|${finish}))`).join("")})` : `(0||${day}())`);
  }
  return `(0||CalendarType()(0||DaysOfWeek()${days.join("")})(0||VIEW(ShowTotal|Y)(ShowNonWork|N)(ShowSeparate|N))(0||Exceptions()))`;
};

function writeXer(model) {
  const lines = [];
  const row = (...values) => lines.push(`%R\t${values.map((value) => cleanText(value)).join("\t")}`);
  const table = (name, fields) => {
    lines.push(`%T\t${name}`);
    lines.push(`%F\t${fields.join("\t")}`);
  };
  const stamp = xerDate(startOfUtcDay(model.exportedAt), "00:00");
  lines.push(["ERMHDR", "19.12", datePart(startOfUtcDay(model.exportedAt)), "Project", "admin", "OctaPM", "OctaPM", "Project Management", model.project.currency].join("\t"));

  table("CURRTYPE", ["curr_id", "decimal_digit_cnt", "curr_symbol", "decimal_symbol", "digit_group_symbol", "pos_curr_fmt_type", "neg_curr_fmt_type", "curr_type", "curr_short_name", "group_digit_cnt", "base_exch_rate"]);
  row(1, 2, model.project.currency, ".", ",", "#1.1", "(#1.1)", model.project.currency, model.project.currency, 3, 1);

  table("CALENDAR", ["clndr_id", "default_flag", "clndr_name", "proj_id", "base_clndr_id", "last_chng_date", "clndr_type", "day_hr_cnt", "week_hr_cnt", "month_hr_cnt", "year_hr_cnt", "rsrc_private", "clndr_data"]);
  model.calendars.forEach((calendar) => {
    const weekHours = calendar.workingDays.length * HOURS_PER_DAY;
    row(calendar.id, calendar.id === model.project.calendarId ? "Y" : "N", calendar.name, "", "", stamp, "CA_Base", HOURS_PER_DAY, weekHours, weekHours * 4.3, weekHours * 52, "N", xerCalendarData(calendar.workingDays));
  });

  table("PROJECT", ["proj_id", "fy_start_month_num", "rsrc_self_add_flag", "allow_complete_flag", "allow_neg_act_flag", "sum_only_flag", "proj_short_name", "plan_start_date", "plan_end_date", "scd_end_date", "last_recalc_date", "clndr_id", "project_flag", "task_code_base", "task_code_step", "task_code_prefix", "def_duration_type", "def_complete_pct_type", "def_task_type", "priority_num"]);
  row(model.project.id, 1, "Y", "Y", "N", "N", model.project.code, xerDate(model.project.startDate, START), xerDate(model.project.finishDate, END), xerDate(model.project.scheduledFinish, END), xerDate(model.project.dataDate, START), model.project.calendarId, "Y", ACTIVITY_ID_BASE, 10, "A", "DT_FixedDUR2", "CP_Phys", "TT_Task", 10);

  table("PROJWBS", ["wbs_id", "proj_id", "obs_id", "seq_num", "proj_node_flag", "sum_data_flag", "status_code", "wbs_short_name", "wbs_name", "parent_wbs_id", "est_wt", "ev_user_pct", "ev_etc_user_value"]);
  model.wbs.forEach((node) => row(node.id, model.project.id, "", node.seq, node.isProject ? "Y" : "N", "N", "WS_Open", node.code, node.name, node.parentId ?? "", 1, 6, 0.88));

  table("TASK", ["task_id", "proj_id", "wbs_id", "clndr_id", "phys_complete_pct", "complete_pct_type", "task_type", "duration_type", "status_code", "task_code", "task_name", "total_float_hr_cnt", "free_float_hr_cnt", "remain_drtn_hr_cnt", "target_drtn_hr_cnt", "act_start_date", "act_end_date", "early_start_date", "early_end_date", "late_start_date", "late_end_date", "target_start_date", "target_end_date", "driving_path_flag", "priority_type"]);
  model.activities.forEach((activity) =>
    row(
      activity.id,
      model.project.id,
      activity.wbsId,
      activity.calendarId,
      activity.pct,
      "CP_Phys",
      activity.isMilestone ? "TT_FinMile" : "TT_Task",
      "DT_FixedDUR2",
      activity.status === "complete" ? "TK_Complete" : activity.status === "in_progress" ? "TK_Active" : "TK_NotStart",
      activity.code,
      activity.name,
      hours(activity.totalFloatDays),
      hours(activity.totalFloatDays),
      hours(activity.remainingDurationDays),
      hours(activity.originalDurationDays),
      xerDate(activity.actualStart, START),
      xerDate(activity.actualFinish, END),
      xerDate(activity.earlyStart, START),
      xerDate(activity.earlyFinish, END),
      xerDate(activity.lateStart, START),
      xerDate(activity.lateFinish, END),
      xerDate(activity.earlyStart, START),
      xerDate(activity.earlyFinish, END),
      activity.isCritical ? "Y" : "N",
      "PT_Normal",
    ),
  );

  table("TASKPRED", ["task_pred_id", "task_id", "pred_task_id", "proj_id", "pred_proj_id", "pred_type", "lag_hr_cnt"]);
  model.relationships.forEach((relationship) => row(relationship.id, relationship.succId, relationship.predId, model.project.id, model.project.id, XER_REL_TYPE[relationship.type], hours(relationship.lagDays)));

  lines.push("%E");
  return `${lines.join("\r\n")}\r\n`;
}

// ─── Primavera P6 XML ─────────────────────────────────────────────────────

const tag = (name, value) => (value === null || value === undefined || value === "" ? "" : `<${name}>${xml(value)}</${name}>`);

function writeP6Xml(model) {
  const p6Status = { not_started: "Not Started", in_progress: "In Progress", complete: "Completed" };
  const calendars = model.calendars
    .map(
      (calendar) =>
        `<Calendar>${tag("ObjectId", calendar.id)}${tag("Name", calendar.name)}${tag("Type", "Global")}${tag("IsDefault", calendar.id === model.project.calendarId ? "1" : "0")}${tag("HoursPerDay", HOURS_PER_DAY)}${tag("HoursPerWeek", calendar.workingDays.length * HOURS_PER_DAY)}${tag("HoursPerMonth", 172)}${tag("HoursPerYear", 2000)}<StandardWorkWeek>${DAY_NAMES.map(
          (day, index) =>
            `<StandardWorkHours>${tag("DayOfWeek", day)}${calendar.workingDays.includes(index) ? SHIFTS.map(([start, finish]) => `<WorkTime>${tag("Start", `${start}:00`)}${tag("Finish", `${finish}:00`)}</WorkTime>`).join("") : ""}</StandardWorkHours>`,
        ).join("")}</StandardWorkWeek></Calendar>`,
    )
    .join("");
  const wbs = model.wbs
    .map((node) => `<WBS>${tag("ObjectId", node.id)}${tag("ProjectObjectId", model.project.id)}${tag("Code", node.code)}${tag("Name", node.name)}${node.parentId ? tag("ParentObjectId", node.parentId) : ""}${tag("SequenceNumber", node.seq)}${tag("Status", "Active")}</WBS>`)
    .join("");
  const activities = model.activities
    .map(
      (activity) =>
        `<Activity>${tag("Id", activity.code)}${tag("ObjectId", activity.id)}${tag("Name", activity.name)}${tag("ProjectObjectId", model.project.id)}${tag("WBSObjectId", activity.wbsId)}${tag("CalendarObjectId", activity.calendarId)}${tag("Type", activity.isMilestone ? "Finish Milestone" : "Task Dependent")}${tag("Status", p6Status[activity.status])}${tag("DurationType", "Fixed Duration and Units")}${tag("PercentCompleteType", "Physical")}${tag("PhysicalPercentComplete", activity.pct)}${tag("PlannedDuration", hours(activity.originalDurationDays))}${tag("RemainingDuration", hours(activity.remainingDurationDays))}${tag("PlannedStartDate", xmlDate(activity.earlyStart, START))}${tag("PlannedFinishDate", xmlDate(activity.earlyFinish, END))}${tag("StartDate", xmlDate(activity.actualStart || activity.earlyStart, START))}${tag("FinishDate", xmlDate(activity.actualFinish || activity.earlyFinish, END))}${tag("EarlyStartDate", xmlDate(activity.earlyStart, START))}${tag("EarlyFinishDate", xmlDate(activity.earlyFinish, END))}${tag("LateStartDate", xmlDate(activity.lateStart, START))}${tag("LateFinishDate", xmlDate(activity.lateFinish, END))}${activity.actualStart ? tag("ActualStartDate", xmlDate(activity.actualStart, START)) : ""}${activity.actualFinish ? tag("ActualFinishDate", xmlDate(activity.actualFinish, END)) : ""}${tag("TotalFloat", hours(activity.totalFloatDays))}${tag("IsCritical", activity.isCritical ? "true" : "false")}${tag("SequenceNumber", activity.seq)}</Activity>`,
    )
    .join("");
  const relationships = model.relationships
    .map((relationship) => `<Relationship>${tag("ObjectId", relationship.id)}${tag("PredecessorActivityObjectId", relationship.predId)}${tag("SuccessorActivityObjectId", relationship.succId)}${tag("PredecessorProjectObjectId", model.project.id)}${tag("SuccessorProjectObjectId", model.project.id)}${tag("Type", P6_REL_TYPE[relationship.type])}${tag("Lag", hours(relationship.lagDays))}</Relationship>`)
    .join("");
  const project = `<Project>${tag("ObjectId", model.project.id)}${tag("Id", model.project.code)}${tag("Name", model.project.name)}${tag("Status", "Active")}${tag("ActivityDefaultCalendarObjectId", model.project.calendarId)}${tag("ActivityDefaultDurationType", "Fixed Duration and Units")}${tag("ActivityDefaultPercentCompleteType", "Physical")}${tag("ActivityIdPrefix", "A")}${tag("ActivityIdIncrement", 10)}${tag("PlannedStartDate", xmlDate(model.project.startDate, START))}${tag("ScheduledFinishDate", xmlDate(model.project.scheduledFinish, END))}${tag("DataDate", xmlDate(model.project.dataDate, START))}${tag("FinishDate", xmlDate(model.project.finishDate, END))}${wbs}${activities}${relationships}</Project>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6/V8.3/API/BusinessObjects" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${calendars}${project}</APIBusinessObjects>\n`;
}

// ─── Microsoft Project XML (MSPDI) ────────────────────────────────────────

function writeMspXml(model) {
  const calendar = model.calendars.find((item) => item.id === model.project.calendarId) || model.calendars[0];
  const weekDays = DAY_NAMES.map((_, index) => {
    const working = calendar.workingDays.includes(index);
    return `<WeekDay>${tag("DayType", index + 1)}${tag("DayWorking", working ? 1 : 0)}${working ? `<WorkingTimes>${SHIFTS.map(([start, finish]) => `<WorkingTime>${tag("FromTime", `${start}:00`)}${tag("ToTime", `${finish}:00`)}</WorkingTime>`).join("")}</WorkingTimes>` : ""}</WeekDay>`;
  }).join("");
  const calendars = `<Calendars><Calendar>${tag("UID", 1)}${tag("Name", calendar.name)}${tag("IsBaseCalendar", 1)}${tag("BaseCalendarUID", -1)}<WeekDays>${weekDays}</WeekDays></Calendar></Calendars>`;

  // Outline: the project row, then every WBS node depth-first with its activities.
  const byParent = new Map();
  model.wbs.filter((node) => !node.isProject).forEach((node) => {
    const list = byParent.get(node.parentId) || [];
    list.push(node);
    byParent.set(node.parentId, list);
  });
  const activitiesByWbs = new Map();
  model.activities.forEach((activity) => {
    const list = activitiesByWbs.get(activity.wbsId) || [];
    list.push(activity);
    activitiesByWbs.set(activity.wbsId, list);
  });
  const tasks = [];
  let id = 0;
  const projectStart = model.project.startDate;
  const projectFinish = model.project.scheduledFinish || model.project.finishDate;
  tasks.push(`<Task>${tag("UID", 0)}${tag("ID", 0)}${tag("Name", model.project.name)}${tag("Type", 1)}${tag("IsNull", 0)}${tag("OutlineNumber", 0)}${tag("OutlineLevel", 0)}${tag("Start", xmlDate(projectStart, START))}${tag("Finish", xmlDate(projectFinish, END))}${tag("Summary", 1)}${tag("Milestone", 0)}${tag("CalendarUID", -1)}</Task>`);
  const emitActivity = (activity, level, outline) => {
    id += 1;
    const links = model.relationships
      .filter((relationship) => relationship.succId === activity.id)
      .map((relationship) => `<PredecessorLink>${tag("PredecessorUID", relationship.predId)}${tag("Type", MSP_REL_TYPE[relationship.type])}${tag("CrossProject", 0)}${tag("LinkLag", tenths(relationship.lagDays))}${tag("LagFormat", 7)}</PredecessorLink>`)
      .join("");
    tasks.push(
      `<Task>${tag("UID", activity.id)}${tag("ID", id)}${tag("Name", activity.name)}${tag("Type", 0)}${tag("IsNull", 0)}${tag("WBS", activity.wbsCode ? `${activity.wbsCode}.${activity.code}` : activity.code)}${tag("OutlineNumber", outline)}${tag("OutlineLevel", level)}${tag("Priority", 500)}${tag("Start", xmlDate(activity.actualStart || activity.earlyStart, START))}${tag("Finish", xmlDate(activity.actualFinish || activity.earlyFinish, END))}${tag("Duration", isoDuration(activity.originalDurationDays))}${tag("DurationFormat", 7)}${tag("RemainingDuration", isoDuration(activity.remainingDurationDays))}${tag("Milestone", activity.isMilestone ? 1 : 0)}${tag("Summary", 0)}${tag("Critical", activity.isCritical ? 1 : 0)}${tag("PercentComplete", Math.round(activity.pct))}${tag("PercentWorkComplete", Math.round(activity.pct))}${activity.actualStart ? tag("ActualStart", xmlDate(activity.actualStart, START)) : ""}${activity.actualFinish ? tag("ActualFinish", xmlDate(activity.actualFinish, END)) : ""}${tag("TotalSlack", tenths(activity.totalFloatDays))}${tag("EarlyStart", xmlDate(activity.earlyStart, START))}${tag("EarlyFinish", xmlDate(activity.earlyFinish, END))}${tag("LateStart", xmlDate(activity.lateStart, START))}${tag("LateFinish", xmlDate(activity.lateFinish, END))}${tag("ConstraintType", 0)}${tag("CalendarUID", -1)}${links}</Task>`,
    );
  };
  const emitWbs = (node, level, outline) => {
    id += 1;
    const children = activitiesByWbs.get(node.id) || [];
    const descendants = (byParent.get(node.id) || []).slice();
    const starts = children.map((activity) => activity.earlyStart).filter(Boolean);
    const finishes = children.map((activity) => activity.earlyFinish).filter(Boolean);
    const start = starts.length ? new Date(Math.min(...starts.map((date) => date.getTime()))) : projectStart;
    const finish = finishes.length ? new Date(Math.max(...finishes.map((date) => date.getTime()))) : projectFinish;
    tasks.push(`<Task>${tag("UID", node.id)}${tag("ID", id)}${tag("Name", node.name)}${tag("Type", 1)}${tag("IsNull", 0)}${tag("WBS", node.code)}${tag("OutlineNumber", outline)}${tag("OutlineLevel", level)}${tag("Start", xmlDate(start, START))}${tag("Finish", xmlDate(finish, END))}${tag("Summary", 1)}${tag("Milestone", 0)}${tag("CalendarUID", -1)}</Task>`);
    // A node's own tasks first, then its sub-nodes.
    let child = 0;
    children.forEach((activity) => {
      child += 1;
      emitActivity(activity, level + 1, `${outline}.${child}`);
    });
    descendants.forEach((descendant) => {
      child += 1;
      emitWbs(descendant, level + 1, `${outline}.${child}`);
    });
  };
  let top = 0;
  (byParent.get(model.wbs[0].id) || []).forEach((node) => {
    top += 1;
    emitWbs(node, 1, String(top));
  });
  (activitiesByWbs.get(model.wbs[0].id) || []).forEach((activity) => {
    top += 1;
    emitActivity(activity, 1, String(top));
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Project xmlns="http://schemas.microsoft.com/project">${tag("SaveVersion", 14)}${tag("Name", `${slug(model.project.name)}.xml`)}${tag("Title", model.project.name)}${tag("CreationDate", xmlDate(startOfUtcDay(model.exportedAt), "00:00"))}${tag("ScheduleFromStart", 1)}${tag("StartDate", xmlDate(projectStart, START))}${tag("FinishDate", xmlDate(projectFinish, END))}${tag("StatusDate", xmlDate(model.project.dataDate, START))}${tag("CurrentDate", xmlDate(startOfUtcDay(model.exportedAt), START))}${tag("CalendarUID", 1)}${tag("DefaultStartTime", "08:00:00")}${tag("DefaultFinishTime", "17:00:00")}${tag("MinutesPerDay", HOURS_PER_DAY * 60)}${tag("MinutesPerWeek", calendar.workingDays.length * HOURS_PER_DAY * 60)}${tag("DaysPerMonth", 20)}${tag("DurationFormat", 7)}${tag("WorkFormat", 2)}${tag("CurrencyCode", model.project.currency)}${calendars}<Tasks>${tasks.join("")}</Tasks></Project>\n`;
}

// ─── Entry point ──────────────────────────────────────────────────────────

async function loadExportModel({ orgId, projectId }) {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  const [activities, dependencies, revision] = await Promise.all([
    prisma.activity.findMany({ where: { projectId, isActive: true }, include: { progress: { where: { status: "approved" }, orderBy: { updatedAt: "desc" }, take: 1 } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.activityDependency.findMany({ where: { projectId } }),
    prisma.scheduleRevision.findFirst({ where: { projectId, isActive: true }, select: { id: true, label: true, snapshotJson: true } }).then((active) => active || prisma.scheduleRevision.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" }, select: { id: true, label: true, snapshotJson: true } })),
  ]);
  if (!activities.length) throw new HttpError(400, "SCHEDULE_EMPTY", "There are no activities to export yet");
  return buildExportModel({ project, activities, dependencies, revision });
}

const WRITERS = { xer: writeXer, p6xml: writeP6Xml, mspxml: writeMspXml };

/** Writes the project's schedule in `format` (xer | p6xml | mspxml). */
async function exportSchedule({ orgId, projectId, format }) {
  const key = String(format || "").toLowerCase();
  const spec = FORMATS[key];
  if (!spec) throw new HttpError(400, "EXPORT_FORMAT_INVALID", `Format must be one of ${Object.keys(FORMATS).join(", ")}`);
  const model = await loadExportModel({ orgId, projectId });
  const content = WRITERS[key](model);
  const filename = `${slug(model.project.name)}-schedule${spec.suffix ? `-${spec.suffix}` : ""}.${spec.extension}`;
  return { content, filename, contentType: spec.contentType, format: key, activities: model.activities.length, relationships: model.relationships.length };
}

module.exports = { FORMATS, HOURS_PER_DAY, TENTHS_OF_MINUTES_PER_DAY, buildExportModel, writeXer, writeP6Xml, writeMspXml, loadExportModel, exportSchedule };
