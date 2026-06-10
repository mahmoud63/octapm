const Anthropic = require("@anthropic-ai/sdk");
const XLSX = require("xlsx");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { addMoney, multiplyMoney, toMoneyNumber } = require("../utils/money");
const {
  buildAllocationSummary,
  getApprovedActivityAllocationTotals,
} = require("./activity-boq-allocation.service");
const {
  buildCriticalPathExplanation,
  workingDayToDate,
} = require("./cpm.service");
const {
  createProjectDependencies,
  findDependencyCycle,
  getActivityDisplayRef,
  parsePredecessors,
  serializeDependencyDto,
} = require("./activity-dependency.service");
const auditService = require("./audit.service");
const approvalWorkflowService = require("./approval-workflow.service");

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 120_000, // 2 min max per API call
});

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("[schedule] ANTHROPIC_API_KEY not set");
}

const PHASES = [
  "Preliminary & General",
  "Earthworks & Foundations",
  "Concrete Structure",
  "Masonry & Blockwork",
  "Roofing",
  "External Works & Façade",
  "Internal Finishes",
  "Mechanical Services",
  "Electrical Services",
  "Specialist Systems",
  "External Landscaping",
  "Testing & Commissioning",
];

const JOB_STEPS = [
  {
    label: "Pass 1: Structuring BOQ",
    description: "Parsing and organizing BOQ rows",
  },
  {
    label: "Pass 2: Generating CPM Schedule",
    description: "Building activities and CPM logic",
  },
  {
    label: "Pass 3: Allocating Resources",
    description: "Assigning labor, equipment, and materials",
  },
];

const REVISION_STATUS = Object.freeze({
  DRAFT: "draft",
  UNDER_REVIEW: "under_review",
  APPROVED: "approved",
  REJECTED: "rejected",
  BASELINED: "baselined",
  SUPERSEDED: "superseded",
});

const OPEN_REVISION_STATUSES = [
  REVISION_STATUS.DRAFT,
  REVISION_STATUS.UNDER_REVIEW,
  REVISION_STATUS.APPROVED,
];

const trimOrNull = (value) => {
  const text = String(value || "").trim();
  return text || null;
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const normalizeRevisionStatus = (status) =>
  Object.values(REVISION_STATUS).includes(status)
    ? status
    : REVISION_STATUS.DRAFT;

const statusTransitionLog = (revision) =>
  Array.isArray(revision?.statusTransitionLog)
    ? revision.statusTransitionLog
    : [];

const appendStatusTransition = (
  revision,
  { to, userId, at, comment = null, reason = null },
) => [
  ...statusTransitionLog(revision),
  {
    from: normalizeRevisionStatus(revision?.status),
    to,
    by: userId || null,
    at: at.toISOString(),
    comment: trimOrNull(comment),
    reason: trimOrNull(reason),
  },
];

const auditRevisionTransition = ({
  tx,
  orgId,
  revision,
  action,
  actorId,
  occurredAt,
  newStatus,
  reason = null,
  summary = {},
}) =>
  auditService.recordEvent({
    tx,
    orgId,
    projectId: revision.projectId,
    entityType: auditService.ENTITY_TYPES.SCHEDULE_REVISION,
    entityId: revision.id,
    action,
    actorId,
    occurredAt,
    oldStatus: normalizeRevisionStatus(revision.status),
    newStatus,
    reason,
    oldSummary: {
      label: revision.label,
      status: normalizeRevisionStatus(revision.status),
      activityCount: revision.activityCount,
      criticalCount: revision.criticalCount,
      totalBudget: revision.totalBudget,
    },
    newSummary: {
      label: revision.label,
      status: newStatus,
      activityCount: revision.activityCount,
      criticalCount: revision.criticalCount,
      totalBudget: revision.totalBudget,
    },
    summary,
  });

const serializeRevision = (revision, extra = {}) => ({
  id: revision.id,
  projectId: revision.projectId,
  label: revision.label,
  activityCount: revision.activityCount,
  criticalCount: revision.criticalCount,
  totalBudget: revision.totalBudget,
  source: revision.source || null,
  isActive: Boolean(revision.isActive),
  status: normalizeRevisionStatus(revision.status),
  submittedBy: revision.submittedBy,
  submittedAt: revision.submittedAt,
  reviewComment: revision.reviewComment,
  approvedBy: revision.approvedBy,
  approvedAt: revision.approvedAt,
  approvalComment: revision.approvalComment,
  rejectedBy: revision.rejectedBy,
  rejectedAt: revision.rejectedAt,
  rejectionReason: revision.rejectionReason,
  baselinedBy: revision.baselinedBy,
  baselinedAt: revision.baselinedAt,
  baselineComment: revision.baselineComment,
  supersededBy: revision.supersededBy,
  supersededAt: revision.supersededAt,
  activatedBy: revision.activatedBy,
  activatedAt: revision.activatedAt,
  activationComment: revision.activationComment,
  previousActiveRevisionId: revision.previousActiveRevisionId,
  rolledBackBy: revision.rolledBackBy,
  rolledBackAt: revision.rolledBackAt,
  rollbackReason: revision.rollbackReason,
  mapping: revision.mappingJson || null,
  activationAudit: revision.activationAuditJson || null,
  readiness: revision.readinessJson || null,
  statusTransitionLog: statusTransitionLog(revision),
  createdAt: revision.createdAt,
  ...extra,
});

const buildPlannedDateFields = (activity, project) => {
  if (!project?.startDate) {
    return {
      earlyStartDate: null,
      earlyFinishDate: null,
      lateStartDate: null,
      lateFinishDate: null,
      baselineStartDate: null,
      baselineFinishDate: null,
    };
  }

  const options = {
    calendarId: activity.calendarId || project.projectCalendar,
    projectCalendar: project.projectCalendar,
  };

  return {
    earlyStartDate: workingDayToDate(
      project.startDate,
      activity.earlyStart,
      options,
    ),
    earlyFinishDate: workingDayToDate(
      project.startDate,
      activity.earlyFinish,
      options,
    ),
    lateStartDate: workingDayToDate(
      project.startDate,
      activity.lateStart,
      options,
    ),
    lateFinishDate: workingDayToDate(
      project.startDate,
      activity.lateFinish,
      options,
    ),
    baselineStartDate: workingDayToDate(
      project.startDate,
      activity.baselineStart,
      options,
    ),
    baselineFinishDate: workingDayToDate(
      project.startDate,
      activity.baselineFinish,
      options,
    ),
  };
};

const buildScheduleReadiness = ({
  project,
  revision,
  activities,
  allocationSummary,
}) => {
  const activityCount = activities.length;
  const refs = new Set();
  const activityById = new Map();
  const refToActivity = new Map();
  for (const activity of activities) {
    activityById.set(activity.id, activity);
    refs.add(activity.id);
    refToActivity.set(activity.id, activity);
    if (activity.wbsCode) {
      refs.add(activity.wbsCode);
      refToActivity.set(activity.wbsCode, activity);
    }
    if (activity.p6ActivityId) {
      refs.add(activity.p6ActivityId);
      refToActivity.set(activity.p6ActivityId, activity);
    }
  }

  let relationshipCount = 0;
  const invalidPredecessors = [];
  const selfPredecessors = [];
  const invalidRelationships = [];
  const dependencyRows = [];
  for (const activity of activities) {
    const structured = Array.isArray(activity.predecessorLinks)
      ? activity.predecessorLinks
      : [];

    if (structured.length > 0) {
      relationshipCount += structured.length;
      for (const dependency of structured) {
        dependencyRows.push({
          predecessorId: dependency.predecessorId,
          successorId: dependency.successorId,
        });

        if (dependency.predecessorId === activity.id) {
          selfPredecessors.push({
            activityId: activity.id,
            ref: dependency.predecessorId,
          });
        }
        if (!["FS", "SS", "FF", "SF"].includes(dependency.relationshipType)) {
          invalidRelationships.push({
            activityId: activity.id,
            relationshipType: dependency.relationshipType,
          });
        }
      }
      continue;
    }

    const predecessors = parsePredecessors(activity.predecessors);
    relationshipCount += predecessors.length;
    for (const predecessor of predecessors) {
      const ref = predecessor.predRef;
      const isSelf =
        ref === activity.id ||
        ref === activity.wbsCode ||
        ref === activity.p6ActivityId;
      const predecessorActivity = refToActivity.get(ref);

      if (isSelf) {
        selfPredecessors.push({ activityId: activity.id, ref });
      } else if (!refs.has(ref)) {
        invalidPredecessors.push({ activityId: activity.id, ref });
      } else if (predecessorActivity) {
        dependencyRows.push({
          predecessorId: predecessorActivity.id,
          successorId: activity.id,
        });
      }
    }
  }
  const dependencyCycle = findDependencyCycle(activities, dependencyRows);

  const totalBoqAmount = toNumber(allocationSummary?.totalBoqAmount);
  const unallocatedAmount = toNumber(
    allocationSummary?.unallocatedAmount ?? allocationSummary?.unscheduledValue,
  );
  const approvedAllocatedAmount = toNumber(
    allocationSummary?.approvedAllocatedAmount ??
      allocationSummary?.scheduledValue,
  );
  const pendingAllocatedAmount = toNumber(
    allocationSummary?.pendingAllocatedAmount,
  );

  const criticalActivities = activities.filter(
    (activity) => activity.isCritical && !activity.isMilestone,
  );
  const criticalFloatMismatches = criticalActivities.filter(
    (activity) =>
      activity.totalFloat != null &&
      Math.round(Number(activity.totalFloat)) !== 0,
  );

  const invalidDateRows = [];
  const projectBoundaryWarnings = [];
  for (const activity of activities) {
    const earlyStart = activity.earlyStart;
    const earlyFinish = activity.earlyFinish;
    if (
      earlyStart != null &&
      earlyFinish != null &&
      Number(earlyFinish) < Number(earlyStart)
    ) {
      invalidDateRows.push({
        activityId: activity.id,
        issue: "early_finish_before_early_start",
      });
    }
    if (Number(activity.duration || 0) < 0) {
      invalidDateRows.push({
        activityId: activity.id,
        issue: "negative_duration",
      });
    }
    if (
      activity.startDate &&
      activity.endDate &&
      new Date(activity.endDate) <= new Date(activity.startDate)
    ) {
      invalidDateRows.push({
        activityId: activity.id,
        issue: "finish_date_before_start_date",
      });
    }
    if (
      activity.startDate &&
      project.startDate &&
      new Date(activity.startDate) < new Date(project.startDate)
    ) {
      projectBoundaryWarnings.push({
        activityId: activity.id,
        issue: "starts_before_project",
      });
    }
    if (
      activity.endDate &&
      project.endDate &&
      new Date(activity.endDate) > new Date(project.endDate)
    ) {
      projectBoundaryWarnings.push({
        activityId: activity.id,
        issue: "finishes_after_project",
      });
    }
  }

  const checks = [
    {
      key: "predecessors",
      label: "Predecessor logic",
      passed:
        activityCount > 0 &&
        invalidPredecessors.length === 0 &&
        selfPredecessors.length === 0 &&
        invalidRelationships.length === 0 &&
        !dependencyCycle &&
        (activityCount === 1 || relationshipCount > 0),
      severity: "blocking",
      message:
        activityCount === 0
          ? "No schedule activities exist."
          : invalidPredecessors.length > 0 ||
              selfPredecessors.length > 0 ||
              invalidRelationships.length > 0
            ? "Predecessor references need correction."
            : dependencyCycle
              ? "Predecessor logic contains a cycle."
              : activityCount > 1 && relationshipCount === 0
                ? "At least one predecessor relationship is required."
                : "Predecessor references are valid.",
      details: {
        relationshipCount,
        invalidPredecessors,
        selfPredecessors,
        invalidRelationships,
        dependencyCycle: dependencyCycle
          ? dependencyCycle.map((activityId) => ({
              activityId,
              ref: getActivityDisplayRef(activityById.get(activityId)),
              name: activityById.get(activityId)?.name || null,
            }))
          : null,
      },
    },
    {
      key: "allocations",
      label: "BOQ allocations",
      passed:
        totalBoqAmount <= 0 ||
        (approvedAllocatedAmount > 0 && unallocatedAmount <= 0.01),
      severity: totalBoqAmount <= 0 ? "warning" : "blocking",
      message:
        totalBoqAmount <= 0
          ? "No BOQ value found for allocation checks."
          : unallocatedAmount > 0.01
            ? "BOQ value remains unallocated to approved schedule activities."
            : "Approved allocations cover the BOQ value.",
      details: {
        totalBoqAmount,
        approvedAllocatedAmount,
        pendingAllocatedAmount,
        unallocatedAmount,
      },
    },
    {
      key: "critical_path",
      label: "Critical path",
      passed:
        activityCount > 0 &&
        criticalActivities.length > 0 &&
        criticalFloatMismatches.length === 0,
      severity: "blocking",
      message:
        activityCount === 0
          ? "No activities exist for CPM review."
          : criticalActivities.length === 0
            ? "No critical path activities are marked."
            : criticalFloatMismatches.length > 0
              ? "Critical activities must have zero total float."
              : "Critical path is identified.",
      details: {
        criticalCount: criticalActivities.length,
        criticalFloatMismatches: criticalFloatMismatches.map((activity) => ({
          activityId: activity.id,
          totalFloat: activity.totalFloat,
        })),
      },
    },
    {
      key: "date_sanity",
      label: "Date sanity",
      passed: invalidDateRows.length === 0,
      severity: "blocking",
      message:
        invalidDateRows.length > 0
          ? "One or more activity dates or offsets are invalid."
          : projectBoundaryWarnings.length > 0
            ? "Dates are internally valid with project-boundary warnings."
            : "Dates and CPM offsets are internally valid.",
      details: {
        invalidRows: invalidDateRows,
        projectBoundaryWarnings,
      },
    },
  ];

  const blockingFailures = checks.filter(
    (check) => check.severity === "blocking" && !check.passed,
  );

  return {
    revisionId: revision?.id || null,
    status: normalizeRevisionStatus(revision?.status),
    ready: blockingFailures.length === 0,
    checkedAt: new Date().toISOString(),
    blockingCount: blockingFailures.length,
    checks,
  };
};

const ensureProject = async (orgId, projectId) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project)
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

