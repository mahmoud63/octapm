const crypto = require("crypto");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { recordWorkspacePath } = require("../utils/record-links");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");
const emailService = require("./email.service");
const { nextNumber: nextCounterNumber } = require("../utils/reference-number");

/**
 * Change events and RFQs (OCTA-COM-CE-038).
 *
 *  - A change event captures a potential change (owner request, design
 *    change, site condition, error / omission, allowance draw) before it is
 *    priced: scope lines with a rough order of magnitude, the activity and
 *    location, the record it came from.
 *  - RFQs go to vendors (a commitment's vendor or an ad-hoc contact) with a
 *    public token link; the vendor quotes line by line, the team accepts
 *    one quote per line set — accepted quotes on a commitment can become
 *    commitment change orders.
 *  - Conversion creates the prime change order through the change-order
 *    service (value = quoted else ROM, affected activities from the lines)
 *    and links accepted commitment change orders to it.
 */

const STATUS = Object.freeze({ OPEN: "open", PRICING: "pricing", PRICED: "priced", CONVERTED: "converted", CLOSED: "closed", VOID: "void" });
const TYPES = Object.freeze(["owner_change", "design_change", "site_condition", "error_omission", "allowance", "value_engineering", "other"]);
const ORIGINS = Object.freeze(["manual", "rfi", "submittal", "daily_log", "observation", "meeting", "other"]);
const RFQ_STATUS = Object.freeze({ SENT: "sent", VIEWED: "viewed", QUOTED: "quoted", DECLINED: "declined", ACCEPTED: "accepted", REJECTED: "rejected", CANCELLED: "cancelled" });
const RFQ_OPEN = [RFQ_STATUS.SENT, RFQ_STATUS.VIEWED, RFQ_STATUS.QUOTED];
const LINK_DAYS = () => Math.max(1, Number(process.env.RFQ_LINK_DAYS || 45));

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const round2 = (value) => Math.round(toNumber(value) * 100) / 100;
const money = (value) => (value === null || value === undefined ? null : round2(Number(value)));
const uniqueIds = (values) => [...new Set((values || []).filter(Boolean))];
const optionalDate = (value, field) => {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "CHANGE_EVENT_DATE_INVALID", `${field} is not a valid date`);
  return date;
};
const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
const newToken = () => crypto.randomBytes(24).toString("base64url");
const webAppUrl = () => (process.env.WEB_APP_URL || "http://localhost:5173").replace(/\/$/, "");
const portalUrl = (token) => `${webAppUrl()}/rfq/${token}`;
const linkExpiry = (dueDate) => new Date(Math.max(Date.now() + LINK_DAYS() * 86_400_000, dueDate ? new Date(dueDate).getTime() + 7 * 86_400_000 : 0));

// ─── Serialisers ──────────────────────────────────────────────────────────

const lineOut = (row) => ({
  id: row.id,
  description: row.description,
  costCodeId: row.costCodeId || null,
  costCode: row.costCode ? { id: row.costCode.id, code: row.costCode.code, name: row.costCode.name } : null,
  budgetLineId: row.budgetLineId || null,
  activityId: row.activityId || null,
  activity: row.activity ? { id: row.activity.id, name: row.activity.name, code: row.activity.activityCode || row.activity.wbsCode || null } : null,
  commitmentId: row.commitmentId || null,
  commitment: row.commitment ? { id: row.commitment.id, ref: row.commitment.ref, title: row.commitment.title, vendorName: row.commitment.vendorCompany?.name || null } : null,
  quantity: toNumber(row.quantity, 1),
  unit: row.unit || null,
  unitCost: money(row.unitCost) || 0,
  romAmount: money(row.romAmount) || 0,
  quotedAmount: money(row.quotedAmount),
  quotedRfqId: row.quotedRfqId || null,
  amount: row.quotedAmount === null || row.quotedAmount === undefined ? money(row.romAmount) || 0 : money(row.quotedAmount),
  notes: row.notes || null,
  sortOrder: row.sortOrder,
});

const quoteLines = (row) => (Array.isArray(row.quoteLinesJson) ? row.quoteLinesJson : []).map((line) => ({ lineId: line.lineId, amount: money(line.amount), note: line.note || null }));

const rfqOut = (row, { internal = true } = {}) => ({
  id: row.id,
  changeEventId: row.changeEventId,
  number: row.number,
  ref: row.ref,
  commitmentId: row.commitmentId || null,
  commitment: row.commitment ? { id: row.commitment.id, ref: row.commitment.ref, title: row.commitment.title } : null,
  vendorCompanyId: row.vendorCompanyId || null,
  companyName: row.companyName,
  contactName: row.contactName || null,
  contactEmail: internal ? row.contactEmail : undefined,
  status: row.status,
  dueDate: toIso(row.dueDate),
  expiresAt: toIso(row.expiresAt),
  instructions: row.instructions || null,
  lineIds: Array.isArray(row.lineIdsJson) ? row.lineIdsJson : [],
  sentAt: toIso(row.sentAt),
  viewedAt: toIso(row.viewedAt),
  quotedAt: toIso(row.quotedAt),
  quoteTotal: money(row.quoteTotal),
  quoteLines: quoteLines(row),
  quoteNotes: row.quoteNotes || null,
  quoteValidUntil: toIso(row.quoteValidUntil),
  quoteLeadTimeDays: row.quoteLeadTimeDays ?? null,
  quotedBy: row.quotedBy || null,
  declinedReason: row.declinedReason || null,
  acceptedAt: toIso(row.acceptedAt),
  rejectedAt: toIso(row.rejectedAt),
  rejectedReason: row.rejectedReason || null,
  commitmentChangeOrderId: row.commitmentChangeOrderId || null,
  commitmentChangeOrder: row.commitmentChangeOrder ? { id: row.commitmentChangeOrder.id, ref: row.commitmentChangeOrder.ref, status: row.commitmentChangeOrder.status } : null,
  remindersSent: row.remindersSent,
});

