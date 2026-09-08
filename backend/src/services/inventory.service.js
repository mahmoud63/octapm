const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const costLedger = require("./cost-ledger.service");

/**
 * Inventory, warehouses and the stock ledger (OCTA-INV-STOCK-050).
 *
 * The ledger is the source of truth. Every movement writes a StockTransaction
 * and updates the StockBalance it affects inside one database transaction, so a
 * balance can always be proved from the movements that produced it — which is
 * what a material variance claim is argued from, and why nothing here edits
 * history. A mistake is corrected with a reversing entry.
 *
 * Costing is weighted average, the convention a construction store runs on:
 * a receipt moves the average, an issue leaves at the average it finds. The
 * item also keeps the last price paid, because a buyer wants that separately
 * from the blended figure.
 *
 * Stock cannot go negative. A store that lets you issue what you do not have
 * produces a tidy screen and a wrong site.
 */

const ITEM_STATUSES = ["active", "archived"];
const WAREHOUSE_KINDS = [
  "central",
  "project",
  "site",
  "temporary",
  "equipment_yard",
];
const LOCATION_KINDS = ["zone", "aisle", "rack", "shelf", "bin"];
const TRANSFER_STATUSES = ["draft", "in_transit", "received", "cancelled"];
const COUNT_STATUSES = ["open", "counting", "posted", "cancelled"];

/** What each movement does to a balance. */
const MOVEMENTS = {
  receipt: { onHand: +1, costs: true },
  issue: { onHand: -1 },
  return: { onHand: +1 },
  transfer_out: { onHand: -1, inTransit: +1 },
  transfer_in: { onHand: +1 },
  adjust: { onHand: +1 }, // signed quantity
  count: { onHand: +1 }, // signed variance
  damage: { onHand: -1, damaged: +1 },
  quarantine: { onHand: -1, quarantined: +1 },
  release: { onHand: +1, quarantined: -1 },
  reverse: { onHand: +1 }, // signed
};

const SIGNED_TYPES = new Set(["adjust", "count", "reverse"]);

/**
 * Movements that may only draw on **available** stock — on hand less what is
 * reserved for somebody else.
 *
 * Damage, quarantine and counts are physical facts rather than allocations: a
 * pallet that was dropped was dropped, whether or not it was spoken for, so
 * those are deliberately allowed to take reserved stock down with them.
 */
const RESPECTS_RESERVATION = new Set(["issue", "transfer_out"]);

/** What can actually be taken from a balance for this kind of movement. */
const availableOn = (balance, type) =>
  RESPECTS_RESERVATION.has(type)
    ? Math.max(0, round(balance.onHand - (balance.reserved ?? 0)))
    : Math.max(0, round(balance.onHand));

const round = (value, dp = 4) => {
  const factor = 10 ** dp;
  return Math.round((Number(value) || 0) * factor) / factor;
};

const positive = (value, field) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(400, "INV_QUANTITY", `${field} must be greater than zero`);
  }
  return parsed;
};

const trimOrNull = (value) => {
  const text = String(value ?? "").trim();
  return text ? text : null;
};

const requireText = (value, field, max = 200) => {
  const text = String(value ?? "").trim();
  if (!text) throw new HttpError(400, "INV_REQUIRED", `${field} is required`);
  if (text.length > max) {
    throw new HttpError(400, "INV_TOO_LONG", `${field} must be ${max} characters or fewer`);
  }
  return text;
};

const oneOf = (value, allowed, field, fallback) => {
  const picked = value === undefined ? fallback : String(value);
  if (!allowed.includes(picked)) {
    throw new HttpError(400, "INV_ENUM", `${field} must be one of ${allowed.join(", ")}`);
  }
  return picked;
};

// ─── item master ───────────────────────────────────────────────────────────

const serializeItem = (row) => ({
  id: row.id,
  projectId: row.projectId,
  sku: row.sku,
  barcode: row.barcode,
  qrCode: row.qrCode,
  name: row.name,
  description: row.description,
  category: row.category,
  unit: row.unit,
  manufacturer: row.manufacturer,
  model: row.model,
  specification: row.specification,
  preferredSupplierId: row.preferredSupplierId,
  preferredSupplier: row.preferredSupplier?.name ?? null,
  unitCost: Number(row.unitCost ?? 0),
  averageCost: Number(row.averageCost ?? 0),
  lastPurchasePrice: row.lastPurchasePrice == null ? null : Number(row.lastPurchasePrice),
  reorderLevel: row.reorderLevel,
  minStock: row.minStock,
  maxStock: row.maxStock,
  leadTimeDays: row.leadTimeDays,
  isSerialised: row.isSerialised,
  isBatched: row.isBatched,
  status: row.status,
  notes: row.notes,
  onHand: row.balances ? round(row.balances.reduce((sum, b) => sum + b.onHand, 0)) : undefined,
  reserved: row.balances ? round(row.balances.reduce((sum, b) => sum + b.reserved, 0)) : undefined,
  createdAt: row.createdAt?.toISOString() ?? null,
  updatedAt: row.updatedAt?.toISOString() ?? null,
});

/** Adds the derived stock figures a list view needs without a second query. */
const withStock = (item) => {
  const balances = item.balances ?? [];
  const onHand = round(balances.reduce((sum, b) => sum + b.onHand, 0));
  const reserved = round(balances.reduce((sum, b) => sum + b.reserved, 0));
  return {
    ...serializeItem(item),
    onHand,
    reserved,
    available: round(onHand - reserved),
    inTransit: round(balances.reduce((sum, b) => sum + b.inTransit, 0)),
    damaged: round(balances.reduce((sum, b) => sum + b.damaged, 0)),
    quarantined: round(balances.reduce((sum, b) => sum + b.quarantined, 0)),
    value: round(onHand * Number(item.averageCost ?? 0), 2),
    belowReorder: onHand <= item.reorderLevel && item.reorderLevel > 0,
  };
};

