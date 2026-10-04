const crypto = require("crypto");
const ExcelJS = require("exceljs");
const { brandWorkbook } = require("../utils/export-branding");
const { prisma } = require("../config/db");
const { ballInCourt } = require("./ball-in-court.service");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");
const emailService = require("./email.service");
const prequalService = require("./vendor-prequalification.service");
const refs = require("./tenant-references.service");
const { normalizeCompanyName } = require("../utils/company-name");
const { nextReference: nextReferenceNumber } = require("../utils/reference-number");

/**
 * Bid management (OCTA-PRE-BID-027).
 *
 * A bid package turns BOQ sections into bid form lines, carries documents
 * (attachments on the package), a due date and addenda. Vendors are invited
 * by email with an expiring portal link — no login — where they download,
 * ask questions, price the form (or upload their own), and submit. Bidders
 * never see each other: the portal only ever returns the invitation's own
 * bid and questions (shared answers are anonymous). Internally, submitted
 * bids are levelled side by side (excluded or missing lines plugged with
 * the average of the others), exported to XLSX, soft-awarded, and the award
 * creates the commitment with the schedule of values from the bid lines.
 */

const STATUS = Object.freeze({ DRAFT: "draft", OPEN: "open", CLOSED: "closed", AWARDED: "awarded", CANCELLED: "cancelled" });
const INVITE_STATUS = Object.freeze({ INVITED: "invited", VIEWED: "viewed", DECLINED: "declined", SUBMITTED: "submitted", WITHDRAWN: "withdrawn" });
const BID_STATUS = Object.freeze({ DRAFT: "draft", SUBMITTED: "submitted", WITHDRAWN: "withdrawn", AWARDED: "awarded", UNSUCCESSFUL: "unsuccessful" });
const COMMITMENT_TYPES = Object.freeze(["subcontract", "purchase_order"]);
const MAX_LINES = 500;
const MAX_INVITATIONS = 50;
const LINK_GRACE_DAYS = 14;
const DEFAULT_LINK_DAYS = 45;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const num = (value) => (value && typeof value === "object" && typeof value.toNumber === "function" ? value.toNumber() : Number(value || 0));
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const round3 = (value) => Math.round((Number(value) || 0) * 1000) / 1000;
const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
const newToken = () => crypto.randomBytes(24).toString("base64url");
const webAppUrl = () => (process.env.WEB_APP_URL || "http://localhost:5173").replace(/\/$/, "");
const portalUrl = (token) => `${webAppUrl()}/bid/${token}`;
const optionalDate = (value, field) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "BID_DATE_INVALID", `${field} must be a date`);
  return date;
};
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true, name: true, currency: true, orgId: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

// ─── serialisation ─────────────────────────────────────────────────────────

const serializeLine = (row, { internal = true } = {}) => ({
  id: row.id,
  lineNumber: row.lineNumber,
  boqItemId: row.boqItemId || null,
  section: row.section || null,
  code: row.code || null,
  description: row.description,
  unit: row.unit || null,
  qty: num(row.qty),
  ...(internal ? { estimateRate: row.estimateRate === null || row.estimateRate === undefined ? null : num(row.estimateRate), estimateAmount: row.estimateRate === null || row.estimateRate === undefined ? null : round2(num(row.qty) * num(row.estimateRate)), budgetLineId: row.budgetLineId || null, costCodeId: row.costCodeId || null, activityId: row.activityId || null } : {}),
  sortOrder: row.sortOrder ?? 0,
});

const serializeInvitation = (row, { token = null } = {}) => ({
  id: row.id,
  vendorCompanyId: row.vendorCompanyId || null,
  companyName: row.companyName,
  contactName: row.contactName || null,
  contactEmail: row.contactEmail,
  status: row.status,
  invitedAt: toIso(row.invitedAt),
  viewedAt: toIso(row.viewedAt),
  lastAccessAt: toIso(row.lastAccessAt),
  expiresAt: toIso(row.expiresAt),
  declinedReason: row.declinedReason || null,
  remindersSent: row.remindersSent || 0,
  bidStatus: row.bids?.[0]?.status || null,
  bidTotal: row.bids?.[0] ? num(row.bids[0].total) : null,
  ...(token ? { portalUrl: portalUrl(token) } : {}),
});

const serializeAddendum = (row) => ({ id: row.id, number: row.number, title: row.title, body: row.body || null, issuedAt: toIso(row.issuedAt), issuedBy: row.issuedBy || null });

const serializeQuestion = (row, { internal = true, viewerInvitationId = null } = {}) => ({
  id: row.id,
  question: row.question,
  askedAt: toIso(row.askedAt),
  ...(internal ? { askedBy: row.askedBy || null, invitationId: row.invitationId || null, companyName: row.invitation?.companyName || null } : { mine: Boolean(viewerInvitationId && row.invitationId === viewerInvitationId) }),
  answer: row.answer || null,
  answeredAt: toIso(row.answeredAt),
  shared: Boolean(row.shared),
  status: row.status,
});

const serializeBidLine = (row) => ({ id: row.id, packageLineId: row.packageLineId, rate: row.rate === null || row.rate === undefined ? null : num(row.rate), amount: num(row.amount), included: Boolean(row.included), note: row.note || null });

const serializeBid = (row, { internal = true } = {}) => ({
  id: row.id,
  invitationId: row.invitationId,
  ...(internal ? { companyName: row.invitation?.companyName || null, contactName: row.invitation?.contactName || null, contactEmail: row.invitation?.contactEmail || null, vendorCompanyId: row.invitation?.vendorCompanyId || null } : {}),
  version: row.version,
  status: row.status,
  total: num(row.total),
  currency: row.currency || null,
  notes: row.notes || null,
  inclusions: row.inclusions || null,
  exclusions: row.exclusions || null,
  validityDays: row.validityDays ?? null,
  leadTimeDays: row.leadTimeDays ?? null,
  documentId: row.documentId || null,
  submittedAt: toIso(row.submittedAt),
  submittedBy: row.submittedBy || null,
  withdrawnAt: toIso(row.withdrawnAt),
  awardedAt: toIso(row.awardedAt),
  lines: (row.lines || []).map(serializeBidLine),
  updatedAt: toIso(row.updatedAt),
});

const serializePackage = (row, { detail = false, viewer = null } = {}) => ({
  id: row.id,
  projectId: row.projectId,
  // Whose move it is: the buyer sending it out, the bidders pricing it, or
  // the PM deciding the winner (OCTA-UX-BALLINCOURT-087).
  ballInCourt: ballInCourt("bid_package", row, viewer),
  number: row.number,
  ref: row.ref,
  title: row.title,
  description: row.description || null,
  instructions: row.instructions || null,
  status: row.status,
  dueAt: toIso(row.dueAt),
  questionsDueAt: toIso(row.questionsDueAt),
  currency: row.currency,
  boqSections: row.boqSections || [],
  commitmentType: row.commitmentType,
  // The procurement package these quotes price, when the enquiry came from
  // there. Without it on the way out, Procurement cannot show the buyer that
  // these are its quotes.
  procurementPackageId: row.procurementPackageId ?? null,
  publishedAt: toIso(row.publishedAt),
  closedAt: toIso(row.closedAt),
  awardedAt: toIso(row.awardedAt),
  awardedBidId: row.awardedBidId || null,
  awardedCommitmentId: row.awardedCommitmentId || null,
  softAwardBidId: row.softAwardBidId || null,
  isPastDue: Boolean(row.dueAt && new Date(row.dueAt) < new Date()),
  counts: { lines: row._count?.lines ?? row.lines?.length ?? 0, invitations: row._count?.invitations ?? row.invitations?.length ?? 0, questions: row._count?.questions ?? row.questions?.length ?? 0, bids: (row.bids || []).filter((bid) => [BID_STATUS.SUBMITTED, BID_STATUS.AWARDED, BID_STATUS.UNSUCCESSFUL].includes(bid.status)).length, openQuestions: (row.questions || []).filter((question) => question.status === "open").length },
  createdBy: row.createdBy || null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
  ...(detail
    ? {
        lines: (row.lines || []).map((line) => serializeLine(line)),
        invitations: (row.invitations || []).map((invitation) => serializeInvitation(invitation)),
        addenda: (row.addenda || []).map(serializeAddendum),
        questions: (row.questions || []).map((question) => serializeQuestion(question)),
        bids: (row.bids || []).filter((bid) => bid.status !== BID_STATUS.DRAFT).map((bid) => serializeBid(bid)),
      }
    : {}),
});

const detailInclude = {
  lines: { orderBy: [{ sortOrder: "asc" }, { lineNumber: "asc" }] },
  invitations: { orderBy: { createdAt: "asc" }, include: { bids: { select: { status: true, total: true } } } },
  addenda: { orderBy: { number: "asc" } },
  questions: { orderBy: { askedAt: "asc" }, include: { invitation: { select: { companyName: true } } } },
  bids: { include: { lines: true, invitation: { select: { companyName: true, contactName: true, contactEmail: true, vendorCompanyId: true } } }, orderBy: { submittedAt: "asc" } },
};

const loadPackage = async ({ orgId, projectId, packageId, include = detailInclude }) => {
  const row = await prisma.bidPackage.findFirst({ where: { id: packageId, projectId, orgId }, include });
  if (!row) throw new HttpError(404, "BID_PACKAGE_NOT_FOUND", "Bid package not found");
  return row;
};

const audit = ({ tx = prisma, orgId, projectId, packageId, action, actor, summary, oldStatus = null, newStatus = null, reason = null }) =>
  auditService.recordEvent({ tx, orgId, projectId, entityType: auditService.ENTITY_TYPES.BID_PACKAGE || "bid_package", entityId: packageId, action, actorId: actor?.id || null, actorRole: actor?.role || null, oldStatus, newStatus, reason, summary }).catch(() => null);

