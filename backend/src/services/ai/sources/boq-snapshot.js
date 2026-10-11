/**
 * The BOQ's coverage as OctaPM computes it (AI-7, BOQ): the allocation
 * summary GET /activity-boq-allocations/coverage returns (§69) — what is
 * allocated, approved, pending, scheduled, unallocated, optional or not
 * applicable, and each row's mapping state. The AI explains it; it never
 * recomputes a quantity or an amount.
 *
 * Only for a caller who may read the BOQ on the project (canReadBoq, the
 * same decision every BOQ figure in the product follows), failing closed.
 */
const { canReadBoq } = require("../../../utils/boq-figures");

const LIST = 12;
const num = (value) => Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const itemName = (item) => `${item.code ? `${item.code} ` : ""}${item.description || "BOQ item"}`;

const boqSources = async ({ view, projectId }) => {
  if (!view?.user || !canReadBoq(view)) return [];
  const allocationService = require("../../activity-boq-allocation.service");
  const coverage = await allocationService.getCoverage({ orgId: view.user.orgId, projectId });
  const items = Array.isArray(coverage?.items) ? coverage.items : [];
  if (!items.length) return [];
  const counts = coverage.counts || {};
  const gaps = items
    .filter((item) => ["unmapped", "partial", "over"].includes(item.mappingState) || Number(item.pendingAllocatedAmount) > 0)
    .sort((a, b) => Number(b.unallocatedAmount || 0) - Number(a.unallocatedAmount || 0));
  const facts = [
    `FACT: ${items.length} BOQ rows: ${counts.complete ?? 0} fully allocated, ${counts.partial ?? 0} partly, ${counts.unmapped ?? 0} unallocated, ${counts.over ?? 0} over-allocated, ${counts.notApplicable ?? 0} not applicable`,
    `FACT: BOQ value ${num(coverage.totalBoqAmount)}; allocated (active) ${num(coverage.activeAllocatedAmount)}; approved ${num(coverage.approvedAllocatedAmount)}; pending approval ${num(coverage.pendingAllocatedAmount)}`,
    `FACT: Unallocated ${num(coverage.unallocatedAmount)}; optional unallocated ${num(coverage.optionalUnallocatedAmount)}; not applicable ${num(coverage.notApplicableAmount)}; scheduled ${num(coverage.scheduledValue)}; unscheduled ${num(coverage.unscheduledValue)}`,
    `FACT: Earned value on the BOQ ${num(coverage.earnedValue)}; certified ${num(coverage.certifiedValue)}`,
    ...gaps.slice(0, LIST).map((item) => `FACT: ${item.mappingState.toUpperCase()}: ${itemName(item)} — quantity ${num(item.quantity)} ${item.unitCode || ""}, allocated ${num(item.activeAllocatedQuantity)}, unallocated ${num(item.unallocatedQuantity)} (${num(item.unallocatedAmount)}), pending ${num(item.pendingAllocatedAmount)}, ${item.allocationCount} allocation${item.allocationCount === 1 ? "" : "s"}`),
  ];
  return [
    { id: `${projectId}:boq`, type: "boq_coverage", typeLabel: "BOQ coverage (allocation summary)", title: "BOQ coverage", ref: null, status: null, projectId, projectName: null, url: `/projects/${projectId}?module=boq`, snippet: null, text: facts.join("\n") },
    ...gaps.slice(0, LIST).map((item) => ({ id: item.boqItemId, type: "boq_item", typeLabel: "BOQ item", title: item.description || "BOQ item", ref: item.code || null, status: item.mappingState, projectId, projectName: null, url: `/projects/${projectId}?module=boq&recordId=${item.boqItemId}`, snippet: null, text: `${item.mappingState}: quantity ${num(item.quantity)} ${item.unitCode || ""}, allocated ${num(item.activeAllocatedQuantity)}, approved ${num(item.approvedAllocatedQuantity)}, unallocated ${num(item.unallocatedQuantity)}, mapping rule ${item.mappingRule}` })),
  ];
};

module.exports = { boqSources };