const estimateOf = (event) => {
  const lines = event.lines || [];
  if (!lines.length) return { rom: money(event.romAmount) || 0, quoted: null, estimate: money(event.romAmount) || 0 };
  const rom = round2(lines.reduce((sum, line) => sum + toNumber(line.romAmount), 0));
  const quotedLines = lines.filter((line) => line.quotedAmount !== null && line.quotedAmount !== undefined);
  const quoted = quotedLines.length ? round2(quotedLines.reduce((sum, line) => sum + toNumber(line.quotedAmount), 0)) : null;
  const estimate = round2(lines.reduce((sum, line) => sum + (line.quotedAmount === null || line.quotedAmount === undefined ? toNumber(line.romAmount) : toNumber(line.quotedAmount)), 0));
  return { rom, quoted, estimate };
};

const eventOut = (row, { detail = false } = {}) => {
  const totals = estimateOf(row);
  const rfqs = row.rfqs || [];
  return {
    id: row.id,
    projectId: row.projectId,
    number: row.number,
    ref: row.ref,
    title: row.title,
    description: row.description || null,
    type: row.type,
    origin: row.origin,
    sourceRecordType: row.sourceRecordType || null,
    sourceRecordId: row.sourceRecordId || null,
    sourcePath: row.sourceRecordType && row.sourceRecordId ? recordWorkspacePath({ projectId: row.projectId, recordType: row.sourceRecordType, recordId: row.sourceRecordId }) : null,
    status: row.status,
    activityId: row.activityId || null,
    activity: row.activity ? { id: row.activity.id, name: row.activity.name, code: row.activity.activityCode || row.activity.wbsCode || null } : null,
    locationId: row.locationId || null,
    location: row.location ? { id: row.location.id, name: row.location.name } : null,
    romAmount: money(row.romAmount) || 0,
    scheduleImpactDays: row.scheduleImpactDays,
    ownerChange: Boolean(row.ownerChange),
    totals,
    changeOrderId: row.changeOrderId || null,
    changeOrder: row.changeOrder ? { id: row.changeOrder.id, ref: row.changeOrder.ref, status: row.changeOrder.status, value: money(row.changeOrder.value), path: recordWorkspacePath({ projectId: row.projectId, recordType: "change_order", recordId: row.changeOrder.id }) } : null,
    convertedAt: toIso(row.convertedAt),
    closedAt: toIso(row.closedAt),
    voidReason: row.voidReason || null,
    notes: row.notes || null,
    lineCount: row._count?.lines ?? (row.lines ? row.lines.length : undefined),
    rfqCounts: { total: rfqs.length, quoted: rfqs.filter((rfq) => rfq.status === RFQ_STATUS.QUOTED).length, accepted: rfqs.filter((rfq) => rfq.status === RFQ_STATUS.ACCEPTED).length, open: rfqs.filter((rfq) => RFQ_OPEN.includes(rfq.status)).length },
    lines: detail ? (row.lines || []).map(lineOut) : undefined,
    rfqs: detail ? rfqs.map((rfq) => rfqOut(rfq)) : undefined,
    path: recordWorkspacePath({ projectId: row.projectId, recordType: "change_event", recordId: row.id }),
    createdBy: row.createdBy || null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
};

const lineInclude = { costCode: { select: { id: true, code: true, name: true } }, activity: { select: { id: true, name: true, activityCode: true, wbsCode: true } }, commitment: { select: { id: true, ref: true, title: true, vendorCompany: { select: { name: true } } } } };
const rfqInclude = { commitment: { select: { id: true, ref: true, title: true } }, commitmentChangeOrder: { select: { id: true, ref: true, status: true } } };
const eventInclude = { activity: { select: { id: true, name: true, activityCode: true, wbsCode: true } }, location: { select: { id: true, name: true } }, changeOrder: { select: { id: true, ref: true, status: true, value: true } }, lines: { include: lineInclude, orderBy: { sortOrder: "asc" } }, rfqs: { include: rfqInclude, orderBy: { number: "asc" } } };
const listInclude = { activity: { select: { id: true, name: true, activityCode: true, wbsCode: true } }, changeOrder: { select: { id: true, ref: true, status: true, value: true } }, lines: { select: { romAmount: true, quotedAmount: true } }, rfqs: { select: { status: true } }, _count: { select: { lines: true } } };

// ─── Change events ────────────────────────────────────────────────────────

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true, name: true, currency: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

const loadEvent = async ({ orgId, projectId, changeEventId, tx = prisma }) => {
  const row = await tx.changeEvent.findFirst({ where: { id: changeEventId, orgId, projectId }, include: eventInclude });
  if (!row) throw new HttpError(404, "CHANGE_EVENT_NOT_FOUND", "Change event not found");
  return row;
};

const normalizeEvent = (payload, existing = null) => {
  const pick = (key, fallback = null) => (payload[key] !== undefined ? payload[key] : existing ? existing[key] : fallback);
  const title = trimOrNull(pick("title"));
  if (!title) throw new HttpError(400, "CHANGE_EVENT_TITLE_REQUIRED", "The change event needs a title");
  const type = pick("type", "other");
  if (!TYPES.includes(type)) throw new HttpError(400, "CHANGE_EVENT_TYPE_INVALID", `Type must be one of ${TYPES.join(", ")}`);
  const origin = pick("origin", "manual");
  if (!ORIGINS.includes(origin)) throw new HttpError(400, "CHANGE_EVENT_ORIGIN_INVALID", `Origin must be one of ${ORIGINS.join(", ")}`);
  return {
    title: title.slice(0, 200),
    description: trimOrNull(pick("description"))?.slice(0, 8000) || null,
    type,
    origin,
    sourceRecordType: trimOrNull(pick("sourceRecordType"))?.slice(0, 60) || null,
    sourceRecordId: trimOrNull(pick("sourceRecordId")) || null,
    activityId: trimOrNull(pick("activityId")),
    locationId: trimOrNull(pick("locationId")),
    romAmount: Math.max(0, round2(pick("romAmount", 0))),
    scheduleImpactDays: Math.max(0, Math.round(toNumber(pick("scheduleImpactDays", 0)))),
    ownerChange: pick("ownerChange", true) !== false,
    notes: trimOrNull(pick("notes"))?.slice(0, 4000) || null,
  };
};

const assertRefs = async ({ projectId, data, lines = [] }) => {
  const activityIds = uniqueIds([data?.activityId, ...lines.map((line) => line.activityId)]);
  if (activityIds.length) {
    const found = await prisma.activity.findMany({ where: { id: { in: activityIds }, projectId }, select: { id: true } });
    if (found.length !== activityIds.length) throw new HttpError(400, "CHANGE_EVENT_ACTIVITY_INVALID", "An activity is not on this project");
  }
  if (data?.locationId) {
    const location = await prisma.location.findFirst({ where: { id: data.locationId, projectId }, select: { id: true } });
    if (!location) throw new HttpError(400, "CHANGE_EVENT_LOCATION_INVALID", "Unknown location");
  }
  const costCodeIds = uniqueIds(lines.map((line) => line.costCodeId));
  if (costCodeIds.length) {
    const found = await prisma.projectCostCode.findMany({ where: { projectId, costCodeId: { in: costCodeIds } }, select: { costCodeId: true } });
    if (found.length !== costCodeIds.length) throw new HttpError(400, "CHANGE_EVENT_COST_CODE_INVALID", "A cost code is not on this project");
  }
  const commitmentIds = uniqueIds(lines.map((line) => line.commitmentId));
  if (commitmentIds.length) {
    const found = await prisma.commitment.findMany({ where: { id: { in: commitmentIds }, projectId }, select: { id: true } });
    if (found.length !== commitmentIds.length) throw new HttpError(400, "CHANGE_EVENT_COMMITMENT_INVALID", "A commitment is not on this project");
  }
};

const normalizeLines = (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length > 200) throw new HttpError(400, "CHANGE_EVENT_TOO_MANY_LINES", "A change event takes up to 200 lines");
  return list.map((row, index) => {
    const description = trimOrNull(row.description);
    if (!description) throw new HttpError(400, "CHANGE_EVENT_LINE_DESCRIPTION", `Line ${index + 1}: describe the scope`);
    const quantity = toNumber(row.quantity, 1);
    const unitCost = round2(row.unitCost);
    const romAmount = row.romAmount !== undefined && row.romAmount !== null && row.romAmount !== "" ? round2(row.romAmount) : round2(quantity * unitCost);
    return { id: trimOrNull(row.id), description: description.slice(0, 500), costCodeId: trimOrNull(row.costCodeId), budgetLineId: trimOrNull(row.budgetLineId), activityId: trimOrNull(row.activityId), commitmentId: trimOrNull(row.commitmentId), quantity, unit: trimOrNull(row.unit)?.slice(0, 20) || null, unitCost, romAmount, notes: trimOrNull(row.notes)?.slice(0, 1000) || null, sortOrder: index };
  });
};

