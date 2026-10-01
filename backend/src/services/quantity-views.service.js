/**
 * Quantity views (PC-6): the five quantities of a BOQ item, and of an
 * activity, each read from the service that owns it and kept apart —
 *
 *   installed  derived     Σ approved QuantityProgressEntry (the core track's
 *                          quantity-progress.service: only approval counts)
 *   certified  source      Σ IpcItem.qty on the allocation summary's certified
 *                          basis (certifiedIpcItemWhere); the subcontract side
 *                          has no quantity (SubPayAppLine carries none)
 *   paid       projection  certified quantity × the certificate's paid share
 *                          (IpcCertificate.amountPaid ÷ netPayable, the
 *                          payment state ipc.service keeps), per certificate
 *   received   derived     Σ StockTransaction receipt quantity, in the
 *   issued     derived     inventory item's unit (issues net of returns, as
 *                          the inventory ledger credits a return)
 *   committed  derived     Σ CommitmentSovLine.qty on posting-status
 *                          commitments — "excludes variations"
 *
 * — five figures with five truths (docs/project-controls/
 * OCTAPM_PROGRESS_MEASUREMENT.md §5–§6). Nothing here is merged, netted
 * against another column or summed across units: a column whose rows are in
 * more than one unit is not available and lists each unit's own sum. Every
 * figure is
 *
 *   { value, truth, basis, unitCode, unitMatch, derivedFrom, notAvailable?: { reason } }
 *
 * where unitCode is the unit the value is in and unitMatch says whether that
 * is the BOQ row's unit (null when nothing was counted). A percent-method
 * activity has no installed quantity: the column is "—", never % × quantity.
 * certified > installed is exposed as a raw comparison flag only — the
 * reviewed exception and the Change Event handoff are PC-7b.
 *
 * The core track's helpers (installedByBoqItem, installedByActivity,
 * plannedQuantityFor) are reached through a small adapter: while the module
 * is absent every installed figure is not available with CORE_PENDING_REASON,
 * so this view, its callers and their tests stand on their own before and
 * after the merge. A caller (a test) may hand in a `core` of its own.
 *
 * Who may read what is the route's and the caller's business: `can(module)`
 * gates certified/paid (ipc), received/issued (inventory) and committed
 * (commitment; party-scoped members are refused as the commitment register
 * refuses them), and utils/boq-figures withholds the whole of it from a
 * member who may not read the BOQ — every one of these per-item quantities is
 * BOQ-derived (QUANTITY_FIGURES_WITHHELD).
 */
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { toMoneyNumber } = require("../utils/money");
const allocationService = require("./activity-boq-allocation.service");
const commitmentService = require("./commitment.service");
const progressService = require("./progress.service");
const uomService = require("./uom.service");

const CORE_PENDING_REASON = "PC-6 core pending";
const QUANTITY_KEYS = Object.freeze(["installed", "certified", "paid", "received", "issued", "committed"]);
const STOCK_TYPES = Object.freeze(["receipt", "issue", "return"]);
const COMMITTED_LABEL = "Committed quantity (excludes variations)";
const PERCENT_METHOD_REASON =
  "This activity is not measured by quantity: its installed quantity is not recorded (never % complete × quantity)";
const SUBCONTRACT_CERTIFIED_REASON =
  "SubPayAppLine carries no quantity: the subcontractor-side certified quantity is not recorded";
const MIXED_UNITS_REASON = "The rows are in more than one unit: the figure is not summed across units (see byUnit)";

const TRUTH = Object.freeze({
  installed: "derived",
  certified: "source",
  paid: "projection",
  received: "derived",
  issued: "derived",
  committed: "derived",
});