const getLatestRevision = (projectId) =>
  prisma.scheduleRevision.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });

const getLatestCandidateRevision = (projectId) =>
  prisma.scheduleRevision.findFirst({
    where: {
      projectId,
      isActive: false,
      status: {
        in: [
          REVISION_STATUS.DRAFT,
          REVISION_STATUS.UNDER_REVIEW,
          REVISION_STATUS.APPROVED,
          REVISION_STATUS.REJECTED,
        ],
      },
    },
    orderBy: { createdAt: "desc" },
  });

const getActiveRevision = (projectId) =>
  prisma.scheduleRevision.findFirst({
    where: { projectId, isActive: true },
    orderBy: [{ activatedAt: "desc" }, { createdAt: "desc" }],
  });

const loadCurrentRevisionForLifecycle = async ({
  orgId,
  projectId,
  revisionId,
}) => {
  const project = await ensureProject(orgId, projectId);
  const [activeRevision, latestCandidate] = await Promise.all([
    getActiveRevision(projectId),
    getLatestCandidateRevision(projectId),
  ]);
  const defaultRevision = latestCandidate || activeRevision;

  if (!defaultRevision) {
    throw new HttpError(404, "REVISION_NOT_FOUND", "Revision not found");
  }

  const revision = revisionId
    ? await prisma.scheduleRevision.findFirst({
        where: { id: revisionId, projectId },
      })
    : defaultRevision;

  if (!revision) {
    throw new HttpError(404, "REVISION_NOT_FOUND", "Revision not found");
  }

  const currentIds = new Set(
    [activeRevision?.id, latestCandidate?.id].filter(Boolean),
  );
  if (!currentIds.has(revision.id)) {
    throw new HttpError(
      409,
      "REVISION_NOT_CURRENT",
      "Only the active schedule revision or latest staged revision can move through review and baseline.",
    );
  }

  return { project, revision };
};