const listItems = async ({ orgId, projectId = null, search = null, category = null, status = "active", lowStock = false }) => {
  const where = {
    orgId,
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    // A company item is usable on every project; a project item only on its own.
    ...(projectId ? { OR: [{ projectId: null }, { projectId }] } : {}),
    ...(search
      ? {
          OR: [
            { sku: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
            { barcode: { contains: search, mode: "insensitive" } },
            { manufacturer: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const rows = await prisma.inventoryItem.findMany({
    where,
    include: { balances: true, preferredSupplier: { select: { name: true } } },
    orderBy: [{ name: "asc" }],
    take: 500,
  });

  const items = rows.map(withStock);
  return { items: lowStock ? items.filter((item) => item.belowReorder) : items };
};

/**
 * Resolves whatever a scanner produced to one item.
 *
 * A phone camera does not know whether it read a barcode, a QR token or a
 * printed SKU, so this tries all three rather than making the field the
 * scanner's problem.
 */
const findByCode = async ({ orgId, code }) => {
  const value = requireText(code, "code");
  const row = await prisma.inventoryItem.findFirst({
    where: {
      orgId,
      OR: [{ barcode: value }, { qrCode: value }, { sku: value }],
    },
    include: {
      balances: {
        include: {
          warehouse: { select: { id: true, code: true, name: true, kind: true } },
          location: { select: { id: true, code: true, name: true, kind: true, path: true } },
        },
      },
      preferredSupplier: { select: { name: true } },
    },
  });
  if (!row) {
    throw new HttpError(404, "ITEM_NOT_FOUND", `Nothing in inventory matches "${value}"`);
  }

  return {
    item: withStock(row),
    // Where it physically is, so a scan answers "where is it" in one step.
    stock: row.balances.map((balance) => ({
      warehouseId: balance.warehouseId,
      warehouse: balance.warehouse?.name ?? null,
      warehouseCode: balance.warehouse?.code ?? null,
      locationId: balance.locationId,
      location: balance.location?.name ?? null,
      locationCode: balance.location?.code ?? null,
      onHand: round(balance.onHand),
      reserved: round(balance.reserved),
      available: round(balance.onHand - balance.reserved),
      damaged: round(balance.damaged),
      quarantined: round(balance.quarantined),
    })),
  };
};

const getItem = async ({ orgId, itemId }) => {
  const row = await prisma.inventoryItem.findFirst({
    where: { id: itemId, orgId },
    include: {
      balances: {
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
          location: { select: { id: true, code: true, name: true } },
        },
      },
      preferredSupplier: { select: { name: true } },
    },
  });
  if (!row) throw new HttpError(404, "ITEM_NOT_FOUND", "Item not found");
  return withStock(row);
};

const itemFields = (payload, existing = null) => {
  const data = {};
  if (payload.sku !== undefined || !existing) data.sku = requireText(payload.sku ?? existing?.sku, "SKU", 60);
  if (payload.name !== undefined || !existing) data.name = requireText(payload.name ?? existing?.name, "Name");
  if (payload.unit !== undefined || !existing) data.unit = requireText(payload.unit ?? existing?.unit, "Unit", 20);

  const optional = [
    "barcode", "qrCode", "description", "category", "manufacturer",
    "model", "specification", "notes",
  ];
  for (const field of optional) {
    if (payload[field] !== undefined) data[field] = trimOrNull(payload[field]);
  }

  const numbers = ["unitCost", "reorderLevel", "minStock", "maxStock"];
  for (const field of numbers) {
    if (payload[field] !== undefined) {
      const value = payload[field] === null ? null : Number(payload[field]);
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        throw new HttpError(400, "INV_NUMBER", `${field} must be zero or more`);
      }
      data[field] = value;
    }
  }
  if (payload.leadTimeDays !== undefined) {
    data.leadTimeDays = Math.max(0, Math.round(Number(payload.leadTimeDays) || 0));
  }
  if (payload.preferredSupplierId !== undefined) {
    data.preferredSupplierId = trimOrNull(payload.preferredSupplierId);
  }
  if (payload.projectId !== undefined) data.projectId = trimOrNull(payload.projectId);
  if (payload.isSerialised !== undefined) data.isSerialised = Boolean(payload.isSerialised);
  if (payload.isBatched !== undefined) data.isBatched = Boolean(payload.isBatched);
  if (payload.status !== undefined) {
    data.status = oneOf(payload.status, ITEM_STATUSES, "status", "active");
  }
  return data;
};

const createItem = async ({ orgId, user, payload }) => {
  const data = itemFields(payload);
  // A scanner needs something to resolve; default the QR token to the SKU so
  // an item is scannable the moment it exists.
  if (!data.qrCode) data.qrCode = data.sku;

  const clash = await prisma.inventoryItem.findFirst({
    where: { orgId, sku: data.sku },
    select: { id: true },
  });
  if (clash) throw new HttpError(409, "ITEM_SKU_TAKEN", `SKU "${data.sku}" is already in use`);

  const row = await prisma.inventoryItem.create({
    data: { orgId, ...data, createdBy: user.id, updatedBy: user.id },
    include: { balances: true, preferredSupplier: { select: { name: true } } },
  });
  return withStock(row);
};

const updateItem = async ({ orgId, user, itemId, payload }) => {
  const existing = await prisma.inventoryItem.findFirst({ where: { id: itemId, orgId } });
  if (!existing) throw new HttpError(404, "ITEM_NOT_FOUND", "Item not found");

  const data = itemFields(payload, existing);
  if (data.sku && data.sku !== existing.sku) {
    const clash = await prisma.inventoryItem.findFirst({
      where: { orgId, sku: data.sku, id: { not: itemId } },
      select: { id: true },
    });
    if (clash) throw new HttpError(409, "ITEM_SKU_TAKEN", `SKU "${data.sku}" is already in use`);
  }

  const row = await prisma.inventoryItem.update({
    where: { id: itemId },
    data: { ...data, updatedBy: user.id },
    include: { balances: true, preferredSupplier: { select: { name: true } } },
  });
  return withStock(row);
};

// ─── warehouses and their locations ────────────────────────────────────────

const serializeWarehouse = (row) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  kind: row.kind,
  projectId: row.projectId,
  address: row.address,
  managerId: row.managerId,
  manager: row.manager?.name ?? null,
  status: row.status,
  notes: row.notes,
  locationCount: row._count?.locations ?? undefined,
  createdAt: row.createdAt?.toISOString() ?? null,
});

const listWarehouses = async ({ orgId, projectId = null, status = "active" }) => {
  const rows = await prisma.warehouse.findMany({
    where: {
      orgId,
      ...(status ? { status } : {}),
      ...(projectId ? { OR: [{ projectId: null }, { projectId }] } : {}),
    },
    include: {
      manager: { select: { name: true } },
      _count: { select: { locations: true } },
    },
    orderBy: [{ name: "asc" }],
  });
  return { items: rows.map(serializeWarehouse) };
};

const createWarehouse = async ({ orgId, user, payload }) => {
  const code = requireText(payload.code, "Code", 30);
  const name = requireText(payload.name, "Name");
  const kind = oneOf(payload.kind, WAREHOUSE_KINDS, "kind", "project");

  const clash = await prisma.warehouse.findFirst({ where: { orgId, code }, select: { id: true } });
  if (clash) throw new HttpError(409, "WAREHOUSE_CODE_TAKEN", `Code "${code}" is already in use`);

  const row = await prisma.warehouse.create({
    data: {
      orgId,
      code,
      name,
      kind,
      projectId: trimOrNull(payload.projectId),
      address: trimOrNull(payload.address),
      managerId: trimOrNull(payload.managerId),
      notes: trimOrNull(payload.notes),
      createdBy: user.id,
      updatedBy: user.id,
    },
    include: { manager: { select: { name: true } } },
  });
  return serializeWarehouse(row);
};

const updateWarehouse = async ({ orgId, user, warehouseId, payload }) => {
  const existing = await prisma.warehouse.findFirst({ where: { id: warehouseId, orgId } });
  if (!existing) throw new HttpError(404, "WAREHOUSE_NOT_FOUND", "Warehouse not found");

  const data = { updatedBy: user.id };
  if (payload.name !== undefined) data.name = requireText(payload.name, "Name");
  if (payload.kind !== undefined) data.kind = oneOf(payload.kind, WAREHOUSE_KINDS, "kind", existing.kind);
  if (payload.address !== undefined) data.address = trimOrNull(payload.address);
  if (payload.managerId !== undefined) data.managerId = trimOrNull(payload.managerId);
  if (payload.notes !== undefined) data.notes = trimOrNull(payload.notes);
  if (payload.status !== undefined) {
    data.status = oneOf(payload.status, ["active", "archived"], "status", existing.status);
    data.archivedAt = data.status === "archived" ? new Date() : null;
  }

  const row = await prisma.warehouse.update({
    where: { id: warehouseId },
    data,
    include: { manager: { select: { name: true } } },
  });
  return serializeWarehouse(row);
};

const serializeLocation = (row) => ({
  id: row.id,
  warehouseId: row.warehouseId,
  parentId: row.parentId,
  code: row.code,
  name: row.name,
  kind: row.kind,
  path: row.path,
  depth: row.depth,
  status: row.status,
});

const listLocations = async ({ orgId, warehouseId }) => {
  const rows = await prisma.warehouseLocation.findMany({
    where: { orgId, warehouseId, status: "active" },
    orderBy: [{ path: "asc" }, { sortOrder: "asc" }],
  });
  return { items: rows.map(serializeLocation) };
};

/**
 * Adds a place inside a warehouse.
 *
 * The path is materialized on write so a whole branch reads in one query, and
 * the depth is taken from the parent rather than trusted from the caller.
 */
const createLocation = async ({ orgId, user, warehouseId, payload }) => {
  const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, orgId } });
  if (!warehouse) throw new HttpError(404, "WAREHOUSE_NOT_FOUND", "Warehouse not found");

  const code = requireText(payload.code, "Code", 40);
  const name = requireText(payload.name, "Name");
  const kind = oneOf(payload.kind, LOCATION_KINDS, "kind", "zone");
  const parentId = trimOrNull(payload.parentId);

  let parent = null;
  if (parentId) {
    parent = await prisma.warehouseLocation.findFirst({
      where: { id: parentId, warehouseId, orgId },
    });
    if (!parent) throw new HttpError(404, "LOCATION_NOT_FOUND", "Parent location not found");
  }

  const clash = await prisma.warehouseLocation.findFirst({
    where: { warehouseId, code },
    select: { id: true },
  });
  if (clash) throw new HttpError(409, "LOCATION_CODE_TAKEN", `Code "${code}" is already used in this warehouse`);

  const created = await prisma.warehouseLocation.create({
    data: {
      orgId,
      warehouseId,
      parentId,
      code,
      name,
      kind,
      path: "",
      depth: parent ? parent.depth + 1 : 0,
      sortOrder: Number(payload.sortOrder) || 0,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  const row = await prisma.warehouseLocation.update({
    where: { id: created.id },
    data: { path: parent ? `${parent.path}/${created.id}` : created.id },
  });
  return serializeLocation(row);
};

// ─── the ledger ────────────────────────────────────────────────────────────

/**
 * Posts one movement: writes the transaction and moves the balance with it.
 *
 * Always called inside a database transaction, so a balance is never updated
 * without the entry that explains it, and never the other way round.
 */
const postMovement = async (tx, { orgId, item, warehouseId, locationId = null, type, quantity, unitCost = null, user, context = {} }) => {
  const rule = MOVEMENTS[type];
  if (!rule) throw new HttpError(400, "INV_MOVEMENT", `Unknown movement ${type}`);

  const signed = SIGNED_TYPES.has(type) ? Number(quantity) : Math.abs(Number(quantity));
  if (!Number.isFinite(signed) || signed === 0) {
    throw new HttpError(400, "INV_QUANTITY", "Quantity must not be zero");
  }

  const balance =
    (await tx.stockBalance.findFirst({ where: { itemId: item.id, warehouseId, locationId } })) ??
    (await tx.stockBalance.create({
      data: { orgId, itemId: item.id, warehouseId, locationId },
    }));

  const delta = SIGNED_TYPES.has(type) ? signed : rule.onHand * signed;
  const nextOnHand = round(balance.onHand + delta);

  if (nextOnHand < 0) {
    throw new HttpError(
      409,
      "INV_INSUFFICIENT_STOCK",
      `Only ${round(balance.onHand)} ${item.unit} of ${item.name} on hand here; ${round(Math.abs(delta))} requested`
    );
  }

  // Reserved stock is spoken for. An issue may only draw on what is available,
  // which is what the item and balance reads have always *reported* — the guard
  // simply never enforced it.
  if (delta < 0 && RESPECTS_RESERVATION.has(type)) {
    const availableHere = availableOn(balance, type);
    if (round(Math.abs(delta)) > availableHere) {
      throw new HttpError(
        409,
        "INV_INSUFFICIENT_AVAILABLE",
        `${round(balance.onHand)} ${item.unit} of ${item.name} on hand here but ${round(balance.reserved ?? 0)} reserved; only ${availableHere} available and ${round(Math.abs(delta))} requested`
      );
    }
  }
  if (rule.quarantined === -1 && balance.quarantined < signed) {
    throw new HttpError(409, "INV_INSUFFICIENT_STOCK", "More is being released than is quarantined");
  }

  // Weighted average: a receipt blends its price in, everything else leaves at
  // the average it finds.
  let costForMovement = Number(item.averageCost ?? 0);
  if (rule.costs && unitCost != null) {
    const receiptCost = Number(unitCost);
    const totalQty = balance.onHand + signed;
    const blended =
      totalQty > 0
        ? (balance.onHand * Number(item.averageCost ?? 0) + signed * receiptCost) / totalQty
        : receiptCost;
    await tx.inventoryItem.update({
      where: { id: item.id },
      data: {
        averageCost: round(blended),
        lastPurchasePrice: round(receiptCost),
        unitCost: round(receiptCost),
      },
    });
    costForMovement = receiptCost;
  }

  await tx.stockBalance.update({
    where: { id: balance.id },
    data: {
      onHand: nextOnHand,
      inTransit: round(balance.inTransit + (rule.inTransit ?? 0) * signed),
      damaged: round(balance.damaged + (rule.damaged ?? 0) * signed),
      quarantined: round(balance.quarantined + (rule.quarantined ?? 0) * signed),
      lastMovedAt: new Date(),
    },
  });

  // An issue to an activity belongs to that activity's project, whether or not
  // the caller said so (OCTA-INV-PROJECT-068). Without this, `postConsumptionCost`
  // saw no project and posted nothing: stock left the warehouse, was consumed on
  // an activity, and no cost was recognised anywhere — silently.
  const projectId = context.projectId ?? (await projectOfActivity({ tx, activityId: context.activityId }));

  const movement = await tx.stockTransaction.create({
    data: {
      orgId,
      itemId: item.id,
      warehouseId,
      locationId,
      type,
      quantity: round(delta),
      unitCost: round(costForMovement),
      value: round(Math.abs(delta) * costForMovement, 2),
      balanceAfter: nextOnHand,
      projectId,
      activityId: context.activityId ?? null,
      costCodeId: context.costCodeId ?? null,
      boqItemId: context.boqItemId ?? null,
      locationRefId: context.locationRefId ?? null,
      commitmentId: context.commitmentId ?? null,
      poLineId: context.poLineId ?? null,
      receiptLineId: context.receiptLineId ?? null,
      transferId: context.transferId ?? null,
      countId: context.countId ?? null,
      batchNo: trimOrNull(context.batchNo),
      serialNo: trimOrNull(context.serialNo),
      expiryDate: context.expiryDate ? new Date(context.expiryDate) : null,
      reference: trimOrNull(context.reference),
      notes: trimOrNull(context.notes),
      performedBy: user.id,
      occurredAt: context.occurredAt ? new Date(context.occurredAt) : new Date(),
    },
  });

  await postConsumptionCost({ tx, orgId, item, movement });
  return movement;
};

/**
 * Consumption is the moment stock becomes project cost (OCTA-FIN-LEDGER-059).
 *
 * Receiving stock is an asset acquisition, not a project cost — so only `issue`
 * spends, and only `return` gives it back. Everything else (transfers, counts,
 * damage, quarantine, release) moves stock around inside the warehouse without
 * touching a project.
 *
 * The amount is the movement's own `value`, which `postMovement` computed from
 * the **weighted average** — never the latest purchase price. The cost ledger
 * and the stock ledger therefore reconcile line for line, because they are
 * reading the same number.
 *
 * The `StockTransaction` id is the idempotency key, so a movement can only ever
 * carry one cost posting.
 */
const CONSUMPTION_SIGN = Object.freeze({ issue: 1, return: -1 });

/**
 * The project an activity belongs to.
 *
 * A caller issuing to an activity has already said which project it is; making
 * them say it twice invites them to leave it out, and a movement with no
 * project posts no cost at all.
 */
const projectOfActivity = async ({ tx, activityId }) => {
  if (!activityId || !tx.activity?.findUnique) return null;
  const activity = await tx.activity.findUnique({
    where: { id: activityId },
    select: { projectId: true },
  });
  return activity?.projectId ?? null;
};

const postConsumptionCost = async ({ tx, orgId, item, movement }) => {
  const sign = CONSUMPTION_SIGN[movement.type];
  // Stock consumed off-project genuinely has nowhere to post — a movement
  // naming no activity and no project is warehouse housekeeping, not spend.
  // A movement that names an activity always has a project by now.
  if (!sign || !movement.projectId) return null;
  const value = Number(movement.value) || 0;
  if (!value) return null;

  return costLedger.post({
    tx,
    orgId,
    projectId: movement.projectId,
    sourceType: "material_issue",
    sourceId: movement.id,
    amount: sign * value,
    costType: "material",
    activityId: movement.activityId,
    costCodeId: movement.costCodeId,
    commitmentId: movement.commitmentId,
    quantity: movement.quantity,
    unitCost: movement.unitCost,
    incurredOn: movement.occurredAt,
    postedBy: movement.performedBy,
    note: `${item.sku} · ${item.name}`,
  });
};

/**
 * Takes stock out of a warehouse, spanning bins when it has to.
 *
 * Stock is held per bin, but nobody asks for "300 bags from bin B-A03-R06-S2-B04"
 * — they ask for 300 bags from the central store. Without a named location this
 * draws from the fullest bin down, posting one movement per bin touched so the
 * ledger still says exactly where each bag came from.
 */
const drawFromWarehouse = async (
  tx,
  { orgId, item, warehouseId, locationId, quantity, type, user, context }
) => {
  if (locationId) {
    const row = await postMovement(tx, {
      orgId,
      item,
      warehouseId,
      locationId,
      type,
      quantity,
      user,
      context,
    });
    return [row];
  }

  const balances = await tx.stockBalance.findMany({
    where: { itemId: item.id, warehouseId },
    orderBy: [{ onHand: "desc" }],
  });
  // Available, not on hand: reserved stock belongs to somebody else.
  const available = round(
    balances.reduce((sum, balance) => sum + availableOn(balance, type), 0)
  );

  if (available < quantity) {
    const onHand = round(balances.reduce((sum, balance) => sum + balance.onHand, 0));
    const reserved = round(balances.reduce((sum, balance) => sum + (balance.reserved ?? 0), 0));
    throw new HttpError(
      409,
      reserved > 0 ? "INV_INSUFFICIENT_AVAILABLE" : "INV_INSUFFICIENT_STOCK",
      reserved > 0
        ? `${onHand} ${item.unit} of ${item.name} on hand but ${reserved} reserved; only ${available} available and ${round(quantity)} requested`
        : `Only ${available} ${item.unit} of ${item.name} in this warehouse; ${round(quantity)} requested`
    );
  }

  const posted = [];
  let outstanding = quantity;
  for (const balance of balances) {
    if (outstanding <= 0) break;
    const takeable = availableOn(balance, type);
    if (takeable <= 0) continue;
    const take = round(Math.min(takeable, outstanding));
    posted.push(
      await postMovement(tx, {
        orgId,
        item,
        warehouseId,
        locationId: balance.locationId ?? null,
        type,
        quantity: take,
        user,
        context,
      })
    );
    outstanding = round(outstanding - take);
  }

  return posted;
};

const loadItemAndWarehouse = async (tx, { orgId, itemId, warehouseId, locationId }) => {
  const item = await tx.inventoryItem.findFirst({ where: { id: itemId, orgId } });
  if (!item) throw new HttpError(404, "ITEM_NOT_FOUND", "Item not found");

  const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId, orgId } });
  if (!warehouse) throw new HttpError(404, "WAREHOUSE_NOT_FOUND", "Warehouse not found");

  if (locationId) {
    const location = await tx.warehouseLocation.findFirst({
      where: { id: locationId, warehouseId, orgId },
    });
    if (!location) {
      throw new HttpError(404, "LOCATION_NOT_FOUND", "That location is not in this warehouse");
    }
  }
  return { item, warehouse };
};

