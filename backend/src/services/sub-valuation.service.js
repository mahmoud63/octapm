const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
};

const computeFinancials = ({
  workDone = 0,
  materialsOnSite = 0,
  retentionRate = 5,
  backCharges = 0,
}) => {
  const grossPayable = (Number(workDone) || 0) + (Number(materialsOnSite) || 0);
  const retention = ((Number(retentionRate) || 0) / 100) * grossPayable;
  const netPayable = grossPayable - retention - (Number(backCharges) || 0);

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
    orderBy: [{ submittedDate: 'desc' }, { createdAt: 'desc' }],
  });

  const summary = rows.reduce(
    (acc, row) => {
      const net = Number(row.netPayable) || 0;
      const gross = Number(row.grossPayable) || 0;
      const retention = Number(row.retention) || 0;
      acc.totalGross += gross;
      acc.totalRetention += retention;
      acc.totalNet += net;

      if (row.status === 'paid') acc.totalPaid += net;
      if (row.status === 'certified') acc.totalCertified += net;
      if (row.status === 'submitted') acc.totalSubmitted += net;
      if (row.status === 'draft') acc.totalDraft += net;

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

  return { rows, summary };
};

const createSubValuation = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });

  const count = await prisma.subValuation.count({ where: { projectId } });
  const ref = `SV-${String(count + 1).padStart(2, '0')}`;

  const values = computeFinancials(payload);

  return prisma.subValuation.create({
    data: {
      projectId,
      ref,
      subcontractor: payload.subcontractor,
      period: payload.period,
      workDone: Number(payload.workDone) || 0,
      materialsOnSite: Number(payload.materialsOnSite) || 0,
      grossPayable: values.grossPayable,
      retentionRate: values.retentionRate,
      retention: values.retention,
      backCharges: Number(payload.backCharges) || 0,
      netPayable: values.netPayable,
      status: payload.status || 'draft',
      submittedDate: payload.submittedDate
        ? new Date(payload.submittedDate)
        : null,
      certDate: payload.certDate ? new Date(payload.certDate) : null,
      payDate: payload.payDate ? new Date(payload.payDate) : null,
    },
  });
};

const updateSubValuation = async ({
  orgId,
  projectId,
  valuationId,
  payload,
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

  return prisma.subValuation.update({
    where: { id: valuationId },
    data: {
      subcontractor: payload.subcontractor ?? existing.subcontractor,
      period: payload.period ?? existing.period,
      workDone:
        payload.workDone !== undefined
          ? Number(payload.workDone) || 0
          : existing.workDone,
      materialsOnSite:
        payload.materialsOnSite !== undefined
          ? Number(payload.materialsOnSite) || 0
          : existing.materialsOnSite,
      grossPayable: nextValues.grossPayable,
      retentionRate: nextValues.retentionRate,
      retention: nextValues.retention,
      backCharges:
        payload.backCharges !== undefined
          ? Number(payload.backCharges) || 0
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
  });
};

const deleteSubValuation = async ({ orgId, projectId, valuationId }) => {
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

  await prisma.subValuation.delete({ where: { id: valuationId } });
  return { deleted: true };
};

module.exports = {
  listSubValuations,
  createSubValuation,
  updateSubValuation,
  deleteSubValuation,
};
