const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { addMoney, subtractMoney, toMoneyNumber } = require("../utils/money");
const auditService = require("./audit.service");
const {
  RECORD_TYPES,
  attachEvidenceToRecords,
  syncEvidenceReferences,
} = require("./commercial-traceability.service");
const { recordWorkflowHistory } = require("./workflow-support.service");
const approvalWorkflowService = require("./approval-workflow.service");
const { nextRef } = require("../utils/reference-number");
const {
  ARCHIVED_STATUS,
  applyArchiveVisibility,
  assertNotArchived,
  archiveResult,
} = require("./archive-policy.service");

const activityTraceSelect = {
  id: true,
  name: true,
  p6ActivityId: true,
  wbsCode: true,
  totalFloat: true,
  isCritical: true,
};

const boqTraceSelect = {
  id: true,
  code: true,
  ref: true,
  description: true,
  unit: true,
  qty: true,
  rate: true,
  amount: true,
};

const allocationTraceSelect = {
  id: true,
  quantity: true,
  amount: true,
  weight: true,
  status: true,
  boqItem: { select: boqTraceSelect },
  activity: { select: activityTraceSelect },
};

const changeOrderInclude = {
  activity: { select: { id: true, name: true, wbsCode: true } },
  activityLinks: {
    include: { activity: { select: activityTraceSelect } },
    orderBy: [{ createdAt: "asc" }],
  },
  allocationLinks: {
    include: {
      allocation: { select: allocationTraceSelect },
      boqItem: { select: boqTraceSelect },
    },
    orderBy: [{ createdAt: "asc" }],
  },
};

const CHANGE_ORDER_STATUSES = Object.freeze({
  DRAFT: "draft",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  ARCHIVED: ARCHIVED_STATUS,
});

const CHANGE_ORDER_WORKFLOW_ACTIONS = Object.freeze({
  SUBMIT: "submit",
  APPROVE: "approve",
  REJECT: "reject",
  REOPEN: "reopen",
});

const APPROVAL_LOCKED_FIELDS = new Set([
  "description",
  "category",
  "value",
  "scheduleImpact",
  "scheduleImpactSummary",
  "costImpactSummary",
  "activityId",
  "activityLinks",
  "affectedActivityIds",
  "allocationLinks",
  "correspondenceIds",
  "correspondenceLinks",
  "attachmentRefs",
  "supportingDocumentIds",
  "documentIds",
]);

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const approvalDecisionNote = (payload = {}) =>
  trimOrNull(
    payload.reason ||
      payload.rejectedReason ||
      payload.approvalComment ||
      payload.comment ||
      payload.statusComment,
  );

const dateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const hasExplicitNumber = (value) =>
  value !== null && value !== undefined && value !== "";

const summarizeChangeOrder = (order) => ({
  ref: order.ref,
  description: order.description,
  status: order.status,
  value: order.value,
  scheduleImpact: order.scheduleImpact,
  scheduleImpactSummary: order.scheduleImpactSummary || null,
  costImpactSummary: order.costImpactSummary || null,
  activityId: order.activityId || null,
  activityLinkCount: order.activityLinks?.length || 0,
  allocationLinkCount: order.allocationLinks?.length || 0,
  criticalPathImpactDays:
    order.activityLinks?.reduce(
      (sum, link) => sum + (Number(link.criticalPathImpactDays) || 0),
      0,
    ) || 0,
  costImpact:
    order.activityLinks?.reduce(
      (sum, link) => addMoney(sum, toMoneyNumber(link.costImpact)),
      0,
    ) || 0,
  supportingDocumentCount: order.attachmentRefs?.length || 0,
  approvedAt: order.approvedAt || order.approvedDate || null,
  rejectedReason: order.rejectedReason || null,
  archivedAt: order.archivedAt || null,
  archivedBy: order.archivedBy || null,
});

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  }

  return project;
};

const firstActivityIdFromPayload = (payload = {}) => {
  if (payload.activityLinks !== undefined) {
    const first = payload.activityLinks?.find((link) => link?.activityId);
    return first?.activityId || null;
  }
  if (payload.affectedActivityIds !== undefined) {
    return payload.affectedActivityIds?.[0] || null;
  }
  if (payload.activityId !== undefined) return payload.activityId || null;
  return undefined;
};