const summaryOf = (items) => {
  const byStatus = Object.fromEntries(Object.values(STATUS).map((status) => [status, 0]));
  let rom = 0;
  let quoted = 0;
  let converted = 0;
  for (const item of items) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    if (![STATUS.VOID, STATUS.CLOSED].includes(item.status)) {
      rom = round2(rom + item.totals.rom);
      quoted = round2(quoted + (item.totals.quoted ?? 0));
    }
    if (item.changeOrder) converted = round2(converted + toNumber(item.changeOrder.value));
  }
  return { count: items.length, byStatus, romTotal: rom, quotedTotal: quoted, convertedValue: converted, openRfqs: items.reduce((sum, item) => sum + item.rfqCounts.open, 0), quotesWaiting: items.reduce((sum, item) => sum + item.rfqCounts.quoted, 0) };
};

const listChangeEvents = async ({ orgId, projectId, query = {} }) => {
  const where = { orgId, projectId };
  if (query.status) where.status = query.status;
  if (query.type) where.type = query.type;
  if (query.origin) where.origin = query.origin;
  const q = trimOrNull(query.q);
  if (q) where.OR = [{ title: { contains: q, mode: "insensitive" } }, { ref: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }];
  const rows = await prisma.changeEvent.findMany({ where, include: listInclude, orderBy: { number: "desc" }, take: 1000 });
  const items = rows.map((row) => eventOut(row));
  return { items, summary: summaryOf(items) };
};

const getChangeEvent = async ({ orgId, projectId, changeEventId }) => eventOut(await loadEvent({ orgId, projectId, changeEventId }), { detail: true });

const nextNumber = async (tx, projectId) => {
  return nextCounterNumber(tx, { table: "ChangeEvent", scope: { projectId } });
};

const createChangeEvent = async ({ orgId, projectId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const data = normalizeEvent(payload);
  const lines = normalizeLines(payload.lines);
  await assertRefs({ projectId, data, lines });
  const created = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, projectId);
    const row = await tx.changeEvent.create({ data: { ...data, orgId, projectId, number, ref: `CE-${String(number).padStart(3, "0")}`, status: STATUS.OPEN, createdBy: actor?.id || null, updatedBy: actor?.id || null } });
    if (lines.length) await tx.changeEventLine.createMany({ data: lines.map(({ id, ...line }) => ({ ...line, orgId, projectId, changeEventId: row.id })) });
    return loadEvent({ orgId, projectId, changeEventId: row.id, tx });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "change_event", entityId: created.id, action: auditService.ACTIONS.CREATED, actorId: actor?.id || null, summary: { ref: created.ref, title: created.title, type: created.type, origin: created.origin, rom: estimateOf(created).rom } }).catch(() => null);
  return eventOut(created, { detail: true });
};

