const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { addMoney, subtractMoney, toMoneyNumber } = require("../utils/money");

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
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
      acc.inflow = addMoney(acc.inflow, row.inflow);
      acc.outflow = addMoney(acc.outflow, row.outflow);
      return acc;
    },
    { inflow: 0, outflow: 0 },
  );

  return {
    ...totals,
    net: subtractMoney(totals.inflow, totals.outflow),
  };
};

const listCashFlow = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const rows = await prisma.cashFlowEntry.findMany({
    where: { projectId },
    orderBy: [{ period: "asc" }, { createdAt: "asc" }],
  });

  const monthly = new Map();
  for (const row of rows) {
    const current = monthly.get(row.period) || {
      period: row.period,
      inflow: 0,
      outflow: 0,
    };
    current.inflow = addMoney(current.inflow, row.inflow);
    current.outflow = addMoney(current.outflow, row.outflow);
    monthly.set(row.period, current);
  }

  return {
    rows,
    monthly: Array.from(monthly.values()).map((item) => ({
      ...item,
      net: subtractMoney(item.inflow, item.outflow),
    })),
    summary: summarize(rows),
  };
};

const createManualCashFlowEntry = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });

  if (!payload.period || !/^\d{4}-\d{2}$/.test(String(payload.period))) {
    throw new HttpError(
      400,
      "INVALID_PERIOD",
      "Period must be in YYYY-MM format",
    );
  }

  return prisma.cashFlowEntry.create({
    data: {
      projectId,
      period: String(payload.period),
      inflow: toMoneyNumber(payload.inflow),
      outflow: toMoneyNumber(payload.outflow),
      note: payload.note?.trim() || null,
      source: "manual",
    },
  });
};

const rebuildCashFlow = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const ipcPaymentRows = await prisma.ipcPayment.findMany({
    where: { projectId },
    select: {
      paymentDate: true,
      amount: true,
    },
  });

  const legacyPaidIpcRows = await prisma.ipcCertificate.findMany({
    where: {
      projectId,
      status: "paid",
      amountPaid: { gt: 0 },
      payments: { none: {} },
    },
    select: {
      issueDate: true,
      createdAt: true,
      amountPaid: true,
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
    current.inflow = addMoney(current.inflow, inflow);
    current.outflow = addMoney(current.outflow, outflow);
    agg.set(period, current);
  };

  for (const payment of ipcPaymentRows) {
    const period = toMonth(payment.paymentDate);
    merge(period, toMoneyNumber(payment.amount), 0);
  }

  for (const ipc of legacyPaidIpcRows) {
    const period = toMonth(ipc.issueDate || ipc.createdAt);
    merge(period, toMoneyNumber(ipc.amountPaid), 0);
  }

  for (const sub of subRows) {
    const period = toMonth(sub.payDate || sub.certDate || sub.createdAt);
    const payable = toMoneyNumber(sub.netPayable);
    merge(period, 0, payable);
  }

  await prisma.$transaction(async (tx) => {
    await tx.cashFlowEntry.deleteMany({
      where: { projectId, source: "system" },
    });

    const rows = Array.from(agg.entries()).map(([period, values]) => ({
      projectId,
      period,
      inflow: values.inflow,
      outflow: values.outflow,
      source: "system",
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
      "CASH_FLOW_ENTRY_NOT_FOUND",
      "Cash flow entry not found",
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
