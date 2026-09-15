const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { recordWorkspacePath } = require("../utils/record-links");
const auditService = require("./audit.service");
const costLedger = require("./cost-ledger.service");
const notificationService = require("./notification.service");
const { nextNumber: nextCounterNumber } = require("../utils/reference-number");

/**
 * Direct costs (OCTA-FIN-DIRECT-039).
 *
 * Costs that do not run through a commitment — vendor invoices, expenses,
 * payroll — with lines by cost code / budget line / activity. Approval
 * POSTS each line's amount to the budget line's actual (the line named, or
 * the cost code's line of the cost type) and to the activity's cost record;
 * void reverses exactly what was posted. Payments are recorded against the
 * approved cost and flow into the cash flow as outflows.
 */

const STATUS = Object.freeze({ DRAFT: "draft", PENDING: "pending", APPROVED: "approved", PAID: "paid", VOID: "void" });
const TYPES = Object.freeze(["invoice", "expense", "payroll", "other"]);
const COST_TYPES = Object.freeze(["labour", "material", "equipment", "subcontract", "indirect", "overhead", "contingency", "other"]);
const DEFAULT_COST_TYPE = Object.freeze({ invoice: "material", expense: "indirect", payroll: "labour", other: "other" });
const EDITABLE = [STATUS.DRAFT, STATUS.PENDING];

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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const toDateOnly = (value, field, { required = false } = {}) => {
  if (value === null || value === undefined || value === "") {
    if (required) throw new HttpError(400, "DIRECT_COST_DATE_REQUIRED", `${field} is required`);
    return null;
  }
  const text = String(value).slice(0, 10);
  const date = DATE_RE.test(text) ? new Date(`${text}T00:00:00.000Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "DIRECT_COST_DATE_INVALID", `${field} is not a valid date`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};
const dateKey = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);

// ─── Serialisers ──────────────────────────────────────────────────────────

const lineOut = (row) => ({
  id: row.id,
  description: row.description,
  costCodeId: row.costCodeId || null,
  costCode: row.costCode ? { id: row.costCode.id, code: row.costCode.code, name: row.costCode.name } : null,
  budgetLineId: row.budgetLineId || null,
  budgetLine: row.budgetLine ? { id: row.budgetLine.id, costType: row.budgetLine.costType, description: row.budgetLine.description || null } : null,
  activityId: row.activityId || null,
  activity: row.activity ? { id: row.activity.id, name: row.activity.name, code: row.activity.activityCode || row.activity.wbsCode || null } : null,
  costType: row.costType || null,
  quantity: toNumber(row.quantity, 1),
  unit: row.unit || null,
  unitCost: money(row.unitCost) || 0,
  amount: money(row.amount) || 0,
  postedAmount: money(row.postedAmount) || 0,
  notes: row.notes || null,
  sortOrder: row.sortOrder,
});

const paymentOut = (row) => ({ id: row.id, amount: money(row.amount) || 0, paidAt: toIso(row.paidAt), method: row.method || null, reference: row.reference || null, note: row.note || null, createdBy: row.createdBy || null, createdAt: toIso(row.createdAt) });

const balanceOf = (row) => round2(toNumber(row.total) - toNumber(row.paidTotal));
const isOverdue = (row) => Boolean(row.dueDate && [STATUS.APPROVED, STATUS.PENDING].includes(row.status) && balanceOf(row) > 0 && new Date(row.dueDate).getTime() < Date.now() - 86_400_000);

const out = (row, { detail = false } = {}) => ({
  id: row.id,
  projectId: row.projectId,
  number: row.number,
  ref: row.ref,
  type: row.type,
  vendorCompanyId: row.vendorCompanyId || null,
  vendorName: row.vendorName || row.vendorCompany?.name || null,
  invoiceNumber: row.invoiceNumber || null,
  purchaseOrderId: row.purchaseOrderId || null,
  description: row.description,
  costDate: dateKey(row.costDate),
  dueDate: dateKey(row.dueDate),
  receivedDate: dateKey(row.receivedDate),
  status: row.status,
  subtotal: money(row.subtotal) || 0,
  tax: money(row.tax) || 0,
  total: money(row.total) || 0,
  paidTotal: money(row.paidTotal) || 0,
  balance: balanceOf(row),
  overdue: isOverdue(row),
  paymentTerms: row.paymentTerms || null,
  notes: row.notes || null,
  submittedBy: row.submittedBy || null,
  submittedAt: toIso(row.submittedAt),
  approvedBy: row.approvedBy || null,
  approvedAt: toIso(row.approvedAt),
  rejectedReason: row.rejectedReason || null,
  postedAt: toIso(row.postedAt),
  voidReason: row.voidReason || null,
  voidedAt: toIso(row.voidedAt),
  lineCount: row._count?.lines ?? (row.lines ? row.lines.length : undefined),
  paymentCount: row._count?.payments ?? (row.payments ? row.payments.length : undefined),
  lines: detail ? (row.lines || []).map(lineOut) : undefined,
  payments: detail ? (row.payments || []).map(paymentOut) : undefined,
  path: recordWorkspacePath({ projectId: row.projectId, recordType: "direct_cost", recordId: row.id }),
  createdBy: row.createdBy || null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const lineInclude = { costCode: { select: { id: true, code: true, name: true } }, budgetLine: { select: { id: true, costType: true, description: true } }, activity: { select: { id: true, name: true, activityCode: true, wbsCode: true } } };
const detailInclude = { vendorCompany: { select: { id: true, name: true } }, lines: { include: lineInclude, orderBy: { sortOrder: "asc" } }, payments: { orderBy: { paidAt: "desc" } } };
const listInclude = { vendorCompany: { select: { id: true, name: true } }, _count: { select: { lines: true, payments: true } } };

// ─── Normalisation ────────────────────────────────────────────────────────

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true, name: true, currency: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

const load = async ({ orgId, projectId, directCostId, tx = prisma }) => {
  const row = await tx.directCost.findFirst({ where: { id: directCostId, orgId, projectId }, include: detailInclude });
  if (!row) throw new HttpError(404, "DIRECT_COST_NOT_FOUND", "Direct cost not found");
  return row;
};

const normalizeHeader = async ({ orgId, projectId = null, payload, existing = null }) => {
  const pick = (key, fallback = null) => (payload[key] !== undefined ? payload[key] : existing ? existing[key] : fallback);
  const type = pick("type", "invoice");
  if (!TYPES.includes(type)) throw new HttpError(400, "DIRECT_COST_TYPE_INVALID", `Type must be one of ${TYPES.join(", ")}`);
  const description = trimOrNull(pick("description"));
  if (!description) throw new HttpError(400, "DIRECT_COST_DESCRIPTION_REQUIRED", "Describe the cost");
  const vendorCompanyId = trimOrNull(pick("vendorCompanyId"));
  let vendorName = trimOrNull(pick("vendorName"));
  if (vendorCompanyId) {
    const company = await prisma.company.findFirst({ where: { id: vendorCompanyId, orgId }, select: { id: true, name: true } });
    if (!company) throw new HttpError(400, "DIRECT_COST_VENDOR_INVALID", "Unknown vendor company");
    vendorName = vendorName || company.name;
  }
  const tax = round2(pick("tax", 0));
  if (tax < 0) throw new HttpError(400, "DIRECT_COST_TAX_INVALID", "Tax cannot be negative");
  // A supplier invoice against a purchase order (OCTA-COM-PO-053): the link is
  // what lets the order say how much of it has been billed, and what the
  // three-way match compares.
  const purchaseOrderId = trimOrNull(pick("purchaseOrderId"));
  if (purchaseOrderId && projectId) {
    const order = await prisma.procurementOrder.findFirst({
      where: { id: purchaseOrderId, projectId },
      select: { id: true },
    });
    if (!order) {
      throw new HttpError(400, "DIRECT_COST_PO_INVALID", "That purchase order is not on this project");
    }
  }
  return {
    type,
    purchaseOrderId,
    description: description.slice(0, 2000),
    vendorCompanyId,
    vendorName: vendorName?.slice(0, 200) || null,
    invoiceNumber: trimOrNull(pick("invoiceNumber"))?.slice(0, 80) || null,
    costDate: toDateOnly(pick("costDate"), "costDate", { required: true }),
    dueDate: toDateOnly(pick("dueDate"), "dueDate"),
    receivedDate: toDateOnly(pick("receivedDate"), "receivedDate"),
    tax,
    paymentTerms: trimOrNull(pick("paymentTerms"))?.slice(0, 120) || null,
    notes: trimOrNull(pick("notes"))?.slice(0, 4000) || null,
  };
};

const normalizeLines = async ({ projectId, rows, purchaseOrderId = null }) => {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length > 500) throw new HttpError(400, "DIRECT_COST_TOO_MANY_LINES", "A direct cost takes up to 500 lines");
  // A line that bills a purchase-order line must bill one on THIS project — and,
  // when the invoice names its order, one on THAT order. The line id used to be
  // copied unchecked, and the capitalisation rule then read the foreign line's
  // stock link to decide this project incurs no cost (Phase 21D, CX21-001).
  const poLineIds = uniqueIds(list.map((row) => row.poLineId));
  const poLines = poLineIds.length
    ? await prisma.procurementPoLine.findMany({
        where: { id: { in: poLineIds }, order: { projectId }, ...(purchaseOrderId ? { orderId: purchaseOrderId } : {}) },
        select: { id: true },
      })
    : [];
  const poLineSet = new Set(poLines.map((row) => row.id));
  const budgetLineIds = uniqueIds(list.map((row) => row.budgetLineId));
  const budgetLines = budgetLineIds.length ? await prisma.budgetLine.findMany({ where: { id: { in: budgetLineIds }, projectId }, select: { id: true, costCodeId: true, costType: true } }) : [];
  const budgetLineById = new Map(budgetLines.map((row) => [row.id, row]));
  const costCodeIds = uniqueIds([...list.map((row) => row.costCodeId), ...budgetLines.map((row) => row.costCodeId)]);
  const projectCodes = costCodeIds.length ? await prisma.projectCostCode.findMany({ where: { projectId, costCodeId: { in: costCodeIds } }, select: { costCodeId: true } }) : [];
  const codeSet = new Set(projectCodes.map((row) => row.costCodeId));
  const activityIds = uniqueIds(list.map((row) => row.activityId));
  const activities = activityIds.length ? await prisma.activity.findMany({ where: { id: { in: activityIds }, projectId }, select: { id: true } }) : [];
  const activitySet = new Set(activities.map((row) => row.id));
  return list.map((row, index) => {
    const description = trimOrNull(row.description);
    if (!description) throw new HttpError(400, "DIRECT_COST_LINE_DESCRIPTION", `Line ${index + 1}: describe the item`);
    const budgetLineId = trimOrNull(row.budgetLineId);
    const budgetLine = budgetLineId ? budgetLineById.get(budgetLineId) : null;
    if (budgetLineId && !budgetLine) throw new HttpError(400, "DIRECT_COST_LINE_BUDGET_LINE", `Line ${index + 1}: the budget line is not on this project`);
    const costCodeId = budgetLine ? budgetLine.costCodeId : trimOrNull(row.costCodeId);
    if (costCodeId && !codeSet.has(costCodeId)) throw new HttpError(400, "DIRECT_COST_LINE_COST_CODE", `Line ${index + 1}: the cost code is not on this project`);
    const activityId = trimOrNull(row.activityId);
    if (activityId && !activitySet.has(activityId)) throw new HttpError(400, "DIRECT_COST_LINE_ACTIVITY", `Line ${index + 1}: the activity is not on this project`);
    const costType = budgetLine ? budgetLine.costType : trimOrNull(row.costType);
    if (costType && !COST_TYPES.includes(costType)) throw new HttpError(400, "DIRECT_COST_LINE_COST_TYPE", `Line ${index + 1}: cost type must be one of ${COST_TYPES.join(", ")}`);
    const quantity = toNumber(row.quantity, 1);
    const unitCost = round2(row.unitCost);
    const amount = row.amount !== undefined && row.amount !== null && row.amount !== "" ? round2(row.amount) : round2(quantity * unitCost);
    if (amount < 0) throw new HttpError(400, "DIRECT_COST_LINE_AMOUNT", `Line ${index + 1}: the amount cannot be negative`);
    // Which PO line this bills. `DirectCostLine.poLineId` has always existed
    // but nothing ever wrote it, so the invoice could not be traced back to
    // the order — and the capitalisation rule (OCTA-FIN-LEDGER-059) has no
    // other way to tell stocked material from direct-to-site.
    const poLineId = trimOrNull(row.poLineId);
    if (poLineId && !poLineSet.has(poLineId)) {
      throw new HttpError(400, "DIRECT_COST_LINE_PO_LINE", `Line ${index + 1}: that purchase-order line is not on this ${purchaseOrderId ? "invoice's order" : "project"}`);
    }
    return { id: trimOrNull(row.id), description: description.slice(0, 500), costCodeId, budgetLineId, activityId, poLineId, costType, quantity, unit: trimOrNull(row.unit)?.slice(0, 20) || null, unitCost, amount, notes: trimOrNull(row.notes)?.slice(0, 1000) || null, sortOrder: index };
  });
};

/**
 * Tells a purchase order how much of it has been billed.
 *
 * Called after anything that changes what a supplier invoice claims against an
 * order — created, edited, voided, deleted, or moved to a different order.
 * The order stores the figure so that listing a hundred of them does not mean
 * a hundred aggregate queries.
 */
const syncPurchaseOrders = async (tx, orderIds) => {
  const ids = uniqueIds(orderIds);
  if (!ids.length) return;
  const { recomputeInvoiced } = require("./purchase-order.service");
  for (const orderId of ids) await recomputeInvoiced(tx, orderId);
};

const totalsOf = (lines, tax) => {
  const subtotal = round2(lines.reduce((sum, line) => sum + toNumber(line.amount), 0));
  return { subtotal, total: round2(subtotal + toNumber(tax)) };
};

// The invoice identity held is the project and the number: a vendor is named
// by its company or as text, and the two are one vendor (CX21-546), so the
// lock does not split on how it was named.
const invoiceLockKey = ({ projectId, invoiceNumber }) =>
  `direct-cost-invoice:${projectId}:${String(invoiceNumber || "").toLowerCase()}`;

const assertNoDuplicateInvoice = async ({ orgId = null, projectId, vendorCompanyId, vendorName, invoiceNumber, excludeId = null, tx = prisma }) => {
  if (!invoiceNumber) return;
  // The same vendor named by its company on one invoice and as text on the
  // other is one vendor: both spellings are looked for (CX21-546).
  const vendor = [];
  if (vendorCompanyId) {
    vendor.push({ vendorCompanyId });
    const company = tx.company?.findFirst ? await tx.company.findFirst({ where: { id: vendorCompanyId }, select: { name: true } }) : null;
    if (company?.name) vendor.push({ vendorName: { equals: company.name, mode: "insensitive" } });
  }
  if (vendorName) {
    vendor.push({ vendorName: { equals: vendorName, mode: "insensitive" } });
    const named = tx.company?.findFirst ? await tx.company.findFirst({ where: { ...(orgId ? { orgId } : {}), name: { equals: vendorName, mode: "insensitive" } }, select: { id: true } }) : null;
    if (named?.id && named.id !== vendorCompanyId) vendor.push({ vendorCompanyId: named.id });
  }
  const clash = await tx.directCost.findFirst({ where: { projectId, invoiceNumber: { equals: invoiceNumber, mode: "insensitive" }, status: { not: STATUS.VOID }, ...(excludeId ? { id: { not: excludeId } } : {}), ...(vendor.length ? { OR: vendor } : {}) }, select: { id: true, ref: true } });
  if (clash) throw new HttpError(409, "DIRECT_COST_DUPLICATE_INVOICE", `Invoice ${invoiceNumber} from this vendor is already recorded as ${clash.ref}`, { directCostId: clash.id, ref: clash.ref });
};

// ─── Register ─────────────────────────────────────────────────────────────

const summaryOf = (items) => {
  const byStatus = Object.fromEntries(Object.values(STATUS).map((status) => [status, { count: 0, total: 0 }]));
  const byType = Object.fromEntries(TYPES.map((type) => [type, { count: 0, total: 0 }]));
  let total = 0;
  let paid = 0;
  let unpaid = 0;
  let overdue = 0;
  for (const item of items) {
    byStatus[item.status].count += 1;
    byStatus[item.status].total = round2(byStatus[item.status].total + item.total);
    if (item.status !== STATUS.VOID) {
      byType[item.type].count += 1;
      byType[item.type].total = round2(byType[item.type].total + item.total);
      total = round2(total + item.total);
      paid = round2(paid + item.paidTotal);
      if ([STATUS.APPROVED, STATUS.PAID].includes(item.status)) unpaid = round2(unpaid + item.balance);
      if (item.overdue) overdue = round2(overdue + item.balance);
    }
  }
  return { count: items.length, byStatus, byType, total, paid, unpaid, overdue, pendingApproval: byStatus.pending.count };
};

const listDirectCosts = async ({ orgId, projectId, query = {} }) => {
  const where = { orgId, projectId };
  if (query.status) where.status = query.status;
  if (query.type) where.type = query.type;
  if (query.vendorCompanyId) where.vendorCompanyId = query.vendorCompanyId;
  if (query.from || query.to) where.costDate = { ...(query.from ? { gte: toDateOnly(query.from, "from") } : {}), ...(query.to ? { lte: toDateOnly(query.to, "to") } : {}) };
  const q = trimOrNull(query.q);
  if (q) where.OR = [{ ref: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }, { invoiceNumber: { contains: q, mode: "insensitive" } }, { vendorName: { contains: q, mode: "insensitive" } }];
  const rows = await prisma.directCost.findMany({ where, include: listInclude, orderBy: [{ costDate: "desc" }, { number: "desc" }], take: 2000 });
  const items = rows.map((row) => out(row));
  return { items, summary: summaryOf(items) };
};

const getDirectCost = async ({ orgId, projectId, directCostId }) => out(await load({ orgId, projectId, directCostId }), { detail: true });

const nextNumber = async (tx, projectId) =>
  nextCounterNumber(tx, { table: "DirectCost", scope: { projectId } });

const createDirectCost = async ({ orgId, projectId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const header = await normalizeHeader({ orgId, projectId, payload });
  const lines = await normalizeLines({ projectId, rows: payload.lines, purchaseOrderId: header.purchaseOrderId });
  await assertNoDuplicateInvoice({ orgId, projectId, vendorCompanyId: header.vendorCompanyId, vendorName: header.vendorName, invoiceNumber: header.invoiceNumber });
  const totals = totalsOf(lines, header.tax);
  const created = await prisma.$transaction(async (tx) => {
    // The invoice identity (project, vendor, number) is held before the
    // duplicate check is made again: two receptions of the same invoice
    // arriving together each passed the check and both were recorded,
    // approvable and payable twice (Phase 21D, CX21-534).
    if (header.invoiceNumber && tx.$executeRaw) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoiceLockKey({ projectId, vendorCompanyId: header.vendorCompanyId, vendorName: header.vendorName, invoiceNumber: header.invoiceNumber })}))`;
      await assertNoDuplicateInvoice({ orgId, projectId, vendorCompanyId: header.vendorCompanyId, vendorName: header.vendorName, invoiceNumber: header.invoiceNumber, tx });
    }
    const number = await nextNumber(tx, projectId);
    const row = await tx.directCost.create({ data: { ...header, ...totals, orgId, projectId, number, ref: `DC-${String(number).padStart(3, "0")}`, status: STATUS.DRAFT, createdBy: actor?.id || null, updatedBy: actor?.id || null } });
    if (lines.length) await tx.directCostLine.createMany({ data: lines.map(({ id, ...line }) => ({ ...line, orgId, projectId, directCostId: row.id })) });
    await syncPurchaseOrders(tx, [header.purchaseOrderId]);
    return load({ orgId, projectId, directCostId: row.id, tx });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "direct_cost", entityId: created.id, action: auditService.ACTIONS.CREATED, actorId: actor?.id || null, summary: { ref: created.ref, type: created.type, vendor: created.vendorName, total: money(created.total), lines: created.lines.length } }).catch(() => null);
  return out(created, { detail: true });
};

