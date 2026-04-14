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
              ref: true,
              description: true,
              unit: true,
              qty: true,
              rate: true,
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

  const boqItems = await prisma.boqItem.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  const previousItems = await prisma.ipcItem.findMany({
    where: { projectId },
    select: { boqItemId: true, currentCert: true },
  });

  const previousCertMap = new Map();
  for (const item of previousItems) {
    const current = previousCertMap.get(item.boqItemId) || 0;
    previousCertMap.set(
      item.boqItemId,
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

    if (boqItems.length > 0) {
      await tx.ipcItem.createMany({
        data: boqItems.map((boqItem) => ({
          projectId,
          boqItemId: boqItem.id,
          ipcCertificateId: created.id,
          ipcPeriod: resolvedPeriod,
          qty: 0,
          rate: Number(boqItem.rate) || 0,
          previousCert: previousCertMap.get(boqItem.id) || 0,
          currentCert: 0,
          cumulativeCert: previousCertMap.get(boqItem.id) || 0,
          retentionRate: 5,
          retention: 0,
          netPayable: 0,
          status: 'draft',
        })),
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
            ref: true,
            description: true,
            unit: true,
            qty: true,
            rate: true,
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