const assertEditable = (row) => {
  if ([STATUS.CONVERTED, STATUS.CLOSED, STATUS.VOID].includes(row.status)) throw new HttpError(409, "CHANGE_EVENT_LOCKED", `A ${row.status} change event cannot be edited`);
};

/** Updates the header and, when `lines` is sent, replaces the lines (quoted amounts are kept by line id). */
const updateChangeEvent = async ({ orgId, projectId, changeEventId, payload = {}, actor = null }) => {
  const existing = await loadEvent({ orgId, projectId, changeEventId });
  assertEditable(existing);
  const data = normalizeEvent(payload, existing);
  const lines = payload.lines !== undefined ? normalizeLines(payload.lines) : null;
  await assertRefs({ projectId, data, lines: lines || [] });
  const updated = await prisma.$transaction(async (tx) => {
    await tx.changeEvent.update({ where: { id: changeEventId }, data: { ...data, updatedBy: actor?.id || null } });
    if (lines) {
      const keep = uniqueIds(lines.map((line) => line.id));
      await tx.changeEventLine.deleteMany({ where: { changeEventId, id: { notIn: keep.length ? keep : ["__none__"] } } });
      for (const { id, ...line } of lines) {
        const existingLine = id ? existing.lines.find((row) => row.id === id) : null;
        if (existingLine) await tx.changeEventLine.update({ where: { id }, data: line });
        else await tx.changeEventLine.create({ data: { ...line, orgId, projectId, changeEventId } });
      }
    }
    return loadEvent({ orgId, projectId, changeEventId, tx });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "change_event", entityId: changeEventId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { ref: updated.ref, lines: updated.lines.length, estimate: estimateOf(updated).estimate } }).catch(() => null);
  return eventOut(updated, { detail: true });
};

const deleteChangeEvent = async ({ orgId, projectId, changeEventId, actor = null }) => {
  const existing = await loadEvent({ orgId, projectId, changeEventId });
  if (existing.status !== STATUS.OPEN || existing.rfqs.length) throw new HttpError(409, "CHANGE_EVENT_LOCKED", "Only open change events without RFQs can be deleted — void it instead");
  await prisma.changeEvent.delete({ where: { id: changeEventId } });
  await auditService.recordEvent({ orgId, projectId, entityType: "change_event", entityId: changeEventId, action: auditService.ACTIONS.DELETED, actorId: actor?.id || null, summary: { ref: existing.ref } }).catch(() => null);
  return { deleted: true };
};

// ─── RFQs ─────────────────────────────────────────────────────────────────

const rfqEmail = ({ event, rfq, project, token, kind }) => {
  const due = rfq.dueDate ? ` by ${new Date(rfq.dueDate).toISOString().slice(0, 10)}` : "";
  const intro = kind === "reminder" ? `A reminder: your quotation for ${event.ref} ${event.title} on ${project.name} is still open${due}.` : `${project.name} requests a quotation for ${event.ref} ${event.title}${due}.`;
  return { to: rfq.contactEmail, subject: `${kind === "reminder" ? "Reminder: " : ""}Request for quotation ${rfq.ref} — ${event.title}`, body: `${intro}\n\n${rfq.instructions ? `${rfq.instructions}\n\n` : ""}Quote online (no login needed): ${portalUrl(token)}\n\nThe link is personal to ${rfq.companyName}; a newer email replaces it.` };
};

const rotateToken = async ({ tx = prisma, rfq, dueDate }) => {
  const token = newToken();
  await tx.rfq.update({ where: { id: rfq.id }, data: { tokenHash: hashToken(token), expiresAt: linkExpiry(dueDate ?? rfq.dueDate) } });
  return token;
};