const BASIS = Object.freeze({
  installed:
    "Σ approved QuantityProgressEntry.quantity naming this item (quantity-progress.service installedByBoqItem): a daily log, a site capture or an import never counts until the progress approvers approve it",
  certified:
    "Σ IpcItem.qty on the allocation summary's certified basis — status ∈ {certified, paid} on an approved, active allocation (activity-boq-allocation certifiedIpcItemWhere) — the client side; the subcontract side carries no quantity",
  paid:
    "Projection: certified quantity × the certificate's paid share (IpcCertificate.amountPaid ÷ IpcCertificate.netPayable, capped at 1 — the payment state ipc.service syncPaymentState keeps), per certificate; money is paid per certificate, not per line, so no paid quantity is ever recorded",
  received:
    "Σ StockTransaction.quantity of type receipt naming this item, in the inventory item's unit (inventory.service postMovement): never converted to the BOQ unit",
  issued:
    "Σ StockTransaction issue quantity naming this item net of returns (the inventory ledger credits a return as it charges an issue), in the inventory item's unit: never converted to the BOQ unit",
  committed: `${COMMITTED_LABEL}: Σ CommitmentSovLine.qty naming this item on executed/closed commitments (commitment.service POSTING_STATUSES) — approved commitment change orders carry no quantity and no BOQ item, so variations are excluded; not the committed cost`,
});

const DERIVED_FROM = Object.freeze({
  installed: [{ type: "quantity_progress_entry", filter: "boqItemId, status = approved" }],
  certified: [{ type: "ipc_item", filter: "boqItemId, status in (certified, paid), allocation approved and active" }],
  paid: [{ type: "ipc_item", filter: "as certified" }, { type: "ipc_certificate", fields: ["amountPaid", "netPayable"] }],
  received: [{ type: "stock_transaction", filter: "boqItemId, type = receipt" }],
  issued: [{ type: "stock_transaction", filter: "boqItemId, type in (issue, return)" }],
  committed: [{ type: "commitment_sov_line", filter: "boqItemId, commitment.status in (executed, closed)" }],
});

const round3 = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 1000) / 1000;
};
const iso = (value) => (value ? new Date(value).toISOString() : null);

const figure = ({ key, value, unitCode = null, unitMatch = null, basis = BASIS[key], derivedFrom = DERIVED_FROM[key], ...extra }) => ({
  value: round3(value),
  truth: TRUTH[key],
  basis,
  unitCode,
  unitMatch,
  derivedFrom,
  ...extra,
});

const unavailable = ({ key, reason, unitCode = null, basis = BASIS[key], ...extra }) => ({
  value: null,
  truth: TRUTH[key],
  basis,
  unitCode,
  unitMatch: null,
  derivedFrom: [],
  notAvailable: { reason },
  ...extra,
});

const denied = (key, module) =>
  unavailable({ key, reason: `You do not have permission to read the ${module} module, which owns this figure`, module });

// ─── the core adapter ─────────────────────────────────────────────────────

let coreModule;
const loadCore = () => {
  if (coreModule !== undefined) return coreModule;
  try {
    // eslint-disable-next-line global-require
    coreModule = require("./quantity-progress.service");
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND" && /quantity-progress\.service/.test(String(error.message))) coreModule = null;
    else throw error;
  }
  return coreModule;
};

const coreOf = (core) => {
  const module = core === undefined ? loadCore() : core;
  const present =
    Boolean(module) &&
    typeof module.installedByBoqItem === "function" &&
    typeof module.installedByActivity === "function" &&
    typeof module.plannedQuantityFor === "function";
  return { present, module: present ? module : null };
};

// ─── units ────────────────────────────────────────────────────────────────

const unitContext = async (orgId) => {
  const index = await uomService.loadUnitIndex(orgId);
  // The code a spelling resolves to in the organisation's list; a spelling
  // nobody recognises keeps its own comparison key so two unknown spellings
  // of one unit still compare, and never pass as another unit.
  const codeOf = (unit) => {
    const text = unit == null ? "" : String(unit).trim();
    if (!text) return null;
    return uomService.normaliseWith(index, text) || uomService.unitKey(text);
  };
  return { codeOf };
};

const itemUnitCode = (item, units) => item.unitCode || units.codeOf(item.unit) || null;

/**
 * Sums rows per unit. One unit → a figure in it; none → 0 in the row's own
 * unit with nothing to match; several → not available, each unit's own sum
 * listed and none of them added together.
 */