const serializeTransaction = (row) => ({
  id: row.id,
  type: row.type,
  itemId: row.itemId,
  item: row.item ? { sku: row.item.sku, name: row.item.name, unit: row.item.unit } : undefined,
  warehouseId: row.warehouseId,
  warehouse: row.warehouse?.name ?? null,
  locationId: row.locationId,
  location: row.location?.code ?? null,
  quantity: row.quantity,
  unitCost: Number(row.unitCost ?? 0),
  value: Number(row.value ?? 0),
  balanceAfter: row.balanceAfter,
  projectId: row.projectId,
  activityId: row.activityId,
  costCodeId: row.costCodeId,
  boqItemId: row.boqItemId,
  batchNo: row.batchNo,
  serialNo: row.serialNo,
  reference: row.reference,
  notes: row.notes,
  performedBy: row.performedBy,
  occurredAt: row.occurredAt?.toISOString() ?? null,
});

/** Goods in. The one movement that changes what the stock is worth. */
const receiveStock = async ({ orgId, user, payload }) => {
  const quantity = positive(payload.quantity, "Quantity");
  const unitCost = payload.unitCost == null ? null : Number(payload.unitCost);
  if (unitCost != null && (!Number.isFinite(unitCost) || unitCost < 0)) {
    throw new HttpError(400, "INV_NUMBER", "Unit cost must be zero or more");
  }

  return prisma.$transaction(async (tx) => {
    const { item } = await loadItemAndWarehouse(tx, {
      orgId,
      itemId: payload.itemId,
      warehouseId: payload.warehouseId,
      locationId: payload.locationId ?? null,
    });

    const row = await postMovement(tx, {
      orgId,
      item,
      warehouseId: payload.warehouseId,
      locationId: payload.locationId ?? null,
      type: "receipt",
      quantity,
      unitCost,
      user,
      context: payload,
    });

    // Damaged goods are received and then written off in the same breath, so
    // the delivery note and the ledger agree on what actually turned up.
    if (payload.damagedQty) {
      const damaged = positive(payload.damagedQty, "Damaged quantity");
      await postMovement(tx, {
        orgId,
        item,
        warehouseId: payload.warehouseId,
        locationId: payload.locationId ?? null,
        type: "damage",
        quantity: damaged,
        user,
        context: { ...payload, notes: payload.damageNotes ?? "Damaged on delivery" },
      });
    }

    return serializeTransaction(row);
  });
};