/** Sends RFQs for a change event: one per recipient (a commitment's vendor or an ad-hoc contact), each with a personal link. */
const sendRfqs = async ({ orgId, projectId, changeEventId, payload = {}, actor = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const event = await loadEvent({ orgId, projectId, changeEventId });
  assertEditable(event);
  const recipients = Array.isArray(payload.recipients) ? payload.recipients : [];
  if (!recipients.length) throw new HttpError(400, "RFQ_RECIPIENTS_REQUIRED", "Add at least one vendor to send the RFQ to");
  const dueDate = optionalDate(payload.dueDate, "dueDate");
  const instructions = trimOrNull(payload.instructions)?.slice(0, 4000) || null;
  const lineIds = uniqueIds(Array.isArray(payload.lineIds) ? payload.lineIds : []).filter((id) => event.lines.some((line) => line.id === id));
  const commitmentIds = uniqueIds(recipients.map((recipient) => recipient.commitmentId));
  const commitments = commitmentIds.length ? await prisma.commitment.findMany({ where: { id: { in: commitmentIds }, projectId }, include: { vendorCompany: { select: { id: true, name: true, email: true, contactName: true } }, projectParty: { select: { contactEmail: true, contactName: true } } } }) : [];
  const commitmentById = new Map(commitments.map((row) => [row.id, row]));
  const created = [];
  await prisma.$transaction(async (tx) => {
    let last = 0;
    for (const [index, recipient] of recipients.entries()) {
      const commitment = recipient.commitmentId ? commitmentById.get(recipient.commitmentId) : null;
      if (recipient.commitmentId && !commitment) throw new HttpError(400, "CHANGE_EVENT_COMMITMENT_INVALID", `Recipient ${index + 1}: the commitment is not on this project`);
      const contactEmail = trimOrNull(recipient.contactEmail)?.toLowerCase() || commitment?.projectParty?.contactEmail?.toLowerCase() || commitment?.vendorCompany?.email?.toLowerCase() || null;
      if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new HttpError(400, "RFQ_EMAIL_REQUIRED", `Recipient ${index + 1}: a contact email is needed`);
      const companyName = trimOrNull(recipient.companyName) || commitment?.vendorCompany?.name || null;
      if (!companyName) throw new HttpError(400, "RFQ_COMPANY_REQUIRED", `Recipient ${index + 1}: a company name is needed`);
      const duplicate = await tx.rfq.findFirst({ where: { changeEventId, contactEmail, status: { in: RFQ_OPEN } }, select: { id: true, ref: true } });
      if (duplicate) throw new HttpError(409, "RFQ_ALREADY_SENT", `${duplicate.ref} is already open for ${contactEmail}`);
      last = await nextCounterNumber(tx, { table: "Rfq", scope: { changeEventId } });
      const token = newToken();
      const row = await tx.rfq.create({ data: { orgId, projectId, changeEventId, number: last, ref: `${event.ref}-RFQ${String(last).padStart(2, "0")}`, commitmentId: commitment?.id || null, vendorCompanyId: commitment?.vendorCompanyId || trimOrNull(recipient.vendorCompanyId) || null, companyName: companyName.slice(0, 200), contactName: (trimOrNull(recipient.contactName) || commitment?.projectParty?.contactName || commitment?.vendorCompany?.contactName || null)?.slice(0, 120) || null, contactEmail, tokenHash: hashToken(token), expiresAt: linkExpiry(dueDate), dueDate, instructions, lineIdsJson: lineIds, status: RFQ_STATUS.SENT, createdBy: actor?.id || null }, include: rfqInclude });
      created.push({ row, token });
    }
    if (event.status === STATUS.OPEN) await tx.changeEvent.update({ where: { id: changeEventId }, data: { status: STATUS.PRICING, updatedBy: actor?.id || null } });
  });
  for (const { row, token } of created) {
    await emailService.sendEmail(rfqEmail({ event, rfq: row, project, token, kind: "invite" })).catch(() => null);
  }
  await auditService.recordEvent({ orgId, projectId, entityType: "change_event", entityId: changeEventId, action: auditService.ACTIONS.STATUS_CHANGED, actorId: actor?.id || null, summary: { ref: event.ref, rfqsSent: created.length, vendors: created.map(({ row }) => row.companyName) } }).catch(() => null);
  return { sent: created.length, rfqs: created.map(({ row, token }) => ({ ...rfqOut(row), portalUrl: portalUrl(token) })), changeEvent: eventOut(await loadEvent({ orgId, projectId, changeEventId }), { detail: true }) };
};

const loadRfq = async ({ orgId, projectId, rfqId, tx = prisma }) => {
  const row = await tx.rfq.findFirst({ where: { id: rfqId, orgId, projectId }, include: { ...rfqInclude, changeEvent: { include: eventInclude } } });
  if (!row) throw new HttpError(404, "RFQ_NOT_FOUND", "RFQ not found");
  return row;
};

/** Re-sends the RFQ email with a fresh link (reminder). */
const remindRfq = async ({ orgId, projectId, rfqId, actor = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const rfq = await loadRfq({ orgId, projectId, rfqId });
  if (!RFQ_OPEN.includes(rfq.status) || rfq.status === RFQ_STATUS.QUOTED) throw new HttpError(409, "RFQ_NOT_OPEN", `A ${rfq.status} RFQ cannot be re-sent`);
  const token = await rotateToken({ rfq });
  await prisma.rfq.update({ where: { id: rfqId }, data: { remindersSent: { increment: 1 } } });
  await emailService.sendEmail(rfqEmail({ event: rfq.changeEvent, rfq, project, token, kind: "reminder" })).catch(() => null);
  return { ...rfqOut(await prisma.rfq.findFirst({ where: { id: rfqId }, include: rfqInclude })), portalUrl: portalUrl(token) };
};

const cancelRfq = async ({ orgId, projectId, rfqId, actor = null }) => {
  const rfq = await loadRfq({ orgId, projectId, rfqId });
  if (!RFQ_OPEN.includes(rfq.status)) throw new HttpError(409, "RFQ_NOT_OPEN", `A ${rfq.status} RFQ cannot be cancelled`);
  const row = await prisma.rfq.update({ where: { id: rfqId }, data: { status: RFQ_STATUS.CANCELLED }, include: rfqInclude });
  await auditService.recordEvent({ orgId, projectId, entityType: "change_event", entityId: rfq.changeEventId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { rfq: rfq.ref, cancelled: true } }).catch(() => null);
  return rfqOut(row);
};

const notifyTeam = ({ orgId, projectId, event, actorId = null, notificationEvent, title, message, recipientRoles = ["pm", "qs"] }) =>
  notificationService
    .createNotifications({ orgId, projectId, actorId, recipientRoles, recipientUserIds: [event.createdBy].filter(Boolean), type: "change_event", category: notificationService.NOTIFICATION_CATEGORIES.COMMERCIAL, event: notificationEvent, title, message, actionUrl: recordWorkspacePath({ projectId, recordType: "change_event", recordId: event.id }), entityType: "change_event", entityId: event.id, dedupeKeyBase: `change_event:${event.id}:${notificationEvent}:${Date.now()}`, metadata: { ref: event.ref, status: event.status } })
    .catch(() => null);

/**
 * Accepts a vendor's quote: the quoted amounts land on the event's lines,
 * the event is priced, and — for a commitment's vendor — a commitment change
 * order can be drafted with the quoted lines.
 */
const acceptQuote = async ({ orgId, projectId, rfqId, payload = {}, actor = null }) => {
  const rfq = await loadRfq({ orgId, projectId, rfqId });
  if (rfq.status !== RFQ_STATUS.QUOTED) throw new HttpError(409, "RFQ_NOT_QUOTED", "Only a quoted RFQ can be accepted");
  const event = rfq.changeEvent;
  assertEditable(event);
  const quoted = quoteLines(rfq);
  const now = new Date();
  let commitmentChangeOrder = null;
  await prisma.$transaction(async (tx) => {
    for (const line of quoted) {
      if (line.amount === null || !event.lines.some((row) => row.id === line.lineId)) continue;
      await tx.changeEventLine.update({ where: { id: line.lineId }, data: { quotedAmount: line.amount, quotedRfqId: rfq.id } });
    }
    await tx.rfq.update({ where: { id: rfqId }, data: { status: RFQ_STATUS.ACCEPTED, acceptedAt: now, acceptedBy: actor?.id || null } });
    await tx.changeEvent.update({ where: { id: event.id }, data: { status: STATUS.PRICED, updatedBy: actor?.id || null } });
  });
  if (payload.createCommitmentChangeOrder && rfq.commitmentId) {
    const commitmentService = require("./commitment.service");
    const lines = quoted.filter((line) => line.amount !== null).map((line) => {
      const source = event.lines.find((row) => row.id === line.lineId);
      return { description: source?.description || event.title, costCodeId: source?.costCodeId || null, budgetLineId: source?.budgetLineId || null, activityId: source?.activityId || null, amount: line.amount };
    });
    commitmentChangeOrder = await commitmentService.createChangeOrder({ orgId, projectId, commitmentId: rfq.commitmentId, actor, payload: { title: `${event.ref} ${event.title}`.slice(0, 200), description: event.description || null, value: money(rfq.quoteTotal) ?? lines.reduce((sum, line) => sum + line.amount, 0), lines } });
    await prisma.rfq.update({ where: { id: rfqId }, data: { commitmentChangeOrderId: commitmentChangeOrder.id } });
  }
  await auditService.recordEvent({ orgId, projectId, entityType: "change_event", entityId: event.id, action: auditService.ACTIONS.APPROVED, actorId: actor?.id || null, summary: { rfq: rfq.ref, vendor: rfq.companyName, quoteTotal: money(rfq.quoteTotal), commitmentChangeOrder: commitmentChangeOrder?.ref || null } }).catch(() => null);
  return { changeEvent: eventOut(await loadEvent({ orgId, projectId, changeEventId: event.id }), { detail: true }), commitmentChangeOrder: commitmentChangeOrder ? { id: commitmentChangeOrder.id, ref: commitmentChangeOrder.ref, status: commitmentChangeOrder.status, value: money(commitmentChangeOrder.value) } : null };
};

const rejectQuote = async ({ orgId, projectId, rfqId, payload = {}, actor = null }) => {
  const rfq = await loadRfq({ orgId, projectId, rfqId });
  if (rfq.status !== RFQ_STATUS.QUOTED) throw new HttpError(409, "RFQ_NOT_QUOTED", "Only a quoted RFQ can be rejected");
  const row = await prisma.rfq.update({ where: { id: rfqId }, data: { status: RFQ_STATUS.REJECTED, rejectedAt: new Date(), rejectedReason: trimOrNull(payload.reason)?.slice(0, 1000) || null }, include: rfqInclude });
  await auditService.recordEvent({ orgId, projectId, entityType: "change_event", entityId: rfq.changeEventId, action: auditService.ACTIONS.REJECTED, actorId: actor?.id || null, summary: { rfq: rfq.ref, reason: row.rejectedReason } }).catch(() => null);
  return rfqOut(row);
};

// ─── Conversion and closing ───────────────────────────────────────────────

/** Creates the prime change order from the event (value = quoted where accepted, else ROM) and links accepted commitment change orders. */
const convertToChangeOrder = async ({ orgId, projectId, changeEventId, payload = {}, actor = null }) => {
  const event = await loadEvent({ orgId, projectId, changeEventId });
  if (event.status === STATUS.CONVERTED || event.changeOrderId) throw new HttpError(409, "CHANGE_EVENT_CONVERTED", `${event.ref} is already ${event.changeOrder?.ref || "converted"}`);
  if ([STATUS.CLOSED, STATUS.VOID].includes(event.status)) throw new HttpError(409, "CHANGE_EVENT_LOCKED", `A ${event.status} change event cannot be converted`);
  const totals = estimateOf(event);
  const value = payload.value !== undefined && payload.value !== null && payload.value !== "" ? round2(payload.value) : totals.estimate;
  const changeOrderService = require("./change-order.service");
  const affectedActivityIds = uniqueIds([event.activityId, ...event.lines.map((line) => line.activityId)]);
  const created = await changeOrderService.createChangeOrder({
    orgId,
    projectId,
    userId: actor?.id || null,
    userRole: actor?.role || null,
    payload: {
      description: trimOrNull(payload.description) || `${event.ref} ${event.title}${event.description ? ` — ${event.description}` : ""}`.slice(0, 2000),
      category: event.type,
      value,
      scheduleImpact: event.scheduleImpactDays,
      scheduleImpactSummary: event.scheduleImpactDays ? `${event.scheduleImpactDays} day${event.scheduleImpactDays === 1 ? "" : "s"} from ${event.ref}` : null,
      costImpactSummary: totals.quoted !== null ? `Quoted ${totals.quoted} (ROM ${totals.rom}) — ${event.rfqs.filter((rfq) => rfq.status === RFQ_STATUS.ACCEPTED).map((rfq) => `${rfq.ref} ${rfq.companyName}`).join(", ") || "no accepted quote"}` : `ROM ${totals.rom}`,
      activityId: event.activityId || affectedActivityIds[0] || null,
      affectedActivityIds,
      raisedBy: actor?.name || null,
    },
  });
  const commitmentChangeOrders = [];
  if (payload.includeCommitmentChangeOrders !== false) {
    const commitmentService = require("./commitment.service");
    for (const rfq of event.rfqs.filter((row) => row.status === RFQ_STATUS.ACCEPTED && row.commitmentId)) {
      if (rfq.commitmentChangeOrderId) {
        await prisma.commitmentChangeOrder.update({ where: { id: rfq.commitmentChangeOrderId }, data: { primeChangeOrderId: created.id } }).catch(() => null);
        commitmentChangeOrders.push({ id: rfq.commitmentChangeOrderId, ref: rfq.commitmentChangeOrder?.ref || null, linked: true });
        continue;
      }
      const lines = quoteLines(rfq).filter((line) => line.amount !== null).map((line) => {
        const source = event.lines.find((row) => row.id === line.lineId);
        return { description: source?.description || event.title, costCodeId: source?.costCodeId || null, budgetLineId: source?.budgetLineId || null, activityId: source?.activityId || null, amount: line.amount };
      });
      const co = await commitmentService.createChangeOrder({ orgId, projectId, commitmentId: rfq.commitmentId, actor, payload: { title: `${event.ref} ${event.title}`.slice(0, 200), description: event.description || null, value: money(rfq.quoteTotal) ?? lines.reduce((sum, line) => sum + line.amount, 0), lines, primeChangeOrderId: created.id } });
      await prisma.rfq.update({ where: { id: rfq.id }, data: { commitmentChangeOrderId: co.id } });
      commitmentChangeOrders.push({ id: co.id, ref: co.ref, linked: false });
    }
  }
  const now = new Date();
  await prisma.changeEvent.update({ where: { id: changeEventId }, data: { status: STATUS.CONVERTED, changeOrderId: created.id, convertedAt: now, updatedBy: actor?.id || null } });
  await auditService.recordEvent({ orgId, projectId, entityType: "change_event", entityId: changeEventId, action: auditService.ACTIONS.STATUS_CHANGED, actorId: actor?.id || null, summary: { ref: event.ref, changeOrder: created.ref, value, commitmentChangeOrders: commitmentChangeOrders.length } }).catch(() => null);
  return { changeEvent: eventOut(await loadEvent({ orgId, projectId, changeEventId }), { detail: true }), changeOrder: { id: created.id, ref: created.ref, status: created.status, value: money(created.value), path: recordWorkspacePath({ projectId, recordType: "change_order", recordId: created.id }) }, commitmentChangeOrders };
};

const closeChangeEvent = async ({ orgId, projectId, changeEventId, payload = {}, actor = null }) => {
  const event = await loadEvent({ orgId, projectId, changeEventId });
  if ([STATUS.CLOSED, STATUS.VOID].includes(event.status)) throw new HttpError(409, "CHANGE_EVENT_LOCKED", `${event.ref} is already ${event.status}`);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.rfq.updateMany({ where: { changeEventId, status: { in: RFQ_OPEN } }, data: { status: RFQ_STATUS.CANCELLED } });
    await tx.changeEvent.update({ where: { id: changeEventId }, data: { status: STATUS.CLOSED, closedAt: now, closedBy: actor?.id || null, notes: payload.reason ? `${event.notes ? `${event.notes}\n` : ""}Closed: ${String(payload.reason).slice(0, 500)}` : event.notes, updatedBy: actor?.id || null } });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "change_event", entityId: changeEventId, action: auditService.ACTIONS.STATUS_CHANGED, actorId: actor?.id || null, summary: { ref: event.ref, from: event.status, to: STATUS.CLOSED, reason: trimOrNull(payload.reason) } }).catch(() => null);
  return eventOut(await loadEvent({ orgId, projectId, changeEventId }), { detail: true });
};