const perUnitFigure = ({ key, rows, unitOf, quantityOf, itemUnit, extra = {} }) => {
  const byUnit = new Map();
  for (const row of rows) {
    const unit = unitOf(row) || itemUnit || null;
    byUnit.set(unit, (byUnit.get(unit) || 0) + Number(quantityOf(row) || 0));
  }
  if (byUnit.size === 0) return figure({ key, value: 0, unitCode: itemUnit, unitMatch: null, rows: 0, ...extra });
  if (byUnit.size === 1) {
    const [[unit, total]] = byUnit.entries();
    return figure({ key, value: total, unitCode: unit, unitMatch: itemUnit ? unit === itemUnit : null, rows: rows.length, ...extra });
  }
  return unavailable({
    key,
    reason: MIXED_UNITS_REASON,
    unitCode: itemUnit,
    rows: rows.length,
    byUnit: [...byUnit.entries()].map(([unitCode, value]) => ({ unitCode, value: round3(value), unitMatch: itemUnit ? unitCode === itemUnit : null })),
    ...extra,
  });
};

const groupBy = (rows, keyOf) => {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
};

const parseCutoff = (cutoffDate) => {
  if (cutoffDate == null || cutoffDate === "") return null;
  const cutoff = new Date(cutoffDate);
  if (Number.isNaN(cutoff.getTime())) throw new HttpError(400, "VALIDATION_ERROR", "cutoffDate must be a valid date");
  return cutoff;
};

// ─── the source reads (batched: one query per source for any number of items) ───

const certifiedWhere = ({ projectId, cutoff }) => ({
  ...allocationService.certifiedIpcItemWhere(projectId),
  ...(cutoff
    ? { OR: [{ certDate: { lte: cutoff } }, { certDate: null, ipcCertificate: { is: { certifiedAt: { lte: cutoff } } } }] }
    : {}),
});

const readCertifiedLines = async ({ projectId, cutoff, boqItemIds = null, activityId = null }) =>
  prisma.ipcItem.findMany({
    where: {
      AND: [
        certifiedWhere({ projectId, cutoff }),
        ...(boqItemIds ? [{ boqItemId: { in: boqItemIds } }] : []),
        ...(activityId ? [{ allocation: { is: { activityId } } }] : []),
      ],
    },
    select: { id: true, boqItemId: true, allocationId: true, ipcCertificateId: true, qty: true, status: true },
  });

const readCertificates = async ({ projectId, certificateIds }) => {
  if (!certificateIds.length) return new Map();
  const rows = await prisma.ipcCertificate.findMany({
    where: { projectId, id: { in: certificateIds } },
    select: { id: true, period: true, status: true, paymentStatus: true, amountPaid: true, netPayable: true },
  });
  return new Map(rows.map((row) => [row.id, row]));
};

const readStock = async ({ projectId, cutoff, boqItemIds = null, activityId = null }) =>
  prisma.stockTransaction.findMany({
    where: {
      projectId,
      type: { in: [...STOCK_TYPES] },
      ...(boqItemIds ? { boqItemId: { in: boqItemIds } } : {}),
      ...(activityId ? { activityId } : {}),
      ...(cutoff ? { occurredAt: { lte: cutoff } } : {}),
    },
    select: { id: true, boqItemId: true, activityId: true, type: true, quantity: true, item: { select: { id: true, unit: true } } },
  });

const readSovLines = async ({ projectId, boqItemIds = null, activityId = null }) =>
  prisma.commitmentSovLine.findMany({
    where: {
      projectId,
      ...(boqItemIds ? { boqItemId: { in: boqItemIds } } : {}),
      ...(activityId ? { activityId } : {}),
      commitment: { projectId, status: { in: [...commitmentService.POSTING_STATUSES] } },
    },
    select: { id: true, boqItemId: true, activityId: true, qty: true, unit: true, commitmentId: true },
  });

// ─── the figures ──────────────────────────────────────────────────────────

const installedFigure = ({ core, entry, itemUnit }) => {
  if (!core.present) return unavailable({ key: "installed", reason: CORE_PENDING_REASON, unitCode: itemUnit });
  if (!entry) return figure({ key: "installed", value: 0, unitCode: itemUnit, unitMatch: null, entries: 0, lastApprovedAt: null });
  const unitCode = entry.unitCode || itemUnit || null;
  return figure({
    key: "installed",
    value: entry.quantity,
    unitCode,
    unitMatch: itemUnit && unitCode ? unitCode === itemUnit : null,
    // installedByBoqItem says which entries and when the last was approved;
    // installedByActivity gives the per-item sums only.
    ...(entry.entries !== undefined ? { entries: Array.isArray(entry.entries) ? entry.entries.length : Number(entry.entries) || 0 } : {}),
    ...(entry.lastApprovedAt !== undefined ? { lastApprovedAt: iso(entry.lastApprovedAt) } : {}),
  });
};