/**
 * Goods out to site, against the thing that consumes them.
 *
 * The activity, cost code, BOQ item and work location are all optional but at
 * least one of activity or cost code is required: an issue with nowhere to land
 * is how material cost goes missing.
 */
const issueStock = async ({ orgId, user, payload }) => {
  const quantity = positive(payload.quantity, "Quantity");
  if (!payload.activityId && !payload.costCodeId) {
    throw new HttpError(
      400,
      "INV_NO_COST_TARGET",
      "Issue to an activity or a cost code, so the cost lands somewhere"
    );
  }
  // Note on the cost-code-only case: a cost code is held at company level and
  // does not say which project is spending, so such an issue posts no project
  // cost. That is deliberate — yard consumables against a company cost code are
  // real, and the cost ledger is project-scoped — but it means the caller has to
  // be told, which `issueStock` reports as `costPosted` rather than leaving the
  // cost silently absent (OCTA-INV-PROJECT-068).

  return prisma.$transaction(async (tx) => {
    const { item } = await loadItemAndWarehouse(tx, {
      orgId,
      itemId: payload.itemId,
      warehouseId: payload.warehouseId,
      locationId: payload.locationId ?? null,
    });
    const context = { ...payload, ...(await inheritedCoding(tx, { item, payload })) };
    const posted = await drawFromWarehouse(tx, {
      orgId,
      item,
      warehouseId: payload.warehouseId,
      locationId: payload.locationId ?? null,
      quantity,
      type: "issue",
      user,
      context,
    });
    // Whether this issue became project cost. An issue coded only to a company
    // cost code legitimately does not — and the caller should be told, rather
    // than left to notice the absence later.
    const costPosted = posted.some((movement) => movement.projectId);
    return {
      movements: posted.map(serializeTransaction),
      costPosted,
      ...(costPosted
        ? {}
        : {
            costNote:
              "Issued against a company cost code with no project, so no project cost was posted",
          }),
    };
  });
};

