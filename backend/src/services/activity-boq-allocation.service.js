const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  addMoney,
  multiplyMoney,
  subtractMoney,
  toMoneyNumber,
} = require('../utils/money');
const approvalWorkflowService = require('./approval-workflow.service');

const ACTIVE_STATUSES = ['draft', 'submitted', 'approved'];
const CERTIFIED_IPC_STATUSES = ['certified', 'paid'];
const VALID_SOURCES = ['manual', 'import', 'ai', 'migration'];
const APPROVED_STATUS = 'approved';
const EPSILON = 0.000001;
const MONEY_EPSILON = 0.01;

const ensureProject = async ({ orgId, projectId }, tx = prisma) => {
  const project = await tx.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
};

const ensureBoqItem = async ({ projectId, boqItemId }, tx = prisma) => {
  const boqItem = await tx.boqItem.findFirst({
    where: { id: boqItemId, projectId },
  });

  if (!boqItem) {
    throw new HttpError(404, 'BOQ_ITEM_NOT_FOUND', 'BOQ item not found');
  }

  return boqItem;
};

const ensureActivity = async ({ projectId, activityId }, tx = prisma) => {
  const activity = await tx.activity.findFirst({
    where: { id: activityId, projectId },
  });

  if (!activity) {
    throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found');
  }

  return activity;
};

const ensureAllocation = async ({ projectId, allocationId }, tx = prisma) => {
  const allocation = await tx.activityBoqAllocation.findFirst({
    where: { id: allocationId, projectId },
    include: allocationInclude,
  });

  if (!allocation) {
    throw new HttpError(
      404,
      'ALLOCATION_NOT_FOUND',
      'Activity BOQ allocation not found',
    );
  }

  return allocation;
};

const allocationInclude = {
  boqItem: {
    select: {
      id: true,
      code: true,
      ref: true,
      description: true,
      unit: true,
      qty: true,
      rate: true,
      amount: true,
      sortOrder: true,
    },
  },
  activity: {
    select: {
      id: true,
      name: true,
      activityCode: true,
      p6ActivityId: true,
      wbsCode: true,
      category: true,
      sortOrder: true,
    },
  },
};

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const computeDefaultAmount = ({ quantity, amount, boqItem }) => {
  if (amount !== undefined && amount !== null && amount !== '') {
    return toMoneyNumber(amount);
  }

  return multiplyMoney(quantity, boqItem.rate);
};

const computeDefaultWeight = ({ weight, amount, boqItem }) => {
  if (weight !== undefined && weight !== null && weight !== '') {
    return toNumber(weight);
  }

  const boqAmount = toNumber(boqItem.amount);
  if (boqAmount <= 0) return 0;
  return (toNumber(amount) / boqAmount) * 100;
};

const getActiveTotalsForBoqItem = async (
  { boqItemId, excludeAllocationId = null, statuses = null },
  tx = prisma,
) => {
  const allocations = await tx.activityBoqAllocation.findMany({
    where: {
      boqItemId,
      isActive: true,
      status: Array.isArray(statuses) ? { in: statuses } : undefined,
      id: excludeAllocationId ? { not: excludeAllocationId } : undefined,
    },
    select: {
      quantity: true,
      amount: true,
    },
  });

  return allocations.reduce(
    (acc, allocation) => {
      acc.quantity += toNumber(allocation.quantity);
      acc.amount = addMoney(acc.amount, allocation.amount);
      return acc;
    },
    { quantity: 0, amount: 0 },
  );
};

const duplicateActiveAllocationError = () =>
  new HttpError(
    400,
    'DUPLICATE_ACTIVE_ALLOCATION',
    'An active allocation already exists for this BOQ item and activity',
  );