const getReadinessForRevision = async ({ project, revision }) => {
  const stagedActivities = !revision.isActive
    ? buildReadinessActivitiesFromSnapshot(revision, project)
    : [];
  if (stagedActivities.length > 0) {
    const allocationSummary = await buildAllocationSummary({
      projectId: project.id,
    });
    return buildScheduleReadiness({
      project,
      revision,
      activities: stagedActivities,
      allocationSummary,
    });
  }

  const [activities, allocationSummary] = await Promise.all([
    prisma.activity.findMany({
      where: { projectId: project.id, isActive: true },
      include: {
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
    buildAllocationSummary({ projectId: project.id }),
  ]);

  return buildScheduleReadiness({
    project,
    revision,
    activities,
    allocationSummary,
  });
};

const assertAllowedStatus = (revision, allowed, action) => {
  const status = normalizeRevisionStatus(revision.status);
  if (!allowed.includes(status)) {
    throw new HttpError(
      409,
      "INVALID_REVISION_STATUS",
      `Schedule revision must be ${allowed.join(" or ")} before it can be ${action}.`,
      { status, allowed },
    );
  }
};

const supersedeOpenScheduleRevisions = async (
  tx,
  { orgId = null, projectId, userId = null, userRole = null, excludeId = null },
) => {
  const revisions = await tx.scheduleRevision.findMany({
    where: {
      projectId,
      id: excludeId ? { not: excludeId } : undefined,
      isActive: false,
      status: { in: OPEN_REVISION_STATUSES },
    },
  });

  const at = new Date();
  for (const revision of revisions) {
    await tx.scheduleRevision.update({
      where: { id: revision.id },
      data: {
        status: REVISION_STATUS.SUPERSEDED,
        supersededBy: userId,
        supersededAt: at,
        statusTransitionLog: appendStatusTransition(revision, {
          to: REVISION_STATUS.SUPERSEDED,
          userId,
          at,
          comment: "Superseded by a newer schedule revision",
        }),
      },
    });
    if (orgId) {
      await approvalWorkflowService.recordTransition({
        tx,
        orgId,
        projectId,
        recordType: approvalWorkflowService.RECORD_TYPES.SCHEDULE_REVISION,
        recordId: revision.id,
        fromStatus: revision.status,
        toStatus: REVISION_STATUS.SUPERSEDED,
        actorId: userId,
        actorRole: userRole,
        comment: "Superseded by a newer schedule revision",
      });
    }
  }
};

function parseMaybeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const normalizeNameKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const stagedActivityKey = (activity, index) =>
  trimOrNull(
    activity?.draftKey ||
      activity?.sourceActivityId ||
      activity?.sourceTaskId ||
      activity?.uid ||
      activity?.p6ActivityId ||
      activity?.activityId ||
      activity?.id ||
      activity?.wbsCode ||
      activity?.wbs,
  ) || `draft-${index + 1}`;

function normalizeSnapshotActivity(raw, index, project = {}) {
  const p6ActivityId = trimOrNull(
    raw?.p6ActivityId || raw?.activityId || raw?.id || raw?.uid,
  );
  const wbsCode = trimOrNull(raw?.wbsCode || raw?.wbs);
  const earlyStart = numberOrNull(raw?.earlyStart);
  const earlyFinish = numberOrNull(raw?.earlyFinish);

  return {
    draftKey: stagedActivityKey(raw, index),
    sourceActivityId: trimOrNull(raw?.sourceActivityId || raw?.sourceTaskId),
    uid: trimOrNull(raw?.uid),
    name: String(raw?.name || "Activity"),
    p6ActivityId,
    wbsCode,
    calendarId: trimOrNull(raw?.calendarId) || project.projectCalendar || null,
    category: trimOrNull(raw?.category || raw?.phase),
    startDate: parseMaybeDate(raw?.startDate || raw?.earlyStartDate),
    endDate: parseMaybeDate(raw?.endDate || raw?.earlyFinishDate),
    duration: Math.max(0, Number(raw?.duration ?? raw?.originalDuration) || 0),
    originalDuration:
      raw?.originalDuration != null ? Number(raw.originalDuration) : null,
    remainingDuration:
      raw?.remainingDuration != null ? Number(raw.remainingDuration) : null,
    physComplete:
      raw?.physComplete != null
        ? Math.max(0, Math.min(100, Number(raw.physComplete) || 0))
        : null,
    earlyStart: earlyStart ?? 0,
    earlyFinish:
      earlyFinish ??
      Math.max(0, (earlyStart ?? 0) + (Number(raw?.duration) || 0)),
    lateStart: numberOrNull(raw?.lateStart),
    lateFinish: numberOrNull(raw?.lateFinish),
    totalFloat: numberOrNull(raw?.totalFloat),
    budget: toMoneyNumber(raw?.budget),
    isMilestone: Boolean(raw?.isMilestone),
    isCritical: Boolean(raw?.isCritical ?? raw?.critical),
    predecessors: trimOrNull(raw?.predecessors),
    batchId: trimOrNull(raw?.batchId),
    sortOrder: Number.isFinite(Number(raw?.sortOrder))
      ? Number(raw.sortOrder)
      : index,
  };
}

function getSnapshotActivities(revision, project = {}) {
  const snapshot = revision?.snapshotJson || {};
  const rawActivities = Array.isArray(snapshot.activities)
    ? snapshot.activities
    : [];
  const seen = new Set();

  return rawActivities.map((raw, index) => {
    const normalized = normalizeSnapshotActivity(raw, index, project);
    let key = normalized.draftKey;
    if (seen.has(key)) key = `${key}#${index + 1}`;
    seen.add(key);
    return { ...normalized, draftKey: key, id: key };
  });
}

function buildStagedReferenceMap(stagedActivities) {
  const refMap = new Map();
  for (const activity of stagedActivities) {
    const refs = [
      activity.id,
      activity.draftKey,
      activity.sourceActivityId,
      activity.uid,
      activity.p6ActivityId,
      activity.wbsCode,
      activity.name,
    ];
    for (const ref of refs) {
      const key = trimOrNull(ref);
      if (key && !refMap.has(key)) refMap.set(key, activity);
    }
  }
  return refMap;
}

function getSnapshotDependencies(revision, stagedActivities) {
  const snapshot = revision?.snapshotJson || {};
  const explicit = Array.isArray(snapshot.dependencies)
    ? snapshot.dependencies
    : [];
  const refMap = buildStagedReferenceMap(stagedActivities);
  const rows = [];

  for (const row of explicit) {
    const predecessorRef = trimOrNull(
      row.predecessorRef || row.predecessorId || row.predRef || row.predId,
    );
    const successorRef = trimOrNull(
      row.successorRef || row.successorId || row.succRef || row.succId,
    );
    const predecessor = predecessorRef ? refMap.get(predecessorRef) : null;
    const successor = successorRef ? refMap.get(successorRef) : null;
    if (!predecessor || !successor || predecessor.id === successor.id) continue;
    rows.push({
      predecessorId: predecessor.id,
      successorId: successor.id,
      relationshipType: row.relationshipType || row.relType || "FS",
      lagDays: Math.round(Number(row.lagDays) || 0),
      source: row.source || "revision",
      importSource: row.importSource || snapshot.source || null,
      externalPredecessorRef: predecessorRef,
      externalSuccessorRef: successorRef,
      importMetadata: row.importMetadata || row.rawRelationship || null,
    });
  }

  if (rows.length > 0) return rows;

  for (const activity of stagedActivities) {
    const parsed = parsePredecessors(activity.predecessors);
    for (const dependency of parsed) {
      const predecessor = refMap.get(dependency.predRef);
      if (!predecessor || predecessor.id === activity.id) continue;
      rows.push({
        predecessorId: predecessor.id,
        successorId: activity.id,
        relationshipType: dependency.relType,
        lagDays: dependency.lagDays,
        source: "revision",
        importSource: snapshot.source || null,
        externalPredecessorRef: dependency.predRef,
        externalSuccessorRef: activity.draftKey,
        importMetadata: { rawPredecessor: dependency.raw },
      });
    }
  }

  return rows;
}

function buildReadinessActivitiesFromSnapshot(revision, project) {
  const stagedActivities = getSnapshotActivities(revision, project);
  const dependencies = getSnapshotDependencies(revision, stagedActivities);
  const byId = new Map(
    stagedActivities.map((activity) => [activity.id, activity]),
  );

  return stagedActivities.map((activity) => ({
    ...activity,
    predecessorLinks: dependencies
      .filter((row) => row.successorId === activity.id)
      .map((row) => ({
        ...row,
        predecessor: byId.get(row.predecessorId),
      })),
  }));
}

function activityIdentity(activity) {
  return {
    id: activity.id,
    name: activity.name,
    p6ActivityId: activity.p6ActivityId || null,
    wbsCode: activity.wbsCode || null,
    sortOrder: activity.sortOrder ?? null,
  };
}

function stagedIdentity(activity) {
  return {
    key: activity.draftKey,
    name: activity.name,
    p6ActivityId: activity.p6ActivityId || null,
    wbsCode: activity.wbsCode || null,
    sortOrder: activity.sortOrder ?? null,
  };
}

function suggestActivityMappings(existingActivities, stagedActivities) {
  const unmatchedStaged = new Set(
    stagedActivities.map((activity) => activity.draftKey),
  );
  const byP6 = new Map();
  const byWbs = new Map();
  const byName = new Map();

  for (const staged of stagedActivities) {
    if (staged.p6ActivityId && !byP6.has(staged.p6ActivityId)) {
      byP6.set(staged.p6ActivityId, staged);
    }
    if (staged.wbsCode && !byWbs.has(staged.wbsCode)) {
      byWbs.set(staged.wbsCode, staged);
    }
    const nameKey = normalizeNameKey(staged.name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, staged);
  }

  const mappings = [];
  for (const existing of existingActivities) {
    const candidates = [
      {
        staged: existing.p6ActivityId ? byP6.get(existing.p6ActivityId) : null,
        matchType: "p6_activity_id",
        confidence: 1,
      },
      {
        staged: existing.wbsCode ? byWbs.get(existing.wbsCode) : null,
        matchType: "wbs_code",
        confidence: 0.92,
      },
      {
        staged: byName.get(normalizeNameKey(existing.name)),
        matchType: "name",
        confidence: 0.8,
      },
    ];

    const match = candidates.find(
      (candidate) =>
        candidate.staged && unmatchedStaged.has(candidate.staged.draftKey),
    );
    if (!match) continue;

    unmatchedStaged.delete(match.staged.draftKey);
    mappings.push({
      oldActivityId: existing.id,
      newActivityKey: match.staged.draftKey,
      matchType: match.matchType,
      confidence: match.confidence,
      oldActivity: activityIdentity(existing),
      newActivity: stagedIdentity(match.staged),
    });
  }

  const mappedExisting = new Set(
    mappings.map((mapping) => mapping.oldActivityId),
  );
  return {
    mappings,
    unmappedExisting: existingActivities
      .filter((activity) => !mappedExisting.has(activity.id))
      .map(activityIdentity),
    newActivities: stagedActivities
      .filter((activity) => unmatchedStaged.has(activity.draftKey))
      .map(stagedIdentity),
  };
}

function activityDataFromStaged(staged, projectId) {
  return {
    projectId,
    name: staged.name,
    p6ActivityId: staged.p6ActivityId,
    wbsCode: staged.wbsCode,
    calendarId: staged.calendarId,
    category: staged.category,
    startDate: staged.startDate,
    endDate: staged.endDate,
    duration: staged.duration,
    originalDuration: staged.originalDuration,
    remainingDuration: staged.remainingDuration,
    physComplete: staged.physComplete,
    earlyStart: staged.earlyStart,
    earlyFinish: staged.earlyFinish,
    lateStart: staged.lateStart,
    lateFinish: staged.lateFinish,
    totalFloat: staged.totalFloat,
    budget: staged.budget,
    isMilestone: staged.isMilestone,
    isCritical: staged.isCritical,
    predecessors: staged.predecessors,
    batchId: staged.batchId,
    isActive: true,
    retiredAt: null,
    retiredBy: null,
    retiredReason: null,
    retiredRevisionId: null,
    sortOrder: staged.sortOrder,
  };
}

function serializeSnapshotActivity(activity) {
  return {
    ...activity,
    startDate: activity.startDate
      ? new Date(activity.startDate).toISOString()
      : null,
    endDate: activity.endDate ? new Date(activity.endDate).toISOString() : null,
  };
}

function buildGeneratedRevisionSnapshot({ scheduleJson, boqRows, project }) {
  const activities = Array.isArray(scheduleJson.activities)
    ? scheduleJson.activities.map((activity, index) =>
        serializeSnapshotActivity(
          normalizeSnapshotActivity(
            {
              ...activity,
              p6ActivityId: activity.p6ActivityId || activity.id,
              wbsCode: activity.wbsCode || activity.wbs,
              category: activity.category || activity.phase,
              isCritical: activity.isCritical ?? activity.critical,
              sortOrder: index,
            },
            index,
            project,
          ),
        ),
      )
    : [];

  return {
    ...scheduleJson,
    source: "ai",
    stagedAt: new Date().toISOString(),
    boqRows,
    activities,
  };
}

function parseFileToText(file) {
  const ext = file.originalname.split(".").pop().toLowerCase();
  if (!["xlsx", "xls", "csv"].includes(ext)) {
    throw new HttpError(
      400,
      "UNSUPPORTED_FORMAT",
      "Supported formats: .xlsx, .xls, .csv",
    );
  }
  const wb = file.path
    ? XLSX.readFile(file.path)
    : XLSX.read(file.buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils
    .sheet_to_json(ws, { header: 1, defval: "" })
    .map((r) => r.join(" | "))
    .join("\n");
}

function stripMarkdownJsonFences(raw) {
  return String(raw || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const numeric = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

/**
 * Attempt to repair truncated JSON from AI.
 * Handles: unclosed strings, trailing commas, missing closing brackets/braces.
 */
function repairJson(raw) {
  let s = String(raw || "").trim();

  s = s.replace(/,\s*([\]}])/g, "$1");

  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") braces += 1;
    else if (ch === "}") braces -= 1;
    else if (ch === "[") brackets += 1;
    else if (ch === "]") brackets -= 1;
  }

  if (inString) s += '"';
  s = s.replace(/,\s*$/, "");
  s += "]".repeat(Math.max(0, brackets));
  s += "}".repeat(Math.max(0, braces));
  return s;
}

function parseJsonWithRepair(cleaned, contextLabel) {
  try {
    return JSON.parse(cleaned);
  } catch {
    const repaired = repairJson(cleaned);
    try {
      const parsed = JSON.parse(repaired);
      console.warn(`[schedule] JSON repaired for ${contextLabel}`);
      return parsed;
    } catch {
      throw new Error(
        `AI returned invalid JSON for ${contextLabel} (repair failed)`,
      );
    }
  }
}

function getErrorStatus(err) {
  return err?.status || err?.statusCode || err?.response?.status;
}

function parseResetSeconds(value) {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Call Anthropic API with retry on 429/529.
 */
async function callWithRetry(apiFn, onRetry = null, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await apiFn();
    } catch (err) {
      const status = getErrorStatus(err);
      const isRateLimit = status === 429;
      const isOverloaded = status === 529;

      if ((isRateLimit || isOverloaded) && attempt < maxRetries) {
        let waitMs = isOverloaded ? 60_000 : 30_000;
        const headers = err?.headers || err?.response?.headers || {};
        const resetAfter =
          parseResetSeconds(headers["anthropic-ratelimit-reset-tokens"]) ||
          parseResetSeconds(headers["retry-after"]);
        if (resetAfter) {
          waitMs = Math.min((resetAfter + 2) * 1000, 120_000);
        }

        if (onRetry) onRetry(attempt, waitMs, status);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      throw err;
    }
  }

  throw new Error("AI request failed after retries");
}

async function structureBoqRows(rawText, { onRetry } = {}) {
  const msg = await callWithRetry(
    () =>
      client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system:
          "You are a BOQ parser. Return ONLY valid JSON array. No markdown.",
        messages: [
          {
            role: "user",
            content: `Parse this BOQ data. Return JSON array where each object has: "ref","description","unit"(one of LS m m2 m3 Nr kg t hr),"qty"(number),"rate"(number),"amount"(number),"section"(one of: ${PHASES.join(", ")}). Skip header/total rows. Only return the JSON array.\n\nDATA:\n${rawText}`,
          },
        ],
      }),
    onRetry,
  );

  if (msg.stop_reason === "max_tokens") {
    console.warn(
      "[schedule] AI response hit max_tokens - attempting JSON repair",
    );
  }

  const raw = msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const cleaned = stripMarkdownJsonFences(raw || "[]");
  const parsed = parseJsonWithRepair(cleaned, "BOQ parsing");

  if (!Array.isArray(parsed)) {
    throw new Error("AI returned invalid BOQ payload (expected array)");
  }

  return parsed.map((row) => {
    const qty = normalizeNumber(row?.qty);
    const rate = normalizeNumber(row?.rate);
    const amount =
      row?.amount !== undefined && row?.amount !== null && row?.amount !== ""
        ? toMoneyNumber(row.amount)
        : multiplyMoney(qty, rate);

    return {
      ref: row?.ref ? String(row.ref).trim() : null,
      description: String(row?.description || "").trim(),
      unit: row?.unit ? String(row.unit).trim() : null,
      qty,
      rate: toMoneyNumber(rate),
      amount,
      section: row?.section
        ? String(row.section).trim()
        : "Preliminary & General",
    };
  });
}

/**
 * Split BOQ rows into batches of <=60 items grouped by section.
 */
function chunkBoqRows(rows, maxPerBatch = 60) {
  if (!Array.isArray(rows) || rows.length <= maxPerBatch) return [rows || []];

  const bySection = {};
  for (const row of rows) {
    const sec = row.section || "General";
    if (!bySection[sec]) bySection[sec] = [];
    bySection[sec].push(row);
  }

  const batches = [];
  let current = [];
  for (const sec of Object.keys(bySection)) {
    const items = bySection[sec];
    for (let i = 0; i < items.length; i += maxPerBatch) {
      const slice = items.slice(i, i + maxPerBatch);
      if (current.length + slice.length > maxPerBatch && current.length > 0) {
        batches.push(current);
        current = [];
      }
      current.push(...slice);
    }
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

function extractText(msg) {
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Phase A: generate activities + CPM structure (core schedule).
 * Kept compact so output stays well under 8192 tokens.
 */
async function generateActivities(
  boqText,
  boqCount,
  project,
  batchLabel,
  prevContext,
  { onRetry } = {},
) {
  const totalBOQ = 0; // already encoded in boqText amounts
  const cv = project.contractValue
    ? `USD ${project.contractValue}`
    : "see BOQ amounts";
  const duration = project.duration || 18;
  const durationUnit = project.durationUnit || "months";
  const startDate = project.startDate
    ? new Date(project.startDate).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const batchRule = batchLabel
    ? `All activity IDs must be prefixed with ${batchLabel}- (e.g. ${batchLabel}-ACT-01).`
    : "";

  const msg = await callWithRetry(
    () =>
      client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8000,
        system:
          "Expert construction planning engineer. Return ONLY a raw JSON object — no markdown, no fences. Keep string values under 50 chars.",
        messages: [
          {
            role: "user",
            content: `Generate a CPM schedule for this construction project.

PROJECT: ${project.name} | ${project.type || "Construction"} | Start:${startDate} | Duration:${duration} ${durationUnit} | Value:${cv}

BOQ (${boqCount} items):
${boqText}

${batchRule}
${prevContext}

Return ONLY this JSON (no extra keys):
{"projectSummary":{"name":"","startDate":"","endDate":"","totalDuration":"","totalBudget":0,"totalActivities":0,"criticalActivities":0,"totalMilestones":0},"activities":[{"id":"","wbs":"","name":"","phase":"","duration":0,"earlyStart":0,"earlyFinish":0,"lateStart":0,"lateFinish":0,"totalFloat":0,"critical":false,"isMilestone":false,"predecessors":"","budget":0}],"criticalPath":[{"seq":0,"id":"","name":"","duration":0,"earlyStart":0,"earlyFinish":0}],"wbs":[{"code":"","level":1,"name":"","budget":0}],"milestones":[{"id":"","name":"","day":0,"phase":"","critical":false}]}

RULES:
- ES/EF/LS/LF = working days from day 0. TF = LF-EF.
- Generate 20-30 activities that cover all BOQ sections.
- ${batchRule || `Fit the full ${duration} ${durationUnit} duration.`}
- Output COMPLETE valid JSON — do not truncate.`,
          },
        ],
      }),
    onRetry,
  );

  if (msg.stop_reason === "max_tokens") {
    console.warn("[schedule] Phase A hit max_tokens — attempting JSON repair");
  }

  const cleaned = stripMarkdownJsonFences(extractText(msg));
  return parseJsonWithRepair(cleaned, "activities generation");
}

/**
 * Phase B: generate supporting data (risks, assumptions, long-lead, resources).
 * Non-fatal — if this fails the schedule is still saved with empty arrays.
 */
async function generateSupportData(project, activityNames, { onRetry } = {}) {
  const duration = project.duration || 18;
  const durationUnit = project.durationUnit || "months";

  const msg = await callWithRetry(
    () =>
      client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system:
          "Expert construction planning engineer. Return ONLY a raw JSON object — no markdown, no fences. Keep string values under 60 chars.",
        messages: [
          {
            role: "user",
            content: `Generate supporting risk and procurement data for:
PROJECT: ${project.name} | Duration: ${duration} ${durationUnit}
Activities: ${activityNames.slice(0, 20).join(", ")}

Return ONLY this JSON:
{"risks":[{"ref":"","description":"","probability":"medium","impact":"medium","severity":"MEDIUM","mitigation":"","phase":""}],"longLeadItems":[{"item":"","leadWeeks":0,"orderBy":"","activity":"","criticality":"medium","risk":""}],"assumptions":[{"ref":"","title":"","description":"","impact":""}],"resourceSummary":[{"phase":"","peakLabor":0,"avgLabor":0,"keyEquipment":"","keyMaterials":""}]}

RULES: 5-7 risks (HIGH/MEDIUM/LOW severity). 4-6 long-lead items. 4-6 assumptions. Complete valid JSON.`,
          },
        ],
      }),
    onRetry,
  );

  if (msg.stop_reason === "max_tokens") {
    console.warn("[schedule] Phase B hit max_tokens — attempting JSON repair");
  }

  const cleaned = stripMarkdownJsonFences(extractText(msg));
  return parseJsonWithRepair(cleaned, "support data generation");
}