/**
 * What this material was bought against, when whoever issued it did not say
 * (OCTA-FIN-POLINE-060).
 *
 * A storeman issuing cement knows the activity; the cost code was decided on
 * the purchase order weeks earlier, and asking for it again is how the two end
 * up disagreeing. So an issue inherits the coding from the most recent receipt
 * of the same item, which carries the buyer's coding. Anything stated
 * explicitly always wins — inheritance fills silence, it never overrides.
 */
const inheritedCoding = async (tx, { item, payload }) => {
  if (payload.costCodeId && payload.boqItemId) return {};
  const lastReceipt = await tx.stockTransaction.findFirst({
    where: {
      itemId: item.id,
      type: "receipt",
      OR: [{ costCodeId: { not: null } }, { boqItemId: { not: null } }],
    },
    orderBy: { occurredAt: "desc" },
    select: { costCodeId: true, boqItemId: true },
  });
  if (!lastReceipt) return {};
  return {
    ...(payload.costCodeId ? {} : { costCodeId: lastReceipt.costCodeId ?? null }),
    ...(payload.boqItemId ? {} : { boqItemId: lastReceipt.boqItemId ?? null }),
  };
};

/**
 * Reserves stock, or gives it back.
 *
 * `reserved` existed on the balance and was reported as `available = onHand −
 * reserved`, but nothing could ever write it and the issue guard checked on
 * hand alone — so the figure on screen was always just on hand, and a
 * reservation could not have held anything back even if one had existed.
 *
 * A reservation is a claim on stock, not a movement of it: on hand does not
 * change, so this writes no `StockTransaction` and no cost. It cannot exceed
 * what is on hand, and it cannot go below zero.
 */
