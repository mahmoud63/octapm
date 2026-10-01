/**
 * Quantity overrun kinds (OCTAPM_CHANGE_INTELLIGENCE.md §1). Every figure is
 * read from its owner — installed from quantity-progress.service (Σ approved
 * entries; only approval counts) directly or through quantity-views, the
 * authorised quantity by the IPC certification cap's rule (allocation or BOQ
 * quantity + Σ approved change-order allocation-link quantity), coverage from
 * the allocation summary. A rule compares two figures it was given; it never
 * computes a quantity, never sums across units and writes nothing.
 *
 * All four are BOQ-derived: an exception of these kinds is withheld whole from
 * a member who may not read the BOQ (utils/boq-figures, the api track).
 */
const reads = require("./_reads");
const { THRESHOLDS, overRatioSeverity, round3, round2 } = require("./_thresholds");

const quantityCore = () => require("../quantity-progress.service");
const quantityViews = () => require("../quantity-views.service");
const uomService = () => require("../uom.service");

const sameUnit = (a, b) => {
  if (!a || !b) return !a && !b ? true : false;
  const { unitKey } = uomService();
  return unitKey(a) === unitKey(b);
};

// The PC-6 core is part of the base (merged); a build without it skips the
// quantity kinds with this reason rather than approximating installed.
const requiresQuantityCore = () => {
  try {
    const core = quantityCore();
    return typeof core.installedByActivity === "function" && typeof core.installedByBoqItem === "function"
      ? null
      : "quantity-progress.service installedByActivity / installedByBoqItem are not available";
  } catch (error) {
    return `quantity-progress.service is not available (${error.code || error.message})`;
  }
};

const INSTALLED_ON_ALLOCATION_BASIS =
  "Σ approved quantity progress entries on this activity and BOQ item (quantity-progress.service installedByActivity): a daily log, a site capture or an import never counts until the progress approvers approve it";
const AUTHORISED_ALLOCATION_BASIS =
  "Authorised quantity: the approved allocation quantity + Σ approved change-order allocation-link quantity (ipc.service getApprovedVariationAllowances — the IPC certification cap's rule)";
const AUTHORISED_ITEM_BASIS =
  "Authorised quantity: BoqItem.qty on the current revision + Σ approved change-order allocation-link quantity naming this item (ipc.service getApprovedVariationAllowances)";

// ─── quantity_over_allocation ───────────────────────────────────────────────

const quantityOverAllocation = {
  kind: "quantity_over_allocation",
  severity: "warning",
  subjectType: "allocation",
  module: "boq",
  boqDerived: true,
  requires: requiresQuantityCore,
  evaluate: async ({ orgId, projectId, cutoff, ctx }) => {
    const threshold = THRESHOLDS.quantity_over_allocation;
    const [allocations, activities, methods] = await Promise.all([reads.approvedAllocations(ctx), reads.activities(ctx), reads.methods(ctx)]);
    // Installed is a quantity only on an activity measured by quantity (the
    // views' rule: on a percent activity it is "—", never % × quantity).
    const measured = allocations.filter((allocation) => {
      const activity = activities.get(allocation.activityId);
      return activity && activity.isActive && reads.methodOf(methods, allocation.activityId) === "quantity";
    });
    if (!measured.length) return [];
    const activityIds = [...new Set(measured.map((allocation) => allocation.activityId))];
    const installedMap = await quantityCore().installedByActivity({ orgId, projectId, activityIds, cutoffDate: cutoff || null });

    // One active allocation per (activity, item) pair; should two ever stand,
    // the pair is not compared (which one was exceeded is not knowable).
    const byPair = new Map();
    for (const allocation of measured) {
      const key = `${allocation.activityId}\u0000${allocation.boqItemId}`;
      byPair.set(key, [...(byPair.get(key) || []), allocation]);
    }
    const candidates = [];
    for (const [key, group] of byPair) {
      if (group.length !== 1) {
        ctx.note(`quantity_over_allocation: ${group.length} approved allocations map one item to one activity (${key.replace("\u0000", " / ")}); not compared`);
        continue;
      }
      const allocation = group[0];
      const lines = (installedMap.get(allocation.activityId)?.installed || []).filter((line) => line.boqItemId === allocation.boqItemId);
      if (!lines.length) continue;
      const allocationUnit = allocation.unitCode || allocation.boqItem?.unitCode || null;
      if (lines.length !== 1 || !sameUnit(lines[0].unitCode, allocationUnit)) {
        ctx.note(`quantity_over_allocation: allocation ${allocation.id} — installed is not in the allocation's unit; nothing is compared across units`);
        continue;
      }
      candidates.push({ allocation, installed: lines[0] });
    }
    if (!candidates.length) return [];
    const allowances = await reads.variations(ctx, candidates.map(({ allocation }) => ({ allocationId: allocation.id, boqItemId: allocation.boqItemId })));
    const rows = [];
    candidates.forEach(({ allocation, installed }, index) => {
      const allocationQuantity = Number(allocation.quantity) || 0;
      const variation = Number(allowances[index]?.quantity) || 0;
      const limit = round3(allocationQuantity + variation);
      const value = round3(installed.quantity);
      if (!(value > limit + threshold.tolerance)) return;
      const activity = activities.get(allocation.activityId);
      rows.push({
        subjectType: "allocation",
        subjectId: allocation.id,
        severity: overRatioSeverity({ measured: value, limit, ratio: threshold.criticalOverRatio }),
        measured: { value, unitCode: installed.unitCode, basis: INSTALLED_ON_ALLOCATION_BASIS },
        limit: { value: limit, unitCode: installed.unitCode, basis: AUTHORISED_ALLOCATION_BASIS },
        groupKeys: {
          wbsNodeId: allocation.boqItem?.wbsNodeId || activity?.wbsNodeId || null,
          locationId: allocation.locationId || allocation.boqItem?.locationId || activity?.locationId || null,
          costCodeId: allocation.boqItem?.costCodeId || null,
        },
        data: {
          label: [reads.itemLabel(allocation.boqItem), reads.activityLabel(activity)].filter(Boolean).join(" → "),
          activityId: allocation.activityId,
          boqItemId: allocation.boqItemId,
          allocationQuantity: round3(allocationQuantity),
          approvedVariationQuantity: round3(variation),
          entries: installed.entries ?? null,
          exceedance: round3(value - limit),
        },
      });
    });
    return rows;
  },
};