function extractJsonArray(rawText) {
  const cleaned = stripMarkdownJsonFences(rawText);
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  return parseJsonWithRepair(
    cleaned.slice(start, end + 1),
    "resource allocation",
  );
}

function normalizeResourceType(value) {
  const type = String(value || "")
    .toLowerCase()
    .trim();
  if (type === "labour") return "labor";
  if (["labor", "equipment", "material"].includes(type)) return type;
  return null;
}

async function allocateResources({
  projectName,
  activities,
  boqSummary,
  onRetry,
}) {
  const activityList = activities.slice(0, 80).map((activity) => ({
    activityId: activity.p6ActivityId || activity.wbsCode || activity.id,
    name: activity.name,
    duration: activity.duration,
    discipline: activity.category || "general",
  }));

  const msg = await callWithRetry(
    () =>
      client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 7000,
        system:
          "You are a construction resource planner. Return ONLY valid JSON array. No markdown.",
        messages: [
          {
            role: "user",
            content: `Project: ${projectName}\nBOQ summary: ${boqSummary || "N/A"}\n\nFor each activity, allocate realistic resources.\nReturn ONLY JSON array in this exact shape:\n[\n  {\n    "activityId": "A-001",\n    "resources": [\n      { "resourceType": "labor", "resourceName": "Carpenter", "quantity": 4, "unit": "persons", "dailyRate": 80 }\n    ]\n  }\n]\n\nActivities:\n${JSON.stringify(activityList, null, 2)}\n\nRules:\n- resourceType must be labor, equipment, or material\n- quantity must be positive number\n- dailyRate should be realistic USD/day or USD/unit\n- Keep 1-4 resources per activity`,
          },
        ],
      }),
    onRetry,
  );

  const raw = extractText(msg);
  const parsed = extractJsonArray(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("AI did not return resource allocation array");
  }

  return parsed;
}

async function saveResourceAllocations(projectId, allocations) {
  await prisma.resourceAllocation.deleteMany({ where: { projectId } });

  const activities = await prisma.activity.findMany({
    where: { projectId },
    select: {
      id: true,
      duration: true,
      p6ActivityId: true,
      wbsCode: true,
      name: true,
    },
  });

  const lookup = new Map();
  for (const activity of activities) {
    lookup.set(activity.id, activity);
    if (activity.p6ActivityId) lookup.set(activity.p6ActivityId, activity);
    if (activity.wbsCode) lookup.set(activity.wbsCode, activity);
    lookup.set(activity.name, activity);
  }

  const rows = [];
  for (const block of allocations) {
    const activityKey = String(block?.activityId || "").trim();
    const activity = lookup.get(activityKey);
    if (!activity) continue;

    const resources = Array.isArray(block?.resources) ? block.resources : [];
    for (const resource of resources) {
      const resourceType = normalizeResourceType(resource?.resourceType);
      if (!resourceType) continue;

      const quantity = Math.max(0, Number(resource?.quantity) || 0);
      if (!quantity) continue;

      const dailyRate =
        resource?.dailyRate === null || resource?.dailyRate === undefined
          ? null
          : Math.max(0, toMoneyNumber(resource.dailyRate));

      const duration = Math.max(0, Number(activity.duration) || 0);
      const totalCost =
        dailyRate !== null
          ? multiplyMoney(multiplyMoney(dailyRate, quantity), duration)
          : null;

      rows.push({
        projectId,
        activityId: activity.id,
        resourceType,
        resourceName:
          String(resource?.resourceName || "").trim() || "Unspecified",
        quantity,
        unit: resource?.unit ? String(resource.unit).trim() : null,
        dailyRate,
        totalCost,
        notes: null,
      });
    }
  }

  if (rows.length > 0) {
    await prisma.resourceAllocation.createMany({ data: rows });
  }

  return rows.length;
}

async function generateCpmScheduleBatch(
  boqRows,
  project,
  batchLabel = null,
  prevContext = "",
  { onRetry } = {},
) {
  const boqText = boqRows
    .map(
      (r) =>
        `${r.ref || "-"}|${r.description}|${r.unit}|Qty:${r.qty}|Rate:${r.rate}|Amt:${r.amount}|Sec:${r.section}`,
    )
    .join("\n");

  // Phase A — core schedule (activities, CPM, WBS, milestones)
  const coreJson = await generateActivities(
    boqText,
    boqRows.length,
    project,
    batchLabel,
    prevContext,
    { onRetry },
  );

  // Phase B — supporting data (risks, long-lead, assumptions, resources)
  const activityNames = (coreJson.activities || []).map((a) => a.name || "");
  let supportJson = {
    risks: [],
    longLeadItems: [],
    assumptions: [],
    resourceSummary: [],
  };
  try {
    supportJson = await generateSupportData(project, activityNames, {
      onRetry,
    });
  } catch (e) {
    console.warn(
      "[schedule] Phase B (support data) failed — saving without it:",
      e.message,
    );
  }

  return { ...coreJson, ...supportJson };
}

async function generateCpmSchedule(boqRows, project, { onRetry } = {}) {
  return generateCpmScheduleBatch(boqRows, project, null, "", { onRetry });
}