const certifiedFigure = ({ lines, itemUnit }) =>
  figure({
    key: "certified",
    value: lines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0),
    unitCode: itemUnit,
    // An IPC line is raised on the BOQ row, in its unit.
    unitMatch: lines.length ? true : null,
    rows: lines.length,
    subcontract: unavailable({ key: "certified", reason: SUBCONTRACT_CERTIFIED_REASON, unitCode: itemUnit, side: "subcontract" }),
  });

// The share of a certificate that has been paid: the owner's payment state,
// never recomputed from the payments here. A certificate payable for nothing
// is paid when its status says so.
const paidShareOf = (certificate) => {
  if (!certificate) return 0;
  const netPayable = toMoneyNumber(certificate.netPayable);
  const amountPaid = toMoneyNumber(certificate.amountPaid);
  if (netPayable > 0) return Math.max(0, Math.min(1, amountPaid / netPayable));
  return certificate.status === "paid" || certificate.paymentStatus === "paid" ? 1 : 0;
};

const paidFigure = ({ lines, certificates, itemUnit }) => {
  const perCertificate = new Map();
  for (const line of lines) {
    const certificateId = line.ipcCertificateId || null;
    const certificate = certificateId ? certificates.get(certificateId) : null;
    const share = paidShareOf(certificate);
    const bucket = perCertificate.get(certificateId) || {
      certificateId,
      period: certificate?.period ?? null,
      certifiedQuantity: 0,
      amountPaid: certificate ? toMoneyNumber(certificate.amountPaid) : 0,
      netPayable: certificate ? toMoneyNumber(certificate.netPayable) : 0,
      paidShare: share,
      paidQuantity: 0,
    };
    bucket.certifiedQuantity += Number(line.qty) || 0;
    bucket.paidQuantity += (Number(line.qty) || 0) * share;
    perCertificate.set(certificateId, bucket);
  }
  const buckets = [...perCertificate.values()].map((bucket) => ({
    ...bucket,
    certifiedQuantity: round3(bucket.certifiedQuantity),
    paidQuantity: round3(bucket.paidQuantity),
    paidShare: Math.round(bucket.paidShare * 10000) / 10000,
  }));
  return figure({
    key: "paid",
    value: buckets.reduce((sum, bucket) => sum + bucket.paidQuantity, 0),
    unitCode: itemUnit,
    unitMatch: lines.length ? true : null,
    certificates: buckets,
  });
};

const stockUnitOf = (row) => row.item?.unit ?? null;

const receivedFigure = ({ rows, units, itemUnit }) =>
  perUnitFigure({
    key: "received",
    rows: rows.filter((row) => row.type === "receipt"),
    unitOf: (row) => units.codeOf(stockUnitOf(row)),
    quantityOf: (row) => Math.abs(Number(row.quantity) || 0),
    itemUnit,
  });

// An issue is stored as the negative delta it made to stock; a return is the
// positive delta it gave back. Issued = Σ|issue| − Σ return, the sign the
// inventory ledger gives each (CONSUMPTION_SIGN), with both parts stated.
const issuedFigure = ({ rows, units, itemUnit }) => {
  const movements = rows.filter((row) => row.type === "issue" || row.type === "return");
  const result = perUnitFigure({
    key: "issued",
    rows: movements,
    unitOf: (row) => units.codeOf(stockUnitOf(row)),
    quantityOf: (row) => (row.type === "issue" ? Math.abs(Number(row.quantity) || 0) : -Math.abs(Number(row.quantity) || 0)),
    itemUnit,
  });
  const gross = movements.filter((row) => row.type === "issue").reduce((sum, row) => sum + Math.abs(Number(row.quantity) || 0), 0);
  const returned = movements.filter((row) => row.type === "return").reduce((sum, row) => sum + Math.abs(Number(row.quantity) || 0), 0);
  return { ...result, components: { issued: round3(gross), returned: round3(returned) } };
};