const normalizeActivityLinks = ({
  payload = {},
  fallbackActivityId = null,
}) => {
  if (payload.activityLinks !== undefined) {
    return (Array.isArray(payload.activityLinks) ? payload.activityLinks : [])
      .map((link) => ({
        activityId: link?.activityId,
        relationType: trimOrNull(link?.relationType) || "affected",
        scheduleImpactDays:
          Number(link?.scheduleImpactDays ?? link?.scheduleImpact) || 0,
        approvedScheduleImpactDays: hasExplicitNumber(
          link?.approvedScheduleImpactDays,
        )
          ? Number(link.approvedScheduleImpactDays) || 0
          : null,
        costImpact: toMoneyNumber(link?.costImpact ?? link?.amount),
        approvedCostImpact: hasExplicitNumber(link?.approvedCostImpact)
          ? toMoneyNumber(link.approvedCostImpact)
          : null,
        baselineStart: dateOrNull(link?.baselineStart),
        baselineFinish: dateOrNull(link?.baselineFinish),
        impactedStart: dateOrNull(link?.impactedStart),
        impactedFinish: dateOrNull(link?.impactedFinish),
        impactBasis: trimOrNull(link?.impactBasis || link?.basis),
        notes: trimOrNull(link?.notes),
      }))
      .filter((link) => link.activityId);
  }

  if (payload.affectedActivityIds !== undefined) {
    return (
      Array.isArray(payload.affectedActivityIds)
        ? payload.affectedActivityIds
        : []
    )
      .map((activityId) => ({
        activityId,
        relationType: "affected",
        scheduleImpactDays: Number(payload.scheduleImpact) || 0,
        approvedScheduleImpactDays: null,
        costImpact: 0,
        approvedCostImpact: null,
        baselineStart: null,
        baselineFinish: null,
        impactedStart: null,
        impactedFinish: null,
        impactBasis: null,
        notes: null,
      }))
      .filter((link) => link.activityId);
  }

  if (payload.activityId !== undefined) {
    return payload.activityId
      ? [
          {
            activityId: payload.activityId,
            relationType: "affected",
            scheduleImpactDays: Number(payload.scheduleImpact) || 0,
            approvedScheduleImpactDays: null,
            costImpact: 0,
            approvedCostImpact: null,
            baselineStart: null,
            baselineFinish: null,
            impactedStart: null,
            impactedFinish: null,
            impactBasis: null,
            notes: null,
          },
        ]
      : [];
  }

  if (fallbackActivityId) {
    return [
      {
        activityId: fallbackActivityId,
        relationType: "affected",
        scheduleImpactDays: Number(payload.scheduleImpact) || 0,
        approvedScheduleImpactDays: null,
        costImpact: 0,
        approvedCostImpact: null,
        baselineStart: null,
        baselineFinish: null,
        impactedStart: null,
        impactedFinish: null,
        impactBasis: null,
        notes: null,
      },
    ];
  }

  return null;
};

const normalizeAllocationLinks = (payload = {}) => {
  if (payload.allocationLinks === undefined) return null;

  return (Array.isArray(payload.allocationLinks) ? payload.allocationLinks : [])
    .map((link) => ({
      allocationId: trimOrNull(link?.allocationId),
      boqItemId: trimOrNull(link?.boqItemId),
      quantity: Number(link?.quantity) || 0,
      amount: toMoneyNumber(link?.amount),
      notes: trimOrNull(link?.notes),
    }))
    .filter((link) => link.allocationId || link.boqItemId);
};

const assertCreateStatus = (payload = {}) => {
  if (
    payload.status === undefined ||
    payload.status === null ||
    payload.status === CHANGE_ORDER_STATUSES.DRAFT
  ) {
    return;
  }

  throw new HttpError(
    400,
    "CHANGE_ORDER_WORKFLOW_ACTION_REQUIRED",
    "Create change orders as draft, then use the submit/approve/reject workflow endpoints",
  );
};

const assertDirectStatusMutationBlocked = ({
  payload = {},
  workflowAction,
}) => {
  if (payload.status === undefined || workflowAction) return;

  throw new HttpError(
    400,
    "CHANGE_ORDER_WORKFLOW_ACTION_REQUIRED",
    "Use submit, approve, reject, or reopen endpoints to change change order status",
  );
};

const hasApprovalLockedChanges = (payload = {}) =>
  [...APPROVAL_LOCKED_FIELDS].some((field) => payload[field] !== undefined);

const assertApprovedRecordLocked = ({
  existing,
  payload = {},
  workflowAction,
}) => {
  if (
    existing.status !== CHANGE_ORDER_STATUSES.APPROVED ||
    workflowAction ||
    !hasApprovalLockedChanges(payload)
  ) {
    return;
  }

  throw new HttpError(
    409,
    "CHANGE_ORDER_APPROVED_LOCKED",
    "Approved change order cost, schedule, and traceability impacts are locked by the approval event",
  );
};

const countExistingRows = async ({ tx, model, where }) => {
  if (model?.count) return model.count({ where });
  if (model?.findMany) {
    const rows = await model.findMany({ where, select: { id: true } });
    return rows.length;
  }
  return 0;
};

const assertApprovalProof = async ({
  tx,
  projectId,
  changeOrderId,
  status,
  existing = null,
  activityTrace,
  evidence,
  required = false,
}) => {
  if (!required && status !== CHANGE_ORDER_STATUSES.APPROVED) return;

  const activityCount =
    activityTrace?.count ??
    (existing?.activityId
      ? 1
      : await countExistingRows({
          tx,
          model: tx.changeOrderActivityLink,
          where: { projectId, changeOrderId },
        }));
  const documentCount =
    evidence?.attachmentCount ??
    (await countExistingRows({
      tx,
      model: tx.commercialAttachmentRef,
      where: {
        projectId,
        recordType: RECORD_TYPES.CHANGE_ORDER,
        recordId: changeOrderId,
      },
    }));
  const scheduleImpactSummary = trimOrNull(existing?.scheduleImpactSummary);
  const costImpactSummary = trimOrNull(existing?.costImpactSummary);

  if (
    activityCount > 0 &&
    documentCount > 0 &&
    scheduleImpactSummary &&
    costImpactSummary
  ) {
    return;
  }

  if (!scheduleImpactSummary || !costImpactSummary) {
    throw new HttpError(
      400,
      "CHANGE_ORDER_IMPACT_SUMMARY_REQUIRED",
      "Schedule and cost impact summaries are required before approving a change order",
      {
        hasScheduleImpactSummary: Boolean(scheduleImpactSummary),
        hasCostImpactSummary: Boolean(costImpactSummary),
      },
    );
  }

  throw new HttpError(
    400,
    "CHANGE_ORDER_IMPACT_PROOF_REQUIRED",
    "Approving a change order requires at least one affected activity and one supporting document",
    {
      activityCount,
      supportingDocumentCount: documentCount,
    },
  );
};

