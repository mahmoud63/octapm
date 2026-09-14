const { prisma } = require("../config/db");
const { ballInCourt } = require("./ball-in-court.service");
const { HttpError } = require("../utils/http-error");
const { addMoney, subtractMoney, multiplyMoney, toMoneyNumber } = require("../utils/money");
const { createPdf } = require("../utils/pdf-writer");
const { recordWorkspacePath } = require("../utils/record-links");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");
const { isPartyScopedAccess } = require("./company-party.service");
const fileStorageService = require("./file-storage.service");
const { nextNumber: nextCounterNumber } = require("../utils/reference-number");

/**
 * Commitments (OCTA-FIN-COMMIT-020): subcontracts and purchase-order
 * commitments with a schedule of values whose lines point at cost codes,
 * budget lines, BOQ items and activities. Executing a commitment (and
 * approving a commitment change order) posts committed cost to the budget
 * lines and the activities, so the cost-code view, the activity view and
 * later sub valuations reconcile. A subcontractor party sees only its own
 * commitments and their documents.
 */

const TYPES = Object.freeze(["subcontract", "purchase_order"]);
const STATUS = Object.freeze({ DRAFT: "draft", PENDING: "pending", APPROVED: "approved", EXECUTED: "executed", CLOSED: "closed", VOID: "void" });
const STATUSES = Object.freeze(Object.values(STATUS));
const CO_STATUS = Object.freeze({ DRAFT: "draft", PENDING: "pending", APPROVED: "approved", REJECTED: "rejected", VOID: "void" });
const CO_STATUSES = Object.freeze(Object.values(CO_STATUS));
const EDITABLE_STATUSES = Object.freeze([STATUS.DRAFT, STATUS.PENDING]);
const POSTING_STATUSES = Object.freeze([STATUS.EXECUTED, STATUS.CLOSED]);
const REF_PREFIX = Object.freeze({ subcontract: "SC", purchase_order: "PC" });
const INSURANCE_TYPES = Object.freeze(["general_liability", "workers_compensation", "auto", "umbrella", "professional", "builders_risk", "bond", "other"]);
const MAX_LINES = 500;

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
  const project = await tx.project.findFirst({ where: { id: projectId, orgId }, select: { id: true, name: true, currency: true, defaultRetentionRate: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

// ─── Visibility (party users see their own commitments) ───────────────────

const companyIdsFor = (viewer) => uniqueIds((viewer?.projectAccess?.partyAccess || []).map((party) => party.companyId));

const visibilityWhere = (viewer) => {
  if (!viewer || !isPartyScopedAccess(viewer.projectAccess || {})) return null;
  const companyIds = companyIdsFor(viewer);
  return { OR: [...(companyIds.length ? [{ vendorCompanyId: { in: companyIds } }] : []), ...(viewer.id ? [{ createdBy: viewer.id }] : [])] };
};

const assertVisible = (row, viewer) => {
  if (!visibilityWhere(viewer)) return;
  const companyIds = companyIdsFor(viewer);
  if ((row.vendorCompanyId && companyIds.includes(row.vendorCompanyId)) || row.createdBy === viewer.id) return;
  throw new HttpError(404, "COMMITMENT_NOT_FOUND", "Commitment not found");
};

// ─── Serialization ────────────────────────────────────────────────────────

const include = {
  vendorCompany: { select: { id: true, name: true, email: true, phone: true, contactName: true } },
  projectParty: { select: { id: true, role: true, status: true } },
  supplier: { select: { id: true, name: true } },
  executedDocument: { select: { id: true, originalName: true, fileName: true, mimeType: true, sizeBytes: true, uploadedAt: true } },
  lines: {
    orderBy: [{ sortOrder: "asc" }, { lineNumber: "asc" }],
    include: {
      costCode: { select: { id: true, code: true, name: true } },
      budgetLine: { select: { id: true, costType: true } },
      boqItem: { select: { id: true, code: true, ref: true, description: true } },
      activity: { select: { id: true, name: true, activityCode: true, wbsCode: true } },
    },
  },
  changeOrders: { orderBy: { number: "asc" }, include: { primeChangeOrder: { select: { id: true, ref: true, status: true } } } },
  procurementOrders: { select: { id: true, ref: true, item: true, status: true, value: true }, orderBy: { createdAt: "asc" } },
};

const insuranceStatus = (entry, now = new Date()) => {
  if (!entry.required) return "optional";
  if (!entry.documentId) return "missing";
  if (entry.expiresAt && new Date(entry.expiresAt) < now) return "expired";
  return "ok";
};

const serializeInsurance = (json) => (Array.isArray(json) ? json : []).map((entry) => ({ ...entry, status: insuranceStatus(entry) }));

const serializeLine = (line) => ({
  id: line.id,
  lineNumber: line.lineNumber,
  description: line.description,
  costCodeId: line.costCodeId || null,
  costCode: line.costCode ? { id: line.costCode.id, code: line.costCode.code, name: line.costCode.name } : null,
  budgetLineId: line.budgetLineId || null,
  budgetLineCostType: line.budgetLine?.costType || null,
  boqItemId: line.boqItemId || null,
  boqItem: line.boqItem ? { id: line.boqItem.id, code: line.boqItem.code || line.boqItem.ref || null, description: line.boqItem.description } : null,
  activityId: line.activityId || null,
  activity: line.activity ? { id: line.activity.id, name: line.activity.name, code: line.activity.activityCode || line.activity.wbsCode || null } : null,
  unit: line.unit || null,
  qty: Number(line.qty) || 0,
  rate: toMoneyNumber(line.rate),
  amount: toMoneyNumber(line.amount),
  notes: line.notes || null,
  sortOrder: line.sortOrder,
});

const serializeChangeOrder = (row) => ({
  id: row.id,
  commitmentId: row.commitmentId,
  number: row.number,
  ref: row.ref,
  title: row.title,
  description: row.description || null,
  status: row.status,
  value: toMoneyNumber(row.value),
  primeChangeOrderId: row.primeChangeOrderId || null,
  primeChangeOrder: row.primeChangeOrder ? { id: row.primeChangeOrder.id, ref: row.primeChangeOrder.ref, status: row.primeChangeOrder.status } : null,
  lines: Array.isArray(row.linesJson) ? row.linesJson : [],
  submittedAt: toIso(row.submittedAt),
  approvedAt: toIso(row.approvedAt),
  rejectedAt: toIso(row.rejectedAt),
  rejectedReason: row.rejectedReason || null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const totalsFor = (row) => {
  const original = (row.lines || []).reduce((acc, line) => addMoney(acc, line.amount), 0);
  const approvedChanges = (row.changeOrders || []).filter((co) => co.status === CO_STATUS.APPROVED).reduce((acc, co) => addMoney(acc, co.value), 0);
  const pendingChanges = (row.changeOrders || []).filter((co) => co.status === CO_STATUS.PENDING).reduce((acc, co) => addMoney(acc, co.value), 0);
  const revised = addMoney(original, approvedChanges);
  const drawnDown = (row.procurementOrders || []).filter((po) => !["cancelled"].includes(po.status)).reduce((acc, po) => addMoney(acc, po.value), 0);
  return { original, approvedChanges, pendingChanges, revised, retentionRate: Number(row.retentionRate) || 0, retentionOnRevised: round2(multiplyMoney(revised, (Number(row.retentionRate) || 0) / 100)), drawnDown };
};

const serialize = (row, { projectId = row.projectId, viewer = null } = {}) => {
  const totals = totalsFor(row);
  const insurance = serializeInsurance(row.insuranceJson);
  return {
    id: row.id,
    projectId: row.projectId,
    // Whose move it is: the QS raising it, the PM approving it, or the QS
    // again chasing the signature (OCTA-UX-BALLINCOURT-087).
    ballInCourt: ballInCourt(
      "commitment",
      row,
      viewer,
      row.vendorCompany ? { name: row.vendorCompany.name } : null,
    ),
    number: row.number,
    ref: row.ref,
    type: row.type,
    title: row.title,
    description: row.description || null,
    status: row.status,
    currency: row.currency,
    vendorCompanyId: row.vendorCompanyId || null,
    vendor: row.vendorCompany ? { id: row.vendorCompany.id, name: row.vendorCompany.name, email: row.vendorCompany.email || null, phone: row.vendorCompany.phone || null, contactName: row.vendorCompany.contactName || null } : null,
    projectPartyId: row.projectPartyId || null,
    supplierId: row.supplierId || null,
    supplier: row.supplier ? { id: row.supplier.id, name: row.supplier.name } : null,
    retentionRate: Number(row.retentionRate) || 0,
    paymentTerms: row.paymentTerms || null,
    startDate: toIso(row.startDate),
    endDate: toIso(row.endDate),
    insurance,
    insuranceReady: insurance.every((entry) => entry.status !== "missing" && entry.status !== "expired"),
    executedDocument: row.executedDocument ? { id: row.executedDocument.id, fileName: row.executedDocument.originalName || row.executedDocument.fileName, mimeType: row.executedDocument.mimeType, sizeBytes: row.executedDocument.sizeBytes, uploadedAt: toIso(row.executedDocument.uploadedAt), fileUrl: `/api/v1/projects/${projectId}/attachments/documents/${row.executedDocument.id}` } : null,
    executedAt: toIso(row.executedAt),
    submittedAt: toIso(row.submittedAt),
    approvedAt: toIso(row.approvedAt),
    closedAt: toIso(row.closedAt),
    voidReason: row.voidReason || null,
    notes: row.notes || null,
    ...totals,
    lines: (row.lines || []).map(serializeLine),
    changeOrders: (row.changeOrders || []).map(serializeChangeOrder),
    procurementOrders: (row.procurementOrders || []).map((po) => ({ id: po.id, ref: po.ref, item: po.item, status: po.status, value: toMoneyNumber(po.value) })),
    createdBy: row.createdBy || null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    path: recordWorkspacePath({ projectId, recordType: "commitment", recordId: row.id }),
  };
};

// ─── Loading ──────────────────────────────────────────────────────────────

const loadCommitment = async ({ projectId, commitmentId, viewer = null }, tx = prisma) => {
  const row = await tx.commitment.findFirst({ where: { id: commitmentId, projectId }, include });
  if (!row) throw new HttpError(404, "COMMITMENT_NOT_FOUND", "Commitment not found");
  assertVisible(row, viewer);
  return row;
};

const getCommitment = async ({ orgId, projectId, commitmentId, viewer = null }) => {
  await ensureProject({ orgId, projectId });
  return serialize(await loadCommitment({ projectId, commitmentId, viewer }), { projectId, viewer });
};

const listCommitments = async ({ orgId, projectId, query = {}, viewer = null }) => {
  await ensureProject({ orgId, projectId });
  const where = { projectId };
  if (TYPES.includes(query.type)) where.type = query.type;
  if (STATUSES.includes(query.status)) where.status = query.status;
  else if (!query.includeVoid) where.status = { not: STATUS.VOID };
  if (trimOrNull(query.vendorCompanyId)) where.vendorCompanyId = trimOrNull(query.vendorCompanyId);
  const scope = visibilityWhere(viewer);
  if (scope) where.AND = [scope];
  const search = trimOrNull(query.search);
  if (search) {
    where.OR = [{ ref: { contains: search, mode: "insensitive" } }, { title: { contains: search, mode: "insensitive" } }, { vendorCompany: { name: { contains: search, mode: "insensitive" } } }];
  }
  const rows = await prisma.commitment.findMany({ where, include, orderBy: [{ type: "asc" }, { number: "desc" }], take: 500 });
  const items = rows.map((row) => serialize(row, { projectId, viewer }));
  const summary = {
    total: items.length,
    byStatus: STATUSES.reduce((acc, status) => ({ ...acc, [status]: items.filter((item) => item.status === status).length }), {}),
    original: items.reduce((acc, item) => addMoney(acc, item.original), 0),
    approvedChanges: items.reduce((acc, item) => addMoney(acc, item.approvedChanges), 0),
    revised: items.reduce((acc, item) => addMoney(acc, item.revised), 0),
    committed: items.filter((item) => POSTING_STATUSES.includes(item.status)).reduce((acc, item) => addMoney(acc, item.revised), 0),
    pendingChanges: items.reduce((acc, item) => addMoney(acc, item.pendingChanges), 0),
  };
  return { items, summary };
};

// ─── Validation helpers ───────────────────────────────────────────────────

const normalizeType = (value) => {
  const type = String(value || "subcontract").toLowerCase();
  if (!TYPES.includes(type)) throw new HttpError(400, "COMMITMENT_TYPE_INVALID", `type must be one of ${TYPES.join(", ")}`);
  return type;
};

const normalizeInsurance = (entries) => {
  if (entries === undefined) return undefined;
  if (!Array.isArray(entries)) throw new HttpError(400, "COMMITMENT_INSURANCE_INVALID", "insurance must be a list");
  return entries.slice(0, 20).map((entry) => {
    const type = INSURANCE_TYPES.includes(entry?.type) ? entry.type : "other";
    const expiresAt = optionalDate(entry?.expiresAt, "expiresAt");
    return {
      type,
      label: trimOrNull(entry?.label)?.slice(0, 120) || null,
      required: entry?.required !== false,
      documentId: trimOrNull(entry?.documentId) || null,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      note: trimOrNull(entry?.note)?.slice(0, 500) || null,
    };
  });
};

const normalizeLines = (entries) => {
  if (!Array.isArray(entries)) throw new HttpError(400, "COMMITMENT_LINES_INVALID", "lines must be a list");
  if (entries.length > MAX_LINES) throw new HttpError(400, "COMMITMENT_LINES_TOO_MANY", `At most ${MAX_LINES} lines`);
  return entries.map((entry, index) => {
    const description = trimOrNull(entry?.description);
    if (!description) throw new HttpError(400, "COMMITMENT_LINE_DESCRIPTION_REQUIRED", `Line ${index + 1} needs a description`);
    const qty = entry?.qty === undefined || entry?.qty === null || entry?.qty === "" ? 1 : Number(entry.qty);
    const rate = entry?.rate === undefined || entry?.rate === null || entry?.rate === "" ? null : Number(entry.rate);
    const explicit = entry?.amount === undefined || entry?.amount === null || entry?.amount === "" ? null : Number(entry.amount);
    if (!Number.isFinite(qty) || qty < 0) throw new HttpError(400, "COMMITMENT_LINE_QTY_INVALID", `Line ${index + 1}: quantity must be a positive number`);
    if (rate !== null && !Number.isFinite(rate)) throw new HttpError(400, "COMMITMENT_LINE_RATE_INVALID", `Line ${index + 1}: rate must be a number`);
    if (explicit !== null && !Number.isFinite(explicit)) throw new HttpError(400, "COMMITMENT_LINE_AMOUNT_INVALID", `Line ${index + 1}: amount must be a number`);
    const amount = explicit !== null ? round2(explicit) : round2(multiplyMoney(qty, rate || 0));
    return {
      lineNumber: Number.isInteger(Number(entry?.lineNumber)) && Number(entry.lineNumber) > 0 ? Number(entry.lineNumber) : index + 1,
      description: description.slice(0, 500),
      costCodeId: trimOrNull(entry?.costCodeId) || null,
      budgetLineId: trimOrNull(entry?.budgetLineId) || null,
      boqItemId: trimOrNull(entry?.boqItemId) || null,
      activityId: trimOrNull(entry?.activityId) || null,
      unit: trimOrNull(entry?.unit)?.slice(0, 30) || null,
      qty,
      rate: rate === null ? (qty ? round2(amount / qty) : 0) : round2(rate),
      amount,
      notes: trimOrNull(entry?.notes)?.slice(0, 500) || null,
      sortOrder: index,
    };
  });
};

const validateLineReferences = async ({ tx, orgId, projectId, lines }) => {
  const check = async (model, ids, where, code, label) => {
    const unique = uniqueIds(ids);
    if (!unique.length || !tx[model]?.findMany) return;
    const rows = await tx[model].findMany({ where: { id: { in: unique }, ...where }, select: { id: true } });
    if (rows.length !== unique.length) throw new HttpError(404, code, `One or more ${label} were not found on this project`);
  };
  await check("costCode", lines.map((line) => line.costCodeId), { orgId }, "COST_CODE_NOT_FOUND", "cost codes");
  await check("budgetLine", lines.map((line) => line.budgetLineId), { projectId }, "BUDGET_LINE_NOT_FOUND", "budget lines");
  await check("boqItem", lines.map((line) => line.boqItemId), { projectId }, "BOQ_ITEM_NOT_FOUND", "BOQ items");
  await check("activity", lines.map((line) => line.activityId), { projectId, isActive: true }, "ACTIVITY_NOT_FOUND", "activities");
};

const resolveVendor = async ({ tx, orgId, projectId, payload }) => {
  const data = {};
  if (payload.vendorCompanyId !== undefined) {
    const vendorCompanyId = trimOrNull(payload.vendorCompanyId);
    if (vendorCompanyId) {
      const company = await tx.company.findFirst({ where: { id: vendorCompanyId, orgId }, select: { id: true, isVendor: true } });
      if (!company) throw new HttpError(404, "VENDOR_NOT_FOUND", "Vendor company not found");
      if (!company.isVendor && tx.company?.update) await tx.company.update({ where: { id: company.id }, data: { isVendor: true } });
      data.vendorCompanyId = company.id;
      if (tx.projectParty?.findFirst) {
        const party = await tx.projectParty.findFirst({ where: { projectId, companyId: company.id, status: "active" }, select: { id: true } });
        data.projectPartyId = party?.id || null;
      }
    } else {
      data.vendorCompanyId = null;
      data.projectPartyId = null;
    }
  }
  if (payload.supplierId !== undefined) {
    const supplierId = trimOrNull(payload.supplierId);
    if (supplierId && tx.procurementSupplier?.findFirst) {
      const supplier = await tx.procurementSupplier.findFirst({ where: { id: supplierId, projectId }, select: { id: true, companyId: true } });
      if (!supplier) throw new HttpError(404, "SUPPLIER_NOT_FOUND", "Supplier not found on this project");
      data.supplierId = supplier.id;
      if (data.vendorCompanyId === undefined && supplier.companyId) data.vendorCompanyId = supplier.companyId;
    } else data.supplierId = null;
  }
  return data;
};

const commitmentData = (payload = {}, { project, existing = null } = {}) => {
  const data = {};
  if (payload.title !== undefined || !existing) {
    const title = trimOrNull(payload.title);
    if (!title) throw new HttpError(400, "COMMITMENT_TITLE_REQUIRED", "Give the commitment a title");
    data.title = title.slice(0, 200);
  }
  if (payload.description !== undefined) data.description = trimOrNull(payload.description)?.slice(0, 4000) || null;
  if (payload.retentionRate !== undefined || !existing) {
    const rate = payload.retentionRate === undefined || payload.retentionRate === null || payload.retentionRate === "" ? Number(project?.defaultRetentionRate ?? 5) : Number(payload.retentionRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new HttpError(400, "COMMITMENT_RETENTION_INVALID", "Retention must be between 0 and 100 percent");
    data.retentionRate = Math.round(rate * 100) / 100;
  }
  if (payload.paymentTerms !== undefined) data.paymentTerms = trimOrNull(payload.paymentTerms)?.slice(0, 500) || null;
  if (payload.currency !== undefined || !existing) data.currency = (trimOrNull(payload.currency) || project?.currency || "USD").toUpperCase().slice(0, 3);
  const startDate = optionalDate(payload.startDate, "startDate");
  if (startDate !== undefined) data.startDate = startDate;
  const endDate = optionalDate(payload.endDate, "endDate");
  if (endDate !== undefined) data.endDate = endDate;
  if (payload.notes !== undefined) data.notes = trimOrNull(payload.notes)?.slice(0, 4000) || null;
  const insurance = normalizeInsurance(payload.insurance);
  if (insurance !== undefined) data.insuranceJson = insurance;
  return data;
};

const nextNumber = async (tx, projectId, type) => {
  return nextCounterNumber(tx, { table: "Commitment", scope: { projectId, type } });
};

const refFor = (type, number) => `${REF_PREFIX[type] || "CM"}-${String(number).padStart(3, "0")}`;

const audit = ({ tx, orgId, projectId, entityType = auditService.ENTITY_TYPES.COMMITMENT, entityId, action, actor, summary, reason = null, oldStatus = null, newStatus = null }) =>
  auditService.recordEvent({ tx, orgId, projectId, entityType, entityId, action, actorId: actor?.id || null, actorRole: actor?.role || null, reason, oldStatus, newStatus, summary, metadata: { source: "commercial.commitment" } });

// ─── Committed cost posting ───────────────────────────────────────────────

const costTypeForCommitment = (type) => (type === "purchase_order" ? "material" : "subcontract");

/**
 * Recomputes committed cost from every executed / closed commitment: SOV
 * lines and approved change-order lines land on their budget line (explicit,
 * else the cost code's line for the commitment's cost type) and on their
 * activity's cost record.
 */
/**
 * The activities of a project that an executed (or closed) commitment names on
 * a line, or an approved change order of one names in its lines — the
 * activities whose cost-record committed is the commitments' projection
 * (`recomputeCommitted` writes it) and not a figure to be typed
 * (Phase 21D, CX21-493).
 */
const activitiesWithExecutedCommitments = async ({ tx = prisma, projectId }) => {
  const named = new Set();
  if (!tx.commitmentSovLine?.findMany) return named;
  const lines = await tx.commitmentSovLine.findMany({
    where: { activityId: { not: null }, commitment: { projectId, status: { in: POSTING_STATUSES } } },
    select: { activityId: true },
  });
  for (const line of lines) if (line.activityId) named.add(line.activityId);
  if (tx.commitmentChangeOrder?.findMany) {
    const orders = await tx.commitmentChangeOrder.findMany({
      where: { status: CO_STATUS.APPROVED, commitment: { projectId, status: { in: POSTING_STATUSES } } },
      select: { linesJson: true },
    });
    for (const order of orders) {
      const lines = Array.isArray(order.linesJson) ? order.linesJson : [];
      for (const line of lines) if (line?.activityId && Number(line?.amount)) named.add(line.activityId);
    }
  }
  return named;
};

const hasExecutedCommitmentOn = async ({ tx = prisma, projectId, activityId }) => {
  if (!activityId || !tx.commitmentSovLine?.findFirst) return false;
  const line = await tx.commitmentSovLine.findFirst({
    where: { activityId, commitment: { projectId, status: { in: POSTING_STATUSES } } },
    select: { id: true },
  });
  if (line) return true;
  return (await activitiesWithExecutedCommitments({ tx, projectId })).has(activityId);
};

const recomputeCommitted = async ({ tx = prisma, orgId, projectId }) => {
  if (!tx.commitment?.findMany || !tx.budgetLine?.findMany) return null;
  // Held for the transaction before the commitments are read: two approvals
  // recomputing at once each wrote a total that left the other out, and the
  // later write won (Phase 21D, CX21-465). The second now waits for the
  // first to commit, and reads its approval.
  if (tx.$executeRaw) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`committed:${projectId}`}))`;
  const commitments = await tx.commitment.findMany({
    where: { projectId, status: { in: POSTING_STATUSES } },
    select: { id: true, type: true, lines: { select: { amount: true, budgetLineId: true, costCodeId: true, activityId: true } }, changeOrders: { where: { status: CO_STATUS.APPROVED }, select: { value: true, linesJson: true } } },
  });
  const budgetLines = await tx.budgetLine.findMany({ where: { projectId }, select: { id: true, costCodeId: true, costType: true, status: true } });
  const lineByKey = new Map(budgetLines.filter((line) => line.status === "active").map((line) => [`${line.costCodeId}:${line.costType}`, line.id]));
  const byLine = new Map();
  const byActivity = new Map();
  const post = (target, key, amount) => target.set(key, addMoney(target.get(key) || 0, amount));
  for (const commitment of commitments) {
    const costType = costTypeForCommitment(commitment.type);
    const entries = [
      ...commitment.lines.map((line) => ({ amount: line.amount, budgetLineId: line.budgetLineId, costCodeId: line.costCodeId, activityId: line.activityId })),
      ...commitment.changeOrders.flatMap((co) => {
        const lines = Array.isArray(co.linesJson) ? co.linesJson.filter((line) => Number(line?.amount)) : [];
        return lines.length ? lines.map((line) => ({ amount: line.amount, budgetLineId: line.budgetLineId, costCodeId: line.costCodeId, activityId: line.activityId })) : [{ amount: co.value, budgetLineId: null, costCodeId: null, activityId: null }];
      }),
    ];
    for (const entry of entries) {
      const amount = toMoneyNumber(entry.amount);
      if (!amount) continue;
      const lineId = entry.budgetLineId || (entry.costCodeId ? lineByKey.get(`${entry.costCodeId}:${costType}`) : null);
      if (lineId) post(byLine, lineId, amount);
      if (entry.activityId) post(byActivity, entry.activityId, amount);
    }
  }
  for (const line of budgetLines) {
    const value = round2(byLine.get(line.id) || 0);
    await tx.budgetLine.update({ where: { id: line.id }, data: { committedFromCommitments: value } });
  }
  if (tx.costRecord?.findMany) {
    const records = await tx.costRecord.findMany({ where: { projectId }, select: { id: true, activityId: true } });
    const recordByActivity = new Map(records.map((row) => [row.activityId, row.id]));
    for (const [activityId, amount] of byActivity.entries()) {
      const recordId = recordByActivity.get(activityId);
      if (recordId) {
        // The pair is held before an existing row is written too: a cost-record
        // edit decides on the row under that lock, and a recompute that wrote
        // between its read and its write was written over (Phase 21D, CX21-511).
        if (tx.$executeRaw) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cost-record:${projectId}:${activityId}`}))`;
        await tx.costRecord.update({ where: { id: recordId }, data: { committed: round2(amount) } });
      } else if (tx.costRecord?.create) {
        // The pair is held before the row is created, and looked for again
        // under the lock (Phase 21D, CX21-464).
        if (tx.$executeRaw) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cost-record:${projectId}:${activityId}`}))`;
        const again = tx.costRecord.findFirst ? await tx.costRecord.findFirst({ where: { projectId, activityId }, select: { id: true } }) : null;
        if (again) await tx.costRecord.update({ where: { id: again.id }, data: { committed: round2(amount) } });
        else await tx.costRecord.create({ data: { projectId, activityId, committed: round2(amount) } });
      }
    }
    for (const row of records) {
      if (!byActivity.has(row.activityId)) {
        // Activities that no longer carry an executed commitment keep the manual figure; nothing to do.
      }
    }
  }
  return { budgetLines: byLine.size, activities: byActivity.size };
};

// ─── CRUD ─────────────────────────────────────────────────────────────────

const createCommitment = async ({ orgId, projectId, payload = {}, actor = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const type = normalizeType(payload.type);
  const data = commitmentData(payload, { project });
  const lines = payload.lines === undefined ? [] : normalizeLines(payload.lines);
  const created = await prisma.$transaction(async (tx) => {
    const vendor = await resolveVendor({ tx, orgId, projectId, payload });
    await validateLineReferences({ tx, orgId, projectId, lines });
    const number = await nextNumber(tx, projectId, type);
    const row = await tx.commitment.create({
      data: { orgId, projectId, number, ref: refFor(type, number), type, ...data, ...vendor, status: STATUS.DRAFT, createdBy: actor?.id || null, updatedBy: actor?.id || null, lines: { create: lines.map((line) => ({ ...line, orgId, projectId })) } },
      include,
    });
    await audit({ tx, orgId, projectId, entityId: row.id, action: auditService.ACTIONS.CREATED, actor, newStatus: STATUS.DRAFT, summary: { ref: row.ref, type, title: row.title, vendor: row.vendorCompany?.name || null, lines: lines.length, original: totalsFor(row).original } });
    return row;
  });
  return serialize(created, { projectId });
};

const updateCommitment = async ({ orgId, projectId, commitmentId, payload = {}, actor = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const existing = await loadCommitment({ projectId, commitmentId });
  if (existing.status === STATUS.VOID) throw new HttpError(409, "COMMITMENT_VOID", "A void commitment cannot be changed");
  const data = commitmentData(payload, { project, existing });
  const updated = await prisma.$transaction(async (tx) => {
    const [fresh] = await tx.$queryRaw`SELECT status FROM "Commitment" WHERE id = ${commitmentId} FOR UPDATE`;
    if (fresh && fresh.status !== existing.status) throw new HttpError(409, "COMMITMENT_STATE_CHANGED", `The commitment is ${fresh.status} now; look again before editing it`);
    const vendor = EDITABLE_STATUSES.includes(existing.status) ? await resolveVendor({ tx, orgId, projectId, payload }) : {};
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      // After approval only paperwork changes: dates, terms, notes, insurance.
      for (const key of ["title", "retentionRate", "currency"]) if (key in data && data[key] !== existing[key]) throw new HttpError(409, "COMMITMENT_LOCKED", `${key} cannot change once the commitment is ${existing.status}`);
    }
    const row = await tx.commitment.update({ where: { id: commitmentId }, data: { ...data, ...vendor, updatedBy: actor?.id || null }, include });
    await audit({ tx, orgId, projectId, entityId: commitmentId, action: auditService.ACTIONS.UPDATED, actor, summary: { ref: row.ref, changed: Object.keys({ ...data, ...vendor }) } });
    return row;
  });
  return serialize(updated, { projectId });
};

const replaceLines = async ({ orgId, projectId, commitmentId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const existing = await loadCommitment({ projectId, commitmentId });
  if (!EDITABLE_STATUSES.includes(existing.status)) throw new HttpError(409, "COMMITMENT_LOCKED", "The schedule of values is fixed once the commitment is approved; raise a change order instead");
  const lines = normalizeLines(payload.lines);
  const updated = await prisma.$transaction(async (tx) => {
    // The schedule of values is fixed once the commitment is approved; the
    // check ran before the lock, so it is asked again under it (Phase 21D,
    // CX21-427).
    const [fresh] = await tx.$queryRaw`SELECT status FROM "Commitment" WHERE id = ${commitmentId} FOR UPDATE`;
    if (fresh && !EDITABLE_STATUSES.includes(fresh.status)) throw new HttpError(409, "COMMITMENT_LOCKED", "The schedule of values is fixed once the commitment is approved; raise a change order instead");
    await validateLineReferences({ tx, orgId, projectId, lines });
    await tx.commitmentSovLine.deleteMany({ where: { commitmentId } });
    for (const line of lines) await tx.commitmentSovLine.create({ data: { ...line, orgId, projectId, commitmentId } });
    const row = await tx.commitment.update({ where: { id: commitmentId }, data: { updatedBy: actor?.id || null }, include });
    await audit({ tx, orgId, projectId, entityId: commitmentId, action: auditService.ACTIONS.UPDATED, actor, summary: { ref: row.ref, lines: lines.length, original: totalsFor(row).original } });
    return row;
  });
  return serialize(updated, { projectId });
};

const setInsurance = async ({ orgId, projectId, commitmentId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const existing = await loadCommitment({ projectId, commitmentId });
  const insurance = normalizeInsurance(payload.insurance) || [];
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.commitment.update({ where: { id: commitmentId }, data: { insuranceJson: insurance, updatedBy: actor?.id || null }, include });
    await audit({ tx, orgId, projectId, entityId: commitmentId, action: auditService.ACTIONS.UPDATED, actor, summary: { ref: existing.ref, insurance: insurance.map((entry) => `${entry.type}:${insuranceStatus(entry)}`) } });
    return row;
  });
  return serialize(updated, { projectId });
};

// ─── Notifications ────────────────────────────────────────────────────────

const vendorMemberIds = async ({ projectId, projectPartyId }) => {
  if (!projectPartyId || !prisma.projectPartyMember?.findMany) return [];
  const members = await prisma.projectPartyMember.findMany({ where: { projectPartyId, status: "active" }, select: { userId: true } });
  void projectId;
  return members.map((row) => row.userId);
};

const notify = async ({ orgId, projectId, commitment, recipientUserIds = [], recipientRoles = [], category, event, title, message, actorId = null, priority = "normal" }) =>
  notificationService.createNotifications({
    orgId,
    projectId,
    actorId,
    recipientUserIds: uniqueIds(recipientUserIds).filter((id) => id !== actorId),
    recipientRoles,
    type: "commitment",
    category,
    event,
    title,
    message,
    priority,
    actionUrl: recordWorkspacePath({ projectId, recordType: "commitment", recordId: commitment.id }),
    entityType: "commitment",
    entityId: commitment.id,
    dedupeKeyBase: `commitment:${commitment.id}:${event}:${Date.now()}`,
    metadata: { ref: commitment.ref, status: commitment.status, type: commitment.type },
  });

// ─── Transitions ──────────────────────────────────────────────────────────

const transition = async ({ orgId, projectId, commitmentId, to, actor = null, reason = null, guard = null, extra = {}, viaWorkflow = false }) => {
  await ensureProject({ orgId, projectId });
  const existing = await loadCommitment({ projectId, commitmentId });
  if (!viaWorkflow && [STATUS.APPROVED, STATUS.DRAFT].includes(to)) {
    await require("./workflow-engine.service").assertNotLocked({ tool: "commitment", projectId, recordId: commitmentId });
  }
  const allowedFrom = {
    [STATUS.PENDING]: [STATUS.DRAFT],
    [STATUS.APPROVED]: [STATUS.PENDING],
    [STATUS.DRAFT]: [STATUS.PENDING, STATUS.APPROVED],
    [STATUS.EXECUTED]: [STATUS.APPROVED],
    [STATUS.CLOSED]: [STATUS.EXECUTED],
    [STATUS.VOID]: [STATUS.DRAFT, STATUS.PENDING, STATUS.APPROVED],
  }[to];
  if (!allowedFrom?.includes(existing.status)) throw new HttpError(409, "COMMITMENT_TRANSITION_INVALID", `A ${existing.status} commitment cannot become ${to}`);
  if (guard) await guard(existing);
  const now = new Date();
  const stamps = {
    [STATUS.PENDING]: { submittedAt: now, submittedBy: actor?.id || null },
    [STATUS.APPROVED]: { approvedAt: now, approvedBy: actor?.id || null },
    [STATUS.DRAFT]: { submittedAt: null, approvedAt: null, approvedBy: null },
    [STATUS.EXECUTED]: { executedAt: now, executedBy: actor?.id || null },
    [STATUS.CLOSED]: { closedAt: now, closedBy: actor?.id || null },
    [STATUS.VOID]: { voidReason: reason },
  }[to];
  const updated = await prisma.$transaction(async (tx) => {
    // The transition was decided on a status read before the lock; a return
    // that started on an approved commitment must not land on it once
    // executed — it would become a draft with its committed cost still posted
    // and its schedule of values open again (Phase 21D, CX21-433).
    const [fresh] = await tx.$queryRaw`SELECT status FROM "Commitment" WHERE id = ${commitmentId} FOR UPDATE`;
    if (fresh && fresh.status !== existing.status) throw new HttpError(409, "COMMITMENT_STATE_CHANGED", `The commitment is ${fresh.status} now; it cannot become ${to} from there without looking again`);
    const row = await tx.commitment.update({ where: { id: commitmentId }, data: { status: to, ...stamps, ...extra, updatedBy: actor?.id || null }, include });
    await audit({ tx, orgId, projectId, entityId: commitmentId, action: to === STATUS.APPROVED ? auditService.ACTIONS.APPROVED : auditService.ACTIONS.STATUS_CHANGED, actor, reason, oldStatus: existing.status, newStatus: to, summary: { ref: row.ref, type: row.type, revised: totalsFor(row).revised } });
    if (POSTING_STATUSES.includes(to) || POSTING_STATUSES.includes(existing.status)) await recomputeCommitted({ tx, orgId, projectId });
    return row;
  });
  const serialized = serialize(updated, { projectId });
  if (to === STATUS.PENDING && !viaWorkflow) {
    require("./workflow-engine.service").maybeStart({ orgId, projectId, tool: "commitment", recordId: commitmentId, actor }).catch(() => null);
  }
  const vendorIds = await vendorMemberIds({ projectId, projectPartyId: updated.projectPartyId });
  if (to === STATUS.PENDING) {
    await notify({ orgId, projectId, commitment: updated, actorId: actor?.id || null, recipientRoles: ["pm"], category: notificationService.NOTIFICATION_CATEGORIES.APPROVAL, event: "commitment.submitted", title: `${updated.ref} awaits approval: ${updated.title}`, message: `${serialized.vendor?.name || "Vendor"} · ${money(serialized.original, updated.currency)}` });
  } else if (to === STATUS.EXECUTED) {
    await notify({ orgId, projectId, commitment: updated, actorId: actor?.id || null, recipientUserIds: [updated.createdBy, ...vendorIds], recipientRoles: ["qs", "cost_controller", "finance"], category: notificationService.NOTIFICATION_CATEGORIES.COMMERCIAL, event: "commitment.executed", title: `${updated.ref} executed: ${updated.title}`, message: `Committed ${money(serialized.revised, updated.currency)} · retention ${serialized.retentionRate}%` });
  } else if (to === STATUS.DRAFT) {
    await notify({ orgId, projectId, commitment: updated, actorId: actor?.id || null, recipientUserIds: [updated.createdBy, updated.submittedBy], category: notificationService.NOTIFICATION_CATEGORIES.APPROVAL, event: "commitment.returned", title: `${updated.ref} returned: ${updated.title}`, message: reason || "Returned for changes", priority: "high" });
  }
  return serialized;
};

const submitCommitment = ({ orgId, projectId, commitmentId, actor }) =>
  transition({
    orgId,
    projectId,
    commitmentId,
    to: STATUS.PENDING,
    actor,
    guard: async (existing) => {
      if (!existing.lines.length) throw new HttpError(409, "COMMITMENT_LINES_REQUIRED", "Add at least one schedule-of-values line before submitting");
      if (!existing.vendorCompanyId) throw new HttpError(409, "COMMITMENT_VENDOR_REQUIRED", "Pick the vendor before submitting");
    },
  });

const approveCommitment = ({ orgId, projectId, commitmentId, actor, viaWorkflow = false }) => transition({ orgId, projectId, commitmentId, to: STATUS.APPROVED, actor, viaWorkflow });

const returnCommitment = ({ orgId, projectId, commitmentId, actor, reason, viaWorkflow = false }) => {
  if (!trimOrNull(reason)) throw new HttpError(400, "COMMITMENT_RETURN_REASON_REQUIRED", "Say what needs to change");
  return transition({ orgId, projectId, commitmentId, to: STATUS.DRAFT, actor, reason: trimOrNull(reason), viaWorkflow });
};

/**
 * Closing a subcontract runs the closeout gate (OCTA-SUB-CLOSE-056): punch
 * list, insurance, the account and retention, plus the handover documents.
 * A purchase-order commitment buys a thing rather than a package of work, so
 * it has no handover to check.
 */
const closeCommitment = ({ orgId, projectId, commitmentId, actor, closeoutOverrideReason = null }) =>
  transition({
    orgId,
    projectId,
    commitmentId,
    to: STATUS.CLOSED,
    actor,
    reason: trimOrNull(closeoutOverrideReason),
    guard: async (existing) => {
      if (existing.type !== "subcontract") return;
      await require("./closeout.service").assertReady({
        orgId,
        projectId,
        commitmentId,
        override: closeoutOverrideReason,
      });
    },
  });

const voidCommitment = ({ orgId, projectId, commitmentId, actor, reason }) => {
  if (!trimOrNull(reason)) throw new HttpError(400, "COMMITMENT_VOID_REASON_REQUIRED", "Give a reason");
  return transition({ orgId, projectId, commitmentId, to: STATUS.VOID, actor, reason: trimOrNull(reason) });
};

/**
 * Executes an approved commitment: the executed document (uploaded file or
 * an existing project document) is required and every required insurance
 * item must be present and unexpired unless a PM overrides with a reason.
 */
const executeCommitment = async ({ orgId, projectId, commitmentId, actor = null, file = null, documentId = null, override = false, overrideReason = null, canOverride = false }) => {
  await ensureProject({ orgId, projectId });
  const existing = await loadCommitment({ projectId, commitmentId });
  if (existing.status !== STATUS.APPROVED) throw new HttpError(409, "COMMITMENT_TRANSITION_INVALID", "Only approved commitments can be executed");
  let executedDocumentId = trimOrNull(documentId);
  if (file) {
    const document = await fileStorageService.uploadProjectDocument({ orgId, projectId, userId: actor?.id || null, file, documentType: fileStorageService.DOCUMENT_TYPES.WORKFLOW_ATTACHMENT, linkedEntityType: "commitment", linkedEntityId: commitmentId });
    executedDocumentId = document.id;
  } else if (executedDocumentId) {
    const document = await prisma.projectDocument.findFirst({ where: { id: executedDocumentId, projectId }, select: { id: true } });
    if (!document) throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Executed document not found");
  }
  if (!executedDocumentId && !existing.executedDocumentId) throw new HttpError(400, "COMMITMENT_DOCUMENT_REQUIRED", "Attach the executed agreement");
  const problems = serializeInsurance(existing.insuranceJson).filter((entry) => entry.status === "missing" || entry.status === "expired");
  if (problems.length && !(override && canOverride)) {
    const error = new HttpError(409, "COMMITMENT_INSURANCE_MISSING", `Insurance is ${problems.map((entry) => `${entry.label || entry.type} ${entry.status}`).join(", ")}`);
    error.details = { insurance: problems };
    throw error;
  }
  if (problems.length && !trimOrNull(overrideReason)) throw new HttpError(400, "COMMITMENT_OVERRIDE_REASON_REQUIRED", "Give a reason for executing without the insurance");
  return transition({ orgId, projectId, commitmentId, to: STATUS.EXECUTED, actor, reason: problems.length ? `Insurance override: ${trimOrNull(overrideReason)}` : null, extra: executedDocumentId ? { executedDocumentId } : {} });
};

// ─── Change orders ────────────────────────────────────────────────────────

/**
 * `sovLineIds` is the set of schedule-of-values lines the change order's own
 * commitment has. A line may name one, and only one of those: naming the line
 * it modifies is what lets the pay application raise that line's billing
 * ceiling (`approvedChangesBySovLine`). Carrying the id through was missing,
 * so an approved change order raised the commitment's revised value while the
 * schedule of values stayed at its original — authorised work that could never
 * be billed.
 */
const normalizeCoLines = (entries, { sovLineIds = null } = {}) => {
  if (entries === undefined || entries === null) return [];
  if (!Array.isArray(entries)) throw new HttpError(400, "COMMITMENT_CO_LINES_INVALID", "lines must be a list");
  return entries.slice(0, MAX_LINES).map((entry, index) => {
    const amount = Number(entry?.amount);
    if (!Number.isFinite(amount)) throw new HttpError(400, "COMMITMENT_CO_LINE_AMOUNT_INVALID", `Line ${index + 1}: amount must be a number`);
    const sovLineId = trimOrNull(entry?.sovLineId) || null;
    // A change order may only move a line of the contract it is a change to.
    if (sovLineId && sovLineIds && !sovLineIds.has(sovLineId)) {
      throw new HttpError(400, "COMMITMENT_CO_LINE_SOV_INVALID", `Line ${index + 1}: that schedule-of-values line is not on this commitment`);
    }
    return { description: trimOrNull(entry?.description)?.slice(0, 500) || `Line ${index + 1}`, sovLineId, costCodeId: trimOrNull(entry?.costCodeId) || null, budgetLineId: trimOrNull(entry?.budgetLineId) || null, activityId: trimOrNull(entry?.activityId) || null, amount: round2(amount) };
  });
};

const coData = (payload = {}, { existing = null, sovLineIds = null } = {}) => {
  const data = {};
  if (payload.title !== undefined || !existing) {
    const title = trimOrNull(payload.title);
    if (!title) throw new HttpError(400, "COMMITMENT_CO_TITLE_REQUIRED", "Give the change order a title");
    data.title = title.slice(0, 200);
  }
  if (payload.description !== undefined) data.description = trimOrNull(payload.description)?.slice(0, 4000) || null;
  if (payload.lines !== undefined) {
    const lines = normalizeCoLines(payload.lines, { sovLineIds });
    data.linesJson = lines;
    if (lines.length) data.value = lines.reduce((acc, line) => addMoney(acc, line.amount), 0);
  }
  if (payload.value !== undefined && (!data.linesJson || !data.linesJson.length)) {
    const value = Number(payload.value);
    if (!Number.isFinite(value)) throw new HttpError(400, "COMMITMENT_CO_VALUE_INVALID", "value must be a number");
    data.value = round2(value);
  }
  if (payload.primeChangeOrderId !== undefined) data.primeChangeOrderId = trimOrNull(payload.primeChangeOrderId) || null;
  return data;
};

const loadChangeOrder = async ({ projectId, changeOrderId }, tx = prisma) => {
  const row = await tx.commitmentChangeOrder.findFirst({ where: { id: changeOrderId, projectId }, include: { primeChangeOrder: { select: { id: true, ref: true, status: true } }, commitment: { select: { id: true, ref: true, status: true, projectPartyId: true, vendorCompanyId: true, createdBy: true, title: true, type: true } } } });
  if (!row) throw new HttpError(404, "COMMITMENT_CO_NOT_FOUND", "Commitment change order not found");
  return row;
};

const createChangeOrder = async ({ orgId, projectId, commitmentId, payload = {}, actor = null, tx: outerTx = null }) => {
  await ensureProject({ orgId, projectId });
  const commitment = await loadCommitment({ projectId, commitmentId });
  if ([STATUS.VOID, STATUS.CLOSED].includes(commitment.status)) throw new HttpError(409, "COMMITMENT_LOCKED", `A ${commitment.status} commitment cannot take change orders`);
  const data = coData(payload, { sovLineIds: new Set((commitment.lines || []).map((line) => line.id)) });
  const run = async (tx) => {
    if (data.primeChangeOrderId) {
      const prime = await tx.changeOrder.findFirst({ where: { id: data.primeChangeOrderId, projectId }, select: { id: true } });
      if (!prime) throw new HttpError(404, "CHANGE_ORDER_NOT_FOUND", "Prime change order not found");
    }
    const number = await nextCounterNumber(tx, { table: "CommitmentChangeOrder", scope: { commitmentId } });
    const row = await tx.commitmentChangeOrder.create({
      data: { orgId, projectId, commitmentId, number, ref: `${commitment.ref}-CO${String(number).padStart(2, "0")}`, status: CO_STATUS.DRAFT, value: 0, linesJson: [], ...data, createdBy: actor?.id || null, updatedBy: actor?.id || null },
      include: { primeChangeOrder: { select: { id: true, ref: true, status: true } } },
    });
    await audit({ tx, orgId, projectId, entityType: auditService.ENTITY_TYPES.COMMITMENT_CHANGE_ORDER, entityId: row.id, action: auditService.ACTIONS.CREATED, actor, newStatus: CO_STATUS.DRAFT, summary: { ref: row.ref, commitment: commitment.ref, value: toMoneyNumber(row.value), prime: data.primeChangeOrderId || null } });
    return row;
  };
  const created = outerTx ? await run(outerTx) : await prisma.$transaction(run);
  return serializeChangeOrder(created);
};

const updateChangeOrder = async ({ orgId, projectId, changeOrderId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const existing = await loadChangeOrder({ projectId, changeOrderId });
  if (![CO_STATUS.DRAFT, CO_STATUS.PENDING].includes(existing.status)) throw new HttpError(409, "COMMITMENT_CO_LOCKED", `A ${existing.status} change order cannot be edited`);
  const sovLines = await prisma.commitmentSovLine.findMany({ where: { commitmentId: existing.commitmentId }, select: { id: true } });
  const data = coData(payload, { existing, sovLineIds: new Set(sovLines.map((line) => line.id)) });
  if (data.primeChangeOrderId && data.primeChangeOrderId !== existing.primeChangeOrderId) {
    // The link is the project's, on an edit as on a creation (Phase 21D, CX21-466).
    const prime = await prisma.changeOrder.findFirst({ where: { id: data.primeChangeOrderId, projectId }, select: { id: true } });
    if (!prime) throw new HttpError(404, "CHANGE_ORDER_NOT_FOUND", "Prime change order not found");
  }
  const updated = await prisma.$transaction(async (tx) => {
    // Editability was checked before the lock; an edit that started on a
    // pending change order must not land after its approval posted the old
    // value (Phase 21D, CX21-454).
    const [fresh] = await tx.$queryRaw`SELECT status FROM "CommitmentChangeOrder" WHERE id = ${changeOrderId} FOR UPDATE`;
    if (fresh && ![CO_STATUS.DRAFT, CO_STATUS.PENDING].includes(fresh.status)) throw new HttpError(409, "COMMITMENT_CO_LOCKED", `A ${fresh.status} change order cannot be edited`);
    const row = await tx.commitmentChangeOrder.update({ where: { id: changeOrderId }, data: { ...data, updatedBy: actor?.id || null }, include: { primeChangeOrder: { select: { id: true, ref: true, status: true } } } });
    await audit({ tx, orgId, projectId, entityType: auditService.ENTITY_TYPES.COMMITMENT_CHANGE_ORDER, entityId: changeOrderId, action: auditService.ACTIONS.UPDATED, actor, summary: { ref: row.ref, changed: Object.keys(data) } });
    return row;
  });
  return serializeChangeOrder(updated);
};

const transitionChangeOrder = async ({ orgId, projectId, changeOrderId, to, actor = null, reason = null }) => {
  await ensureProject({ orgId, projectId });
  const existing = await loadChangeOrder({ projectId, changeOrderId });
  const allowedFrom = { [CO_STATUS.PENDING]: [CO_STATUS.DRAFT], [CO_STATUS.APPROVED]: [CO_STATUS.PENDING], [CO_STATUS.REJECTED]: [CO_STATUS.PENDING], [CO_STATUS.VOID]: [CO_STATUS.DRAFT, CO_STATUS.PENDING] }[to];
  if (!allowedFrom?.includes(existing.status)) throw new HttpError(409, "COMMITMENT_CO_TRANSITION_INVALID", `A ${existing.status} change order cannot become ${to}`);
  if ([CO_STATUS.REJECTED, CO_STATUS.VOID].includes(to) && !trimOrNull(reason)) throw new HttpError(400, "COMMITMENT_CO_REASON_REQUIRED", "Give a reason");
  const now = new Date();
  const stamps = { [CO_STATUS.PENDING]: { submittedAt: now, submittedBy: actor?.id || null }, [CO_STATUS.APPROVED]: { approvedAt: now, approvedBy: actor?.id || null }, [CO_STATUS.REJECTED]: { rejectedAt: now, rejectedBy: actor?.id || null, rejectedReason: trimOrNull(reason) }, [CO_STATUS.VOID]: { rejectedReason: trimOrNull(reason) } }[to];
  const updated = await prisma.$transaction(async (tx) => {
    const [fresh] = await tx.$queryRaw`SELECT status FROM "CommitmentChangeOrder" WHERE id = ${changeOrderId} FOR UPDATE`;
    if (fresh && fresh.status !== existing.status) throw new HttpError(409, "COMMITMENT_CO_STATE_CHANGED", `The change order is ${fresh.status} now; it cannot become ${to} from there without looking again`);
    const row = await tx.commitmentChangeOrder.update({ where: { id: changeOrderId }, data: { status: to, ...stamps, updatedBy: actor?.id || null }, include: { primeChangeOrder: { select: { id: true, ref: true, status: true } } } });
    await audit({ tx, orgId, projectId, entityType: auditService.ENTITY_TYPES.COMMITMENT_CHANGE_ORDER, entityId: changeOrderId, action: to === CO_STATUS.APPROVED ? auditService.ACTIONS.APPROVED : to === CO_STATUS.REJECTED ? auditService.ACTIONS.REJECTED : auditService.ACTIONS.STATUS_CHANGED, actor, reason: trimOrNull(reason), oldStatus: existing.status, newStatus: to, summary: { ref: row.ref, commitment: existing.commitment.ref, value: toMoneyNumber(row.value) } });
    if (to === CO_STATUS.APPROVED && POSTING_STATUSES.includes(existing.commitment.status)) await recomputeCommitted({ tx, orgId, projectId });
    return row;
  });
  if (to === CO_STATUS.PENDING) {
    await notify({ orgId, projectId, commitment: existing.commitment, actorId: actor?.id || null, recipientRoles: ["pm"], category: notificationService.NOTIFICATION_CATEGORIES.APPROVAL, event: "commitment_co.submitted", title: `${updated.ref} awaits approval`, message: `${existing.commitment.title} · ${money(updated.value)}` });
  } else if (to === CO_STATUS.APPROVED || to === CO_STATUS.REJECTED) {
    const vendorIds = await vendorMemberIds({ projectId, projectPartyId: existing.commitment.projectPartyId });
    await notify({ orgId, projectId, commitment: existing.commitment, actorId: actor?.id || null, recipientUserIds: [existing.createdBy, existing.commitment.createdBy, ...vendorIds], category: notificationService.NOTIFICATION_CATEGORIES.COMMERCIAL, event: `commitment_co.${to}`, title: `${updated.ref} ${to}`, message: to === CO_STATUS.REJECTED ? trimOrNull(reason) || "Rejected" : `${existing.commitment.ref} now ${money(toMoneyNumber(updated.value))} higher`, priority: to === CO_STATUS.REJECTED ? "high" : "normal" });
  }
  return serializeChangeOrder(updated);
};

/** A prime change order spawns draft change orders on the commitments it affects. */
const spawnFromPrimeChangeOrder = async ({ orgId, projectId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const primeChangeOrderId = trimOrNull(payload.primeChangeOrderId);
  if (!primeChangeOrderId) throw new HttpError(400, "CHANGE_ORDER_REQUIRED", "primeChangeOrderId is required");
  const prime = await prisma.changeOrder.findFirst({ where: { id: primeChangeOrderId, projectId } });
  if (!prime) throw new HttpError(404, "CHANGE_ORDER_NOT_FOUND", "Prime change order not found");
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new HttpError(400, "COMMITMENT_CO_ITEMS_REQUIRED", "Pick at least one commitment");
  const created = [];
  for (const item of items) {
    const co = await createChangeOrder({
      orgId,
      projectId,
      commitmentId: trimOrNull(item.commitmentId),
      actor,
      payload: { title: trimOrNull(item.title) || `${prime.ref}: ${prime.description || "prime change"}`.slice(0, 200), description: trimOrNull(item.description) || prime.description || null, value: item.value, lines: item.lines, primeChangeOrderId },
    });
    created.push(co);
  }
  return { primeChangeOrder: { id: prime.id, ref: prime.ref, value: toMoneyNumber(prime.value) }, items: created };
};

// ─── Statement PDF ────────────────────────────────────────────────────────

const exportStatementPdf = async ({ orgId, projectId, commitmentId, viewer = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const row = await loadCommitment({ projectId, commitmentId, viewer });
  const data = serialize(row, { projectId });
  const doc = createPdf({ title: `${data.ref} ${data.title}`, author: project.name, pageSize: "A4", footer: `${project.name} · ${data.ref} · generated ${formatDate(new Date())}` });
  doc.heading(`${data.ref} · ${data.title}`);
  doc.keyValues([
    ["Type", data.type === "purchase_order" ? "Purchase order" : "Subcontract"],
    ["Status", data.status],
    ["Vendor", data.vendor?.name || "—"],
    ["Retention", `${data.retentionRate}%`],
    ["Payment terms", data.paymentTerms || "—"],
    ["Dates", `${formatDate(data.startDate)} → ${formatDate(data.endDate)}`],
    ["Original value", money(data.original, data.currency)],
    ["Approved changes", money(data.approvedChanges, data.currency)],
    ["Revised value", money(data.revised, data.currency)],
    ["Executed", data.executedAt ? formatDate(data.executedAt) : "—"],
  ]);
  doc.heading("Schedule of values", { level: 2 });
  doc.table({
    columns: [
      { key: (line) => String(line.lineNumber), label: "#", width: 24 },
      { key: "description", label: "Description", width: 1 },
      { key: (line) => line.costCode?.code || "", label: "Cost code", width: 60 },
      { key: (line) => line.activity?.code || line.activity?.name || "", label: "Activity", width: 90 },
      { key: (line) => `${line.qty} ${line.unit || ""}`.trim(), label: "Qty", width: 50 },
      { key: (line) => money(line.rate), label: "Rate", width: 60 },
      { key: (line) => money(line.amount), label: "Amount", width: 70 },
    ],
    rows: data.lines,
    size: 8.5,
    zebra: true,
  });
  if (data.changeOrders.length) {
    doc.heading("Change orders", { level: 2 });
    doc.table({
      columns: [
        { key: "ref", label: "Ref", width: 70 },
        { key: "title", label: "Title", width: 1 },
        { key: "status", label: "Status", width: 60 },
        { key: (co) => money(co.value), label: "Value", width: 70 },
      ],
      rows: data.changeOrders,
      size: 8.5,
      zebra: true,
    });
  }
  if (data.insurance.length) {
    doc.heading("Insurance", { level: 2 });
    doc.table({
      columns: [
        { key: (entry) => entry.label || entry.type, label: "Cover", width: 1 },
        { key: (entry) => (entry.required ? "required" : "optional"), label: "Required", width: 60 },
        { key: (entry) => formatDate(entry.expiresAt), label: "Expires", width: 70 },
        { key: "status", label: "Status", width: 60 },
      ],
      rows: data.insurance,
      size: 8.5,
    });
  }
  return { fileName: `${data.ref}-${data.title.replace(/[^A-Za-z0-9-]+/g, "-").slice(0, 40)}.pdf`, buffer: doc.render() };
};

module.exports = {
  TYPES,
  STATUS,
  STATUSES,
  CO_STATUS,
  CO_STATUSES,
  INSURANCE_TYPES,
  POSTING_STATUSES,
  normalizeLines,
  normalizeInsurance,
  insuranceStatus,
  totalsFor,
  serialize,
  visibilityWhere,
  costTypeForCommitment,
  recomputeCommitted,
  activitiesWithExecutedCommitments,
  hasExecutedCommitmentOn,
  listCommitments,
  getCommitment,
  createCommitment,
  updateCommitment,
  replaceLines,
  setInsurance,
  submitCommitment,
  approveCommitment,
  returnCommitment,
  executeCommitment,
  closeCommitment,
  voidCommitment,
  createChangeOrder,
  updateChangeOrder,
  transitionChangeOrder,
  spawnFromPrimeChangeOrder,
  exportStatementPdf,
};
