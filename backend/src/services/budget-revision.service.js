const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { addMoney, subtractMoney, toMoneyNumber } = require('../utils/money');
const { nextRef } = require("../utils/reference-number");

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
};

const computeDelta = (changeType, amount) => {
  const value = toMoneyNumber(amount);
  return changeType === 'deduction' ? subtractMoney(0, value) : value;
};

const recomputeCumulative = async ({ projectId, baseBudget }) => {
  const rows = await prisma.budgetRevision.findMany({
    where: { projectId, status: 'approved' },
    orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
  });

  let running = toMoneyNumber(baseBudget);

  for (const row of rows) {
    running = addMoney(running, computeDelta(row.changeType, row.amount));
    await prisma.budgetRevision.update({
      where: { id: row.id },
      data: { cumulativeBudget: running },
    });
  }
};

const listBudgetRevisions = async ({ orgId, projectId }) => {
  const project = await ensureProject({ orgId, projectId });

  const rows = await prisma.budgetRevision.findMany({
    where: { projectId },
    orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
  });

  const approvedRows = rows.filter((row) => row.status === 'approved');
  const netChange = approvedRows.reduce((sum, row) => {
    return sum + computeDelta(row.changeType, row.amount);
  }, 0);

  const currentBudget = addMoney(project.contractValue, netChange);

  const waterfall = approvedRows
    .slice()
    .reverse()
    .reduce(
      (acc, row) => {
        const delta = computeDelta(row.changeType, row.amount);
        const next = addMoney(acc.current, delta);
        acc.points.push({
          ref: row.ref,
          title: row.title,
          delta,
          cumulative: next,
        });
        acc.current = next;
        return acc;
      },
      {
        current: toMoneyNumber(project.contractValue),
        points: [],
      },
    ).points;

  return {
    rows,
    summary: {
      originalBudget: toMoneyNumber(project.contractValue),
      netChange,
      currentBudget,
    },
    waterfall,
  };
};

const createBudgetRevision = async ({ orgId, projectId, userId, payload, canApprove = false }) => {
  const project = await ensureProject({ orgId, projectId });

  const ref = await nextRef(prisma, { table: 'BudgetRevision', scopeColumn: 'projectId', scopeId: projectId, prefix: 'BR', pad: 2 });

  const last = await prisma.budgetRevision.findFirst({
    where: { projectId, status: 'approved' },
    orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
  });

  const baseline = toMoneyNumber(last?.cumulativeBudget ?? project.contractValue);
  // A revision is approved only by someone who may approve cost; anyone else
  // starts it as a draft to submit. It used to be created "approved" by
  // whoever could create cost (Phase 21D, CX21-453).
  const status = payload.status || (canApprove ? 'approved' : 'draft');
  if (status === 'approved' && !canApprove) {
    throw new HttpError(403, 'BUDGET_REVISION_APPROVAL_REQUIRED', 'Only someone who can approve cost may create an approved revision; submit it instead');
  }
  const delta =
    status === 'approved'
      ? computeDelta(payload.changeType || 'addition', payload.amount)
      : 0;

  const created = await prisma.budgetRevision.create({
    data: {
      projectId,
      ref,
      title: payload.title,
      changeType: payload.changeType || 'addition',
      amount: toMoneyNumber(payload.amount),
      linkedChangeOrder: payload.linkedChangeOrder?.trim() || null,
      effectiveDate: payload.effectiveDate
        ? new Date(payload.effectiveDate)
        : new Date(),
      cumulativeBudget: addMoney(baseline, delta),
      status,
      approvedBy: status === 'approved' ? userId || null : null,
      approvedAt: status === 'approved' ? new Date() : null,
      notes: payload.notes?.trim() || null,
    },
  });
  if (created.status === 'submitted') {
    require('./workflow-engine.service')
      .maybeStart({ orgId, projectId, tool: 'budget_revision', recordId: created.id, actor: { id: userId } })
      .catch(() => null);
  }
  return created;
};

const updateBudgetRevision = async ({
  orgId,
  projectId,
  revisionId,
  userId,
  payload,
  viaWorkflow = false,
  canApprove = viaWorkflow,
}) => {
  const project = await ensureProject({ orgId, projectId });

  const existing = await prisma.budgetRevision.findFirst({
    where: { id: revisionId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      'BUDGET_REVISION_NOT_FOUND',
      'Budget revision not found',
    );
  }
  if (payload.status && payload.status !== existing.status && !viaWorkflow) {
    await require('./workflow-engine.service').assertNotLocked({ tool: 'budget_revision', projectId, recordId: revisionId });
  }
  // Approval, and any change to the money of an approved revision, is the
  // approver's (Phase 21D, CX21-453).
  if (payload.status === 'approved' && existing.status !== 'approved' && !canApprove) {
    throw new HttpError(403, 'BUDGET_REVISION_APPROVAL_REQUIRED', 'Only someone who can approve cost may approve a revision');
  }
  const moneyTouched = payload.amount !== undefined || payload.changeType !== undefined || payload.effectiveDate !== undefined;
  if (existing.status === 'approved' && moneyTouched && !canApprove) {
    throw new HttpError(409, 'BUDGET_REVISION_APPROVED', 'An approved revision is changed only by someone who can approve cost');
  }

  const updated = await prisma.budgetRevision.update({
    where: { id: revisionId },
    data: {
      title: payload.title ?? existing.title,
      changeType: payload.changeType ?? existing.changeType,
      amount:
        payload.amount !== undefined
          ? toMoneyNumber(payload.amount)
          : existing.amount,
      linkedChangeOrder:
        payload.linkedChangeOrder !== undefined
          ? payload.linkedChangeOrder?.trim() || null
          : existing.linkedChangeOrder,
      effectiveDate:
        payload.effectiveDate !== undefined
          ? payload.effectiveDate
            ? new Date(payload.effectiveDate)
            : null
          : existing.effectiveDate,
      status: payload.status ?? existing.status,
      approvedBy:
        payload.status === 'approved' && existing.status !== 'approved'
          ? userId || null
          : payload.status && payload.status !== 'approved'
            ? null
          : existing.approvedBy,
      approvedAt:
        payload.status === 'approved' && existing.status !== 'approved'
          ? new Date()
          : payload.status && payload.status !== 'approved'
            ? null
          : existing.approvedAt,
      notes:
        payload.notes !== undefined
          ? payload.notes?.trim() || null
          : existing.notes,
    },
  });

  await recomputeCumulative({
    projectId,
    baseBudget: project.contractValue,
  });
  if (updated.status === 'submitted' && existing.status !== 'submitted' && !viaWorkflow) {
    require('./workflow-engine.service')
      .maybeStart({ orgId, projectId, tool: 'budget_revision', recordId: updated.id, actor: { id: userId } })
      .catch(() => null);
  }

  return updated;
};

const deleteBudgetRevision = async ({ orgId, projectId, revisionId }) => {
  const project = await ensureProject({ orgId, projectId });

  const existing = await prisma.budgetRevision.findFirst({
    where: { id: revisionId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      'BUDGET_REVISION_NOT_FOUND',
      'Budget revision not found',
    );
  }

  await prisma.budgetRevision.delete({ where: { id: revisionId } });
  await recomputeCumulative({
    projectId,
    baseBudget: project.contractValue,
  });

  return { deleted: true };
};

module.exports = {
  listBudgetRevisions,
  createBudgetRevision,
  updateBudgetRevision,
  deleteBudgetRevision,
};