const voidChangeEvent = async ({ orgId, projectId, changeEventId, payload = {}, actor = null }) => {
  const event = await loadEvent({ orgId, projectId, changeEventId });
  if (event.status === STATUS.CONVERTED) throw new HttpError(409, "CHANGE_EVENT_CONVERTED", "A converted change event cannot be voided — void the change order");
  if (event.status === STATUS.VOID) throw new HttpError(409, "CHANGE_EVENT_LOCKED", `${event.ref} is already void`);
  const reason = trimOrNull(payload.reason);
  if (!reason) throw new HttpError(400, "CHANGE_EVENT_REASON_REQUIRED", "Say why the change event is voided");
  await prisma.$transaction(async (tx) => {
    await tx.rfq.updateMany({ where: { changeEventId, status: { in: RFQ_OPEN } }, data: { status: RFQ_STATUS.CANCELLED } });
    await tx.changeEvent.update({ where: { id: changeEventId }, data: { status: STATUS.VOID, voidReason: reason.slice(0, 1000), closedAt: new Date(), closedBy: actor?.id || null, updatedBy: actor?.id || null } });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "change_event", entityId: changeEventId, action: auditService.ACTIONS.STATUS_CHANGED, actorId: actor?.id || null, summary: { ref: event.ref, from: event.status, to: STATUS.VOID, reason } }).catch(() => null);
  return eventOut(await loadEvent({ orgId, projectId, changeEventId }), { detail: true });
};

