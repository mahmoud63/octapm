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

const recomputeCumulative = async ({ projectId, baseBudget, tx = prisma }) => {
  const rows = await tx.budgetRevision.findMany({
    where: { projectId, status: 'approved' },
    orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
  });

  let running = toMoneyNumber(baseBudget);

  for (const row of rows) {
    running = addMoney(running, computeDelta(row.changeType, row.amount));
    await tx.budgetRevision.update({
      where: { id: row.id },
      data: { cumulativeBudget: running },
    });
  }
};

/**
 * The revisions start from the project's contract value: the original
 * budget is that value, the current budget that value plus the approved
 * changes, and every running total (a row's cumulativeBudget, a waterfall
 * point's cumulative) carries it. The contract value is one of the project's
 * commercial terms, which the project record states only to a reader who
 * may read them there (project.service COMMERCIAL_TERMS: ipc:read); a cost
 * reader without that right got it back here (certification R21). For such
 * a reader (`contractValueReadable: false`) those figures are null and
 * `contractValueWithheld: true` says why; the changes themselves — each
 * revision's amount, the net change and each waterfall step's delta — stay.
 * The routes always say; an internal reader (the data-quality rule) that
 * does not reads the whole.
 */
const withheldRevisionRow = (row) =>
  row && typeof row === 'object'
    ? { ...row, cumulativeBudget: null, contractValueWithheld: true }
    : row;

const listBudgetRevisions = async ({ orgId, projectId, contractValueReadable = true }) => {
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

  if (!contractValueReadable) {
    return {
      rows: rows.map(withheldRevisionRow),
      summary: {
        originalBudget: null,
        netChange,
        currentBudget: null,
        contractValueWithheld: true,
      },
      waterfall: waterfall.map((point) => ({ ...point, cumulative: null })),
    };
  }

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

const createBudgetRevision = async ({ orgId, projectId, userId, payload, canApprove = false, contractValueReadable = true }) => {
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
  // The running total is the contract value plus the changes (R21).
  return contractValueReadable ? created : withheldRevisionRow(created);
};

const updateBudgetRevision = async ({
  orgId,
  projectId,
  revisionId,
  userId,
  payload,
  viaWorkflow = false,
  canApprove = viaWorkflow,
  contractValueReadable = true,
}) => {
  const project = await ensureProject({ orgId, projectId });

  const found = await prisma.budgetRevision.findFirst({
    where: { id: revisionId, projectId },
  });

  if (!found) {
    throw new HttpError(
      404,
      'BUDGET_REVISION_NOT_FOUND',
      'Budget revision not found',
    );
  }
  // The decisions below are taken on the status as held for this
  // transaction, not on the read above: an edit that started on a draft
  // used to land after its approval, rewriting the money and the status
  // (Phase 21D, CX21-470).
  return prisma.$transaction(async (tx) => {
  // One revision edit per project at a time (an advisory lock taken before
  // the row): two edits holding different revisions and then recomputing
  // the cumulative over all of them could wait on each other.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`budget-revisions:${projectId}`}))`;
  await tx.$queryRaw`SELECT status FROM "BudgetRevision" WHERE id = ${revisionId} FOR UPDATE`;
  // The whole row as held, not only its status: an edit that wrote back the
  // money and the approval stamps it had read undid a concurrent approval
  // (Phase 21D, CX21-480).
  const existing = (await tx.budgetRevision.findFirst({ where: { id: revisionId, projectId } })) || found;
  if (payload.status && payload.status !== existing.status && !viaWorkflow) {
    await require('./workflow-engine.service').assertNotLocked({ tool: 'budget_revision', projectId, recordId: revisionId });
  }
  // Approval, and any change to the money of an approved revision, is the
  // approver's (Phase 21D, CX21-453).
  if (payload.status === 'approved' && existing.status !== 'approved' && !canApprove) {
    throw new HttpError(403, 'BUDGET_REVISION_APPROVAL_REQUIRED', 'Only someone who can approve cost may approve a revision');
  }
  if (existing.status === 'approved' && payload.status && payload.status !== 'approved' && !canApprove) {
    throw new HttpError(403, 'BUDGET_REVISION_APPROVAL_REQUIRED', 'Only someone who can approve cost may take a revision out of approval');
  }
  const moneyTouched = payload.amount !== undefined || payload.changeType !== undefined || payload.effectiveDate !== undefined;
  if (existing.status === 'approved' && moneyTouched && !canApprove) {
    throw new HttpError(409, 'BUDGET_REVISION_APPROVED', 'An approved revision is changed only by someone who can approve cost');
  }

  // Only what the caller sent is written; nothing read before the lock is
  // copied back (Phase 21D, CX21-470 / CX21-480).
  const data = {
    ...(payload.title !== undefined ? { title: payload.title } : {}),
    ...(payload.changeType !== undefined ? { changeType: payload.changeType } : {}),
    ...(payload.amount !== undefined ? { amount: toMoneyNumber(payload.amount) } : {}),
    ...(payload.linkedChangeOrder !== undefined ? { linkedChangeOrder: payload.linkedChangeOrder?.trim() || null } : {}),
    ...(payload.effectiveDate !== undefined ? { effectiveDate: payload.effectiveDate ? new Date(payload.effectiveDate) : null } : {}),
    ...(payload.notes !== undefined ? { notes: payload.notes?.trim() || null } : {}),
    ...(payload.status ? { status: payload.status } : {}),
    ...(payload.status === 'approved' && existing.status !== 'approved' ? { approvedBy: userId || null, approvedAt: new Date() } : {}),
    ...(payload.status && payload.status !== 'approved' ? { approvedBy: null, approvedAt: null } : {}),
  };
  const updated = await tx.budgetRevision.update({ where: { id: revisionId }, data });

  await recomputeCumulative({
    projectId,
    baseBudget: project.contractValue,
    tx,
  });
  if (updated.status === 'submitted' && existing.status !== 'submitted' && !viaWorkflow) {
    require('./workflow-engine.service')
      .maybeStart({ orgId, projectId, tool: 'budget_revision', recordId: updated.id, actor: { id: userId } })
      .catch(() => null);
  }

  // The running total is the contract value plus the changes (R21).
  return contractValueReadable ? updated : withheldRevisionRow(updated);
  });
};

const deleteBudgetRevision = async ({ orgId, projectId, revisionId, canApprove = false }) => {
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

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`budget-revisions:${projectId}`}))`;
    // Decided on the status as held (CX21-470): a delete that started on a
    // draft must not remove the revision approved meanwhile.
    const [held] = await tx.$queryRaw`SELECT status FROM "BudgetRevision" WHERE id = ${revisionId} FOR UPDATE`;
    const status = held ? held.status : existing.status;
    // Deleting an approved revision undoes an approval (Phase 21D, CX21-460).
    if (status === 'approved' && !canApprove) {
      throw new HttpError(403, 'BUDGET_REVISION_APPROVAL_REQUIRED', 'Only someone who can approve cost may delete an approved revision');
    }
    await tx.budgetRevision.delete({ where: { id: revisionId } });
    await recomputeCumulative({
      projectId,
      baseBudget: project.contractValue,
      tx,
    });
    return { deleted: true };
  });
};

module.exports = {
  listBudgetRevisions,
  createBudgetRevision,
  updateBudgetRevision,
  deleteBudgetRevision,
};