const committedFigure = ({ lines, units, itemUnit }) => ({
  ...perUnitFigure({
    key: "committed",
    rows: lines,
    unitOf: (line) => units.codeOf(line.unit),
    quantityOf: (line) => Number(line.qty) || 0,
    itemUnit,
  }),
  label: COMMITTED_LABEL,
  commitments: new Set(lines.map((line) => line.commitmentId)).size,
});

// certified > installed, as a raw comparison only (the overrun exception is PC-7b).
const comparisonsOf = ({ installed, certified }) => {
  const comparable =
    installed.value != null && certified.value != null && Boolean(installed.unitCode) && installed.unitCode === certified.unitCode;
  return {
    certifiedOverInstalled: {
      flag: comparable ? certified.value > installed.value : null,
      certified: certified.value,
      installed: installed.value,
      unitCode: comparable ? installed.unitCode : null,
      basis: "Raw comparison of the certified figure against the installed figure, in one unit; a reviewed over-certification exception is PC-7b",
      ...(comparable
        ? {}
        : {
            reason:
              installed.value == null
                ? installed.notAvailable?.reason || "installed is not available"
                : certified.value == null
                  ? certified.notAvailable?.reason || "certified is not available"
                  : "the two figures are not in one unit",
          }),
    },
  };
};

/**
 * The per-BOQ-item block: the six figures and the comparison for each of
 * `items` (rows with id, unit, unitCode), scoped to one activity when
 * `activityId` is given. One query per source for the whole set.
 */
const quantityBlocks = async ({
  orgId,
  projectId,
  items,
  can = () => true,
  partyScoped = false,
  cutoffDate = null,
  activityId = null,
  core,
  // Rows a caller already read for the same scope (the activity view reads
  // them first to learn which items it is about): read once, never twice.
  preread = {},
}) => {
  const cutoff = parseCutoff(cutoffDate);
  const adapter = coreOf(core);
  const boqItemIds = items.map((item) => item.id);
  const canIpc = can("ipc");
  const canInventory = can("inventory");
  const canCommitment = can("commitment") && !partyScoped;
  const readOr = (key, read) => (preread[key] !== undefined ? preread[key] : read());
  const [units, installedMap, certifiedLines, stockRows, sovLines] = await Promise.all([
    unitContext(orgId),
    readOr("installedMap", () =>
      adapter.present && boqItemIds.length
        ? activityId
          ? adapter.module.installedByActivity({ orgId, projectId, activityIds: [activityId], cutoffDate: cutoff })
          : adapter.module.installedByBoqItem({ orgId, projectId, boqItemIds, cutoffDate: cutoff })
        : new Map(),
    ),
    readOr("certifiedLines", () => (canIpc && boqItemIds.length ? readCertifiedLines({ projectId, cutoff, boqItemIds, activityId }) : [])),
    readOr("stockRows", () => (canInventory && boqItemIds.length ? readStock({ projectId, cutoff, boqItemIds, activityId }) : [])),
    readOr("sovLines", () => (canCommitment && boqItemIds.length ? readSovLines({ projectId, boqItemIds, activityId }) : [])),
  ]);
  const certificates = await readCertificates({
    projectId,
    certificateIds: [...new Set(certifiedLines.map((line) => line.ipcCertificateId).filter(Boolean))],
  });
  // installedByActivity answers per activity, a list per item; installedByBoqItem per item.
  const installedByItem = new Map();
  if (activityId) {
    const forActivity = installedMap.get(activityId);
    for (const entry of forActivity?.installed || []) installedByItem.set(entry.boqItemId, entry);
  } else {
    for (const [boqItemId, entry] of installedMap.entries()) installedByItem.set(boqItemId, entry);
  }
  const certifiedByItem = groupBy(certifiedLines, (line) => line.boqItemId);
  const stockByItem = groupBy(stockRows, (row) => row.boqItemId);
  const sovByItem = groupBy(sovLines, (line) => line.boqItemId);

  const blocks = new Map();
  for (const item of items) {
    const itemUnit = itemUnitCode(item, units);
    const lines = certifiedByItem.get(item.id) || [];
    const installed = installedFigure({ core: adapter, entry: installedByItem.get(item.id), itemUnit });
    const certified = canIpc ? certifiedFigure({ lines, itemUnit }) : denied("certified", "ipc");
    const figures = {
      installed,
      certified,
      paid: canIpc ? paidFigure({ lines, certificates, itemUnit }) : denied("paid", "ipc"),
      received: canInventory ? receivedFigure({ rows: stockByItem.get(item.id) || [], units, itemUnit }) : denied("received", "inventory"),
      issued: canInventory ? issuedFigure({ rows: stockByItem.get(item.id) || [], units, itemUnit }) : denied("issued", "inventory"),
      committed: canCommitment
        ? committedFigure({ lines: sovByItem.get(item.id) || [], units, itemUnit })
        : { ...denied("committed", "commitment"), label: COMMITTED_LABEL },
    };
    blocks.set(item.id, {
      boqItemId: item.id,
      unit: item.unit ?? null,
      unitCode: itemUnit,
      figures,
      comparisons: comparisonsOf(figures),
    });
  }
  return { blocks, cutoff, core: adapter.present, units };
};

