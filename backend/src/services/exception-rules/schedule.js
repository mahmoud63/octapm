/**
 * Schedule kind (OCTAPM_CHANGE_INTELLIGENCE.md §1): an activity whose finish
 * has slipped past its baseline by more than the documented threshold, on a
 * BOQ item whose certification is still pending.
 *
 * The slip is read from the activity's own dates — Activity.earlyFinish (the
 * current CPM finish) against Activity.baselineFinish (lockBaseline copied the
 * early finish there), both in the CPM's working-day index. It is NOT the
 * forecast's change-order impacts: R5-1 documented that the forecast adds an
 * impact to an activity's own finish without moving successors and counts
 * working days as calendar days, so those impacts stay a forecast and are not
 * read here. Certification pending is the allocation summary's per-item
 * certified value (IPC lines certified or paid on approved allocations) below
 * the item's amount, on an item the activity has an approved allocation of.
 *
 * Module schedule (schedule:read). The figures are schedule figures; which
 * items are pending is BOQ data and is kept under data.boq, which the reading
 * API leaves out for a member who may not read the BOQ.
 */
const reads = require("./_reads");
const { THRESHOLDS, round2 } = require("./_thresholds");

const SLIP_BASIS =
  "Finish variance: Activity.earlyFinish − Activity.baselineFinish in the CPM's working-day index (lockBaseline copied the early finish into the baseline); the forecast's change-order impacts are not read (R5-1)";

const scheduleSlipOnMappedItem = {
  kind: "schedule_slip_on_mapped_item",
  severity: "warning",
  subjectType: "activity",
  module: "schedule",
  boqDerived: false,
  evaluate: async ({ ctx }) => {
    const threshold = THRESHOLDS.schedule_slip_on_mapped_item;
    const [activities, allocations, summary] = await Promise.all([reads.activities(ctx), reads.approvedAllocations(ctx), reads.allocationSummary(ctx)]);
    const summaryItems = new Map((summary.items || []).map((item) => [item.boqItemId, item]));
    const itemsOfActivity = new Map();
    for (const allocation of allocations) itemsOfActivity.set(allocation.activityId, [...new Set([...(itemsOfActivity.get(allocation.activityId) || []), allocation.boqItemId])]);

    const rows = [];
    for (const [activityId, itemIds] of itemsOfActivity) {
      const activity = activities.get(activityId);
      if (!activity || !activity.isActive) continue;
      if (activity.earlyFinish == null || activity.baselineFinish == null) continue;
      const slip = Number(activity.earlyFinish) - Number(activity.baselineFinish);
      if (!(slip > threshold.thresholdDays)) continue;
      const pending = itemIds
        .map((id) => summaryItems.get(id))
        .filter((item) => item && Number(item.amount) > 0 && Number(item.certifiedValue) < Number(item.amount) - threshold.pendingCertificationTolerance);
      if (!pending.length) continue;
      rows.push({
        subjectType: "activity",
        subjectId: activityId,
        severity: activity.isCritical || slip >= threshold.criticalDays ? "critical" : "warning",
        measured: { value: slip, unitCode: "working_day", basis: SLIP_BASIS },
        limit: {
          value: threshold.thresholdDays,
          unitCode: "working_day",
          basis: `Documented threshold: a finish more than ${threshold.thresholdDays} working days behind its baseline (exception-rules SCHEDULE_SLIP_THRESHOLD_DAYS)`,
        },
        groupKeys: { wbsNodeId: activity.wbsNodeId || null, locationId: activity.locationId || null },
        data: {
          label: reads.activityLabel(activity),
          earlyFinish: activity.earlyFinish,
          baselineFinish: activity.baselineFinish,
          totalFloat: activity.totalFloat ?? null,
          isCritical: Boolean(activity.isCritical),
          // BOQ data: left out by the reading API for a member without boq:read.
          boq: {
            pendingCertificationItems: pending.length,
            pendingItems: pending.map((item) => ({ boqItemId: item.boqItemId, certifiedValue: round2(item.certifiedValue), amount: round2(item.amount) })),
          },
        },
      });
    }
    return rows;
  },
};

module.exports = [scheduleSlipOnMappedItem];