const assertAllocationCapacity = ({
  boqItem,
  existingTotals,
  nextQuantity,
  nextAmount,
}) => {
  const totalQuantity = existingTotals.quantity + toNumber(nextQuantity);
  const totalAmount = addMoney(existingTotals.amount, nextAmount);

  if (totalQuantity > toNumber(boqItem.qty) + EPSILON) {
    throw new HttpError(
      400,
      'ALLOCATION_QUANTITY_EXCEEDED',
      'Allocation totals cannot exceed the BOQ item quantity',
      {
        boqItemId: boqItem.id,
        boqQuantity: toNumber(boqItem.qty),
        allocatedQuantity: totalQuantity,
      },
    );
  }

  if (totalAmount > toNumber(boqItem.amount) + MONEY_EPSILON) {
    throw new HttpError(
      400,
      'ALLOCATION_AMOUNT_EXCEEDED',
      'Allocation totals cannot exceed the BOQ item amount',
      {
        boqItemId: boqItem.id,
        boqAmount: toNumber(boqItem.amount),
        allocatedAmount: totalAmount,
      },
    );
  }
};

const assertNoDuplicateActiveAllocation = async (
  { projectId, boqItemId, activityId, excludeAllocationId = null },
  tx = prisma,
) => {
  const duplicate = await tx.activityBoqAllocation.findFirst({
    where: {
      projectId,
      boqItemId,
      activityId,
      isActive: true,
      id: excludeAllocationId ? { not: excludeAllocationId } : undefined,
    },
  });

  if (duplicate) {
    throw duplicateActiveAllocationError();
  }
};

const handleAllocationWriteError = (error) => {
  if (error?.code !== 'P2002') throw error;

  const target = Array.isArray(error.meta?.target)
    ? error.meta.target
    : [String(error.meta?.target || '')];
  const targetText = target.join(' ').toLowerCase();
  const isActivePair =
    targetText.includes('activityboqallocation_active_pair_key') ||
    (targetText.includes('projectid') &&
      targetText.includes('boqitemid') &&
      targetText.includes('activityid'));

  if (isActivePair) {
    throw duplicateActiveAllocationError();
  }

  throw error;
};

const mapAllocation = (allocation) => ({
  id: allocation.id,
  projectId: allocation.projectId,
  boqItemId: allocation.boqItemId,
  activityId: allocation.activityId,
  quantity: allocation.quantity,
  amount: allocation.amount,
  weight: allocation.weight,
  source: allocation.source,
  status: allocation.status,
  isActive: allocation.isActive,
  notes: allocation.notes,
  submittedBy: allocation.submittedBy,
  submittedAt: allocation.submittedAt,
  approvedBy: allocation.approvedBy,
  approvedAt: allocation.approvedAt,
  rejectedBy: allocation.rejectedBy,
  rejectedAt: allocation.rejectedAt,
  rejectedReason: allocation.rejectedReason,
  createdBy: allocation.createdBy,
  updatedBy: allocation.updatedBy,
  createdAt: allocation.createdAt,
  updatedAt: allocation.updatedAt,
  boqItem: allocation.boqItem
    ? {
        id: allocation.boqItem.id,
        code: allocation.boqItem.code || allocation.boqItem.ref || '',
        description: allocation.boqItem.description,
        unit: allocation.boqItem.unit,
        quantity: allocation.boqItem.qty,
        rate: allocation.boqItem.rate,
        amount: allocation.boqItem.amount,
        sortOrder: allocation.boqItem.sortOrder,
      }
    : null,
  activity: allocation.activity
    ? {
        id: allocation.activity.id,
        // A single label to show, and the two identifiers behind it kept
        // apart: an imported activity has only a P6 id, one we created has
        // only an activityCode, and a reader reconciling a bill against a
        // programme needs to know which of the two they are holding.
        activityId:
          allocation.activity.activityCode ||
          allocation.activity.p6ActivityId ||
          allocation.activity.id,
        activityCode: allocation.activity.activityCode,
        p6ActivityId: allocation.activity.p6ActivityId ?? null,
        name: allocation.activity.name,
        wbsCode: allocation.activity.wbsCode,
        category: allocation.activity.category,
        sortOrder: allocation.activity.sortOrder,
      }
    : null,
});

