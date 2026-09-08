const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  addMoney,
  multiplyMoney,
  subtractMoney,
  toMoneyNumber,
} = require('../utils/money');
const auditService = require('./audit.service');
const { normalizeCompanyName } = require('../utils/company-name');
const {
  RECORD_TYPES,
  attachEvidenceToRecords,
  syncEvidenceReferences,
} = require('./commercial-traceability.service');

/**
 * Legacy subcontractor valuations (OCTA-FIN-SUBVAL-064).
 *
 * These predate subcontract commitments. They name their subcontractor in free
 * text, hold no schedule of values, and post nothing to the cost ledger — they
 * only reach the project through cash flow. Subcontract commitments and their
 * payment applications replaced all of that.
 *
 * So the module is **retained read-only**, not migrated and not retired:
 *
 * - **No new rows.** A free-text party is the record nothing downstream can
 *   follow, which is the whole reason the replacement exists.
 * - **Existing rows stay, and stay editable enough to be finished** — a
 *   valuation left mid-flight has to be certifiable and payable, or the
 *   migration strands real money.
 * - **`subcontractor` is immutable.** It is the record of who was billed at the
 *   time; attribution goes on `companyId` beside it, never over it.
 * - **Certified and paid rows cannot be deleted.** They are history.
 *
 * Attribution is proposed by `attributionReport` and applied one row at a time.
 * Names are never matched automatically, for the reason set out in
 * `company-name.js`: two companies with near-identical names are usually two
 * companies.
 */

const DEFAULT_RETENTION_RATE = 5;

/** Statuses that record money the project has committed to or paid out. */
const HISTORICAL_STATUSES = Object.freeze(['certified', 'paid']);

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
  // Where a historical valuation has been attributed to a real company. The
  // free-text `subcontractor` stays beside it as what was written at the time.
  company: { select: { id: true, name: true } },
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

/**
 * Refused. Kept as a function rather than removed so the route answers with an
 * explanation and a destination instead of a 404 that reads like a fault.
 */
