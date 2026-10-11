const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");

/**
 * Progress reports the contractor issues (CONSULTANT V1): a monthly report by
 * default — its period, text and attached files (attachments on
 * progress_report). Submitted to a consultant through the external review
 * engine, which keeps every issued revision; while a revision is out for
 * review (or answered and not yet revised) the report cannot be edited.
 */

const KINDS = Object.freeze(["monthly", "weekly", "special"]);
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const text = (value, max) => {
  const out = String(value ?? "").trim();
  return out ? out.slice(0, max) : null;
};
const monthName = (period) => new Date(`${period}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

const serialize = (row, users = new Map()) => ({
  id: row.id,
  ref: row.ref,
  kind: row.kind,
  period: row.period,
  title: row.title,
  summary: row.summary,
  status: row.status,
  revision: row.revision,
  activityId: row.activityId,
  createdBy: users.get(row.createdBy) || null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const usersFor = async (rows) => {
  const ids = [...new Set(rows.map((row) => row.createdBy).filter(Boolean))];
  return new Map((ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map((user) => [user.id, user.name]));
};

/** A party sees only issued reports; the contractor sees drafts too. */
const visibility = (viewer) => (viewer?.partyScoped ? { status: "issued" } : {});

const list = async ({ orgId, projectId, viewer }) => {
  const rows = await prisma.progressReport.findMany({ where: { orgId, projectId, ...visibility(viewer) }, orderBy: [{ period: "desc" }, { number: "desc" }] });
  const users = await usersFor(rows);
  return { items: rows.map((row) => serialize(row, users)), kinds: KINDS };
};

const get = async ({ orgId, projectId, viewer, id }) => {
  const row = await prisma.progressReport.findFirst({ where: { id, orgId, projectId, ...visibility(viewer) } });
  if (!row) throw new HttpError(404, "PROGRESS_REPORT_NOT_FOUND", "Report not found");
  return serialize(row, await usersFor([row]));
};

const create = async ({ orgId, projectId, actor, payload }) => {
  const period = text(payload.period, 7);
  if (!period || !PERIOD.test(period)) throw new HttpError(400, "VALIDATION_ERROR", "The period is a month (YYYY-MM)");
  const kind = KINDS.includes(payload.kind) ? payload.kind : "monthly";
  const title = text(payload.title, 200) || `${kind === "monthly" ? "Monthly Progress Report" : "Progress Report"} — ${monthName(period)}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const number = ((await prisma.progressReport.aggregate({ where: { projectId }, _max: { number: true } }))._max.number || 0) + 1;
    try {
      const row = await prisma.progressReport.create({ data: { orgId, projectId, number, ref: `MPR-${String(number).padStart(3, "0")}`, kind, period, title, summary: text(payload.summary, 20000), createdBy: actor.id, updatedBy: actor.id } });
      await auditService.recordEvent({ orgId, projectId, entityType: auditService.ENTITY_TYPES.PROGRESS_REPORT, entityId: row.id, action: auditService.ACTIONS.CREATED, actorId: actor.id, summary: { ref: row.ref, title: row.title, period } }).catch(() => null);
      return serialize(row, await usersFor([row]));
    } catch (error) {
      if (error?.code !== "P2002" || attempt === 2) throw error;
    }
  }
  return null;
};

const update = async ({ orgId, projectId, actor, id, payload }) => {
  const row = await prisma.progressReport.findFirst({ where: { id, orgId, projectId } });
  if (!row) throw new HttpError(404, "PROGRESS_REPORT_NOT_FOUND", "Report not found");
  await require("./external-review.service").assertSourceEditable({ projectId, sourceType: "progress_report", sourceId: id });
  const data = {};
  if (payload.title !== undefined) data.title = text(payload.title, 200) || row.title;
  if (payload.summary !== undefined) data.summary = text(payload.summary, 20000);
  if (payload.period !== undefined) {
    if (!PERIOD.test(String(payload.period))) throw new HttpError(400, "VALIDATION_ERROR", "The period is a month (YYYY-MM)");
    data.period = payload.period;
  }
  const saved = await prisma.progressReport.update({ where: { id }, data: { ...data, updatedBy: actor.id } });
  await auditService.recordEvent({ orgId, projectId, entityType: auditService.ENTITY_TYPES.PROGRESS_REPORT, entityId: id, action: auditService.ACTIONS.UPDATED, actorId: actor.id, summary: { ref: row.ref, fields: Object.keys(data), revision: row.revision } }).catch(() => null);
  return serialize(saved, await usersFor([saved]));
};

const remove = async ({ orgId, projectId, actor, id }) => {
  const row = await prisma.progressReport.findFirst({ where: { id, orgId, projectId } });
  if (!row) throw new HttpError(404, "PROGRESS_REPORT_NOT_FOUND", "Report not found");
  const reviewed = await prisma.externalSubmission.count({ where: { projectId, sourceType: "progress_report", sourceId: id } });
  if (reviewed || row.status !== "draft") throw new HttpError(409, "PROGRESS_REPORT_ISSUED", "A report that was issued for review is kept");
  await prisma.progressReport.delete({ where: { id } });
  await auditService.recordEvent({ orgId, projectId, entityType: auditService.ENTITY_TYPES.PROGRESS_REPORT, entityId: id, action: auditService.ACTIONS.DELETED, actorId: actor.id, summary: { ref: row.ref } }).catch(() => null);
  return { deleted: true };
};

module.exports = { KINDS, list, get, create, update, remove };
