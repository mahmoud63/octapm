const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { addMoney } = require("../utils/money");
const { workspacePath, workspaceSegment } = require("../utils/record-links");
const { buildAllocationSummary } = require("./activity-boq-allocation.service");
const { buildScheduleReadiness } = require("./schedule.service");
const { resolveCalendar } = require("./cpm.service");
// The bill's money (PC-3's coverage amounts) and the schedule check that
// states it, as every endpoint that carries them withholds them (§12).
const { withheldScheduleReadiness, withoutBoqFigures } = require("../utils/boq-figures");
const { loadUnitIndex, normaliseWith, unitKey } = require("./uom.service");

const RULESET_VERSION = "fb-015-v2";
const MONEY_EPSILON = 0.01;

// How many offending records an issue lists (setup doc §2). The count is
// always the whole number; the list is a sample big enough to act on.
const ITEM_CAP = 50;

const STATUS = {
  COMPLETE: "complete",
  ATTENTION: "attention",
  BLOCKED: "blocked",
  PENDING: "pending",
};

const TARGETS = {
  overview: { module: "overview" },
  boq: { module: "boq" },
  schedule: { module: "schedule", child: "gantt" },
  scheduleRevisions: { module: "schedule", child: "revisions" },
  scheduleProgress: { module: "schedule", child: "progress" },
  scheduleEv: { module: "schedule", child: "ev" },
  activities: { module: "activities" },
  cost: { module: "cost", child: "overview" },
  budget: { module: "cost", child: "budget" },
  reports: { module: "reports" },
  structure: { module: "controls", child: "structure" },
  mapping: { module: "controls", child: "mapping" },
  locations: { module: "locations" },
};

// The revisions whose rows are the current bill — the same list boq.service
// keeps as CURRENT_REVISION_STATUSES. Repeated here rather than required,
// because boq.service pulls in the model SDK and the subscription gate, and
// readiness is read on every project screen.
const BOQ_CURRENT_REVISION_STATUSES = [
  "imported",
  "under_review",
  "approved",
  "baselined",
];
const MAPPING_RULES = ["required", "optional", "not_applicable"];

const OFFICIAL_EV_INPUTS = [
  {
    key: "approved_allocations",
    label: "Approved allocations",
    source: "ActivityBoqAllocation",
    requiredStatus: "approved",
    target: TARGETS.boq,
  },
  {
    key: "approved_progress",
    label: "Approved progress",
    source: "ActivityProgress",
    requiredStatus: "approved",
    target: TARGETS.scheduleProgress,
  },
  {
    key: "approved_cost_loading",
    label: "Approved cost loading",
    source: "ActivityCostLoading",
    requiredStatus: "approved",
    target: TARGETS.scheduleEv,
  },
];

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const toIso = (value) => (value ? new Date(value).toISOString() : null);

/**
 * One blocker or warning. `items` names the records behind it — capped, with
 * `count` carrying the whole number — so the wizard can list them and link
 * to each one; an issue about the project as a whole simply has none.
 */
const issue = (code, message, severity = "blocking", details = {}, items = []) => ({
  code,
  message,
  severity,
  details,
  items: items.slice(0, ITEM_CAP),
  count: items.length,
});

const normalizeRevisionStatus = (status) => {
  if (
    [
      "draft",
      "under_review",
      "approved",
      "rejected",
      "baselined",
      "superseded",
    ].includes(status)
  ) {
    return status;
  }

  return "draft";
};

/**
 * Where a record is fixed: the module page under the project's workspace,
 * with the record in the URL (`?recordId=&source=`) as notification links
 * carry it. The link opens the module that holds the record; the BOQ grid,
 * the activities list and the mapping matrix do not yet select the record
 * named in the URL (a follow-up for those modules' owners), so the address
 * carries it for the day they do.
 */
const hrefFor = ({ workspace, projectId, target, record = null }) => {
  const base = `/projects/${encodeURIComponent(projectId)}/${target.module}${
    target.child ? `/${target.child}` : ""
  }`;
  const path = record
    ? `${base}?recordId=${encodeURIComponent(record.id)}&source=${encodeURIComponent(record.type)}`
    : base;
  return workspacePath(path, workspace);
};

const activityCodeOf = (activity) =>
  activity.activityCode || activity.p6ActivityId || activity.wbsCode || null;

const boqCodeOf = (item) => item.code || item.ref || null;

// The review trail of a BOQ revision is what the approval workflow recorded
// under this record type (approval-workflow.service RECORD_TYPES): the same
// rows the revision endpoint lists, read here so the approval step can show
// them. The service itself is not required — it pulls in notifications and
// the event bus, and readiness is read on every project screen.
const BOQ_REVISION_RECORD_TYPE = "boq_revision";
const HISTORY_CAP = 20;

const buildStep = ({
  key,
  label,
  description,
  action,
  requiredFor = [],
  complete,
  blockers = [],
  warnings = [],
  counts = {},
  guides,
  successMessage,
}) => {
  const activeBlockers = blockers.filter(Boolean);
  const activeWarnings = warnings.filter(Boolean);
  let status = STATUS.PENDING;

  if (activeBlockers.length > 0) {
    status = STATUS.BLOCKED;
  } else if (complete && activeWarnings.length > 0) {
    status = STATUS.ATTENTION;
  } else if (complete) {
    status = STATUS.COMPLETE;
  } else if (activeWarnings.length > 0) {
    status = STATUS.ATTENTION;
  }

  const message =
    activeBlockers[0]?.message ||
    activeWarnings[0]?.message ||
    successMessage ||
    description;

  return {
    key,
    label,
    description,
    status,
    requiredFor,
    critical: requiredFor.length > 0,
    message,
    blockers: activeBlockers,
    warnings: activeWarnings,
    counts,
    action,
    // Only the structure step guides (§21); the others carry no list.
    ...(guides ? { guides } : {}),
  };
};

const addStepContext = (steps) =>
  steps.flatMap((step) =>
    step.blockers.map((blocker) => ({
      stepKey: step.key,
      stepLabel: step.label,
      actionLabel: step.action.label,
      target: step.action.target,
      ...blocker,
    })),
  );

const addStepWarningContext = (steps) =>
  steps.flatMap((step) =>
    step.warnings.map((warning) => ({
      stepKey: step.key,
      stepLabel: step.label,
      actionLabel: step.action.label,
      target: step.action.target,
      ...warning,
    })),
  );

const firstNextAction = (steps) =>
  steps.find((step) => step.status === STATUS.BLOCKED) ||
  steps.find((step) => step.status === STATUS.ATTENTION) ||
  steps.find((step) => step.status === STATUS.PENDING) ||
  null;

// The two steps PC-4 inserts (setup doc §2). They are advisory and the
// doc keeps `nextAction` unchanged (§3), so they never take it from the ten
// original steps: a project whose ten steps are clear keeps a null
// nextAction, and the first of these two still asking for something is
// offered apart, as `summary.advisoryAction`.
const ADVISORY_STEP_KEYS = new Set(["structure_setup", "boq_approval"]);

const toAction = (step) =>
  step
    ? {
        stepKey: step.key,
        label: step.action.label,
        target: step.action.target,
        message: step.message,
      }
    : null;

// What a person who cannot read the BOQ (boq:read) is not shown: the
// records behind an issue that are BOQ rows, their allocations, the bill's
// revisions and the unit spellings typed on its rows. The issue itself,
// its code, message and count stay — so every gate and blocker is the same
// for every caller — only the named records are withheld.
const BOQ_ITEM_TYPES = new Set(["boq_item", "allocation", "boq_revision", "unit"]);

const withoutBoqRecords = (entry) => {
  const items = (entry.items || []).filter((item) => !BOQ_ITEM_TYPES.has(item.type));
  return items.length === (entry.items || []).length
    ? entry
    : { ...entry, items, itemsWithheld: true };
};

const withoutBoqDetail = (entry) => {
  const withheld = withoutBoqRecords(entry);
  return withheld.details ? { ...withheld, details: withoutBoqFigures(withheld.details) } : withheld;
};

// The official reporting gate as the base shaped it: EV stores it in the
// locked period's snapshot basis and in the override's audit metadata, so
// the per-item detail (records, links under the workspace slug) stays on
// the interactive readiness answer and never enters a frozen record.
const withoutItemDetail = ({ items, count, itemsWithheld, ...entry }) => entry;

const getActiveRevision = (projectId) =>
  prisma.scheduleRevision.findFirst({
    where: { projectId, isActive: true },
    orderBy: [{ activatedAt: "desc" }, { createdAt: "desc" }],
  });

const getLatestRevision = (projectId) =>
  prisma.scheduleRevision.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });

const getBaselinedRevision = (projectId) =>
  prisma.scheduleRevision.findFirst({
    where: { projectId, status: "baselined" },
    orderBy: [{ baselinedAt: "desc" }, { createdAt: "desc" }],
  });