const notifyTeam = ({ orgId, projectId, pkg, actorId = null, event, title, message, priority = "normal", recipientUserIds = [] }) =>
  notificationService.createNotifications({ orgId, projectId, actorId, recipientUserIds: [...new Set([pkg.createdBy, ...recipientUserIds].filter(Boolean))], recipientRoles: ["pm", "procurement"], category: notificationService.NOTIFICATION_CATEGORIES?.COMMERCIAL || "commercial", event, title, message, priority, entityType: "bid_package", entityId: pkg.id, dedupeKeyBase: `${event}:${pkg.id}:${Date.now()}`, actionUrl: `/projects/${projectId}/commercial/bids?recordId=${pkg.id}` }).catch(() => null);

// ─── packages ──────────────────────────────────────────────────────────────

const listPackages = async ({ orgId, projectId, status = null, viewer = null }) => {
  await ensureProject({ orgId, projectId });
  const rows = await prisma.bidPackage.findMany({ where: { projectId, orgId, ...(status ? { status } : {}) }, include: { _count: { select: { lines: true, invitations: true, questions: true } }, bids: { select: { status: true } }, questions: { select: { status: true } } }, orderBy: { number: "desc" } });
  return rows.map((row) => serializePackage(row, { viewer }));
};

const getPackage = async ({ orgId, projectId, packageId, viewer = null }) =>
  serializePackage(await loadPackage({ orgId, projectId, packageId }), { detail: true, viewer });

const listBoqSections = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });
  const rows = await prisma.boqItem.groupBy({ by: ["section"], where: { projectId, isActive: true, supersededAt: null }, _count: { _all: true }, _sum: { amount: true } });
  return rows.map((row) => ({ section: row.section || "(no section)", key: row.section || "", items: row._count?._all ?? 0, amount: round2(num(row._sum?.amount)) })).sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true }));
};

const packageData = (payload, { project, existing = null }) => {
  const data = {};
  if (payload.title !== undefined || !existing) {
    const title = trimOrNull(payload.title);
    if (!title) throw new HttpError(400, "BID_TITLE_REQUIRED", "Give the bid package a title");
    data.title = title.slice(0, 200);
  }
  if (payload.description !== undefined) data.description = trimOrNull(payload.description)?.slice(0, 4000) || null;
  if (payload.instructions !== undefined) data.instructions = trimOrNull(payload.instructions)?.slice(0, 8000) || null;
  const dueAt = optionalDate(payload.dueAt, "dueAt");
  if (dueAt !== undefined) data.dueAt = dueAt;
  const questionsDueAt = optionalDate(payload.questionsDueAt, "questionsDueAt");
  if (questionsDueAt !== undefined) data.questionsDueAt = questionsDueAt;
  if (payload.currency !== undefined || !existing) data.currency = (trimOrNull(payload.currency) || existing?.currency || project?.currency || "USD").toUpperCase().slice(0, 3);
  // Which procurement package these quotes are being sought for, when the
  // enquiry started from Procurement. Set once, at creation, by that route.
  if (payload.procurementPackageId !== undefined) {
    data.procurementPackageId = trimOrNull(payload.procurementPackageId);
  }
  if (payload.commitmentType !== undefined || !existing) {
    const type = String(payload.commitmentType || existing?.commitmentType || "subcontract").toLowerCase();
    if (!COMMITMENT_TYPES.includes(type)) throw new HttpError(400, "BID_COMMITMENT_TYPE", `commitmentType must be one of ${COMMITMENT_TYPES.join(", ")}`);
    data.commitmentType = type;
  }
  if (payload.boqSections !== undefined) {
    // A list of section names. Any other shape was turned into text and stored
    // as a section: ["x"] as "x", {"not":"x"} as "[object Object]", 5 as "5",
    // null as "" (CERT-2 shapes).
    if (!Array.isArray(payload.boqSections) || payload.boqSections.some((item) => typeof item !== "string")) {
      throw new HttpError(400, "BID_SECTIONS_INVALID", "boqSections is a list of BOQ section names");
    }
    data.boqSections = [...new Set(payload.boqSections.map((item) => item.trim()))];
  }
  return data;
};

/**
 * What a package or a line may point at: only its own project's procurement
 * package, BOQ item, activity and budget line, and its own organisation's cost
 * code (CERT-2 injection sweep). Unchecked, another company's ids were stored
 * on the line, served back in the package, and carried into the awarded
 * commitment's schedule of values. A foreign id gets exactly the 404 an id
 * that exists nowhere gets, before anything is written.
 */
const assertPackageReferences = async ({ tx = prisma, projectId, data }) => {
  await refs.assertProjectRows({ tx, model: "procurementPackage", projectId, ids: data.procurementPackageId, code: "PROCUREMENT_PACKAGE_NOT_FOUND", message: "Procurement package not found" });
};

const assertLineReferences = async ({ tx = prisma, orgId, projectId, data }) => {
  await refs.assertProjectRows({ tx, model: "boqItem", projectId, ids: data.boqItemId, code: "BOQ_ITEM_NOT_FOUND", message: "BOQ item not found" });
  await refs.assertProjectRows({ tx, model: "activity", projectId, ids: data.activityId, code: "ACTIVITY_NOT_FOUND", message: "Activity not found" });
  await refs.assertProjectRows({ tx, model: "budgetLine", projectId, ids: data.budgetLineId, code: "BUDGET_LINE_NOT_FOUND", message: "Budget line not found" });
  // Cost codes belong to the organisation, not to a project.
  const costCodeIds = refs.idsOf(data.costCodeId);
  if (costCodeIds.length) {
    const found = orgId && tx.costCode?.findMany ? await tx.costCode.findMany({ where: { id: { in: costCodeIds }, orgId }, select: { id: true } }) : [];
    if (found.length !== costCodeIds.length) throw new HttpError(404, "COST_CODE_NOT_FOUND", "Cost code not found");
  }
};

/**
 * The cost coding a BOQ item already implies (OCTA-BID-CODING-065).
 *
 * A bid line seeded from the BOQ used to carry only `boqItemId`, so the award
 * built a schedule of values with no activity, no cost code and no budget line
 * — and the certified cost then landed on the ledger attached to nothing.
 * Activity actual cost, budget actual and therefore earned value were all blind
 * to it, while reconciliation still read "balanced" because both sides agreed
 * on nothing.
 *
 * The information was there the whole time: the BOQ item is allocated to
 * activities, and activities are allocated to budget lines.
 *
 * **Only where it is unambiguous.** A BOQ item split across three activities
 * cannot honestly be one schedule-of-values line naming one of them, and
 * picking the largest share would put real money on the wrong activity. Split
 * items are left uncoded so a person codes them, which is a visible gap rather
 * than a silent mis-posting.
 */
const codingForBoqItems = async ({ tx, projectId, boqItemIds }) => {
  const coding = new Map();
  if (!boqItemIds.length || !tx.activityBoqAllocation?.findMany) return coding;

  const allocations = await tx.activityBoqAllocation.findMany({
    where: { projectId, boqItemId: { in: boqItemIds }, status: "approved", isActive: true },
    select: { boqItemId: true, activityId: true },
  });

  const byItem = new Map();
  for (const row of allocations) {
    byItem.set(row.boqItemId, [...(byItem.get(row.boqItemId) || []), row.activityId]);
  }

  // Activity → budget line, again only when one line owns the activity.
  const activityIds = [...new Set([...byItem.values()].filter((ids) => ids.length === 1).map((ids) => ids[0]))];
  const budgetByActivity = new Map();
  if (activityIds.length && tx.budgetLineActivityAllocation?.findMany) {
    const links = await tx.budgetLineActivityAllocation.findMany({
      where: { projectId, activityId: { in: activityIds } },
      select: { activityId: true, budgetLineId: true, budgetLine: { select: { id: true, costCodeId: true } } },
    });
    const grouped = new Map();
    for (const link of links) grouped.set(link.activityId, [...(grouped.get(link.activityId) || []), link]);
    for (const [activityId, rows] of grouped) {
      if (rows.length === 1) budgetByActivity.set(activityId, rows[0].budgetLine);
    }
  }

  for (const [boqItemId, ids] of byItem) {
    if (ids.length !== 1) continue;
    const activityId = ids[0];
    const budgetLine = budgetByActivity.get(activityId) || null;
    coding.set(boqItemId, {
      activityId,
      budgetLineId: budgetLine?.id || null,
      costCodeId: budgetLine?.costCodeId || null,
    });
  }
  return coding;
};

// The BOQ items of the chosen sections. "" is the key listBoqSections gives the
// items without a section (null or ""): it was sent to Prisma as `in: [null]`,
// which Prisma refuses, so choosing "(no section)" answered 500.
const sectionWhere = (sections) => {
  const named = [...new Set(sections.filter(Boolean))];
  const clauses = [...(named.length ? [{ section: { in: named } }] : []), ...(sections.some((section) => !section) ? [{ section: null }, { section: "" }] : [])];
  return clauses.length === 1 ? clauses[0] : { OR: clauses };
};