// ─── the two views ────────────────────────────────────────────────────────

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

const getBoqItemQuantities = async ({ orgId, projectId, itemId, can = () => true, partyScoped = false, cutoffDate = null, core }) => {
  await ensureProject({ orgId, projectId });
  const item = await prisma.boqItem.findFirst({
    where: { id: itemId, projectId },
    select: { id: true, code: true, ref: true, description: true, unit: true, unitCode: true, qty: true, isActive: true },
  });
  if (!item) throw new HttpError(404, "BOQ_ITEM_NOT_FOUND", "BOQ item not found");
  const { blocks, cutoff, core: corePresent } = await quantityBlocks({ orgId, projectId, items: [item], can, partyScoped, cutoffDate, core });
  const block = blocks.get(item.id);
  return {
    kind: "boq_item",
    id: item.id,
    boqItemId: item.id,
    code: item.code || item.ref || "",
    description: item.description ?? null,
    unit: block.unit,
    unitCode: block.unitCode,
    quantity: {
      value: round3(item.qty),
      truth: "source",
      basis: "BoqItem.qty on the current revision",
      unitCode: block.unitCode,
      unitMatch: true,
      derivedFrom: [{ type: "boq_item", id: item.id }],
    },
    cutoffDate: cutoff ? cutoff.toISOString() : null,
    asOf: new Date().toISOString(),
    core: corePresent ? "present" : "pending",
    figures: block.figures,
    comparisons: block.comparisons,
    keys: [...QUANTITY_KEYS],
  };
};

// The activity-level figure: Σ of its items' figures when every one of them
// is stated in one unit; otherwise not available, each item's figure listed.
const foldActivityFigure = ({ key, blocks, label }) => {
  const perItem = blocks.map((block) => ({ boqItemId: block.boqItemId, ...block.figures[key] }));
  const stated = perItem.filter((entry) => entry.value != null);
  const missing = perItem.filter((entry) => entry.value == null);
  const extra = label ? { label } : {};
  if (missing.length) {
    return {
      ...unavailable({ key, reason: missing[0].notAvailable?.reason || "a figure of one of the activity's items is not available", ...extra }),
      byItem: perItem,
    };
  }
  // An item on which nothing was counted (0, nothing to match) names no unit
  // of its own: two such rows in different units are not "mixed".
  const counted = stated.filter((entry) => entry.unitMatch !== null || entry.value !== 0);
  if (!counted.length) return { ...figure({ key, value: 0, unitCode: null, unitMatch: null, ...extra }), byItem: perItem };
  const unitCodes = [...new Set(counted.map((entry) => entry.unitCode).filter(Boolean))];
  if (unitCodes.length > 1) {
    return {
      ...unavailable({ key, reason: MIXED_UNITS_REASON, ...extra }),
      byUnit: unitCodes.map((unitCode) => ({
        unitCode,
        value: round3(stated.filter((entry) => entry.unitCode === unitCode).reduce((sum, entry) => sum + entry.value, 0)),
      })),
      byItem: perItem,
    };
  }
  const matches = stated.map((entry) => entry.unitMatch).filter((flag) => flag !== null);
  return {
    ...figure({
      key,
      value: stated.reduce((sum, entry) => sum + entry.value, 0),
      unitCode: unitCodes[0] || null,
      unitMatch: matches.length ? matches.every(Boolean) : null,
      ...extra,
    }),
    byItem: perItem,
  };
};