const updateDirectCost = async ({ orgId, projectId, directCostId, payload = {}, actor = null }) => {
  const updated = await prisma.$transaction(async (tx) => {
    // Everything an edit decides on is read under the invoice's lock: two
    // edits at once — a header-only order change and a line replacement, say
    // — are serialised, and each one's checks and totals describe the row it
    // actually writes (Phase 21D, CX21-203).
    await tx.$queryRaw`SELECT id FROM "DirectCost" WHERE id = ${directCostId} FOR UPDATE`;
    const existing = await load({ orgId, projectId, directCostId, tx });
    if (!EDITABLE.includes(existing.status)) throw new HttpError(409, "DIRECT_COST_LOCKED", `A ${existing.status} direct cost cannot be edited`);
    const header = await normalizeHeader({ orgId, projectId, payload, existing });
    const lines = payload.lines !== undefined ? await normalizeLines({ projectId, rows: payload.lines, purchaseOrderId: header.purchaseOrderId }) : existing.lines.map((line) => ({ ...line, amount: toNumber(line.amount) }));
    // Moving the invoice to another order without touching its lines would keep
    // lines that bill the old order's purchase-order lines — and a stocked line
    // among them would still suppress this project's cost (Phase 21D, CX21-104).
    if (payload.lines === undefined && (header.purchaseOrderId || null) !== (existing.purchaseOrderId || null)) {
      const keptIds = uniqueIds(existing.lines.map((line) => line.poLineId));
      if (keptIds.length) {
        const onOrder = await prisma.procurementPoLine.findMany({
          where: { id: { in: keptIds }, order: { projectId }, ...(header.purchaseOrderId ? { orderId: header.purchaseOrderId } : {}) },
          select: { id: true },
        });
        if (onOrder.length !== keptIds.length) {
          throw new HttpError(400, "DIRECT_COST_LINE_PO_LINE", "The invoice's lines bill purchase-order lines that are not on the order it now names; replace the lines together with the order");
        }
      }
    }
    if (header.invoiceNumber && tx.$executeRaw) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoiceLockKey({ projectId, vendorCompanyId: header.vendorCompanyId, vendorName: header.vendorName, invoiceNumber: header.invoiceNumber })}))`; // the invoice identity, as on creation (CX21-534)
    await assertNoDuplicateInvoice({ orgId, projectId, vendorCompanyId: header.vendorCompanyId, vendorName: header.vendorName, invoiceNumber: header.invoiceNumber, excludeId: directCostId, tx });
    const totals = totalsOf(lines, header.tax);
    await tx.directCost.update({ where: { id: directCostId }, data: { ...header, ...totals, updatedBy: actor?.id || null } });
    if (payload.lines !== undefined) {
      await tx.directCostLine.deleteMany({ where: { directCostId } });
      if (lines.length) await tx.directCostLine.createMany({ data: lines.map(({ id, costCode, budgetLine, activity, postedAmount, createdAt, updatedAt, directCostId: _d, orgId: _o, projectId: _p, ...line }) => ({ ...line, orgId, projectId, directCostId })) });
    }
    // Both orders, in case the invoice was moved from one to another.
    await syncPurchaseOrders(tx, [existing.purchaseOrderId, header.purchaseOrderId]);
    return load({ orgId, projectId, directCostId, tx });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "direct_cost", entityId: directCostId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { ref: updated.ref, total: money(updated.total), lines: updated.lines.length } }).catch(() => null);
  return out(updated, { detail: true });
};

const deleteDirectCost = async ({ orgId, projectId, directCostId, actor = null }) => {
  const existing = await load({ orgId, projectId, directCostId });
  if (existing.status !== STATUS.DRAFT) throw new HttpError(409, "DIRECT_COST_LOCKED", "Only draft direct costs can be deleted — void it instead");
  await prisma.$transaction(async (tx) => {
    // A delete that started on a draft must not remove an invoice that was
    // submitted, approved and paid meanwhile (Phase 21D, CX21-303).
    await lockExpecting(tx, directCostId, [STATUS.DRAFT], "DIRECT_COST_LOCKED", () => "Only draft direct costs can be deleted — void it instead");
    await tx.directCost.delete({ where: { id: directCostId } });
    await syncPurchaseOrders(tx, [existing.purchaseOrderId]);
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "direct_cost", entityId: directCostId, action: auditService.ACTIONS.DELETED, actorId: actor?.id || null, summary: { ref: existing.ref } }).catch(() => null);
  return { deleted: true };
};

// ─── Workflow ─────────────────────────────────────────────────────────────

const notify = ({ orgId, projectId, row, actor, event, title, message, recipientUserIds = [], recipientRoles = [] }) =>
  notificationService
    .createNotifications({ orgId, projectId, actorId: actor?.id || null, recipientUserIds: uniqueIds(recipientUserIds), recipientRoles, type: "direct_cost", category: notificationService.NOTIFICATION_CATEGORIES.COMMERCIAL, event, title, message, actionUrl: recordWorkspacePath({ projectId, recordType: "direct_cost", recordId: row.id }), entityType: "direct_cost", entityId: row.id, dedupeKeyBase: `direct_cost:${row.id}:${event}:${Date.now()}`, metadata: { ref: row.ref, status: row.status, total: money(row.total) } })
    .catch(() => null);

/**
 * Holds the invoice for the transaction and refuses if its status is no longer
 * one the caller decided on: a return that started while the invoice was
 * pending must not land on it once approved and paid (Phase 21D, CX21-204).
 */
const lockExpecting = async (tx, directCostId, statuses, code, message) => {
  await tx.$queryRaw`SELECT id FROM "DirectCost" WHERE id = ${directCostId} FOR UPDATE`;
  const fresh = await tx.directCost.findFirst({ where: { id: directCostId }, select: { status: true } });
  if (fresh && !statuses.includes(fresh.status)) throw new HttpError(409, code, message(fresh.status));
  return fresh;
};

const submitDirectCost = async ({ orgId, projectId, directCostId, actor = null }) => {
  const existing = await load({ orgId, projectId, directCostId });
  if (existing.status !== STATUS.DRAFT) throw new HttpError(409, "DIRECT_COST_NOT_DRAFT", `A ${existing.status} direct cost cannot be submitted`);
  if (!existing.lines.length) throw new HttpError(400, "DIRECT_COST_EMPTY", "Add at least one line before submitting");
  const unCoded = existing.lines.filter((line) => !line.costCodeId && !line.budgetLineId);
  if (unCoded.length) throw new HttpError(400, "DIRECT_COST_LINE_COST_CODE_REQUIRED", `${unCoded.length} line${unCoded.length === 1 ? " has" : "s have"} no cost code — every line must be coded before approval`);
  const row = await prisma.$transaction(async (tx) => {
    await lockExpecting(tx, directCostId, [STATUS.DRAFT], "DIRECT_COST_NOT_DRAFT", (status) => `A ${status} direct cost cannot be submitted`);
    return tx.directCost.update({ where: { id: directCostId }, data: { status: STATUS.PENDING, submittedBy: actor?.id || null, submittedAt: new Date(), rejectedReason: null, updatedBy: actor?.id || null }, include: detailInclude });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "direct_cost", entityId: directCostId, action: auditService.ACTIONS.STATUS_CHANGED, actorId: actor?.id || null, summary: { ref: row.ref, from: STATUS.DRAFT, to: STATUS.PENDING, total: money(row.total) } }).catch(() => null);
  await notify({ orgId, projectId, row, actor, event: "direct_cost.submitted", title: `${row.ref} waiting for approval`, message: `${row.type} ${row.vendorName ? `from ${row.vendorName} ` : ""}for ${money(row.total)} — ${row.description.slice(0, 120)}`, recipientRoles: ["pm", "finance"] });
  return out(row, { detail: true });
};

/** Finds the budget line to post a line to: the one named, else the cost code's line of the cost type, else any active line of the cost code. */
const budgetLineFor = async ({ tx, projectId, line, costType }) => {
  if (line.budgetLineId) return tx.budgetLine.findFirst({ where: { id: line.budgetLineId, projectId }, select: { id: true } });
  if (!line.costCodeId) return null;
  return (await tx.budgetLine.findFirst({ where: { projectId, costCodeId: line.costCodeId, costType, status: "active" }, select: { id: true } })) || tx.budgetLine.findFirst({ where: { projectId, costCodeId: line.costCodeId, status: "active" }, select: { id: true } });
};

/**
 * Whether this invoice line bought stock rather than project cost
 * (OCTA-FIN-LEDGER-059).
 *
 * Inventory is an asset. Receiving material into a store does not consume it —
 * issuing it to an activity does, and that is when the cost ledger records it,
 * at weighted average, against the activity that actually used it.
 *
 * So an invoice line traceable to a PO line that stocks an item is
 * **capitalised**: it settles the payable and moves inventory value, and it
 * does not post project cost. Expensing it here as well would count the same
 * economic event twice — once when it was bought and again when it was used.
 *
 * Everything else — services, plant hire, direct-to-site material that never
 * touches a store — posts exactly as it always has.
 */
const capitalisedToInventory = async ({ tx, line }) => {
  if (!line.poLineId) return false;
  const poLine = await tx.procurementPoLine.findFirst({
    where: { id: line.poLineId },
    select: { inventoryItemId: true, receivedQty: true },
  });
  if (!poLine) return false;
  return Boolean(poLine.inventoryItemId);
};

const approveDirectCost = async ({ orgId, projectId, directCostId, actor = null }) => {
  const existing = await load({ orgId, projectId, directCostId });
  if (existing.status !== STATUS.PENDING) throw new HttpError(409, "DIRECT_COST_NOT_PENDING", `Only pending direct costs can be approved (this one is ${existing.status})`);
  const now = new Date();
  const row = await prisma.$transaction(async (tx) => {
    await lockExpecting(tx, directCostId, [STATUS.PENDING], "DIRECT_COST_NOT_PENDING", (status) => `Only pending direct costs can be approved (this one is ${status})`);
    let unposted = 0;
    let capitalised = 0;
    for (const line of existing.lines) {
      const amount = round2(line.amount);
      const costType = line.costType || DEFAULT_COST_TYPE[existing.type] || "other";
      const budgetLine = await budgetLineFor({ tx, projectId, line, costType });

      if (await capitalisedToInventory({ tx, line })) {
        capitalised += 1;
        await tx.directCostLine.update({ where: { id: line.id }, data: { budgetLineId: budgetLine?.id || null, costType, postedAmount: 0 } });
        continue;
      }

      // Through the ledger, so the figure can be traced back to this invoice
      // and reconciled against the projections it maintains.
      const result = await costLedger.post({
        tx,
        orgId,
        projectId,
        sourceType: "direct_cost",
        sourceId: directCostId,
        sourceLineId: line.id,
        amount,
        costType,
        activityId: line.activityId || null,
        costCodeId: line.costCodeId || null,
        budgetLineId: budgetLine?.id || null,
        incurredOn: existing.costDate,
        postedBy: actor?.id || null,
        note: `${existing.ref}${existing.vendorName ? ` · ${existing.vendorName}` : ""}`,
      });
      if (!budgetLine && !line.activityId) unposted += 1;
      await tx.directCostLine.update({ where: { id: line.id }, data: { budgetLineId: budgetLine?.id || null, costType, postedAmount: result.posted ? amount : round2(line.postedAmount) } });
    }
    const notes = [
      existing.notes,
      unposted ? `${unposted} line${unposted === 1 ? "" : "s"} had no budget line to post to.` : null,
      capitalised ? `${capitalised} line${capitalised === 1 ? "" : "s"} bought stock and were capitalised to inventory — the cost lands when the material is issued.` : null,
    ].filter(Boolean).join("\n") || null;
    await tx.directCost.update({ where: { id: directCostId }, data: { status: STATUS.APPROVED, approvedBy: actor?.id || null, approvedAt: now, postedAt: now, updatedBy: actor?.id || null, notes } });
    return load({ orgId, projectId, directCostId, tx });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "direct_cost", entityId: directCostId, action: auditService.ACTIONS.APPROVED, actorId: actor?.id || null, summary: { ref: row.ref, total: money(row.total), posted: money(row.lines.reduce((sum, line) => sum + toNumber(line.postedAmount), 0)) } }).catch(() => null);
  await notify({ orgId, projectId, row, actor, event: "direct_cost.approved", title: `${row.ref} approved`, message: `${money(row.total)} posted to the budget${row.vendorName ? ` — ${row.vendorName}` : ""}.`, recipientUserIds: [row.submittedBy, row.createdBy] });
  return out(row, { detail: true });
};

const rejectDirectCost = async ({ orgId, projectId, directCostId, payload = {}, actor = null }) => {
  const existing = await load({ orgId, projectId, directCostId });
  if (existing.status !== STATUS.PENDING) throw new HttpError(409, "DIRECT_COST_NOT_PENDING", "Only pending direct costs can be returned");
  const reason = trimOrNull(payload.reason);
  if (!reason) throw new HttpError(400, "DIRECT_COST_REASON_REQUIRED", "Say why the cost is returned");
  const row = await prisma.$transaction(async (tx) => {
    await lockExpecting(tx, directCostId, [STATUS.PENDING], "DIRECT_COST_NOT_PENDING", () => "Only pending direct costs can be returned");
    return tx.directCost.update({ where: { id: directCostId }, data: { status: STATUS.DRAFT, rejectedReason: reason.slice(0, 1000), submittedBy: null, submittedAt: null, updatedBy: actor?.id || null }, include: detailInclude });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "direct_cost", entityId: directCostId, action: auditService.ACTIONS.REJECTED, actorId: actor?.id || null, summary: { ref: row.ref, reason: reason.slice(0, 200) } }).catch(() => null);
  await notify({ orgId, projectId, row, actor, event: "direct_cost.rejected", title: `${row.ref} returned`, message: reason.slice(0, 500), recipientUserIds: [existing.submittedBy, row.createdBy] });
  return out(row, { detail: true });
};

/** Voids the cost; approved postings are reversed exactly. Paid costs cannot be voided. */
const voidDirectCost = async ({ orgId, projectId, directCostId, payload = {}, actor = null }) => {
  const existing = await load({ orgId, projectId, directCostId });
  if (existing.status === STATUS.VOID) throw new HttpError(409, "DIRECT_COST_LOCKED", `${existing.ref} is already void`);
  if (existing.payments.length) throw new HttpError(409, "DIRECT_COST_HAS_PAYMENTS", "A direct cost with payments cannot be voided — reverse the payments first");
  const reason = trimOrNull(payload.reason);
  if (!reason) throw new HttpError(400, "DIRECT_COST_REASON_REQUIRED", "Say why the cost is voided");
  const row = await prisma.$transaction(async (tx) => {
    // A payment recorded while this void was being decided must stop it: the
    // invoice is locked and its payments counted again (Phase 21D, CX21-103).
    await lockExpecting(tx, directCostId, Object.values(STATUS).filter((status) => status !== STATUS.VOID), "DIRECT_COST_LOCKED", () => `${existing.ref} is already void`);
    const paymentsNow = await tx.directCostPayment.findMany({ where: { directCostId }, select: { id: true } });
    if (paymentsNow.length) throw new HttpError(409, "DIRECT_COST_HAS_PAYMENTS", "A direct cost with payments cannot be voided — reverse the payments first");
    // Through the ledger, which writes negative mirrors rather than deleting —
    // so what was posted and then undone stays on the record, and reversing
    // twice is a no-op for the same reason posting twice is.
    const { reversed: mirrors } = await costLedger.reverse({ tx, orgId, projectId, sourceType: "direct_cost", sourceId: directCostId, postedBy: actor?.id || null, note: reason.slice(0, 500) });
    let reversed = 0;
    for (const line of existing.lines) {
      const posted = toNumber(line.postedAmount);
      if (!posted) continue;
      await tx.directCostLine.update({ where: { id: line.id }, data: { postedAmount: 0 } });
      reversed = round2(reversed + posted);
    }
    void mirrors;
    await tx.directCost.update({ where: { id: directCostId }, data: { status: STATUS.VOID, voidReason: reason.slice(0, 1000), voidedAt: new Date(), updatedBy: actor?.id || null } });
    // A voided invoice is no longer a claim on the order.
    await syncPurchaseOrders(tx, [existing.purchaseOrderId]);
    return { reversed, row: await load({ orgId, projectId, directCostId, tx }) };
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "direct_cost", entityId: directCostId, action: auditService.ACTIONS.STATUS_CHANGED, actorId: actor?.id || null, summary: { ref: row.row.ref, from: existing.status, to: STATUS.VOID, reversed: row.reversed, reason: reason.slice(0, 200) } }).catch(() => null);
  return out(row.row, { detail: true });
};

const recordPayment = async ({ orgId, projectId, directCostId, payload = {}, actor = null }) => {
  const existing = await load({ orgId, projectId, directCostId });
  if (![STATUS.APPROVED, STATUS.PAID].includes(existing.status)) throw new HttpError(409, "DIRECT_COST_NOT_APPROVED", "Payments can only be recorded on approved direct costs");
  const amount = round2(payload.amount);
  if (!(amount > 0)) throw new HttpError(400, "DIRECT_COST_PAYMENT_INVALID", "The payment amount must be positive");
  const balance = balanceOf(existing);
  if (amount > balance + 0.005) throw new HttpError(400, "DIRECT_COST_PAYMENT_EXCEEDS", `The payment exceeds the balance of ${balance}`);
  const paidAt = payload.paidAt ? new Date(payload.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) throw new HttpError(400, "DIRECT_COST_DATE_INVALID", "paidAt is not a valid date");
  const row = await prisma.$transaction(async (tx) => {
    // The balance check above read a figure that another payment may have moved
    // since. Lock the invoice, recompute what has really been paid from the
    // payment rows, and check again before writing (Phase 21D, CX21-005).
    await tx.$queryRaw`SELECT id FROM "DirectCost" WHERE id = ${directCostId} FOR UPDATE`;
    // The status was checked before the lock; a void that landed in between
    // must not be paid back to life (Phase 21D, CX21-103).
    const current = (await tx.directCost.findFirst({ where: { id: directCostId }, select: { status: true, total: true, paidTotal: true } })) || existing;
    if (![STATUS.APPROVED, STATUS.PAID].includes(current.status)) throw new HttpError(409, "DIRECT_COST_NOT_APPROVED", "Payments can only be recorded on approved direct costs");
    const paidRows = await tx.directCostPayment.findMany({ where: { directCostId }, select: { amount: true } });
    const alreadyPaid = paidRows.length ? round2(paidRows.reduce((sum, p) => sum + toNumber(p.amount), 0)) : toNumber(current.paidTotal);
    const remaining = round2(toNumber(current.total) - alreadyPaid);
    if (amount > remaining + 0.005) throw new HttpError(400, "DIRECT_COST_PAYMENT_EXCEEDS", `The payment exceeds the balance of ${remaining}`);
    await tx.directCostPayment.create({ data: { orgId, projectId, directCostId, amount, paidAt, method: trimOrNull(payload.method)?.slice(0, 60) || null, reference: trimOrNull(payload.reference)?.slice(0, 120) || null, note: trimOrNull(payload.note)?.slice(0, 1000) || null, createdBy: actor?.id || null } });
    const paidTotal = round2(alreadyPaid + amount);
    await tx.directCost.update({ where: { id: directCostId }, data: { paidTotal, status: paidTotal + 0.005 >= toNumber(existing.total) ? STATUS.PAID : STATUS.APPROVED, updatedBy: actor?.id || null } });
    return load({ orgId, projectId, directCostId, tx });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "direct_cost", entityId: directCostId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { ref: row.ref, payment: amount, paidTotal: money(row.paidTotal), status: row.status } }).catch(() => null);
  try {
    await require("./cash-flow.service").rebuildCashFlow({ orgId, projectId });
  } catch (error) {
    console.warn("[direct-cost] cash flow rebuild failed", error?.message || error);
  }
  return out(row, { detail: true });
};

module.exports = { STATUS, TYPES, COST_TYPES, DEFAULT_COST_TYPE, listDirectCosts, getDirectCost, createDirectCost, updateDirectCost, deleteDirectCost, submitDirectCost, approveDirectCost, rejectDirectCost, voidDirectCost, recordPayment };
