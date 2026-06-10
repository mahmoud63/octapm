const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  addMoney,
  multiplyMoney,
  subtractMoney,
  toMoneyNumber,
} = require('../utils/money');
const auditService = require('./audit.service');
const {
  RECORD_TYPES,
  attachEvidenceToRecords,
  syncEvidenceReferences,
} = require('./commercial-traceability.service');

const DEFAULT_RETENTION_RATE = 5;

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

const subValuationInclude = {
  activityLinks: {
    include: { activity: { select: activityTraceSelect } },
    orderBy: [{ createdAt: 'asc' }],
  },
  allocationLinks: {
    include: {
      allocation: {
        select: {
          id: true,
          quantity: true,
          amount: true,
          weight: true,
          status: true,
          boqItem: { select: boqTraceSelect },
          activity: { select: activityTraceSelect },
        },
      },
      boqItem: { select: boqTraceSelect },
    },
    orderBy: [{ createdAt: 'asc' }],
  },
};

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
};

const resolveRetentionRate = (project) => {
  const rate = Number(project?.defaultRetentionRate);
  return Number.isFinite(rate) ? rate : DEFAULT_RETENTION_RATE;
};

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const summarizeSubValuation = (row) => ({
  ref: row.ref,
  subcontractor: row.subcontractor,
  period: row.period,
  status: row.status,
  grossPayable: row.grossPayable,
  netPayable: row.netPayable,
  activityLinkCount: row.activityLinks?.length || 0,
  allocationLinkCount: row.allocationLinks?.length || 0,
});

const normalizeActivityLinks = (payload = {}) => {
  if (payload.activityLinks === undefined) return null;

  return (Array.isArray(payload.activityLinks) ? payload.activityLinks : [])
    .map((link) => ({
      activityId: trimOrNull(link?.activityId),
      relationType: trimOrNull(link?.relationType) || 'work_scope',
      quantity: Number(link?.quantity) || 0,
      amount: toMoneyNumber(link?.amount),
      notes: trimOrNull(link?.notes),
    }))
    .filter((link) => link.activityId);
};

const normalizeAllocationLinks = (payload = {}, values = {}) => {
  if (payload.allocationLinks === undefined) return null;

  return (Array.isArray(payload.allocationLinks) ? payload.allocationLinks : [])
    .map((link) => ({
      allocationId: trimOrNull(link?.allocationId),
      boqItemId: trimOrNull(link?.boqItemId),
      quantity: Number(link?.quantity) || 0,
      workDoneAmount:
        toMoneyNumber(link?.workDoneAmount ?? link?.amount ?? values.workDone),
      materialsOnSiteAmount:
        toMoneyNumber(link?.materialsOnSiteAmount ?? values.materialsOnSite),
      retentionAmount: toMoneyNumber(link?.retentionAmount ?? values.retention),
      notes: trimOrNull(link?.notes),
    }))
    .filter((link) => link.allocationId || link.boqItemId);
};