const syncActivityLinks = async ({
  tx,
  projectId,
  changeOrderId,
  payload,
  fallbackActivityId,
  status,
}) => {
  const links = normalizeActivityLinks({ payload, fallbackActivityId });
  if (links === null) return null;

  await tx.changeOrderActivityLink.deleteMany({
    where: { projectId, changeOrderId },
  });
  if (links.length === 0) return { count: 0 };

  const ids = [...new Set(links.map((link) => link.activityId))];
  const activities = await tx.activity.findMany({
    where: { projectId, id: { in: ids } },
    select: activityTraceSelect,
  });
  const activityById = new Map(
    activities.map((activity) => [activity.id, activity]),
  );
  const missing = ids.filter((id) => !activityById.has(id));
  if (missing.length > 0) {
    throw new HttpError(
      400,
      "CHANGE_ORDER_ACTIVITY_NOT_FOUND",
      "One or more linked activities were not found in this project",
    );
  }

  await tx.changeOrderActivityLink.createMany({
    data: links.map((link) => {
      const activity = activityById.get(link.activityId);
      const floatDays = Math.max(0, Number(activity.totalFloat) || 0);
      const scheduleImpactDays = Number(link.scheduleImpactDays) || 0;
      const criticalPathImpactDays = Math.max(
        0,
        scheduleImpactDays - floatDays,
      );
      const approvedScheduleImpactDays =
        link.approvedScheduleImpactDays !== null
          ? Number(link.approvedScheduleImpactDays) || 0
          : status === "approved"
            ? scheduleImpactDays
            : 0;
      const approvedCostImpact =
        link.approvedCostImpact !== null
          ? toMoneyNumber(link.approvedCostImpact)
          : status === "approved"
            ? toMoneyNumber(link.costImpact)
            : 0;
      return {
        projectId,
        changeOrderId,
        activityId: link.activityId,
        relationType: link.relationType,
        scheduleImpactDays,
        floatImpactDays: floatDays,
        criticalPathImpact: Boolean(activity.isCritical) || floatDays <= 0,
        criticalPathImpactDays,
        costImpact: toMoneyNumber(link.costImpact),
        approvedScheduleImpactDays,
        approvedCostImpact,
        baselineStart: link.baselineStart,
        baselineFinish: link.baselineFinish,
        impactedStart: link.impactedStart,
        impactedFinish: link.impactedFinish,
        impactBasis: link.impactBasis,
        cpmSnapshotJson: {
          activityId: link.activityId,
          p6ActivityId: activity.p6ActivityId || null,
          totalFloat: activity.totalFloat,
          isCritical: activity.isCritical,
          relationType: link.relationType,
          scheduleImpactDays,
          floatImpactDays: floatDays,
          criticalPathImpactDays,
          costImpact: toMoneyNumber(link.costImpact),
          approvedScheduleImpactDays,
          approvedCostImpact,
          baselineStart: link.baselineStart?.toISOString?.() || null,
          baselineFinish: link.baselineFinish?.toISOString?.() || null,
          impactedStart: link.impactedStart?.toISOString?.() || null,
          impactedFinish: link.impactedFinish?.toISOString?.() || null,
        },
        notes: link.notes,
      };
    }),
    skipDuplicates: true,
  });

  return { count: links.length };
};

const syncAllocationLinks = async ({
  tx,
  projectId,
  changeOrderId,
  payload,
}) => {
  const links = normalizeAllocationLinks(payload);
  if (links === null) return null;

  await tx.changeOrderAllocationLink.deleteMany({
    where: { projectId, changeOrderId },
  });
  if (links.length === 0) return { count: 0 };

  const allocationIds = [
    ...new Set(links.map((link) => link.allocationId).filter(Boolean)),
  ];
  const boqItemIds = [
    ...new Set(links.map((link) => link.boqItemId).filter(Boolean)),
  ];

  const [allocations, boqItems] = await Promise.all([
    allocationIds.length
      ? tx.activityBoqAllocation.findMany({
          where: {
            projectId,
            id: { in: allocationIds },
            status: "approved",
            isActive: true,
          },
          select: { id: true, boqItemId: true },
        })
      : [],
    boqItemIds.length
      ? tx.boqItem.findMany({
          where: { projectId, id: { in: boqItemIds } },
          select: { id: true },
        })
      : [],
  ]);

  const allocationById = new Map(
    allocations.map((allocation) => [allocation.id, allocation]),
  );
  const boqItemSet = new Set(boqItems.map((item) => item.id));
  const missingAllocation = allocationIds.filter(
    (id) => !allocationById.has(id),
  );
  const missingBoq = boqItemIds.filter((id) => !boqItemSet.has(id));
  if (missingAllocation.length > 0 || missingBoq.length > 0) {
    throw new HttpError(
      400,
      "CHANGE_ORDER_ALLOCATION_NOT_FOUND",
      "One or more linked BOQ allocations were not found or approved in this project",
    );
  }

  await tx.changeOrderAllocationLink.createMany({
    data: links.map((link) => {
      const allocation = link.allocationId
        ? allocationById.get(link.allocationId)
        : null;
      return {
        projectId,
        changeOrderId,
        allocationId: link.allocationId || null,
        boqItemId: link.boqItemId || allocation?.boqItemId || null,
        quantity: link.quantity,
        amount: link.amount,
        notes: link.notes,
      };
    }),
    skipDuplicates: true,
  });

  return { count: links.length };
};