async function generateCpmScheduleChunked(
  boqRows,
  project,
  { onBatchStart, onRetry } = {},
) {
  const batches = chunkBoqRows(boqRows, 60);

  if (batches.length === 1) {
    if (onBatchStart) onBatchStart(1, 1);
    return generateCpmSchedule(boqRows, project, {
      onRetry: (attempt, waitMs, status) => {
        if (onRetry) {
          onRetry(attempt, waitMs, {
            status,
            batchNum: 1,
            totalBatches: 1,
            batchLabel: "B1",
          });
        }
      },
    });
  }

  const allActivities = [];
  let lastBatchIds = [];
  let mergedSchedule = null;

  for (let i = 0; i < batches.length; i += 1) {
    const batchNum = i + 1;
    const batchRows = batches[i];
    const batchLabel = `B${batchNum}`;

    if (onBatchStart) onBatchStart(batchNum, batches.length);

    const prevContext =
      lastBatchIds.length > 0
        ? `PREVIOUS BATCH ACTIVITY IDs (use as predecessors where logical): ${lastBatchIds.join(", ")}`
        : "";

    const batchSchedule = await generateCpmScheduleBatch(
      batchRows,
      project,
      batchLabel,
      prevContext,
      {
        onRetry: (attempt, waitMs, status) => {
          if (onRetry) {
            onRetry(attempt, waitMs, {
              status,
              batchNum,
              totalBatches: batches.length,
              batchLabel,
            });
          }
        },
      },
    );

    const tagged = (batchSchedule.activities || []).map((activity, index) => {
      const fallbackId = `ACT-${String(index + 1).padStart(2, "0")}`;
      const sourceId = String(activity.id || fallbackId).trim();
      const normalizedId = sourceId.startsWith(`${batchLabel}-`)
        ? sourceId
        : `${batchLabel}-${sourceId}`;

      return {
        ...activity,
        id: normalizedId,
        batchId: batchLabel,
      };
    });

    allActivities.push(...tagged);
    lastBatchIds = tagged.map((activity) => activity.id);

    if (!mergedSchedule) {
      mergedSchedule = {
        ...batchSchedule,
        activities: [...tagged],
        risks: [...(batchSchedule.risks || [])],
        longLeadItems: [...(batchSchedule.longLeadItems || [])],
        assumptions: [...(batchSchedule.assumptions || [])],
        wbs: [...(batchSchedule.wbs || [])],
        milestones: [...(batchSchedule.milestones || [])],
        resourceSummary: [...(batchSchedule.resourceSummary || [])],
        criticalPath: [...(batchSchedule.criticalPath || [])],
      };
    } else {
      mergedSchedule.activities = allActivities;
      mergedSchedule.risks = [
        ...(mergedSchedule.risks || []),
        ...(batchSchedule.risks || []),
      ];
      mergedSchedule.longLeadItems = [
        ...(mergedSchedule.longLeadItems || []),
        ...(batchSchedule.longLeadItems || []),
      ];
      mergedSchedule.assumptions = [
        ...(mergedSchedule.assumptions || []),
        ...(batchSchedule.assumptions || []),
      ];
      mergedSchedule.wbs = [
        ...(mergedSchedule.wbs || []),
        ...(batchSchedule.wbs || []),
      ];
      mergedSchedule.milestones = [
        ...(mergedSchedule.milestones || []),
        ...(batchSchedule.milestones || []),
      ];
      mergedSchedule.resourceSummary = [
        ...(mergedSchedule.resourceSummary || []),
        ...(batchSchedule.resourceSummary || []),
      ];
      mergedSchedule.criticalPath = [
        ...(mergedSchedule.criticalPath || []),
        ...(batchSchedule.criticalPath || []),
      ];
    }
  }

  const baseSummary = mergedSchedule?.projectSummary || {};
  const totalBudget = allActivities.reduce(
    (sum, activity) => addMoney(sum, activity.budget),
    0,
  );
  mergedSchedule.activities = allActivities;
  mergedSchedule.projectSummary = {
    ...baseSummary,
    totalActivities: allActivities.length,
    criticalActivities: allActivities.filter((activity) =>
      Boolean(activity.critical),
    ).length,
    totalMilestones: allActivities.filter((activity) =>
      Boolean(activity.isMilestone),
    ).length,
    totalBudget,
  };

  return mergedSchedule;
}

function validateForGeneration(project, boqRows) {
  const errors = [];

  if (!project.name || !project.name.trim()) {
    errors.push("Project name is required");
  }
  if (!project.startDate) {
    errors.push("Project start date is required");
  }
  if (!project.duration || project.duration <= 0) {
    errors.push("Project duration must be greater than 0");
  }

  const describedRows = boqRows.filter(
    (row) => row.description && String(row.description).trim(),
  );
  if (describedRows.length < 2) {
    errors.push("At least 2 BOQ items with descriptions are required");
  }

  const negativeQty = boqRows.find((row) => normalizeNumber(row.qty) < 0);
  if (negativeQty) {
    errors.push(
      `Negative quantity found: "${negativeQty.description || "Unknown item"}"`,
    );
  }

  const negativeRate = boqRows.find((row) => normalizeNumber(row.rate) < 0);
  if (negativeRate) {
    errors.push(
      `Negative rate found: "${negativeRate.description || "Unknown item"}"`,
    );
  }

  return errors;
}

// -- In-memory async job store (TTL: 2 hours) --------------------------------
const jobs = new Map(); // jobId -> { status, step, error, projectId }

function setJob(jobId, data) {
  jobs.set(jobId, { ...jobs.get(jobId), ...data, updatedAt: Date.now() });
}

// Clean up jobs older than 2 hours every 30 minutes
const jobCleanupTimer = setInterval(
  () => {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, job] of jobs) {
      if (job.updatedAt < cutoff) jobs.delete(id);
    }
  },
  30 * 60 * 1000,
);
if (typeof jobCleanupTimer.unref === "function") jobCleanupTimer.unref();

const getJob = (jobId) => jobs.get(jobId) || null;

async function runGeneratePipeline({
  jobId,
  orgId,
  projectId,
  rawText,
  project,
  label,
  userId = null,
}) {
  try {
    // Step 2: structure BOQ
    setJob(jobId, {
      status: "running",
      step: JOB_STEPS[0].label,
      currentStep: 0,
      totalSteps: JOB_STEPS.length,
      steps: JOB_STEPS,
      progress: 10,
    });
    let boqRows;
    try {
      boqRows = await structureBoqRows(rawText, {
        onRetry: (attempt, waitMs, status) => {
          const seconds = Math.max(1, Math.round(waitMs / 1000));
          const label = status === 529 ? "API overloaded" : "Rate limited";
          setJob(jobId, {
            step: `${JOB_STEPS[0].label} (${label} - retrying in ${seconds}s, attempt ${attempt})`,
          });
        },
      });
    } catch (e) {
      console.error("[schedule] BOQ parsing failed:", e);
      return setJob(jobId, {
        status: "error",
        error: `AI BOQ parsing failed: ${e.message}`,
      });
    }
    if (!Array.isArray(boqRows) || boqRows.length === 0) {
      return setJob(jobId, {
        status: "error",
        error: "No BOQ items found in file",
      });
    }

    const validationErrors = validateForGeneration(project, boqRows);
    if (validationErrors.length > 0) {
      return setJob(jobId, {
        status: "error",
        error: `Validation failed:\n• ${validationErrors.join("\n• ")}`,
      });
    }

    // Step 3: generate CPM schedule
    setJob(jobId, {
      step: JOB_STEPS[1].label,
      currentStep: 1,
      progress: 45,
    });
    let scheduleJson;
    try {
      scheduleJson = await generateCpmScheduleChunked(boqRows, project, {
        onBatchStart: (batchNum, totalBatches) => {
          if (totalBatches > 1) {
            setJob(jobId, {
              step: `${JOB_STEPS[1].label} (batch ${batchNum}/${totalBatches})`,
              progress: Math.min(75, 45 + batchNum * 5),
            });
          } else {
            setJob(jobId, { step: JOB_STEPS[1].label, progress: 65 });
          }
        },
        onRetry: (attempt, waitMs, context) => {
          const seconds = Math.max(1, Math.round(waitMs / 1000));
          const label =
            context?.status === 529 ? "API overloaded" : "Rate limited";
          const batchSuffix =
            context?.totalBatches > 1
              ? ` for batch ${context.batchNum} of ${context.totalBatches}`
              : "";
          setJob(jobId, {
            step: `${JOB_STEPS[1].label} (${label}${batchSuffix}, retrying in ${seconds}s, attempt ${attempt})`,
          });
        },
      });
    } catch (e) {
      console.error("[schedule] CPM generation failed:", e);
      return setJob(jobId, {
        status: "error",
        error: `AI schedule generation failed: ${e.message}`,
      });
    }

    // Step 4: persist a draft revision only. Official schedule records are
    // activated later after review, mapping, and explicit removal approval.
    setJob(jobId, { step: "Saving draft schedule revision", progress: 80 });
    const revisionSnapshot = buildGeneratedRevisionSnapshot({
      scheduleJson,
      boqRows,
      project,
    });
    let stagedRevisionId = null;
    await prisma.$transaction(async (tx) => {
      await supersedeOpenScheduleRevisions(tx, { orgId, projectId, userId, userRole: null });

      const activities = revisionSnapshot.activities || [];
      const activityCount = activities.length;
      const criticalCount = activities.filter(
        (activity) => activity.isCritical,
      ).length;
      const totalBudget = toMoneyNumber(
        scheduleJson.projectSummary?.totalBudget,
      );
      const createdAt = new Date();
      const revision = await tx.scheduleRevision.create({
        data: {
          projectId,
          label: label || "AI Generated",
          source: "ai",
          activityCount,
          criticalCount,
          totalBudget,
          snapshotJson: revisionSnapshot,
          status: REVISION_STATUS.DRAFT,
          isActive: false,
          statusTransitionLog: [
            {
              from: null,
              to: REVISION_STATUS.DRAFT,
              by: userId,
              at: createdAt.toISOString(),
              comment: "Staged AI schedule revision created",
              reason: null,
            },
          ],
        },
      });
      stagedRevisionId = revision.id;
    });

    // Step 5: pass 3 resource allocation (non-fatal)
    setJob(jobId, {
      step: JOB_STEPS[2].label,
      currentStep: 2,
      progress: 88,
    });

    try {
      const stagedActivities = revisionSnapshot.activities || [];

      const boqSummary = boqRows
        .slice(0, 20)
        .map((row) => `${row.section || "General"}: ${row.description}`)
        .join("; ");

      const allocations = await allocateResources({
        projectName: project.name,
        activities: stagedActivities,
        boqSummary,
        onRetry: (attempt, waitMs, status) => {
          const seconds = Math.max(1, Math.round(waitMs / 1000));
          const label = status === 529 ? "API overloaded" : "Rate limited";
          setJob(jobId, {
            step: `${JOB_STEPS[2].label} (${label} - retrying in ${seconds}s, attempt ${attempt})`,
          });
        },
      });

      await prisma.scheduleRevision.update({
        where: { id: stagedRevisionId },
        data: {
          snapshotJson: {
            ...revisionSnapshot,
            resourceAllocations: allocations,
          },
        },
      });
      const resourceCount = allocations.reduce(
        (count, block) =>
          count +
          (Array.isArray(block?.resources) ? block.resources.length : 0),
        0,
      );
      setJob(jobId, {
        step: `${JOB_STEPS[2].label} (${resourceCount} draft records)`,
        progress: 97,
      });
    } catch (resourceError) {
      console.warn(
        "[schedule] Pass 3 resource allocation failed (non-fatal):",
        resourceError.message,
      );
      setJob(jobId, {
        step: `${JOB_STEPS[2].label} skipped: ${resourceError.message}`,
      });
    }

    setJob(jobId, {
      status: "done",
      step: "Complete",
      currentStep: JOB_STEPS.length,
      totalSteps: JOB_STEPS.length,
      steps: JOB_STEPS,
      progress: 100,
    });
  } catch (e) {
    console.error("[schedule] Pipeline error:", e);
    setJob(jobId, {
      status: "error",
      error: e.message || "Unexpected error",
      steps: JOB_STEPS,
      totalSteps: JOB_STEPS.length,
    });
  }
}

