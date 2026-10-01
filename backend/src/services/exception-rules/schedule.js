/**
 * Schedule kind (OCTAPM_CHANGE_INTELLIGENCE.md §1): an activity whose finish
 * has slipped past its baseline by more than the documented threshold, on a
 * BOQ item whose certification is still pending.
 *
 * The slip is the activity's finish against Activity.baselineFinish
 * (lockBaseline copied the early finish there), both in the CPM's working-day
 * index. The finish is the one the activity actually stands at — never the
 * forecast's change-order impacts (R5-1 documented that the forecast adds an
 * impact to an activity's own finish without moving successors and counts
 * working days as calendar days, so those impacts stay a forecast):
 *
 *   actual_finish  the activity has finished: the actualFinish of its latest
 *                  approved ActivityProgress (EV's selection rule — EV reads
 *                  ActivityProgress only), at the evaluation's as-of instant;
 *   data_date      it has not finished and the data date (the evaluation's
 *                  as-of date in the project's zone) is past its planned
 *                  finish: it cannot finish before the data date;
 *   early_finish   otherwise its planned finish, Activity.earlyFinish (the
 *                  current CPM finish), or Activity.endDate when the CPM has
 *                  not placed it.
 *
 * A date is placed in the index the way the CPM places its own (cpm.service
 * dateToWorkingDay from the project's start date on the activity's calendar).
 * The CPM's forward pass alone ignores actual dates and the data date, so a
 * late actual finish or an overdue, incomplete activity would otherwise never
 * show. Without a project start date no date can be placed and the early
 * finish is read.
 *
 * Certification pending is the allocation summary's per-item certified value
 * (IPC lines certified or paid on approved allocations) below the item's
 * amount, on an item the activity has an approved allocation of.
 *
 * Module schedule (schedule:read), and BOQ-derived (PC-7b integration I): the
 * row exists only because the activity has an approved BOQ allocation whose
 * certification is pending, so its mere presence says the activity is mapped
 * — mapping information. A member without boq:read is not given it at all
 * (withheld whole by utils/boq-figures, not listed, not counted, a marker
 * with the reason); the pending items stay under data.boq.
 */
const reads = require("./_reads");
const { THRESHOLDS, round2 } = require("./_thresholds");
const { dateToWorkingDay } = require("../cpm.service");
const { localDateOf, resolveReportingTimeZone } = require("../../utils/reporting-cutoff");

const NOT_THE_FORECAST = "the forecast's change-order impacts are not read (R5-1)";
const FINISH_BASIS = Object.freeze({
  actual_finish: `Finish variance: the activity's actual finish (latest approved ActivityProgress.actualFinish, EV's selection) placed in the CPM's working-day index − Activity.baselineFinish; ${NOT_THE_FORECAST}`,
  data_date: `Finish variance: the data date (the evaluation's as-of date — the activity is incomplete and past its planned finish, so it cannot finish earlier) placed in the CPM's working-day index − Activity.baselineFinish; ${NOT_THE_FORECAST}`,
  early_finish: `Finish variance: Activity.earlyFinish − Activity.baselineFinish in the CPM's working-day index (lockBaseline copied the early finish into the baseline); ${NOT_THE_FORECAST}`,
});

const isoDate = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);

/**
 * The finish an activity stands at, in the CPM's working-day index, and which
 * one it is: its actual finish, the data date, or its planned (early) finish.
 */
const finishOf = ({ activity, progress, anchor, dataDate }) => {
  const calendar = { calendarId: activity.calendarId || anchor?.projectCalendar || null, projectCalendar: anchor?.projectCalendar || null };
  const place = (date) => (anchor?.startDate && date ? dateToWorkingDay(anchor.startDate, date, calendar) : null);
  const finished = Boolean(progress && (Number(progress.pctComplete) >= 100 || progress.actualFinish));

  if (finished && progress.actualFinish) {
    const index = place(progress.actualFinish);
    if (index != null) return { index, basis: "actual_finish", date: isoDate(progress.actualFinish) };
  }
  const planned = activity.earlyFinish != null ? Number(activity.earlyFinish) : place(activity.endDate);
  if (!finished) {
    const dataDateIndex = place(dataDate);
    if (dataDateIndex != null && (planned == null || dataDateIndex > planned)) return { index: dataDateIndex, basis: "data_date", date: isoDate(dataDate) };
  }
  if (planned == null) return null;
  return { index: planned, basis: "early_finish", date: null };
};

const scheduleSlipOnMappedItem = {
  kind: "schedule_slip_on_mapped_item",
  severity: "warning",
  subjectType: "activity",
  module: "schedule",
  // Its presence says the activity is mapped to a BOQ item with certification pending.
  boqDerived: true,
  evaluate: async ({ ctx }) => {
    const threshold = THRESHOLDS.schedule_slip_on_mapped_item;
    const [activities, allocations, summary, progressMap, anchor] = await Promise.all([
      reads.activities(ctx),
      reads.approvedAllocations(ctx),
      reads.allocationSummary(ctx),
      reads.latestApprovedProgress(ctx),
      reads.scheduleAnchor(ctx),
    ]);
    const summaryItems = new Map((summary.items || []).map((item) => [item.boqItemId, item]));
    const itemsOfActivity = new Map();
    for (const allocation of allocations) itemsOfActivity.set(allocation.activityId, [...new Set([...(itemsOfActivity.get(allocation.activityId) || []), allocation.boqItemId])]);

    // The data date: the evaluation's as-of instant, as a date in the project's reporting zone.
    const zone = resolveReportingTimeZone({ project: anchor, organisation: anchor?.org || null }).timeZone;
    const dataDate = new Date(`${localDateOf(reads.asOf(ctx), zone)}T00:00:00.000Z`);

    const rows = [];
    for (const [activityId, itemIds] of itemsOfActivity) {
      const activity = activities.get(activityId);
      if (!activity || !activity.isActive) continue;
      if (activity.baselineFinish == null) continue;
      const progress = progressMap.get(activityId) || null;
      const finish = finishOf({ activity, progress, anchor, dataDate });
      if (!finish) continue;
      const slip = finish.index - Number(activity.baselineFinish);
      if (!(slip > threshold.thresholdDays)) continue;
      const pending = itemIds
        .map((id) => summaryItems.get(id))
        .filter((item) => item && Number(item.amount) > 0 && Number(item.certifiedValue) < Number(item.amount) - threshold.pendingCertificationTolerance);
      if (!pending.length) continue;
      rows.push({
        subjectType: "activity",
        subjectId: activityId,
        severity: activity.isCritical || slip >= threshold.criticalDays ? "critical" : "warning",
        measured: { value: slip, unitCode: "working_day", basis: FINISH_BASIS[finish.basis] },
        limit: {
          value: threshold.thresholdDays,
          unitCode: "working_day",
          basis: `Documented threshold: a finish more than ${threshold.thresholdDays} working days behind its baseline (exception-rules SCHEDULE_SLIP_THRESHOLD_DAYS)`,
        },
        groupKeys: { wbsNodeId: activity.wbsNodeId || null, locationId: activity.locationId || null },
        data: {
          label: reads.activityLabel(activity),
          finishBasis: finish.basis,
          finishIndex: finish.index,
          finishDate: finish.date,
          earlyFinish: activity.earlyFinish,
          baselineFinish: activity.baselineFinish,
          pctComplete: progress ? Number(progress.pctComplete) : null,
          actualFinish: isoDate(progress?.actualFinish),
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
