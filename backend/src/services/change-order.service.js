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

const listChangeOrders = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const orders = await prisma.changeOrder.findMany({
    where: { projectId },
    include: {
      activity: { select: { id: true, name: true, wbsCode: true } },
    },
    orderBy: [{ submittedDate: 'desc' }, { updatedAt: 'desc' }],
  });

  const summary = orders.reduce(
    (acc, order) => {
      const value = Number(order.value) || 0;
      if (order.status === 'approved') {
        acc.totalApproved += value;
        acc.approvedCount += 1;
        acc.totalScheduleImpact += Number(order.scheduleImpact) || 0;
      } else if (order.status === 'pending') {
        acc.totalPending += value;
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

  return { orders, summary };
};

const createChangeOrder = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });

  const count = await prisma.changeOrder.count({ where: { projectId } });
  const ref = `VO-${String(count + 1).padStart(2, '0')}`;

  return prisma.changeOrder.create({
    data: {
      projectId,
      activityId: payload.activityId || null,
      ref,
      description: payload.description,
      category: payload.category?.trim() || null,
      value: Number(payload.value) || 0,
      status: payload.status || 'pending',
      scheduleImpact: Number(payload.scheduleImpact) || 0,
      submittedDate: payload.submittedDate
        ? new Date(payload.submittedDate)
        : new Date(),
      raisedBy: payload.raisedBy?.trim() || null,
      rejectedReason: payload.rejectedReason?.trim() || null,
      approvedDate:
        payload.status === 'approved'
          ? payload.approvedDate
            ? new Date(payload.approvedDate)
            : new Date()
          : null,
    },
    include: {
      activity: { select: { id: true, name: true, wbsCode: true } },
    },
  });
};

const updateChangeOrder = async ({ orgId, projectId, coId, payload }) => {
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
  if (payload.description !== undefined) data.description = payload.description;
  if (payload.category !== undefined)
    data.category = payload.category?.trim() || null;
  if (payload.value !== undefined) data.value = Number(payload.value) || 0;
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
    data.rejectedReason = payload.rejectedReason?.trim() || null;
  }
  if (payload.status !== undefined) data.status = payload.status;

  if (nextStatus === 'approved' && existing.status !== 'approved') {
    data.approvedDate = new Date();
  }

  return prisma.changeOrder.update({
    where: { id: coId },
    data,
    include: {
      activity: { select: { id: true, name: true, wbsCode: true } },
    },
  });
};

const deleteChangeOrder = async ({ orgId, projectId, coId }) => {
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

  await prisma.changeOrder.delete({ where: { id: coId } });
  return { deleted: true };
};

module.exports = {
  listChangeOrders,
  createChangeOrder,
  updateChangeOrder,
  deleteChangeOrder,
};