const adjustReservation = async ({ orgId, user, payload }) => {
  const quantity = Number(payload.quantity);
  if (!Number.isFinite(quantity) || quantity === 0) {
    throw new HttpError(400, "INV_QUANTITY", "Quantity must not be zero");
  }

  return prisma.$transaction(async (tx) => {
    const { item } = await loadItemAndWarehouse(tx, {
      orgId,
      itemId: payload.itemId,
      warehouseId: payload.warehouseId,
      locationId: payload.locationId ?? null,
    });

    // Stock is held per bin, but nobody reserves "30 bags from bin B-A03" —
    // they reserve 30 bags from the store. Without a named location this
    // spreads the claim across bins the same way an issue draws from them,
    // fullest first, so a warehouse-level reservation actually holds warehouse
    // stock rather than a phantom balance with nothing in it.
    const balances = payload.locationId
      ? await tx.stockBalance.findMany({
          where: { itemId: item.id, warehouseId: payload.warehouseId, locationId: payload.locationId },
        })
      : await tx.stockBalance.findMany({
          where: { itemId: item.id, warehouseId: payload.warehouseId },
          orderBy: [{ onHand: "desc" }],
        });

    if (!balances.length) {
      throw new HttpError(
        409,
        "INV_NO_STOCK_HERE",
        `No ${item.name} is held ${payload.locationId ? "in that location" : "in this warehouse"}`
      );
    }

    const onHand = round(balances.reduce((sum, b) => sum + b.onHand, 0));
    const reserved = round(balances.reduce((sum, b) => sum + (b.reserved ?? 0), 0));

    if (quantity > 0) {
      const spare = round(onHand - reserved);
      if (quantity > spare) {
        throw new HttpError(
          409,
          "INV_RESERVATION_OVER_STOCK",
          `${onHand} ${item.unit} of ${item.name} on hand${reserved ? ` with ${reserved} already reserved` : ""}; only ${spare} can be reserved and ${round(quantity)} was asked for`
        );
      }
    } else if (Math.abs(quantity) > reserved) {
      throw new HttpError(
        409,
        "INV_RESERVATION_NEGATIVE",
        `Only ${reserved} ${item.unit} reserved here; ${round(Math.abs(quantity))} cannot be released`
      );
    }

    // Reserve against the fullest bins first; release from the most heavily
    // reserved first, so releasing never strands a claim on an empty bin.
    const order = quantity > 0 ? balances : [...balances].sort((a, b) => (b.reserved ?? 0) - (a.reserved ?? 0));
    let outstanding = Math.abs(quantity);
    for (const balance of order) {
      if (outstanding <= 0) break;
      const room =
        quantity > 0
          ? Math.max(0, round(balance.onHand - (balance.reserved ?? 0)))
          : round(balance.reserved ?? 0);
      if (room <= 0) continue;
      const step = round(Math.min(room, outstanding));
      await tx.stockBalance.update({
        where: { id: balance.id },
        data: { reserved: round((balance.reserved ?? 0) + (quantity > 0 ? step : -step)) },
      });
      outstanding = round(outstanding - step);
    }

    const after = await tx.stockBalance.findMany({
      where: payload.locationId
        ? { itemId: item.id, warehouseId: payload.warehouseId, locationId: payload.locationId }
        : { itemId: item.id, warehouseId: payload.warehouseId },
    });
    const nextOnHand = round(after.reduce((sum, b) => sum + b.onHand, 0));
    const nextReserved = round(after.reduce((sum, b) => sum + (b.reserved ?? 0), 0));

    return {
      itemId: item.id,
      warehouseId: payload.warehouseId,
      locationId: payload.locationId ?? null,
      onHand: nextOnHand,
      reserved: nextReserved,
      available: round(nextOnHand - nextReserved),
      reservedBy: user?.id ?? null,
    };
  });
};

/** Anything else that moves stock without money changing hands. */
const adjustStock = async ({ orgId, user, payload, type }) => {
  const allowed = ["return", "adjust", "damage", "quarantine", "release"];
  if (!allowed.includes(type)) {
    throw new HttpError(400, "INV_MOVEMENT", `Unknown movement ${type}`);
  }
  if (type === "adjust" && !trimOrNull(payload.notes)) {
    // An unexplained adjustment is the thing an auditor asks about first.
    throw new HttpError(400, "INV_ADJUST_REASON", "Say why the stock is being adjusted");
  }

  const quantity = type === "adjust" ? Number(payload.quantity) : positive(payload.quantity, "Quantity");
  if (!Number.isFinite(quantity) || quantity === 0) {
    throw new HttpError(400, "INV_QUANTITY", "Quantity must not be zero");
  }

  return prisma.$transaction(async (tx) => {
    const { item } = await loadItemAndWarehouse(tx, {
      orgId,
      itemId: payload.itemId,
      warehouseId: payload.warehouseId,
      locationId: payload.locationId ?? null,
    });

    // Movements that take stock out have to find it wherever it is; the ones
    // that put stock in land where they are told, or at the warehouse root.
    const takesStock = ["damage", "quarantine"].includes(type);
    const posted = takesStock
      ? await drawFromWarehouse(tx, {
          orgId,
          item,
          warehouseId: payload.warehouseId,
          locationId: payload.locationId ?? null,
          quantity,
          type,
          user,
          context: payload,
        })
      : [
          await postMovement(tx, {
            orgId,
            item,
            warehouseId: payload.warehouseId,
            locationId: payload.locationId ?? null,
            type,
            quantity,
            user,
            context: payload,
          }),
        ];
    return { movements: posted.map(serializeTransaction) };
  });
};