// Returns immediately with jobId; processing runs in background
const startGenerateJob = async ({
  orgId,
  projectId,
  file,
  label = null,
  userId = null,
}) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project)
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");

  let rawText;
  try {
    rawText = parseFileToText(file);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(
      400,
      "FILE_PARSE_ERROR",
      `Could not read file: ${e.message}`,
    );
  }
  if (!rawText.trim())
    throw new HttpError(400, "EMPTY_FILE", "No content found in file");

  const jobId = `${projectId}-${Date.now()}`;
  setJob(jobId, {
    status: "running",
    step: JOB_STEPS[0].label,
    currentStep: 0,
    totalSteps: JOB_STEPS.length,
    steps: JOB_STEPS,
    progress: 5,
    projectId,
  });

  // Fire-and-forget - do NOT await
  runGeneratePipeline({
    jobId,
    orgId,
    projectId,
    rawText,
    project,
    label,
    userId,
  });

  return { jobId };
};

const getProjectSchedule = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project)
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");

  const revision =
    (await getActiveRevision(projectId)) ||
    (await getLatestRevision(projectId));

  if (!revision) return null;

  const [activities, allocationTotals, allocationSummary] = await Promise.all([
    prisma.activity.findMany({
      where: { projectId, isActive: true },
      include: {
        progress: {
          where: { status: "approved" },
          orderBy: { updatedAt: "desc" },
          take: 1,
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
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { sortOrder: "asc" },
    }),
    getApprovedActivityAllocationTotals({ projectId }),
    buildAllocationSummary({ projectId }),
  ]);

  const snap = revision.snapshotJson || {};

  const readiness = buildScheduleReadiness({
    project,
    revision,
    activities,
    allocationSummary,
  });
  let criticalPathExplanation = null;
  try {
    criticalPathExplanation = buildCriticalPathExplanation(activities);
  } catch (error) {
    criticalPathExplanation = {
      error: {
        code: error.code || "CRITICAL_PATH_EXPLANATION_UNAVAILABLE",
        message:
          error.message ||
          "Critical path explanation is unavailable until dependencies are valid.",
      },
    };
  }

  return {
    revision: serializeRevision(revision, {
      totalBudget: allocationSummary.approvedAllocatedAmount,
      generatedTotalBudget: revision.totalBudget,
      unallocatedBoqAmount: allocationSummary.unallocatedAmount,
      readiness,
      projectSummary: snap.projectSummary || null,
      risks: snap.risks || [],
      milestones: snap.milestones || [],
      wbs: snap.wbs || [],
      resourceSummary: snap.resourceSummary || [],
      longLeadItems: snap.longLeadItems || [],
      assumptions: snap.assumptions || [],
      criticalPath: snap.criticalPath || [],
      criticalPathExplanation,
    }),
    activities: activities.map((activity) => {
      const latestProgress = activity.progress[0] ?? null;
      const pct = latestProgress?.pctComplete ?? 0;
      const actualCost = latestProgress?.actualCost ?? null;
      const actualStart = latestProgress?.actualStart ?? null;
      const actualFinish = latestProgress?.actualFinish ?? null;
      const approvedAllocation = allocationTotals.get(activity.id) || {
        quantity: 0,
        amount: 0,
        weight: 0,
        count: 0,
      };
      let status = "todo";
      if (pct >= 100) status = "complete";
      else if (pct > 0) status = "in_progress";
      else if (activity.endDate && new Date() > new Date(activity.endDate))
        status = "delayed";

      const { progress, predecessorLinks, ...activityWithoutProgress } =
        activity;
      return {
        ...activityWithoutProgress,
        ...buildPlannedDateFields(activity, project),
        dependencies: predecessorLinks.map((row) =>
          serializeDependencyDto(row),
        ),
        generatedBudget: activity.budget,
        budget: approvedAllocation.amount,
        allocatedBoqQuantity: approvedAllocation.quantity,
        allocatedBoqAmount: approvedAllocation.amount,
        allocatedBoqWeight: approvedAllocation.weight,
        approvedAllocationCount: approvedAllocation.count,
        pctComplete: pct,
        actualCost,
        actualStart,
        actualFinish,
        status,
      };
    }),
  };
};

const listRevisions = async ({ orgId, projectId }) => {
  await ensureProject(orgId, projectId);

  const revisions = await prisma.scheduleRevision.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });

  return revisions.map((revision) => serializeRevision(revision));
};

const getRevision = async ({ orgId, projectId, revisionId }) => {
  await ensureProject(orgId, projectId);

  const revision = await prisma.scheduleRevision.findFirst({
    where: { id: revisionId, projectId },
  });

  if (!revision) return null;

  return serializeRevision(revision, {
    snapshotJson: revision.snapshotJson,
  });
};