// ─── quantity_over_boq ──────────────────────────────────────────────────────

const quantityOverBoq = {
  kind: "quantity_over_boq",
  severity: "warning",
  subjectType: "boq_item",
  module: "boq",
  boqDerived: true,
  requires: requiresQuantityCore,
  evaluate: async ({ ctx }) => {
    const threshold = THRESHOLDS.quantity_over_boq;
    const [items, blocks] = await Promise.all([reads.boqItems(ctx), reads.quantityBlocks(ctx)]);
    const candidates = [];
    for (const item of items) {
      const block = blocks.get(item.id);
      const installed = block?.figures?.installed;
      if (!installed || installed.value == null) {
        if (installed?.notAvailable && (installed.entries || 0) > 0) ctx.note(`quantity_over_boq: item ${item.id} — ${installed.notAvailable.reason}`);
        continue;
      }
      if (!(installed.value > 0)) continue;
      if (installed.unitMatch === false) {
        ctx.note(`quantity_over_boq: item ${item.id} — installed is in ${installed.unitCode}, the row in ${block.unitCode}; not compared`);
        continue;
      }
      candidates.push({ item, block, installed });
    }
    if (!candidates.length) return [];
    const allowances = await reads.variations(ctx, candidates.map(({ item }) => ({ boqItemId: item.id })));
    const rows = [];
    candidates.forEach(({ item, block, installed }, index) => {
      const variation = Number(allowances[index]?.quantity) || 0;
      const limit = round3((Number(item.qty) || 0) + variation);
      const value = round3(installed.value);
      if (!(value > limit + threshold.tolerance)) return;
      const unitCode = installed.unitCode || block.unitCode || null;
      rows.push({
        subjectType: "boq_item",
        subjectId: item.id,
        severity: overRatioSeverity({ measured: value, limit, ratio: threshold.criticalOverRatio }),
        measured: { value, unitCode, basis: quantityViews().BASIS.installed },
        limit: { value: limit, unitCode, basis: AUTHORISED_ITEM_BASIS },
        groupKeys: { wbsNodeId: item.wbsNodeId || null, locationId: item.locationId || null, costCodeId: item.costCodeId || null },
        data: {
          label: reads.itemLabel(item),
          boqQuantity: round3(item.qty),
          approvedVariationQuantity: round3(variation),
          entries: installed.entries ?? null,
          exceedance: round3(value - limit),
        },
      });
    });
    return rows;
  },
};

// ─── certified_over_installed ───────────────────────────────────────────────

