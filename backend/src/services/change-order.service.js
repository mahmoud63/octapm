const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { addMoney, toMoneyNumber } = require('../utils/money');
const auditService = require('./audit.service');
const {
  RECORD_TYPES,
  attachEvidenceToRecords,
  syncEvidenceReferences,
} = require('./commercial-traceability.service');
const approvalWorkflowService = require('./approval-workflow.service');

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
    orderBy: [{ createdAt: 'asc' }],
  },
  allocationLinks: {
    include: {
      allocation: { select: allocationTraceSelect },
      boqItem: { select: boqTraceSelect },
    },
    orderBy: [{ createdAt: 'asc' }],
  },
};

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const dateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const hasExplicitNumber = (value) => value !== null && value !== undefined && value !== '';

const summarizeChangeOrder = (order) => ({
  ref: order.ref,
  description: order.description,
  status: order.status,
  value: order.value,
  scheduleImpact: order.scheduleImpact,
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
});

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
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

const normalizeActivityLinks = ({ payload = {}, fallbackActivityId = null }) => {
  if (payload.activityLinks !== undefined) {
    return (Array.isArray(payload.activityLinks) ? payload.activityLinks : [])
      .map((link) => ({
        activityId: link?.activityId,
        relationType: trimOrNull(link?.relationType) || 'affected',
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
    return (Array.isArray(payload.affectedActivityIds)
      ? payload.affectedActivityIds
      : []
    )
      .map((activityId) => ({
        activityId,
        relationType: 'affected',
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
            relationType: 'affected',
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
        relationType: 'affected',
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

const evidenceInputCount = (payload = {}) => {
  const input =
    payload.attachmentRefs !== undefined
      ? payload.attachmentRefs
      : payload.attachments !== undefined
        ? payload.attachments
        : payload.supportingDocumentIds !== undefined
          ? payload.supportingDocumentIds
          : payload.documentIds;
  return Array.isArray(input) ? input.length : 0;
};

const assertCreateApprovalProof = ({ status, payload, fallbackActivityId }) => {
  if (status !== 'approved') return;
  const links = normalizeActivityLinks({ payload, fallbackActivityId }) || [];
  if (links.length > 0 && evidenceInputCount(payload) > 0) return;
  throw new HttpError(
    400,
    'CHANGE_ORDER_IMPACT_PROOF_REQUIRED',
    'Approving a change order requires at least one affected activity and one supporting document',
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
}) => {
  if (status !== 'approved') return;

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
      where: { projectId, recordType: RECORD_TYPES.CHANGE_ORDER, recordId: changeOrderId },
    }));

  if (activityCount > 0 && documentCount > 0) return;

  throw new HttpError(
    400,
    'CHANGE_ORDER_IMPACT_PROOF_REQUIRED',
    'Approving a change order requires at least one affected activity and one supporting document',
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
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  const missing = ids.filter((id) => !activityById.has(id));
  if (missing.length > 0) {
    throw new HttpError(
      400,
      'CHANGE_ORDER_ACTIVITY_NOT_FOUND',
      'One or more linked activities were not found in this project',
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
          : status === 'approved'
            ? scheduleImpactDays
            : 0;
      const approvedCostImpact =
        link.approvedCostImpact !== null
          ? toMoneyNumber(link.approvedCostImpact)
          : status === 'approved'
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

const syncAllocationLinks = async ({ tx, projectId, changeOrderId, payload }) => {
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
            status: 'approved',
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
  const missingAllocation = allocationIds.filter((id) => !allocationById.has(id));
  const missingBoq = boqItemIds.filter((id) => !boqItemSet.has(id));
  if (missingAllocation.length > 0 || missingBoq.length > 0) {
    throw new HttpError(
      400,
      'CHANGE_ORDER_ALLOCATION_NOT_FOUND',
      'One or more linked BOQ allocations were not found or approved in this project',
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

const listChangeOrders = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const orders = await prisma.changeOrder.findMany({
    where: { projectId },
    include: changeOrderInclude,
    orderBy: [{ submittedDate: 'desc' }, { updatedAt: 'desc' }],
  });

  const summary = orders.reduce(
    (acc, order) => {
      const value = toMoneyNumber(order.value);
      if (order.status === 'approved') {
        acc.totalApproved = addMoney(acc.totalApproved, value);
        acc.approvedCount += 1;
        acc.totalScheduleImpact += Number(order.scheduleImpact) || 0;
      } else if (order.status === 'pending') {
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

  const count = await prisma.changeOrder.count({ where: { projectId } });
  const ref = `VO-${String(count + 1).padStart(2, '0')}`;
  const now = new Date();
  const status = payload.status || 'pending';
  const rejectedReason = trimOrNull(payload.rejectedReason);
  const approvalComment = trimOrNull(payload.approvalComment);
  if (status === 'rejected' && !rejectedReason) {
    throw new HttpError(
      400,
      'REJECT_REASON_REQUIRED',
      'Rejected reason is required',
    );
  }
  const primaryActivityId = firstActivityIdFromPayload(payload);
  assertCreateApprovalProof({
    status,
    payload,
    fallbackActivityId:
      primaryActivityId !== undefined ? primaryActivityId : payload.activityId || null,
  });

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
        submittedDate: payload.submittedDate
          ? new Date(payload.submittedDate)
          : now,
        raisedBy: payload.raisedBy?.trim() || null,
        rejectedReason,
        createdBy: userId || null,
        updatedBy: userId || null,
        approvedBy: status === 'approved' ? userId || null : null,
        approvedAt: status === 'approved' ? now : null,
        approvalComment: status === 'approved' ? approvalComment : null,
        approvedDate:
          status === 'approved'
            ? payload.approvedDate
              ? new Date(payload.approvedDate)
              : now
            : null,
        rejectedBy: status === 'rejected' ? userId || null : null,
        rejectedAt: status === 'rejected' ? now : null,
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
    await assertApprovalProof({
      tx,
      projectId,
      changeOrderId: created.id,
      status: created.status,
      existing: created,
      activityTrace,
      evidence,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.CHANGE_ORDER,
      entityId: created.id,
      action:
        status === 'approved'
          ? auditService.ACTIONS.APPROVED
          : auditService.ACTIONS.CREATED,
      actorId: userId,
      occurredAt: now,
      newStatus: created.status,
      reason: status === 'rejected' ? rejectedReason : approvalComment,
      newSummary: summarizeChangeOrder(created),
      summary: {
        transition:
          status === 'approved' ? 'change_order.approve' : 'change_order.create',
        ref: created.ref,
        value: created.value,
        scheduleImpact: created.scheduleImpact,
        activityLinks: activityTrace?.count ?? created.activityLinks?.length ?? 0,
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
      reason: status === 'rejected' ? rejectedReason : approvalComment,
      comment: approvalComment,
      metadata: {
        ref: created.ref,
        value: created.value,
        scheduleImpact: created.scheduleImpact,
        activityLinks: activityTrace?.count ?? created.activityLinks?.length ?? 0,
        allocationLinks:
          allocationTrace?.count ?? created.allocationLinks?.length ?? 0,
      },
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
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.changeOrder.findFirst({
    where: { id: coId, projectId },
  });
  if (!existing) {
    throw new HttpError(
      404,
      'CHANGE_ORDER_NOT_FOUND',
      'Change order not found',
    );
  }

  const nextStatus = payload.status || existing.status;
  const now = new Date();
  const approvalComment =
    payload.approvalComment !== undefined
      ? trimOrNull(payload.approvalComment)
      : existing.approvalComment || null;
  if (
    nextStatus === 'rejected' &&
    !String(payload.rejectedReason || existing.rejectedReason || '').trim()
  ) {
    throw new HttpError(
      400,
      'REJECT_REASON_REQUIRED',
      'Rejected reason is required',
    );
  }

  const data = {};
  if (payload.activityId !== undefined)
    data.activityId = payload.activityId || null;
  if (payload.activityLinks !== undefined || payload.affectedActivityIds !== undefined) {
    data.activityId = firstActivityIdFromPayload(payload);
  }
  if (payload.description !== undefined) data.description = payload.description;
  if (payload.category !== undefined)
    data.category = payload.category?.trim() || null;
  if (payload.value !== undefined) data.value = toMoneyNumber(payload.value);
  if (payload.scheduleImpact !== undefined) {
    data.scheduleImpact = Number(payload.scheduleImpact) || 0;
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

  if (nextStatus === 'approved' && existing.status !== 'approved') {
    data.approvedDate = now;
    data.approvedAt = now;
    data.approvedBy = userId || null;
    data.approvalComment = approvalComment;
    data.rejectedBy = null;
    data.rejectedAt = null;
    data.rejectedReason = null;
  }

  if (nextStatus === 'rejected' && existing.status !== 'rejected') {
    data.rejectedAt = now;
    data.rejectedBy = userId || null;
  }

  return prisma.$transaction(async (tx) => {
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
      existing,
      activityTrace,
      evidence,
    });

    const statusChanged = updated.status !== existing.status;
    const action = statusChanged
      ? updated.status === 'approved'
        ? auditService.ACTIONS.APPROVED
        : updated.status === 'rejected'
          ? auditService.ACTIONS.REJECTED
          : auditService.ACTIONS.STATUS_CHANGED
      : auditService.ACTIONS.UPDATED;

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
        updated.status === 'rejected'
          ? updated.rejectedReason
          : updated.approvalComment,
      oldSummary: summarizeChangeOrder(existing),
      newSummary: summarizeChangeOrder(updated),
      summary: {
        transition: statusChanged
          ? `change_order.${updated.status}`
          : 'change_order.update',
        ref: updated.ref,
        value: updated.value,
        scheduleImpact: updated.scheduleImpact,
        activityLinks: activityTrace?.count ?? updated.activityLinks?.length ?? 0,
        allocationLinks:
          allocationTrace?.count ?? updated.allocationLinks?.length ?? 0,
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
      recordId: updated.id,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      reason:
        updated.status === 'rejected'
          ? updated.rejectedReason
          : updated.approvalComment,
      comment: updated.approvalComment,
      metadata: {
        ref: updated.ref,
        value: updated.value,
        scheduleImpact: updated.scheduleImpact,
        activityLinks: activityTrace?.count ?? updated.activityLinks?.length ?? 0,
        allocationLinks:
          allocationTrace?.count ?? updated.allocationLinks?.length ?? 0,
      },
    });

    const [enriched] = await attachEvidenceToRecords({
      tx,
      projectId,
      recordType: RECORD_TYPES.CHANGE_ORDER,
      records: [updated],
    });
    return enriched;
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
      'CHANGE_ORDER_NOT_FOUND',
      'Change order not found',
    );
  }

  await prisma.$transaction(async (tx) => {
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.CHANGE_ORDER,
      entityId: existing.id,
      action: auditService.ACTIONS.DELETED,
      actorId: userId,
      oldStatus: existing.status,
      oldSummary: summarizeChangeOrder(existing),
      summary: {
        transition: 'change_order.delete',
        ref: existing.ref,
        value: existing.value,
        scheduleImpact: existing.scheduleImpact,
      },
    });

    await tx.changeOrder.delete({ where: { id: coId } });
  });
  return { deleted: true };
};

module.exports = {
  listChangeOrders,
  createChangeOrder,
  updateChangeOrder,
  deleteChangeOrder,
};
