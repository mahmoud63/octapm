const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { addMoney, subtractMoney } = require("../utils/money");
const { BOQ_STATE, boqStateOf } = require("../utils/boq-value");
const { workspacePath, workspaceSegment } = require("../utils/record-links");
const { buildAllocationSummary } = require("./activity-boq-allocation.service");
const {
  buildReadinessActivitiesFromSnapshot,
  buildScheduleReadiness,
  REVISION_NOT_ACTIVATED_MESSAGE,
} = require("./schedule.service");
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

// The baseline blockers that say the bill's value is not mapped yet.
const ALLOCATION_BLOCKER_CODES = new Set([
  "NO_APPROVED_ALLOCATIONS",
  "UNALLOCATED_BOQ",
  "SCHEDULE_ALLOCATIONS_FAILED",
]);

// Owner decision D5, the greenfield order: upload and approve the BOQ,
// import or generate a schedule, submit, approve, activate, map the bill's
// value to the active activities, lock the baseline. What a staged revision
// that is not approved yet still needs before its activities can be mapped.
const STAGED_WAITING_MESSAGES = Object.freeze({
  draft:
    "Submit the schedule revision for review, approve it and activate it (Schedule › Revisions) before mapping allocations to its activities.",
  under_review:
    "Approve the schedule revision under review and activate it (Schedule › Revisions) before mapping allocations to its activities.",
  // A staged revision cannot be edited: a rejected one is replaced by a
  // corrected import (or regeneration), or resubmitted as it is.
  rejected:
    "The schedule revision was rejected: import a corrected schedule or regenerate it (Schedule › Update Schedule), or resubmit it for review (Schedule › Revisions); approve and activate it before mapping allocations to its activities.",
});

// Filing a BOQ row under a WBS node or a cost code has no control in the
// product yet: no page and no API writes BoqItem.wbsNodeId or costCodeId
// (the BOQ row editor writes code, description, quantity, unit and rate).
// It comes with the BOQ item detail (PC-5). Until then the advisories say
// so and link nowhere.
const BOQ_FILING_NOT_YET =
  "Filing BOQ rows under a WBS node or a cost code is not available yet; it comes with the BOQ item detail. Nothing is blocked meanwhile.";

// The approval's own failing checks (the revision's logic, D5) of a
// schedule readiness: the checks that guard the approval.
const failingApprovalChecks = (readiness) =>
  (readiness?.checks || []).filter(
    (check) =>
      check.severity === "blocking" &&
      !check.passed &&
      (!Array.isArray(check.requiredFor) || check.requiredFor.includes("approval")),
  );

/**
 * A revision that fails its own checks, said with what puts them right (the
 * checks' fixes, schedule.service readinessCheckFix): for a staged revision,
 * the corrected import or regeneration — no page edits it — and for an
 * active one, the Gantt's edit or Recalculate CPM. Null when it passes.
 */
const failingLogicSentence = (readiness) => {
  const failing = failingApprovalChecks(readiness);
  if (failing.length === 0) return null;
  const labels = failing.map((check) => check.label).join(", ");
  const fixes = [];
  for (const check of failing) {
    if (check.fix?.text && !fixes.includes(check.fix.text)) fixes.push(check.fix.text);
  }
  return `The schedule revision fails its own checks (${labels}).${fixes.length ? ` ${fixes.join(" ")}` : ""}`;
};

/**
 * Where a schedule revision that is not approved stands, and the step that
 * moves it on, with the page that offers it (the D5 order: submit, approve,
 * activate, map, lock). `readiness` is the revision's own — its snapshot's
 * for a staged revision.
 */