const certifiedOverInstalled = {
  kind: "certified_over_installed",
  severity: "critical",
  subjectType: "boq_item",
  module: "boq",
  boqDerived: true,
  requires: requiresQuantityCore,
  evaluate: async ({ ctx }) => {
    const threshold = THRESHOLDS.certified_over_installed;
    const [items, blocks, allocations, methods] = await Promise.all([reads.boqItems(ctx), reads.quantityBlocks(ctx), reads.approvedAllocations(ctx), reads.methods(ctx)]);
    // §1: "(quantity-method activities)". An item mapped to any activity not
    // measured by quantity has no complete installed figure, so it is not
    // compared (never approximated).
    const activitiesOfItem = new Map();
    for (const allocation of allocations) activitiesOfItem.set(allocation.boqItemId, [...(activitiesOfItem.get(allocation.boqItemId) || []), allocation.activityId]);
    const rows = [];
    for (const item of items) {
      const comparison = blocks.get(item.id)?.comparisons?.certifiedOverInstalled;
      if (!comparison || comparison.flag !== true) continue;
      const activityIds = activitiesOfItem.get(item.id) || [];
      if (!activityIds.length || activityIds.some((id) => reads.methodOf(methods, id) !== "quantity")) {
        ctx.note(`certified_over_installed: item ${item.id} — certified above installed, but not every approved allocation is on a quantity-method activity; not raised`);
        continue;
      }
      const value = round3(comparison.certified);
      const limit = round3(comparison.installed);
      if (!(value > limit + threshold.tolerance)) continue;
      rows.push({
        subjectType: "boq_item",
        subjectId: item.id,
        measured: { value, unitCode: comparison.unitCode, basis: quantityViews().BASIS.certified },
        limit: { value: limit, unitCode: comparison.unitCode, basis: `${quantityViews().BASIS.installed} — ${comparison.basis}` },
        groupKeys: { wbsNodeId: item.wbsNodeId || null, locationId: item.locationId || null, costCodeId: item.costCodeId || null },
        data: { label: reads.itemLabel(item), installedFigure: comparison.installedFigure || null, exceedance: round3(value - limit) },
      });
    }
    return rows;
  },
};

// ─── allocation_over_capacity ───────────────────────────────────────────────
// The database refuses this state today (triggers ActivityBoqAllocation_validate
// and BoqItem_allocation_capacity_validate keep Σ active allocations within the
// item's quantity and amount); the rule reads the allocation summary so a row
// that predates the triggers, or a path that ever gets past them, is seen.

const allocationOverCapacity = {
  kind: "allocation_over_capacity",
  severity: "warning",
  subjectType: "boq_item",
  module: "boq",
  boqDerived: true,
  evaluate: async ({ ctx }) => {
    const threshold = THRESHOLDS.allocation_over_capacity;
    const summary = await reads.allocationSummary(ctx);
    const rows = [];
    for (const item of summary.items || []) {
      const overQuantity = item.approvedAllocatedQuantity > item.quantity + threshold.quantityTolerance;
      const overAmount = item.approvedAllocatedAmount > item.amount + threshold.moneyTolerance;
      if (!overQuantity && !overAmount) continue;
      const groupKeys = { wbsNodeId: item.wbsNodeId || null, locationId: item.locationId || null, costCodeId: item.costCodeId || null };
      rows.push(
        overQuantity
          ? {
              subjectType: "boq_item",
              subjectId: item.boqItemId,
              measured: { value: round3(item.approvedAllocatedQuantity), unitCode: item.unitCode || null, basis: "Σ approved, active allocation quantity (activity-boq-allocation buildAllocationSummary)" },
              limit: { value: round3(item.quantity), unitCode: item.unitCode || null, basis: "BoqItem.qty on the current revision (allocation summary)" },
              groupKeys,
              data: { label: [item.code, item.description].filter(Boolean).join(" · "), measure: "quantity", mappingState: item.mappingState },
            }
          : {
              subjectType: "boq_item",
              subjectId: item.boqItemId,
              measured: { value: round2(item.approvedAllocatedAmount), unitCode: ctx.currency, basis: "Σ approved, active allocation amount (activity-boq-allocation buildAllocationSummary)" },
              limit: { value: round2(item.amount), unitCode: ctx.currency, basis: "BoqItem.amount on the current revision (allocation summary)" },
              groupKeys,
              data: { label: [item.code, item.description].filter(Boolean).join(" · "), measure: "amount", mappingState: item.mappingState },
            },
      );
    }
    return rows;
  },
};

module.exports = [quantityOverAllocation, quantityOverBoq, certifiedOverInstalled, allocationOverCapacity];