// ─── Vendor portal ────────────────────────────────────────────────────────

const portalInclude = { changeEvent: { include: { project: { select: { id: true, name: true, currency: true } }, lines: { include: lineInclude, orderBy: { sortOrder: "asc" } } } } };

const portalContext = async (token, { touch = true } = {}) => {
  const trimmed = trimOrNull(token);
  if (!trimmed) throw new HttpError(404, "RFQ_LINK_INVALID", "This quotation link is not valid");
  const rfq = await prisma.rfq.findUnique({ where: { tokenHash: hashToken(trimmed) }, include: portalInclude });
  if (!rfq) throw new HttpError(404, "RFQ_LINK_INVALID", "This quotation link is not valid or has been replaced by a newer email");
  if (new Date(rfq.expiresAt) < new Date()) throw new HttpError(410, "RFQ_LINK_EXPIRED", "This quotation link has expired; ask for a new request");
  if (rfq.status === RFQ_STATUS.CANCELLED) throw new HttpError(410, "RFQ_CANCELLED", "This request for quotation was withdrawn");
  if (touch) {
    const data = { lastAccessAt: new Date() };
    if (rfq.status === RFQ_STATUS.SENT) Object.assign(data, { status: RFQ_STATUS.VIEWED, viewedAt: new Date() });
    await prisma.rfq.update({ where: { id: rfq.id }, data });
    Object.assign(rfq, data);
  }
  return rfq;
};