/**
 * Whether an imported calendar id means anything to the CPM engine.
 * `resolveCalendar` answers the project fallback for an id it does not know,
 * so the same id is resolved under two different fallbacks: a known id gives
 * the same calendar both times, an unknown one gives the two fallbacks.
 * "custom" is the project's own calendar, not an import left unmapped.
 */
const calendarResolves = (calendarId) => {
  const raw = String(calendarId || "").trim().toLowerCase();
  if (!raw || raw === "custom") return true;
  return (
    resolveCalendar(calendarId, "five_day").id ===
    resolveCalendar(calendarId, "seven_day").id
  );
};

/** `a` is `b` or lies under it, on a materialised path of ids. */
const isWithinPath = (a, b) => Boolean(a && b) && (a === b || a.startsWith(`${b}/`));

/**
 * The activity rows a schedule readiness check names in its details
 * (`dependencyCycle`, `criticalFloatMismatches`, …), as items, so the
 * baseline step can link to them without knowing each check's shape.
 */
const itemsFromCheckDetails = (check, activityById, toActivityItem) => {
  const seen = new Set();
  const items = [];
  for (const value of Object.values(check.details || {})) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      const activityId =
        typeof entry === "string" ? entry : entry?.activityId || entry?.id || null;
      const activity = activityId ? activityById.get(activityId) : null;
      if (!activity || seen.has(activity.id)) continue;
      seen.add(activity.id);
      items.push(toActivityItem(activity, check.message));
    }
  }
  return items;
};

/**
 * The setup check. `canReadBoq` is whether the caller may read the BOQ
 * (the route resolves it from the caller's permission; an internal caller
 * such as the EV lock reads the gates only and leaves it at its default).
 * Without it the answer keeps every step, gate, code and count, and leaves
 * out the bill's rows, values and review trail that the BOQ and coverage
 * endpoints would refuse the same person.
 */