const applyApprovedActivityImpacts = async ({
  tx,
  projectId,
  changeOrderId,
}) => {
  if (
    !tx.changeOrderActivityLink?.findMany ||
    !tx.changeOrderActivityLink?.update
  ) {
    return null;
  }

  const links = await tx.changeOrderActivityLink.findMany({
    where: { projectId, changeOrderId },
    select: {
      id: true,
      scheduleImpactDays: true,
      costImpact: true,
      criticalPathImpactDays: true,
      cpmSnapshotJson: true,
    },
  });

  await Promise.all(
    links.map((link) =>
      tx.changeOrderActivityLink.update({
        where: { id: link.id },
        data: {
          approvedScheduleImpactDays: Number(link.scheduleImpactDays) || 0,
          approvedCostImpact: toMoneyNumber(link.costImpact),
          cpmSnapshotJson: {
            ...(link.cpmSnapshotJson || {}),
            approvedScheduleImpactDays: Number(link.scheduleImpactDays) || 0,
            approvedCostImpact: toMoneyNumber(link.costImpact),
          },
        },
      }),
    ),
  );

  return {
    count: links.length,
    approvedScheduleImpactDays: links.reduce(
      (sum, link) => sum + (Number(link.scheduleImpactDays) || 0),
      0,
    ),
    approvedCostImpact: links.reduce(
      (sum, link) => addMoney(sum, toMoneyNumber(link.costImpact)),
      0,
    ),
    criticalPathImpactDays: links.reduce(
      (sum, link) => sum + (Number(link.criticalPathImpactDays) || 0),
      0,
    ),
  };
};

const budgetRevisionDelta = (row) =>
  row.changeType === "deduction"
    ? subtractMoney(0, row.amount)
    : toMoneyNumber(row.amount);

const recomputeBudgetRevisionCumulative = async ({
  tx,
  projectId,
  baseBudget,
}) => {
  if (!tx.budgetRevision?.findMany || !tx.budgetRevision?.update) return null;

  const rows = await tx.budgetRevision.findMany({
    where: { projectId, status: "approved" },
    orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }],
  });

  let running = toMoneyNumber(baseBudget);
  for (const row of rows) {
    running = addMoney(running, budgetRevisionDelta(row));
    await tx.budgetRevision.update({
      where: { id: row.id },
      data: { cumulativeBudget: running },
    });
  }

  return {
    revisionCount: rows.length,
    currentBudget: running,
  };
};

const buildBudgetRevisionNotes = (order) =>
  [
    `Generated from approved change order ${order.ref}.`,
    `Schedule impact: ${order.scheduleImpact} days.`,
    `Schedule summary: ${order.scheduleImpactSummary || "n/a"}`,
    `Cost summary: ${order.costImpactSummary || "n/a"}`,
  ].join("\n");

const syncApprovedBudgetRevision = async ({
  tx,
  project,
  projectId,
  order,
  userId,
  now,
}) => {
  if (
    !tx.budgetRevision?.findFirst ||
    !tx.budgetRevision?.create ||
    !tx.budgetRevision?.update
  ) {
    return null;
  }

  const existingRevision = await tx.budgetRevision.findFirst({
    where: { projectId, linkedChangeOrder: order.id },
  });
  const generatedRef = `BR-${String(order.ref || order.id).replace(/[^A-Za-z0-9-]/g, "-")}`;
  const refConflict =
    !existingRevision &&
    (await tx.budgetRevision.findFirst({
      where: { projectId, ref: generatedRef },
      select: { id: true },
    }));
  const fallbackCount =
    refConflict && tx.budgetRevision.count
      ? await tx.budgetRevision.count({ where: { projectId } })
      : null;
  const ref =
    existingRevision?.ref ||
    (refConflict
      ? `BR-${String(fallbackCount + 1).padStart(2, "0")}`
      : generatedRef);
  const title = `Approved change order ${order.ref}`;
  const commonData = {
    title:
      order.description && order.description.length > 90
        ? `${title}: ${order.description.slice(0, 87)}...`
        : `${title}: ${order.description || "Variation"}`,
    changeType: "addition",
    amount: toMoneyNumber(order.value),
    linkedChangeOrder: order.id,
    effectiveDate: order.approvedAt || order.approvedDate || now,
    status: "approved",
    approvedBy: userId || null,
    approvedAt: order.approvedAt || now,
    notes: buildBudgetRevisionNotes(order),
  };

  const revision = existingRevision
    ? await tx.budgetRevision.update({
        where: { id: existingRevision.id },
        data: commonData,
      })
    : await tx.budgetRevision.create({
        data: {
          projectId,
          ref,
          cumulativeBudget: 0,
          ...commonData,
        },
      });

  const cumulative = await recomputeBudgetRevisionCumulative({
    tx,
    projectId,
    baseBudget: project.contractValue,
  });

  return {
    id: revision.id,
    ref: revision.ref,
    amount: toMoneyNumber(revision.amount),
    currentBudget: cumulative?.currentBudget ?? null,
  };
};

const listChangeOrders = async ({ orgId, projectId, query = {} }) => {
  await ensureProject({ orgId, projectId });

  const where = { projectId };
  if (Object.values(CHANGE_ORDER_STATUSES).includes(query.status)) {
    where.status = query.status;
  }
  applyArchiveVisibility(where, query);

  const orders = await prisma.changeOrder.findMany({
    where,
    include: changeOrderInclude,
    orderBy: [{ submittedDate: "desc" }, { updatedAt: "desc" }],
  });

  const summary = orders.reduce(
    (acc, order) => {
      const value = toMoneyNumber(order.value);
      if (order.status === "approved") {
        acc.totalApproved = addMoney(acc.totalApproved, value);
        acc.approvedCount += 1;
        acc.totalScheduleImpact += Number(order.scheduleImpact) || 0;
      } else if (order.status === "pending") {
        acc.totalPending = addMoney(acc.totalPending, value);
      }
      return acc;
    },
    {
      totalApproved: 0,
      totalPending: 0,
      totalScheduleImpact: 0,
      approvedCount: 0,
    },
  );

  const enrichedOrders = await attachEvidenceToRecords({
    projectId,
    recordType: RECORD_TYPES.CHANGE_ORDER,
    records: orders,
  });

  return { orders: enrichedOrders, summary };
};

