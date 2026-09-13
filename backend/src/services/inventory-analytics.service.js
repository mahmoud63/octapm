const { prisma } = require("../config/db");

/**
 * Inventory analytics (OCTA-INV-STOCK-050).
 *
 * Thirteen questions a store has to be able to answer: what is it worth, where
 * is it, what is about to run out, what has not moved, what went to which
 * activity, what was damaged, what was ordered against what turned up against
 * what was used, what is the supplier charging now compared with before, and
 * what does the programme need next.
 *
 * Every list here names the rows behind the number. A count you cannot drill
 * into is a number nobody acts on: "7 items below reorder" is a statistic,
 * "these 7, short by this much, and this many days to get them" is a purchase
 * order.
 *
 * Value is on-hand at weighted average — the same basis the ledger posts at, so
 * the dashboard and a stock report cannot disagree.
 */

const round = (value, dp = 4) => {
  const factor = 10 ** dp;
  return Math.round((Number(value) || 0) * factor) / factor;
};

const money = (value) => round(value, 2);
const num = (value) => Number(value ?? 0);

/** How many items each list carries. Enough to act on, not a data dump. */
const LIST_LIMIT = 25;
/** Movements read for the price history. */
const PRICE_HISTORY_LIMIT = 2000;
/** A price move smaller than this is noise, not a trend. */
const PRICE_TREND_TOLERANCE = 0.005;

const DAY = 24 * 60 * 60 * 1000;

const daysBetween = (from, to) =>
  from && to ? Math.floor((to.getTime() - from.getTime()) / DAY) : null;

const byValueDesc = (a, b) => b.value - a.value;

const stockOf = (item) => {
  const balances = item.balances ?? [];
  const onHand = round(balances.reduce((sum, b) => sum + b.onHand, 0));
  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    unit: item.unit,
    category: item.category,
    onHand,
    reserved: round(balances.reduce((sum, b) => sum + b.reserved, 0)),
    damaged: round(balances.reduce((sum, b) => sum + b.damaged, 0)),
    quarantined: round(balances.reduce((sum, b) => sum + b.quarantined, 0)),
    averageCost: money(item.averageCost),
    value: money(onHand * num(item.averageCost)),
    reorderLevel: num(item.reorderLevel),
    minStock: num(item.minStock),
    maxStock: item.maxStock == null ? null : num(item.maxStock),
    leadTimeDays: num(item.leadTimeDays),
  };
};

// ─── the sections ──────────────────────────────────────────────────────────

/**
 * What is about to run out, and how long it takes to replace.
 *
 * The lead time is the point. "Below reorder" without it is an alarm with no
 * instruction attached.
 */
const shortages = (items) => {
  const low = [];
  const out = [];
  for (const item of items) {
    if (item.onHand <= 0) {
      out.push({ ...item, shortfall: round(Math.max(item.reorderLevel, item.minStock)) });
      continue;
    }
    if (item.reorderLevel > 0 && item.onHand <= item.reorderLevel) {
      low.push({ ...item, shortfall: round(item.reorderLevel - item.onHand) });
    }
  }
  return {
    lowStock: low.sort((a, b) => b.shortfall - a.shortfall).slice(0, LIST_LIMIT),
    outOfStock: out.sort((a, b) => b.leadTimeDays - a.leadTimeDays).slice(0, LIST_LIMIT),
  };
};

/** Money sitting on a shelf above the maximum anybody agreed to hold. */
const overstock = (items) =>
  items
    .filter((item) => item.maxStock != null && item.onHand > item.maxStock)
    .map((item) => ({
      ...item,
      excess: round(item.onHand - item.maxStock),
      excessValue: money((item.onHand - item.maxStock) * item.averageCost),
    }))
    .sort((a, b) => b.excessValue - a.excessValue)
    .slice(0, LIST_LIMIT);

/**
 * Stock that has not moved.
 *
 * Dated from the last movement rather than "not in the recent ledger", because
 * the number a storeman argues with is "nothing since March", not "not in the
 * last 250 rows".
 */