const createSubValuation = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });
  const error = new HttpError(
    409,
    'SUB_VALUATION_RETIRED',
    'Subcontractor valuations have been replaced by payment applications against a subcontract commitment, which name the subcontractor company, carry a schedule of values, and post certified cost to the ledger. Existing valuations stay readable.',
  );
  error.details = {
    replacedBy: 'sub_pay_app',
    how: 'Raise the subcontract under Commercial → Commitments, then claim against it under Commercial → Pay applications.',
    createPath: `/projects/${projectId}/pay-apps`,
  };
  throw error;
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

  // The free-text name records who was billed at the time. Attribution belongs
  // on companyId beside it; rewriting the name would edit the historical record
  // to look like something it was not.
  if (
    payload.subcontractor !== undefined &&
    String(payload.subcontractor).trim() !== existing.subcontractor
  ) {
    const error = new HttpError(
      409,
      'SUB_VALUATION_NAME_IMMUTABLE',
      `${existing.ref} was raised against "${existing.subcontractor}". That name is the record of who was billed and cannot be rewritten — attribute the valuation to a company instead.`,
    );
    error.details = { subcontractor: existing.subcontractor, attributeWith: 'companyId' };
    throw error;
  }

  let companyId;
  if (payload.companyId !== undefined) {
    const id = payload.companyId ? String(payload.companyId).trim() : null;
    if (id) {
      const company = await prisma.company.findFirst({
        where: { id, orgId },
        select: { id: true },
      });
      if (!company) throw new HttpError(404, 'COMPANY_NOT_FOUND', 'Company not found');
    }
    companyId = id;
  }

  // A certified or paid valuation holds figures that were agreed. Nothing may
  // restate them — not an edit, and not the recompute that a save would
  // otherwise run over them as a side effect of attributing a company.
  const frozen = HISTORICAL_STATUSES.includes(existing.status);
  if (frozen) {
    const MONEY_FIELDS = ['workDone', 'materialsOnSite', 'retentionRate', 'backCharges'];
    const attempted = MONEY_FIELDS.filter(
      (field) =>
        payload[field] !== undefined &&
        Number(payload[field]) !== Number(existing[field]),
    );
    if (attempted.length) {
      const error = new HttpError(
        409,
        'SUB_VALUATION_HISTORICAL',
        `${existing.ref} is ${existing.status}. Its figures were agreed and cannot be restated.`,
      );
      error.details = { ref: existing.ref, status: existing.status, fields: attempted };
      throw error;
    }
  }

  const nextValues = frozen
    ? {
        grossPayable: existing.grossPayable,
        retentionRate: existing.retentionRate,
        retention: existing.retention,
        netPayable: existing.netPayable,
      }
    : computeFinancials({
        workDone: payload.workDone ?? existing.workDone,
        materialsOnSite: payload.materialsOnSite ?? existing.materialsOnSite,
        retentionRate: payload.retentionRate ?? existing.retentionRate,
        backCharges: payload.backCharges ?? existing.backCharges,
      });

  return prisma.$transaction(async (tx) => {
    const updated = await tx.subValuation.update({
      where: { id: valuationId },
      data: {
        ...(companyId === undefined ? {} : { companyId }),
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

  // A certified or paid valuation is money the project committed to or paid
  // out. Deleting it removes the only record that it happened.
  if (HISTORICAL_STATUSES.includes(existing.status)) {
    const error = new HttpError(
      409,
      'SUB_VALUATION_HISTORICAL',
      `${existing.ref} is ${existing.status} and cannot be deleted — it is the record of ${toMoneyNumber(existing.netPayable)} ${existing.status === 'paid' ? 'paid to' : 'certified for'} ${existing.subcontractor}.`,
    );
    error.details = { ref: existing.ref, status: existing.status, netPayable: toMoneyNumber(existing.netPayable) };
    throw error;
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

/**
 * Which company each legacy free-text name most likely meant.
 *
 * Proposes, and stops there. `normalizeCompanyName` folds punctuation and separators
 * but deliberately not the legal form, so "ABC Steel LLC" and "ABC Steel Ltd"
 * stay apart — they are usually two companies, and a financial record attached
 * to the wrong one is worse than one attached to none.
 *
 * An unambiguous single match is offered as `suggested`; anything else is
 * listed as `candidates` for a person to choose from.
 */
const attributionReport = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const rows = await prisma.subValuation.findMany({
    where: { projectId },
    select: {
      id: true,
      ref: true,
      subcontractor: true,
      companyId: true,
      status: true,
      netPayable: true,
      company: { select: { id: true, name: true } },
    },
    orderBy: [{ ref: 'asc' }],
  });

  const companies = await prisma.company.findMany({
    where: { orgId },
    select: { id: true, name: true, nameKey: true },
  });
  const byKey = new Map();
  for (const company of companies) {
    const key = company.nameKey || normalizeCompanyName(company.name);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) || []), { id: company.id, name: company.name }]);
  }

  const items = rows.map((row) => {
    const key = normalizeCompanyName(row.subcontractor);
    const candidates = byKey.get(key) || [];
    return {
      id: row.id,
      ref: row.ref,
      subcontractor: row.subcontractor,
      status: row.status,
      netPayable: toMoneyNumber(row.netPayable),
      attributed: row.company ? { id: row.company.id, name: row.company.name } : null,
      nameKey: key,
      candidates,
      // Only an unambiguous match is worth putting in front of someone as an
      // answer; the rest is a question.
      suggested: !row.companyId && candidates.length === 1 ? candidates[0] : null,
    };
  });

  return {
    projectId,
    // Reported, never applied: attribution is a PATCH of one row at a time,
    // made by a person who knows which company it was.
    applyWith: `PATCH /projects/${projectId}/sub-valuations/{valuationId} { "companyId": "…" }`,
    summary: {
      total: items.length,
      attributed: items.filter((item) => item.attributed).length,
      suggested: items.filter((item) => item.suggested).length,
      ambiguous: items.filter((item) => !item.attributed && item.candidates.length > 1).length,
      unmatched: items.filter((item) => !item.attributed && item.candidates.length === 0).length,
    },
    items,
  };
};

module.exports = {
  HISTORICAL_STATUSES,
  attributionReport,
  listSubValuations,
  createSubValuation,
  updateSubValuation,
  deleteSubValuation,
};