const createChangeOrder = async ({
  orgId,
  projectId,
  userId = null,
  userRole = null,
  payload,
}) => {
  await ensureProject({ orgId, projectId });
  assertCreateStatus(payload);

  const ref = await nextRef(prisma, { table: 'ChangeOrder', scopeColumn: 'projectId', scopeId: projectId, prefix: 'VO', pad: 2 });
  const now = new Date();
  const status = CHANGE_ORDER_STATUSES.DRAFT;
  const primaryActivityId = firstActivityIdFromPayload(payload);

  return prisma.$transaction(async (tx) => {
    const created = await tx.changeOrder.create({
      data: {
        projectId,
        activityId:
          primaryActivityId !== undefined
            ? primaryActivityId
            : payload.activityId || null,
        ref,
        description: payload.description,
        category: payload.category?.trim() || null,
        value: toMoneyNumber(payload.value),
        status,
        scheduleImpact: Number(payload.scheduleImpact) || 0,
        scheduleImpactSummary: trimOrNull(payload.scheduleImpactSummary),
        costImpactSummary: trimOrNull(payload.costImpactSummary),
        submittedDate: payload.submittedDate
          ? new Date(payload.submittedDate)
          : null,
        raisedBy: payload.raisedBy?.trim() || null,
        rejectedReason: null,
        createdBy: userId || null,
        updatedBy: userId || null,
        approvedBy: null,
        approvedAt: null,
        approvalComment: null,
        approvedDate: null,
        rejectedBy: null,
        rejectedAt: null,
      },
      include: changeOrderInclude,
    });

    const activityTrace = await syncActivityLinks({
      tx,
      projectId,
      changeOrderId: created.id,
      payload,
      fallbackActivityId: created.activityId,
      status,
    });
    const allocationTrace = await syncAllocationLinks({
      tx,
      projectId,
      changeOrderId: created.id,
      payload,
    });
    const evidence = await syncEvidenceReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.CHANGE_ORDER,
      recordId: created.id,
      payload,
      userId,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.CHANGE_ORDER,
      entityId: created.id,
      action: auditService.ACTIONS.CREATED,
      actorId: userId,
      occurredAt: now,
      newStatus: created.status,
      reason: null,
      newSummary: summarizeChangeOrder(created),
      summary: {
        transition: "change_order.create",
        ref: created.ref,
        value: created.value,
        scheduleImpact: created.scheduleImpact,
        activityLinks:
          activityTrace?.count ?? created.activityLinks?.length ?? 0,
        allocationLinks:
          allocationTrace?.count ?? created.allocationLinks?.length ?? 0,
        correspondenceLinks: evidence.correspondenceCount,
        attachmentRefs: evidence.attachmentCount,
      },
      attachments: evidence.attachments,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.CHANGE_ORDER,
      recordId: created.id,
      fromStatus: null,
      toStatus: created.status,
      actorId: userId,
      actorRole: userRole,
      reason: null,
      comment: null,
      metadata: {
        ref: created.ref,
        value: created.value,
        scheduleImpact: created.scheduleImpact,
        scheduleImpactSummary: created.scheduleImpactSummary,
        costImpactSummary: created.costImpactSummary,
        activityLinks:
          activityTrace?.count ?? created.activityLinks?.length ?? 0,
        allocationLinks:
          allocationTrace?.count ?? created.allocationLinks?.length ?? 0,
      },
    });

    // The client contract carries the revised value, so it re-reads the change
    // orders itself rather than anybody keeping a second copy of the total.
    await require("./prime-contract.service").recomputeChangeValues(tx, {
      orgId,
      projectId,
    });

    const [enriched] = await attachEvidenceToRecords({
      tx,
      projectId,
      recordType: RECORD_TYPES.CHANGE_ORDER,
      records: [created],
    });
    return enriched;
  });
};