const getRevisionMapping = async ({ orgId, projectId, revisionId }) => {
  const project = await ensureProject(orgId, projectId);
  const revision = await prisma.scheduleRevision.findFirst({
    where: { id: revisionId, projectId },
  });

  if (!revision) {
    throw new HttpError(404, "REVISION_NOT_FOUND", "Revision not found");
  }

  const [existingActivities, stagedActivities] = await Promise.all([
    prisma.activity.findMany({
      where: { projectId, isActive: true },
      select: {
        id: true,
        name: true,
        p6ActivityId: true,
        wbsCode: true,
        sortOrder: true,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    Promise.resolve(getSnapshotActivities(revision, project)),
  ]);

  const suggestions = suggestActivityMappings(
    existingActivities,
    stagedActivities,
  );

  return {
    revision: serializeRevision(revision),
    counts: {
      existing: existingActivities.length,
      staged: stagedActivities.length,
      suggestedMappings: suggestions.mappings.length,
      unmappedExisting: suggestions.unmappedExisting.length,
      newActivities: suggestions.newActivities.length,
    },
    suggestedMappings: suggestions.mappings,
    unmappedExisting: suggestions.unmappedExisting,
    newActivities: suggestions.newActivities,
  };
};

function normalizeActivationMappings(mappings) {
  if (!Array.isArray(mappings)) return [];
  return mappings
    .map((mapping) => ({
      oldActivityId: trimOrNull(mapping?.oldActivityId),
      newActivityKey: trimOrNull(mapping?.newActivityKey),
    }))
    .filter((mapping) => mapping.oldActivityId && mapping.newActivityKey);
}

function normalizeUnmappedRemovals(removals) {
  if (!Array.isArray(removals)) return [];
  return removals
    .map((removal) => ({
      oldActivityId: trimOrNull(removal?.oldActivityId),
      reason: trimOrNull(removal?.reason),
    }))
    .filter((removal) => removal.oldActivityId);
}

async function activateRevisionSnapshot({
  project,
  revision,
  mappings,
  unmappedRemovals,
  userId,
  comment = null,
  allowedStatuses = [REVISION_STATUS.APPROVED],
  statusOverride = null,
  transitionComment = "Schedule revision activated",
}) {
  const status = normalizeRevisionStatus(revision.status);
  if (!allowedStatuses.includes(status)) {
    throw new HttpError(
      409,
      "INVALID_REVISION_STATUS",
      `Schedule revision must be ${allowedStatuses.join(" or ")} before activation.`,
      { status, allowed: allowedStatuses },
    );
  }

  const stagedActivities = getSnapshotActivities(revision, project);
  if (stagedActivities.length === 0) {
    throw new HttpError(
      400,
      "NO_STAGED_ACTIVITIES",
      "Revision snapshot does not contain staged activities to activate.",
    );
  }

  const existingActivities = await prisma.activity.findMany({
    where: { projectId: project.id, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  const stagedByKey = new Map(
    stagedActivities.map((activity) => [activity.draftKey, activity]),
  );
  const existingById = new Map(
    existingActivities.map((activity) => [activity.id, activity]),
  );
  const normalizedMappings = normalizeActivationMappings(mappings);
  const normalizedRemovals = normalizeUnmappedRemovals(unmappedRemovals);
  const removalReasons = new Map(
    normalizedRemovals.map((removal) => [
      removal.oldActivityId,
      removal.reason,
    ]),
  );

  if (
    existingActivities.length > 0 &&
    normalizedMappings.length === 0 &&
    normalizedRemovals.length === 0
  ) {
    throw new HttpError(
      400,
      "MAPPING_CONFIRMATION_REQUIRED",
      "Activity mapping confirmation is required before activating a staged revision.",
    );
  }

  const usedOldIds = new Set();
  const usedNewKeys = new Set();
  for (const mapping of normalizedMappings) {
    if (!existingById.has(mapping.oldActivityId)) {
      throw new HttpError(
        400,
        "INVALID_ACTIVITY_MAPPING",
        "Mapping references an activity outside the active schedule.",
        mapping,
      );
    }
    if (!stagedByKey.has(mapping.newActivityKey)) {
      throw new HttpError(
        400,
        "INVALID_ACTIVITY_MAPPING",
        "Mapping references an activity outside the staged revision.",
        mapping,
      );
    }
    if (
      usedOldIds.has(mapping.oldActivityId) ||
      usedNewKeys.has(mapping.newActivityKey)
    ) {
      throw new HttpError(
        400,
        "DUPLICATE_ACTIVITY_MAPPING",
        "Each old and new activity can only be mapped once.",
      );
    }
    usedOldIds.add(mapping.oldActivityId);
    usedNewKeys.add(mapping.newActivityKey);
  }

  const missingRemovalReasons = existingActivities
    .filter((activity) => !usedOldIds.has(activity.id))
    .filter((activity) => !removalReasons.get(activity.id))
    .map(activityIdentity);

  if (missingRemovalReasons.length > 0) {
    throw new HttpError(
      400,
      "UNMAPPED_REMOVAL_REASON_REQUIRED",
      "Every unmapped active activity needs an explicit removal reason.",
      { unmappedExisting: missingRemovalReasons },
    );
  }

  const at = new Date();
  const previousActive = await getActiveRevision(project.id);
  const revisionDependencies = getSnapshotDependencies(
    revision,
    stagedActivities,
  );
  const snapshot = revision.snapshotJson || {};

  const result = await prisma.$transaction(async (tx) => {
    const draftKeyToActivityId = new Map();
    const newActivityIds = new Set();
    const updatedActivityIds = [];
    const retiredActivityIds = [];

    for (const mapping of normalizedMappings) {
      const staged = stagedByKey.get(mapping.newActivityKey);
      const data = activityDataFromStaged(staged, project.id);
      const updated = await tx.activity.update({
        where: { id: mapping.oldActivityId },
        data,
      });
      draftKeyToActivityId.set(mapping.newActivityKey, updated.id);
      updatedActivityIds.push(updated.id);
    }

    for (const staged of stagedActivities) {
      if (usedNewKeys.has(staged.draftKey)) continue;
      const created = await tx.activity.create({
        data: activityDataFromStaged(staged, project.id),
      });
      draftKeyToActivityId.set(staged.draftKey, created.id);
      newActivityIds.add(created.id);
    }

    for (const activity of existingActivities) {
      if (usedOldIds.has(activity.id)) continue;
      const reason = removalReasons.get(activity.id);
      await tx.activity.update({
        where: { id: activity.id },
        data: {
          isActive: false,
          retiredAt: at,
          retiredBy: userId || null,
          retiredReason: reason,
          retiredRevisionId: revision.id,
        },
      });
      retiredActivityIds.push(activity.id);
    }

    await tx.activityDependency.deleteMany({
      where: { projectId: project.id },
    });
    const dependencyRows = revisionDependencies
      .map((dependency) => ({
        ...dependency,
        predecessorId: draftKeyToActivityId.get(dependency.predecessorId),
        successorId: draftKeyToActivityId.get(dependency.successorId),
        source: dependency.source || "revision",
        importSource:
          dependency.importSource || revision.source || snapshot.source || null,
      }))
      .filter(
        (dependency) =>
          dependency.predecessorId &&
          dependency.successorId &&
          dependency.predecessorId !== dependency.successorId,
      );

    if (dependencyRows.length > 0) {
      await createProjectDependencies(tx, {
        projectId: project.id,
        dependencies: dependencyRows,
        source: "revision",
        importSource: revision.source || snapshot.source || "schedule_revision",
        replaceExisting: false,
      });
    }

    const activatedActivityIds = Array.from(draftKeyToActivityId.values());
    const existingCostRows = await tx.costRecord.findMany({
      where: {
        projectId: project.id,
        activityId: { in: activatedActivityIds },
      },
      select: { activityId: true },
    });
    const costCovered = new Set(existingCostRows.map((row) => row.activityId));
    const costRows = stagedActivities
      .map((staged) => ({
        staged,
        activityId: draftKeyToActivityId.get(staged.draftKey),
      }))
      .filter(({ activityId }) => activityId && !costCovered.has(activityId))
      .map(({ staged, activityId }) => ({
        activityId,
        projectId: project.id,
        budget: staged.budget || 0,
        labour: (staged.budget || 0) * 0.35,
        material: (staged.budget || 0) * 0.3,
        equipment: (staged.budget || 0) * 0.15,
        subcontract: (staged.budget || 0) * 0.1,
        indirect: (staged.budget || 0) * 0.05,
        overhead: (staged.budget || 0) * 0.03,
        contingency: (staged.budget || 0) * 0.02,
        committed: 0,
        actual: 0,
        forecast: staged.budget || 0,
      }));
    if (costRows.length > 0) {
      await tx.costRecord.createMany({ data: costRows });
    }

    const resourceBlocks = Array.isArray(snapshot.resourceAllocations)
      ? snapshot.resourceAllocations
      : [];
    const stagedRefMap = buildStagedReferenceMap(stagedActivities);
    const resourceRows = [];
    for (const block of resourceBlocks) {
      const staged =
        stagedRefMap.get(trimOrNull(block?.activityId)) ||
        stagedByKey.get(trimOrNull(block?.activityId));
      const activityId = staged
        ? draftKeyToActivityId.get(staged.draftKey)
        : null;
      if (!activityId || !newActivityIds.has(activityId)) continue;
      for (const resource of Array.isArray(block?.resources)
        ? block.resources
        : []) {
        const resourceType = normalizeResourceType(resource?.resourceType);
        const quantity = Math.max(0, Number(resource?.quantity) || 0);
        if (!resourceType || !quantity) continue;
        const dailyRate =
          resource?.dailyRate === null || resource?.dailyRate === undefined
            ? null
            : Math.max(0, toMoneyNumber(resource.dailyRate));
        const stagedActivity = stagedActivities.find(
          (activity) =>
            draftKeyToActivityId.get(activity.draftKey) === activityId,
        );
        const totalCost =
          dailyRate !== null
            ? multiplyMoney(
                multiplyMoney(dailyRate, quantity),
                Number(stagedActivity?.duration || 0),
              )
            : null;
        resourceRows.push({
          projectId: project.id,
          activityId,
          resourceType,
          resourceName:
            String(resource?.resourceName || "").trim() || "Unspecified",
          quantity,
          unit: resource?.unit ? String(resource.unit).trim() : null,
          dailyRate,
          totalCost,
          notes: "Activated from staged schedule revision",
        });
      }
    }
    if (resourceRows.length > 0) {
      await tx.resourceAllocation.createMany({ data: resourceRows });
    }

    if (previousActive && previousActive.id !== revision.id) {
      await tx.scheduleRevision.update({
        where: { id: previousActive.id },
        data: {
          isActive: false,
          status: REVISION_STATUS.SUPERSEDED,
          supersededBy: userId || null,
          supersededAt: at,
          statusTransitionLog: appendStatusTransition(previousActive, {
            to: REVISION_STATUS.SUPERSEDED,
            userId,
            at,
            comment: `Superseded by activated revision ${revision.id}`,
          }),
        },
      });
    }

    const mappingJson = {
      mappings: normalizedMappings,
      unmappedRemovals: normalizedRemovals,
      confirmedBy: userId || null,
      confirmedAt: at.toISOString(),
    };
    const activationAuditJson = {
      activatedAt: at.toISOString(),
      activatedBy: userId || null,
      previousActiveRevisionId: previousActive?.id || null,
      updatedActivities: updatedActivityIds,
      newActivities: Array.from(newActivityIds),
      retiredActivities: retiredActivityIds,
      dependencyCount: dependencyRows.length,
      costRecordsCreated: costRows.length,
      resourceAllocationsCreated: resourceRows.length,
    };

    const updatedRevision = await tx.scheduleRevision.update({
      where: { id: revision.id },
      data: {
        isActive: true,
        status: statusOverride || revision.status,
        activatedBy: userId || null,
        activatedAt: at,
        activationComment: trimOrNull(comment),
        previousActiveRevisionId:
          previousActive && previousActive.id !== revision.id
            ? previousActive.id
            : revision.previousActiveRevisionId || null,
        mappingJson,
        activationAuditJson,
        statusTransitionLog: [
          ...statusTransitionLog(revision),
          {
            from: normalizeRevisionStatus(revision.status),
            to: "activated",
            by: userId || null,
            at: at.toISOString(),
            comment: trimOrNull(transitionComment || comment),
            reason: null,
          },
        ],
      },
    });

    return { revision: updatedRevision, activationAuditJson };
  });

  return {
    revision: serializeRevision(result.revision),
    activation: result.activationAuditJson,
  };
}

const activateRevision = async ({
  orgId,
  projectId,
  revisionId,
  userId,
  mappings,
  unmappedRemovals,
  comment = null,
}) => {
  const project = await ensureProject(orgId, projectId);
  const revision = await prisma.scheduleRevision.findFirst({
    where: { id: revisionId, projectId },
  });
  if (!revision) {
    throw new HttpError(404, "REVISION_NOT_FOUND", "Revision not found");
  }

  return activateRevisionSnapshot({
    project,
    revision,
    mappings,
    unmappedRemovals,
    userId,
    comment,
  });
};

const rollbackRevision = async ({
  orgId,
  projectId,
  revisionId,
  userId,
  reason,
}) => {
  const project = await ensureProject(orgId, projectId);
  const revision = await prisma.scheduleRevision.findFirst({
    where: { id: revisionId, projectId },
  });
  if (!revision) {
    throw new HttpError(404, "REVISION_NOT_FOUND", "Revision not found");
  }
  if (!revision.isActive) {
    throw new HttpError(
      409,
      "REVISION_NOT_ACTIVE",
      "Only the active schedule revision can be rolled back.",
    );
  }

  const rollbackReason = trimOrNull(reason);
  if (!rollbackReason) {
    throw new HttpError(
      400,
      "ROLLBACK_REASON_REQUIRED",
      "A rollback reason is required.",
    );
  }

  const targetRevisionId = revision.previousActiveRevisionId;
  if (!targetRevisionId) {
    throw new HttpError(
      409,
      "ROLLBACK_TARGET_NOT_FOUND",
      "No previous active schedule revision is available for rollback.",
    );
  }

  const targetRevision = await prisma.scheduleRevision.findFirst({
    where: { id: targetRevisionId, projectId },
  });
  if (!targetRevision) {
    throw new HttpError(
      404,
      "ROLLBACK_TARGET_NOT_FOUND",
      "Previous active schedule revision was not found.",
    );
  }

  const mapping = await getRevisionMapping({
    orgId,
    projectId,
    revisionId: targetRevision.id,
  });
  const unmappedRemovals = mapping.unmappedExisting.map((activity) => ({
    oldActivityId: activity.id,
    reason: rollbackReason,
  }));

  const activated = await activateRevisionSnapshot({
    project,
    revision: targetRevision,
    mappings: mapping.suggestedMappings,
    unmappedRemovals,
    userId,
    comment: rollbackReason,
    allowedStatuses: [
      REVISION_STATUS.APPROVED,
      REVISION_STATUS.BASELINED,
      REVISION_STATUS.SUPERSEDED,
    ],
    statusOverride:
      normalizeRevisionStatus(targetRevision.status) ===
      REVISION_STATUS.BASELINED
        ? REVISION_STATUS.BASELINED
        : REVISION_STATUS.APPROVED,
    transitionComment: `Rolled back from revision ${revision.id}`,
  });

  const at = new Date();
  const rolledBackRevision = await prisma.scheduleRevision.findFirst({
    where: { id: revision.id, projectId },
  });
  await prisma.scheduleRevision.update({
    where: { id: revision.id },
    data: {
      rolledBackBy: userId || null,
      rolledBackAt: at,
      rollbackReason,
      statusTransitionLog: [
        ...statusTransitionLog(rolledBackRevision || revision),
        {
          from: normalizeRevisionStatus(
            (rolledBackRevision || revision).status,
          ),
          to: "rolled_back",
          by: userId || null,
          at: at.toISOString(),
          comment: null,
          reason: rollbackReason,
        },
      ],
    },
  });

  return activated;
};

const getScheduleReadiness = async ({
  orgId,
  projectId,
  revisionId = null,
}) => {
  const { project, revision } = revisionId
    ? await loadCurrentRevisionForLifecycle({ orgId, projectId, revisionId })
    : {
        project: await ensureProject(orgId, projectId),
        revision:
          (await getActiveRevision(projectId)) ||
          (await getLatestRevision(projectId)),
      };

  if (!revision) {
    throw new HttpError(404, "REVISION_NOT_FOUND", "Revision not found");
  }

  return getReadinessForRevision({ project, revision });
};

const submitRevisionForReview = async ({
  orgId,
  projectId,
  revisionId,
  userId,
  userRole = null,
  comment = null,
}) => {
  const { project, revision } = await loadCurrentRevisionForLifecycle({
    orgId,
    projectId,
    revisionId,
  });

  assertAllowedStatus(
    revision,
    [REVISION_STATUS.DRAFT, REVISION_STATUS.REJECTED],
    "submitted for review",
  );

  const readiness = await getReadinessForRevision({ project, revision });
  const at = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.scheduleRevision.update({
      where: { id: revision.id },
      data: {
        status: REVISION_STATUS.UNDER_REVIEW,
        submittedBy: userId,
        submittedAt: at,
        reviewComment: trimOrNull(comment),
        readinessJson: readiness,
        statusTransitionLog: appendStatusTransition(revision, {
          to: REVISION_STATUS.UNDER_REVIEW,
          userId,
          at,
          comment,
        }),
      },
    });

    await auditRevisionTransition({
      tx,
      orgId,
      revision,
      action: auditService.ACTIONS.STATUS_CHANGED,
      actorId: userId,
      occurredAt: at,
      newStatus: REVISION_STATUS.UNDER_REVIEW,
      reason: comment,
      summary: {
        transition: "revision.submit_review",
        readinessReady: readiness.ready,
        readinessBlockingCount: readiness.blockingCount,
      },
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.SCHEDULE_REVISION,
      recordId: revision.id,
      fromStatus: revision.status,
      toStatus: REVISION_STATUS.UNDER_REVIEW,
      actorId: userId,
      actorRole: userRole,
      comment,
      metadata: {
        readinessReady: readiness.ready,
        readinessBlockingCount: readiness.blockingCount,
      },
    });

    return row;
  });

  return serializeRevision(updated);
};

const approveRevision = async ({
  orgId,
  projectId,
  revisionId,
  userId,
  userRole = null,
  comment = null,
}) => {
  const { project, revision } = await loadCurrentRevisionForLifecycle({
    orgId,
    projectId,
    revisionId,
  });

  assertAllowedStatus(revision, [REVISION_STATUS.UNDER_REVIEW], "approved");

  const readiness = await getReadinessForRevision({ project, revision });
  if (!readiness.ready) {
    throw new HttpError(
      400,
      "SCHEDULE_NOT_READY",
      "Schedule readiness checks must pass before approval.",
      readiness,
    );
  }

  const at = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.scheduleRevision.update({
      where: { id: revision.id },
      data: {
        status: REVISION_STATUS.APPROVED,
        approvedBy: userId,
        approvedAt: at,
        approvalComment: trimOrNull(comment),
        readinessJson: readiness,
        statusTransitionLog: appendStatusTransition(revision, {
          to: REVISION_STATUS.APPROVED,
          userId,
          at,
          comment,
        }),
      },
    });

    await auditRevisionTransition({
      tx,
      orgId,
      revision,
      action: auditService.ACTIONS.APPROVED,
      actorId: userId,
      occurredAt: at,
      newStatus: REVISION_STATUS.APPROVED,
      reason: comment,
      summary: {
        transition: "revision.approve",
        readinessReady: readiness.ready,
        readinessBlockingCount: readiness.blockingCount,
      },
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.SCHEDULE_REVISION,
      recordId: revision.id,
      fromStatus: revision.status,
      toStatus: REVISION_STATUS.APPROVED,
      actorId: userId,
      actorRole: userRole,
      comment,
      metadata: {
        readinessReady: readiness.ready,
        readinessBlockingCount: readiness.blockingCount,
      },
    });

    return row;
  });

  return serializeRevision(updated);
};

const rejectRevision = async ({
  orgId,
  projectId,
  revisionId,
  userId,
  userRole = null,
  reason,
}) => {
  const { revision } = await loadCurrentRevisionForLifecycle({
    orgId,
    projectId,
    revisionId,
  });

  assertAllowedStatus(revision, [REVISION_STATUS.UNDER_REVIEW], "rejected");

  const rejectionReason = trimOrNull(reason);
  if (!rejectionReason) {
    throw new HttpError(
      400,
      "REJECTION_REASON_REQUIRED",
      "A rejection reason is required.",
    );
  }

  const at = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.scheduleRevision.update({
      where: { id: revision.id },
      data: {
        status: REVISION_STATUS.REJECTED,
        rejectedBy: userId,
        rejectedAt: at,
        rejectionReason,
        statusTransitionLog: appendStatusTransition(revision, {
          to: REVISION_STATUS.REJECTED,
          userId,
          at,
          reason: rejectionReason,
        }),
      },
    });

    await auditRevisionTransition({
      tx,
      orgId,
      revision,
      action: auditService.ACTIONS.REJECTED,
      actorId: userId,
      occurredAt: at,
      newStatus: REVISION_STATUS.REJECTED,
      reason: rejectionReason,
      summary: { transition: "revision.reject" },
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.SCHEDULE_REVISION,
      recordId: revision.id,
      fromStatus: revision.status,
      toStatus: REVISION_STATUS.REJECTED,
      actorId: userId,
      actorRole: userRole,
      reason: rejectionReason,
    });

    return row;
  });

  return serializeRevision(updated);
};