const slowMoving = (items, lastMovedById, now) =>
  items
    .filter((item) => item.onHand > 0)
    .map((item) => {
      const lastMovedAt = lastMovedById.get(item.id) ?? null;
      return {
        ...item,
        lastMovedAt: lastMovedAt ? lastMovedAt.toISOString() : null,
        daysIdle: lastMovedAt ? daysBetween(lastMovedAt, now) : null,
      };
    })
    // Never moved at all sorts first: it is the worst case, not the unknown one.
    .filter((item) => item.daysIdle === null || item.daysIdle >= 30)
    .sort((a, b) => (b.daysIdle ?? Infinity) - (a.daysIdle ?? Infinity))
    .slice(0, LIST_LIMIT);

/** What is damaged or held back, and what that is worth. */
const damagedReport = (items) =>
  items
    .filter((item) => item.damaged > 0 || item.quarantined > 0)
    .map((item) => ({
      ...item,
      damagedValue: money(item.damaged * item.averageCost),
      quarantinedValue: money(item.quarantined * item.averageCost),
    }))
    .sort((a, b) => b.damagedValue + b.quarantinedValue - (a.damagedValue + a.quarantinedValue))
    .slice(0, LIST_LIMIT);

/**
 * Ordered against received against used, per item.
 *
 * The three columns rarely agree, and each disagreement means something
 * different: ordered above received is still on its way (or never coming);
 * received above issued is sitting in the store; issued above received means
 * stock came from somewhere this order does not explain.
 */