const syncActivityLinks = async ({
  tx,
  projectId,
  subValuationId,
  payload,
}) => {
  const links = normalizeActivityLinks(payload);
  if (links === null) return null;

  await tx.subValuationActivityLink.deleteMany({
    where: { projectId, subValuationId },
  });
  if (links.length === 0) return { count: 0 };

  const ids = [...new Set(links.map((link) => link.activityId))];
  const activities = await tx.activity.findMany({
    where: { projectId, id: { in: ids } },
    select: { id: true },
  });
  const found = new Set(activities.map((activity) => activity.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new HttpError(
      400,
      'SUB_VALUATION_ACTIVITY_NOT_FOUND',
      'One or more linked activities were not found in this project',
    );
  }

  await tx.subValuationActivityLink.createMany({
    data: links.map((link) => ({
      projectId,
      subValuationId,
      activityId: link.activityId,
      relationType: link.relationType,
      quantity: link.quantity,
      amount: link.amount,
      notes: link.notes,
    })),
    skipDuplicates: true,
  });

  return { count: links.length };
};

const syncAllocationLinks = async ({
  tx,
  projectId,
  subValuationId,
  payload,
  values,
}) => {
  const links = normalizeAllocationLinks(payload, values);
  if (links === null) return null;

  await tx.subValuationAllocationLink.deleteMany({
    where: { projectId, subValuationId },
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
      'SUB_VALUATION_ALLOCATION_NOT_FOUND',
      'One or more linked BOQ allocations were not found or approved in this project',
    );
  }

  await tx.subValuationAllocationLink.createMany({
    data: links.map((link) => {
      const allocation = link.allocationId
        ? allocationById.get(link.allocationId)
        : null;
      return {
        projectId,
        subValuationId,
        allocationId: link.allocationId || null,
        boqItemId: link.boqItemId || allocation?.boqItemId || null,
        quantity: link.quantity,
        workDoneAmount: link.workDoneAmount,
        materialsOnSiteAmount: link.materialsOnSiteAmount,
        retentionAmount: link.retentionAmount,
        notes: link.notes,
      };
    }),
    skipDuplicates: true,
  });

  return { count: links.length };
};

const computeFinancials = ({
  workDone = 0,
  materialsOnSite = 0,
  retentionRate = 5,
  backCharges = 0,
}) => {
  const grossPayable = addMoney(workDone, materialsOnSite);
  const retention = multiplyMoney(grossPayable, (Number(retentionRate) || 0) / 100);
  const netPayable = subtractMoney(
    subtractMoney(grossPayable, retention),
    backCharges,
  );

  return {
    grossPayable,
    retention,
    netPayable,
    retentionRate: Number(retentionRate) || 0,
  };
};

const listSubValuations = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const rows = await prisma.subValuation.findMany({
    where: { projectId },
    include: subValuationInclude,
    orderBy: [{ submittedDate: 'desc' }, { createdAt: 'desc' }],
  });

  const summary = rows.reduce(
    (acc, row) => {
      const net = toMoneyNumber(row.netPayable);
      const gross = toMoneyNumber(row.grossPayable);
      const retention = toMoneyNumber(row.retention);
      acc.totalGross = addMoney(acc.totalGross, gross);
      acc.totalRetention = addMoney(acc.totalRetention, retention);
      acc.totalNet = addMoney(acc.totalNet, net);

      if (row.status === 'paid') acc.totalPaid = addMoney(acc.totalPaid, net);
      if (row.status === 'certified') acc.totalCertified = addMoney(acc.totalCertified, net);
      if (row.status === 'submitted') acc.totalSubmitted = addMoney(acc.totalSubmitted, net);
      if (row.status === 'draft') acc.totalDraft = addMoney(acc.totalDraft, net);

      return acc;
    },
    {
      totalGross: 0,
      totalRetention: 0,
      totalNet: 0,
      totalPaid: 0,
      totalCertified: 0,
      totalSubmitted: 0,
      totalDraft: 0,
    },
  );

  const enrichedRows = await attachEvidenceToRecords({
    projectId,
    recordType: RECORD_TYPES.SUB_VALUATION,
    records: rows,
  });

  return { rows: enrichedRows, summary };
};

const createSubValuation = async ({ orgId, projectId, payload, userId = null }) => {
  const project = await ensureProject({ orgId, projectId });

  const count = await prisma.subValuation.count({ where: { projectId } });
  const ref = `SV-${String(count + 1).padStart(2, '0')}`;

  const values = computeFinancials({
    ...payload,
    retentionRate: payload.retentionRate ?? resolveRetentionRate(project),
  });

  return prisma.$transaction(async (tx) => {
    const created = await tx.subValuation.create({
      data: {
        projectId,
        ref,
        subcontractor: payload.subcontractor,
        period: payload.period,
        workDone: toMoneyNumber(payload.workDone),
        materialsOnSite: toMoneyNumber(payload.materialsOnSite),
        grossPayable: values.grossPayable,
        retentionRate: values.retentionRate,
        retention: values.retention,
        backCharges: toMoneyNumber(payload.backCharges),
        netPayable: values.netPayable,
        status: payload.status || 'draft',
        submittedDate: payload.submittedDate
          ? new Date(payload.submittedDate)
          : null,
        certDate: payload.certDate ? new Date(payload.certDate) : null,
        payDate: payload.payDate ? new Date(payload.payDate) : null,
      },
      include: subValuationInclude,
    });

    const activityTrace = await syncActivityLinks({
      tx,
      projectId,
      subValuationId: created.id,
      payload,
    });
    const allocationTrace = await syncAllocationLinks({
      tx,
      projectId,
      subValuationId: created.id,
      payload,
      values,
    });
    const evidence = await syncEvidenceReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.SUB_VALUATION,
      recordId: created.id,
      payload,
      userId,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SUB_VALUATION,
      entityId: created.id,
      action: auditService.ACTIONS.CREATED,
      actorId: userId,
      newStatus: created.status,
      newSummary: summarizeSubValuation(created),
      summary: {
        transition: 'sub_valuation.create',
        ref: created.ref,
        netPayable: created.netPayable,
        activityLinks: activityTrace?.count ?? 0,
        allocationLinks: allocationTrace?.count ?? 0,
        correspondenceLinks: evidence.correspondenceCount,
        attachmentRefs: evidence.attachmentCount,
      },
      attachments: evidence.attachments,
    });

    const [enriched] = await attachEvidenceToRecords({
      tx,
      projectId,
      recordType: RECORD_TYPES.SUB_VALUATION,
      records: [created],
    });
    return enriched;
  });
};