const linesFromBoq = async ({ tx, projectId, sections = null, boqItemIds = null, existingBoqIds = new Set(), startNumber = 1 }) => {
  const where = { projectId, isActive: true, supersededAt: null, ...(boqItemIds?.length ? { id: { in: boqItemIds } } : {}), ...(sections?.length ? sectionWhere(sections) : {}) };
  const items = await tx.boqItem.findMany({ where, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
  const wanted = items.filter((item) => !existingBoqIds.has(item.id));
  const coding = await codingForBoqItems({ tx, projectId, boqItemIds: wanted.map((item) => item.id) });
  let lineNumber = startNumber;
  return wanted.map((item, index) => ({
    lineNumber: lineNumber++,
    boqItemId: item.id,
    section: item.section || null,
    code: item.code || item.ref || null,
    description: item.description,
    unit: item.unit || null,
    qty: round3(num(item.qty)),
    estimateRate: round2(num(item.rate)),
    // Carried so the award can build a schedule of values that actual cost can
    // find its way home from.
    ...(coding.get(item.id) || {}),
    sortOrder: startNumber - 1 + index,
  }));
};

const createPackage = async ({ orgId, projectId, payload = {}, actor = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const data = packageData(payload, { project });
  await assertPackageReferences({ projectId, data });
  const created = await prisma.$transaction(async (tx) => {
    // Phase 20 moved this off `count + 1`, which collided after any deletion,
    // onto MAX + 1 — which closes the gap but not the race: two requests
    // reading the same maximum still compute the same number and one loses on
    // the unique (projectId, ref). The counter settles it in a single atomic
    // statement, the same way every other register now does
    // (OCTA-API-REFNUM-111).
    const { number } = await nextReferenceNumber(tx, {
      table: "BidPackage",
      scopeColumn: "projectId",
      scopeId: projectId,
      prefix: "BP",
    });
    const lines = data.boqSections?.length ? await linesFromBoq({ tx, projectId, sections: data.boqSections }) : [];
    if (lines.length > MAX_LINES) throw new HttpError(400, "BID_LINES_TOO_MANY", `At most ${MAX_LINES} lines per package`);
    const row = await tx.bidPackage.create({ data: { orgId, projectId, number, ref: `BP-${String(number).padStart(3, "0")}`, ...data, createdBy: actor?.id || null, updatedBy: actor?.id || null, lines: { create: lines.map((line) => ({ ...line, orgId })) } }, include: detailInclude });
    await audit({ tx, orgId, projectId, packageId: row.id, action: auditService.ACTIONS.CREATED, actor, summary: { ref: row.ref, title: row.title, lines: lines.length, sections: data.boqSections || [] } });
    return row;
  });
  return serializePackage(created, { detail: true });
};

const assertEditable = (pkg) => {
  if ([STATUS.AWARDED, STATUS.CANCELLED].includes(pkg.status)) throw new HttpError(409, "BID_PACKAGE_LOCKED", `A ${pkg.status} package cannot be changed`);
};

const updatePackage = async ({ orgId, projectId, packageId, payload = {}, actor = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const existing = await loadPackage({ orgId, projectId, packageId, include: { invitations: true } });
  assertEditable(existing);
  const data = packageData(payload, { project, existing });
  delete data.boqSections;
  await assertPackageReferences({ projectId, data });
  const row = await prisma.bidPackage.update({ where: { id: existing.id }, data: { ...data, updatedBy: actor?.id || null }, include: detailInclude });
  await audit({ orgId, projectId, packageId: row.id, action: auditService.ACTIONS.UPDATED, actor, summary: { ref: row.ref, fields: Object.keys(payload) } });
  if (existing.status === STATUS.OPEN && data.dueAt && (!existing.dueAt || new Date(existing.dueAt).getTime() !== data.dueAt.getTime())) {
    await emailBidders({ pkg: row, subject: `${row.ref} ${row.title}: bid due date changed`, text: `The due date for ${row.title} is now ${data.dueAt.toISOString().slice(0, 16).replace("T", " ")} UTC.` });
  }
  return serializePackage(row, { detail: true });
};

const cancelPackage = async ({ orgId, projectId, packageId, actor = null, reason = null }) => {
  const existing = await loadPackage({ orgId, projectId, packageId, include: { invitations: true } });
  if (existing.status === STATUS.AWARDED) throw new HttpError(409, "BID_PACKAGE_LOCKED", "An awarded package cannot be cancelled");
  const row = await prisma.bidPackage.update({ where: { id: existing.id }, data: { status: STATUS.CANCELLED, updatedBy: actor?.id || null }, include: detailInclude });
  await audit({ orgId, projectId, packageId: row.id, action: auditService.ACTIONS.STATUS_CHANGED || "status_changed", actor, oldStatus: existing.status, newStatus: STATUS.CANCELLED, summary: { ref: row.ref, reason: trimOrNull(reason) } });
  if (existing.status === STATUS.OPEN) await emailBidders({ pkg: row, subject: `${row.ref} ${row.title}: cancelled`, text: `The bid package ${row.title} has been cancelled.${reason ? ` ${reason}` : ""}` });
  return serializePackage(row, { detail: true });
};

// ─── lines ─────────────────────────────────────────────────────────────────

const nextLineNumber = async ({ tx, packageId }) => {
  const last = await tx.bidPackageLine.findFirst({ where: { packageId }, orderBy: { lineNumber: "desc" }, select: { lineNumber: true } });
  return (last?.lineNumber || 0) + 1;
};

const addLinesFromBoq = async ({ orgId, projectId, packageId, sections = null, boqItemIds = null, actor = null }) => {
  const pkg = await loadPackage({ orgId, projectId, packageId, include: { lines: { select: { boqItemId: true } } } });
  assertEditable(pkg);
  if (pkg.status !== STATUS.DRAFT) throw new HttpError(409, "BID_PACKAGE_OPEN", "Add lines before publishing; use an addendum for changes after");
  const added = await prisma.$transaction(async (tx) => {
    const start = await nextLineNumber({ tx, packageId });
    const lines = await linesFromBoq({ tx, projectId, sections, boqItemIds, existingBoqIds: new Set(pkg.lines.map((line) => line.boqItemId).filter(Boolean)), startNumber: start });
    if (pkg.lines.length + lines.length > MAX_LINES) throw new HttpError(400, "BID_LINES_TOO_MANY", `At most ${MAX_LINES} lines per package`);
    if (lines.length) await tx.bidPackageLine.createMany({ data: lines.map((line) => ({ ...line, orgId, packageId })) });
    if (sections?.length) await tx.bidPackage.update({ where: { id: packageId }, data: { boqSections: [...new Set([...(pkg.boqSections || []), ...sections])] } });
    return lines.length;
  });
  await audit({ orgId, projectId, packageId, action: auditService.ACTIONS.UPDATED, actor, summary: { ref: pkg.ref, linesAdded: added, sections: sections || [] } });
  return getPackage({ orgId, projectId, packageId });
};

const lineData = (payload, existing = null) => {
  const data = {};
  if (payload.description !== undefined || !existing) {
    const description = trimOrNull(payload.description);
    if (!description) throw new HttpError(400, "BID_LINE_DESCRIPTION_REQUIRED", "The line needs a description");
    data.description = description.slice(0, 500);
  }
  if (payload.section !== undefined) data.section = trimOrNull(payload.section)?.slice(0, 120) || null;
  if (payload.code !== undefined) data.code = trimOrNull(payload.code)?.slice(0, 60) || null;
  if (payload.unit !== undefined) data.unit = trimOrNull(payload.unit)?.slice(0, 30) || null;
  if (payload.qty !== undefined) {
    const qty = Number(payload.qty);
    if (!Number.isFinite(qty) || qty < 0) throw new HttpError(400, "BID_LINE_QTY_INVALID", "Quantity must be a positive number");
    data.qty = round3(qty);
  }
  if (payload.estimateRate !== undefined) data.estimateRate = payload.estimateRate === null || payload.estimateRate === "" ? null : round2(Number(payload.estimateRate));
  for (const key of ["budgetLineId", "costCodeId", "activityId", "boqItemId"]) if (payload[key] !== undefined) data[key] = trimOrNull(payload[key]);
  return data;
};

const addLine = async ({ orgId, projectId, packageId, payload = {}, actor = null }) => {
  const pkg = await loadPackage({ orgId, projectId, packageId, include: { _count: { select: { lines: true } } } });
  assertEditable(pkg);
  if (pkg._count.lines >= MAX_LINES) throw new HttpError(400, "BID_LINES_TOO_MANY", `At most ${MAX_LINES} lines per package`);
  const data = lineData(payload);
  await assertLineReferences({ orgId, projectId, data });
  await prisma.$transaction(async (tx) => {
    const lineNumber = await nextLineNumber({ tx, packageId });
    await tx.bidPackageLine.create({ data: { orgId, packageId, lineNumber, sortOrder: lineNumber - 1, qty: data.qty ?? 1, ...data } });
  });
  await audit({ orgId, projectId, packageId, action: auditService.ACTIONS.UPDATED, actor, summary: { ref: pkg.ref, lineAdded: data.description } });
  return getPackage({ orgId, projectId, packageId });
};

const updateLine = async ({ orgId, projectId, packageId, lineId, payload = {}, actor = null }) => {
  const pkg = await loadPackage({ orgId, projectId, packageId, include: {} });
  assertEditable(pkg);
  const existing = await prisma.bidPackageLine.findFirst({ where: { id: lineId, packageId } });
  if (!existing) throw new HttpError(404, "BID_LINE_NOT_FOUND", "Line not found");
  const data = lineData(payload, existing);
  await assertLineReferences({ orgId, projectId, data });
  await prisma.bidPackageLine.update({ where: { id: existing.id }, data });
  await audit({ orgId, projectId, packageId, action: auditService.ACTIONS.UPDATED, actor, summary: { ref: pkg.ref, lineUpdated: existing.lineNumber, fields: Object.keys(payload) } });
  return getPackage({ orgId, projectId, packageId });
};

const deleteLine = async ({ orgId, projectId, packageId, lineId, actor = null }) => {
  const pkg = await loadPackage({ orgId, projectId, packageId, include: {} });
  assertEditable(pkg);
  if (pkg.status !== STATUS.DRAFT) throw new HttpError(409, "BID_PACKAGE_OPEN", "Lines cannot be removed after publishing");
  const existing = await prisma.bidPackageLine.findFirst({ where: { id: lineId, packageId } });
  if (!existing) throw new HttpError(404, "BID_LINE_NOT_FOUND", "Line not found");
  await prisma.bidPackageLine.delete({ where: { id: existing.id } });
  await audit({ orgId, projectId, packageId, action: auditService.ACTIONS.UPDATED, actor, summary: { ref: pkg.ref, lineRemoved: existing.lineNumber } });
  return getPackage({ orgId, projectId, packageId });
};

// ─── invitations & email ───────────────────────────────────────────────────

const linkExpiry = (pkg) => {
  const base = pkg.dueAt ? new Date(pkg.dueAt).getTime() + LINK_GRACE_DAYS * 86_400_000 : Date.now() + DEFAULT_LINK_DAYS * 86_400_000;
  return new Date(Math.max(base, Date.now() + 7 * 86_400_000));
};

/** Issues a fresh token for an invitation (old links stop working) and returns the raw token. */
const rotateToken = async ({ tx = prisma, invitation, pkg }) => {
  const token = newToken();
  await tx.bidInvitation.update({ where: { id: invitation.id }, data: { tokenHash: hashToken(token), expiresAt: linkExpiry(pkg) } });
  return token;
};

const invitationEmail = ({ pkg, invitation, token, project, kind = "invite", extra = null }) => {
  const due = pkg.dueAt ? `Bids are due by ${new Date(pkg.dueAt).toISOString().slice(0, 16).replace("T", " ")} UTC.` : "";
  const intro = kind === "reminder" ? `A reminder about the bid package ${pkg.ref} ${pkg.title}.` : kind === "addendum" ? `An addendum was issued for ${pkg.ref} ${pkg.title}.` : `${invitation.contactName ? `${invitation.contactName}, ` : ""}you are invited to bid on ${pkg.ref} ${pkg.title}${project?.name ? ` (${project.name})` : ""}.`;
  return {
    to: invitation.contactEmail,
    subject: kind === "addendum" ? `${pkg.ref} ${pkg.title}: addendum${extra?.number ? ` ${extra.number}` : ""}` : kind === "reminder" ? `${pkg.ref} ${pkg.title}: reminder` : `Invitation to bid: ${pkg.ref} ${pkg.title}`,
    body: [intro, extra?.text || null, due, "", `Open your bid portal (documents, questions, pricing form): ${portalUrl(token)}`, `This link is personal to ${invitation.companyName} and expires ${linkExpiry(pkg).toISOString().slice(0, 10)}.`].filter((line) => line !== null).join("\n"),
  };
};

const sendInvitationEmail = async ({ pkg, invitation, project, kind = "invite", extra = null }) => {
  const token = await rotateToken({ invitation, pkg });
  await emailService.sendEmail(invitationEmail({ pkg, invitation, token, project, kind, extra })).catch((error) => console.warn("[bids] email failed", error?.message || error));
  return token;
};

const activeInvitations = (pkg) => (pkg.invitations || []).filter((invitation) => invitation.status !== INVITE_STATUS.DECLINED);

const emailBidders = async ({ pkg, subject, text, kind = "addendum", extra = null }) => {
  const project = await prisma.project.findFirst({ where: { id: pkg.projectId }, select: { id: true, name: true } });
  const invitations = pkg.invitations ? activeInvitations(pkg) : activeInvitations(await loadPackage({ orgId: pkg.orgId, projectId: pkg.projectId, packageId: pkg.id, include: { invitations: true } }));
  for (const invitation of invitations) await sendInvitationEmail({ pkg, invitation, project, kind, extra: { ...(extra || {}), text: text || extra?.text || null, subject } });
  return invitations.length;
};

/**
 * Invites bidders, refusing any vendor from the directory that is not
 * prequalified (OCTA-SUB-PREQUAL-057) unless a reason is given.
 *
 * The gate only bites on vendors the directory knows, because an assessment
 * is the only thing it can read. A one-off invitation to an email address is
 * a company nobody has assessed yet — that shows on the package as
 * "not assessed" rather than being quietly waved through.
 */
const inviteBidders = async ({ orgId, projectId, packageId, invitations = [], actor = null, prequalOverrideReason = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const pkg = await loadPackage({ orgId, projectId, packageId, include: { invitations: true } });
  assertEditable(pkg);
  const list = Array.isArray(invitations) ? invitations : [];
  if (!list.length) throw new HttpError(400, "BID_INVITATIONS_REQUIRED", "Add at least one bidder");
  if (pkg.invitations.length + list.length > MAX_INVITATIONS) throw new HttpError(400, "BID_INVITATIONS_TOO_MANY", `At most ${MAX_INVITATIONS} bidders per package`);
  // A directory vendor named on an invitation must be this organisation's,
  // and is checked before the prequalification gate reads it. Unchecked,
  // another company's vendor (like one that exists nowhere) was answered "not
  // prequalified" with its id handed back in the details; now either is the
  // 404 a missing vendor gets, before anything is written (CERT-2).
  await refs.assertCompanies({ orgId, companyIds: list.map((entry) => entry?.vendorCompanyId), code: "VENDOR_NOT_FOUND", message: "Vendor company not found" });
  const unqualified = await prequalService.assertInvitable({
    orgId,
    companies: list.map((entry) => ({ companyId: trimOrNull(entry.vendorCompanyId), name: trimOrNull(entry.companyName) || "This vendor" })),
    override: prequalOverrideReason,
  });
  const created = [];
  for (const entry of list) {
    let companyName = trimOrNull(entry.companyName);
    let contactEmail = trimOrNull(entry.contactEmail)?.toLowerCase();
    let contactName = trimOrNull(entry.contactName);
    const vendorCompanyId = trimOrNull(entry.vendorCompanyId);
    if (vendorCompanyId) {
      const company = await prisma.company.findFirst({ where: { id: vendorCompanyId, orgId }, select: { id: true, name: true, email: true, contactName: true } });
      if (!company) throw new HttpError(404, "VENDOR_NOT_FOUND", "Vendor company not found");
      companyName = companyName || company.name;
      contactEmail = contactEmail || company.email?.toLowerCase() || null;
      contactName = contactName || company.contactName || null;
    }
    if (!companyName) throw new HttpError(400, "BID_INVITATION_COMPANY", "Each bidder needs a company name");
    if (!contactEmail || !isEmail(contactEmail)) throw new HttpError(400, "BID_INVITATION_EMAIL", `${companyName}: a valid contact email is needed`);
    if (pkg.invitations.some((row) => row.contactEmail === contactEmail) || created.some((row) => row.contactEmail === contactEmail)) throw new HttpError(409, "BID_INVITATION_EXISTS", `${contactEmail} is already invited`);
    const token = newToken();
    const row = await prisma.bidInvitation.create({ data: { orgId, packageId, vendorCompanyId, companyName: companyName.slice(0, 200), contactName: contactName?.slice(0, 120) || null, contactEmail, tokenHash: hashToken(token), expiresAt: linkExpiry(pkg), createdBy: actor?.id || null } });
    let rawToken = token;
    if (pkg.status === STATUS.OPEN) rawToken = await sendInvitationEmail({ pkg, invitation: row, project });
    created.push({ ...row, rawToken });
  }
  await audit({
    orgId,
    projectId,
    packageId,
    action: auditService.ACTIONS.UPDATED,
    actor,
    reason: unqualified.length ? trimOrNull(prequalOverrideReason) : null,
    summary: {
      ref: pkg.ref,
      invited: created.map((row) => row.companyName),
      ...(unqualified.length ? { prequalificationOverridden: unqualified.map((entry) => entry.name) } : {}),
    },
  });
  return created.map((row) => serializeInvitation(row, { token: pkg.status === STATUS.OPEN ? row.rawToken : null }));
};

const resendInvitation = async ({ orgId, projectId, packageId, invitationId, actor = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const pkg = await loadPackage({ orgId, projectId, packageId, include: {} });
  if (pkg.status !== STATUS.OPEN) throw new HttpError(409, "BID_PACKAGE_NOT_OPEN", "Publish the package before sending invitations");
  const invitation = await prisma.bidInvitation.findFirst({ where: { id: invitationId, packageId } });
  if (!invitation) throw new HttpError(404, "BID_INVITATION_NOT_FOUND", "Bidder not found");
  const token = await sendInvitationEmail({ pkg, invitation, project, kind: "reminder" });
  const updated = await prisma.bidInvitation.update({ where: { id: invitation.id }, data: { remindersSent: { increment: 1 } } });
  await audit({ orgId, projectId, packageId, action: auditService.ACTIONS.UPDATED, actor, summary: { ref: pkg.ref, resent: invitation.companyName } });
  return serializeInvitation(updated, { token });
};

const removeInvitation = async ({ orgId, projectId, packageId, invitationId, actor = null }) => {
  const pkg = await loadPackage({ orgId, projectId, packageId, include: {} });
  assertEditable(pkg);
  const invitation = await prisma.bidInvitation.findFirst({ where: { id: invitationId, packageId }, include: { bids: { select: { status: true } } } });
  if (!invitation) throw new HttpError(404, "BID_INVITATION_NOT_FOUND", "Bidder not found");
  if (invitation.bids.some((bid) => bid.status === BID_STATUS.SUBMITTED)) throw new HttpError(409, "BID_INVITATION_HAS_BID", "This bidder has submitted a bid");
  await prisma.bidInvitation.delete({ where: { id: invitation.id } });
  await audit({ orgId, projectId, packageId, action: auditService.ACTIONS.UPDATED, actor, summary: { ref: pkg.ref, removed: invitation.companyName } });
  return { deleted: true };
};

// ─── lifecycle ─────────────────────────────────────────────────────────────

const publishPackage = async ({ orgId, projectId, packageId, actor = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const pkg = await loadPackage({ orgId, projectId, packageId, include: { lines: { select: { id: true } }, invitations: true } });
  if (pkg.status !== STATUS.DRAFT) throw new HttpError(409, "BID_PACKAGE_NOT_DRAFT", "Only draft packages can be published");
  if (!pkg.lines.length) throw new HttpError(400, "BID_LINES_REQUIRED", "Add bid form lines first");
  if (!pkg.invitations.length) throw new HttpError(400, "BID_INVITATIONS_REQUIRED", "Invite at least one bidder first");
  if (!pkg.dueAt || new Date(pkg.dueAt) <= new Date()) throw new HttpError(400, "BID_DUE_DATE_REQUIRED", "Set a due date in the future");
  const row = await prisma.bidPackage.update({ where: { id: pkg.id }, data: { status: STATUS.OPEN, publishedAt: new Date(), updatedBy: actor?.id || null }, include: detailInclude });
  for (const invitation of pkg.invitations) await sendInvitationEmail({ pkg: row, invitation, project });
  await audit({ orgId, projectId, packageId, action: auditService.ACTIONS.STATUS_CHANGED || "status_changed", actor, oldStatus: STATUS.DRAFT, newStatus: STATUS.OPEN, summary: { ref: row.ref, bidders: pkg.invitations.length } });
  return serializePackage(row, { detail: true });
};

const closePackage = async ({ orgId, projectId, packageId, actor = null }) => {
  const pkg = await loadPackage({ orgId, projectId, packageId, include: {} });
  if (pkg.status !== STATUS.OPEN) throw new HttpError(409, "BID_PACKAGE_NOT_OPEN", "Only open packages can be closed");
  const row = await prisma.bidPackage.update({ where: { id: pkg.id }, data: { status: STATUS.CLOSED, closedAt: new Date(), updatedBy: actor?.id || null }, include: detailInclude });
  await audit({ orgId, projectId, packageId, action: auditService.ACTIONS.STATUS_CHANGED || "status_changed", actor, oldStatus: STATUS.OPEN, newStatus: STATUS.CLOSED, summary: { ref: row.ref } });
  return serializePackage(row, { detail: true });
};

const reopenPackage = async ({ orgId, projectId, packageId, dueAt, actor = null }) => {
  const pkg = await loadPackage({ orgId, projectId, packageId, include: { invitations: true } });
  if (pkg.status !== STATUS.CLOSED) throw new HttpError(409, "BID_PACKAGE_NOT_CLOSED", "Only closed packages can be reopened");
  const due = optionalDate(dueAt, "dueAt");
  if (!due || due <= new Date()) throw new HttpError(400, "BID_DUE_DATE_REQUIRED", "Set a new due date in the future");
  const row = await prisma.bidPackage.update({ where: { id: pkg.id }, data: { status: STATUS.OPEN, closedAt: null, dueAt: due, softAwardBidId: null, updatedBy: actor?.id || null }, include: detailInclude });
  await emailBidders({ pkg: row, subject: `${row.ref} ${row.title}: bidding reopened`, text: `Bidding on ${row.title} has been reopened; bids are now due by ${due.toISOString().slice(0, 16).replace("T", " ")} UTC.` });
  await audit({ orgId, projectId, packageId, action: auditService.ACTIONS.STATUS_CHANGED || "status_changed", actor, oldStatus: STATUS.CLOSED, newStatus: STATUS.OPEN, summary: { ref: row.ref, dueAt: due.toISOString() } });
  return serializePackage(row, { detail: true });
};

const issueAddendum = async ({ orgId, projectId, packageId, payload = {}, actor = null }) => {
  const pkg = await loadPackage({ orgId, projectId, packageId, include: { invitations: true, addenda: { select: { number: true } } } });
  if (![STATUS.OPEN, STATUS.DRAFT].includes(pkg.status)) throw new HttpError(409, "BID_PACKAGE_LOCKED", "Addenda can be issued on draft or open packages");
  const title = trimOrNull(payload.title);
  if (!title) throw new HttpError(400, "BID_ADDENDUM_TITLE_REQUIRED", "Give the addendum a title");
  const number = (pkg.addenda.reduce((max, row) => Math.max(max, row.number), 0) || 0) + 1;
  const row = await prisma.bidAddendum.create({ data: { orgId, packageId, number, title: title.slice(0, 200), body: trimOrNull(payload.body)?.slice(0, 8000) || null, issuedBy: actor?.id || null } });
  if (pkg.status === STATUS.OPEN) await emailBidders({ pkg, subject: null, text: `${title}${row.body ? `\n\n${row.body}` : ""}`, kind: "addendum", extra: { number } });
  await audit({ orgId, projectId, packageId, action: auditService.ACTIONS.UPDATED, actor, summary: { ref: pkg.ref, addendum: number, title } });
  return serializeAddendum(row);
};

const answerQuestion = async ({ orgId, projectId, packageId, questionId, payload = {}, actor = null }) => {
  const pkg = await loadPackage({ orgId, projectId, packageId, include: { invitations: true } });
  const question = await prisma.bidQuestion.findFirst({ where: { id: questionId, packageId }, include: { invitation: true } });
  if (!question) throw new HttpError(404, "BID_QUESTION_NOT_FOUND", "Question not found");
  const answer = trimOrNull(payload.answer);
  if (!answer) throw new HttpError(400, "BID_ANSWER_REQUIRED", "Write an answer");
  const shared = Boolean(payload.shared);
  const row = await prisma.bidQuestion.update({ where: { id: question.id }, data: { answer: answer.slice(0, 8000), answeredAt: new Date(), answeredBy: actor?.id || null, shared, status: "answered" }, include: { invitation: { select: { companyName: true } } } });
  const project = await prisma.project.findFirst({ where: { id: projectId }, select: { id: true, name: true } });
  const text = `Question: ${question.question}\n\nAnswer: ${answer}`;
  if (shared) await emailBidders({ pkg, subject: null, text, kind: "addendum", extra: { text, subject: `${pkg.ref} ${pkg.title}: question answered` } });
  else if (question.invitation && question.invitation.status !== INVITE_STATUS.DECLINED) await sendInvitationEmail({ pkg, invitation: question.invitation, project, kind: "addendum", extra: { text, subject: `${pkg.ref} ${pkg.title}: your question was answered` } });
  await audit({ orgId, projectId, packageId, action: auditService.ACTIONS.UPDATED, actor, summary: { ref: pkg.ref, questionAnswered: question.id, shared } });
  return serializeQuestion(row);
};

// ─── portal (token, no login) ──────────────────────────────────────────────

const portalInclude = { package: { include: { lines: { orderBy: [{ sortOrder: "asc" }, { lineNumber: "asc" }] }, addenda: { orderBy: { number: "asc" } }, questions: { orderBy: { askedAt: "asc" } } } }, bids: { include: { lines: true }, take: 1 } };

const portalContext = async (token, { touch = true } = {}) => {
  const trimmed = trimOrNull(token);
  if (!trimmed) throw new HttpError(404, "BID_LINK_INVALID", "This bid link is not valid");
  const invitation = await prisma.bidInvitation.findUnique({ where: { tokenHash: hashToken(trimmed) }, include: portalInclude });
  if (!invitation) throw new HttpError(404, "BID_LINK_INVALID", "This bid link is not valid or has been replaced by a newer email");
  if (new Date(invitation.expiresAt) < new Date()) throw new HttpError(410, "BID_LINK_EXPIRED", "This bid link has expired; ask for a new invitation");
  if (invitation.package.status === STATUS.CANCELLED) throw new HttpError(410, "BID_PACKAGE_CANCELLED", "This bid package was cancelled");
  if (touch) {
    const data = { lastAccessAt: new Date() };
    if (invitation.status === INVITE_STATUS.INVITED) Object.assign(data, { status: INVITE_STATUS.VIEWED, viewedAt: new Date() });
    await prisma.bidInvitation.update({ where: { id: invitation.id }, data }).catch(() => null);
    Object.assign(invitation, data);
  }
  return invitation;
};

const packageDocuments = async ({ pkg, token }) => {
  if (!prisma.attachment?.findMany) return [];
  const rows = await prisma.attachment.findMany({ where: { projectId: pkg.projectId, recordType: "bid_package", recordId: pkg.id }, include: { document: { select: { id: true, originalName: true, fileName: true, mimeType: true, sizeBytes: true, uploadedAt: true } } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return rows.filter((row) => row.document).map((row) => ({ id: row.document.id, fileName: row.document.originalName || row.document.fileName, mimeType: row.document.mimeType, sizeBytes: row.document.sizeBytes, caption: row.caption || null, uploadedAt: toIso(row.document.uploadedAt), downloadUrl: `/api/v1/public/bids/${encodeURIComponent(token)}/documents/${row.document.id}` }));
};

const portalView = async (token) => {
  const invitation = await portalContext(token);
  const pkg = invitation.package;
  const acceptingBids = pkg.status === STATUS.OPEN && (!pkg.dueAt || new Date(pkg.dueAt) > new Date());
  const bid = invitation.bids[0] || null;
  return {
    invitation: { id: invitation.id, companyName: invitation.companyName, contactName: invitation.contactName, contactEmail: invitation.contactEmail, status: invitation.status, expiresAt: toIso(invitation.expiresAt), declinedReason: invitation.declinedReason || null },
    package: {
      ref: pkg.ref,
      title: pkg.title,
      description: pkg.description || null,
      instructions: pkg.instructions || null,
      status: pkg.status,
      acceptingBids,
      dueAt: toIso(pkg.dueAt),
      questionsDueAt: toIso(pkg.questionsDueAt),
      questionsOpen: acceptingBids && (!pkg.questionsDueAt || new Date(pkg.questionsDueAt) > new Date()),
      currency: pkg.currency,
      lines: pkg.lines.map((line) => serializeLine(line, { internal: false })),
      addenda: pkg.addenda.map(serializeAddendum),
      questions: pkg.questions.filter((question) => question.invitationId === invitation.id || (question.shared && question.status === "answered")).map((question) => serializeQuestion(question, { internal: false, viewerInvitationId: invitation.id })),
      documents: await packageDocuments({ pkg, token }),
      awarded: pkg.status === STATUS.AWARDED ? (pkg.awardedBidId && bid?.id === pkg.awardedBidId ? "you" : "other") : null,
    },
    bid: bid ? serializeBid(bid, { internal: false }) : null,
  };
};

const portalDocument = async (token, documentId) => {
  const invitation = await portalContext(token, { touch: false });
  const pkg = invitation.package;
  const attachment = prisma.attachment?.findFirst ? await prisma.attachment.findFirst({ where: { projectId: pkg.projectId, recordType: "bid_package", recordId: pkg.id, documentId } }) : null;
  if (!attachment) throw new HttpError(404, "FILE_NOT_FOUND", "File not found");
  await prisma.bidInvitation.update({ where: { id: invitation.id }, data: { lastAccessAt: new Date() } }).catch(() => null);
  return require("./attachment.service").getDocumentFile({ orgId: invitation.orgId, projectId: pkg.projectId, documentId });
};

const portalAsk = async (token, { question, askedBy = null }) => {
  const invitation = await portalContext(token);
  const pkg = invitation.package;
  const text = trimOrNull(question);
  if (!text) throw new HttpError(400, "BID_QUESTION_REQUIRED", "Write your question");
  if (pkg.status !== STATUS.OPEN) throw new HttpError(409, "BID_PACKAGE_NOT_OPEN", "Questions are closed");
  if (pkg.questionsDueAt && new Date(pkg.questionsDueAt) < new Date()) throw new HttpError(409, "BID_QUESTIONS_CLOSED", "The question period has ended");
  const row = await prisma.bidQuestion.create({ data: { orgId: invitation.orgId, packageId: pkg.id, invitationId: invitation.id, question: text.slice(0, 4000), askedBy: trimOrNull(askedBy)?.slice(0, 120) || invitation.contactName || invitation.companyName } });
  await notifyTeam({ orgId: invitation.orgId, projectId: pkg.projectId, pkg, event: "bid.question", title: `${pkg.ref}: question from ${invitation.companyName}`, message: text.slice(0, 300), priority: "normal" });
  return serializeQuestion(row, { internal: false, viewerInvitationId: invitation.id });
};

const computeBidLines = ({ pkg, lines }) => {
  const byId = new Map(pkg.lines.map((line) => [line.id, line]));
  const entries = Array.isArray(lines) ? lines : [];
  const out = new Map();
  for (const entry of entries) {
    const packageLine = byId.get(trimOrNull(entry?.packageLineId));
    if (!packageLine) throw new HttpError(400, "BID_LINE_UNKNOWN", "A priced line does not belong to this package");
    const included = entry.included !== false;
    const rate = entry.rate === null || entry.rate === undefined || entry.rate === "" ? null : Number(String(entry.rate).replace(/,/g, ""));
    if (rate !== null && (!Number.isFinite(rate) || rate < 0)) throw new HttpError(400, "BID_RATE_INVALID", `Line ${packageLine.lineNumber}: the rate must be a positive number`);
    const amount = included && rate !== null ? round2(num(packageLine.qty) * rate) : 0;
    out.set(packageLine.id, { packageLineId: packageLine.id, rate: rate === null ? null : round2(rate), amount, included, note: trimOrNull(entry.note)?.slice(0, 500) || null });
  }
  const total = round2([...out.values()].reduce((sum, line) => sum + line.amount, 0));
  return { lines: [...out.values()], total };
};

const portalSaveBid = async (token, payload = {}) => {
  const invitation = await portalContext(token);
  const pkg = invitation.package;
  if (pkg.status !== STATUS.OPEN) throw new HttpError(409, "BID_PACKAGE_NOT_OPEN", "This package is no longer accepting bids");
  const existing = invitation.bids[0] || null;
  if (existing && existing.status === BID_STATUS.SUBMITTED) throw new HttpError(409, "BID_ALREADY_SUBMITTED", "Withdraw your submitted bid before changing it");
  const { lines, total } = computeBidLines({ pkg, lines: payload.lines ?? (existing?.lines || []).map(serializeBidLine) });
  const data = {
    status: BID_STATUS.DRAFT,
    total,
    currency: pkg.currency,
    notes: payload.notes !== undefined ? trimOrNull(payload.notes)?.slice(0, 4000) || null : existing?.notes || null,
    inclusions: payload.inclusions !== undefined ? trimOrNull(payload.inclusions)?.slice(0, 4000) || null : existing?.inclusions || null,
    exclusions: payload.exclusions !== undefined ? trimOrNull(payload.exclusions)?.slice(0, 4000) || null : existing?.exclusions || null,
    validityDays: payload.validityDays !== undefined ? (payload.validityDays === null || payload.validityDays === "" ? null : Math.max(0, Math.round(Number(payload.validityDays)))) : existing?.validityDays ?? null,
    leadTimeDays: payload.leadTimeDays !== undefined ? (payload.leadTimeDays === null || payload.leadTimeDays === "" ? null : Math.max(0, Math.round(Number(payload.leadTimeDays)))) : existing?.leadTimeDays ?? null,
  };
  const row = await prisma.$transaction(async (tx) => {
    const bid = existing
      ? await tx.bid.update({ where: { id: existing.id }, data: { ...data, version: existing.status === BID_STATUS.WITHDRAWN ? existing.version + 1 : existing.version, withdrawnAt: null } })
      : await tx.bid.create({ data: { orgId: invitation.orgId, packageId: pkg.id, invitationId: invitation.id, ...data } });
    await tx.bidLine.deleteMany({ where: { bidId: bid.id } });
    if (lines.length) await tx.bidLine.createMany({ data: lines.map((line) => ({ ...line, orgId: invitation.orgId, bidId: bid.id })) });
    if (invitation.status === INVITE_STATUS.WITHDRAWN) await tx.bidInvitation.update({ where: { id: invitation.id }, data: { status: INVITE_STATUS.VIEWED } });
    return tx.bid.findUnique({ where: { id: bid.id }, include: { lines: true } });
  });
  return serializeBid(row, { internal: false });
};

const portalSubmitBid = async (token, { submittedBy = null } = {}) => {
  const invitation = await portalContext(token);
  const pkg = invitation.package;
  if (pkg.status !== STATUS.OPEN) throw new HttpError(409, "BID_PACKAGE_NOT_OPEN", "This package is no longer accepting bids");
  if (pkg.dueAt && new Date(pkg.dueAt) < new Date()) throw new HttpError(409, "BID_PAST_DUE", "The due date has passed");
  const bid = invitation.bids[0];
  if (!bid) throw new HttpError(400, "BID_EMPTY", "Price the bid form first");
  if (bid.status === BID_STATUS.SUBMITTED) throw new HttpError(409, "BID_ALREADY_SUBMITTED", "Your bid is already submitted");
  const priced = new Map(bid.lines.map((line) => [line.packageLineId, line]));
  const problems = pkg.lines.filter((line) => {
    const entry = priced.get(line.id);
    return !entry || (entry.included && (entry.rate === null || entry.rate === undefined));
  });
  if (problems.length && !bid.documentId) throw new HttpError(400, "BID_INCOMPLETE", `Price or exclude every line: ${problems.slice(0, 8).map((line) => line.lineNumber).join(", ")}${problems.length > 8 ? "…" : ""}`, { lines: problems.map((line) => line.id) });
  const now = new Date();
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.bid.update({ where: { id: bid.id }, data: { status: BID_STATUS.SUBMITTED, submittedAt: now, submittedBy: trimOrNull(submittedBy)?.slice(0, 120) || invitation.contactName || null }, include: { lines: true } });
    await tx.bidInvitation.update({ where: { id: invitation.id }, data: { status: INVITE_STATUS.SUBMITTED } });
    return updated;
  });
  await notifyTeam({ orgId: invitation.orgId, projectId: pkg.projectId, pkg, event: "bid.submitted", title: `${pkg.ref}: bid received from ${invitation.companyName}`, message: `${num(row.total).toLocaleString()} ${pkg.currency}`, priority: "normal" });
  await audit({ orgId: invitation.orgId, projectId: pkg.projectId, packageId: pkg.id, action: auditService.ACTIONS.UPDATED, actor: null, summary: { ref: pkg.ref, bidSubmitted: invitation.companyName, total: num(row.total) } });
  await emailService.sendEmail({ to: invitation.contactEmail, subject: `${pkg.ref} ${pkg.title}: bid received`, body: `Thank you — your bid of ${num(row.total).toLocaleString()} ${pkg.currency} for ${pkg.title} was received on ${now.toISOString().slice(0, 16).replace("T", " ")} UTC. You can withdraw and resubmit until the due date.` }).catch(() => null);
  return serializeBid(row, { internal: false });
};

const portalWithdrawBid = async (token) => {
  const invitation = await portalContext(token);
  const pkg = invitation.package;
  const bid = invitation.bids[0];
  if (!bid || bid.status !== BID_STATUS.SUBMITTED) throw new HttpError(409, "BID_NOT_SUBMITTED", "There is no submitted bid to withdraw");
  if (pkg.status !== STATUS.OPEN) throw new HttpError(409, "BID_PACKAGE_NOT_OPEN", "Bids can no longer be withdrawn");
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.bid.update({ where: { id: bid.id }, data: { status: BID_STATUS.WITHDRAWN, withdrawnAt: new Date() }, include: { lines: true } });
    await tx.bidInvitation.update({ where: { id: invitation.id }, data: { status: INVITE_STATUS.WITHDRAWN } });
    return updated;
  });
  await notifyTeam({ orgId: invitation.orgId, projectId: pkg.projectId, pkg, event: "bid.withdrawn", title: `${pkg.ref}: ${invitation.companyName} withdrew its bid`, message: "The bidder can resubmit until the due date.", priority: "normal" });
  return serializeBid(row, { internal: false });
};

const portalDecline = async (token, { reason = null } = {}) => {
  const invitation = await portalContext(token);
  const pkg = invitation.package;
  if (invitation.bids[0]?.status === BID_STATUS.SUBMITTED) throw new HttpError(409, "BID_ALREADY_SUBMITTED", "Withdraw your bid instead of declining");
  const row = await prisma.bidInvitation.update({ where: { id: invitation.id }, data: { status: INVITE_STATUS.DECLINED, declinedReason: trimOrNull(reason)?.slice(0, 1000) || null } });
  await notifyTeam({ orgId: invitation.orgId, projectId: pkg.projectId, pkg, event: "bid.declined", title: `${pkg.ref}: ${invitation.companyName} declined to bid`, message: row.declinedReason || "No reason given", priority: "normal" });
  return { status: row.status, declinedReason: row.declinedReason || null };
};

/** A priced form (PDF / spreadsheet) the bidder uploads instead of, or with, the online lines. */
const portalUpload = async (token, { file }) => {
  const invitation = await portalContext(token);
  const pkg = invitation.package;
  if (pkg.status !== STATUS.OPEN) throw new HttpError(409, "BID_PACKAGE_NOT_OPEN", "This package is no longer accepting bids");
  if (!file) throw new HttpError(400, "NO_FILE", "Upload a file");
  const existing = invitation.bids[0] || null;
  if (existing?.status === BID_STATUS.SUBMITTED) throw new HttpError(409, "BID_ALREADY_SUBMITTED", "Withdraw your submitted bid before changing it");
  const fileStorage = require("./file-storage.service");
  const uploaded = await fileStorage.uploadWorkflowFiles({ orgId: invitation.orgId, projectId: pkg.projectId, userId: null, files: [file] });
  const document = Array.isArray(uploaded) ? uploaded[0] : uploaded?.items?.[0] || uploaded?.documents?.[0] || uploaded;
  const documentId = document?.id || document?.documentId || null;
  if (!documentId) throw new HttpError(500, "BID_UPLOAD_FAILED", "The file could not be stored");
  const bid = existing
    ? await prisma.bid.update({ where: { id: existing.id }, data: { documentId, status: BID_STATUS.DRAFT, withdrawnAt: null }, include: { lines: true } })
    : await prisma.bid.create({ data: { orgId: invitation.orgId, packageId: pkg.id, invitationId: invitation.id, documentId, currency: pkg.currency }, include: { lines: true } });
  if (prisma.attachment?.create) {
    await require("./attachment.service").createAttachments({ orgId: invitation.orgId, projectId: pkg.projectId, userId: null, recordType: "bid", recordId: bid.id, role: "attachment", caption: `Priced form from ${invitation.companyName}`, documentIds: [documentId] }).catch(() => null);
  }
  return serializeBid(bid, { internal: false });
};

// ─── leveling & award ──────────────────────────────────────────────────────

const listBids = async ({ orgId, projectId, packageId }) => {
  const pkg = await loadPackage({ orgId, projectId, packageId, include: { bids: { include: { lines: true, invitation: { select: { companyName: true, contactName: true, contactEmail: true, vendorCompanyId: true } } }, orderBy: { submittedAt: "asc" } } } });
  return pkg.bids.filter((bid) => bid.status !== BID_STATUS.DRAFT).map((bid) => serializeBid(bid));
};

/**
 * Side-by-side comparison. A bidder's excluded or unpriced line is plugged
 * with the average of the other bidders' amounts for that line (or the
 * internal estimate when nobody priced it) so totals compare like for like.
 */
const leveling = async ({ orgId, projectId, packageId }) => {
  const pkg = await loadPackage({ orgId, projectId, packageId });
  const bids = pkg.bids.filter((bid) => [BID_STATUS.SUBMITTED, BID_STATUS.AWARDED, BID_STATUS.UNSUCCESSFUL].includes(bid.status));
  const lines = pkg.lines.map((line) => serializeLine(line));
  const cells = {};
  const lineStats = {};
  for (const line of lines) {
    const priced = [];
    for (const bid of bids) {
      const entry = bid.lines.find((item) => item.packageLineId === line.id);
      const included = Boolean(entry && entry.included && entry.rate !== null && entry.rate !== undefined);
      cells[bid.id] = cells[bid.id] || {};
      cells[bid.id][line.id] = { rate: included ? num(entry.rate) : null, amount: included ? num(entry.amount) : null, included: entry ? Boolean(entry.included) : false, note: entry?.note || null, plugged: false, normalizedAmount: null, isLow: false };
      if (included) priced.push(num(entry.amount));
    }
    const low = priced.length ? Math.min(...priced) : null;
    const high = priced.length ? Math.max(...priced) : null;
    const avg = priced.length ? round2(priced.reduce((sum, value) => sum + value, 0) / priced.length) : null;
    const plug = avg ?? line.estimateAmount ?? 0;
    lineStats[line.id] = { low, high, avg, priced: priced.length, spread: low !== null && high !== null ? round2(high - low) : null, plug: round2(plug) };
    for (const bid of bids) {
      const cell = cells[bid.id][line.id];
      if (cell.amount === null) {
        cell.plugged = true;
        cell.normalizedAmount = round2(plug);
      } else {
        cell.normalizedAmount = cell.amount;
        cell.isLow = low !== null && cell.amount === low;
      }
    }
  }
  const bidders = bids
    .map((bid) => {
      const rows = Object.values(cells[bid.id] || {});
      const normalizedTotal = round2(rows.reduce((sum, cell) => sum + (cell.normalizedAmount || 0), 0));
      const plugged = rows.filter((cell) => cell.plugged).length;
      return { bidId: bid.id, invitationId: bid.invitationId, companyName: bid.invitation?.companyName || null, status: bid.status, total: num(bid.total), normalizedTotal, pluggedLines: plugged, lowLines: rows.filter((cell) => cell.isLow).length, validityDays: bid.validityDays ?? null, leadTimeDays: bid.leadTimeDays ?? null, inclusions: bid.inclusions || null, exclusions: bid.exclusions || null, notes: bid.notes || null, documentId: bid.documentId || null, submittedAt: toIso(bid.submittedAt), isSoftAward: pkg.softAwardBidId === bid.id, isAwarded: pkg.awardedBidId === bid.id };
    })
    .sort((a, b) => a.normalizedTotal - b.normalizedTotal)
    .map((bidder, index) => ({ ...bidder, rank: index + 1 }));
  const estimateTotal = round2(lines.reduce((sum, line) => sum + (line.estimateAmount || 0), 0));
  return { package: serializePackage(pkg), lines, lineStats, bidders, cells, estimateTotal };
};

const levelingXlsx = async ({ orgId, projectId, packageId }) => {
  const data = await leveling({ orgId, projectId, packageId });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OctaPM";
  const sheet = workbook.addWorksheet("Leveling");
  const header = ["#", "Section", "Code", "Description", "Unit", "Qty", "Estimate rate", "Estimate amount"];
  for (const bidder of data.bidders) header.push(`${bidder.companyName} rate`, `${bidder.companyName} amount`);
  header.push("Low", "Average", "Spread");
  sheet.addRow(header).font = { bold: true };
  for (const line of data.lines) {
    const row = [line.lineNumber, line.section || "", line.code || "", line.description, line.unit || "", line.qty, line.estimateRate ?? "", line.estimateAmount ?? ""];
    for (const bidder of data.bidders) {
      const cell = data.cells[bidder.bidId]?.[line.id];
      row.push(cell?.rate ?? (cell?.plugged ? "excluded" : ""), cell?.amount ?? (cell?.plugged ? `plug ${cell.normalizedAmount}` : ""));
    }
    const stats = data.lineStats[line.id];
    row.push(stats?.low ?? "", stats?.avg ?? "", stats?.spread ?? "");
    sheet.addRow(row);
  }
  const totals = ["", "", "", "Total", "", "", "", data.estimateTotal];
  for (const bidder of data.bidders) totals.push("", bidder.total);
  sheet.addRow(totals).font = { bold: true };
  const normalized = ["", "", "", "Normalised total (plugs applied)", "", "", "", ""];
  for (const bidder of data.bidders) normalized.push("", bidder.normalizedTotal);
  sheet.addRow(normalized).font = { bold: true };
  sheet.columns.forEach((column, index) => {
    column.width = index === 3 ? 48 : 16;
  });
  const summary = workbook.addWorksheet("Summary");
  summary.addRow(["Rank", "Bidder", "Status", "Total", "Normalised total", "Plugged lines", "Low lines", "Validity (days)", "Lead time (days)", "Inclusions", "Exclusions", "Notes", "Submitted"]).font = { bold: true };
  for (const bidder of data.bidders) summary.addRow([bidder.rank, bidder.companyName, bidder.status, bidder.total, bidder.normalizedTotal, bidder.pluggedLines, bidder.lowLines, bidder.validityDays ?? "", bidder.leadTimeDays ?? "", bidder.inclusions || "", bidder.exclusions || "", bidder.notes || "", bidder.submittedAt || ""]);
  summary.columns.forEach((column, index) => {
    column.width = [8, 28, 12, 16, 18, 12, 10, 12, 14, 40, 40, 40, 20][index] || 14;
  });
  const about = workbook.addWorksheet("About");
  about.addRow(["Package", `${data.package.ref} ${data.package.title}`]);
  about.addRow(["Currency", data.package.currency]);
  about.addRow(["Generated", new Date().toISOString()]);
  about.addRow(["Normalisation", "Excluded or unpriced lines are plugged with the average of the other bidders' amounts (or the estimate when nobody priced the line)."]);
  brandWorkbook(workbook, { title: `Bid leveling — ${data.package.ref}` });
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, fileName: `${data.package.ref.toLowerCase()}-leveling.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
};

const softAward = async ({ orgId, projectId, packageId, bidId, actor = null }) => {
  const pkg = await loadPackage({ orgId, projectId, packageId, include: { bids: { include: { invitation: { select: { companyName: true } } } } } });
  if (![STATUS.OPEN, STATUS.CLOSED].includes(pkg.status)) throw new HttpError(409, "BID_PACKAGE_LOCKED", "Only open or closed packages can be awarded");
  const bid = pkg.bids.find((row) => row.id === bidId && row.status === BID_STATUS.SUBMITTED);
  if (!bid) throw new HttpError(404, "BID_NOT_FOUND", "Pick a submitted bid");
  const row = await prisma.bidPackage.update({ where: { id: pkg.id }, data: { softAwardBidId: bid.id, status: STATUS.CLOSED, closedAt: pkg.closedAt || new Date(), updatedBy: actor?.id || null }, include: detailInclude });
  await audit({ orgId, projectId, packageId, action: auditService.ACTIONS.UPDATED, actor, summary: { ref: pkg.ref, softAward: bid.invitation?.companyName, total: num(bid.total) } });
  await notifyTeam({ orgId, projectId, pkg, actorId: actor?.id || null, event: "bid.soft_award", title: `${pkg.ref}: ${bid.invitation?.companyName} selected (pending confirmation)`, message: `${num(bid.total).toLocaleString()} ${pkg.currency}. Confirm the award to create the commitment.`, priority: "normal" });
  return serializePackage(row, { detail: true });
};

const revokeSoftAward = async ({ orgId, projectId, packageId, actor = null }) => {
  const pkg = await loadPackage({ orgId, projectId, packageId, include: {} });
  if (pkg.status === STATUS.AWARDED) throw new HttpError(409, "BID_PACKAGE_LOCKED", "The award is confirmed; the commitment exists");
  const row = await prisma.bidPackage.update({ where: { id: pkg.id }, data: { softAwardBidId: null, updatedBy: actor?.id || null }, include: detailInclude });
  await audit({ orgId, projectId, packageId, action: auditService.ACTIONS.UPDATED, actor, summary: { ref: pkg.ref, softAward: null } });
  return serializePackage(row, { detail: true });
};

/**
 * The company this award belongs to.
 *
 * Matched on the normalised name (OCTA-ADM-DEDUPE-061), not the exact string.
 * This used to be a case-sensitive comparison while `createVendor` matched
 * case-insensitively, so awarding to "abc piling" beside an existing
 * "ABC Piling" quietly created a second company — one with no
 * prequalification, no performance history and no insurance, which defeated
 * three of the controls built on the directory in a single keystroke.
 */
const ensureVendorCompany = async ({ tx, orgId, invitation }) => {
  if (invitation.vendorCompanyId) return invitation.vendorCompanyId;
  const nameKey = normalizeCompanyName(invitation.companyName);
  const existing = nameKey
    ? await tx.company.findFirst({ where: { orgId, nameKey }, select: { id: true } })
    : null;
  if (existing) return existing.id;
  const created = await tx.company.create({ data: { orgId, name: invitation.companyName, nameKey, email: invitation.contactEmail, contactName: invitation.contactName || null, type: "external", isVendor: true } });
  return created.id;
};

/**
 * Confirms the award: creates the commitment with the SOV from the bid lines
 * and closes the package.
 *
 * The prequalification gate runs again here, on the vendor company that will
 * actually hold the subcontract, and this time it also checks the award
 * against any single-award limit a conditional approval set. This is the
 * second and last chance: after this the commitment exists.
 */
const confirmAward = async ({ orgId, projectId, packageId, payload = {}, actor = null }) => {
  const pkg = await loadPackage({ orgId, projectId, packageId });
  if (pkg.status === STATUS.AWARDED) throw new HttpError(409, "BID_PACKAGE_LOCKED", "The package is already awarded");
  const bidId = trimOrNull(payload.bidId) || pkg.softAwardBidId;
  const bid = pkg.bids.find((row) => row.id === bidId && row.status === BID_STATUS.SUBMITTED);
  if (!bid) throw new HttpError(400, "BID_NOT_FOUND", "Select the bid to award (soft-award it first, or pass bidId)");
  const invitation = await prisma.bidInvitation.findFirst({ where: { id: bid.invitationId } });
  const packageLines = new Map(pkg.lines.map((line) => [line.id, line]));
  const sovLines = bid.lines
    .filter((line) => line.included && line.rate !== null && line.rate !== undefined)
    .map((line) => {
      const packageLine = packageLines.get(line.packageLineId);
      return { description: `${packageLine?.code ? `${packageLine.code} ` : ""}${packageLine?.description || "Bid line"}`.slice(0, 500), unit: packageLine?.unit || null, qty: num(packageLine?.qty ?? 1), rate: num(line.rate), amount: num(line.amount), boqItemId: packageLine?.boqItemId || null, budgetLineId: packageLine?.budgetLineId || null, costCodeId: packageLine?.costCodeId || null, activityId: packageLine?.activityId || null, notes: line.note || null };
    });
  if (!sovLines.length) throw new HttpError(400, "BID_NO_LINES", "The winning bid has no priced lines to build the schedule of values from");
  const commitmentService = require("./commitment.service");
  const vendorCompanyId = await prisma.$transaction((tx) => ensureVendorCompany({ tx, orgId, invitation }));
  const prequalState = await prequalService.assertAwardable({
    orgId,
    companyId: vendorCompanyId,
    companyName: invitation.companyName,
    amount: num(bid.total),
    override: trimOrNull(payload.prequalOverrideReason),
  });
  const commitment = await commitmentService.createCommitment({
    orgId,
    projectId,
    actor,
    payload: {
      type: pkg.commitmentType,
      title: trimOrNull(payload.title) || `${pkg.title} — ${invitation.companyName}`,
      description: [pkg.description, bid.inclusions ? `Inclusions: ${bid.inclusions}` : null, bid.exclusions ? `Exclusions: ${bid.exclusions}` : null, bid.notes ? `Bid notes: ${bid.notes}` : null].filter(Boolean).join("\n\n") || null,
      vendorCompanyId,
      currency: pkg.currency,
      retentionRate: payload.retentionRate,
      startDate: payload.startDate,
      endDate: payload.endDate,
      lines: sovLines,
    },
  });
  const commitmentId = commitment?.id || commitment?.commitment?.id || null;
  const now = new Date();
  const row = await prisma.$transaction(async (tx) => {
    await tx.bid.update({ where: { id: bid.id }, data: { status: BID_STATUS.AWARDED, awardedAt: now } });
    await tx.bid.updateMany({ where: { packageId: pkg.id, id: { not: bid.id }, status: BID_STATUS.SUBMITTED }, data: { status: BID_STATUS.UNSUCCESSFUL } });
    return tx.bidPackage.update({ where: { id: pkg.id }, data: { status: STATUS.AWARDED, awardedAt: now, awardedBidId: bid.id, awardedCommitmentId: commitmentId, softAwardBidId: bid.id, closedAt: pkg.closedAt || now, updatedBy: actor?.id || null }, include: detailInclude });
  });
  await audit({
    orgId,
    projectId,
    packageId,
    action: auditService.ACTIONS.STATUS_CHANGED || "status_changed",
    actor,
    oldStatus: pkg.status,
    newStatus: STATUS.AWARDED,
    reason: trimOrNull(payload.prequalOverrideReason),
    summary: {
      ref: pkg.ref,
      awardedTo: invitation.companyName,
      total: num(bid.total),
      commitmentId,
      commitmentRef: commitment?.ref || null,
      prequalification: prequalState?.status ?? "not_assessed",
    },
  });
  await notifyTeam({ orgId, projectId, pkg, actorId: actor?.id || null, event: "bid.awarded", title: `${pkg.ref} awarded to ${invitation.companyName}`, message: `Commitment ${commitment?.ref || ""} created with ${sovLines.length} schedule-of-values line${sovLines.length === 1 ? "" : "s"}.`, priority: "normal", recipientUserIds: [] });
  const project = await prisma.project.findFirst({ where: { id: projectId }, select: { id: true, name: true } });
  for (const other of row.invitations) {
    const isWinner = other.id === bid.invitationId;
    if (other.status === INVITE_STATUS.DECLINED) continue;
    await emailService.sendEmail({ to: other.contactEmail, subject: `${pkg.ref} ${pkg.title}: ${isWinner ? "you have been awarded the work" : "award decision"}`, body: isWinner ? `Congratulations — ${other.companyName} has been selected for ${pkg.title}${project?.name ? ` on ${project.name}` : ""}. The project team will follow up with the agreement.` : `Thank you for bidding on ${pkg.title}${project?.name ? ` on ${project.name}` : ""}. The work has been awarded to another bidder.` }).catch(() => null);
  }
  return { package: serializePackage(row, { detail: true }), commitment: commitment ? { id: commitmentId, ref: commitment.ref || null, status: commitment.status || null } : null };
};

module.exports = {
  STATUS,
  INVITE_STATUS,
  BID_STATUS,
  COMMITMENT_TYPES,
  codingForBoqItems,
  hashToken,
  portalUrl,
  listPackages,
  getPackage,
  listBoqSections,
  createPackage,
  updatePackage,
  cancelPackage,
  addLinesFromBoq,
  addLine,
  updateLine,
  deleteLine,
  inviteBidders,
  resendInvitation,
  removeInvitation,
  publishPackage,
  closePackage,
  reopenPackage,
  issueAddendum,
  answerQuestion,
  portalView,
  portalDocument,
  portalAsk,
  portalSaveBid,
  portalSubmitBid,
  portalWithdrawBid,
  portalDecline,
  portalUpload,
  listBids,
  leveling,
  levelingXlsx,
  softAward,
  revokeSoftAward,
  confirmAward,
};