const updateChangeOrder = async ({
  orgId,
  projectId,
  coId,
  userId = null,
  userRole = null,
  payload,
  workflowAction = null,
  viaWorkflow = false,
}) => {
  const project = await ensureProject({ orgId, projectId });
  assertDirectStatusMutationBlocked({ payload, workflowAction });

  const existing = await prisma.changeOrder.findFirst({
    where: { id: coId, projectId },
    include: changeOrderInclude,
  });
  if (!existing) {
    throw new HttpError(
      404,
      "CHANGE_ORDER_NOT_FOUND",
      "Change order not found",
    );
  }
  assertNotArchived(existing, {
    code: "CHANGE_ORDER_ARCHIVED",
    message:
      "Archived change orders cannot be updated through normal workflow actions",
  });
  assertApprovedRecordLocked({ existing, payload, workflowAction });
  if (payload.status && payload.status !== existing.status && !viaWorkflow) {
    await require("./workflow-engine.service").assertNotLocked({ tool: "change_order", projectId, recordId: coId });
  }

  const nextStatus = payload.status || existing.status;
  const now = new Date();
  const approvalComment =
    payload.approvalComment !== undefined
      ? trimOrNull(payload.approvalComment)
      : existing.approvalComment || null;
  const decisionNote = approvalDecisionNote(payload);
  if (workflowAction && nextStatus === existing.status) {
    throw new HttpError(
      409,
      "APPROVAL_WORKFLOW_INVALID_TRANSITION",
      `Invalid change_order workflow transition from ${existing.status} to ${nextStatus}`,
      {
        recordType: approvalWorkflowService.RECORD_TYPES.CHANGE_ORDER,
        fromStatus: existing.status,
        toStatus: nextStatus,
      },
    );
  }
  if (workflowAction && nextStatus !== existing.status) {
    approvalWorkflowService.assertAllowedTransition({
      recordType: approvalWorkflowService.RECORD_TYPES.CHANGE_ORDER,
      fromStatus: existing.status,
      toStatus: nextStatus,
      reason: decisionNote,
      comment: approvalComment,
    });
  }
  if (
    nextStatus === CHANGE_ORDER_STATUSES.REJECTED &&
    !String(payload.rejectedReason || existing.rejectedReason || "").trim()
  ) {
    throw new HttpError(
      400,
      "REJECT_REASON_REQUIRED",
      "Rejected reason is required",
    );
  }

  const data = {};
  if (payload.activityId !== undefined)
    data.activityId = payload.activityId || null;
  if (
    payload.activityLinks !== undefined ||
    payload.affectedActivityIds !== undefined
  ) {
    data.activityId = firstActivityIdFromPayload(payload);
  }
  if (payload.description !== undefined) data.description = payload.description;
  if (payload.category !== undefined)
    data.category = payload.category?.trim() || null;
  if (payload.value !== undefined) data.value = toMoneyNumber(payload.value);
  if (payload.scheduleImpact !== undefined) {
    data.scheduleImpact = Number(payload.scheduleImpact) || 0;
  }
  if (payload.scheduleImpactSummary !== undefined) {
    data.scheduleImpactSummary = trimOrNull(payload.scheduleImpactSummary);
  }
  if (payload.costImpactSummary !== undefined) {
    data.costImpactSummary = trimOrNull(payload.costImpactSummary);
  }
  if (payload.submittedDate !== undefined) {
    data.submittedDate = payload.submittedDate
      ? new Date(payload.submittedDate)
      : null;
  }
  if (payload.raisedBy !== undefined)
    data.raisedBy = payload.raisedBy?.trim() || null;
  if (payload.rejectedReason !== undefined) {
    data.rejectedReason = trimOrNull(payload.rejectedReason);
  }
  if (payload.approvalComment !== undefined) {
    data.approvalComment = approvalComment;
  }
  if (payload.status !== undefined) data.status = payload.status;
  data.updatedBy = userId || null;

  if (
    nextStatus === CHANGE_ORDER_STATUSES.PENDING &&
    existing.status !== CHANGE_ORDER_STATUSES.PENDING &&
    payload.submittedDate === undefined
  ) {
    data.submittedDate = existing.submittedDate || now;
  }

  if (
    nextStatus === CHANGE_ORDER_STATUSES.APPROVED &&
    existing.status !== CHANGE_ORDER_STATUSES.APPROVED
  ) {
    data.approvedDate = now;
    data.approvedAt = now;
    data.approvedBy = userId || null;
    data.approvalComment = approvalComment;
    data.rejectedBy = null;
    data.rejectedAt = null;
    data.rejectedReason = null;
  }

  if (
    nextStatus === CHANGE_ORDER_STATUSES.REJECTED &&
    existing.status !== CHANGE_ORDER_STATUSES.REJECTED
  ) {
    data.rejectedAt = now;
    data.rejectedBy = userId || null;
  }

  if (
    nextStatus === CHANGE_ORDER_STATUSES.DRAFT &&
    existing.status === CHANGE_ORDER_STATUSES.REJECTED
  ) {
    data.rejectedAt = null;
    data.rejectedBy = null;
    data.rejectedReason = null;
    data.approvalComment = null;
  }

  const result = await prisma.$transaction(async (tx) => {
    // The order is held and read again before anything is written: the
    // checks above were made on a copy, and an approval that landed since
    // was edited over — its value changed, its impacts applied twice
    // (Phase 21D, CX21-496). An order that moved is not written; the caller
    // reloads it and decides again.
    if (tx.$queryRaw) await tx.$queryRaw`SELECT id FROM "ChangeOrder" WHERE id = ${coId} FOR UPDATE`;
    const held = await tx.changeOrder.findFirst({ where: { id: coId, projectId }, select: { status: true, archivedAt: true } });
    if (!held) {
      throw new HttpError(404, "CHANGE_ORDER_NOT_FOUND", "Change order not found");
    }
    if (held.status !== existing.status || Boolean(held.archivedAt) !== Boolean(existing.archivedAt)) {
      throw new HttpError(
        409,
        "CHANGE_ORDER_CHANGED",
        `The change order is now ${held.status}; reload it and decide again`,
      );
    }

    const updated = await tx.changeOrder.update({
      where: { id: coId },
      data,
      include: changeOrderInclude,
    });

    const activityTrace = await syncActivityLinks({
      tx,
      projectId,
      changeOrderId: updated.id,
      payload,
      fallbackActivityId: null,
      status: updated.status,
    });
    const allocationTrace = await syncAllocationLinks({
      tx,
      projectId,
      changeOrderId: updated.id,
      payload,
    });
    const evidence = await syncEvidenceReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.CHANGE_ORDER,
      recordId: updated.id,
      payload,
      userId,
    });
    await assertApprovalProof({
      tx,
      projectId,
      changeOrderId: updated.id,
      status: updated.status,
      existing: updated,
      activityTrace,
      evidence,
      required: [
        CHANGE_ORDER_WORKFLOW_ACTIONS.SUBMIT,
        CHANGE_ORDER_WORKFLOW_ACTIONS.APPROVE,
      ].includes(workflowAction),
    });

    const approvedImpactTrace =
      updated.status === CHANGE_ORDER_STATUSES.APPROVED &&
      existing.status !== CHANGE_ORDER_STATUSES.APPROVED
        ? await applyApprovedActivityImpacts({
            tx,
            projectId,
            changeOrderId: updated.id,
          })
        : null;

    const statusChanged = updated.status !== existing.status;
    const action = statusChanged
      ? updated.status === CHANGE_ORDER_STATUSES.APPROVED
        ? auditService.ACTIONS.APPROVED
        : updated.status === CHANGE_ORDER_STATUSES.REJECTED
          ? auditService.ACTIONS.REJECTED
          : auditService.ACTIONS.STATUS_CHANGED
      : auditService.ACTIONS.UPDATED;

    const budgetRevision =
      updated.status === CHANGE_ORDER_STATUSES.APPROVED &&
      existing.status !== CHANGE_ORDER_STATUSES.APPROVED
        ? await syncApprovedBudgetRevision({
            tx,
            project,
            projectId,
            order: {
              ...updated,
              approvedAt: data.approvedAt || updated.approvedAt,
              approvedDate: data.approvedDate || updated.approvedDate,
            },
            userId,
            now,
          })
        : null;

    // Budget by cost code (OCTA-FIN-COSTCODE-019): the approved value lands
    // on the order's budget line, the lines of its activity, or the
    // project's "Change orders" line.
    if (budgetRevision) {
      await require("./budget.service").applyChangeOrderToBudgetLines({
        tx,
        orgId,
        projectId,
        order: updated,
        actorId: userId,
      });
    }

    // And the client contract's revised value (OCTA-COM-PRIME-051): approved
    // changes move it, everything still in play is reported beside it.
    await require("./prime-contract.service").recomputeChangeValues(tx, {
      orgId,
      projectId,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.CHANGE_ORDER,
      entityId: updated.id,
      action,
      actorId: userId,
      occurredAt: now,
      oldStatus: existing.status,
      newStatus: updated.status,
      reason:
        updated.status === CHANGE_ORDER_STATUSES.REJECTED
          ? updated.rejectedReason
          : updated.approvalComment,
      oldSummary: summarizeChangeOrder(existing),
      newSummary: {
        ...summarizeChangeOrder(updated),
        approvedImpactTrace,
        budgetRevision,
      },
      summary: {
        transition: statusChanged
          ? `change_order.${workflowAction || updated.status}`
          : "change_order.update",
        ref: updated.ref,
        value: updated.value,
        scheduleImpact: updated.scheduleImpact,
        scheduleImpactSummary: updated.scheduleImpactSummary,
        costImpactSummary: updated.costImpactSummary,
        approvedImpactTrace,
        budgetRevision,
        activityLinks:
          activityTrace?.count ?? updated.activityLinks?.length ?? 0,
        allocationLinks:
          allocationTrace?.count ?? updated.allocationLinks?.length ?? 0,
        correspondenceLinks: evidence.correspondenceCount,
        attachmentRefs: evidence.attachmentCount,
      },
      attachments: evidence.attachments,
    });
    if (statusChanged) {
      await recordWorkflowHistory({
        tx,
        projectId,
        recordType: approvalWorkflowService.RECORD_TYPES.CHANGE_ORDER,
        recordId: updated.id,
        oldStatus: existing.status,
        newStatus: updated.status,
        comment:
          updated.status === CHANGE_ORDER_STATUSES.REJECTED
            ? updated.rejectedReason
            : updated.approvalComment,
        userId,
        userRole,
        force: true,
      });
    }
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.CHANGE_ORDER,
      recordId: updated.id,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      reason:
        updated.status === CHANGE_ORDER_STATUSES.REJECTED
          ? updated.rejectedReason
          : updated.approvalComment,
      comment: updated.approvalComment,
      metadata: {
        ref: updated.ref,
        value: updated.value,
        scheduleImpact: updated.scheduleImpact,
        scheduleImpactSummary: updated.scheduleImpactSummary,
        costImpactSummary: updated.costImpactSummary,
        approvedImpactTrace,
        budgetRevision,
        activityLinks:
          activityTrace?.count ?? updated.activityLinks?.length ?? 0,
        allocationLinks:
          allocationTrace?.count ?? updated.allocationLinks?.length ?? 0,
      },
    });

    const reloaded = await tx.changeOrder.findFirst({
      where: { id: updated.id },
      include: changeOrderInclude,
    });
    const [enriched] = await attachEvidenceToRecords({
      tx,
      projectId,
      recordType: RECORD_TYPES.CHANGE_ORDER,
      records: [reloaded || updated],
    });
    return enriched;
  });
  if (result?.status === CHANGE_ORDER_STATUSES.PENDING && existing.status !== CHANGE_ORDER_STATUSES.PENDING && !viaWorkflow) {
    require("./workflow-engine.service")
      .maybeStart({ orgId, projectId, tool: "change_order", recordId: coId, actor: { id: userId, role: userRole } })
      .catch(() => null);
  }
  return result;
};

