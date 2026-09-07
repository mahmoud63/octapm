const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { addMoney, subtractMoney, multiplyMoney, toMoneyNumber } = require("../utils/money");
const { createPdf } = require("../utils/pdf-writer");
const { recordWorkspacePath } = require("../utils/record-links");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");
const costLedger = require("./cost-ledger.service");
const { isPartyScopedAccess } = require("./company-party.service");

/**
 * Subcontractor payment applications (OCTA-FIN-SUBPAY-021). A pay app is a
 * period claim against an executed commitment's schedule of values: each
 * line carries what was claimed before, this period and to date, capped by
 * the approved progress of the line's activity (the same rule the IPC uses).
 * Retention, materials on site and back-charges give the net payable;
 * payments are recorded against it and flow into the project cash flow.
 */

const STATUS = Object.freeze({ DRAFT: "draft", SUBMITTED: "submitted", UNDER_REVIEW: "under_review", APPROVED: "approved", PAID: "paid", REJECTED: "rejected", VOID: "void" });
const STATUSES = Object.freeze(Object.values(STATUS));
const EDITABLE = Object.freeze([STATUS.DRAFT, STATUS.SUBMITTED, STATUS.UNDER_REVIEW]);
const COUNTED = Object.freeze([STATUS.APPROVED, STATUS.PAID]);
const REJECTION_CODES = Object.freeze(["OVER_APPROVED_PROGRESS", "MISSING_COMPLIANCE", "INCORRECT_QUANTITIES", "DUPLICATE_PERIOD", "BACK_CHARGE_DISPUTE", "OTHER"]);
const EPSILON = 0.01;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const uniqueIds = (values) => [...new Set((values || []).filter(Boolean))];
const optionalDate = (value, field) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "INVALID_DATE", `${field} is invalid`);
  return date;
};
const formatDate = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "—");
const money = (value, currency = "") => `${currency ? `${currency} ` : ""}${toMoneyNumber(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ensureProject = async ({ orgId, projectId }, tx = prisma) => {
  const project = await tx.project.findFirst({ where: { id: projectId, orgId }, select: { id: true, name: true, currency: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

// ─── Visibility ───────────────────────────────────────────────────────────

const companyIdsFor = (viewer) => uniqueIds((viewer?.projectAccess?.partyAccess || []).map((party) => party.companyId));

const visibilityWhere = (viewer) => {
  if (!viewer || !isPartyScopedAccess(viewer.projectAccess || {})) return null;
  const companyIds = companyIdsFor(viewer);
  return { OR: [...(companyIds.length ? [{ commitment: { vendorCompanyId: { in: companyIds } } }] : []), ...(viewer.id ? [{ createdBy: viewer.id }] : [])] };
};

const assertVisible = (row, viewer) => {
  if (!visibilityWhere(viewer)) return;
  const companyIds = companyIdsFor(viewer);
  if ((row.commitment?.vendorCompanyId && companyIds.includes(row.commitment.vendorCompanyId)) || row.createdBy === viewer.id) return;
  throw new HttpError(404, "SUB_PAY_APP_NOT_FOUND", "Payment application not found");
};

// ─── Serialization ────────────────────────────────────────────────────────

const include = {
  commitment: {
    select: { id: true, ref: true, title: true, type: true, status: true, currency: true, retentionRate: true, vendorCompanyId: true, projectPartyId: true, createdBy: true, insuranceJson: true, vendorCompany: { select: { id: true, name: true } } },
  },
  waiverDocument: { select: { id: true, originalName: true, fileName: true } },
  lines: { orderBy: { sortOrder: "asc" }, include: { sovLine: { select: { id: true, lineNumber: true, activityId: true, costCodeId: true, budgetLineId: true, activity: { select: { id: true, name: true, activityCode: true, wbsCode: true } }, costCode: { select: { id: true, code: true } } } } } },
  payments: { orderBy: { paidAt: "asc" } },
};

const insuranceReadyFor = (commitment) =>
  (Array.isArray(commitment?.insuranceJson) ? commitment.insuranceJson : []).every((entry) => !entry.required || (entry.documentId && !(entry.expiresAt && new Date(entry.expiresAt) < new Date())));

/** The line's ceiling: as revised by approved changes, or its original. */
const revisedOf = (line) =>
  toMoneyNumber(line.revisedScheduledAmount) || toMoneyNumber(line.scheduledAmount);

const serializeLine = (line) => ({
  id: line.id,
  sovLineId: line.sovLineId,
  lineNumber: line.sovLine?.lineNumber ?? null,
  description: line.description,
  costCode: line.sovLine?.costCode?.code || null,
  activityId: line.sovLine?.activityId || null,
  activity: line.sovLine?.activity ? { id: line.sovLine.activity.id, name: line.sovLine.activity.name, code: line.sovLine.activity.activityCode || line.sovLine.activity.wbsCode || null } : null,
  scheduledAmount: toMoneyNumber(line.scheduledAmount),
  approvedChangeAmount: toMoneyNumber(line.approvedChangeAmount),
  // What may actually be billed: the line as revised by approved change
  // orders. Older rows carry no revised figure, so fall back to the original.
  revisedScheduledAmount:
    toMoneyNumber(line.revisedScheduledAmount) || toMoneyNumber(line.scheduledAmount),
  previousAmount: toMoneyNumber(line.previousAmount),
  thisPeriodAmount: toMoneyNumber(line.thisPeriodAmount),
  cumulativeAmount: toMoneyNumber(line.cumulativeAmount),
  cumulativePct: revisedOf(line) > 0 ? round2((toMoneyNumber(line.cumulativeAmount) / revisedOf(line)) * 100) : 0,
  materialsOnSite: toMoneyNumber(line.materialsOnSite),
  approvedPct: line.approvedPct === null || line.approvedPct === undefined ? null : Number(line.approvedPct),
  capAmount: line.capAmount === null || line.capAmount === undefined ? null : toMoneyNumber(line.capAmount),
  overClaimAmount: toMoneyNumber(line.overClaimAmount),
  balanceToFinish: subtractMoney(revisedOf(line), line.cumulativeAmount),
  notes: line.notes || null,
});

const serialize = (row, { projectId = row.projectId } = {}) => ({
  id: row.id,
  projectId: row.projectId,
  commitmentId: row.commitmentId,
  commitment: row.commitment ? { id: row.commitment.id, ref: row.commitment.ref, title: row.commitment.title, type: row.commitment.type, status: row.commitment.status, currency: row.commitment.currency, vendor: row.commitment.vendorCompany ? { id: row.commitment.vendorCompany.id, name: row.commitment.vendorCompany.name } : null, insuranceReady: insuranceReadyFor(row.commitment) } : null,
  number: row.number,
  ref: row.ref,
  periodLabel: row.periodLabel,
  periodStart: toIso(row.periodStart),
  periodEnd: toIso(row.periodEnd),
  status: row.status,
  workThisPeriod: toMoneyNumber(row.workThisPeriod),
  workCumulative: toMoneyNumber(row.workCumulative),
  materialsOnSite: toMoneyNumber(row.materialsOnSite),
  grossThisPeriod: toMoneyNumber(row.grossThisPeriod),
  retentionRate: Number(row.retentionRate) || 0,
  retentionThisPeriod: toMoneyNumber(row.retentionThisPeriod),
  retentionCumulative: toMoneyNumber(row.retentionCumulative),
  backCharges: toMoneyNumber(row.backCharges),
  backChargesNote: row.backChargesNote || null,
  otherDeductions: toMoneyNumber(row.otherDeductions),
  otherDeductionsNote: row.otherDeductionsNote || null,
  taxRate: Number(row.taxRate) || 0,
  taxAmount: toMoneyNumber(row.taxAmount),
  netThisPeriod: toMoneyNumber(row.netThisPeriod),
  paidAmount: toMoneyNumber(row.paidAmount),
  outstanding: COUNTED.includes(row.status) ? Math.max(0, subtractMoney(row.netThisPeriod, row.paidAmount)) : 0,
  overClaimAmount: toMoneyNumber(row.overClaimAmount),
  waiverRequired: Boolean(row.waiverRequired),
  waiverDocumentId: row.waiverDocumentId || null,
  waiverDocument: row.waiverDocument ? { id: row.waiverDocument.id, fileName: row.waiverDocument.originalName || row.waiverDocument.fileName, fileUrl: `/api/v1/projects/${projectId}/attachments/documents/${row.waiverDocument.id}` } : null,
  complianceOverrideReason: row.complianceOverrideReason || null,
  overClaimOverrideReason: row.overClaimOverrideReason || null,
  reviewNote: row.reviewNote || null,
  rejectionCode: row.rejectionCode || null,
  rejectedReason: row.rejectedReason || null,
  notes: row.notes || null,
  submittedAt: toIso(row.submittedAt),
  reviewedAt: toIso(row.reviewedAt),
  approvedAt: toIso(row.approvedAt),
  rejectedAt: toIso(row.rejectedAt),
  paidAt: toIso(row.paidAt),
  voidReason: row.voidReason || null,
  lines: (row.lines || []).map(serializeLine),
  payments: (row.payments || []).map((payment) => ({ id: payment.id, amount: toMoneyNumber(payment.amount), paidAt: toIso(payment.paidAt), method: payment.method || null, reference: payment.reference || null, note: payment.note || null })),
  createdBy: row.createdBy || null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
  path: recordWorkspacePath({ projectId, recordType: "sub_pay_app", recordId: row.id }),
});

// ─── Maths ────────────────────────────────────────────────────────────────

/** Σ of earlier approved / paid claims per SOV line of the commitment. */
const previousByLine = async ({ tx = prisma, commitmentId, beforeNumber }) => {
  const lines = await tx.subPayAppLine.findMany({
    where: { payApp: { commitmentId, status: { in: COUNTED }, number: { lt: beforeNumber } } },
    select: { sovLineId: true, thisPeriodAmount: true, payApp: { select: { retentionThisPeriod: true, id: true } } },
  });
  const map = new Map();
  for (const line of lines) map.set(line.sovLineId, addMoney(map.get(line.sovLineId) || 0, line.thisPeriodAmount));
  return map;
};

const retentionHeldBefore = async ({ tx = prisma, commitmentId, beforeNumber }) => {
  const apps = await tx.subPayApp.findMany({ where: { commitmentId, status: { in: COUNTED }, number: { lt: beforeNumber } }, select: { retentionThisPeriod: true } });
  return apps.reduce((acc, app) => addMoney(acc, app.retentionThisPeriod), 0);
};

/** Latest approved progress per activity, as the IPC cap uses it. */
const approvedPctByActivity = async ({ tx = prisma, activityIds }) => {
  const ids = uniqueIds(activityIds);
  if (!ids.length || !tx.activityProgress?.findMany) return new Map();
  const rows = await tx.activityProgress.findMany({ where: { activityId: { in: ids }, status: "approved" }, orderBy: [{ updatedAt: "desc" }], select: { activityId: true, pctComplete: true } });
  const map = new Map();
  for (const row of rows) if (!map.has(row.activityId)) map.set(row.activityId, Math.min(Math.max(Number(row.pctComplete) || 0, 0), 100));
  return map;
};

const CO_STATUS_APPROVED = "approved";

/**
 * What approved change orders have added to each schedule-of-values line.
 *
 * The rule is that previous + current may not exceed the line's scheduled
 * amount — unless an authorised contract modification says otherwise. This is
 * that "unless": an approved change order whose lines name a SOV line raises
 * that line's ceiling by exactly the amount approved.
 *
 * Derived on every read rather than copied onto the line, so there is one
 * place a revised SOV can come from and no second number to fall out of step.
 */
const approvedChangesBySovLine = async ({ tx = prisma, commitmentId }) => {
  const map = new Map();
  if (!tx.commitmentChangeOrder?.findMany) return map;
  const orders = await tx.commitmentChangeOrder.findMany({
    where: { commitmentId, status: CO_STATUS_APPROVED },
    select: { linesJson: true },
  });
  for (const order of orders) {
    const lines = Array.isArray(order.linesJson) ? order.linesJson : [];
    for (const line of lines) {
      if (!line?.sovLineId) continue;
      const amount = toMoneyNumber(line.amount);
      if (!amount) continue;
      map.set(line.sovLineId, addMoney(map.get(line.sovLineId) || 0, amount));
    }
  }
  return map;
};

/**
 * Applies claims to lines: cumulative = previous + this period; cap =
 * approved pct × scheduled when the line has an activity with approved
 * progress; over-claim = max(0, cumulative − cap).
 *
 * "Scheduled" is the line as revised by approved change orders, so extra work
 * that has been properly authorised can be billed and extra work that has not
 * still cannot.
 */
const applyClaims = ({ lines, claims, pctMap, changeMap = new Map() }) =>
  lines.map((line) => {
    const claim = claims.get(line.sovLineId) || {};
    const original = toMoneyNumber(line.scheduledAmount);
    const approvedChange = changeMap.get(line.sovLineId) || 0;
    const scheduled = addMoney(original, approvedChange);
    const previous = toMoneyNumber(line.previousAmount);
    let thisPeriod = claim.thisPeriodAmount;
    if ((thisPeriod === undefined || thisPeriod === null) && claim.thisPeriodPct !== undefined && claim.thisPeriodPct !== null) {
      const targetCumulative = round2(multiplyMoney(scheduled, Number(claim.thisPeriodPct) / 100));
      thisPeriod = subtractMoney(targetCumulative, previous);
    }
    if (thisPeriod === undefined || thisPeriod === null) thisPeriod = toMoneyNumber(line.thisPeriodAmount);
    thisPeriod = round2(thisPeriod);
    if (thisPeriod < -EPSILON) throw new HttpError(400, "SUB_PAY_APP_LINE_NEGATIVE", `Line ${line.sovLine?.lineNumber ?? ""}: this period cannot be negative`);
    const cumulative = addMoney(previous, thisPeriod);
    if (cumulative > scheduled + EPSILON) {
      const error = new HttpError(
        400,
        "SUB_PAY_APP_EXCEEDS_SCHEDULED",
        approvedChange
          ? `Line ${line.sovLine?.lineNumber ?? ""}: ${cumulative} exceeds the revised ${scheduled} (${original} scheduled plus ${approvedChange} of approved changes)`
          : `Line ${line.sovLine?.lineNumber ?? ""}: ${cumulative} exceeds the scheduled ${scheduled}`,
      );
      error.details = { reasonCode: "INCORRECT_QUANTITIES", sovLineId: line.sovLineId };
      throw error;
    }
    const activityId = line.sovLine?.activityId || null;
    const approvedPct = activityId && pctMap.has(activityId) ? pctMap.get(activityId) : null;
    const capAmount = approvedPct === null ? null : round2(multiplyMoney(scheduled, approvedPct / 100));
    const overClaim = capAmount === null ? 0 : Math.max(0, subtractMoney(cumulative, capAmount));
    return {
      ...line,
      revisedScheduledAmount: scheduled,
      approvedChangeAmount: approvedChange,
      thisPeriodAmount: thisPeriod,
      cumulativeAmount: cumulative,
      materialsOnSite: claim.materialsOnSite === undefined || claim.materialsOnSite === null ? toMoneyNumber(line.materialsOnSite) : round2(Number(claim.materialsOnSite) || 0),
      approvedPct,
      capAmount,
      overClaimAmount: round2(overClaim),
      notes: claim.notes === undefined ? line.notes : trimOrNull(claim.notes)?.slice(0, 500) || null,
    };
  });

/**
 * What the subcontractor is actually paid.
 *
 * The same order as the client side, for the same reason: gross, less
 * retention, less what is being withheld, then tax on what is left. Tax on the
 * gross would overpay it every time.
 */
const financials = ({
  lines,
  retentionRate,
  backCharges,
  retentionBefore,
  otherDeductions = 0,
  taxRate = 0,
}) => {
  const workThisPeriod = lines.reduce((acc, line) => addMoney(acc, line.thisPeriodAmount), 0);
  const workCumulative = lines.reduce((acc, line) => addMoney(acc, line.cumulativeAmount), 0);
  const materialsOnSite = lines.reduce((acc, line) => addMoney(acc, line.materialsOnSite), 0);
  const grossThisPeriod = addMoney(workThisPeriod, materialsOnSite);
  const retentionThisPeriod = round2(multiplyMoney(grossThisPeriod, (Number(retentionRate) || 0) / 100));
  const beforeTax = subtractMoney(
    subtractMoney(subtractMoney(grossThisPeriod, retentionThisPeriod), toMoneyNumber(backCharges)),
    toMoneyNumber(otherDeductions),
  );
  const taxAmount = round2(multiplyMoney(beforeTax, (Number(taxRate) || 0) / 100));
  const netThisPeriod = addMoney(beforeTax, taxAmount);
  const overClaimAmount = lines.reduce((acc, line) => addMoney(acc, line.overClaimAmount), 0);
  return {
    workThisPeriod,
    workCumulative,
    materialsOnSite,
    grossThisPeriod,
    retentionThisPeriod,
    retentionCumulative: addMoney(retentionBefore, retentionThisPeriod),
    taxAmount,
    netThisPeriod,
    overClaimAmount,
  };
};

// ─── Loading ──────────────────────────────────────────────────────────────

const loadPayApp = async ({ projectId, payAppId, viewer = null }, tx = prisma) => {
  const row = await tx.subPayApp.findFirst({ where: { id: payAppId, projectId }, include });
  if (!row) throw new HttpError(404, "SUB_PAY_APP_NOT_FOUND", "Payment application not found");
  assertVisible(row, viewer);
  return row;
};

const getPayApp = async ({ orgId, projectId, payAppId, viewer = null }) => {
  await ensureProject({ orgId, projectId });
  return serialize(await loadPayApp({ projectId, payAppId, viewer }), { projectId });
};

const listPayApps = async ({ orgId, projectId, query = {}, viewer = null }) => {
  await ensureProject({ orgId, projectId });
  const where = { projectId };
  if (trimOrNull(query.commitmentId)) where.commitmentId = trimOrNull(query.commitmentId);
  if (STATUSES.includes(query.status)) where.status = query.status;
  else if (!query.includeVoid) where.status = { not: STATUS.VOID };
  const scope = visibilityWhere(viewer);
  if (scope) where.AND = [scope];
  const rows = await prisma.subPayApp.findMany({ where, include, orderBy: [{ createdAt: "desc" }], take: 500 });
  const items = rows.map((row) => serialize(row, { projectId }));
  const sum = (predicate, key) => items.filter(predicate).reduce((acc, item) => addMoney(acc, item[key]), 0);
  return {
    items,
    summary: {
      total: items.length,
      byStatus: STATUSES.reduce((acc, status) => ({ ...acc, [status]: items.filter((item) => item.status === status).length }), {}),
      submittedNet: sum((item) => [STATUS.SUBMITTED, STATUS.UNDER_REVIEW].includes(item.status), "netThisPeriod"),
      approvedNet: sum((item) => COUNTED.includes(item.status), "netThisPeriod"),
      paid: sum((item) => COUNTED.includes(item.status), "paidAmount"),
      outstanding: sum((item) => COUNTED.includes(item.status), "outstanding"),
      retentionHeld: sum((item) => COUNTED.includes(item.status), "retentionThisPeriod"),
    },
  };
};

// ─── Create / update ──────────────────────────────────────────────────────

const audit = ({ tx, orgId, projectId, entityId, action, actor, summary, reason = null, oldStatus = null, newStatus = null }) =>
  auditService.recordEvent({ tx, orgId, projectId, entityType: auditService.ENTITY_TYPES.SUB_PAY_APP, entityId, action, actorId: actor?.id || null, actorRole: actor?.role || null, reason, oldStatus, newStatus, summary, metadata: { source: "commercial.sub_pay_app" } });

const createPayApp = async ({ orgId, projectId, payload = {}, actor = null, viewer = null }) => {
  await ensureProject({ orgId, projectId });
  const commitmentId = trimOrNull(payload.commitmentId);
  if (!commitmentId) throw new HttpError(400, "SUB_PAY_APP_COMMITMENT_REQUIRED", "Pick the commitment to claim against");
  const commitment = await prisma.commitment.findFirst({ where: { id: commitmentId, projectId }, include: { lines: { orderBy: [{ sortOrder: "asc" }, { lineNumber: "asc" }] } } });
  if (!commitment) throw new HttpError(404, "COMMITMENT_NOT_FOUND", "Commitment not found");
  if (viewer && visibilityWhere(viewer)) {
    const companyIds = companyIdsFor(viewer);
    if (!commitment.vendorCompanyId || !companyIds.includes(commitment.vendorCompanyId)) throw new HttpError(404, "COMMITMENT_NOT_FOUND", "Commitment not found");
  }
  if (!["executed", "closed"].includes(commitment.status)) throw new HttpError(409, "SUB_PAY_APP_COMMITMENT_NOT_EXECUTED", "Applications can only be made against an executed commitment");
  if (!commitment.lines.length) throw new HttpError(409, "SUB_PAY_APP_NO_LINES", "The commitment has no schedule of values");
  const periodLabel = trimOrNull(payload.periodLabel);
  if (!periodLabel) throw new HttpError(400, "SUB_PAY_APP_PERIOD_REQUIRED", "Give the application a period (e.g. 2026-09)");
  const created = await prisma.$transaction(async (tx) => {
    const open = await tx.subPayApp.findFirst({ where: { commitmentId, status: { in: [STATUS.DRAFT, STATUS.SUBMITTED, STATUS.UNDER_REVIEW] } }, select: { ref: true } });
    if (open) {
      const error = new HttpError(409, "SUB_PAY_APP_OPEN_EXISTS", `${open.ref} is still open on this commitment`);
      error.details = { reasonCode: "DUPLICATE_PERIOD" };
      throw error;
    }
    const last = await tx.subPayApp.aggregate({ where: { commitmentId }, _max: { number: true } });
    const number = (last?._max?.number || 0) + 1;
    const previous = await previousByLine({ tx, commitmentId, beforeNumber: number });
    const retentionBefore = await retentionHeldBefore({ tx, commitmentId, beforeNumber: number });
    const seeded = commitment.lines.map((line, index) => ({ sovLineId: line.id, sovLine: line, description: line.description, scheduledAmount: toMoneyNumber(line.amount), previousAmount: previous.get(line.id) || 0, thisPeriodAmount: 0, cumulativeAmount: previous.get(line.id) || 0, materialsOnSite: 0, approvedPct: null, capAmount: null, overClaimAmount: 0, notes: null, sortOrder: index }));
    const pctMap = await approvedPctByActivity({ tx, activityIds: commitment.lines.map((line) => line.activityId) });
    const changeMap = await approvedChangesBySovLine({ tx, commitmentId });
    const lines = applyClaims({ lines: seeded, claims: new Map(), pctMap, changeMap });
    const retentionRate = payload.retentionRate === undefined || payload.retentionRate === null || payload.retentionRate === "" ? Number(commitment.retentionRate) || 0 : Number(payload.retentionRate);
    const totals = financials({ lines, retentionRate, backCharges: 0, retentionBefore });
    const row = await tx.subPayApp.create({
      data: {
        orgId,
        projectId,
        commitmentId,
        number,
        ref: `${commitment.ref}-PA${String(number).padStart(2, "0")}`,
        periodLabel: periodLabel.slice(0, 60),
        periodStart: optionalDate(payload.periodStart, "periodStart") ?? null,
        periodEnd: optionalDate(payload.periodEnd, "periodEnd") ?? null,
        status: STATUS.DRAFT,
        retentionRate,
        waiverRequired: Boolean(payload.waiverRequired),
        notes: trimOrNull(payload.notes)?.slice(0, 4000) || null,
        ...totals,
        createdBy: actor?.id || null,
        updatedBy: actor?.id || null,
        lines: { create: lines.map(({ sovLine, ...line }) => ({ ...line, orgId, projectId })) },
      },
      include,
    });
    await audit({ tx, orgId, projectId, entityId: row.id, action: auditService.ACTIONS.CREATED, actor, newStatus: STATUS.DRAFT, summary: { ref: row.ref, commitment: commitment.ref, period: row.periodLabel, lines: lines.length } });
    return row;
  });
  return serialize(created, { projectId });
};

const normalizeClaims = (entries) => {
  if (entries === undefined) return null;
  if (!Array.isArray(entries)) throw new HttpError(400, "SUB_PAY_APP_LINES_INVALID", "lines must be a list");
  const map = new Map();
  for (const entry of entries) {
    const sovLineId = trimOrNull(entry?.sovLineId);
    if (!sovLineId) continue;
    const claim = {};
    if (entry.thisPeriodAmount !== undefined && entry.thisPeriodAmount !== null && entry.thisPeriodAmount !== "") {
      const value = Number(entry.thisPeriodAmount);
      if (!Number.isFinite(value)) throw new HttpError(400, "SUB_PAY_APP_LINE_INVALID", "thisPeriodAmount must be a number");
      claim.thisPeriodAmount = value;
    } else if (entry.thisPeriodPct !== undefined && entry.thisPeriodPct !== null && entry.thisPeriodPct !== "") {
      const value = Number(entry.thisPeriodPct);
      if (!Number.isFinite(value) || value < 0 || value > 100) throw new HttpError(400, "SUB_PAY_APP_LINE_INVALID", "thisPeriodPct must be between 0 and 100");
      claim.thisPeriodPct = value;
    }
    if (entry.materialsOnSite !== undefined && entry.materialsOnSite !== null && entry.materialsOnSite !== "") {
      const value = Number(entry.materialsOnSite);
      if (!Number.isFinite(value) || value < 0) throw new HttpError(400, "SUB_PAY_APP_LINE_INVALID", "materialsOnSite must be zero or positive");
      claim.materialsOnSite = value;
    }
    if (entry.notes !== undefined) claim.notes = entry.notes;
    map.set(sovLineId, claim);
  }
  return map;
};

/** Recomputes lines and totals from the stored lines plus any claims and app-level fields. */
const recompute = async ({ tx, existing, claims = null, patch = {} }) => {
  const pctMap = await approvedPctByActivity({ tx, activityIds: existing.lines.map((line) => line.sovLine?.activityId) });
  const changeMap = await approvedChangesBySovLine({ tx, commitmentId: existing.commitmentId });
  const lines = applyClaims({ lines: existing.lines, claims: claims || new Map(), pctMap, changeMap });
  const retentionRate = patch.retentionRate !== undefined ? patch.retentionRate : Number(existing.retentionRate) || 0;
  const backCharges = patch.backCharges !== undefined ? patch.backCharges : toMoneyNumber(existing.backCharges);
  const otherDeductions = patch.otherDeductions !== undefined ? patch.otherDeductions : toMoneyNumber(existing.otherDeductions);
  const taxRate = patch.taxRate !== undefined ? patch.taxRate : Number(existing.taxRate) || 0;
  const retentionBefore = await retentionHeldBefore({ tx, commitmentId: existing.commitmentId, beforeNumber: existing.number });
  const totals = financials({ lines, retentionRate, backCharges, retentionBefore, otherDeductions, taxRate });
  for (const line of lines) {
    await tx.subPayAppLine.update({ where: { id: line.id }, data: { thisPeriodAmount: line.thisPeriodAmount, cumulativeAmount: line.cumulativeAmount, materialsOnSite: line.materialsOnSite, approvedPct: line.approvedPct, capAmount: line.capAmount, overClaimAmount: line.overClaimAmount, approvedChangeAmount: line.approvedChangeAmount ?? 0, revisedScheduledAmount: line.revisedScheduledAmount ?? toMoneyNumber(line.scheduledAmount), notes: line.notes } });
  }
  return { lines, totals: { ...totals, retentionRate, backCharges, otherDeductions, taxRate } };
};

const updatePayApp = async ({ orgId, projectId, payAppId, payload = {}, actor = null, viewer = null }) => {
  await ensureProject({ orgId, projectId });
  const existing = await loadPayApp({ projectId, payAppId, viewer });
  if (!EDITABLE.includes(existing.status)) throw new HttpError(409, "SUB_PAY_APP_LOCKED", `A ${existing.status} application cannot be edited`);
  const claims = normalizeClaims(payload.lines);
  const patch = {};
  if (payload.retentionRate !== undefined && payload.retentionRate !== null && payload.retentionRate !== "") {
    const rate = Number(payload.retentionRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new HttpError(400, "SUB_PAY_APP_RETENTION_INVALID", "Retention must be between 0 and 100 percent");
    patch.retentionRate = Math.round(rate * 100) / 100;
  }
  if (payload.backCharges !== undefined) {
    const value = Number(payload.backCharges === null || payload.backCharges === "" ? 0 : payload.backCharges);
    if (!Number.isFinite(value) || value < 0) throw new HttpError(400, "SUB_PAY_APP_BACK_CHARGES_INVALID", "Back-charges must be zero or positive");
    patch.backCharges = round2(value);
  }
  if (payload.otherDeductions !== undefined) {
    const value = Number(payload.otherDeductions === null || payload.otherDeductions === "" ? 0 : payload.otherDeductions);
    if (!Number.isFinite(value) || value < 0) throw new HttpError(400, "SUB_PAY_APP_DEDUCTION_INVALID", "A deduction must be zero or positive");
    // Withholding money without saying why is how a payment dispute starts.
    const note = trimOrNull(payload.otherDeductionsNote ?? existing.otherDeductionsNote);
    if (value > EPSILON && !note) throw new HttpError(400, "SUB_PAY_APP_DEDUCTION_REASON_REQUIRED", "Say what is being deducted and why");
    patch.otherDeductions = round2(value);
  }
  if (payload.taxRate !== undefined) {
    const rate = Number(payload.taxRate === null || payload.taxRate === "" ? 0 : payload.taxRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new HttpError(400, "SUB_PAY_APP_TAX_INVALID", "Tax must be between 0 and 100 percent");
    patch.taxRate = Math.round(rate * 100) / 100;
  }
  const data = {};
  if (payload.otherDeductionsNote !== undefined) data.otherDeductionsNote = trimOrNull(payload.otherDeductionsNote)?.slice(0, 1000) || null;
  if (payload.periodLabel !== undefined) {
    const periodLabel = trimOrNull(payload.periodLabel);
    if (!periodLabel) throw new HttpError(400, "SUB_PAY_APP_PERIOD_REQUIRED", "Give the application a period");
    data.periodLabel = periodLabel.slice(0, 60);
  }
  const periodStart = optionalDate(payload.periodStart, "periodStart");
  if (periodStart !== undefined) data.periodStart = periodStart;
  const periodEnd = optionalDate(payload.periodEnd, "periodEnd");
  if (periodEnd !== undefined) data.periodEnd = periodEnd;
  if (payload.backChargesNote !== undefined) data.backChargesNote = trimOrNull(payload.backChargesNote)?.slice(0, 1000) || null;
  if (payload.notes !== undefined) data.notes = trimOrNull(payload.notes)?.slice(0, 4000) || null;
  if (payload.waiverRequired !== undefined) data.waiverRequired = Boolean(payload.waiverRequired);
  if (payload.waiverDocumentId !== undefined) {
    const documentId = trimOrNull(payload.waiverDocumentId);
    if (documentId) {
      const document = await prisma.projectDocument.findFirst({ where: { id: documentId, projectId }, select: { id: true } });
      if (!document) throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Waiver document not found");
    }
    data.waiverDocumentId = documentId || null;
  }
  const updated = await prisma.$transaction(async (tx) => {
    const { totals } = await recompute({ tx, existing, claims, patch });
    const row = await tx.subPayApp.update({ where: { id: payAppId }, data: { ...data, ...totals, updatedBy: actor?.id || null }, include });
    await audit({ tx, orgId, projectId, entityId: payAppId, action: auditService.ACTIONS.UPDATED, actor, summary: { ref: row.ref, net: toMoneyNumber(row.netThisPeriod), overClaim: toMoneyNumber(row.overClaimAmount), changed: [...Object.keys(data), ...(claims ? ["lines"] : []), ...Object.keys(patch)] } });
    return row;
  });
  return serialize(updated, { projectId });
};

// ─── Notifications ────────────────────────────────────────────────────────

const vendorMemberIds = async (projectPartyId) => {
  if (!projectPartyId || !prisma.projectPartyMember?.findMany) return [];
  const members = await prisma.projectPartyMember.findMany({ where: { projectPartyId, status: "active" }, select: { userId: true } });
  return members.map((row) => row.userId);
};

const notify = async ({ orgId, projectId, payApp, recipientUserIds = [], recipientRoles = [], category, event, title, message, actorId = null, priority = "normal" }) =>
  notificationService.createNotifications({
    orgId,
    projectId,
    actorId,
    recipientUserIds: uniqueIds(recipientUserIds).filter((id) => id !== actorId),
    recipientRoles,
    type: "sub_pay_app",
    category,
    event,
    title,
    message,
    priority,
    actionUrl: recordWorkspacePath({ projectId, recordType: "sub_pay_app", recordId: payApp.id }),
    entityType: "sub_pay_app",
    entityId: payApp.id,
    dedupeKeyBase: `sub_pay_app:${payApp.id}:${event}:${Date.now()}`,
    metadata: { ref: payApp.ref, status: payApp.status },
  });

// ─── Workflow ─────────────────────────────────────────────────────────────

const overClaimError = (row) => {
  const lines = (row.lines || []).filter((line) => toMoneyNumber(line.overClaimAmount) > EPSILON);
  const error = new HttpError(400, "SUB_PAY_APP_OVER_CLAIM", `Claims exceed approved progress on ${lines.length} line${lines.length === 1 ? "" : "s"}`);
  error.details = { reasonCode: "OVER_APPROVED_PROGRESS", overClaimAmount: toMoneyNumber(row.overClaimAmount), lines: lines.map((line) => ({ sovLineId: line.sovLineId, description: line.description, cumulativeAmount: toMoneyNumber(line.cumulativeAmount), capAmount: toMoneyNumber(line.capAmount), approvedPct: line.approvedPct, overClaimAmount: toMoneyNumber(line.overClaimAmount) })) };
  return error;
};

/**
 * Certification is the moment a subcontractor's work becomes actual cost
 * (OCTA-FIN-LEDGER-059).
 *
 * Per line, because `SubPayAppLine.sovLineId → CommitmentSovLine` already
 * carries the cost code, budget line and activity — the lineage was always
 * there, it was simply never followed.
 *
 * Gross, not net. Retention is money withheld against a cost the subcontractor
 * has already earned; posting net would understate actual until release and
 * then spike it. Back-charges, other deductions and tax are header-level
 * settlements and do not change what the work cost.
 *
 * `cost-ledger.post` is idempotent on `sourceKey`, so a retried approval, a
 * double click or two concurrent approvals post once.
 */
const postCertifiedCost = async ({ tx, orgId, projectId, payApp, actor }) => {
  const incurredOn = payApp.periodEnd || payApp.approvedAt || new Date();
  let posted = 0;
  let amount = 0;
  for (const line of payApp.lines || []) {
    const value = addMoney(line.thisPeriodAmount, line.materialsOnSite);
    if (!value) continue;
    const result = await costLedger.post({
      tx,
      orgId,
      projectId,
      sourceType: "sub_pay_app",
      sourceId: payApp.id,
      sourceLineId: line.id,
      amount: value,
      costType: "subcontract",
      activityId: line.sovLine?.activityId || null,
      costCodeId: line.sovLine?.costCodeId || null,
      budgetLineId: line.sovLine?.budgetLineId || null,
      commitmentId: payApp.commitmentId,
      incurredOn,
      postedBy: actor?.id || null,
      note: `${payApp.ref} ${payApp.periodLabel}`,
    });
    if (result.posted) {
      posted += 1;
      amount = addMoney(amount, value);
    }
  }
  return { posted, amount };
};

const transition = async ({ orgId, projectId, payAppId, to, actor = null, viewer = null, reason = null, extra = {}, guard = null, action = auditService.ACTIONS.STATUS_CHANGED, viaWorkflow = false }) => {
  await ensureProject({ orgId, projectId });
  const existing = await loadPayApp({ projectId, payAppId, viewer });
  if (!viaWorkflow && [STATUS.APPROVED, STATUS.REJECTED, STATUS.UNDER_REVIEW].includes(to)) {
    await require("./workflow-engine.service").assertNotLocked({ tool: "sub_pay_app", projectId, recordId: payAppId });
  }
  const allowedFrom = {
    [STATUS.SUBMITTED]: [STATUS.DRAFT],
    [STATUS.UNDER_REVIEW]: [STATUS.SUBMITTED],
    [STATUS.APPROVED]: [STATUS.SUBMITTED, STATUS.UNDER_REVIEW],
    [STATUS.REJECTED]: [STATUS.SUBMITTED, STATUS.UNDER_REVIEW],
    [STATUS.DRAFT]: [STATUS.REJECTED],
    [STATUS.VOID]: [STATUS.DRAFT, STATUS.REJECTED],
  }[to];
  if (!allowedFrom?.includes(existing.status)) throw new HttpError(409, "SUB_PAY_APP_TRANSITION_INVALID", `A ${existing.status} application cannot become ${to}`);
  if (guard) await guard(existing);
  const now = new Date();
  const stamps = {
    [STATUS.SUBMITTED]: { submittedAt: now, submittedBy: actor?.id || null, rejectionCode: null, rejectedReason: null },
    [STATUS.UNDER_REVIEW]: { reviewedAt: now, reviewedBy: actor?.id || null },
    [STATUS.APPROVED]: { approvedAt: now, approvedBy: actor?.id || null },
    [STATUS.REJECTED]: { rejectedAt: now, rejectedBy: actor?.id || null },
    [STATUS.DRAFT]: { submittedAt: null, rejectedAt: null },
    [STATUS.VOID]: { voidReason: reason },
  }[to];
  const updated = await prisma.$transaction(async (tx) => {
    // Recompute caps against the latest approved progress before anything final.
    if ([STATUS.SUBMITTED, STATUS.APPROVED].includes(to)) {
      const { totals } = await recompute({ tx, existing });
      Object.assign(existing, totals);
      if (to === STATUS.SUBMITTED && totals.overClaimAmount > EPSILON) {
        const fresh = await tx.subPayApp.findFirst({ where: { id: payAppId }, include });
        throw overClaimError(fresh);
      }
      if (to === STATUS.APPROVED && totals.overClaimAmount > EPSILON && !extra.overClaimOverrideReason) {
        const fresh = await tx.subPayApp.findFirst({ where: { id: payAppId }, include });
        throw overClaimError(fresh);
      }
      extra = { ...extra, ...totals };
    }
    const row = await tx.subPayApp.update({ where: { id: payAppId }, data: { status: to, ...stamps, ...extra, updatedBy: actor?.id || null }, include });
    // Certification is the cost-recognition point (OCTA-FIN-LEDGER-059). It
    // happens inside this transaction so the ledger entry and the status commit
    // together, or neither does.
    let costPosting = null;
    if (to === STATUS.APPROVED) {
      costPosting = await postCertifiedCost({ tx, orgId, projectId, payApp: row, actor });
    } else if (to === STATUS.VOID) {
      costPosting = await costLedger.reverse({ tx, orgId, projectId, sourceType: "sub_pay_app", sourceId: payAppId, postedBy: actor?.id || null, note: reason });
    }
    await audit({ tx, orgId, projectId, entityId: payAppId, action, actor, reason, oldStatus: existing.status, newStatus: to, summary: { ref: row.ref, net: toMoneyNumber(row.netThisPeriod), gross: toMoneyNumber(row.grossThisPeriod), retention: toMoneyNumber(row.retentionThisPeriod), rejectionCode: row.rejectionCode || null, ...(costPosting ? { costPosted: costPosting.amount ?? null, costLines: costPosting.posted ?? null, costReversed: costPosting.reversed ?? null } : {}) } });
    return row;
  });
  const serialized = serialize(updated, { projectId });
  if (to === STATUS.SUBMITTED && !viaWorkflow) {
    require("./workflow-engine.service").maybeStart({ orgId, projectId, tool: "sub_pay_app", recordId: payAppId, actor }).catch(() => null);
  }
  const vendorIds = await vendorMemberIds(updated.commitment?.projectPartyId);
  const currency = updated.commitment?.currency || "";
  if (to === STATUS.SUBMITTED) {
    await notify({ orgId, projectId, payApp: updated, actorId: actor?.id || null, recipientRoles: ["qs", "pm"], category: notificationService.NOTIFICATION_CATEGORIES.APPROVAL, event: "sub_pay_app.submitted", title: `${updated.ref} submitted: ${money(serialized.netThisPeriod, currency)} net`, message: `${updated.commitment?.vendorCompany?.name || "Vendor"} · ${updated.periodLabel}` });
  } else if (to === STATUS.APPROVED) {
    await notify({ orgId, projectId, payApp: updated, actorId: actor?.id || null, recipientUserIds: [updated.createdBy, ...vendorIds], recipientRoles: ["finance"], category: notificationService.NOTIFICATION_CATEGORIES.COMMERCIAL, event: "sub_pay_app.approved", title: `${updated.ref} approved: ${money(serialized.netThisPeriod, currency)} to pay`, message: `Retention held ${money(serialized.retentionThisPeriod, currency)}${serialized.backCharges ? ` · back-charges ${money(serialized.backCharges, currency)}` : ""}` });
  } else if (to === STATUS.REJECTED) {
    await notify({ orgId, projectId, payApp: updated, actorId: actor?.id || null, recipientUserIds: [updated.createdBy, ...vendorIds], category: notificationService.NOTIFICATION_CATEGORIES.COMMERCIAL, event: "sub_pay_app.rejected", title: `${updated.ref} rejected (${updated.rejectionCode || "OTHER"})`, message: reason || "Rejected", priority: "high" });
  } else if (to === STATUS.UNDER_REVIEW) {
    await notify({ orgId, projectId, payApp: updated, actorId: actor?.id || null, recipientUserIds: [updated.createdBy], category: notificationService.NOTIFICATION_CATEGORIES.WORKFLOW, event: "sub_pay_app.under_review", title: `${updated.ref} is being reviewed`, message: extra.reviewNote || "Under review by the QS" });
  }
  return serialized;
};

const submitPayApp = ({ orgId, projectId, payAppId, actor, viewer }) =>
  transition({ orgId, projectId, payAppId, to: STATUS.SUBMITTED, actor, viewer, guard: async (existing) => {
    if (!(existing.lines || []).some((line) => toMoneyNumber(line.thisPeriodAmount) > EPSILON || toMoneyNumber(line.materialsOnSite) > EPSILON)) throw new HttpError(409, "SUB_PAY_APP_EMPTY", "Claim something before submitting");
  } });

const reviewPayApp = ({ orgId, projectId, payAppId, actor, note }) =>
  transition({ orgId, projectId, payAppId, to: STATUS.UNDER_REVIEW, actor, extra: { reviewNote: trimOrNull(note)?.slice(0, 2000) || null } });

/** Approval: compliance gate (insurance on the commitment, waiver when required) and the over-claim check. */
/**
 * Is this the application that finishes the subcontract?
 *
 * It is, when approving it would take the cumulative claim to the revised
 * value — the original schedule of values plus every approved change order.
 * Nobody marks an application "final"; the arithmetic says so.
 */
const isFinalApplication = async ({ existing, tx = prisma }) => {
  const lines = await tx.commitmentSovLine.findMany({
    where: { commitmentId: existing.commitmentId },
    select: { amount: true },
  });
  if (!lines.length) return false;

  const orders = await tx.commitmentChangeOrder.findMany({
    where: { commitmentId: existing.commitmentId, status: "approved" },
    select: { value: true },
  });
  const revised = addMoney(
    lines.reduce((total, line) => addMoney(total, line.amount), 0),
    orders.reduce((total, order) => addMoney(total, order.value), 0),
  );
  if (revised <= EPSILON) return false;

  const claimed = (existing.lines || []).reduce(
    (total, line) => addMoney(total, line.cumulativeAmount),
    0,
  );
  return claimed >= subtractMoney(revised, EPSILON);
};

const approvePayAppCore = ({ orgId, projectId, payAppId, actor, complianceOverrideReason = null, overClaimOverrideReason = null, viaWorkflow = false }) =>
  transition({
    orgId,
    projectId,
    payAppId,
    to: STATUS.APPROVED,
    actor,
    viaWorkflow,
    action: auditService.ACTIONS.APPROVED,
    reason: [complianceOverrideReason && `Compliance override: ${complianceOverrideReason}`, overClaimOverrideReason && `Over-claim override: ${overClaimOverrideReason}`].filter(Boolean).join(" · ") || null,
    extra: { complianceOverrideReason: trimOrNull(complianceOverrideReason)?.slice(0, 1000) || null, overClaimOverrideReason: trimOrNull(overClaimOverrideReason)?.slice(0, 1000) || null },
    guard: async (existing) => {
      const problems = [];
      if (!insuranceReadyFor(existing.commitment)) problems.push("insurance on the commitment is missing or expired");
      if (existing.waiverRequired && !existing.waiverDocumentId) problems.push("the lien waiver is not on file");
      if (problems.length && !trimOrNull(complianceOverrideReason)) {
        const error = new HttpError(409, "SUB_PAY_APP_COMPLIANCE", `Cannot approve: ${problems.join("; ")}`);
        error.details = { reasonCode: "MISSING_COMPLIANCE", problems };
        throw error;
      }
      // The final application — the one that takes the subcontract to its full
      // revised value — runs the closeout gate (OCTA-SUB-CLOSE-056). "Before
      // final payment" is the moment the leverage exists to get the as-builts
      // and the warranties in; after it there is none.
      if (await isFinalApplication({ existing })) {
        await require("./closeout.service").assertReady({
          orgId,
          projectId,
          commitmentId: existing.commitmentId,
          override: complianceOverrideReason,
          what: "paid in full",
        });
      }
    },
  });

/** Approval, then (fire-and-forget) the accounting connectors that auto-sync approved applications (OCTA-INT-API-026). */
const approvePayApp = async (args) => {
  const result = await approvePayAppCore(args);
  require("./accounting.service")
    .maybeQueueOnApproval({ orgId: args.orgId, projectId: args.projectId, payAppId: args.payAppId, actor: args.actor || null })
    .catch((error) => console.warn("[sub-pay-app] accounting auto-sync failed", error?.message || error));
  return result;
};

const rejectPayApp = async ({ orgId, projectId, payAppId, actor, code, reason, viaWorkflow = false }) => {
  const rejectionCode = REJECTION_CODES.includes(code) ? code : "OTHER";
  if (!trimOrNull(reason)) throw new HttpError(400, "SUB_PAY_APP_REASON_REQUIRED", "Say why the application is rejected");
  return transition({ orgId, projectId, payAppId, to: STATUS.REJECTED, actor, viaWorkflow, reason: trimOrNull(reason), action: auditService.ACTIONS.REJECTED, extra: { rejectionCode, rejectedReason: trimOrNull(reason).slice(0, 2000) } });
};

const reopenPayApp = ({ orgId, projectId, payAppId, actor, viewer }) => transition({ orgId, projectId, payAppId, to: STATUS.DRAFT, actor, viewer });

const voidPayApp = ({ orgId, projectId, payAppId, actor, reason }) => {
  if (!trimOrNull(reason)) throw new HttpError(400, "SUB_PAY_APP_REASON_REQUIRED", "Give a reason");
  return transition({ orgId, projectId, payAppId, to: STATUS.VOID, actor, reason: trimOrNull(reason) });
};

// ─── Payments ─────────────────────────────────────────────────────────────

const recordPayment = async ({ orgId, projectId, payAppId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const existing = await loadPayApp({ projectId, payAppId });
  if (!COUNTED.includes(existing.status)) throw new HttpError(409, "SUB_PAY_APP_NOT_APPROVED", "Only approved applications can be paid");
  const amount = round2(Number(payload.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "SUB_PAY_APP_PAYMENT_INVALID", "Enter a positive amount");
  const net = toMoneyNumber(existing.netThisPeriod);
  const alreadyPaid = toMoneyNumber(existing.paidAmount);
  if (addMoney(alreadyPaid, amount) > net + EPSILON) {
    const error = new HttpError(400, "SUB_PAY_APP_PAYMENT_EXCEEDS", `Payment would exceed the net approved ${net}; ${subtractMoney(net, alreadyPaid)} remains`);
    error.details = { netApproved: net, paid: alreadyPaid, remaining: subtractMoney(net, alreadyPaid) };
    throw error;
  }
  const paidAt = optionalDate(payload.paidAt, "paidAt") || new Date();
  const updated = await prisma.$transaction(async (tx) => {
    await tx.subPayAppPayment.create({ data: { orgId, projectId, payAppId, amount, paidAt, method: trimOrNull(payload.method)?.slice(0, 60) || null, reference: trimOrNull(payload.reference)?.slice(0, 120) || null, note: trimOrNull(payload.note)?.slice(0, 1000) || null, createdBy: actor?.id || null } });
    const paidAmount = addMoney(alreadyPaid, amount);
    const fullyPaid = paidAmount >= net - EPSILON;
    const row = await tx.subPayApp.update({ where: { id: payAppId }, data: { paidAmount, paidAt: fullyPaid ? paidAt : existing.paidAt, status: fullyPaid ? STATUS.PAID : existing.status, updatedBy: actor?.id || null }, include });
    await audit({ tx, orgId, projectId, entityId: payAppId, action: fullyPaid ? auditService.ACTIONS.STATUS_CHANGED : auditService.ACTIONS.UPDATED, actor, oldStatus: existing.status, newStatus: row.status, summary: { ref: row.ref, payment: amount, paidAmount, net, reference: trimOrNull(payload.reference) || null } });
    return row;
  });
  try {
    await require("./cash-flow.service").rebuildCashFlow({ orgId, projectId });
  } catch (error) {
    console.warn("[sub-pay-app] cash flow rebuild failed", error?.message || error);
  }
  const vendorIds = await vendorMemberIds(updated.commitment?.projectPartyId);
  await notify({ orgId, projectId, payApp: updated, actorId: actor?.id || null, recipientUserIds: [updated.createdBy, ...vendorIds], category: notificationService.NOTIFICATION_CATEGORIES.COMMERCIAL, event: "sub_pay_app.paid", title: `${updated.ref}: ${money(amount, updated.commitment?.currency || "")} paid`, message: updated.status === STATUS.PAID ? "Paid in full" : `${money(subtractMoney(net, toMoneyNumber(updated.paidAmount)), updated.commitment?.currency || "")} still outstanding` });
  return serialize(updated, { projectId });
};

// ─── Statement PDF ────────────────────────────────────────────────────────

const exportStatementPdf = async ({ orgId, projectId, payAppId, viewer = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const row = await loadPayApp({ projectId, payAppId, viewer });
  const data = serialize(row, { projectId });
  const currency = data.commitment?.currency || "";
  const doc = createPdf({ title: `${data.ref} payment application`, author: project.name, pageSize: "A4", footer: `${project.name} · ${data.ref} · generated ${formatDate(new Date())}` });
  doc.heading(`${data.ref} · ${data.commitment?.title || ""}`);
  doc.keyValues([
    ["Vendor", data.commitment?.vendor?.name || "—"],
    ["Commitment", data.commitment?.ref || "—"],
    ["Period", `${data.periodLabel} (${formatDate(data.periodStart)} → ${formatDate(data.periodEnd)})`],
    ["Status", data.status],
    ["Work this period", money(data.workThisPeriod, currency)],
    ["Materials on site", money(data.materialsOnSite, currency)],
    ["Gross this period", money(data.grossThisPeriod, currency)],
    ["Retention", `${money(data.retentionThisPeriod, currency)} (${data.retentionRate}%) · held to date ${money(data.retentionCumulative, currency)}`],
    ["Back-charges", money(data.backCharges, currency)],
    ["Net payable", money(data.netThisPeriod, currency)],
    ["Paid", money(data.paidAmount, currency)],
  ]);
  doc.heading("Schedule of values", { level: 2 });
  doc.table({
    columns: [
      { key: (line) => String(line.lineNumber ?? ""), label: "#", width: 24 },
      { key: "description", label: "Description", width: 1 },
      { key: (line) => money(line.scheduledAmount), label: "Scheduled", width: 70 },
      { key: (line) => money(line.previousAmount), label: "Previous", width: 70 },
      { key: (line) => money(line.thisPeriodAmount), label: "This period", width: 70 },
      { key: (line) => money(line.cumulativeAmount), label: "To date", width: 70 },
      { key: (line) => (line.approvedPct === null ? "—" : `${line.approvedPct}%`), label: "Approved", width: 55 },
      { key: (line) => money(line.balanceToFinish), label: "Balance", width: 70 },
    ],
    rows: data.lines,
    size: 8,
    zebra: true,
  });
  if (data.payments.length) {
    doc.heading("Payments", { level: 2 });
    doc.table({ columns: [{ key: (p) => formatDate(p.paidAt), label: "Date", width: 70 }, { key: (p) => p.reference || "", label: "Reference", width: 1 }, { key: (p) => p.method || "", label: "Method", width: 80 }, { key: (p) => money(p.amount), label: "Amount", width: 70 }], rows: data.payments, size: 8.5 });
  }
  if (data.reviewNote || data.rejectedReason) {
    doc.heading("Review", { level: 2 });
    doc.paragraph(data.rejectedReason ? `Rejected (${data.rejectionCode || "OTHER"}): ${data.rejectedReason}` : data.reviewNote);
  }
  return { fileName: `${data.ref}.pdf`, buffer: doc.render() };
};

module.exports = {
  STATUS,
  STATUSES,
  REJECTION_CODES,
  COUNTED,
  applyClaims,
  approvedChangesBySovLine,
  financials,
  isFinalApplication,
  insuranceReadyFor,
  visibilityWhere,
  serialize,
  listPayApps,
  getPayApp,
  createPayApp,
  updatePayApp,
  submitPayApp,
  reviewPayApp,
  approvePayApp,
  rejectPayApp,
  reopenPayApp,
  voidPayApp,
  recordPayment,
  exportStatementPdf,
};