const getSetupReadiness = async ({ orgId, projectId, canReadBoq = true }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  }

  const [
    boqItems,
    allocationSummary,
    activities,
    activeRevision,
    latestRevision,
    baselinedRevision,
    costRecordCount,
    approvedCostLoadingCount,
    reportingPeriodCount,
    org,
    wbsNodes,
    locations,
    projectCostCodeCount,
    boqRevisions,
    allocations,
    unitIndex,
  ] = await Promise.all([
    prisma.boqItem.findMany({
      where: { projectId, isActive: true },
      select: {
        id: true,
        code: true,
        ref: true,
        description: true,
        qty: true,
        amount: true,
        unit: true,
        unitCode: true,
        wbsNodeId: true,
        locationId: true,
        costCodeId: true,
        mappingRule: true,
      },
    }),
    buildAllocationSummary({ projectId }),
    prisma.activity.findMany({
      where: { projectId, isActive: true },
      include: {
        assignments: { select: { id: true } },
        progressMethod: {
          select: { id: true, method: true, quantityUnit: true },
        },
        predecessorLinks: {
          include: {
            predecessor: {
              select: {
                id: true,
                name: true,
                wbsCode: true,
                p6ActivityId: true,
                sortOrder: true,
              },
            },
          },
        },
      },
      orderBy: { sortOrder: "asc" },
    }),
    getActiveRevision(projectId),
    getLatestRevision(projectId),
    getBaselinedRevision(projectId),
    prisma.costRecord.count({
      where: { projectId, activity: { isActive: true } },
    }),
    prisma.activityCostLoading.count({
      where: {
        projectId,
        status: "approved",
        activity: { isActive: true },
      },
    }),
    prisma.reportingPeriod.count({ where: { projectId } }),
    // The structure dimension (PC-1) and the bill's review state (PC-2):
    // read as source rows, never stored — the check is derived every time.
    prisma.organisation.findUnique({
      where: { id: orgId },
      select: { id: true, slug: true },
    }),
    prisma.wbsNode.findMany({
      where: { projectId, orgId, status: "active" },
      select: { id: true, code: true, name: true },
    }),
    prisma.location.findMany({
      where: { projectId, orgId, status: "active" },
      select: { id: true, code: true, name: true, path: true },
    }),
    prisma.projectCostCode.count({
      where: { projectId, orgId, status: "active" },
    }),
    prisma.boqRevision.findMany({
      where: { projectId },
      orderBy: [{ revisionNumber: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        revisionNumber: true,
        label: true,
        source: true,
        status: true,
        baselineLocked: true,
        lockedAt: true,
        itemCount: true,
        addedCount: true,
        updatedCount: true,
        removedCount: true,
        unchangedCount: true,
        blockedCount: true,
        totalAmount: true,
        compareJson: true,
        createdAt: true,
      },
    }),
    prisma.activityBoqAllocation.findMany({
      where: { projectId, isActive: true, activity: { isActive: true } },
      select: {
        id: true,
        boqItemId: true,
        activityId: true,
        status: true,
        suggestedBy: true,
        locationId: true,
      },
    }),
    loadUnitIndex(orgId),
  ]);

  // Every link carries the project's workspace (ENT-4); an organisation
  // without a slug yet is addressed by its id, as the web client accepts.
  const workspace = workspaceSegment(org) || orgId;
  const link = (target, record = null) =>
    hrefFor({ workspace, projectId, target, record });
  const activityItem = (activity, missing, target = TARGETS.activities) => ({
    type: "activity",
    id: activity.id,
    code: activityCodeOf(activity),
    label: activity.name,
    missing,
    href: link(target, { type: "activity", id: activity.id }),
  });
  const boqItemItem = (item, missing, target = TARGETS.boq) => ({
    type: "boq_item",
    id: item.id || item.boqItemId,
    code: boqCodeOf(item),
    label: item.description,
    missing,
    href: link(target, { type: "boq_item", id: item.id || item.boqItemId }),
  });
  const projectItem = (missing) => ({
    type: "project",
    id: project.id,
    code: project.code || null,
    label: project.name,
    missing,
    href: link(TARGETS.overview),
  });

  const currentRevision = activeRevision || latestRevision;
  const revisionStatus = normalizeRevisionStatus(currentRevision?.status);
  const scheduleReadiness = currentRevision
    ? buildScheduleReadiness({
        project,
        revision: currentRevision,
        activities,
        allocationSummary,
      })
    : null;

  const boqCount = boqItems.length;
  const totalBoqAmount = boqItems.reduce(
    (sum, item) => addMoney(sum, item.amount),
    0,
  );
  const activeActivityCount = activities.length;
  const progressActivityCount = activities.filter(
    (activity) => !activity.isMilestone,
  ).length;
  const assignedProgressActivityCount = activities.filter(
    (activity) => !activity.isMilestone && activity.assignments?.length > 0,
  ).length;
  const progressMethodCount = activities.filter(
    (activity) => !activity.isMilestone && activity.progressMethod,
  ).length;
  const criticalActivityCount = activities.filter(
    (activity) => activity.isCritical && !activity.isMilestone,
  ).length;
  const milestoneCount = activities.filter(
    (activity) => activity.isMilestone,
  ).length;
  const totalBoqFromSummary = toNumber(allocationSummary.totalBoqAmount);
  // Rows marked not_applicable (preliminaries, provisional sums, dayworks)
  // are never scheduled: the allocation step judges the allocatable value
  // and the summary already keeps them out of "unallocated" (PC-3).
  const notApplicableAmount = toNumber(allocationSummary.notApplicableAmount);
  const allocatableBoqAmount = Math.max(
    0,
    totalBoqFromSummary - notApplicableAmount,
  );
  const approvedAllocatedAmount = toNumber(
    allocationSummary.approvedAllocatedAmount,
  );
  const pendingAllocatedAmount = toNumber(
    allocationSummary.pendingAllocatedAmount,
  );
  const unallocatedAmount = toNumber(allocationSummary.unallocatedAmount);
  // An optional row's remaining value is inside unallocatedAmount but does
  // not block the baseline (mapping §3): the step blocks on what required
  // rows still leave, and warns about the optional remainder.
  const optionalUnallocatedAmount = toNumber(
    allocationSummary.optionalUnallocatedAmount,
  );
  const requiredUnallocatedAmount = Math.max(
    0,
    unallocatedAmount - optionalUnallocatedAmount,
  );
  // The value the baseline must cover: the allocatable value less what the
  // optional rows still leave open. A bill that is optional throughout has
  // nothing that must be approved.
  const requiredBoqAmount = Math.max(
    0,
    allocatableBoqAmount - optionalUnallocatedAmount,
  );
  const baselineLocked = Boolean(
    baselinedRevision || revisionStatus === "baselined",
  );
  const scheduleApproved = ["approved", "baselined"].includes(revisionStatus);

  // ── Structure (setup doc §2 b): what the rows and activities are filed
  // under. All of it is soft (§91): missing structure changes no figure.
  const boqItemById = new Map(boqItems.map((item) => [item.id, item]));
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const wbsNodeCount = wbsNodes.length;
  const locationCount = locations.length;

  // A unit is known when the row already carries its code or its spelling
  // resolves under the organisation's list; the spellings nobody recognises
  // are reported once each, with their rows.
  const resolvedUnitOf = (item) =>
    item.unitCode || normaliseWith(unitIndex, item.unit) || null;
  const unresolvedUnits = new Map();
  const itemsWithUnresolvedUnit = boqItems.filter((item) => {
    const typed = String(item.unit || "").trim();
    if (!typed || resolvedUnitOf(item)) return false;
    const key = typed.toLowerCase();
    const entry = unresolvedUnits.get(key) || { unit: typed, count: 0 };
    entry.count += 1;
    unresolvedUnits.set(key, entry);
    return true;
  });
  const unresolvedUnitItems = [...unresolvedUnits.values()].map((entry) => ({
    type: "unit",
    id: entry.unit,
    code: entry.unit,
    label: `Unit "${entry.unit}" on ${entry.count} BOQ row${entry.count === 1 ? "" : "s"}`,
    missing: "Not in the organisation's unit list",
    href: link(TARGETS.structure),
  }));

  // Filing warnings only say something once the project has the structure
  // to file under: without a WBS, NO_WBS already says it all.
  const itemsWithoutWbs = wbsNodeCount > 0 ? boqItems.filter((item) => !item.wbsNodeId) : [];
  const itemsWithoutCostCode =
    projectCostCodeCount > 0 ? boqItems.filter((item) => !item.costCodeId) : [];
  const activitiesWithoutWbs =
    wbsNodeCount > 0 ? activities.filter((activity) => !activity.wbsNodeId) : [];
  const activitiesWithUnmappedCalendar = activities.filter(
    (activity) => !calendarResolves(activity.calendarId),
  );
  const itemsWithoutMappingRule = boqItems.filter(
    (item) => !MAPPING_RULES.includes(item.mappingRule),
  );

  // ── Mapping quality (§70-§72): the allocation rows whose two ends disagree.
  const allocationLabel = (allocation) => {
    const item = boqItemById.get(allocation.boqItemId);
    const activity = activityById.get(allocation.activityId);
    return `${boqCodeOf(item || {}) || "BOQ row"} → ${
      activity ? activityCodeOf(activity) || activity.name : "activity"
    }`;
  };
  const allocationItem = (allocation, missing) => ({
    type: "allocation",
    id: allocation.id,
    code: null,
    label: allocationLabel(allocation),
    missing,
    href: link(TARGETS.mapping, { type: "boq_item", id: allocation.boqItemId }),
  });
  const unitMismatches = allocations.filter((allocation) => {
    const item = boqItemById.get(allocation.boqItemId);
    const method = activityById.get(allocation.activityId)?.progressMethod;
    if (!item || method?.method !== "quantity" || !method.quantityUnit || !item.unit) {
      return false;
    }
    const itemUnit = resolvedUnitOf(item) || unitKey(item.unit);
    const activityUnit =
      normaliseWith(unitIndex, method.quantityUnit) || unitKey(method.quantityUnit);
    return Boolean(itemUnit && activityUnit) && itemUnit !== activityUnit;
  });
  const locationMismatches = allocations.filter((allocation) => {
    const item = boqItemById.get(allocation.boqItemId);
    const activity = activityById.get(allocation.activityId);
    const itemPath = item?.locationId ? locationById.get(item.locationId)?.path : null;
    const activityPath = activity?.locationId
      ? locationById.get(activity.locationId)?.path
      : null;
    if (!itemPath || !activityPath) return false;
    return !isWithinPath(itemPath, activityPath) && !isWithinPath(activityPath, itemPath);
  });
  // A suggestion becomes a draft with its provenance when it is accepted
  // (mapping doc §6); suggestions themselves are never stored, so the ones
  // "pending" are the accepted drafts nobody has submitted yet.
  const suggestedDrafts = allocations.filter(
    (allocation) => allocation.status === "draft" && allocation.suggestedBy,
  );
  const pendingAllocations = allocations.filter((allocation) =>
    ["draft", "submitted"].includes(allocation.status),
  );
  const summaryItems = Array.isArray(allocationSummary.items) ? allocationSummary.items : [];
  const requiredUnallocatedItems = summaryItems.filter(
    (item) =>
      (item.mappingRule || "required") === "required" &&
      toNumber(item.unallocatedAmount) > MONEY_EPSILON,
  );
  const optionalUnallocatedItems = summaryItems.filter(
    (item) => toNumber(item.optionalUnallocatedAmount) > MONEY_EPSILON,
  );

  // ── The bill's review state (PC-2): the newest applied revision is the
  // one under review; a locked bill needs no further approval.
  const currentBoqRevision =
    boqRevisions.find((revision) =>
      BOQ_CURRENT_REVISION_STATUSES.includes(revision.status),
    ) || null;
  // The locked revision is the one locked last, and a baselined schedule
  // names the lock before it — the same decision boq.service's
  // getBoqBaselineLock makes (newest lockedAt, a missing one first as
  // Postgres sorts it; schedule_baseline first), so
  // the Overview and the BOQ page name the same source and revision.
  const lockedBoqRevision =
    boqRevisions
      .filter((revision) => revision.baselineLocked)
      .sort(
        (a, b) =>
          (b.lockedAt ? new Date(b.lockedAt).getTime() : Infinity) -
            (a.lockedAt ? new Date(a.lockedAt).getTime() : Infinity) ||
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0] || null;
  const boqRevisionStatus = currentBoqRevision?.status || null;
  // The BOQ counts as locked once the schedule is baselined too, exactly as
  // boq.service's getBoqBaselineLock answers it.
  const boqLocked = Boolean(lockedBoqRevision) || baselineLocked;
  const boqApproved = boqLocked || ["approved", "baselined"].includes(boqRevisionStatus);
  const boqRevisionItem = (revision, missing) => ({
    type: "boq_revision",
    id: revision.id,
    code: `Rev ${revision.revisionNumber}`,
    label: revision.label || `BOQ revision ${revision.revisionNumber}`,
    missing,
    href: link(TARGETS.boq, { type: "boq_revision", id: revision.id }),
  });

  // ── Progress methods by kind, for the overview strip.
  const progressMethodsByMethod = activities.reduce((acc, activity) => {
    if (activity.isMilestone || !activity.progressMethod) return acc;
    const method = activity.progressMethod.method || "percent";
    acc[method] = (acc[method] || 0) + 1;
    return acc;
  }, {});
  const quantityMethodsWithoutUnit = activities.filter(
    (activity) =>
      !activity.isMilestone &&
      activity.progressMethod?.method === "quantity" &&
      !activity.progressMethod.quantityUnit,
  );
  const activitiesWithoutMethod = activities.filter(
    (activity) => !activity.isMilestone && !activity.progressMethod,
  );
  const activitiesWithoutEngineer = activities.filter(
    (activity) => !activity.isMilestone && !(activity.assignments?.length > 0),
  );
  // Critical activities with no approved allocation earn nothing when they
  // progress (§33's "critical unmapped activities").
  const activityIdsWithApprovedAllocation = new Set(
    allocations
      .filter((allocation) => allocation.status === "approved")
      .map((allocation) => allocation.activityId),
  );
  const criticalUnmappedActivities = activities.filter(
    (activity) =>
      activity.isCritical &&
      !activity.isMilestone &&
      !activityIdsWithApprovedAllocation.has(activity.id),
  );

  // The bill's review trail (PC-2), as recorded: the transitions on the
  // revision under review, with the actor named through their membership
  // in this workspace. A bill entered by hand has no revision and no trail.
  const boqRevisionEvents = currentBoqRevision
    ? await prisma.approvalWorkflowEvent.findMany({
        where: {
          projectId,
          recordType: BOQ_REVISION_RECORD_TYPE,
          recordId: currentBoqRevision.id,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          action: true,
          fromStatus: true,
          toStatus: true,
          actorId: true,
          actorRole: true,
          decision: true,
          reason: true,
          comment: true,
          createdAt: true,
        },
      })
    : [];
  const actorIds = [...new Set(boqRevisionEvents.map((event) => event.actorId).filter(Boolean))];
  const actorMemberships = actorIds.length
    ? await prisma.organizationMembership.findMany({
        where: { orgId, userId: { in: actorIds } },
        select: { userId: true, user: { select: { name: true } } },
      })
    : [];
  const actorNameById = new Map(
    actorMemberships.map((membership) => [membership.userId, membership.user?.name || null]),
  );
  const boqRevisionHistory = boqRevisionEvents.slice(-HISTORY_CAP).map((event) => ({
    id: event.id,
    action: event.action,
    fromStatus: event.fromStatus || null,
    toStatus: event.toStatus || null,
    actorId: event.actorId || null,
    actorName: event.actorId ? actorNameById.get(event.actorId) || null : null,
    actorRole: event.actorRole || null,
    decision: event.decision || null,
    reason: event.reason || null,
    comment: event.comment || null,
    at: toIso(event.createdAt),
  }));
  // The rows the upload's comparison could not apply (a manual row with the
  // same code, PC-2): the revision's validation findings, sampled.
  const boqRevisionBlockedRows = Array.isArray(currentBoqRevision?.compareJson?.blocked)
    ? currentBoqRevision.compareJson.blocked.slice(0, ITEM_CAP).map((row) => ({
        code: row.code ?? null,
        description: row.description ?? null,
        // PC-2 records the machine code (`reason`, e.g.
        // DUPLICATE_BOQ_ITEM_CODE) and the sentence a person reads
        // (`message`); both are passed on, and the wizard shows the sentence.
        reason: row.reason ?? null,
        message: row.message ?? row.reason ?? null,
      }))
    : [];

  const profileBlockers = [
    !project.startDate &&
      issue("PROJECT_START_MISSING", "Project start date is missing.", "blocking", {}, [
        projectItem("Start date"),
      ]),
    !project.endDate &&
      issue("PROJECT_END_MISSING", "Project end date is missing.", "blocking", {}, [
        projectItem("End date"),
      ]),
  ];
  const profileWarnings = [
    !project.contractValue &&
      issue(
        "CONTRACT_VALUE_MISSING",
        "Contract value is not set for cost and EV checks.",
        "warning",
        {},
        [projectItem("Contract value")],
      ),
    !project.duration &&
      issue(
        "PROJECT_DURATION_MISSING",
        "Project duration is not set for onboarding review.",
        "warning",
        {},
        [projectItem("Duration")],
      ),
    (!project.clientName || !project.contractorName) &&
      issue(
        "PARTIES_INCOMPLETE",
        "Contract parties are incomplete.",
        "warning",
        {},
        [projectItem(!project.clientName ? "Client" : "Contractor")],
      ),
  ];

  const structureWarnings = [
    wbsNodeCount === 0 &&
      issue(
        "NO_WBS",
        "No WBS nodes exist yet; BOQ rows and activities cannot be grouped by scope.",
        "warning",
        {},
        [
          {
            type: "wbs",
            id: null,
            code: null,
            label: "Work breakdown structure",
            missing: "No nodes",
            href: link(TARGETS.structure),
          },
        ],
      ),
    locationCount === 0 &&
      issue(
        "NO_LOCATIONS",
        "No locations exist yet; work cannot be placed by zone or level.",
        "warning",
        {},
        [
          {
            type: "location",
            id: null,
            code: null,
            label: "Locations tree",
            missing: "No locations",
            href: link(TARGETS.locations),
          },
        ],
      ),
    projectCostCodeCount === 0 &&
      issue(
        "NO_PROJECT_COST_CODES",
        "No cost codes are selected for the project; cost loading has no budget buckets.",
        "warning",
        {},
        [
          {
            type: "cost_code",
            id: null,
            code: null,
            label: "Project cost codes",
            missing: "None selected",
            href: link(TARGETS.budget),
          },
        ],
      ),
    unresolvedUnitItems.length > 0 &&
      issue(
        "UOM_UNRESOLVED",
        `${unresolvedUnitItems.length} unit spelling${unresolvedUnitItems.length === 1 ? " is" : "s are"} not in the organisation's unit list.`,
        "warning",
        { unitsUnresolved: unresolvedUnitItems.length, rows: itemsWithUnresolvedUnit.length },
        unresolvedUnitItems,
      ),
  ];

  const boqBlockers = [
    boqCount === 0 && issue("NO_BOQ", "No BOQ items have been uploaded."),
    boqCount > 0 &&
      totalBoqAmount <= MONEY_EPSILON &&
      issue("BOQ_HAS_NO_VALUE", "BOQ items have no measurable value."),
  ];
  const boqWarnings = [
    itemsWithoutWbs.length > 0 &&
      issue(
        "BOQ_ITEMS_WITHOUT_WBS",
        `${itemsWithoutWbs.length} BOQ row${itemsWithoutWbs.length === 1 ? " has" : "s have"} no WBS node.`,
        "warning",
        { itemsWithoutWbs: itemsWithoutWbs.length },
        itemsWithoutWbs.map((item) => boqItemItem(item, "WBS node")),
      ),
    itemsWithoutCostCode.length > 0 &&
      issue(
        "BOQ_ITEMS_WITHOUT_COST_CODE",
        `${itemsWithoutCostCode.length} BOQ row${itemsWithoutCostCode.length === 1 ? " has" : "s have"} no cost code.`,
        "warning",
        { itemsWithoutCostCode: itemsWithoutCostCode.length },
        itemsWithoutCostCode.map((item) => boqItemItem(item, "Cost code")),
      ),
    itemsWithUnresolvedUnit.length > 0 &&
      issue(
        "BOQ_UNIT_UNRESOLVED",
        `${itemsWithUnresolvedUnit.length} BOQ row${itemsWithUnresolvedUnit.length === 1 ? " carries" : "s carry"} a unit the organisation does not recognise.`,
        "warning",
        { itemsWithUnresolvedUnit: itemsWithUnresolvedUnit.length },
        itemsWithUnresolvedUnit.map((item) =>
          boqItemItem(item, `Unit "${item.unit}" is not recognised`),
        ),
      ),
  ];

  // Approval of the bill is advisory here: the schedule baseline lock does
  // not consult it today, and a bill entered by hand has no revision to
  // approve, so a blocker would refuse projects that pass now (§134 — no
  // soft check becomes hard). Nothing warns before the bill exists.
  const boqApprovalWarnings =
    boqCount === 0 || boqApproved
      ? []
      : [
          boqRevisionStatus === "under_review" &&
            issue(
              "PENDING_BOQ_REVISION",
              `BOQ revision ${currentBoqRevision.revisionNumber} is awaiting approval.`,
              "warning",
              { revisionId: currentBoqRevision.id, revisionStatus: boqRevisionStatus },
              [boqRevisionItem(currentBoqRevision, "Approval")],
            ),
          boqRevisionStatus !== "under_review" &&
            issue(
              "BOQ_REVISION_NOT_APPROVED",
              currentBoqRevision
                ? `BOQ revision ${currentBoqRevision.revisionNumber} has not been submitted for approval.`
                : "The bill has no revision under review; rows entered by hand are approved by locking the BOQ baseline.",
              "warning",
              { revisionId: currentBoqRevision?.id || null, revisionStatus: boqRevisionStatus },
              currentBoqRevision ? [boqRevisionItem(currentBoqRevision, "Submit and approve")] : [],
            ),
        ];
  const mappingRuleWarnings = [
    itemsWithoutMappingRule.length > 0 &&
      issue(
        "BOQ_MAPPING_RULE_UNSET",
        `${itemsWithoutMappingRule.length} BOQ row${itemsWithoutMappingRule.length === 1 ? " has" : "s have"} no mapping rule (required, optional or not applicable).`,
        "warning",
        { itemsWithoutMappingRule: itemsWithoutMappingRule.length },
        itemsWithoutMappingRule.map((item) => boqItemItem(item, "Mapping rule", TARGETS.mapping)),
      ),
  ];

  const scheduleBlockers = [
    !currentRevision &&
      activeActivityCount === 0 &&
      issue(
        "NO_SCHEDULE",
        "No generated or imported schedule revision was found.",
      ),
    currentRevision &&
      activeActivityCount === 0 &&
      toNumber(currentRevision.activityCount) === 0 &&
      issue("NO_ACTIVITIES", "The current schedule has no activities."),
    revisionStatus === "rejected" &&
      issue(
        "SCHEDULE_REJECTED",
        "Latest schedule revision was rejected and needs resubmission.",
      ),
  ];
  const scheduleWarnings = [
    currentRevision &&
      activeActivityCount === 0 &&
      toNumber(currentRevision.activityCount) > 0 &&
      issue(
        "SCHEDULE_NOT_ACTIVE",
        "Schedule revision exists, but no active activities are available yet.",
        "warning",
      ),
    activeActivityCount > 1 &&
      criticalActivityCount === 0 &&
      issue(
        "NO_CRITICAL_PATH",
        "No critical path activities are marked yet.",
        "warning",
      ),
    activitiesWithoutWbs.length > 0 &&
      issue(
        "ACTIVITIES_WITHOUT_WBS",
        `${activitiesWithoutWbs.length} activit${activitiesWithoutWbs.length === 1 ? "y has" : "ies have"} no WBS node.`,
        "warning",
        { activitiesWithoutWbs: activitiesWithoutWbs.length },
        activitiesWithoutWbs.map((activity) => activityItem(activity, "WBS node")),
      ),
    activitiesWithUnmappedCalendar.length > 0 &&
      issue(
        "IMPORTED_CALENDAR_UNMAPPED",
        `${activitiesWithUnmappedCalendar.length} activit${activitiesWithUnmappedCalendar.length === 1 ? "y uses" : "ies use"} an imported calendar that is not mapped to a working calendar.`,
        "warning",
        { activitiesWithUnmappedCalendar: activitiesWithUnmappedCalendar.length },
        activitiesWithUnmappedCalendar.map((activity) =>
          activityItem(activity, `Calendar "${activity.calendarId}" is not mapped`),
        ),
      ),
  ];

  const allocationBlockers = [
    boqCount === 0 &&
      issue(
        "ALLOCATION_WAITING_FOR_BOQ",
        "Upload BOQ items before mapping allocations.",
      ),
    activeActivityCount === 0 &&
      issue(
        "ALLOCATION_WAITING_FOR_SCHEDULE",
        "Generate or import a schedule before mapping allocations.",
      ),
    boqCount > 0 &&
      requiredBoqAmount > MONEY_EPSILON &&
      approvedAllocatedAmount <= MONEY_EPSILON &&
      issue(
        "NO_APPROVED_ALLOCATIONS",
        "No approved BOQ allocations are linked to schedule activities.",
        "blocking",
        {},
        requiredUnallocatedItems.map((item) =>
          boqItemItem(item, "Approved allocation", TARGETS.mapping),
        ),
      ),
    allocatableBoqAmount > MONEY_EPSILON &&
      requiredUnallocatedAmount > MONEY_EPSILON &&
      issue(
        "UNALLOCATED_BOQ",
        "BOQ value remains unallocated to approved schedule activities.",
        "blocking",
        {
          unallocatedAmount: requiredUnallocatedAmount,
          optionalUnallocatedAmount,
          notApplicableAmount,
        },
        requiredUnallocatedItems.map((item) =>
          boqItemItem(
            item,
            `${toNumber(item.unallocatedAmount).toFixed(2)} unallocated`,
            TARGETS.mapping,
          ),
        ),
      ),
  ];
  const allocationWarnings = [
    optionalUnallocatedAmount > MONEY_EPSILON &&
      issue(
        "OPTIONAL_UNALLOCATED",
        "Optional BOQ value is not allocated; it does not block the baseline.",
        "warning",
        { optionalUnallocatedAmount },
        optionalUnallocatedItems.map((item) =>
          boqItemItem(
            item,
            `${toNumber(item.optionalUnallocatedAmount).toFixed(2)} optional value open`,
            TARGETS.mapping,
          ),
        ),
      ),
    pendingAllocatedAmount > MONEY_EPSILON &&
      issue(
        "PENDING_ALLOCATIONS",
        "Some allocations are still pending approval.",
        "warning",
        { pendingAllocatedAmount },
        pendingAllocations.map((allocation) =>
          allocationItem(allocation, allocation.status === "draft" ? "Submit" : "Approve"),
        ),
      ),
    suggestedDrafts.length > 0 &&
      issue(
        "SUGGESTIONS_PENDING",
        `${suggestedDrafts.length} accepted suggestion${suggestedDrafts.length === 1 ? " is" : "s are"} still a draft.`,
        "warning",
        { suggestionsPending: suggestedDrafts.length },
        suggestedDrafts.map((allocation) =>
          allocationItem(allocation, `Suggested by ${allocation.suggestedBy}; submit it`),
        ),
      ),
    unitMismatches.length > 0 &&
      issue(
        "UNIT_MISMATCH_COUNT",
        `${unitMismatches.length} allocation${unitMismatches.length === 1 ? "" : "s"} measure${unitMismatches.length === 1 ? "s" : ""} the activity in a different unit from the BOQ row.`,
        "warning",
        { unitMismatchCount: unitMismatches.length },
        unitMismatches.map((allocation) => {
          const item = boqItemById.get(allocation.boqItemId);
          const method = activityById.get(allocation.activityId)?.progressMethod;
          return allocationItem(
            allocation,
            `BOQ unit "${item?.unit}" vs progress unit "${method?.quantityUnit}"`,
          );
        }),
      ),
    locationMismatches.length > 0 &&
      issue(
        "LOCATION_MISMATCH_COUNT",
        `${locationMismatches.length} allocation${locationMismatches.length === 1 ? " links" : "s link"} a BOQ row and an activity in different locations.`,
        "warning",
        { locationMismatchCount: locationMismatches.length },
        locationMismatches.map((allocation) =>
          allocationItem(allocation, "BOQ row and activity are in different locations"),
        ),
      ),
  ];

  const costBlockers = [
    approvedCostLoadingCount === 0 &&
      issue(
        "NO_APPROVED_COST_LOADING",
        "No approved time-phased cost loading rows are available for official EV.",
      ),
    reportingPeriodCount === 0 &&
      issue(
        "NO_REPORTING_PERIODS",
        "No EV reporting periods have been created for official reporting.",
      ),
  ];
  const costWarnings = [
    costRecordCount === 0 &&
      issue(
        "NO_COST_RECORDS",
        "No activity cost records are available for cost control review.",
        "warning",
      ),
  ];

  const assignmentWarnings = [
    progressActivityCount > 0 &&
      assignedProgressActivityCount < progressActivityCount &&
      issue(
        "ENGINEER_ASSIGNMENTS_INCOMPLETE",
        "Some progress activities do not have assigned engineers.",
        "warning",
        {
          assignedProgressActivityCount,
          progressActivityCount,
        },
        activitiesWithoutEngineer.map((activity) => activityItem(activity, "Engineer")),
      ),
  ];

  const scheduleRevisionItem = (revision, missing) => ({
    type: "schedule_revision",
    id: revision.id,
    code: null,
    label: revision.label || "Schedule revision",
    missing,
    href: link(TARGETS.scheduleRevisions, { type: "schedule_revision", id: revision.id }),
  });
  const approvalBlockers = [
    !currentRevision &&
      issue("NO_SCHEDULE_REVISION", "No schedule revision is available."),
    currentRevision &&
      !scheduleApproved &&
      issue(
        "NO_APPROVED_SCHEDULE",
        "No approved schedule revision is available for baseline/progress.",
        "blocking",
        { revisionStatus },
        [scheduleRevisionItem(currentRevision, "Approval")],
      ),
  ];

  const readinessBlockers = (scheduleReadiness?.checks || [])
    .filter((check) => check.severity === "blocking" && !check.passed)
    .map((check) =>
      issue(
        `SCHEDULE_${check.key.toUpperCase()}_FAILED`,
        check.message,
        "blocking",
        { checkKey: check.key },
        itemsFromCheckDetails(check, activityById, (activity, missing) =>
          activityItem(activity, missing),
        ),
      ),
    );
  const readinessWarnings = (scheduleReadiness?.checks || [])
    .filter((check) => check.severity !== "blocking" && !check.passed)
    .map((check) =>
      issue(
        `SCHEDULE_${check.key.toUpperCase()}_WARNING`,
        check.message,
        "warning",
        { checkKey: check.key },
        itemsFromCheckDetails(check, activityById, (activity, missing) =>
          activityItem(activity, missing),
        ),
      ),
    );

  const progressMethodItems = activitiesWithoutMethod.map((activity) =>
    activityItem(activity, "Progress method", TARGETS.scheduleProgress),
  );
  const progressBlockers = [
    !baselineLocked &&
      issue(
        "BASELINE_NOT_LOCKED",
        "Official progress should wait until the approved baseline is locked.",
        "blocking",
        {},
        currentRevision ? [scheduleRevisionItem(currentRevision, "Baseline lock")] : [],
      ),
    activeActivityCount === 0 &&
      issue(
        "NO_ACTIVE_ACTIVITIES",
        "No active activities are ready for progress.",
      ),
    approvedAllocatedAmount <= MONEY_EPSILON &&
      boqCount > 0 &&
      issue(
        "NO_PROGRESS_ALLOCATIONS",
        "Approved BOQ allocations are required before progress can drive EV.",
      ),
  ];
  const progressWarnings = [
    progressActivityCount > 0 &&
      progressMethodCount < progressActivityCount &&
      issue(
        "PROGRESS_METHODS_INCOMPLETE",
        "Some activities still use default progress methods.",
        "warning",
        { progressMethodCount, progressActivityCount },
        progressMethodItems,
      ),
    ...assignmentWarnings,
  ];

  const progressMethodBlockers = [
    progressActivityCount > 0 &&
      progressMethodCount < progressActivityCount &&
      issue(
        "PROGRESS_METHODS_INCOMPLETE",
        "Configure progress methods before locking official EV/reporting snapshots.",
        "blocking",
        { progressMethodCount, progressActivityCount },
        progressMethodItems,
      ),
  ];
  const progressMethodWarnings = [
    quantityMethodsWithoutUnit.length > 0 &&
      issue(
        "QUANTITY_METHOD_WITHOUT_UNIT",
        `${quantityMethodsWithoutUnit.length} quantity-measured activit${quantityMethodsWithoutUnit.length === 1 ? "y has" : "ies have"} no unit.`,
        "warning",
        { quantityMethodsWithoutUnit: quantityMethodsWithoutUnit.length },
        quantityMethodsWithoutUnit.map((activity) =>
          activityItem(activity, "Quantity unit", TARGETS.scheduleProgress),
        ),
      ),
  ];

  // What the structure step guides (§21): the six things the bill and the
  // programme are filed under and matched by, each with where it is done.
  // Every figure here is one the steps below already derive — the guide
  // is a signpost, never a second readiness engine.
  const coveragePct = toNumber(allocationSummary.coveragePct);
  const guide = ({ key, label, status, count, detail, target }) => ({
    key,
    label,
    status,
    count,
    detail,
    target,
    href: link(target),
  });
  const guideStatus = (ready, prerequisite = true) =>
    !prerequisite ? STATUS.PENDING : ready ? STATUS.COMPLETE : STATUS.ATTENTION;
  const structureGuides = [
    guide({
      key: "wbs",
      label: "WBS",
      status: guideStatus(wbsNodeCount > 0),
      count: wbsNodeCount,
      detail: wbsNodeCount > 0 ? `${wbsNodeCount} node${wbsNodeCount === 1 ? "" : "s"}` : "No nodes yet",
      target: TARGETS.structure,
    }),
    guide({
      key: "locations",
      label: "Locations",
      status: guideStatus(locationCount > 0),
      count: locationCount,
      detail:
        locationCount > 0 ? `${locationCount} location${locationCount === 1 ? "" : "s"}` : "No locations yet",
      target: TARGETS.locations,
    }),
    guide({
      key: "cost_codes",
      label: "Cost codes",
      status: guideStatus(projectCostCodeCount > 0),
      count: projectCostCodeCount,
      detail:
        projectCostCodeCount > 0
          ? `${projectCostCodeCount} selected`
          : "None selected for the project",
      target: TARGETS.budget,
    }),
    guide({
      key: "boq_structure",
      label: "BOQ structure",
      status: guideStatus(
        wbsNodeCount > 0 && itemsWithoutWbs.length === 0 && itemsWithUnresolvedUnit.length === 0,
        boqCount > 0,
      ),
      count: itemsWithoutWbs.length + itemsWithUnresolvedUnit.length,
      detail:
        boqCount === 0
          ? "Upload the bill first"
          : wbsNodeCount === 0
            ? "Rows cannot be filed until the WBS exists"
            : [
                itemsWithoutWbs.length > 0 &&
                  `${itemsWithoutWbs.length} row${itemsWithoutWbs.length === 1 ? "" : "s"} without a WBS node`,
                itemsWithUnresolvedUnit.length > 0 &&
                  `${itemsWithUnresolvedUnit.length} with an unknown unit`,
              ]
                .filter(Boolean)
                .join(" · ") || "Every row is filed",
      target: TARGETS.boq,
    }),
    guide({
      key: "schedule_structure",
      label: "Schedule structure",
      status: guideStatus(
        wbsNodeCount > 0 &&
          activitiesWithoutWbs.length === 0 &&
          activitiesWithUnmappedCalendar.length === 0,
        activeActivityCount > 0,
      ),
      count: activitiesWithoutWbs.length + activitiesWithUnmappedCalendar.length,
      detail:
        activeActivityCount === 0
          ? "Generate or import the schedule first"
          : wbsNodeCount === 0
            ? "Activities cannot be filed until the WBS exists"
            : [
                activitiesWithoutWbs.length > 0 &&
                  `${activitiesWithoutWbs.length} activit${activitiesWithoutWbs.length === 1 ? "y" : "ies"} without a WBS node`,
                activitiesWithUnmappedCalendar.length > 0 &&
                  `${activitiesWithUnmappedCalendar.length} on an unmapped calendar`,
              ]
                .filter(Boolean)
                .join(" · ") || "Every activity is filed",
      target: TARGETS.activities,
    }),
    guide({
      key: "mapping_readiness",
      label: "Mapping readiness",
      status: guideStatus(
        itemsWithoutMappingRule.length === 0 && requiredUnallocatedAmount <= MONEY_EPSILON,
        boqCount > 0 && activeActivityCount > 0,
      ),
      count: itemsWithoutMappingRule.length + requiredUnallocatedItems.length,
      detail:
        boqCount === 0 || activeActivityCount === 0
          ? "Needs the bill and the schedule"
          : [
              `${Math.round(coveragePct)}% covered`,
              itemsWithoutMappingRule.length > 0 &&
                `${itemsWithoutMappingRule.length} row${itemsWithoutMappingRule.length === 1 ? "" : "s"} without a rule`,
              requiredUnallocatedItems.length > 0 &&
                `${requiredUnallocatedItems.length} required row${requiredUnallocatedItems.length === 1 ? "" : "s"} open`,
            ]
              .filter(Boolean)
              .join(" · "),
      target: TARGETS.mapping,
    }),
  ];

  // The §89 sequence: structure between profile and BOQ upload, the bill's
  // approval right after its upload. The ten original steps keep their keys,
  // their gates and their meaning.
  const builtSteps = [
    buildStep({
      key: "project_profile",
      label: "Project Profile",
      description: "Core contract dates and project metadata.",
      action: { label: "Review Profile", target: TARGETS.overview },
      requiredFor: ["baseline", "progress", "reporting"],
      complete: profileBlockers.filter(Boolean).length === 0,
      blockers: profileBlockers,
      warnings: profileWarnings,
      counts: {
        hasStartDate: Boolean(project.startDate),
        hasEndDate: Boolean(project.endDate),
        hasContractValue: Boolean(project.contractValue),
      },
      successMessage: "Project dates are available.",
    }),
    buildStep({
      key: "structure_setup",
      label: "Structure",
      description:
        "WBS, locations, cost codes and units the bill and the programme are filed under.",
      action: { label: "Open Structure", target: TARGETS.structure },
      complete: structureWarnings.filter(Boolean).length === 0,
      warnings: structureWarnings,
      counts: {
        wbsNodes: wbsNodeCount,
        locations: locationCount,
        projectCostCodes: projectCostCodeCount,
        unitsUnresolved: unresolvedUnitItems.length,
      },
      guides: structureGuides,
      successMessage: "Structure is in place.",
    }),
    buildStep({
      key: "boq_upload",
      label: "BOQ Upload",
      description: "Measured BOQ rows are loaded for schedule and cost setup.",
      action: { label: "Open BOQ", target: TARGETS.boq },
      requiredFor: ["baseline", "progress", "reporting"],
      complete: boqBlockers.filter(Boolean).length === 0,
      blockers: boqBlockers,
      warnings: boqWarnings,
      counts: {
        boqItems: boqCount,
        totalBoqAmount,
        itemsWithoutWbs: itemsWithoutWbs.length,
        itemsWithoutCostCode: itemsWithoutCostCode.length,
        itemsWithUnresolvedUnit: itemsWithUnresolvedUnit.length,
      },
      successMessage: "BOQ is loaded.",
    }),
    buildStep({
      key: "boq_approval",
      label: "BOQ Approval",
      description: "The current BOQ revision is reviewed, approved and locked.",
      action: { label: "Review BOQ", target: TARGETS.boq },
      complete: boqCount > 0 && boqApproved,
      warnings: [...boqApprovalWarnings, ...mappingRuleWarnings],
      counts: {
        revisionId: currentBoqRevision?.id || null,
        revisionNumber: currentBoqRevision?.revisionNumber ?? null,
        revisionStatus: boqRevisionStatus,
        baselineLocked: boqLocked,
        itemsWithoutMappingRule: itemsWithoutMappingRule.length,
        revisionItems: currentBoqRevision?.itemCount ?? null,
        revisionChanges: currentBoqRevision
          ? currentBoqRevision.addedCount +
            currentBoqRevision.updatedCount +
            currentBoqRevision.removedCount
          : null,
        revisionBlockedRows: currentBoqRevision?.blockedCount ?? null,
      },
      successMessage: boqLocked ? "BOQ baseline is locked." : "BOQ revision is approved.",
    }),
    buildStep({
      key: "schedule_generation",
      label: "Schedule Generation",
      description: "AI/P6/MSP schedule activities are available.",
      action: { label: "Open Schedule", target: TARGETS.schedule },
      requiredFor: ["baseline", "progress", "reporting"],
      complete:
        scheduleBlockers.filter(Boolean).length === 0 &&
        (activeActivityCount > 0 ||
          toNumber(currentRevision?.activityCount) > 0),
      blockers: scheduleBlockers,
      warnings: scheduleWarnings,
      counts: {
        revisionId: currentRevision?.id || null,
        revisionStatus: currentRevision ? revisionStatus : null,
        activeActivities: activeActivityCount,
        progressActivities: progressActivityCount,
        criticalActivities: criticalActivityCount,
        milestones: milestoneCount,
        activitiesWithoutWbs: activitiesWithoutWbs.length,
        activitiesWithUnmappedCalendar: activitiesWithUnmappedCalendar.length,
      },
      successMessage: "Schedule activities are available.",
    }),
    buildStep({
      key: "boq_allocation",
      label: "BOQ Allocation",
      description: "BOQ value is approved and linked to schedule activities.",
      action: { label: "Map Allocations", target: TARGETS.boq },
      requiredFor: ["baseline", "progress", "reporting"],
      complete: allocationBlockers.filter(Boolean).length === 0,
      blockers: allocationBlockers,
      warnings: allocationWarnings,
      counts: {
        totalBoqAmount: totalBoqFromSummary,
        allocatableBoqAmount,
        approvedAllocatedAmount,
        pendingAllocatedAmount,
        unallocatedAmount,
        optionalUnallocatedAmount,
        notApplicableAmount,
        suggestionsPending: suggestedDrafts.length,
        unitMismatchCount: unitMismatches.length,
        locationMismatchCount: locationMismatches.length,
      },
      successMessage: "Approved allocations cover the BOQ value.",
    }),
    buildStep({
      key: "cost_loading_review",
      label: "Cost Loading Review",
      description:
        "Cost records and official EV cost loading basis are checked.",
      action: { label: "Review EV Basis", target: TARGETS.scheduleEv },
      requiredFor: ["reporting"],
      complete:
        costRecordCount > 0 &&
        approvedCostLoadingCount > 0 &&
        reportingPeriodCount > 0,
      blockers: costBlockers,
      warnings: costWarnings,
      counts: {
        costRecords: costRecordCount,
        approvedCostLoadingRows: approvedCostLoadingCount,
        reportingPeriods: reportingPeriodCount,
      },
      successMessage: "Cost loading basis is ready for official EV.",
    }),
    buildStep({
      key: "engineer_assignment",
      label: "Engineer Assignment",
      description: "Progress activities have responsible field engineers.",
      action: { label: "Assign Engineers", target: TARGETS.activities },
      complete:
        progressActivityCount === 0 ||
        assignedProgressActivityCount >= progressActivityCount,
      warnings: assignmentWarnings,
      counts: {
        assignedProgressActivities: assignedProgressActivityCount,
        progressActivities: progressActivityCount,
      },
      successMessage: "Field engineer assignments are complete.",
    }),
    buildStep({
      key: "progress_method_configuration",
      label: "Progress Methods",
      description:
        "Progress activities have explicit measurement methods for official EV.",
      action: { label: "Configure Methods", target: TARGETS.scheduleProgress },
      requiredFor: ["reporting"],
      complete:
        progressActivityCount === 0 ||
        progressMethodCount >= progressActivityCount,
      blockers: progressMethodBlockers,
      warnings: progressMethodWarnings,
      counts: {
        progressMethodCount,
        progressActivities: progressActivityCount,
        quantityMethodsWithoutUnit: quantityMethodsWithoutUnit.length,
      },
      successMessage: "Progress methods are configured.",
    }),
    buildStep({
      key: "schedule_approval",
      label: "Schedule Approval",
      description: "Schedule revision has passed PM approval.",
      action: { label: "Open Review", target: TARGETS.scheduleRevisions },
      requiredFor: ["baseline", "progress", "reporting"],
      complete: approvalBlockers.filter(Boolean).length === 0,
      blockers: approvalBlockers,
      counts: {
        revisionId: currentRevision?.id || null,
        revisionStatus: currentRevision ? revisionStatus : null,
        approvedAt: toIso(currentRevision?.approvedAt),
      },
      successMessage: "Schedule is approved.",
    }),
    buildStep({
      key: "baseline_readiness",
      label: "Baseline Readiness",
      description: "Approved schedule passes baseline lock checks.",
      action: { label: "Lock Baseline", target: TARGETS.scheduleRevisions },
      requiredFor: ["baseline", "progress", "reporting"],
      complete: baselineLocked,
      blockers: scheduleApproved ? readinessBlockers : [],
      warnings: baselineLocked
        ? readinessWarnings
        : [
            !scheduleApproved &&
              issue(
                "BASELINE_WAITING_FOR_APPROVAL",
                "Baseline readiness runs after schedule approval.",
                "warning",
              ),
            scheduleApproved &&
              readinessBlockers.length === 0 &&
              issue(
                "BASELINE_READY_TO_LOCK",
                "Schedule is ready for baseline lock.",
                "warning",
                {},
                currentRevision ? [scheduleRevisionItem(currentRevision, "Baseline lock")] : [],
              ),
            ...readinessWarnings,
          ],
      counts: {
        baselineLocked,
        baselinedRevisionId: baselinedRevision?.id || null,
        readinessReady: Boolean(scheduleReadiness?.ready),
        readinessBlockingCount: scheduleReadiness?.blockingCount ?? null,
      },
      successMessage: "Baseline is locked.",
    }),
    buildStep({
      key: "progress_readiness",
      label: "Progress Readiness",
      description: "Progress entry has the baseline and field setup it needs.",
      action: { label: "Open Progress", target: TARGETS.scheduleProgress },
      requiredFor: ["progress", "reporting"],
      complete:
        progressBlockers.filter(Boolean).length === 0 &&
        progressWarnings.filter(Boolean).length === 0,
      blockers: progressBlockers,
      warnings: progressWarnings,
      counts: {
        baselineLocked,
        progressActivities: progressActivityCount,
        progressMethodCount,
        assignedProgressActivities: assignedProgressActivityCount,
      },
      successMessage: "Project is ready for progress entry.",
    }),
  ];
  // The same steps for everyone; a caller who cannot read the BOQ gets them
  // without the BOQ records named under each issue and without the bill's
  // money in the step counts and the issue details. Statuses, codes and
  // issue counts are untouched, so the gates below — built from these same
  // steps — are identical for every caller, and carry no BOQ figure either.
  const steps = canReadBoq
    ? builtSteps
    : builtSteps.map((step) => ({
        ...step,
        blockers: step.blockers.map(withoutBoqDetail),
        warnings: step.warnings.map(withoutBoqDetail),
        counts: withoutBoqFigures(step.counts),
      }));

  const baselineBlockers = addStepContext(
    steps.filter((step) => step.requiredFor.includes("baseline")),
  );
  const progressBlockerDetails = addStepContext(
    steps.filter((step) => step.requiredFor.includes("progress")),
  );
  const reportingBlockerDetails = addStepContext(
    steps.filter((step) => step.requiredFor.includes("reporting")),
  );
  const reportingWarningDetails = addStepWarningContext(
    steps.filter((step) => step.requiredFor.includes("reporting")),
  );
  const nextStep = firstNextAction(steps.filter((step) => !ADVISORY_STEP_KEYS.has(step.key)));
  const advisoryStep = firstNextAction(steps.filter((step) => ADVISORY_STEP_KEYS.has(step.key)));

  // The §69 coverage totals, exactly as PC-3's summary reports them (the
  // per-item rows stay on the coverage endpoint). Never recomputed here.
  // The coverage endpoint needs boq:read; without it only the share covered
  // and the row counts are given — no quantity, value, earned or certified
  // figure.
  const coverage = canReadBoq
    ? Object.fromEntries(
        Object.entries(allocationSummary).filter(
          ([key]) => !["items", "groups"].includes(key),
        ),
      )
    : {
        coveragePct: allocationSummary.coveragePct,
        counts: allocationSummary.counts,
      };

  // The §33 headline: one line a person reads before the cards — "BOQ
  // imported PASS · Schedule imported PASS · Mapping 83% · …". Every entry
  // restates a figure the steps above derive; the tone says whether a gate
  // stands in the way (blocked), a warning is worth a look (review), or the
  // thing is done. Money is in the project's currency.
  const formatHeadlineMoney = (value) =>
    `${Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}${
      project.currency ? ` ${project.currency}` : ""
    }`;
  const baselineBlockerCodes = new Set(baselineBlockers.map((blocker) => blocker.code));
  const headlineItem = (key, label, value, tone, raw = null) => ({ key, label, value, tone, raw });
  const boqImported = boqBlockers.filter(Boolean).length === 0;
  const scheduleImported = scheduleBlockers.filter(Boolean).length === 0;
  const costLoadingComplete = approvedCostLoadingCount > 0 && reportingPeriodCount > 0;
  // §33's "Unmapped BOQ quantity 1,250 m3": the unallocated quantity PC-3's
  // summary already gives each row, grouped by the row's unit — quantities
  // in different units are never added together. The units are listed by
  // the value they leave open, the three largest, then how many more.
  const unmappedByUnit = new Map();
  for (const summaryItem of summaryItems) {
    const quantity = toNumber(summaryItem.unallocatedQuantity);
    if (quantity <= 0) continue;
    const row = boqItemById.get(summaryItem.boqItemId) || {};
    const typed = String(row.unit || "").trim();
    const key = resolvedUnitOf(row) || unitKey(typed) || "";
    const entry = unmappedByUnit.get(key) || { unit: typed || null, quantity: 0, amount: 0 };
    entry.quantity += quantity;
    entry.amount = addMoney(entry.amount, summaryItem.unallocatedAmount);
    unmappedByUnit.set(key, entry);
  }
  const unmappedQuantities = [...unmappedByUnit.values()].sort((a, b) => b.amount - a.amount);
  const UNMAPPED_UNITS_SHOWN = 3;
  const unmappedQuantityText =
    unmappedQuantities.length === 0
      ? "0"
      : [
          ...unmappedQuantities.slice(0, UNMAPPED_UNITS_SHOWN).map(
            (entry) =>
              `${entry.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${
                entry.unit || "(no unit)"
              }`,
          ),
          unmappedQuantities.length > UNMAPPED_UNITS_SHOWN &&
            `+${unmappedQuantities.length - UNMAPPED_UNITS_SHOWN} more unit${
              unmappedQuantities.length - UNMAPPED_UNITS_SHOWN === 1 ? "" : "s"
            }`,
        ]
          .filter(Boolean)
          .join(" · ");
  const headline = [
    headlineItem(
      "boq_imported",
      "BOQ imported",
      boqImported ? "PASS" : "FAIL",
      boqImported ? "done" : "blocked",
      boqImported,
    ),
    headlineItem(
      "schedule_imported",
      "Schedule imported",
      scheduleImported ? "PASS" : "FAIL",
      scheduleImported ? "done" : "blocked",
      scheduleImported,
    ),
    headlineItem(
      "mapping",
      "Mapping",
      `${Math.round(coveragePct)}%`,
      baselineBlockerCodes.has("UNALLOCATED_BOQ") ||
        baselineBlockerCodes.has("NO_APPROVED_ALLOCATIONS")
        ? "blocked"
        : coveragePct >= 99.995
          ? "done"
          : "review",
      coveragePct,
    ),
    // The bill's quantities and value are for those who may read the BOQ.
    canReadBoq &&
      headlineItem(
        "unmapped_quantity",
        "Unmapped BOQ quantity",
        unmappedQuantityText,
        unmappedQuantities.length > 0 ? "review" : "done",
        unmappedQuantities.map(({ unit, quantity }) => ({ unit, quantity })),
      ),
    canReadBoq &&
      headlineItem(
        "unmapped_boq",
        "Unmapped BOQ value",
        formatHeadlineMoney(unallocatedAmount),
        unallocatedAmount > MONEY_EPSILON ? "review" : "done",
        unallocatedAmount,
      ),
    headlineItem(
      "critical_unmapped",
      "Critical unmapped activities",
      String(criticalUnmappedActivities.length),
      criticalUnmappedActivities.length > 0 ? "review" : "done",
      criticalUnmappedActivities.length,
    ),
    headlineItem(
      "baseline",
      "Baseline",
      baselineLocked ? "LOCKED" : scheduleApproved ? "APPROVED" : "NOT APPROVED",
      baselineLocked ? "done" : scheduleApproved ? "info" : "blocked",
      baselineLocked ? "locked" : scheduleApproved ? "approved" : "not_approved",
    ),
    headlineItem(
      "cost_loading",
      "Cost loading",
      costLoadingComplete ? "COMPLETE" : "INCOMPLETE",
      costLoadingComplete ? "done" : "review",
      costLoadingComplete,
    ),
  ].filter(Boolean);

  return {
    projectId,
    rulesetVersion: RULESET_VERSION,
    checkedAt: new Date().toISOString(),
    summary: {
      status: progressBlockerDetails.length === 0 ? "ready" : "not_ready",
      completeSteps: steps.filter((step) => step.status === STATUS.COMPLETE)
        .length,
      attentionSteps: steps.filter((step) => step.status === STATUS.ATTENTION)
        .length,
      blockedSteps: steps.filter((step) => step.status === STATUS.BLOCKED)
        .length,
      totalSteps: steps.length,
      blockingCount: steps.reduce((sum, step) => sum + step.blockers.length, 0),
      warningCount: steps.reduce((sum, step) => sum + step.warnings.length, 0),
      readyForBaseline:
        revisionStatus === "approved" && baselineBlockers.length === 0,
      readyForProgress: progressBlockerDetails.length === 0,
      readyForReporting: reportingBlockerDetails.length === 0,
      headline,
      criticalUnmappedActivities: criticalUnmappedActivities.length,
      nextAction: toAction(nextStep),
      advisoryAction: toAction(advisoryStep),
    },
    gates: {
      baseline: {
        mode: "block",
        ready: revisionStatus === "approved" && baselineBlockers.length === 0,
        alreadyLocked: baselineLocked,
        blockers: baselineBlockers,
        message: baselineLocked
          ? "Baseline is already locked."
          : baselineBlockers.length > 0
            ? "Resolve baseline blockers before locking the official baseline."
            : revisionStatus === "approved"
              ? "Baseline can be locked."
              : "Approve the schedule before locking the baseline.",
      },
      progress: {
        mode: "warn",
        ready: progressBlockerDetails.length === 0,
        blockers: progressBlockerDetails,
        warnings: steps
          .filter((step) => step.requiredFor.includes("progress"))
          .flatMap((step) =>
            step.warnings.map((warning) => ({
              stepKey: step.key,
              stepLabel: step.label,
              ...warning,
            })),
          ),
        message:
          progressBlockerDetails.length > 0
            ? "Progress is available with setup warnings until PM/Product signs off final hard gates."
            : "Progress setup checks are clear.",
      },
      reporting: {
        mode: "block",
        ready: reportingBlockerDetails.length === 0,
        blockers: reportingBlockerDetails,
        warnings: reportingWarningDetails,
        overrideAllowedRoles: ["pm"],
        message:
          reportingBlockerDetails.length > 0
            ? "Resolve official reporting blockers before locking EV snapshots, or record a PM override reason."
            : "Official reporting prerequisites are clear.",
      },
    },
    structure: {
      wbsNodes: wbsNodeCount,
      locations: locationCount,
      projectCostCodes: projectCostCodeCount,
      unitsUnresolved: unresolvedUnitItems.length,
    },
    coverage,
    context: {
      workspace: { orgId, segment: workspace },
      currentRevision: currentRevision
        ? {
            id: currentRevision.id,
            label: currentRevision.label,
            status: revisionStatus,
            isActive: Boolean(currentRevision.isActive),
            approvedAt: toIso(currentRevision.approvedAt),
            baselinedAt: toIso(currentRevision.baselinedAt),
          }
        : null,
      boqRevision: currentBoqRevision
        ? {
            id: currentBoqRevision.id,
            revisionNumber: currentBoqRevision.revisionNumber,
            label: currentBoqRevision.label,
            source: currentBoqRevision.source,
            status: currentBoqRevision.status,
            baselineLocked: Boolean(currentBoqRevision.baselineLocked),
            lockedAt: toIso(currentBoqRevision.lockedAt),
            itemCount: currentBoqRevision.itemCount,
            // What the upload changed against the bill before it (PC-2's
            // comparison), the rows it could not apply, and its review
            // trail — the revision's own record, shown, not re-derived.
            changes: {
              added: currentBoqRevision.addedCount,
              updated: currentBoqRevision.updatedCount,
              removed: currentBoqRevision.removedCount,
              unchanged: currentBoqRevision.unchangedCount,
              blocked: currentBoqRevision.blockedCount,
            },
            validation: {
              blockedCount: currentBoqRevision.blockedCount,
              // The rows themselves (codes, descriptions) are the bill's.
              blocked: canReadBoq ? boqRevisionBlockedRows : [],
            },
            // The value and the review trail (who approved, their
            // comments) are for those who may read the BOQ.
            ...(canReadBoq
              ? {
                  totalAmount: toNumber(currentBoqRevision.totalAmount),
                  history: boqRevisionHistory,
                }
              : {}),
            createdAt: toIso(currentBoqRevision.createdAt),
          }
        : null,
      boqBaseline: {
        locked: boqLocked,
        source: baselineLocked
          ? "schedule_baseline"
          : lockedBoqRevision
            ? "boq_revision"
            : null,
        boqRevisionId: lockedBoqRevision?.id || null,
      },
      progressMethods: {
        configured: progressMethodCount,
        total: progressActivityCount,
        byMethod: progressMethodsByMethod,
        quantityWithoutUnit: quantityMethodsWithoutUnit.length,
      },
      // The bill's allocation totals, for those who may read the BOQ.
      ...(canReadBoq
        ? {
            allocationSummary: {
              totalBoqAmount: totalBoqFromSummary,
              approvedAllocatedAmount,
              pendingAllocatedAmount,
              unallocatedAmount,
            },
          }
        : {}),
      // The schedule's own readiness checks, as the revision page reads
      // them; its allocations check states the bill's value in the same
      // seven figures the steps count, so a caller who cannot read the BOQ
      // gets each check's verdict and message without them.
      scheduleReadiness: withheldScheduleReadiness(scheduleReadiness, { boq: canReadBoq, budget: true }),
      officialEvInputs: OFFICIAL_EV_INPUTS,
    },
    steps,
  };
};

const getOfficialReportingGate = async ({ orgId, projectId }) => {
  const readiness = await getSetupReadiness({ orgId, projectId });
  const gate = readiness.gates.reporting;
  // Each blocker and warning in the shape it had before PC-4: this gate is
  // frozen into EvPeriodSnapshot.basisJson and the override's audit row.
  return {
    ...gate,
    blockers: gate.blockers.map(withoutItemDetail),
    warnings: gate.warnings.map(withoutItemDetail),
  };
};

module.exports = {
  getSetupReadiness,
  getOfficialReportingGate,
  OFFICIAL_EV_INPUTS,
  RULESET_VERSION,
  ITEM_CAP,
};