const portalLines = (rfq) => {
  const wanted = Array.isArray(rfq.lineIdsJson) && rfq.lineIdsJson.length ? new Set(rfq.lineIdsJson) : null;
  return rfq.changeEvent.lines.filter((line) => !wanted || wanted.has(line.id)).map((line) => ({ id: line.id, description: line.description, quantity: toNumber(line.quantity, 1), unit: line.unit || null, activity: line.activity?.name || null, notes: line.notes || null }));
};

const portalOut = (rfq) => ({
  rfq: { ref: rfq.ref, companyName: rfq.companyName, contactName: rfq.contactName || null, status: rfq.status, dueDate: toIso(rfq.dueDate), expiresAt: toIso(rfq.expiresAt), instructions: rfq.instructions || null, acceptingQuotes: [RFQ_STATUS.SENT, RFQ_STATUS.VIEWED, RFQ_STATUS.QUOTED].includes(rfq.status) && (!rfq.dueDate || new Date(rfq.dueDate).getTime() + 86_400_000 > Date.now()), declinedReason: rfq.declinedReason || null },
  changeEvent: { ref: rfq.changeEvent.ref, title: rfq.changeEvent.title, description: rfq.changeEvent.description || null, type: rfq.changeEvent.type, projectName: rfq.changeEvent.project?.name || null, currency: rfq.changeEvent.project?.currency || null, lines: portalLines(rfq) },
  quote: { lines: quoteLines(rfq), total: money(rfq.quoteTotal), notes: rfq.quoteNotes || null, validUntil: toIso(rfq.quoteValidUntil), leadTimeDays: rfq.quoteLeadTimeDays ?? null, quotedBy: rfq.quotedBy || null, quotedAt: toIso(rfq.quotedAt) },
});

const portalView = async (token) => portalOut(await portalContext(token));

/** Saves or replaces the vendor's quote (re-quoting allowed until accepted / rejected). */
const portalSubmitQuote = async (token, payload = {}) => {
  const rfq = await portalContext(token);
  if (![RFQ_STATUS.SENT, RFQ_STATUS.VIEWED, RFQ_STATUS.QUOTED].includes(rfq.status)) throw new HttpError(409, "RFQ_CLOSED", `This request is ${rfq.status}; the quotation can no longer be changed`);
  const offered = portalLines(rfq);
  const lines = (Array.isArray(payload.lines) ? payload.lines : []).map((line) => ({ lineId: trimOrNull(line.lineId), amount: line.amount === null || line.amount === undefined || line.amount === "" ? null : round2(String(line.amount).replace(/,/g, "")), note: trimOrNull(line.note)?.slice(0, 500) || null })).filter((line) => line.lineId && offered.some((item) => item.id === line.lineId));
  const priced = lines.filter((line) => line.amount !== null);
  const total = payload.total !== undefined && payload.total !== null && payload.total !== "" ? round2(String(payload.total).replace(/,/g, "")) : round2(priced.reduce((sum, line) => sum + line.amount, 0));
  if (!priced.length && !total) throw new HttpError(400, "RFQ_QUOTE_EMPTY", "Enter an amount for at least one line, or a total");
  const now = new Date();
  const row = await prisma.rfq.update({ where: { id: rfq.id }, data: { status: RFQ_STATUS.QUOTED, quotedAt: now, quoteTotal: total, quoteLinesJson: lines, quoteNotes: trimOrNull(payload.notes)?.slice(0, 4000) || null, quoteValidUntil: optionalDate(payload.validUntil, "validUntil"), quoteLeadTimeDays: payload.leadTimeDays === null || payload.leadTimeDays === undefined || payload.leadTimeDays === "" ? null : Math.max(0, Math.round(toNumber(payload.leadTimeDays))), quotedBy: trimOrNull(payload.quotedBy)?.slice(0, 120) || rfq.contactName || null }, include: portalInclude });
  const event = row.changeEvent;
  await notifyTeam({ orgId: row.orgId, projectId: row.projectId, event, notificationEvent: "rfq.quoted", title: `Quote received: ${row.ref} ${row.companyName}`, message: `${row.companyName} quoted ${total.toLocaleString()} ${event.project?.currency || ""} for ${event.ref} ${event.title}.` });
  await emailService.sendEmail({ to: row.contactEmail, subject: `${row.ref}: quotation received`, body: `Thank you — your quotation of ${total.toLocaleString()} ${event.project?.currency || ""} for ${event.ref} ${event.title} was received on ${now.toISOString().slice(0, 16).replace("T", " ")} UTC. You can update it from the same link until it is accepted.` }).catch(() => null);
  return portalOut(row);
};

const portalDecline = async (token, payload = {}) => {
  const rfq = await portalContext(token);
  if (![RFQ_STATUS.SENT, RFQ_STATUS.VIEWED, RFQ_STATUS.QUOTED].includes(rfq.status)) throw new HttpError(409, "RFQ_CLOSED", `This request is ${rfq.status}`);
  const row = await prisma.rfq.update({ where: { id: rfq.id }, data: { status: RFQ_STATUS.DECLINED, declinedReason: trimOrNull(payload.reason)?.slice(0, 1000) || null }, include: portalInclude });
  await notifyTeam({ orgId: row.orgId, projectId: row.projectId, event: row.changeEvent, notificationEvent: "rfq.declined", title: `Quote declined: ${row.ref} ${row.companyName}`, message: row.declinedReason || `${row.companyName} declined to quote ${row.changeEvent.ref}.` });
  return portalOut(row);
};

module.exports = { STATUS, TYPES, ORIGINS, RFQ_STATUS, estimateOf, normalizeLines, listChangeEvents, getChangeEvent, createChangeEvent, updateChangeEvent, deleteChangeEvent, sendRfqs, remindRfq, cancelRfq, acceptQuote, rejectQuote, convertToChangeOrder, closeChangeEvent, voidChangeEvent, portalContext, portalView, portalSubmitQuote, portalDecline, hashToken };
