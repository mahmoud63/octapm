const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');

const MONEY_EPSILON = 0.01;
const QTY_EPSILON = 0.000001;

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
};

const getNextPeriod = (existingCertificates) => {
  const maxN = existingCertificates.reduce((max, cert) => {
    const match = String(cert.period || '').match(/IPC-(\d+)/i);
    if (!match) return max;
    return Math.max(max, Number(match[1]) || 0);
  }, 0);

  return `IPC-${maxN + 1}`;
};

const listIpcCertificates = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  return prisma.ipcCertificate.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'desc' }],
  });
};

const recomputeCertificateTotals = async (tx, certificateId) => {
  const items = await tx.ipcItem.findMany({
    where: { ipcCertificateId: certificateId },
    select: { currentCert: true, retention: true, netPayable: true },
  });

  const totals = items.reduce(
    (acc, item) => {
      acc.totalCert += Number(item.currentCert) || 0;
      acc.totalRet += Number(item.retention) || 0;
      acc.netPayable += Number(item.netPayable) || 0;
      return acc;
    },
    { totalCert: 0, totalRet: 0, netPayable: 0 },
  );

  await tx.ipcCertificate.update({
    where: { id: certificateId },
    data: totals,
  });

  return totals;
};

const getIpcPeriod = async ({ orgId, projectId, period }) => {
  await ensureProject({ orgId, projectId });

  const certificate = await prisma.ipcCertificate.findFirst({
    where: { projectId, period },
    include: {
      items: {
        include: {
          boqItem: {
            select: {
              id: true,
              code: true,
              ref: true,
              description: true,
              unit: true,
              qty: true,
              rate: true,
            },
          },
          allocation: {
            select: {
              id: true,
              quantity: true,
              amount: true,
              weight: true,
              activity: {
                select: {
                  id: true,
                  name: true,
                  p6ActivityId: true,
                  wbsCode: true,
                },
              },
            },
          },
        },
        orderBy: [{ boqItem: { sortOrder: 'asc' } }, { createdAt: 'asc' }],
      },
    },
  });

  if (!certificate) {
    throw new HttpError(404, 'IPC_PERIOD_NOT_FOUND', 'IPC period not found');
  }

  return certificate;
};

const createIpcPeriod = async ({ orgId, projectId, period }) => {
  await ensureProject({ orgId, projectId });

  const existingCertificates = await prisma.ipcCertificate.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
    select: { period: true },
  });

  const resolvedPeriod = period?.trim() || getNextPeriod(existingCertificates);

  const existing = await prisma.ipcCertificate.findFirst({
    where: { projectId, period: resolvedPeriod },
  });
  if (existing) {
    throw new HttpError(400, 'IPC_PERIOD_EXISTS', 'IPC period already exists');
  }

  const allocations = await prisma.activityBoqAllocation.findMany({
    where: { projectId, status: 'approved', isActive: true },
    include: {
      boqItem: true,
      activity: {
        select: {
          id: true,
          name: true,
          sortOrder: true,
        },
      },
    },
    orderBy: [
      { boqItem: { sortOrder: 'asc' } },
      { activity: { sortOrder: 'asc' } },
      { createdAt: 'asc' },
    ],
  });

  const previousItems = await prisma.ipcItem.findMany({
    where: { projectId },
    select: { allocationId: true, currentCert: true },
  });

  const previousCertMap = new Map();
  for (const item of previousItems) {
    if (!item.allocationId) continue;
    const current = previousCertMap.get(item.allocationId) || 0;
    previousCertMap.set(
      item.allocationId,
      current + (Number(item.currentCert) || 0),
    );
  }

  const certificate = await prisma.$transaction(async (tx) => {
    const created = await tx.ipcCertificate.create({
      data: {
        projectId,
        period: resolvedPeriod,
      },
    });

    if (allocations.length > 0) {
      await tx.ipcItem.createMany({
        data: allocations.map((allocation) => {
          const previousCert = previousCertMap.get(allocation.id) || 0;
          const rate =
            Number(allocation.quantity) > 0
              ? Number(allocation.amount) / Number(allocation.quantity)
              : Number(allocation.boqItem.rate) || 0;

          return {
            projectId,
            boqItemId: allocation.boqItemId,
            allocationId: allocation.id,
            ipcCertificateId: created.id,
            ipcPeriod: resolvedPeriod,
            qty: 0,
            rate,
            previousCert,
            currentCert: 0,
            cumulativeCert: previousCert,
            retentionRate: 5,
            retention: 0,
            netPayable: 0,
            status: 'draft',
          };
        }),
      });
    }

    return created;
  });

  return getIpcPeriod({ orgId, projectId, period: certificate.period });
};