const revisionApprovalStep = (revision, readiness) => {
  const status = normalizeRevisionStatus(revision?.status);
  const failing = failingLogicSentence(readiness);
  if (failing && ["draft", "under_review", "rejected"].includes(status)) return failing;
  if (status === "draft") {
    return "Submit the schedule revision for review, then approve it (Schedule Review, on Schedule › Revisions).";
  }
  if (status === "under_review") {
    return "Approve or reject the schedule revision under review (Schedule Review, on Schedule › Revisions).";
  }
  if (status === "rejected") {
    return revision?.isActive
      ? "The schedule revision was rejected: correct it on Schedule › Gantt › Edit and resubmit it for review (Schedule Review, on Schedule › Revisions)."
      : "The schedule revision was rejected: import a corrected schedule or regenerate it (Schedule › Update Schedule), or resubmit it for review (Schedule Review, on Schedule › Revisions).";
  }
  return "No approved schedule revision is available for baseline/progress.";
};

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
  advisories = [],
  counts = {},
  guides,
  successMessage,
}) => {
  const activeBlockers = blockers.filter(Boolean);
  const activeWarnings = warnings.filter(Boolean);
  // Advisories (PC-4's filing and matching checks) are listed with the
  // step but never move its status, its message or a gate: an original
  // step completes exactly as the base derived it (setup doc §91).
  const activeAdvisories = advisories.filter(Boolean);
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
    advisories: activeAdvisories,
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

// The mapping's coverage is the bill's too (owner decision C, 2026-09-27:
// "a rounded percentage is still BOQ-derived"). A member who may not read
// the BOQ is told that a mapping issue exists — its code, severity and
// verdict, so every gate is the same for everyone — but not how many rows
// or allocations it concerns: the count, the counting details and any
// message that states a count are replaced. Nothing is rounded; the figure
// is simply not there.
const MAPPING_ISSUE_MESSAGES = Object.freeze({
  BOQ_MAPPING_RULE_UNSET: "Some BOQ rows have no mapping rule (required, optional or not applicable).",
  NO_APPROVED_ALLOCATIONS: null,
  UNALLOCATED_BOQ: null,
  OPTIONAL_UNALLOCATED: null,
  PENDING_ALLOCATIONS: null,
  SUGGESTIONS_PENDING: "Some accepted suggestions are still drafts.",
  UNIT_MISMATCH_COUNT: "Some allocations measure the activity in a different unit from the BOQ row.",
  LOCATION_MISMATCH_COUNT: "Some allocations link a BOQ row and an activity in different locations.",
});
// The step counts and issue details that count mapped, unmapped or
// mismatched BOQ rows and allocations.
const MAPPING_COUNT_KEYS = ["itemsWithoutMappingRule", "suggestionsPending", "unitMismatchCount", "locationMismatchCount"];
const MAPPING_DETAILS_WITHHELD = "Mapping details unavailable to you";

const withoutMappingCounts = (values) =>
  values && typeof values === "object"
    ? Object.fromEntries(Object.entries(values).filter(([key]) => !MAPPING_COUNT_KEYS.includes(key)))
    : values;

const withoutMappingDetail = (entry) => {
  if (!entry || !Object.prototype.hasOwnProperty.call(MAPPING_ISSUE_MESSAGES, entry.code)) return entry;
  const { count, ...rest } = entry;
  return {
    ...rest,
    message: MAPPING_ISSUE_MESSAGES[entry.code] || entry.message,
    ...(rest.details ? { details: withoutMappingCounts(rest.details) } : {}),
    mappingDetailsWithheld: true,
  };
};

// Nor how many BOQ rows there are, or how many are unfiled or carry an
// unknown unit (the owner's rule: no BOQ-derived count to a member without
// boq:read). The issue stays — code, severity, verdict — with a sentence
// that states no number; the step counts, the BOQ-structure guide, the
// structure summary and the revision's row counts lose theirs.
const BOQ_ROW_ISSUE_MESSAGES = Object.freeze({
  BOQ_ITEMS_WITHOUT_WBS: "Some BOQ rows have no WBS node.",
  BOQ_ITEMS_WITHOUT_COST_CODE: "Some BOQ rows have no cost code.",
  BOQ_UNIT_UNRESOLVED: "Some BOQ rows carry a unit the organisation does not recognise.",
  UOM_UNRESOLVED: "Some unit spellings on the bill are not in the organisation's unit list.",
});
const BOQ_ROW_COUNT_KEYS = [
  "boqItems",
  "itemsWithoutWbs",
  "itemsWithoutCostCode",
  "itemsWithUnresolvedUnit",
  "unitsUnresolved",
  "rows",
  "revisionItems",
  "revisionChanges",
  "revisionBlockedRows",
];
const BOQ_DETAILS_WITHHELD = "BOQ details unavailable to you";

const withoutBoqRowCounts = (values) =>
  values && typeof values === "object"
    ? Object.fromEntries(Object.entries(values).filter(([key]) => !BOQ_ROW_COUNT_KEYS.includes(key)))
    : values;

const withoutBoqRowDetail = (entry) => {
  if (!entry || !Object.prototype.hasOwnProperty.call(BOQ_ROW_ISSUE_MESSAGES, entry.code)) return entry;
  const { count, ...rest } = entry;
  return {
    ...rest,
    message: BOQ_ROW_ISSUE_MESSAGES[entry.code],
    ...(rest.details ? { details: withoutBoqRowCounts(rest.details) } : {}),
    boqDetailsWithheld: true,
    reason: BOQ_DETAILS_WITHHELD,
  };
};

/** A step as a member who may not read the BOQ receives it. */
const withheldStepForNonBoqReader = (step) => {
  const withheld = (entry) => withoutBoqRowDetail(withoutMappingDetail(withoutBoqDetail(entry)));
  const blockers = step.blockers.map(withheld);
  const warnings = step.warnings.map(withheld);
  // The step's message is its first blocker's or warning's: it goes the way
  // of the issue it repeats.
  const original = [...step.blockers, ...step.warnings];
  const replaced = [...blockers, ...warnings];
  const at = original.findIndex((entry) => entry.message === step.message);
  return {
    ...step,
    message: at >= 0 ? replaced[at].message : step.message,
    blockers,
    warnings,
    advisories: step.advisories.map(withheld),
    counts: withoutBoqRowCounts(withoutMappingCounts(withoutBoqFigures(step.counts))),
    ...(step.guides
      ? {
          guides: step.guides.map((guide) =>
            guide.key === "mapping_readiness"
              ? { ...guide, count: null, detail: MAPPING_DETAILS_WITHHELD, detailsWithheld: true }
              : guide.key === "boq_structure"
                ? { ...guide, count: null, detail: BOQ_DETAILS_WITHHELD, detailsWithheld: true }
                : guide,
          ),
        }
      : {}),
  };
};

// The schedule's records behind an issue — its activities and revisions —
// go to those who may read the schedule (PC-4 merge gate round 3): a member
// whose template takes the schedule away is refused the schedule and the
// WBS, so readiness does not list them the activities either. The issue,
// its code, message and count stay, so every gate is the same for everyone.
const SCHEDULE_ITEM_TYPES = new Set(["activity", "schedule_revision"]);
const SCHEDULE_DETAILS_WITHHELD = "Schedule records are listed for people who can open the schedule";

const withoutScheduleRecords = (entry) => {
  const items = (entry.items || []).filter((item) => !SCHEDULE_ITEM_TYPES.has(item.type));
  return items.length === (entry.items || []).length
    ? entry
    : { ...entry, items, scheduleItemsWithheld: true, scheduleReason: SCHEDULE_DETAILS_WITHHELD };
};

/** A step as a member who may not read the schedule receives it. */
const withheldStepForNonScheduleReader = (step) => ({
  ...step,
  blockers: step.blockers.map(withoutScheduleRecords),
  warnings: step.warnings.map(withoutScheduleRecords),
  advisories: step.advisories.map(withoutScheduleRecords),
});

// The schedule's own checks name activities in their details (cycles,
// float mismatches, …): the verdicts and messages stay, the rows do not.
const withheldScheduleChecks = (readiness) =>
  readiness && Array.isArray(readiness.checks)
    ? {
        ...readiness,
        checks: readiness.checks.map((check) =>
          check && check.details ? { ...check, details: {}, detailsWithheld: true } : check,
        ),
      }
    : readiness;

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
const getSetupReadiness = async ({ orgId, projectId, canReadBoq = true, canReadSchedule = true }) => {
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
  // A BOQ row not filed under a WBS node or a cost code: named, not linked.
  // No page files a row yet (BOQ_FILING_NOT_YET), so a link would send the
  // PM to a page that cannot resolve it.
  const unfiledBoqItem = (item, missing) => ({ ...boqItemItem(item, missing), href: null });
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
  // A revision judged on its own activities: a staged one (imported or
  // generated, not activated) on its snapshot, as the approval judges it —
  // the active activities are not its own. Used for what its approval step
  // says; the checks the baseline reads stay the active schedule's.
  const ownReadiness = (revision) =>
    revision && !revision.isActive
      ? buildScheduleReadiness({
          project,
          revision,
          activities: buildReadinessActivitiesFromSnapshot(revision, project),
          allocationSummary,
        })
      : revision && revision.id === currentRevision?.id
        ? scheduleReadiness
        : null;
  const currentRevisionReadiness = ownReadiness(currentRevision);
  // A newer revision staged beside the active one (a re-import after the
  // baseline): the Schedule page reviews it beside the active schedule, and
  // the approval step names it — as an advisory, which moves no step or gate.
  const candidateRevision =
    activeRevision &&
    latestRevision &&
    latestRevision.id !== activeRevision.id &&
    !latestRevision.isActive &&
    ["draft", "under_review", "approved", "rejected"].includes(
      normalizeRevisionStatus(latestRevision.status),
    )
      ? latestRevision
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
  // Differences of money are taken in money (cents), as the schedule's
  // coverage check takes them: a remainder at the cent tolerance compares
  // as the cent it is, never as a float just above it.
  const allocatableBoqAmount = Math.max(
    0,
    subtractMoney(totalBoqFromSummary, notApplicableAmount),
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
    subtractMoney(unallocatedAmount, optionalUnallocatedAmount),
  );
  // The value the baseline must cover: the allocatable value less what the
  // optional rows still leave open. A bill that is optional throughout has
  // nothing here that must be approved — but it has no in-scope value, and
  // the BOQ step refuses the baseline for it (BOQ_NO_IN_SCOPE_VALUE, owner
  // decision E2).
  const requiredBoqAmount = Math.max(
    0,
    subtractMoney(allocatableBoqAmount, optionalUnallocatedAmount),
  );
  const baselineLocked = Boolean(
    baselinedRevision || revisionStatus === "baselined",
  );
  const scheduleApproved = ["approved", "baselined"].includes(revisionStatus);
  // An approved revision that is still staged: its activities exist only in
  // its snapshot, none is active, and the PM's next step is to activate it.
  // Until then the checks below, run on the (absent) active activities,
  // would say "No schedule activities exist" or "Generate or import a
  // schedule" — true of the active schedule, but not what to do.
  const awaitingActivation = Boolean(
    currentRevision &&
      revisionStatus === "approved" &&
      !currentRevision.isActive &&
      activeActivityCount === 0 &&
      toNumber(currentRevision.activityCount) > 0,
  );
  // A staged revision not approved yet (draft, under review or rejected):
  // the mapping waits on its review, approval and activation (D5).
  const stagedAwaitingApproval = Boolean(
    currentRevision &&
      !currentRevision.isActive &&
      activeActivityCount === 0 &&
      toNumber(currentRevision.activityCount) > 0 &&
      Object.prototype.hasOwnProperty.call(STAGED_WAITING_MESSAGES, revisionStatus),
  );

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
  // to file under: without a WBS, NO_WBS already says it all. A row or an
  // activity whose node has been archived is filed under retired scope — the
  // WBS tab shows it under no node — so it counts as unfiled, and says why.
  const activeWbsNodeIds = new Set(wbsNodes.map((node) => node.id));
  const isUnfiled = (record) => !record.wbsNodeId || !activeWbsNodeIds.has(record.wbsNodeId);
  const filingMissing = (record) =>
    record.wbsNodeId ? "Filed under an archived WBS node" : "WBS node";
  const archivedNote = (records) => {
    const archived = records.filter((record) => record.wbsNodeId).length;
    return archived > 0 ? ` (${archived} filed under an archived node)` : "";
  };
  const itemsWithoutWbs = wbsNodeCount > 0 ? boqItems.filter(isUnfiled) : [];
  const itemsWithoutCostCode =
    projectCostCodeCount > 0 ? boqItems.filter((item) => !item.costCodeId) : [];
  const activitiesWithoutWbs = wbsNodeCount > 0 ? activities.filter(isUnfiled) : [];
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

  const boqValueState = boqStateOf(boqItems);
  const boqBlockers = [
    boqCount === 0 && issue("NO_BOQ", "No BOQ items have been uploaded."),
    // A bill none of whose rows is priced has no value to map: the rows are
    // priced first, in the words of the lock's refusal
    // (BOQ_VALUE_REQUIRED_FOR_BASELINE) and the schedule readiness's
    // boq_present check.
    // Value is the schedule's rule (boqStateOf): the priced rows' sum above
    // a cent — one threshold for this gate, the readiness check and the lock.
    boqValueState === BOQ_STATE.UNPRICED &&
      issue(
        "BOQ_HAS_NO_VALUE",
        "The bill has no value to map: none of its rows is priced. Price its rows (BOQ page), map them to the schedule, then lock the baseline.",
      ),
    // Owner decision E2 (2026-09-28): a bill whose priced rows are all out
    // of scope for mapping (not applicable or optional) has nothing to map,
    // and the baseline lock refuses it like no bill
    // (BOQ_SCOPE_REQUIRED_FOR_BASELINE) — the step says so, in the words
    // of that refusal. Whether there is any is said, never how much.
    boqValueState === BOQ_STATE.OUT_OF_SCOPE &&
      issue(
        "BOQ_NO_IN_SCOPE_VALUE",
        "The bill has no in-scope value to map: every priced row is marked not applicable or optional. Mark the rows that belong to the schedule as required (Project Controls › Mapping), map them, then lock the baseline.",
      ),
  ];
  // PC-4's filing and matching checks are advisories (setup doc §91, and
  // the product owner's default b): nothing in the product files a BOQ row
  // under a WBS node yet (PC-5 builds that), so an issue nobody can resolve
  // must not hold a step; and the ten original steps keep the statuses,
  // warnings and gates the base derived — the reporting gate EV freezes
  // carries exactly the warnings it carried before PC-4. What is filed
  // under what is reported on the Structure step, as information.
  const structureAdvisories = [
    itemsWithoutWbs.length > 0 &&
      issue(
        "BOQ_ITEMS_WITHOUT_WBS",
        `${itemsWithoutWbs.length} BOQ row${itemsWithoutWbs.length === 1 ? " has" : "s have"} no WBS node${archivedNote(itemsWithoutWbs)}. ${BOQ_FILING_NOT_YET}`,
        "advisory",
        { itemsWithoutWbs: itemsWithoutWbs.length },
        itemsWithoutWbs.map((item) => unfiledBoqItem(item, filingMissing(item))),
      ),
    activitiesWithoutWbs.length > 0 &&
      issue(
        "ACTIVITIES_WITHOUT_WBS",
        `${activitiesWithoutWbs.length} activit${activitiesWithoutWbs.length === 1 ? "y has" : "ies have"} no WBS node${archivedNote(activitiesWithoutWbs)}.`,
        "advisory",
        { activitiesWithoutWbs: activitiesWithoutWbs.length },
        activitiesWithoutWbs.map((activity) => activityItem(activity, filingMissing(activity))),
      ),
    itemsWithoutCostCode.length > 0 &&
      issue(
        "BOQ_ITEMS_WITHOUT_COST_CODE",
        `${itemsWithoutCostCode.length} BOQ row${itemsWithoutCostCode.length === 1 ? " has" : "s have"} no cost code. ${BOQ_FILING_NOT_YET}`,
        "advisory",
        { itemsWithoutCostCode: itemsWithoutCostCode.length },
        itemsWithoutCostCode.map((item) => unfiledBoqItem(item, "Cost code")),
      ),
  ];
  const boqAdvisories = [
    itemsWithUnresolvedUnit.length > 0 &&
      issue(
        "BOQ_UNIT_UNRESOLVED",
        `${itemsWithUnresolvedUnit.length} BOQ row${itemsWithUnresolvedUnit.length === 1 ? " carries" : "s carry"} a unit the organisation does not recognise.`,
        "advisory",
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
                : "The bill was entered by hand; it is approved when the schedule baseline is locked (Schedule → Lock Baseline).",
              "warning",
              { revisionId: currentBoqRevision?.id || null, revisionStatus: boqRevisionStatus },
              currentBoqRevision ? [boqRevisionItem(currentBoqRevision, "Submit and approve")] : [],
            ),
        ];
  const handEnteredBillAwaitingLock = boqCount > 0 && !currentBoqRevision && !boqApproved;
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
  ];
  const scheduleAdvisories = [
    activitiesWithUnmappedCalendar.length > 0 &&
      issue(
        "IMPORTED_CALENDAR_UNMAPPED",
        `${activitiesWithUnmappedCalendar.length} activit${activitiesWithUnmappedCalendar.length === 1 ? "y uses" : "ies use"} an imported calendar that is not mapped to a working calendar.`,
        "advisory",
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
    // Allocations go to active activities (owner decision D5): with a
    // revision staged, the step says what comes before the mapping — its
    // review, approval and activation — never "generate or import" again.
    activeActivityCount === 0 &&
      issue(
        "ALLOCATION_WAITING_FOR_SCHEDULE",
        awaitingActivation
          ? "Activate the approved schedule revision (Schedule › Revisions) before mapping allocations to its activities."
          : stagedAwaitingApproval
            ? // A staged revision that fails its own checks cannot be
              // approved as it is: the step is the corrected import.
              failingLogicSentence(currentRevisionReadiness)
              ? `${failingLogicSentence(currentRevisionReadiness)} Its activities are mapped once a revision is approved and activated.`
              : STAGED_WAITING_MESSAGES[revisionStatus]
            : "Generate or import a schedule before mapping allocations.",
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
  ];
  const allocationAdvisories = [
    suggestedDrafts.length > 0 &&
      issue(
        "SUGGESTIONS_PENDING",
        `${suggestedDrafts.length} accepted suggestion${suggestedDrafts.length === 1 ? " is" : "s are"} still a draft.`,
        "advisory",
        { suggestionsPending: suggestedDrafts.length },
        suggestedDrafts.map((allocation) =>
          allocationItem(allocation, `Suggested by ${allocation.suggestedBy}; submit it`),
        ),
      ),
    unitMismatches.length > 0 &&
      issue(
        "UNIT_MISMATCH_COUNT",
        `${unitMismatches.length} allocation${unitMismatches.length === 1 ? "" : "s"} measure${unitMismatches.length === 1 ? "s" : ""} the activity in a different unit from the BOQ row.`,
        "advisory",
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
        "advisory",
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
  // Each says the step that moves the revision on and the page that offers
  // it (D5): a revision failing its own checks — the corrected import
  // (staged) or the Gantt's edit (active); otherwise submit, approve or
  // resubmit. With no revision the base's words and action stay (the gates
  // carry them as the base derived them): the Schedule module shows its
  // upload zone — import or generate — on every tab until one exists.
  const approvalBlockers = [
    !currentRevision &&
      issue("NO_SCHEDULE_REVISION", "No schedule revision is available."),
    currentRevision &&
      !scheduleApproved &&
      issue(
        "NO_APPROVED_SCHEDULE",
        revisionApprovalStep(currentRevision, currentRevisionReadiness),
        "blocking",
        { revisionStatus },
        [scheduleRevisionItem(currentRevision, "Approval")],
      ),
  ];
  // The staged revision beside the active one: named with its next step.
  const candidateStatus = candidateRevision ? normalizeRevisionStatus(candidateRevision.status) : null;
  const approvalAdvisories = [
    candidateRevision &&
      issue(
        "STAGED_REVISION_PENDING",
        `A newer schedule revision, "${candidateRevision.label || "Schedule revision"}", is staged beside the active schedule and replaces it only once it is approved and activated. ${
          candidateStatus === "approved"
            ? "Activate it on Schedule › Revisions; then map the BOQ to its activities and lock its baseline."
            : revisionApprovalStep(candidateRevision, ownReadiness(candidateRevision))
        }`,
        "advisory",
        { revisionId: candidateRevision.id, revisionStatus: candidateStatus },
        [scheduleRevisionItem(candidateRevision, candidateStatus === "approved" ? "Activation" : "Review")],
      ),
  ];

  // Awaiting activation, the baseline checks have no active activities to
  // judge: the one blocker is the activation, said with where to do it.
  // The schedule readiness's own BOQ check (boq_present) is not repeated
  // here: the BOQ step's blockers already name the upload, first, and it is
  // never a schedule correction.
  const checksForBaseline = awaitingActivation
    ? []
    : (scheduleReadiness?.checks || []).filter((check) => check.key !== "boq_present");
  const activationBlockers = awaitingActivation
    ? [
        issue(
          "REVISION_NOT_ACTIVATED",
          REVISION_NOT_ACTIVATED_MESSAGE,
          "blocking",
          { revisionStatus },
          [scheduleRevisionItem(currentRevision, "Activation")],
        ),
      ]
    : [];
  const readinessBlockers = checksForBaseline
    .filter((check) => check.severity === "blocking" && !check.passed)
    .map((check) =>
      issue(
        `SCHEDULE_${check.key.toUpperCase()}_FAILED`,
        // The coverage the baseline lock needs (D5) is mapped on the
        // mapping page, after the activation; the blocker says so.
        // Any other check names its own fix: the Gantt's edit or
        // Recalculate CPM for the active schedule, never a read-only tab.
        check.key === "allocations"
          ? `${String(check.message || "").trim().replace(/\.$/, "")}. Map it to the active activities on Project Controls › Mapping, then lock the baseline.`
          : check.fix?.text
            ? `${String(check.message || "").trim().replace(/\.$/, "")}. ${check.fix.text}`
            : check.message,
        "blocking",
        { checkKey: check.key },
        itemsFromCheckDetails(check, activityById, (activity, missing) =>
          activityItem(activity, missing),
        ),
      ),
    );
  const allocationCoverageBlocksBaseline = scheduleApproved && !baselineLocked &&
    readinessBlockers.some((blocker) => blocker.details?.checkKey === "allocations");
  // The active schedule's own logic fails the baseline lock: it is put
  // right on the Schedule page (the Gantt's edit, or Recalculate CPM).
  const logicBlocksBaseline = scheduleApproved && !baselineLocked &&
    readinessBlockers.some((blocker) => blocker.details?.checkKey && blocker.details.checkKey !== "allocations");
  const readinessWarnings = checksForBaseline
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
  const progressMethodAdvisories = [
    quantityMethodsWithoutUnit.length > 0 &&
      issue(
        "QUANTITY_METHOD_WITHOUT_UNIT",
        `${quantityMethodsWithoutUnit.length} quantity-measured activit${quantityMethodsWithoutUnit.length === 1 ? "y has" : "ies have"} no unit.`,
        "advisory",
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
    // A guide whose open item no page resolves yet is read, not followed.
    href: target ? link(target) : null,
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
                  `${itemsWithoutWbs.length} row${itemsWithoutWbs.length === 1 ? "" : "s"} without a WBS node (filing comes with the BOQ item detail)`,
                itemsWithUnresolvedUnit.length > 0 &&
                  `${itemsWithUnresolvedUnit.length} with an unknown unit`,
              ]
                .filter(Boolean)
                .join(" · ") || "Every row is filed",
      // The bill is uploaded and its units corrected on the BOQ page, and
      // the WBS is built on Structure; filing a row under a node has no
      // page yet (BOQ_FILING_NOT_YET), so that alone links nowhere.
      target:
        boqCount === 0 || itemsWithUnresolvedUnit.length > 0
          ? TARGETS.boq
          : wbsNodeCount === 0
            ? TARGETS.structure
            : itemsWithoutWbs.length > 0
              ? null
              : TARGETS.boq,
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
      advisories: structureAdvisories,
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
      // A bill whose priced rows are all out of scope for mapping is put right
      // on Project Controls › Mapping, where the rows that belong to the
      // schedule are marked required (BOQ_NO_IN_SCOPE_VALUE, owner decision
      // E2) — the card sends there, not to the BOQ it already has.
      action:
        boqValueState === BOQ_STATE.OUT_OF_SCOPE
          ? { label: "Open Mapping", target: TARGETS.mapping }
          : { label: "Open BOQ", target: TARGETS.boq },
      requiredFor: ["baseline", "progress", "reporting"],
      complete: boqBlockers.filter(Boolean).length === 0,
      blockers: boqBlockers,
      advisories: boqAdvisories,
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
      // A bill entered by hand has no revision to review: what approves it
      // is the schedule baseline lock, so the card sends there.
      action: handEnteredBillAwaitingLock
        ? { label: "Lock schedule baseline", target: TARGETS.scheduleRevisions }
        : { label: "Review BOQ", target: TARGETS.boq },
      complete: boqCount > 0 && boqApproved,
      warnings: [...boqApprovalWarnings, ...mappingRuleWarnings],
      counts: {
        revisionId: currentBoqRevision?.id || null,
        revisionNumber: currentBoqRevision?.revisionNumber ?? null,
        revisionStatus: boqRevisionStatus,
        // With no bill there is nothing locked: the schedule baseline
        // is the lock of a bill that exists, never of an absent one.
        baselineLocked: boqCount > 0 && boqLocked,
        itemsWithoutMappingRule: itemsWithoutMappingRule.length,
        revisionItems: currentBoqRevision?.itemCount ?? null,
        revisionChanges: currentBoqRevision
          ? currentBoqRevision.addedCount +
            currentBoqRevision.updatedCount +
            currentBoqRevision.removedCount
          : null,
        revisionBlockedRows: currentBoqRevision?.blockedCount ?? null,
      },
      // buildStep falls back to this message when the step has no warning,
      // so it says approved or locked only when the step is complete; with
      // no bill it names the step before this one.
      successMessage:
        boqCount === 0
          ? "Upload the BOQ first (BOQ page); it is then submitted, approved and locked here."
          : !boqApproved
            ? undefined
            : boqLocked
              ? "BOQ baseline is locked."
              : "BOQ revision is approved.",
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
      advisories: scheduleAdvisories,
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
      // Waiting on a staged revision, the mapping cannot resolve the step:
      // the action sends to where the revision is approved and activated
      // (D5). With no schedule at all the step keeps the base's action —
      // the schedule step before it is the next action then, and the gates
      // keep the shape they had at cb14ff4.
      action: awaitingActivation
        ? { label: "Activate Revision", target: TARGETS.scheduleRevisions }
        : stagedAwaitingApproval
          ? { label: "Open Review", target: TARGETS.scheduleRevisions }
          : { label: "Map Allocations", target: TARGETS.boq },
      requiredFor: ["baseline", "progress", "reporting"],
      complete: allocationBlockers.filter(Boolean).length === 0,
      blockers: allocationBlockers,
      warnings: allocationWarnings,
      advisories: allocationAdvisories,
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
      advisories: progressMethodAdvisories,
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
      // The review is on the Revisions tab, whose page also offers Update
      // Schedule; with no revision the module shows its upload zone there.
      action: { label: "Open Review", target: TARGETS.scheduleRevisions },
      requiredFor: ["baseline", "progress", "reporting"],
      complete: approvalBlockers.filter(Boolean).length === 0,
      blockers: approvalBlockers,
      advisories: approvalAdvisories,
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
      // After the activation, unmapped coverage is resolved on the mapping
      // page, not where the baseline is locked (D5).
      // After the approval, where each blocker is resolved; only then the
      // lock itself. Before it, the base's action stays (the gates carry the
      // step's waiting warning with it, as the base derived it): Schedule ›
      // Revisions, where the review panel is — or, with no revision yet, the
      // upload zone the Schedule module shows on every tab.
      action: awaitingActivation
        ? { label: "Activate Revision", target: TARGETS.scheduleRevisions }
        : logicBlocksBaseline
          ? { label: "Correct the Schedule", target: TARGETS.schedule }
          : allocationCoverageBlocksBaseline
            ? { label: "Map Allocations", target: TARGETS.mapping }
            : { label: "Lock Baseline", target: TARGETS.scheduleRevisions },
      requiredFor: ["baseline", "progress", "reporting"],
      complete: baselineLocked,
      blockers: scheduleApproved ? [...activationBlockers, ...readinessBlockers] : [],
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
              !awaitingActivation &&
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
        // The baseline lock's verdict: every check, coverage included (D5).
        readinessReady: Boolean(scheduleReadiness?.baselineReady),
        readinessBlockingCount: scheduleReadiness?.baselineBlockingCount ?? null,
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
  // Nor the mapping's coverage: how many rows or allocations a mapping issue
  // concerns, and the mapping guide's share and counts (decision C).
  const boqSteps = canReadBoq ? builtSteps : builtSteps.map(withheldStepForNonBoqReader);
  const steps = canReadSchedule ? boqSteps : boqSteps.map(withheldStepForNonScheduleReader);

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
  // The coverage endpoint needs boq:read; without it nothing of the coverage
  // is given — no share (rounded or not), no count of mapped, unmapped,
  // partial, over-allocated or not-applicable rows, no value (decision C).
  // The answer says the details are withheld, so no screen reads a
  // missing figure as zero.
  const coverage = canReadBoq
    ? Object.fromEntries(
        Object.entries(allocationSummary).filter(
          ([key]) => !["items", "groups"].includes(key),
        ),
      )
    : { withheld: true, reason: MAPPING_DETAILS_WITHHELD };

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
    // The mapping share is the bill's (decision C): a member who may not
    // read the BOQ is told the details are withheld — no figure, and no
    // tone that would say whether the bill is fully covered.
    canReadBoq
      ? headlineItem(
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
        )
      : { ...headlineItem("mapping", "Mapping", "—", "neutral", null), withheld: true, reason: MAPPING_DETAILS_WITHHELD },
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
    // How many critical activities have no approved allocation is read off
    // the mapping (owner decision, 2026-09-28): a member who may not read
    // the BOQ is told the details are withheld — no count, and no tone that
    // would say whether there are any. The critical path itself is theirs.
    canReadBoq
      ? headlineItem(
          "critical_unmapped",
          "Critical unmapped activities",
          String(criticalUnmappedActivities.length),
          criticalUnmappedActivities.length > 0 ? "review" : "done",
          criticalUnmappedActivities.length,
        )
      : {
          ...headlineItem("critical_unmapped", "Critical unmapped activities", "—", "neutral", null),
          withheld: true,
          reason: MAPPING_DETAILS_WITHHELD,
        },
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
      // The same count, for those who may read the BOQ; anyone else is told
      // it is withheld and why (never a 0 they could read as a fact).
      ...(canReadBoq
        ? { criticalUnmappedActivities: criticalUnmappedActivities.length }
        : { criticalUnmappedWithheld: true, criticalUnmappedReason: MAPPING_DETAILS_WITHHELD }),
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
          : awaitingActivation
            ? "Activate the approved schedule revision (Schedule › Revisions) before locking the baseline."
            : allocationCoverageBlocksBaseline
              ? baselineBlockers.every((blocker) => ALLOCATION_BLOCKER_CODES.has(blocker.code))
                ? "Map the bill's value to the active activities (Project Controls › Mapping) before locking the baseline."
                : "Map the bill's value to the active activities (Project Controls › Mapping) and resolve the other baseline blockers before locking the baseline."
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
      // The unit spellings typed on the bill's rows: a BOQ-derived count.
      ...(canReadBoq
        ? { unitsUnresolved: unresolvedUnitItems.length }
        : { unitsUnresolvedWithheld: true, reason: BOQ_DETAILS_WITHHELD }),
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
            // What the upload changed against the bill before it (PC-2's
            // comparison), the rows it could not apply, and its review
            // trail — the revision's own record, shown, not re-derived.
            // Every one of these is a count of BOQ rows: for those who may
            // read the BOQ (the owner's rule on BOQ-derived counts).
            ...(canReadBoq
              ? {
                  itemCount: currentBoqRevision.itemCount,
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
                    blocked: boqRevisionBlockedRows,
                  },
                }
              : {
                  countsWithheld: true,
                  reason: BOQ_DETAILS_WITHHELD,
                  validation: { blocked: [] },
                }),
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
      scheduleReadiness: canReadSchedule
        ? withheldScheduleReadiness(scheduleReadiness, { boq: canReadBoq, budget: true })
        : withheldScheduleChecks(withheldScheduleReadiness(scheduleReadiness, { boq: canReadBoq, budget: true })),
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