const buildAllocationSummary = async ({ projectId }, tx = prisma) => {
  const [boqItems, allocations, certifiedItems] = await Promise.all([
    tx.boqItem.findMany({
      where: { projectId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        code: true,
        ref: true,
        description: true,
        qty: true,
        amount: true,
      },
    }),
    tx.activityBoqAllocation.findMany({
      where: {
        projectId,
        isActive: true,
        activity: { isActive: true },
      },
      select: {
        boqItemId: true,
        quantity: true,
        amount: true,
        status: true,
        activity: {
          select: {
            progress: {
              where: { status: 'approved' },
              orderBy: { updatedAt: 'desc' },
              take: 1,
              select: { pctComplete: true },
            },
          },
        },
      },
    }),
    tx.ipcItem.findMany({
      where: {
        projectId,
        allocationId: { not: null },
        status: { in: CERTIFIED_IPC_STATUSES },
        allocation: {
          is: {
            status: 'approved',
            isActive: true,
          },
        },
      },
      select: {
        boqItemId: true,
        currentCert: true,
      },
    }),
  ]);

  const byBoqItem = new Map();
  for (const allocation of allocations) {
    const current = byBoqItem.get(allocation.boqItemId) || {
      activeQuantity: 0,
      activeAmount: 0,
      approvedQuantity: 0,
      approvedAmount: 0,
      pendingAmount: 0,
      earnedValue: 0,
    };

    const quantity = toNumber(allocation.quantity);
    const amount = toMoneyNumber(allocation.amount);
    current.activeQuantity += quantity;
    current.activeAmount = addMoney(current.activeAmount, amount);

    if (allocation.status === 'approved') {
      current.approvedQuantity += quantity;
      current.approvedAmount = addMoney(current.approvedAmount, amount);
      const pctComplete = toNumber(
        allocation.activity?.progress?.[0]?.pctComplete,
      );
      current.earnedValue = addMoney(
        current.earnedValue,
        multiplyMoney(amount, Math.min(100, Math.max(0, pctComplete)) / 100),
      );
    } else if (ACTIVE_STATUSES.includes(allocation.status)) {
      current.pendingAmount = addMoney(current.pendingAmount, amount);
    }

    byBoqItem.set(allocation.boqItemId, current);
  }

  const certifiedByBoqItem = certifiedItems.reduce((map, item) => {
    const current = map.get(item.boqItemId) || 0;
    map.set(item.boqItemId, addMoney(current, item.currentCert));
    return map;
  }, new Map());

  const items = boqItems.map((item) => {
    const totals = byBoqItem.get(item.id) || {
      activeQuantity: 0,
      activeAmount: 0,
      approvedQuantity: 0,
      approvedAmount: 0,
      pendingAmount: 0,
      earnedValue: 0,
    };
    const quantity = toNumber(item.qty);
    const amount = toMoneyNumber(item.amount);
    const unscheduledQuantity = Math.max(0, quantity - totals.approvedQuantity);
    const unscheduledValue = Math.max(
      0,
      subtractMoney(amount, totals.approvedAmount),
    );

    return {
      boqItemId: item.id,
      code: item.code || item.ref || '',
      description: item.description,
      quantity,
      amount,
      activeAllocatedQuantity: totals.activeQuantity,
      activeAllocatedAmount: totals.activeAmount,
      approvedAllocatedQuantity: totals.approvedQuantity,
      approvedAllocatedAmount: totals.approvedAmount,
      pendingAllocatedAmount: totals.pendingAmount,
      scheduledQuantity: totals.approvedQuantity,
      scheduledValue: totals.approvedAmount,
      unscheduledQuantity,
      unscheduledValue,
      earnedValue: totals.earnedValue,
      certifiedValue: certifiedByBoqItem.get(item.id) || 0,
      unallocatedQuantity: unscheduledQuantity,
      unallocatedAmount: unscheduledValue,
    };
  });

  return items.reduce(
    (acc, item) => {
      acc.totalBoqQuantity += item.quantity;
      acc.totalBoqAmount = addMoney(acc.totalBoqAmount, item.amount);
      acc.activeAllocatedQuantity += item.activeAllocatedQuantity;
      acc.activeAllocatedAmount = addMoney(
        acc.activeAllocatedAmount,
        item.activeAllocatedAmount,
      );
      acc.approvedAllocatedQuantity += item.approvedAllocatedQuantity;
      acc.approvedAllocatedAmount = addMoney(
        acc.approvedAllocatedAmount,
        item.approvedAllocatedAmount,
      );
      acc.pendingAllocatedAmount = addMoney(
        acc.pendingAllocatedAmount,
        item.pendingAllocatedAmount,
      );
      acc.scheduledQuantity += item.scheduledQuantity;
      acc.scheduledValue = addMoney(acc.scheduledValue, item.scheduledValue);
      acc.unscheduledQuantity += item.unscheduledQuantity;
      acc.unscheduledValue = addMoney(
        acc.unscheduledValue,
        item.unscheduledValue,
      );
      acc.earnedValue = addMoney(acc.earnedValue, item.earnedValue);
      acc.certifiedValue = addMoney(acc.certifiedValue, item.certifiedValue);
      acc.unallocatedQuantity += item.unallocatedQuantity;
      acc.unallocatedAmount = addMoney(
        acc.unallocatedAmount,
        item.unallocatedAmount,
      );
      acc.items.push(item);
      return acc;
    },
    {
      totalBoqQuantity: 0,
      totalBoqAmount: 0,
      activeAllocatedQuantity: 0,
      activeAllocatedAmount: 0,
      approvedAllocatedQuantity: 0,
      approvedAllocatedAmount: 0,
      pendingAllocatedAmount: 0,
      scheduledQuantity: 0,
      scheduledValue: 0,
      unscheduledQuantity: 0,
      unscheduledValue: 0,
      earnedValue: 0,
      certifiedValue: 0,
      unallocatedQuantity: 0,
      unallocatedAmount: 0,
      items: [],
    },
  );
};