const listTransactions = async ({ orgId, itemId = null, warehouseId = null, projectId = null, activityId = null, type = null, limit = 100 }) => {
  const rows = await prisma.stockTransaction.findMany({
    where: {
      orgId,
      ...(itemId ? { itemId } : {}),
      ...(warehouseId ? { warehouseId } : {}),
      ...(projectId ? { projectId } : {}),
      ...(activityId ? { activityId } : {}),
      ...(type ? { type } : {}),
    },
    include: {
      item: { select: { sku: true, name: true, unit: true } },
      warehouse: { select: { name: true } },
      location: { select: { code: true } },
    },
    orderBy: [{ occurredAt: "desc" }],
    take: Math.min(500, Math.max(1, Number(limit) || 100)),
  });
  return { items: rows.map(serializeTransaction) };
};

// ─── transfers between warehouses ──────────────────────────────────────────

const serializeTransfer = (row) => ({
  id: row.id,
  ref: row.ref,
  status: row.status,
  fromWarehouseId: row.fromWarehouseId,
  fromWarehouse: row.fromWarehouse?.name ?? null,
  toWarehouseId: row.toWarehouseId,
  toWarehouse: row.toWarehouse?.name ?? null,
  reason: row.reason,
  notes: row.notes,
  dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
  receivedAt: row.receivedAt?.toISOString() ?? null,
  lines: (row.lines ?? []).map((line) => ({
    id: line.id,
    itemId: line.itemId,
    sku: line.item?.sku ?? null,
    name: line.item?.name ?? null,
    unit: line.item?.unit ?? null,
    quantity: line.quantity,
    receivedQty: line.receivedQty,
    damagedQty: line.damagedQty,
  })),
  createdAt: row.createdAt?.toISOString() ?? null,
});

const transferInclude = {
  fromWarehouse: { select: { name: true } },
  toWarehouse: { select: { name: true } },
  lines: { include: { item: { select: { sku: true, name: true, unit: true } } } },
};

const nextRef = async (model, orgId, prefix) => {
  const count = await prisma[model].count({ where: { orgId } });
  return `${prefix}-${String(count + 1).padStart(5, "0")}`;
};

const createTransfer = async ({ orgId, user, payload }) => {
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (!lines.length) throw new HttpError(400, "TRANSFER_EMPTY", "Add at least one item to transfer");
  if (payload.fromWarehouseId === payload.toWarehouseId) {
    throw new HttpError(400, "TRANSFER_SAME_WAREHOUSE", "Choose two different warehouses");
  }

  const [from, to] = await Promise.all([
    prisma.warehouse.findFirst({ where: { id: payload.fromWarehouseId, orgId } }),
    prisma.warehouse.findFirst({ where: { id: payload.toWarehouseId, orgId } }),
  ]);
  if (!from || !to) throw new HttpError(404, "WAREHOUSE_NOT_FOUND", "Warehouse not found");

  const ref = trimOrNull(payload.ref) || (await nextRef("stockTransfer", orgId, "TRF"));
  const row = await prisma.stockTransfer.create({
    data: {
      orgId,
      ref,
      fromWarehouseId: from.id,
      toWarehouseId: to.id,
      reason: trimOrNull(payload.reason),
      notes: trimOrNull(payload.notes),
      createdBy: user.id,
      updatedBy: user.id,
      lines: {
        create: lines.map((line) => ({
          orgId,
          itemId: requireText(line.itemId, "Item"),
          quantity: positive(line.quantity, "Quantity"),
          batchNo: trimOrNull(line.batchNo),
          serialNo: trimOrNull(line.serialNo),
          notes: trimOrNull(line.notes),
        })),
      },
    },
    include: transferInclude,
  });
  return serializeTransfer(row);
};

/** Stock leaves the source and is in transit until someone receives it. */
const dispatchTransfer = async ({ orgId, user, transferId }) => {
  return prisma.$transaction(async (tx) => {
    const transfer = await tx.stockTransfer.findFirst({
      where: { id: transferId, orgId },
      include: { lines: true },
    });
    if (!transfer) throw new HttpError(404, "TRANSFER_NOT_FOUND", "Transfer not found");
    if (transfer.status !== "draft") {
      throw new HttpError(409, "TRANSFER_STATE", `A ${transfer.status} transfer cannot be dispatched`);
    }

    for (const line of transfer.lines) {
      const item = await tx.inventoryItem.findFirst({ where: { id: line.itemId, orgId } });
      if (!item) throw new HttpError(404, "ITEM_NOT_FOUND", "Item not found");
      // Across bins if it has to be: a transfer names a warehouse, not a shelf.
      await drawFromWarehouse(tx, {
        orgId,
        item,
        warehouseId: transfer.fromWarehouseId,
        locationId: null,
        quantity: line.quantity,
        type: "transfer_out",
        user,
        context: { transferId: transfer.id, reference: transfer.ref, batchNo: line.batchNo, serialNo: line.serialNo },
      });
    }

    const row = await tx.stockTransfer.update({
      where: { id: transfer.id },
      data: { status: "in_transit", dispatchedAt: new Date(), dispatchedBy: user.id, updatedBy: user.id },
      include: transferInclude,
    });
    return serializeTransfer(row);
  });
};