const approveChangeOrder = async ({
  orgId,
  projectId,
  coId,
  comment = null,
  userId = null,
  userRole = null,
  viaWorkflow = false,
}) => {
  return updateChangeOrder({
    orgId,
    projectId,
    coId,
    userId,
    userRole,
    payload: {
      status: CHANGE_ORDER_STATUSES.APPROVED,
      approvalComment: trimOrNull(comment),
    },
    workflowAction: CHANGE_ORDER_WORKFLOW_ACTIONS.APPROVE,
    viaWorkflow,
  });
};

const submitChangeOrder = async ({
  orgId,
  projectId,
  coId,
  comment = null,
  userId = null,
  userRole = null,
  payload = {},
}) => {
  return updateChangeOrder({
    orgId,
    projectId,
    coId,
    userId,
    userRole,
    payload: {
      ...payload,
      status: CHANGE_ORDER_STATUSES.PENDING,
      approvalComment: trimOrNull(comment || payload.comment),
    },
    workflowAction: CHANGE_ORDER_WORKFLOW_ACTIONS.SUBMIT,
  });
};

const rejectChangeOrder = async ({
  orgId,
  projectId,
  coId,
  reason,
  userId = null,
  userRole = null,
  viaWorkflow = false,
}) => {
  const rejectionReason = approvalDecisionNote({ reason });
  if (!rejectionReason) {
    throw new HttpError(
      400,
      "APPROVAL_WORKFLOW_REASON_REQUIRED",
      "A reason is required for this workflow decision",
    );
  }

  return updateChangeOrder({
    orgId,
    projectId,
    coId,
    userId,
    userRole,
    payload: {
      status: CHANGE_ORDER_STATUSES.REJECTED,
      rejectedReason: rejectionReason,
      approvalComment: rejectionReason,
    },
    workflowAction: CHANGE_ORDER_WORKFLOW_ACTIONS.REJECT,
    viaWorkflow,
  });
};