const listAllocations = async ({
  orgId,
  projectId,
  status,
  boqItemId,
  activityId,
  includeInactive = false,
}) => {
  await ensureProject({ orgId, projectId });

  const where = {
    projectId,
    status: status || undefined,
    boqItemId: boqItemId || undefined,
    activityId: activityId || undefined,
    isActive: includeInactive ? undefined : true,
  };

  const [allocations, summary] = await Promise.all([
    prisma.activityBoqAllocation.findMany({
      where,
      include: allocationInclude,
      orderBy: [
        { boqItem: { sortOrder: 'asc' } },
        { activity: { sortOrder: 'asc' } },
        { createdAt: 'asc' },
      ],
    }),
    buildAllocationSummary({ projectId }),
  ]);

  return {
    allocations: allocations.map(mapAllocation),
    summary,
  };
};

const createAllocation = async ({ orgId, projectId, userId, payload }) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const boqItem = await ensureBoqItem(
      { projectId, boqItemId: payload.boqItemId },
      tx,
    );
    await ensureActivity({ projectId, activityId: payload.activityId }, tx);

    await assertNoDuplicateActiveAllocation(
      {
        projectId,
        boqItemId: payload.boqItemId,
        activityId: payload.activityId,
      },
      tx,
    );

    const quantity = toNumber(payload.quantity);
    const amount = computeDefaultAmount({
      quantity,
      amount: payload.amount,
      boqItem,
    });
    const weight = computeDefaultWeight({
      weight: payload.weight,
      amount,
      boqItem,
    });
    const source = payload.source || 'manual';

    if (quantity <= 0 || amount <= 0) {
      throw new HttpError(
        400,
        'INVALID_ALLOCATION_VALUES',
        'Allocation quantity and amount must be greater than zero',
      );
    }

    if (!VALID_SOURCES.includes(source)) {
      throw new HttpError(
        400,
        'INVALID_ALLOCATION_SOURCE',
        'Allocation source is invalid',
      );
    }

    const existingTotals = await getActiveTotalsForBoqItem(
      { boqItemId: payload.boqItemId },
      tx,
    );
    assertAllocationCapacity({
      boqItem,
      existingTotals,
      nextQuantity: quantity,
      nextAmount: amount,
    });

    let allocation;
    try {
      allocation = await tx.activityBoqAllocation.create({
        data: {
          projectId,
          boqItemId: payload.boqItemId,
          activityId: payload.activityId,
          quantity,
          amount,
          weight,
          source,
          status: 'draft',
          notes: payload.notes?.trim() || null,
          createdBy: userId || null,
          updatedBy: userId || null,
        },
        include: allocationInclude,
      });
    } catch (error) {
      handleAllocationWriteError(error);
    }

    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.BOQ_ALLOCATION,
      recordId: allocation.id,
      fromStatus: null,
      toStatus: allocation.status,
      actorId: userId,
      metadata: {
        boqItemId: allocation.boqItemId,
        activityId: allocation.activityId,
        quantity,
        amount,
      },
    });

    return mapAllocation(allocation);
  });

