const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { addMoney } = require("../utils/money");
const { buildAllocationSummary } = require("./activity-boq-allocation.service");
const { buildScheduleReadiness } = require("./schedule.service");

const RULESET_VERSION = "fb-015-v2";
const MONEY_EPSILON = 0.01;

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
  reports: { module: "reports" },
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

const issue = (code, message, severity = "blocking", details = {}) => ({
  code,
  message,
  severity,
  details,
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

const getSetupReadiness = async ({ orgId, projectId }) => {
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
  ] = await Promise.all([
    prisma.boqItem.findMany({
      where: { projectId, isActive: true },
      select: { id: true, qty: true, amount: true },
    }),
    buildAllocationSummary({ projectId }),
    prisma.activity.findMany({
      where: { projectId, isActive: true },
      include: {
        assignments: { select: { id: true } },
        progressMethod: { select: { id: true, method: true } },
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
  ]);

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
  const approvedAllocatedAmount = toNumber(
    allocationSummary.approvedAllocatedAmount,
  );
  const pendingAllocatedAmount = toNumber(
    allocationSummary.pendingAllocatedAmount,
  );
  const unallocatedAmount = toNumber(allocationSummary.unallocatedAmount);
  const baselineLocked = Boolean(
    baselinedRevision || revisionStatus === "baselined",
  );
  const scheduleApproved = ["approved", "baselined"].includes(revisionStatus);

  const profileBlockers = [
    !project.startDate &&
      issue("PROJECT_START_MISSING", "Project start date is missing."),
    !project.endDate &&
      issue("PROJECT_END_MISSING", "Project end date is missing."),
  ];
  const profileWarnings = [
    !project.contractValue &&
      issue(
        "CONTRACT_VALUE_MISSING",
        "Contract value is not set for cost and EV checks.",
        "warning",
      ),
    !project.duration &&
      issue(
        "PROJECT_DURATION_MISSING",
        "Project duration is not set for onboarding review.",
        "warning",
      ),
    (!project.clientName || !project.contractorName) &&
      issue(
        "PARTIES_INCOMPLETE",
        "Contract parties are incomplete.",
        "warning",
      ),
  ];

  const boqBlockers = [
    boqCount === 0 && issue("NO_BOQ", "No BOQ items have been uploaded."),
    boqCount > 0 &&
      totalBoqAmount <= MONEY_EPSILON &&
      issue("BOQ_HAS_NO_VALUE", "BOQ items have no measurable value."),
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
      approvedAllocatedAmount <= MONEY_EPSILON &&
      issue(
        "NO_APPROVED_ALLOCATIONS",
        "No approved BOQ allocations are linked to schedule activities.",
      ),
    totalBoqFromSummary > MONEY_EPSILON &&
      unallocatedAmount > MONEY_EPSILON &&
      issue(
        "UNALLOCATED_BOQ",
        "BOQ value remains unallocated to approved schedule activities.",
        "blocking",
        { unallocatedAmount },
      ),
  ];
  const allocationWarnings = [
    pendingAllocatedAmount > MONEY_EPSILON &&
      issue(
        "PENDING_ALLOCATIONS",
        "Some allocations are still pending approval.",
        "warning",
        { pendingAllocatedAmount },
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
      ),
  ];

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
      ),
    );

  const progressBlockers = [
    !baselineLocked &&
      issue(
        "BASELINE_NOT_LOCKED",
        "Official progress should wait until the approved baseline is locked.",
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
      ),
  ];

  const steps = [
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
      key: "boq_upload",
      label: "BOQ Upload",
      description: "Measured BOQ rows are loaded for schedule and cost setup.",
      action: { label: "Open BOQ", target: TARGETS.boq },
      requiredFor: ["baseline", "progress", "reporting"],
      complete: boqBlockers.filter(Boolean).length === 0,
      blockers: boqBlockers,
      counts: {
        boqItems: boqCount,
        totalBoqAmount,
      },
      successMessage: "BOQ is loaded.",
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
        approvedAllocatedAmount,
        pendingAllocatedAmount,
        unallocatedAmount,
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
      counts: {
        progressMethodCount,
        progressActivities: progressActivityCount,
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
  const nextStep = firstNextAction(steps);

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
      nextAction: nextStep
        ? {
            stepKey: nextStep.key,
            label: nextStep.action.label,
            target: nextStep.action.target,
            message: nextStep.message,
          }
        : null,
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
    context: {
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
      allocationSummary: {
        totalBoqAmount: totalBoqFromSummary,
        approvedAllocatedAmount,
        pendingAllocatedAmount,
        unallocatedAmount,
      },
      scheduleReadiness,
      officialEvInputs: OFFICIAL_EV_INPUTS,
    },
    steps,
  };
};

const getOfficialReportingGate = async ({ orgId, projectId }) => {
  const readiness = await getSetupReadiness({ orgId, projectId });
  return readiness.gates.reporting;
};

module.exports = {
  getSetupReadiness,
  getOfficialReportingGate,
  OFFICIAL_EV_INPUTS,
  RULESET_VERSION,
};