const updateSubValuation = async ({
  orgId,
  projectId,
  valuationId,
  payload,
  userId = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.subValuation.findFirst({
    where: { id: valuationId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      'SUB_VALUATION_NOT_FOUND',
      'Sub valuation not found',
    );
  }

  const nextValues = computeFinancials({
    workDone: payload.workDone ?? existing.workDone,
    materialsOnSite: payload.materialsOnSite ?? existing.materialsOnSite,
    retentionRate: payload.retentionRate ?? existing.retentionRate,
    backCharges: payload.backCharges ?? existing.backCharges,
  });

  return prisma.$transaction(async (tx) => {
    const updated = await tx.subValuation.update({
      where: { id: valuationId },
      data: {
        subcontractor: payload.subcontractor ?? existing.subcontractor,
        period: payload.period ?? existing.period,
        workDone:
          payload.workDone !== undefined
            ? toMoneyNumber(payload.workDone)
            : existing.workDone,
        materialsOnSite:
          payload.materialsOnSite !== undefined
            ? toMoneyNumber(payload.materialsOnSite)
            : existing.materialsOnSite,
        grossPayable: nextValues.grossPayable,
        retentionRate: nextValues.retentionRate,
        retention: nextValues.retention,
        backCharges:
          payload.backCharges !== undefined
            ? toMoneyNumber(payload.backCharges)
            : existing.backCharges,
        netPayable: nextValues.netPayable,
        status: payload.status ?? existing.status,
        submittedDate:
          payload.submittedDate !== undefined
            ? payload.submittedDate
              ? new Date(payload.submittedDate)
              : null
            : existing.submittedDate,
        certDate:
          payload.certDate !== undefined
            ? payload.certDate
              ? new Date(payload.certDate)
              : null
            : existing.certDate,
        payDate:
          payload.payDate !== undefined
            ? payload.payDate
              ? new Date(payload.payDate)
              : null
            : existing.payDate,
      },
      include: subValuationInclude,
    });

    const activityTrace = await syncActivityLinks({
      tx,
      projectId,
      subValuationId: updated.id,
      payload,
    });
    const allocationTrace = await syncAllocationLinks({
      tx,
      projectId,
      subValuationId: updated.id,
      payload,
      values: nextValues,
    });
    const evidence = await syncEvidenceReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.SUB_VALUATION,
      recordId: updated.id,
      payload,
      userId,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SUB_VALUATION,
      entityId: updated.id,
      action:
        updated.status !== existing.status
          ? auditService.ACTIONS.STATUS_CHANGED
          : auditService.ACTIONS.UPDATED,
      oldStatus: existing.status,
      newStatus: updated.status,
      actorId: userId,
      oldSummary: summarizeSubValuation(existing),
      newSummary: summarizeSubValuation(updated),
      summary: {
        transition:
          updated.status !== existing.status
            ? `sub_valuation.${updated.status}`
            : 'sub_valuation.update',
        ref: updated.ref,
        netPayable: updated.netPayable,
        activityLinks: activityTrace?.count ?? updated.activityLinks?.length ?? 0,
        allocationLinks:
          allocationTrace?.count ?? updated.allocationLinks?.length ?? 0,
        correspondenceLinks: evidence.correspondenceCount,
        attachmentRefs: evidence.attachmentCount,
      },
      attachments: evidence.attachments,
    });

    const [enriched] = await attachEvidenceToRecords({
      tx,
      projectId,
      recordType: RECORD_TYPES.SUB_VALUATION,
      records: [updated],
    });
    return enriched;
  });
};

const deleteSubValuation = async ({
  orgId,
  projectId,
  valuationId,
  userId = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.subValuation.findFirst({
    where: { id: valuationId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      'SUB_VALUATION_NOT_FOUND',
      'Sub valuation not found',
    );
  }

  await prisma.$transaction(async (tx) => {
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SUB_VALUATION,
      entityId: existing.id,
      action: auditService.ACTIONS.DELETED,
      actorId: userId,
      oldStatus: existing.status,
      oldSummary: summarizeSubValuation(existing),
      summary: {
        transition: 'sub_valuation.delete',
        ref: existing.ref,
        netPayable: existing.netPayable,
      },
    });

    await tx.subValuation.delete({ where: { id: valuationId } });
  });
  return { deleted: true };
};

module.exports = {
  listSubValuations,
  createSubValuation,
  updateSubValuation,
  deleteSubValuation,
};
