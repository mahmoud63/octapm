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

const listLongLeadItems = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  return prisma.longLeadItem.findMany({
    where: { projectId },
    include: {
      activity: {
        select: { id: true, name: true, wbsCode: true },
      },
    },
    orderBy: [{ leadWeeks: 'desc' }, { createdAt: 'asc' }],
  });
};

const createLongLeadItem = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });

  return prisma.longLeadItem.create({
    data: {
      projectId,
      activityId: payload.activityId || null,
      item: payload.item,
      leadWeeks: Number(payload.leadWeeks) || 0,
      orderBy: payload.orderBy?.trim() || null,
      criticality: payload.criticality?.trim() || null,
      risk: payload.risk?.trim() || null,
      status: payload.status || 'not_ordered',
      supplier: payload.supplier?.trim() || null,
    },
    include: {
      activity: {
        select: { id: true, name: true, wbsCode: true },
      },
    },
  });
};

const updateLongLeadItem = async ({ orgId, projectId, itemId, payload }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.longLeadItem.findFirst({
    where: { id: itemId, projectId },
  });
  if (!existing) {
    throw new HttpError(404, 'LONG_LEAD_NOT_FOUND', 'Long lead item not found');
  }

  const data = {};
  if (payload.item !== undefined) data.item = payload.item;
  if (payload.activityId !== undefined)
    data.activityId = payload.activityId || null;
  if (payload.leadWeeks !== undefined)
    data.leadWeeks = Number(payload.leadWeeks) || 0;
  if (payload.orderBy !== undefined)
    data.orderBy = payload.orderBy?.trim() || null;
  if (payload.criticality !== undefined) {
    data.criticality = payload.criticality?.trim() || null;
  }
  if (payload.risk !== undefined) data.risk = payload.risk?.trim() || null;
  if (payload.status !== undefined) data.status = payload.status;
  if (payload.supplier !== undefined)
    data.supplier = payload.supplier?.trim() || null;

  return prisma.longLeadItem.update({
    where: { id: itemId },
    data,
    include: {
      activity: {
        select: { id: true, name: true, wbsCode: true },
      },
    },
  });
};

const deleteLongLeadItem = async ({ orgId, projectId, itemId }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.longLeadItem.findFirst({
    where: { id: itemId, projectId },
  });
  if (!existing) {
    throw new HttpError(404, 'LONG_LEAD_NOT_FOUND', 'Long lead item not found');
  }

  await prisma.longLeadItem.delete({ where: { id: itemId } });
  return { deleted: true };
};

module.exports = {
  listLongLeadItems,
  createLongLeadItem,
  updateLongLeadItem,
  deleteLongLeadItem,
};