const buildVariance = (items, orderedRows, issuedByItem) => {
  const orderedById = new Map(orderedRows.map((row) => [row.inventoryItemId, row]));
  const ids = new Set([...orderedById.keys(), ...issuedByItem.keys()]);

  return [...ids]
    .map((itemId) => {
      const item = items.find((candidate) => candidate.id === itemId);
      if (!item) return null;
      const ordered = round(num(orderedById.get(itemId)?._sum?.orderedQty));
      const received = round(num(orderedById.get(itemId)?._sum?.receivedQty));
      const rejected = round(num(orderedById.get(itemId)?._sum?.rejectedQty));
      const issued = round(issuedByItem.get(itemId) ?? 0);
      return {
        itemId,
        sku: item.sku,
        name: item.name,
        unit: item.unit,
        ordered,
        received,
        rejected,
        issued,
        onHand: item.onHand,
        outstanding: round(Math.max(0, ordered - received - rejected)),
        // Positive: more went out to site than this order brought in.
        issuedOverReceived: round(issued - received),
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.issuedOverReceived) - Math.abs(a.issuedOverReceived))
    .slice(0, LIST_LIMIT);
};

/**
 * What the supplier is charging now against what they charged before.
 *
 * Built from receipt movements, so it is the price actually paid on a delivery
 * rather than the price on an order nobody honoured.
 */
const priceTrend = (items, receipts) => {
  const byItem = new Map();
  for (const row of receipts) {
    const bucket = byItem.get(row.itemId) ?? [];
    bucket.push({
      at: row.occurredAt ? row.occurredAt.toISOString() : null,
      unitCost: money(row.unitCost),
      quantity: round(row.quantity),
    });
    byItem.set(row.itemId, bucket);
  }

  return [...byItem.entries()]
    .map(([itemId, points]) => {
      const item = items.find((candidate) => candidate.id === itemId);
      // One delivery is a price, not a trend.
      if (!item || points.length < 2) return null;
      const first = points[0].unitCost;
      const last = points[points.length - 1].unitCost;
      const changePct = first > 0 ? round(((last - first) / first) * 100, 2) : 0;
      return {
        itemId,
        sku: item.sku,
        name: item.name,
        unit: item.unit,
        deliveries: points.length,
        first,
        last,
        change: money(last - first),
        changePct,
        rising: first > 0 && (last - first) / first > PRICE_TREND_TOLERANCE,
        points: points.slice(-12),
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, LIST_LIMIT);
};

// ─── the whole dashboard ───────────────────────────────────────────────────

const getAnalytics = async ({ orgId, projectId = null, projectIds = null }) => {
  const now = new Date();
  // One project when asked for one; the caller's allowed projects (an API
  // key's list) when not (Phase 21D, CX21-430).
  const projectScope = projectId ? { projectId } : projectIds?.length ? { projectId: { in: projectIds } } : {};

  const [
    itemRows,
    warehouses,
    lastMovedRows,
    usageRows,
    issuedRows,
    orderedRows,
    receiptRows,
    plannedMaterials,
  ] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: {
        orgId,
        status: "active",
        ...(projectId ? { OR: [{ projectId: null }, { projectId }] } : projectIds?.length ? { OR: [{ projectId: null }, { projectId: { in: projectIds } }] } : {}),
      },
      include: { balances: true },
    }),
    prisma.warehouse.findMany({
      where: { orgId, status: "active" },
      include: { balances: { include: { item: { select: { averageCost: true } } } } },
    }),
    prisma.stockTransaction.groupBy({
      by: ["itemId"],
      where: { orgId, ...projectScope },
      _max: { occurredAt: true },
    }),
    // What went to site, by the activity that took it. This is both "material
    // usage by activity" and "cost by activity" — one movement answers both.
    prisma.stockTransaction.groupBy({
      by: ["projectId", "activityId"],
      where: { orgId, type: "issue", activityId: { not: null }, ...projectScope },
      _sum: { quantity: true, value: true },
    }),
    prisma.stockTransaction.groupBy({
      by: ["itemId"],
      where: { orgId, type: "issue", ...projectScope },
      _sum: { quantity: true },
    }),
    prisma.procurementPoLine.groupBy({
      by: ["inventoryItemId"],
      where: {
        inventoryItemId: { not: null },
        project: { orgId },
        ...projectScope,
        status: { notIn: ["cancelled", "draft"] },
      },
      _sum: { orderedQty: true, receivedQty: true, rejectedQty: true },
    }),
    prisma.stockTransaction.findMany({
      where: { orgId, type: "receipt", ...projectScope },
      orderBy: [{ occurredAt: "asc" }],
      take: PRICE_HISTORY_LIMIT,
      select: { itemId: true, unitCost: true, quantity: true, occurredAt: true },
    }),
    // The programme's own material plan: what each activity needs and when it
    // has to be ordered to arrive in time.
    prisma.activityMaterial.findMany({
      where: {
        project: { orgId },
        ...projectScope,
        status: { notIn: ["cancelled", "consumed"] },
      },
      include: {
        activity: { select: { id: true, activityCode: true, name: true, startDate: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: [{ requiredDate: "asc" }],
      take: 400,
    }),
  ]);

  const items = itemRows.map(stockOf);
  const itemsBySku = new Map(items.map((item) => [item.sku, item]));
  const itemsByName = new Map(items.map((item) => [item.name.toLowerCase(), item]));

  const lastMovedById = new Map(
    lastMovedRows.map((row) => [row.itemId, row._max?.occurredAt ?? null])
  );
  // Issues are stored signed, so an issue of 12 is -12. Report what went out.
  const issuedByItem = new Map(
    issuedRows.map((row) => [row.itemId, Math.abs(num(row._sum?.quantity))])
  );

  const activityIds = usageRows.map((row) => row.activityId).filter(Boolean);
  const usageProjectIds = [...new Set(usageRows.map((row) => row.projectId).filter(Boolean))];
  const [activities, usageProjects] = await Promise.all([
    activityIds.length
      ? prisma.activity.findMany({
          where: { id: { in: activityIds } },
          select: { id: true, activityCode: true, name: true },
        })
      : [],
    usageProjectIds.length
      ? prisma.project.findMany({
          where: { id: { in: usageProjectIds } },
          select: { id: true, name: true },
        })
      : [],
  ]);
  const activityById = new Map(activities.map((row) => [row.id, row]));
  const projectById = new Map(usageProjects.map((row) => [row.id, row]));

  const totalValue = money(items.reduce((sum, item) => sum + item.value, 0));
  const { lowStock, outOfStock } = shortages(items);
  const overstocked = overstock(items);

  const byWarehouse = warehouses
    .map((warehouse) => ({
      id: warehouse.id,
      name: warehouse.name,
      kind: warehouse.kind,
      value: money(
        warehouse.balances.reduce(
          (sum, balance) => sum + balance.onHand * num(balance.item?.averageCost),
          0
        )
      ),
      lines: warehouse.balances.filter((balance) => balance.onHand > 0).length,
    }))
    .map((warehouse) => ({
      ...warehouse,
      share: totalValue > 0 ? round((warehouse.value / totalValue) * 100, 1) : 0,
    }))
    .sort(byValueDesc);

  const usageByActivity = usageRows
    .map((row) => {
      const activity = activityById.get(row.activityId);
      return {
        projectId: row.projectId,
        project: projectById.get(row.projectId)?.name ?? null,
        activityId: row.activityId,
        activityRef: activity?.activityCode ?? null,
        activity: activity?.name ?? null,
        quantity: round(Math.abs(num(row._sum?.quantity))),
        value: money(num(row._sum?.value)),
      };
    })
    .sort(byValueDesc)
    .slice(0, LIST_LIMIT);

  /**
   * What the programme needs next, against what is on the shelf.
   *
   * The material plan names materials in its own words, so it is matched to a
   * stocked item by code first and by name second. An unmatched line is still
   * reported — "we need 200 of something we do not stock" is exactly the thing
   * worth seeing before the activity starts.
   */
  const upcomingNeeds = [];
  const longLead = [];
  for (const planned of plannedMaterials) {
    const stocked =
      (planned.code ? itemsBySku.get(planned.code) : null) ??
      itemsByName.get(planned.name.toLowerCase()) ??
      null;
    const required = round(planned.qty || planned.plannedQty);
    const stillNeeded = round(Math.max(0, required - num(planned.receivedQty)));
    const row = {
      id: planned.id,
      projectId: planned.projectId,
      project: planned.project?.name ?? null,
      activityId: planned.activityId,
      activityRef: planned.activity?.activityCode ?? null,
      activity: planned.activity?.name ?? null,
      name: planned.name,
      code: planned.code,
      unit: planned.unit,
      required,
      received: round(planned.receivedQty),
      stillNeeded,
      onHand: stocked?.onHand ?? null,
      itemId: stocked?.id ?? null,
      shortfall: stocked ? round(Math.max(0, stillNeeded - stocked.onHand)) : stillNeeded,
      requiredDate: planned.requiredDate?.toISOString() ?? null,
      orderByDate: planned.orderByDate?.toISOString() ?? null,
      leadWeeks: planned.leadWeeks,
      status: planned.status,
      daysUntilRequired: planned.requiredDate ? daysBetween(now, planned.requiredDate) : null,
    };

    // Long lead is about the calendar, not the shelf: eight weeks or more to
    // get it, and it has not all arrived.
    if (planned.leadWeeks >= 8 && stillNeeded > 0) longLead.push(row);
    if (stillNeeded > 0) upcomingNeeds.push(row);
  }

  return {
    generatedAt: now.toISOString(),
    headline: {
      totalValue,
      itemCount: items.length,
      lowStock: lowStock.length,
      outOfStock: outOfStock.length,
      overstock: overstocked.length,
      damagedValue: money(items.reduce((sum, item) => sum + item.damaged * item.averageCost, 0)),
      quarantinedValue: money(
        items.reduce((sum, item) => sum + item.quarantined * item.averageCost, 0)
      ),
      issuedValue: money(usageRows.reduce((sum, row) => sum + num(row._sum?.value), 0)),
      warehouseCount: byWarehouse.length,
    },
    byWarehouse,
    lowStock,
    outOfStock,
    overstock: overstocked,
    slowMoving: slowMoving(items, lastMovedById, now),
    damaged: damagedReport(items),
    usageByActivity,
    variance: buildVariance(items, orderedRows, issuedByItem),
    priceTrend: priceTrend(items, receiptRows),
    upcomingNeeds: upcomingNeeds
      .sort((a, b) => (a.daysUntilRequired ?? 9999) - (b.daysUntilRequired ?? 9999))
      .slice(0, LIST_LIMIT),
    longLead: longLead
      .sort((a, b) => (a.daysUntilRequired ?? 9999) - (b.daysUntilRequired ?? 9999))
      .slice(0, LIST_LIMIT),
  };
};

module.exports = {
  LIST_LIMIT,
  buildVariance,
  damagedReport,
  getAnalytics,
  overstock,
  priceTrend,
  shortages,
  slowMoving,
};