const updateAllocation = async ({
  orgId,
  projectId,
  allocationId,
  userId,
  payload,
}) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await ensureAllocation({ projectId, allocationId }, tx);

    if (existing.status !== 'draft') {
      throw new HttpError(
        400,
        'ALLOCATION_NOT_EDITABLE',
        'Only draft allocations can be edited',
      );
    }

    const nextBoqItemId = payload.boqItemId || existing.boqItemId;
    const nextActivityId = payload.activityId || existing.activityId;
    const boqItem = await ensureBoqItem(
      { projectId, boqItemId: nextBoqItemId },
      tx,
    );
    await ensureActivity({ projectId, activityId: nextActivityId }, tx);

    await assertNoDuplicateActiveAllocation(
      {
        projectId,
        boqItemId: nextBoqItemId,
        activityId: nextActivityId,
        excludeAllocationId: allocationId,
      },
      tx,
    );

    const quantity =
      payload.quantity !== undefined
        ? toNumber(payload.quantity)
        : toNumber(existing.quantity);
    const amount =
      payload.amount !== undefined ||
      payload.quantity !== undefined ||
      payload.boqItemId !== undefined
        ? computeDefaultAmount({
            quantity,
            amount: payload.amount,
            boqItem,
          })
        : toNumber(existing.amount);
    const weight =
      payload.weight !== undefined ||
      payload.amount !== undefined ||
      payload.quantity !== undefined ||
      payload.boqItemId !== undefined
        ? computeDefaultWeight({
            weight: payload.weight,
            amount,
            boqItem,
          })
        : toNumber(existing.weight);

    if (quantity <= 0 || amount <= 0) {
      throw new HttpError(
        400,
        'INVALID_ALLOCATION_VALUES',
        'Allocation quantity and amount must be greater than zero',
      );
    }

    if (payload.source && !VALID_SOURCES.includes(payload.source)) {
      throw new HttpError(
        400,
        'INVALID_ALLOCATION_SOURCE',
        'Allocation source is invalid',
      );
    }

    const existingTotals = await getActiveTotalsForBoqItem(
      { boqItemId: nextBoqItemId, excludeAllocationId: allocationId },
      tx,
    );
    assertAllocationCapacity({
      boqItem,
      existingTotals,
      nextQuantity: quantity,
      nextAmount: amount,
    });

    let updated;
    try {
      updated = await tx.activityBoqAllocation.update({
        where: { id: allocationId },
        data: {
          boqItemId: nextBoqItemId,
          activityId: nextActivityId,
          quantity,
          amount,
          weight,
          source: payload.source || existing.source,
          notes:
            payload.notes !== undefined
              ? payload.notes?.trim() || null
              : existing.notes,
          updatedBy: userId || null,
        },
        include: allocationInclude,
      });
    } catch (error) {
      handleAllocationWriteError(error);
    }

    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.BOQ_ALLOCATION,
      recordId: allocationId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      metadata: {
        boqItemId: existing.boqItemId,
        activityId: existing.activityId,
        quantity: existing.quantity,
        amount: existing.amount,
      },
    });

    return mapAllocation(updated);
  });

const submitAllocation = async ({ orgId, projectId, allocationId, userId }) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await ensureAllocation({ projectId, allocationId }, tx);

    if (existing.status !== 'draft') {
      throw new HttpError(
        400,
        'INVALID_ALLOCATION_STATUS',
        'Only draft allocations can be submitted',
      );
    }

    await assertNoDuplicateActiveAllocation(
      {
        projectId,
        boqItemId: existing.boqItemId,
        activityId: existing.activityId,
        excludeAllocationId: allocationId,
      },
      tx,
    );

    const updated = await tx.activityBoqAllocation.update({
      where: { id: allocationId },
      data: {
        status: 'submitted',
        submittedBy: userId || null,
        submittedAt: new Date(),
        updatedBy: userId || null,
      },
      include: allocationInclude,
    });

    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.BOQ_ALLOCATION,
      recordId: allocationId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      metadata: {
        boqItemId: existing.boqItemId,
        activityId: existing.activityId,
        quantity: existing.quantity,
        amount: existing.amount,
      },
    });

    return mapAllocation(updated);
  });

