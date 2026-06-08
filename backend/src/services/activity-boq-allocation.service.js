const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');

const ACTIVE_STATUSES = ['draft', 'submitted', 'approved'];
const VALID_SOURCES = ['manual', 'import', 'ai', 'migration'];
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
    return toNumber(amount);
  }

  return toNumber(quantity) * toNumber(boqItem.rate);
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
  { boqItemId, excludeAllocationId = null },
  tx = prisma,
) => {
  const allocations = await tx.activityBoqAllocation.findMany({
    where: {
      boqItemId,
      isActive: true,
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
      acc.amount += toNumber(allocation.amount);
      return acc;
    },
    { quantity: 0, amount: 0 },
  );
};

const assertAllocationCapacity = ({
  boqItem,
  existingTotals,
  nextQuantity,
  nextAmount,
}) => {
  const totalQuantity = existingTotals.quantity + toNumber(nextQuantity);
  const totalAmount = existingTotals.amount + toNumber(nextAmount);

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
    throw new HttpError(
      400,
      'DUPLICATE_ACTIVE_ALLOCATION',
      'An active allocation already exists for this BOQ item and activity',
    );
  }
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
        activityId:
          allocation.activity.p6ActivityId ||
          allocation.activity.wbsCode ||
          allocation.activity.id,
        name: allocation.activity.name,
        wbsCode: allocation.activity.wbsCode,
        category: allocation.activity.category,
        sortOrder: allocation.activity.sortOrder,
      }
    : null,
});

const buildAllocationSummary = async ({ projectId }, tx = prisma) => {
  const [boqItems, allocations] = await Promise.all([
    tx.boqItem.findMany({
      where: { projectId },
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
      where: { projectId, isActive: true },
      select: {
        boqItemId: true,
        quantity: true,
        amount: true,
        status: true,
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
    };

    const quantity = toNumber(allocation.quantity);
    const amount = toNumber(allocation.amount);
    current.activeQuantity += quantity;
    current.activeAmount += amount;

    if (allocation.status === 'approved') {
      current.approvedQuantity += quantity;
      current.approvedAmount += amount;
    } else if (ACTIVE_STATUSES.includes(allocation.status)) {
      current.pendingAmount += amount;
    }

    byBoqItem.set(allocation.boqItemId, current);
  }

  const items = boqItems.map((item) => {
    const totals = byBoqItem.get(item.id) || {
      activeQuantity: 0,
      activeAmount: 0,
      approvedQuantity: 0,
      approvedAmount: 0,
      pendingAmount: 0,
    };

    return {
      boqItemId: item.id,
      code: item.code || item.ref || '',
      description: item.description,
      quantity: toNumber(item.qty),
      amount: toNumber(item.amount),
      activeAllocatedQuantity: totals.activeQuantity,
      activeAllocatedAmount: totals.activeAmount,
      approvedAllocatedQuantity: totals.approvedQuantity,
      approvedAllocatedAmount: totals.approvedAmount,
      pendingAllocatedAmount: totals.pendingAmount,
      unallocatedQuantity: Math.max(
        0,
        toNumber(item.qty) - totals.approvedQuantity,
      ),
      unallocatedAmount: Math.max(
        0,
        toNumber(item.amount) - totals.approvedAmount,
      ),
    };
  });

  return items.reduce(
    (acc, item) => {
      acc.totalBoqQuantity += item.quantity;
      acc.totalBoqAmount += item.amount;
      acc.activeAllocatedQuantity += item.activeAllocatedQuantity;
      acc.activeAllocatedAmount += item.activeAllocatedAmount;
      acc.approvedAllocatedQuantity += item.approvedAllocatedQuantity;
      acc.approvedAllocatedAmount += item.approvedAllocatedAmount;
      acc.pendingAllocatedAmount += item.pendingAllocatedAmount;
      acc.unallocatedQuantity += item.unallocatedQuantity;
      acc.unallocatedAmount += item.unallocatedAmount;
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

    const allocation = await tx.activityBoqAllocation.create({
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

    const updated = await tx.activityBoqAllocation.update({
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

    return mapAllocation(updated);
  });

const approveAllocation = async ({ orgId, projectId, allocationId, userId }) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await ensureAllocation({ projectId, allocationId }, tx);

    if (!['draft', 'submitted'].includes(existing.status)) {
      throw new HttpError(
        400,
        'INVALID_ALLOCATION_STATUS',
        'Only draft or submitted allocations can be approved',
      );
    }

    const boqItem = await ensureBoqItem(
      { projectId, boqItemId: existing.boqItemId },
      tx,
    );
    const existingTotals = await getActiveTotalsForBoqItem(
      { boqItemId: existing.boqItemId, excludeAllocationId: allocationId },
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

    if (!['draft', 'submitted'].includes(existing.status)) {
      throw new HttpError(
        400,
        'INVALID_ALLOCATION_STATUS',
        'Only draft or submitted allocations can be rejected',
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

    return mapAllocation(updated);
  });

const getApprovedActivityAllocationTotals = async ({ projectId }, tx = prisma) => {
  const rows = await tx.activityBoqAllocation.findMany({
    where: { projectId, status: 'approved', isActive: true },
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
    current.amount += toNumber(row.amount);
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
