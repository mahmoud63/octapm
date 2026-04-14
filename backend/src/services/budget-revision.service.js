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

const computeDelta = (changeType, amount) => {
  const value = Number(amount) || 0;
  return changeType === 'deduction' ? -value : value;
};

const recomputeCumulative = async ({ projectId, baseBudget }) => {
  const rows = await prisma.budgetRevision.findMany({
    where: { projectId },
    orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
  });

  let running = Number(baseBudget) || 0;

  for (const row of rows) {
    running += computeDelta(row.changeType, row.amount);
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

  const netChange = rows.reduce((sum, row) => {
    return sum + computeDelta(row.changeType, row.amount);
  }, 0);

  const currentBudget = (Number(project.contractValue) || 0) + netChange;

  const waterfall = rows
    .slice()
    .reverse()
    .reduce(
      (acc, row) => {
        const delta = computeDelta(row.changeType, row.amount);
        const next = acc.current + delta;
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
        current: Number(project.contractValue) || 0,
        points: [],
      },
    ).points;

  return {
    rows,
    summary: {
      originalBudget: Number(project.contractValue) || 0,
      netChange,
      currentBudget,
    },
    waterfall,
  };
};

const createBudgetRevision = async ({ orgId, projectId, payload }) => {
  const project = await ensureProject({ orgId, projectId });

  const count = await prisma.budgetRevision.count({ where: { projectId } });
  const ref = `BR-${String(count + 1).padStart(2, '0')}`;

  const last = await prisma.budgetRevision.findFirst({
    where: { projectId },
    orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
  });

  const baseline = last?.cumulativeBudget ?? Number(project.contractValue) ?? 0;
  const delta = computeDelta(payload.changeType || 'addition', payload.amount);

  return prisma.budgetRevision.create({
    data: {
      projectId,
      ref,
      title: payload.title,
      changeType: payload.changeType || 'addition',
      amount: Number(payload.amount) || 0,
      linkedChangeOrder: payload.linkedChangeOrder?.trim() || null,
      effectiveDate: payload.effectiveDate
        ? new Date(payload.effectiveDate)
        : new Date(),
      cumulativeBudget: baseline + delta,
      notes: payload.notes?.trim() || null,
    },
  });
};

const updateBudgetRevision = async ({
  orgId,
  projectId,
  revisionId,
  payload,
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

  const updated = await prisma.budgetRevision.update({
    where: { id: revisionId },
    data: {
      title: payload.title ?? existing.title,
      changeType: payload.changeType ?? existing.changeType,
      amount:
        payload.amount !== undefined
          ? Number(payload.amount) || 0
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
      notes:
        payload.notes !== undefined
          ? payload.notes?.trim() || null
          : existing.notes,
    },
  });

  await recomputeCumulative({
    projectId,
    baseBudget: Number(project.contractValue) || 0,
  });

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
    baseBudget: Number(project.contractValue) || 0,
  });

  return { deleted: true };
};

module.exports = {
  listBudgetRevisions,
  createBudgetRevision,
  updateBudgetRevision,
  deleteBudgetRevision,
};