const approveAllocation = async ({ orgId, projectId, allocationId, userId }) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await ensureAllocation({ projectId, allocationId }, tx);

    if (existing.status !== 'submitted') {
      throw new HttpError(
        400,
        'INVALID_ALLOCATION_STATUS',
        'Only submitted allocations can be approved',
      );
    }

    await assertNoDuplicateActiveAllocation(
      {
        projectId,
        boqItemId: existing.boqItemId,
        activityId: existing.activityId,
        excludeAllocationId: allocationId,
      },
      tx,
    );

    const boqItem = await ensureBoqItem(
      { projectId, boqItemId: existing.boqItemId },
      tx,
    );
    const existingTotals = await getActiveTotalsForBoqItem(
      {
        boqItemId: existing.boqItemId,
        excludeAllocationId: allocationId,
        statuses: [APPROVED_STATUS],
      },
      tx,
    );
    assertAllocationCapacity({
      boqItem,
      existingTotals,
      nextQuantity: existing.quantity,
      nextAmount: existing.amount,
    });

    const updated = await tx.activityBoqAllocation.update({
      where: { id: allocationId },
      data: {
        status: 'approved',
        isActive: true,
        approvedBy: userId || null,
        approvedAt: new Date(),
        rejectedBy: null,
        rejectedAt: null,
        rejectedReason: null,
        updatedBy: userId || null,
      },
      include: allocationInclude,
    });

    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.BOQ_ALLOCATION,
      recordId: allocationId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      metadata: {
        boqItemId: existing.boqItemId,
        activityId: existing.activityId,
        quantity: existing.quantity,
        amount: existing.amount,
      },
    });

    return mapAllocation(updated);
  });

const rejectAllocation = async ({
  orgId,
  projectId,
  allocationId,
  userId,
  reason,
}) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await ensureAllocation({ projectId, allocationId }, tx);

    if (existing.status !== 'submitted') {
      throw new HttpError(
        400,
        'INVALID_ALLOCATION_STATUS',
        'Only submitted allocations can be rejected',
      );
    }

    if (!String(reason || '').trim()) {
      throw new HttpError(
        400,
        'REJECT_REASON_REQUIRED',
        'A rejection reason is required',
      );
    }

    const updated = await tx.activityBoqAllocation.update({
      where: { id: allocationId },
      data: {
        status: 'rejected',
        isActive: false,
        rejectedBy: userId || null,
        rejectedAt: new Date(),
        rejectedReason: String(reason).trim(),
        updatedBy: userId || null,
      },
      include: allocationInclude,
    });

    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.BOQ_ALLOCATION,
      recordId: allocationId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      reason: String(reason).trim(),
      metadata: {
        boqItemId: existing.boqItemId,
        activityId: existing.activityId,
        quantity: existing.quantity,
        amount: existing.amount,
      },
    });

    return mapAllocation(updated);
  });

const getApprovedActivityAllocationTotals = async (
  { projectId, activityIds = null },
  tx = prisma,
) => {
  if (Array.isArray(activityIds) && activityIds.length === 0) {
    return new Map();
  }

  const where = {
    projectId,
    status: 'approved',
    isActive: true,
    activity: { isActive: true },
  };

  if (Array.isArray(activityIds)) {
    where.activityId = { in: activityIds };
  }

  const rows = await tx.activityBoqAllocation.findMany({
    where,
    select: {
      activityId: true,
      quantity: true,
      amount: true,
      weight: true,
    },
  });

  return rows.reduce((map, row) => {
    const current = map.get(row.activityId) || {
      quantity: 0,
      amount: 0,
      weight: 0,
      count: 0,
    };

    current.quantity += toNumber(row.quantity);
    current.amount = addMoney(current.amount, row.amount);
    current.weight += toNumber(row.weight);
    current.count += 1;
    map.set(row.activityId, current);
    return map;
  }, new Map());
};

module.exports = {
  listAllocations,
  createAllocation,
  updateAllocation,
  submitAllocation,
  approveAllocation,
  rejectAllocation,
  buildAllocationSummary,
  getApprovedActivityAllocationTotals,
  assertAllocationCapacity,
  computeDefaultAmount,
  computeDefaultWeight,
};