/** Stock lands. What arrived damaged is written off at the destination. */
const receiveTransfer = async ({ orgId, user, transferId, payload = {} }) => {
  const received = new Map(
    (Array.isArray(payload.lines) ? payload.lines : []).map((line) => [line.id, line])
  );

  return prisma.$transaction(async (tx) => {
    const transfer = await tx.stockTransfer.findFirst({
      where: { id: transferId, orgId },
      include: { lines: true },
    });
    if (!transfer) throw new HttpError(404, "TRANSFER_NOT_FOUND", "Transfer not found");
    if (transfer.status !== "in_transit") {
      throw new HttpError(409, "TRANSFER_STATE", `A ${transfer.status} transfer cannot be received`);
    }

    for (const line of transfer.lines) {
      const reported = received.get(line.id) ?? {};
      const damagedQty = Math.max(0, Number(reported.damagedQty) || 0);
      const receivedQty =
        reported.receivedQty === undefined ? line.quantity : Math.max(0, Number(reported.receivedQty) || 0);
      if (receivedQty + damagedQty > line.quantity) {
        throw new HttpError(400, "TRANSFER_OVER_RECEIPT", "More reported than was sent");
      }

      const item = await tx.inventoryItem.findFirst({ where: { id: line.itemId, orgId } });
      if (!item) throw new HttpError(404, "ITEM_NOT_FOUND", "Item not found");

      if (receivedQty > 0) {
        await postMovement(tx, {
          orgId,
          item,
          warehouseId: transfer.toWarehouseId,
          type: "transfer_in",
          quantity: receivedQty,
          user,
          context: { transferId: transfer.id, reference: transfer.ref },
        });
      }
      if (damagedQty > 0) {
        await postMovement(tx, {
          orgId,
          item,
          warehouseId: transfer.toWarehouseId,
          type: "transfer_in",
          quantity: damagedQty,
          user,
          context: { transferId: transfer.id, reference: transfer.ref },
        });
        await postMovement(tx, {
          orgId,
          item,
          warehouseId: transfer.toWarehouseId,
          type: "damage",
          quantity: damagedQty,
          user,
          context: { transferId: transfer.id, reference: transfer.ref, notes: "Damaged in transit" },
        });
      }

      // The source stops counting it as in transit once it has landed. It may
      // have left from several bins, so clear it wherever it was raised.
      const sourceBalances = await tx.stockBalance.findMany({
        where: { itemId: line.itemId, warehouseId: transfer.fromWarehouseId },
      });
      let toClear = line.quantity;
      for (const balance of sourceBalances) {
        if (toClear <= 0) break;
        if (balance.inTransit <= 0) continue;
        const cleared = Math.min(balance.inTransit, toClear);
        await tx.stockBalance.update({
          where: { id: balance.id },
          data: { inTransit: round(balance.inTransit - cleared) },
        });
        toClear = round(toClear - cleared);
      }

      await tx.stockTransferLine.update({
        where: { id: line.id },
        data: { receivedQty, damagedQty },
      });
    }

    const row = await tx.stockTransfer.update({
      where: { id: transfer.id },
      data: { status: "received", receivedAt: new Date(), receivedBy: user.id, updatedBy: user.id },
      include: transferInclude,
    });
    return serializeTransfer(row);
  });
};

const listTransfers = async ({ orgId, status = null }) => {
  const rows = await prisma.stockTransfer.findMany({
    where: { orgId, ...(status ? { status } : {}) },
    include: transferInclude,
    orderBy: [{ createdAt: "desc" }],
    take: 200,
  });
  return { items: rows.map(serializeTransfer) };
};

// ─── analytics ─────────────────────────────────────────────────────────────

/**
 * The figures the warehouse dashboard opens on.
 *
 * Value is on-hand at weighted average — the same basis the ledger posts at,
 * so the dashboard and a stock report cannot disagree.
 */
const getSummary = async ({ orgId, projectId = null }) => {
  const [items, warehouses, recent] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: {
        orgId,
        status: "active",
        ...(projectId ? { OR: [{ projectId: null }, { projectId }] } : {}),
      },
      include: { balances: true },
    }),
    prisma.warehouse.findMany({
      where: { orgId, status: "active" },
      include: { balances: { include: { item: { select: { averageCost: true } } } } },
    }),
    prisma.stockTransaction.findMany({
      where: { orgId, ...(projectId ? { projectId } : {}) },
      orderBy: [{ occurredAt: "desc" }],
      take: 250,
      select: { type: true, value: true, quantity: true, itemId: true, occurredAt: true },
    }),
  ]);

  const enriched = items.map(withStock);
  const totalValue = round(enriched.reduce((sum, item) => sum + item.value, 0), 2);
  const moved = new Set(recent.map((row) => row.itemId));

  return {
    totalValue,
    itemCount: enriched.length,
    lowStock: enriched.filter((item) => item.belowReorder && item.onHand > 0).length,
    outOfStock: enriched.filter((item) => item.onHand <= 0).length,
    overstock: enriched.filter((item) => item.maxStock != null && item.onHand > item.maxStock).length,
    // Nothing has moved it in the last 250 movements: worth a look before it
    // is written off as shrinkage at the next count.
    slowMoving: enriched.filter((item) => item.onHand > 0 && !moved.has(item.id)).length,
    damaged: round(enriched.reduce((sum, item) => sum + item.damaged, 0)),
    quarantined: round(enriched.reduce((sum, item) => sum + item.quarantined, 0)),
    byWarehouse: warehouses.map((warehouse) => ({
      id: warehouse.id,
      name: warehouse.name,
      kind: warehouse.kind,
      value: round(
        warehouse.balances.reduce(
          (sum, balance) => sum + balance.onHand * Number(balance.item?.averageCost ?? 0),
          0
        ),
        2
      ),
      lines: warehouse.balances.filter((balance) => balance.onHand > 0).length,
    })),
    issuedValue: round(
      recent.filter((row) => row.type === "issue").reduce((sum, row) => sum + Number(row.value), 0),
      2
    ),
    receivedValue: round(
      recent.filter((row) => row.type === "receipt").reduce((sum, row) => sum + Number(row.value), 0),
      2
    ),
  };
};

module.exports = {
  ITEM_STATUSES,
  LOCATION_KINDS,
  MOVEMENTS,
  TRANSFER_STATUSES,
  COUNT_STATUSES,
  WAREHOUSE_KINDS,
  adjustStock,
  createItem,
  createLocation,
  createTransfer,
  createWarehouse,
  dispatchTransfer,
  findByCode,
  getItem,
  getSummary,
  adjustReservation,
  issueStock,
  listItems,
  listLocations,
  listTransactions,
  listTransfers,
  listWarehouses,
  postMovement,
  receiveStock,
  receiveTransfer,
  updateItem,
  updateWarehouse,
};