const updateIpcItem = async ({ orgId, projectId, period, itemId, payload }) => {
  await ensureProject({ orgId, projectId });

  const certificate = await prisma.ipcCertificate.findFirst({
    where: { projectId, period },
  });
  if (!certificate) {
    throw new HttpError(404, 'IPC_PERIOD_NOT_FOUND', 'IPC period not found');
  }

  const existing = await prisma.ipcItem.findFirst({
    where: { id: itemId, projectId, ipcPeriod: period },
    include: { allocation: true },
  });
  if (!existing) {
    throw new HttpError(404, 'IPC_ITEM_NOT_FOUND', 'IPC item not found');
  }

  const qty = Number(payload.qty ?? existing.qty) || 0;
  const rate = Number(payload.rate ?? existing.rate) || 0;
  const retentionRate =
    Number(payload.retentionRate ?? existing.retentionRate) || 0;

  const currentCert = qty * rate;
  const retention = (retentionRate / 100) * currentCert;
  const netPayable = currentCert - retention;
  const cumulativeCert = (Number(existing.previousCert) || 0) + currentCert;

  if (existing.allocation) {
    if (qty > Number(existing.allocation.quantity || 0) + QTY_EPSILON) {
      throw new HttpError(
        400,
        'IPC_ALLOCATION_QTY_EXCEEDED',
        'IPC quantity cannot exceed the approved allocation quantity',
      );
    }

    if (
      cumulativeCert >
      Number(existing.allocation.amount || 0) + MONEY_EPSILON
    ) {
      throw new HttpError(
        400,
        'IPC_ALLOCATION_AMOUNT_EXCEEDED',
        'IPC cumulative certification cannot exceed the approved allocation amount',
      );
    }
  }

  const updatedItem = await prisma.$transaction(async (tx) => {
    const item = await tx.ipcItem.update({
      where: { id: itemId },
      data: {
        qty,
        rate,
        retentionRate,
        currentCert,
        retention,
        netPayable,
        cumulativeCert,
        status: payload.status || existing.status,
        certDate:
          payload.certDate !== undefined
            ? payload.certDate
              ? new Date(payload.certDate)
              : null
            : existing.certDate,
      },
      include: {
        boqItem: {
          select: {
            id: true,
            code: true,
            ref: true,
            description: true,
            unit: true,
            qty: true,
            rate: true,
          },
        },
        allocation: {
          select: {
            id: true,
            quantity: true,
            amount: true,
            weight: true,
            activity: {
              select: {
                id: true,
                name: true,
                p6ActivityId: true,
                wbsCode: true,
              },
            },
          },
        },
      },
    });

    await recomputeCertificateTotals(tx, certificate.id);
    return item;
  });

  return updatedItem;
};

const submitIpcPeriod = async ({ orgId, projectId, period, userId }) => {
  await ensureProject({ orgId, projectId });

  const certificate = await prisma.ipcCertificate.findFirst({
    where: { projectId, period },
  });
  if (!certificate) {
    throw new HttpError(404, 'IPC_PERIOD_NOT_FOUND', 'IPC period not found');
  }

  return prisma.$transaction(async (tx) => {
    await tx.ipcItem.updateMany({
      where: { projectId, ipcPeriod: period },
      data: { status: 'submitted' },
    });

    return tx.ipcCertificate.update({
      where: { id: certificate.id },
      data: {
        status: 'submitted',
        issueDate: new Date(),
        submittedBy: userId || null,
      },
    });
  });
};

const certifyIpcPeriod = async ({ orgId, projectId, period }) => {
  await ensureProject({ orgId, projectId });

  const certificate = await prisma.ipcCertificate.findFirst({
    where: { projectId, period },
  });
  if (!certificate) {
    throw new HttpError(404, 'IPC_PERIOD_NOT_FOUND', 'IPC period not found');
  }

  return prisma.$transaction(async (tx) => {
    await tx.ipcItem.updateMany({
      where: { projectId, ipcPeriod: period },
      data: { status: 'certified', certDate: new Date() },
    });

    return tx.ipcCertificate.update({
      where: { id: certificate.id },
      data: { status: 'certified' },
    });
  });
};

module.exports = {
  listIpcCertificates,
  createIpcPeriod,
  getIpcPeriod,
  updateIpcItem,
  submitIpcPeriod,
  certifyIpcPeriod,
};