const lockBaseline = async ({
  orgId,
  projectId,
  revisionId = null,
  userId = null,
  userRole = null,
  comment = null,
}) => {
  const { project, revision } = await loadCurrentRevisionForLifecycle({
    orgId,
    projectId,
    revisionId,
  });

  assertAllowedStatus(revision, [REVISION_STATUS.APPROVED], "baselined");

  const readiness = await getReadinessForRevision({ project, revision });
  if (!readiness.ready) {
    throw new HttpError(
      400,
      "SCHEDULE_NOT_READY",
      "Schedule readiness checks must pass before baseline lock.",
      readiness,
    );
  }

  const activities = await prisma.activity.findMany({
    where: { projectId, isActive: true },
    select: { id: true, earlyStart: true, earlyFinish: true },
  });

  if (activities.length === 0) {
    throw new HttpError(
      400,
      "NO_ACTIVITIES",
      "No schedule activities are available for baseline lock.",
    );
  }

  const at = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const previouslyBaselined = await tx.scheduleRevision.findMany({
      where: {
        projectId,
        id: { not: revision.id },
        status: REVISION_STATUS.BASELINED,
      },
    });

    for (const previous of previouslyBaselined) {
      await tx.scheduleRevision.update({
        where: { id: previous.id },
        data: {
          status: REVISION_STATUS.SUPERSEDED,
          supersededBy: userId,
          supersededAt: at,
          statusTransitionLog: appendStatusTransition(previous, {
            to: REVISION_STATUS.SUPERSEDED,
            userId,
            at,
            comment: "Superseded by a newer baseline",
          }),
        },
      });

      await auditRevisionTransition({
        tx,
        orgId,
        revision: previous,
        action: auditService.ACTIONS.SUPERSEDED,
        actorId: userId,
        occurredAt: at,
        newStatus: REVISION_STATUS.SUPERSEDED,
        reason: "Superseded by a newer baseline",
        summary: { transition: "revision.supersede_for_baseline" },
      });
      await approvalWorkflowService.recordTransition({
        tx,
        orgId,
        projectId,
        recordType: approvalWorkflowService.RECORD_TYPES.SCHEDULE_REVISION,
        recordId: previous.id,
        fromStatus: previous.status,
        toStatus: REVISION_STATUS.SUPERSEDED,
        actorId: userId,
        actorRole: userRole,
        comment: "Superseded by a newer baseline",
      });
    }

    for (const activity of activities) {
      await tx.activity.update({
        where: { id: activity.id },
        data: {
          baselineStart: activity.earlyStart,
          baselineFinish: activity.earlyFinish,
        },
      });
    }

    const updatedRevision = await tx.scheduleRevision.update({
      where: { id: revision.id },
      data: {
        status: REVISION_STATUS.BASELINED,
        baselinedBy: userId,
        baselinedAt: at,
        baselineComment: trimOrNull(comment),
        readinessJson: readiness,
        statusTransitionLog: appendStatusTransition(revision, {
          to: REVISION_STATUS.BASELINED,
          userId,
          at,
          comment,
        }),
      },
    });

    await auditRevisionTransition({
      tx,
      orgId,
      revision,
      action: auditService.ACTIONS.BASELINE_LOCKED,
      actorId: userId,
      occurredAt: at,
      newStatus: REVISION_STATUS.BASELINED,
      reason: comment,
      summary: {
        transition: "revision.baseline",
        lockedActivities: activities.length,
        readinessReady: readiness.ready,
        readinessBlockingCount: readiness.blockingCount,
      },
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.SCHEDULE_REVISION,
      recordId: revision.id,
      fromStatus: revision.status,
      toStatus: REVISION_STATUS.BASELINED,
      actorId: userId,
      actorRole: userRole,
      comment,
      metadata: {
        lockedActivities: activities.length,
        readinessReady: readiness.ready,
        readinessBlockingCount: readiness.blockingCount,
      },
    });

    return updatedRevision;
  });

  return {
    locked: activities.length,
    readiness,
    revision: serializeRevision(result),
  };
};

const getResourcePlan = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  }

  const resources = await prisma.resourceAllocation.findMany({
    where: { projectId, activity: { isActive: true } },
    include: {
      activity: {
        select: {
          id: true,
          name: true,
          p6ActivityId: true,
          wbsCode: true,
        },
      },
    },
    orderBy: [{ activityId: "asc" }, { createdAt: "asc" }],
  });

  const groupedMap = new Map();
  for (const row of resources) {
    if (!groupedMap.has(row.activityId)) {
      groupedMap.set(row.activityId, {
        activity: {
          id: row.activity.id,
          activityId:
            row.activity.p6ActivityId ||
            row.activity.wbsCode ||
            row.activity.id,
          name: row.activity.name,
        },
        resources: [],
      });
    }

    groupedMap.get(row.activityId).resources.push({
      id: row.id,
      resourceType: row.resourceType,
      resourceName: row.resourceName,
      quantity: row.quantity,
      unit: row.unit,
      dailyRate: row.dailyRate,
      totalCost: row.totalCost,
      notes: row.notes,
    });
  }

  const summary = {
    totalLaborCost: 0,
    totalEquipmentCost: 0,
    totalMaterialCost: 0,
  };

  for (const row of resources) {
    const cost = toMoneyNumber(row.totalCost);
    if (row.resourceType === "labor") {
      summary.totalLaborCost = addMoney(summary.totalLaborCost, cost);
    }
    if (row.resourceType === "equipment") {
      summary.totalEquipmentCost = addMoney(summary.totalEquipmentCost, cost);
    }
    if (row.resourceType === "material") {
      summary.totalMaterialCost = addMoney(summary.totalMaterialCost, cost);
    }
  }

  return {
    resources: Array.from(groupedMap.values()),
    summary,
  };
};

module.exports = {
  startGenerateJob,
  getJob,
  getProjectSchedule,
  listRevisions,
  getRevision,
  getRevisionMapping,
  getScheduleReadiness,
  submitRevisionForReview,
  approveRevision,
  rejectRevision,
  activateRevision,
  rollbackRevision,
  lockBaseline,
  getResourcePlan,
  REVISION_STATUS,
  buildScheduleReadiness,
};