const plannedFigureOf = (answer) => ({
  value: answer && answer.planned != null ? round3(answer.planned) : null,
  truth: answer?.basis === "approved_allocations" ? "derived" : answer?.basis === "method_config" ? "source" : null,
  basis: `Planned quantity by ${answer?.basis || "none"} (quantity-progress.service plannedQuantityFor)`,
  unitCode: answer?.unitCode ?? null,
  unitMatch: null,
  derivedFrom: answer && answer.planned != null ? [{ type: answer.basis === "approved_allocations" ? "activity_boq_allocation" : "activity_progress_method" }] : [],
  ...(answer && answer.planned != null ? {} : { notAvailable: { reason: "No planned quantity: no approved allocation and no method configuration states one" } }),
  plannedBasis: answer?.basis || "none",
});

const getActivityQuantities = async ({ orgId, projectId, activityId, can = () => true, partyScoped = false, cutoffDate = null, core }) => {
  await ensureProject({ orgId, projectId });
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, projectId },
    select: { id: true, name: true, activityCode: true, p6ActivityId: true },
  });
  if (!activity) throw new HttpError(404, "ACTIVITY_NOT_FOUND", "Activity not found");
  const adapter = coreOf(core);
  const cutoff = parseCutoff(cutoffDate);
  const canProgress = can("progress");

  const [methodRow, allocations, latest] = await Promise.all([
    prisma.activityProgressMethod.findFirst({ where: { projectId, activityId }, select: { method: true } }),
    prisma.activityBoqAllocation.findMany({ where: { projectId, activityId, status: "approved", isActive: true }, select: { boqItemId: true } }),
    canProgress
      ? prisma.activityProgress.findFirst({
          where: { activityId, status: "approved", ...(cutoff ? { approvedAt: { lte: cutoff } } : {}) },
          orderBy: [{ approvedAt: "desc" }, { updatedAt: "desc" }],
          select: { id: true, pctComplete: true, approvedAt: true, source: true, progressMethod: true },
        })
      : null,
  ]);
  const method = progressService.normalizeMethod(methodRow?.method || "percent");
  const quantityMethod = method === "quantity";

  // The items the activity's quantities are about: its approved allocations'
  // rows, plus any row the installed, certified, stock or commitment reads
  // name against this activity.
  const itemIds = new Set(allocations.map((allocation) => allocation.boqItemId));
  const [installedMap, certifiedLines, stockRows, sovLines] = await Promise.all([
    adapter.present && quantityMethod ? adapter.module.installedByActivity({ orgId, projectId, activityIds: [activityId], cutoffDate: cutoff }) : new Map(),
    can("ipc") ? readCertifiedLines({ projectId, cutoff, activityId }) : [],
    can("inventory") ? readStock({ projectId, cutoff, activityId }) : [],
    can("commitment") && !partyScoped ? readSovLines({ projectId, activityId }) : [],
  ]);
  for (const entry of installedMap.get(activityId)?.installed || []) if (entry.boqItemId) itemIds.add(entry.boqItemId);
  for (const row of [...certifiedLines, ...stockRows, ...sovLines]) if (row.boqItemId) itemIds.add(row.boqItemId);
  const items = itemIds.size
    ? await prisma.boqItem.findMany({
        where: { id: { in: [...itemIds] }, projectId },
        select: { id: true, code: true, ref: true, description: true, unit: true, unitCode: true },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      })
    : [];
  const { blocks } = await quantityBlocks({
    orgId,
    projectId,
    items,
    can,
    partyScoped,
    cutoffDate: cutoff,
    activityId,
    core,
    preread: { installedMap, certifiedLines, stockRows, sovLines },
  });
  const blockList = items.map((item) => {
    const block = blocks.get(item.id);
    if (!quantityMethod) {
      block.figures = { ...block.figures, installed: unavailable({ key: "installed", reason: PERCENT_METHOD_REASON, unitCode: block.unitCode, method }) };
      block.comparisons = comparisonsOf(block.figures);
    }
    return { ...block, code: item.code || item.ref || "", description: item.description ?? null };
  });

  const figures = {};
  for (const key of QUANTITY_KEYS) figures[key] = foldActivityFigure({ key, blocks: blockList, label: key === "committed" ? COMMITTED_LABEL : null });
  if (!quantityMethod) figures.installed = { ...unavailable({ key: "installed", reason: PERCENT_METHOD_REASON, method }), byItem: figures.installed.byItem };
  else if (!adapter.present) figures.installed = { ...unavailable({ key: "installed", reason: CORE_PENDING_REASON }), byItem: figures.installed.byItem };

  let planned;
  if (!canProgress) planned = null;
  else if (!quantityMethod) {
    planned = { value: null, truth: null, basis: "Planned quantity applies to the quantity method only", unitCode: null, unitMatch: null, derivedFrom: [], notAvailable: { reason: PERCENT_METHOD_REASON }, method };
  } else if (adapter.present) planned = plannedFigureOf(await adapter.module.plannedQuantityFor({ orgId, projectId, activityId }));
  else planned = { value: null, truth: null, basis: "Planned quantity (quantity-progress.service plannedQuantityFor)", unitCode: null, unitMatch: null, derivedFrom: [], notAvailable: { reason: CORE_PENDING_REASON } };

  return {
    kind: "activity",
    id: activity.id,
    activityId: activity.id,
    code: activity.activityCode || activity.p6ActivityId || null,
    name: activity.name,
    cutoffDate: cutoff ? cutoff.toISOString() : null,
    asOf: new Date().toISOString(),
    core: adapter.present ? "present" : "pending",
    progress: canProgress
      ? {
          allowed: true,
          method,
          pctComplete: latest
            ? {
                value: round3(latest.pctComplete),
                truth: "source",
                basis: cutoff ? "Latest approved ActivityProgress on or before the cutoff" : "Latest approved ActivityProgress",
                derivedFrom: [{ type: "activity_progress", id: latest.id }],
              }
            : { value: 0, truth: "source", basis: "No approved progress", derivedFrom: [] },
          progressSource: latest?.source ?? null,
          planned,
        }
      : { allowed: false, module: "progress", reason: "You do not have permission to read this section" },
    figures,
    comparisons: comparisonsOf(figures),
    items: blockList,
    stockWithoutBoqItem: stockRows.filter((row) => !row.boqItemId).length,
    sovLinesWithoutBoqItem: sovLines.filter((line) => !line.boqItemId).length,
    keys: [...QUANTITY_KEYS],
  };
};

