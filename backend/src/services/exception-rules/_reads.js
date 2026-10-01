/**
 * The reads several exception rules share, each made once per evaluation
 * through ctx.memo and each through the service that owns the figure:
 *
 *   approvedAllocations  activity-boq-allocation listAllocations (status approved)
 *   allocationSummary    activity-boq-allocation buildAllocationSummary (coverage,
 *                        certified value per item; at the cutoff when one is given)
 *   boqItems             the active BOQ rows (source: BoqItem.qty / unit)
 *   quantityBlocks       quantity-views quantityBlocks — installed / certified per
 *                        item and the views' raw certified-over-installed comparison
 *   activities           the activity rows (source: CPM dates, calendar, active flag)
 *   scheduleAnchor       the project's start date, calendar and zone (the CPM index's anchor)
 *   latestApprovedProgress  the approved ActivityProgress each activity stands at, at the
 *                        evaluation's as-of instant, by EV's selection rule (actual dates)
 *   methods              the progress method of each activity (normalised by
 *                        progress.service normalizeMethod, as the views read it)
 *   variations           ipc.service getApprovedVariationAllowances — the approved
 *                        change-order allocation-link quantity, the certification
 *                        cap's rule
 *
 * Pure reads: nothing here writes. A file whose name starts with "_" is not a
 * rule file (exception-rules/index.js skips it).
 */
const { prisma } = require("../../config/db");

const allocationService = () => require("../activity-boq-allocation.service");
const quantityViews = () => require("../quantity-views.service");
const progressService = () => require("../progress.service");
const ipcService = () => require("../ipc.service");

const approvedAllocations = (ctx) =>
  ctx.memo("approvedAllocations", async () => {
    const { allocations } = await allocationService().listAllocations({ orgId: ctx.orgId, projectId: ctx.projectId, status: "approved" });
    return allocations;
  });

const allocationSummary = (ctx) =>
  ctx.memo("allocationSummary", () =>
    allocationService().buildAllocationSummary({ projectId: ctx.projectId, ...(ctx.cutoff ? { cutoffDate: ctx.cutoff } : {}) }),
  );

const boqItems = (ctx) =>
  ctx.memo("boqItems", () =>
    prisma.boqItem.findMany({
      where: { projectId: ctx.projectId, isActive: true },
      select: { id: true, code: true, ref: true, description: true, unit: true, unitCode: true, qty: true, amount: true, wbsNodeId: true, locationId: true, costCodeId: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  );

const quantityBlocks = (ctx) =>
  ctx.memo("quantityBlocks", async () => {
    const items = await boqItems(ctx);
    // The engine reads every figure (can → true); who may see an exception is
    // the reading API's business (utils/boq-figures), not the evaluator's.
    const { blocks } = await quantityViews().quantityBlocks({
      orgId: ctx.orgId,
      projectId: ctx.projectId,
      items,
      can: () => true,
      cutoffDate: ctx.cutoff || null,
    });
    return blocks;
  });

const activities = (ctx) =>
  ctx.memo("activities", async () => {
    const rows = await prisma.activity.findMany({
      where: { projectId: ctx.projectId },
      select: {
        id: true, name: true, activityCode: true, p6ActivityId: true, isActive: true, isCritical: true, calendarId: true,
        earlyFinish: true, baselineFinish: true, totalFloat: true, endDate: true, wbsNodeId: true, locationId: true,
      },
    });
    return new Map(rows.map((row) => [row.id, row]));
  });

/** The project's schedule anchor: the CPM's working-day index counts from startDate on its calendar. */
const scheduleAnchor = (ctx) =>
  ctx.memo("scheduleAnchor", () =>
    prisma.project.findFirst({
      where: { id: ctx.projectId, orgId: ctx.orgId },
      select: { startDate: true, projectCalendar: true, timezone: true, org: { select: { defaultTimezone: true } } },
    }),
  );

/** The instant the evaluation stands at: its cutoff, else the evaluation's own time. */
const asOf = (ctx) => ctx.cutoff || ctx.now || new Date();

// earned-value.service selectApprovedProgressForCutoff's rule (EV reads
// ActivityProgress only): an approved row counts at the cutoff by its
// approvedAt, or by its updatedAt when it has none; the latest by that
// effective date is the activity's progress.
const progressEffectiveTime = (row) => new Date(row.approvedAt || row.updatedAt || 0).getTime();

/** The approved ActivityProgress each activity stands at, at the evaluation's as-of instant (EV's selection). */
const latestApprovedProgress = (ctx) =>
  ctx.memo("latestApprovedProgress", async () => {
    const at = asOf(ctx);
    const rows = await prisma.activityProgress.findMany({
      where: {
        status: "approved",
        activity: { projectId: ctx.projectId },
        OR: [{ approvedAt: { lte: at } }, { approvedAt: null, updatedAt: { lte: at } }],
      },
      select: { activityId: true, status: true, pctComplete: true, actualStart: true, actualFinish: true, approvedAt: true, updatedAt: true },
    });
    const map = new Map();
    for (const row of rows) {
      const held = map.get(row.activityId);
      if (!held || progressEffectiveTime(row) > progressEffectiveTime(held)) map.set(row.activityId, row);
    }
    return map;
  });

const methods = (ctx) =>
  ctx.memo("methods", async () => {
    const rows = await prisma.activityProgressMethod.findMany({ where: { projectId: ctx.projectId }, select: { activityId: true, method: true } });
    const normalize = progressService().normalizeMethod;
    return new Map(rows.map((row) => [row.activityId, normalize(row.method || "percent")]));
  });

/** The method an activity is measured by ('percent' when none is configured, as the views read it). */
const methodOf = (methodMap, activityId) => methodMap.get(activityId) || "percent";

const variations = (ctx, pairs) =>
  pairs.length ? ipcService().getApprovedVariationAllowances({ tx: prisma, projectId: ctx.projectId, pairs }) : Promise.resolve([]);

const activityLabel = (activity) => (activity ? [activity.activityCode || activity.p6ActivityId, activity.name].filter(Boolean).join(" · ") : null);
const itemLabel = (item) => (item ? [item.code || item.ref, item.description].filter(Boolean).join(" · ") : null);

module.exports = {
  activities,
  activityLabel,
  allocationSummary,
  approvedAllocations,
  asOf,
  boqItems,
  itemLabel,
  latestApprovedProgress,
  methodOf,
  methods,
  quantityBlocks,
  scheduleAnchor,
  variations,
};
