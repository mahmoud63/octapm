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

const toMonth = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 7);
};

const summarize = (rows) => {
  const totals = rows.reduce(
    (acc, row) => {
      acc.inflow += Number(row.inflow) || 0;
      acc.outflow += Number(row.outflow) || 0;
      return acc;
    },
    { inflow: 0, outflow: 0 },
  );

  return {
    ...totals,
    net: totals.inflow - totals.outflow,
  };
};

const listCashFlow = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const rows = await prisma.cashFlowEntry.findMany({
    where: { projectId },
    orderBy: [{ period: 'asc' }, { createdAt: 'asc' }],
  });

  const monthly = new Map();
  for (const row of rows) {
    const current = monthly.get(row.period) || {
      period: row.period,
      inflow: 0,
      outflow: 0,
    };
    current.inflow += Number(row.inflow) || 0;
    current.outflow += Number(row.outflow) || 0;
    monthly.set(row.period, current);
  }

  return {
    rows,
    monthly: Array.from(monthly.values()).map((item) => ({
      ...item,
      net: item.inflow - item.outflow,
    })),
    summary: summarize(rows),
  };
};

const createManualCashFlowEntry = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });

  if (!payload.period || !/^\d{4}-\d{2}$/.test(String(payload.period))) {
    throw new HttpError(
      400,
      'INVALID_PERIOD',
      'Period must be in YYYY-MM format',
    );
  }

  return prisma.cashFlowEntry.create({
    data: {
      projectId,
      period: String(payload.period),
      inflow: Number(payload.inflow) || 0,
      outflow: Number(payload.outflow) || 0,
      note: payload.note?.trim() || null,
      source: 'manual',
    },
  });
};

const rebuildCashFlow = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const ipcRows = await prisma.ipcCertificate.findMany({
    where: { projectId },
    select: {
      issueDate: true,
      createdAt: true,
      netPayable: true,
      status: true,
    },
  });

  const subRows = await prisma.subValuation.findMany({
    where: { projectId },
    select: {
      payDate: true,
      certDate: true,
      createdAt: true,
      netPayable: true,
      status: true,
    },
  });

  const agg = new Map();
  const merge = (period, inflow, outflow) => {
    if (!period) return;
    const current = agg.get(period) || { inflow: 0, outflow: 0 };
    current.inflow += inflow;
    current.outflow += outflow;
    agg.set(period, current);
  };

  for (const ipc of ipcRows) {
    const period = toMonth(ipc.issueDate || ipc.createdAt);
    merge(period, Number(ipc.netPayable) || 0, 0);
  }

  for (const sub of subRows) {
    const period = toMonth(sub.payDate || sub.certDate || sub.createdAt);
    const payable = Number(sub.netPayable) || 0;
    merge(period, 0, payable);
  }

  await prisma.$transaction(async (tx) => {
    await tx.cashFlowEntry.deleteMany({
      where: { projectId, source: 'system' },
    });

    const rows = Array.from(agg.entries()).map(([period, values]) => ({
      projectId,
      period,
      inflow: values.inflow,
      outflow: values.outflow,
      source: 'system',
    }));

    if (rows.length > 0) {
      await tx.cashFlowEntry.createMany({ data: rows });
    }
  });

  return listCashFlow({ orgId, projectId });
};

const deleteCashFlowEntry = async ({ orgId, projectId, entryId }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.cashFlowEntry.findFirst({
    where: { id: entryId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      'CASH_FLOW_ENTRY_NOT_FOUND',
      'Cash flow entry not found',
    );
  }

  await prisma.cashFlowEntry.delete({ where: { id: entryId } });
  return { deleted: true };
};

module.exports = {
  listCashFlow,
  createManualCashFlowEntry,
  rebuildCashFlow,
  deleteCashFlowEntry,
};