/**
 * The activity's installed figure alone, for the activity detail's progress
 * section (controls-detail.service): the same rule as the activity view —
 * "—" on an activity not measured by quantity, the core's per-item figures
 * folded into one unit otherwise, each item's own figure listed.
 */
const installedForActivity = async ({ orgId, projectId, activityId, method, core }) => {
  const normalised = progressService.normalizeMethod(method || "percent");
  if (normalised !== "quantity") return unavailable({ key: "installed", reason: PERCENT_METHOD_REASON, method: normalised });
  const adapter = coreOf(core);
  if (!adapter.present) return unavailable({ key: "installed", reason: CORE_PENDING_REASON });
  const installedMap = await adapter.module.installedByActivity({ orgId, projectId, activityIds: [activityId] });
  const entries = installedMap.get(activityId)?.installed || [];
  const itemIds = [...new Set(entries.map((entry) => entry.boqItemId).filter(Boolean))];
  if (!itemIds.length) return { ...figure({ key: "installed", value: 0, unitCode: null, unitMatch: null, entries: 0 }), byItem: [] };
  const items = await prisma.boqItem.findMany({ where: { id: { in: itemIds }, projectId }, select: { id: true, unit: true, unitCode: true } });
  const { blocks } = await quantityBlocks({
    orgId,
    projectId,
    items,
    can: () => false,
    activityId,
    core: adapter.module,
    preread: { installedMap, certifiedLines: [], stockRows: [], sovLines: [] },
  });
  return foldActivityFigure({ key: "installed", blocks: [...blocks.values()] });
};

module.exports = {
  installedForActivity,
  CORE_PENDING_REASON,
  COMMITTED_LABEL,
  MIXED_UNITS_REASON,
  PERCENT_METHOD_REASON,
  SUBCONTRACT_CERTIFIED_REASON,
  QUANTITY_KEYS,
  STOCK_TYPES,
  TRUTH,
  BASIS,
  paidShareOf,
  quantityBlocks,
  getBoqItemQuantities,
  getActivityQuantities,
};