const reopenChangeOrder = async ({
  orgId,
  projectId,
  coId,
  comment = null,
  userId = null,
  userRole = null,
}) => {
  const note = trimOrNull(comment);
  return updateChangeOrder({
    orgId,
    projectId,
    coId,
    userId,
    userRole,
    payload: {
      status: CHANGE_ORDER_STATUSES.DRAFT,
      approvalComment: note,
    },
    workflowAction: CHANGE_ORDER_WORKFLOW_ACTIONS.REOPEN,
  });
};

const deleteChangeOrder = async ({
  orgId,
  projectId,
  coId,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.changeOrder.findFirst({
    where: { id: coId, projectId },
  });
  if (!existing) {
    throw new HttpError(
      404,
      "CHANGE_ORDER_NOT_FOUND",
      "Change order not found",
    );
  }
  if (existing.status === ARCHIVED_STATUS || existing.archivedAt) {
    return archiveResult({
      id: coId,
      status: ARCHIVED_STATUS,
      archivedAt: existing.archivedAt,
    });
  }
  if (existing.status === CHANGE_ORDER_STATUSES.APPROVED) {
    throw new HttpError(
      409,
      "CHANGE_ORDER_APPROVED_LOCKED",
      "Approved change orders cannot be archived after contract budget revision sync",
    );
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Held and read again before it is archived: the approved-state check
    // above was made on a copy, and an approval that landed since was
    // archived with its budget revision and impacts standing (Phase 21D,
    // CX21-512).
    if (tx.$queryRaw) await tx.$queryRaw`SELECT id FROM "ChangeOrder" WHERE id = ${coId} FOR UPDATE`;
    const held = await tx.changeOrder.findFirst({ where: { id: coId, projectId }, select: { status: true, archivedAt: true } });
    if (!held) {
      throw new HttpError(404, "CHANGE_ORDER_NOT_FOUND", "Change order not found");
    }
    if (held.status !== existing.status || Boolean(held.archivedAt) !== Boolean(existing.archivedAt)) {
      throw new HttpError(
        409,
        "CHANGE_ORDER_CHANGED",
        `The change order is now ${held.status}; reload it and decide again`,
      );
    }
    const archived = await tx.changeOrder.update({
      where: { id: coId },
      data: {
        status: ARCHIVED_STATUS,
        archivedAt: now,
        archivedBy: userId || null,
        updatedBy: userId || null,
      },
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.CHANGE_ORDER,
      recordId: coId,
      oldStatus: existing.status,
      newStatus: ARCHIVED_STATUS,
      comment: "Change order archived",
      userId,
      userRole,
      force: true,
    });
    // An archived change order is no longer pending against the contract.
    await require("./prime-contract.service").recomputeChangeValues(tx, {
      orgId,
      projectId,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.CHANGE_ORDER,
      recordId: coId,
      fromStatus: existing.status,
      toStatus: ARCHIVED_STATUS,
      actorId: userId,
      actorRole: userRole,
      comment: "Change order archived",
      metadata: {
        ref: existing.ref,
        value: existing.value,
        scheduleImpact: existing.scheduleImpact,
        archivedAt: now.toISOString(),
      },
    });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.CHANGE_ORDER,
      entityId: existing.id,
      action: auditService.ACTIONS.ARCHIVED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: existing.status,
      newStatus: ARCHIVED_STATUS,
      oldSummary: summarizeChangeOrder(existing),
      newSummary: summarizeChangeOrder(archived),
      summary: {
        transition: "change_order.archive",
        ref: existing.ref,
        value: existing.value,
        scheduleImpact: existing.scheduleImpact,
      },
    });
  });
  return archiveResult({ id: coId, archivedAt: now });
};

module.exports = {
  CHANGE_ORDER_STATUSES,
  listChangeOrders,
  createChangeOrder,
  updateChangeOrder,
  submitChangeOrder,
  approveChangeOrder,
  rejectChangeOrder,
  reopenChangeOrder,
  deleteChangeOrder,
};
