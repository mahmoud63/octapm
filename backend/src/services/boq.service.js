const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { nextActivityCode } = require('../utils/activity-code');
const { activeBoqCodeKey, normalizeBoqCode } = require('../utils/boq-code');
const {
  addMoney,
  divideMoney,
  multiplyMoney,
  toMoneyNumber,
} = require('../utils/money');
const { calculateFinancials } = require('./boq-calculation.service');
const {
  assertAiQuota,
  incrementAiUsage,
} = require('../middleware/subscription-gate');
const {
  assertAllocationCapacity,
  assertMappingRuleAllows,
  buildAllocationSummary,
  computeDefaultWeight,
  rederiveAllocationsForBoqItem,
} = require('./activity-boq-allocation.service');
const {
  replaceActivityDependencies,
} = require("./activity-dependency.service");
const fileStorageService = require("./file-storage.service");
const auditService = require("./audit.service");
const approvalWorkflowService = require("./approval-workflow.service");
const jobService = require("../jobs/job.service");
const { JobError, isTransientError } = require("../jobs/errors");
const { parseExcelInput, validateBoqRows } = require("./boq/excel-parser");
const { generateBoqTemplate } = require("./boq/template");
const uomService = require("./uom.service");

const BOQ_REVISION_STATUS = Object.freeze({
  IMPORTED: 'imported',
  COMPARISON_ONLY: 'comparison_only',
  UNDER_REVIEW: 'under_review',
  APPROVED: 'approved',
  BASELINED: 'baselined',
  SUPERSEDED: 'superseded',
});

// The revisions whose rows are the current bill: an upload applies its rows
// at once (unless the baseline is locked), and the review that follows —
// submit, approve, lock — changes the revision's standing, not its rows. A
// comparison-only revision never applied anything; a superseded one has been
// replaced as the baseline.
const CURRENT_REVISION_STATUSES = [
  BOQ_REVISION_STATUS.IMPORTED,
  BOQ_REVISION_STATUS.UNDER_REVIEW,
  BOQ_REVISION_STATUS.APPROVED,
  BOQ_REVISION_STATUS.BASELINED,
];

// How many rows of each comparison list a dry-run report carries back. The
// counts are always complete; the rows are a sample big enough to review.
const DRY_RUN_ROW_LIMIT = 100;

const BOQ_BASELINE_LOCK_REASON =
  'Pending BOQ revision comparison; baseline is locked';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 120_000,
});

const normalizeCode = normalizeBoqCode;
const activeStatuses = ['draft', 'submitted', 'approved'];
const trimOrNull = (value) => {
  const text = String(value ?? '').trim();
  return text || null;
};

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const dateSummary = (value) => (value ? new Date(value).toISOString() : null);

const boqItemAuditSummary = (item) => ({
  code: item.code || null,
  description: item.description,
  unit: item.unit || null,
  quantity: toNumber(item.qty),
  rate: toMoneyNumber(item.rate),
  amount: toMoneyNumber(item.amount),
  section: item.section || null,
  isManual: Boolean(item.isManual),
  isActive: item.isActive !== false,
  revisionId: item.revisionId || null,
  baselineLocked: Boolean(item.baselineLocked),
});

const boqRevisionAuditSummary = (revision) => ({
  revisionNumber: revision.revisionNumber,
  label: revision.label || null,
  status: revision.status,
  source: revision.source || 'upload',
  baselineLocked: Boolean(revision.baselineLocked),
  itemCount: Number(revision.itemCount || 0),
  addedCount: Number(revision.addedCount || 0),
  updatedCount: Number(revision.updatedCount || 0),
  removedCount: Number(revision.removedCount || 0),
  unchangedCount: Number(revision.unchangedCount || 0),
  blockedCount: Number(revision.blockedCount || 0),
  totalAmount: toMoneyNumber(revision.totalAmount),
  sourceDocumentId: revision.sourceDocumentId || null,
  createdAt: dateSummary(revision.createdAt),
});

const recordBoqAudit = async ({ orgId, ...event }) => {
  if (!orgId) return null;
  return auditService.recordEvent({ orgId, ...event });
};

const moneyEquals = (left, right) =>
  Math.abs(toNumber(left) - toNumber(right)) <= 0.01;

const quantityEquals = (left, right) =>
  Math.abs(toNumber(left) - toNumber(right)) <= 0.000001;

const rowCodeKey = (code) => normalizeCode(code).toLowerCase();

function duplicateBoqItemCodeError(code) {
  return new HttpError(
    400,
    'DUPLICATE_BOQ_ITEM_CODE',
    `BOQ item code "${code}" already exists for this project`,
  );
}

function duplicateBoqActivityCodeError(code) {
  return new HttpError(
    400,
    'DUPLICATE_BOQ_ACTIVITY_CODE',
    `BOQ activity code "${code}" already exists for this project`,
  );
}

// The database refuses a BOQ row whose new quantity or amount falls below
// what its active allocations to activities already take (trigger
// validate_boq_item_allocation_capacity, migration 20260608170000: RAISE,
// SQLSTATE P0001). Prisma surfaces it as an unknown request error carrying
// the trigger's text, which reached the client as a 500 INTERNAL_ERROR. The
// E2 refusals send a user to price the bill's rows (BOQ page), and repricing
// an allocated row is part of that: it is a business refusal with a way out.
const BOQ_ALLOCATION_CAPACITY_TRIGGER = Object.freeze([
  ['Existing BOQ activity allocations exceed the new BOQ item quantity', 'quantity'],
  ['Existing BOQ activity allocations exceed the new BOQ item amount', 'amount'],
]);

function handleBoqAllocationCapacityError(error, boqItemId) {
  const text = `${error?.message || ''} ${error?.meta?.message || ''}`;
  const hit = BOQ_ALLOCATION_CAPACITY_TRIGGER.find(([message]) => text.includes(message));
  if (!hit) return;
  const [, exceeded] = hit;
  const refusal = new HttpError(
    409,
    'BOQ_ITEM_BELOW_ALLOCATIONS',
    `This BOQ row's allocations to activities exceed its new ${exceeded}. Reduce or reject them first (Project Controls › Mapping), then change the row's ${exceeded === 'amount' ? 'rate or quantity' : 'quantity'}.`,
  );
  refusal.details = { boqItemId, exceeded };
  throw refusal;
}

function handleBoqUniqueError(error) {
  if (error?.code !== 'P2002') throw error;

  const target = Array.isArray(error.meta?.target)
    ? error.meta.target
    : [String(error.meta?.target || '')];
  const targetText = target.join(' ').toLowerCase();

  if (targetText.includes('activitycode')) {
    throw duplicateBoqActivityCodeError('generated');
  }

  if (
    targetText.includes('activecodekey') ||
    targetText.includes('boqitem_projectid_active') ||
    targetText.includes('code')
  ) {
    throw duplicateBoqItemCodeError('submitted');
  }

  throw error;
}

async function assertUniqueBoqItemCode(
  projectId,
  code,
  tx = prisma,
  excludeItemId = null,
) {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) {
    throw new HttpError(
      400,
      'BOQ_ITEM_CODE_REQUIRED',
      'BOQ item code is required',
    );
  }

  const where = { projectId, activeCodeKey: normalizedCode, isActive: true };
  if (excludeItemId) where.id = { not: excludeItemId };

  const duplicate = await tx.boqItem.findFirst({
    where,
    select: { id: true, code: true },
  });

  if (duplicate) throw duplicateBoqItemCodeError(normalizedCode);
}

async function assertNoManualCodeConflicts(projectId, codes, tx = prisma) {
  const normalizedCodes = [
    ...new Set((codes || []).map(normalizeCode).filter(Boolean)),
  ];
  if (normalizedCodes.length === 0) return;

  const conflicts = await tx.boqItem.findMany({
    where: {
      projectId,
      isManual: true,
      isActive: true,
      activeCodeKey: { in: normalizedCodes },
    },
    select: { code: true },
  });

  if (conflicts.length > 0) {
    throw duplicateBoqItemCodeError(conflicts[0].code);
  }
}

const findBoqItemInProject = (projectId, itemId, tx = prisma) =>
  tx.boqItem.findFirst({ where: { id: itemId, projectId } });

function allocationMap(summary) {
  return new Map((summary?.items || []).map((item) => [item.boqItemId, item]));
}

function serializeBoqRevision(revision) {
  if (!revision) return null;
  return {
    id: revision.id,
    projectId: revision.projectId,
    revisionNumber: revision.revisionNumber,
    label: revision.label,
    status: revision.status,
    baselineLocked: Boolean(revision.baselineLocked),
    lockedAt: revision.lockedAt ?? null,
    lockedBy: revision.lockedBy ?? null,
    itemCount: revision.itemCount ?? 0,
    addedCount: revision.addedCount ?? 0,
    updatedCount: revision.updatedCount ?? 0,
    removedCount: revision.removedCount ?? 0,
    unchangedCount: revision.unchangedCount ?? 0,
    blockedCount: revision.blockedCount ?? 0,
    totalAmount: revision.totalAmount ?? 0,
    sourceDocumentId: revision.sourceDocumentId ?? null,
    createdAt: revision.createdAt,
    updatedAt: revision.updatedAt,
  };
}

async function getBoqBaselineLock(projectId, tx = prisma) {
  const [lockedBoqRevision, baselinedSchedule] = await Promise.all([
    tx.boqRevision?.findFirst
      ? tx.boqRevision.findFirst({
          where: { projectId, baselineLocked: true },
          orderBy: [{ lockedAt: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            revisionNumber: true,
            label: true,
            lockedAt: true,
          },
        })
      : null,
    tx.scheduleRevision?.findFirst
      ? tx.scheduleRevision.findFirst({
          where: { projectId, status: 'baselined' },
          orderBy: [{ baselinedAt: 'desc' }, { createdAt: 'desc' }],
          select: { id: true, baselinedAt: true },
        })
      : null,
  ]);

  const locked = Boolean(lockedBoqRevision || baselinedSchedule);
  return {
    locked,
    source: baselinedSchedule
      ? 'schedule_baseline'
      : lockedBoqRevision
        ? 'boq_revision'
        : null,
    scheduleRevisionId: baselinedSchedule?.id ?? null,
    boqRevisionId: lockedBoqRevision?.id ?? null,
    revisionNumber: lockedBoqRevision?.revisionNumber ?? null,
    label: lockedBoqRevision?.label ?? null,
    lockedAt:
      baselinedSchedule?.baselinedAt ?? lockedBoqRevision?.lockedAt ?? null,
  };
}

async function assertBoqEditable(projectId, tx = prisma) {
  const baseline = await getBoqBaselineLock(projectId, tx);
  if (baseline.locked) {
    throw new HttpError(
      409,
      'BOQ_BASELINE_LOCKED',
      'BOQ baseline is locked. Upload a revision for comparison instead of editing current baseline rows.',
      { baseline },
    );
  }
  return baseline;
}

async function assertProjectAccess(projectId, orgId, tx = prisma) {
  if (!orgId) return null;
  const project = await tx.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true, orgId: true },
  });
  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
  return project;
}

function rowChanged(existing, incoming) {
  return (
    normalizeCode(existing.code) !== normalizeCode(incoming.code) ||
    String(existing.description ?? '') !== String(incoming.description ?? '') ||
    String(existing.unit ?? '') !== String(incoming.unit ?? '') ||
    !quantityEquals(existing.qty, incoming.qty) ||
    !moneyEquals(existing.rate, incoming.rate) ||
    !moneyEquals(existing.amount, incoming.amount)
  );
}

function summarizeRow(row) {
  return {
    id: row.id ?? null,
    code: normalizeCode(row.code),
    description: row.description,
    quantity: toNumber(row.qty ?? row.quantity),
    unit: row.unit ?? null,
    rate: toNumber(row.rate),
    amount: toNumber(row.amount),
    sortOrder: row.sortOrder ?? 0,
  };
}

function buildBoqComparison(existingItems, incomingItems) {
  const existingByCode = new Map(
    existingItems
      .filter((item) => normalizeCode(item.code))
      .map((item) => [rowCodeKey(item.code), item]),
  );
  const incomingKeys = new Set();
  const added = [];
  const updated = [];
  const unchanged = [];

  for (const item of incomingItems) {
    const key = rowCodeKey(item.code);
    incomingKeys.add(key);
    const existing = existingByCode.get(key);
    if (!existing) {
      added.push(summarizeRow(item));
      continue;
    }

    if (rowChanged(existing, item)) {
      updated.push({
        code: normalizeCode(item.code),
        existingId: existing.id,
        before: summarizeRow(existing),
        after: summarizeRow(item),
      });
    } else {
      unchanged.push({
        code: normalizeCode(item.code),
        existingId: existing.id,
      });
    }
  }

  const removed = existingItems
    .filter(
      (item) =>
        normalizeCode(item.code) && !incomingKeys.has(rowCodeKey(item.code)),
    )
    .map(summarizeRow);

  return {
    added,
    updated,
    unchanged,
    removed,
    blocked: [],
    summary: {
      added: added.length,
      updated: updated.length,
      unchanged: unchanged.length,
      removed: removed.length,
      blocked: 0,
    },
  };
}

async function createBoqRevision(
  tx,
  {
    projectId,
    label,
    status,
    importedRows,
    comparison,
    sourceDocumentId = null,
    createdBy = null,
  },
) {
  const latest = await tx.boqRevision.findFirst({
    where: { projectId },
    orderBy: { revisionNumber: 'desc' },
    select: { revisionNumber: true },
  });
  const revisionNumber = (latest?.revisionNumber ?? 0) + 1;
  const totalAmount = importedRows.reduce(
    (sum, row) => addMoney(sum, row.amount),
    0,
  );

  return tx.boqRevision.create({
    data: {
      projectId,
      revisionNumber,
      label: trimOrNull(label) || `BOQ Revision ${revisionNumber}`,
      status,
      baselineLocked: false,
      itemCount: importedRows.length,
      addedCount: comparison.added.length,
      updatedCount: comparison.updated.length,
      removedCount: comparison.removed.length,
      unchangedCount: comparison.unchanged.length,
      blockedCount: comparison.blocked.length,
      totalAmount,
      importedRowsJson: importedRows.map(summarizeRow),
      compareJson: comparison,
      sourceDocumentId,
      createdBy,
    },
  });
}

function boqItemData(projectId, revisionId, item, overrides = {}) {
  const isActive = overrides.isActive ?? true;
  const code = normalizeCode(item.code);
  return {
    projectId,
    revisionId,
    code,
    activeCodeKey: activeBoqCodeKey(code, isActive),
    description: item.description,
    qty: item.qty,
    unit: item.unit,
    unitCode: item.unitCode ?? null,
    rate: item.rate,
    amount: item.amount,
    isManual: false,
    isActive,
    sortOrder: item.sortOrder,
    ...(item.mappingRule ? { mappingRule: item.mappingRule } : {}),
    ...overrides,
  };
}

async function calculateProjectFinancials(projectId, items, summary = null) {
  const allocationSummary =
    summary || (await buildAllocationSummary({ projectId }));
  // The extra services are the project's organisation's (wave ENT-3).
  return calculateFinancials(items, allocationSummary, { projectId });
}

const boqItemActivityAllocationInclude = {
  where: {
    isActive: true,
    activity: { isActive: true },
  },
  include: {
    activity: {
      select: {
        id: true,
        projectId: true,
        name: true,
        activityCode: true,
        p6ActivityId: true,
        wbsCode: true,
        predecessors: true,
        sortOrder: true,
        predecessorLinks: {
          include: {
            predecessor: {
              select: {
                id: true,
                name: true,
                activityCode: true,
                p6ActivityId: true,
                wbsCode: true,
                sortOrder: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    },
  },
  orderBy: { createdAt: 'asc' },
};

const boqItemInclude = {
  activityBoqAllocations: boqItemActivityAllocationInclude,
};

function activityDisplayCode(activity) {
  return activity?.activityCode || activity?.p6ActivityId || activity?.id || '';
}

function dependencyDisplay(activity) {
  const firstDependency = activity?.predecessorLinks?.[0] ?? null;
  if (!firstDependency) {
    return {
      dependencyType: null,
      predecessorCode: activity?.predecessors || null,
    };
  }

  return {
    dependencyType: firstDependency.relationshipType || null,
    predecessorCode:
      activityDisplayCode(firstDependency.predecessor) ||
      firstDependency.externalPredecessorRef ||
      firstDependency.predecessorId ||
      null,
  };
}

async function getActiveAllocationTotalsForBoqItem(
  { boqItemId, excludeAllocationId = null },
  tx = prisma,
) {
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
    (totals, allocation) => {
      totals.quantity += toNumber(allocation.quantity);
      totals.amount = addMoney(totals.amount, allocation.amount);
      return totals;
    },
    { quantity: 0, amount: 0 },
  );
}

function assertPositiveAllocationValues({ quantity, amount }) {
  if (quantity <= 0 || amount <= 0) {
    throw new HttpError(
      400,
      'INVALID_ALLOCATION_VALUES',
      'Activity allocation quantity and amount must be greater than zero',
    );
  }
}

async function getProjectCalendar(projectId, tx = prisma) {
  const project = await tx.project.findUnique?.({
    where: { id: projectId },
    select: { projectCalendar: true },
  });
  return project?.projectCalendar ?? null;
}

/**
 * The activity a bill row says it belongs to.
 *
 * Scoped to the project, so one project's bill can never be allocated onto
 * another's programme, and refusing a retired activity by name: an activity
 * superseded by a schedule revision stops earning value, so hanging new money
 * on it would put that money somewhere it can never be reported.
 */
async function resolveExistingActivity(tx, { projectId, activityId }) {
  const activity = await tx.activity.findFirst({
    where: { id: activityId, projectId },
  });

  if (!activity) {
    throw new HttpError(
      404,
      "BOQ_ACTIVITY_NOT_IN_PROJECT",
      "That activity is not on this project's programme",
      { activityId, projectId },
    );
  }

  if (activity.isActive === false) {
    throw new HttpError(
      409,
      "BOQ_ACTIVITY_RETIRED",
      `"${activity.name}" was retired by a schedule revision and no longer earns value. Allocate to the activity that replaced it.`,
      { activityId, retiredAt: activity.retiredAt, retiredReason: activity.retiredReason },
    );
  }

  return activity;
}

/** One live allocation per bill row per activity — add to it rather than beside it. */
async function assertNotAlreadyAllocated(tx, { projectId, boqItemId, activityId }) {
  const existing = await tx.activityBoqAllocation.findFirst({
    where: { projectId, boqItemId, activityId, isActive: true },
    select: { id: true, quantity: true },
  });

  if (existing) {
    throw new HttpError(
      409,
      "DUPLICATE_ACTIVE_ALLOCATION",
      "This bill row is already allocated to that activity. Change the existing allocation rather than adding a second one.",
      { allocationId: existing.id, quantity: existing.quantity },
    );
  }
}

async function createOfficialBoqActivityAllocation(
  tx,
  {
    projectId,
    boqItem,
    payload,
    source = 'manual',
    userId = null,
    calendarId = null,
  },
) {
  // Whatever brings the row here — an activity added to a bill row, a manual
  // item naming one, or the structuring job — a not_applicable item refuses
  // it (mapping §3); the allocation routes apply the same guard to theirs.
  assertMappingRuleAllows(boqItem);
  const quantity = toNumber(payload.quantity);
  const rate = toMoneyNumber(payload.rate ?? boqItem.rate);
  const amount =
    payload.amount !== undefined && payload.amount !== null
      ? toMoneyNumber(payload.amount)
      : multiplyMoney(quantity, rate);
  const activityName = String(payload.activityName || "").trim();
  const existingActivityId = trimOrNull(payload.activityId);

  // A bill row either names an activity that already exists, or describes one
  // to be created for it. Naming one is how a project that already has a
  // programme — imported from P6, or built by its planner — keeps the money and
  // the logic on the same activity instead of growing a second, shadow schedule
  // of zero-duration stubs beside the real one.
  if (!existingActivityId && !activityName) {
    throw new HttpError(
      400,
      "MISSING_FIELDS",
      "Name the activity this belongs to (activityId), or give a name to create one (activityName)",
    );
  }
  assertPositiveAllocationValues({ quantity, amount });

  const existingTotals = await getActiveAllocationTotalsForBoqItem(
    { boqItemId: boqItem.id },
    tx,
  );
  assertAllocationCapacity({
    boqItem,
    existingTotals,
    nextQuantity: quantity,
    nextAmount: amount,
  });

  let activity;

  if (existingActivityId) {
    activity = await resolveExistingActivity(tx, {
      projectId,
      activityId: existingActivityId,
    });
    await assertNotAlreadyAllocated(tx, {
      projectId,
      boqItemId: boqItem.id,
      activityId: activity.id,
    });
  } else {
    const activityCode =
      normalizeCode(payload.activityCode) ||
      (await nextActivityCode(projectId, boqItem.description, tx));
    const activitySortOrder =
      payload.sortOrder !== undefined
        ? Number(payload.sortOrder)
        : await tx.activity.count({ where: { projectId, isActive: true } });
    const dependencyType = payload.dependencyType || null;
    const predecessorCode = trimOrNull(payload.predecessorCode);
    const predecessorText = predecessorCode
      ? `${predecessorCode} ${dependencyType || "FS"}`
      : null;

    activity = await tx.activity.create({
      data: {
        projectId,
        name: activityName,
        activityCode,
        wbsCode: trimOrNull(payload.wbsCode),
        calendarId,
        category: payload.category || null,
        duration: Number(payload.duration) || 0,
        budget: amount,
        predecessors: predecessorText,
        batchId: payload.batchId || null,
        mintedByBoqItemId: boqItem.id, // the row that minted it — what a later delete may retire (CX21-544)
        sortOrder: activitySortOrder,
      },
    });

    if (predecessorText) {
      await replaceActivityDependencies(tx, {
        projectId,
        successorId: activity.id,
        predecessors: predecessorText,
        source,
      });
    }
  }

  const allocation = await tx.activityBoqAllocation.create({
    data: {
      projectId,
      boqItemId: boqItem.id,
      activityId: activity.id,
      quantity,
      amount,
      weight: computeDefaultWeight({ amount, boqItem }),
      source,
      status: payload.status || 'draft',
      notes: trimOrNull(payload.notes),
      createdBy: userId || null,
      updatedBy: userId || null,
    },
  });

  return mapActivityAllocation({ ...allocation, activity }, boqItem);
}

/**
 * What an upload would do, without doing it.
 *
 * The same comparison the real upload runs, against the same current rows and
 * the same lock, but read-only: no revision, no rows, no document, no job. The
 * codes that clash with hand-entered rows are reported as blocked rather than
 * thrown, because the point of a preview is to see every problem at once.
 */
async function buildBoqUploadDryRun(projectId, itemsWithAmounts, label, extras = {}) {
  const [existingUploadedItems, baseline, manualConflicts] = await Promise.all([
    prisma.boqItem.findMany({
      where: { projectId, isManual: false, isActive: true },
      select: {
        id: true,
        code: true,
        description: true,
        qty: true,
        unit: true,
        rate: true,
        amount: true,
        sortOrder: true,
        baselineLocked: true,
      },
    }),
    getBoqBaselineLock(projectId),
    prisma.boqItem.findMany({
      where: {
        projectId,
        isManual: true,
        isActive: true,
        activeCodeKey: {
          in: [...new Set(itemsWithAmounts.map((item) => item.code).filter(Boolean))],
        },
      },
      select: { id: true, code: true },
    }),
  ]);

  const comparison = buildBoqComparison(existingUploadedItems, itemsWithAmounts);
  comparison.blocked = manualConflicts.map((item) => ({
    code: normalizeCode(item.code),
    existingId: item.id,
    reason: 'DUPLICATE_BOQ_ITEM_CODE',
    message: `BOQ item code "${item.code}" belongs to a hand-entered row; the upload would be refused`,
  }));
  comparison.summary.blocked = comparison.blocked.length;

  const mode = baseline.locked
    ? BOQ_REVISION_STATUS.COMPARISON_ONLY
    : BOQ_REVISION_STATUS.IMPORTED;
  const sample = (rows) => rows.slice(0, DRY_RUN_ROW_LIMIT);

  return {
    dryRun: true,
    mode,
    baselineLocked: baseline.locked,
    baseline,
    label: trimOrNull(label),
    rowCount: itemsWithAmounts.length,
    totalAmount: itemsWithAmounts.reduce(
      (sum, row) => addMoney(sum, row.amount),
      0,
    ),
    comparison: {
      summary: comparison.summary,
      added: sample(comparison.added),
      updated: sample(comparison.updated),
      removed: sample(comparison.removed),
      unchanged: sample(comparison.unchanged),
      blocked: sample(comparison.blocked),
      rowLimit: DRY_RUN_ROW_LIMIT,
    },
    ...extras,
  };
}

async function findBoqRevisionInProject(projectId, revisionId, tx = prisma) {
  const revision = await tx.boqRevision.findFirst({
    where: { id: revisionId, projectId },
  });
  if (!revision) {
    throw new HttpError(404, 'BOQ_REVISION_NOT_FOUND', 'BOQ revision not found');
  }
  return revision;
}

/**
 * Moves a revision through its review, recording the step the way every
 * other approval on the platform is recorded: the workflow service decides
 * whether the step is allowed from where the revision stands (409 otherwise),
 * and the audit trail keeps who did it and what the revision looked like.
 */
async function transitionBoqRevision(
  tx,
  { orgId, projectId, revision, toStatus, data = {}, action, reason = null, comment = null, options = {}, metadata = {} },
) {
  approvalWorkflowService.assertAllowedTransition({
    recordType: approvalWorkflowService.RECORD_TYPES.BOQ_REVISION,
    fromStatus: revision.status,
    toStatus,
    reason,
    comment,
  });

  const updated = await tx.boqRevision.update({
    where: { id: revision.id },
    data: { status: toStatus, ...data },
  });

  await recordBoqAudit({
    tx,
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.BOQ_REVISION,
    entityId: revision.id,
    action,
    actorId: options.userId || null,
    actorRole: options.userRole || null,
    oldStatus: revision.status,
    newStatus: toStatus,
    oldSummary: boqRevisionAuditSummary(revision),
    newSummary: boqRevisionAuditSummary(updated),
    reason: reason || comment || null,
    summary: { revisionNumber: revision.revisionNumber, ...metadata },
    metadata: { source: 'boq.revision', ...metadata },
  });
  if (orgId) {
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.BOQ_REVISION,
      recordId: revision.id,
      fromStatus: revision.status,
      toStatus,
      actorId: options.userId || null,
      actorRole: options.userRole || null,
      reason,
      comment,
      metadata: { revisionNumber: revision.revisionNumber, ...metadata },
    });
  }

  return updated;
}

function refuseComparisonOnlyReview(revision) {
  if (revision.status !== BOQ_REVISION_STATUS.COMPARISON_ONLY) return;
  // Its rows were never applied — the baseline was locked when it arrived —
  // so there is nothing on the current bill to sign off. Reviewing it would
  // mean adopting it as the new baseline, which is a different operation.
  throw new HttpError(
    409,
    'BOQ_REVISION_COMPARISON_ONLY',
    'This revision was saved for comparison only while the baseline was locked; its rows are not on the current BOQ and cannot be reviewed',
    { revisionId: revision.id, status: revision.status },
  );
}

/**
 * A review step (submit or approve) the revision's status no longer allows,
 * refused in BOQ words before the generic workflow check: the revision may
 * have been submitted, approved, locked or superseded by someone else since
 * the page was loaded, so the sentence says where it stands and to refresh.
 * The code stays the workflow's (APPROVAL_WORKFLOW_INVALID_TRANSITION) so
 * clients that read it are unchanged; the details say the status.
 */
function refuseStaleBoqReviewStep(revision, step) {
  const n = revision.revisionNumber;
  const status = revision.status;
  let message = null;
  if (status === BOQ_REVISION_STATUS.BASELINED) {
    message = `BOQ revision ${n} is already approved and locked as the baseline; refresh the BOQ page to see it.`;
  } else if (status === BOQ_REVISION_STATUS.SUPERSEDED) {
    message = `BOQ revision ${n} has been superseded by a later revision; refresh the BOQ page to see the current one.`;
  } else if (step === 'approve' && status === BOQ_REVISION_STATUS.IMPORTED) {
    message = `Submit BOQ revision ${n} for review before approving it.`;
  } else if (status === BOQ_REVISION_STATUS.APPROVED) {
    message = `BOQ revision ${n} is already approved; refresh the BOQ page — the next step is to lock it as the baseline.`;
  } else if (step === 'submit' && status === BOQ_REVISION_STATUS.UNDER_REVIEW) {
    message = `BOQ revision ${n} is already under review; refresh the BOQ page to see it.`;
  }
  if (!message) return;
  throw new HttpError(409, 'APPROVAL_WORKFLOW_INVALID_TRANSITION', message, {
    recordType: approvalWorkflowService.RECORD_TYPES.BOQ_REVISION,
    revisionId: revision.id,
    revisionNumber: n,
    fromStatus: status,
    toStatus: step === 'approve' ? BOQ_REVISION_STATUS.APPROVED : BOQ_REVISION_STATUS.UNDER_REVIEW,
  });
}

/**
 * The revision under review must be the one whose rows are the bill.
 *
 * A later upload applies its rows over the earlier revision's, so signing
 * off — let alone locking — an earlier revision would baseline rows its own
 * comparison never described. The newest applied revision is the only one
 * that can be reviewed; the older ones are superseded when the bill locks.
 */
async function assertBoqRevisionCurrent(tx, projectId, revision) {
  const newer = await tx.boqRevision.findFirst({
    where: {
      projectId,
      status: { in: CURRENT_REVISION_STATUSES },
      revisionNumber: { gt: revision.revisionNumber },
    },
    orderBy: { revisionNumber: 'desc' },
    select: { id: true, revisionNumber: true, status: true },
  });
  if (!newer) return;
  throw new HttpError(
    409,
    'BOQ_REVISION_NOT_CURRENT',
    `Revision ${revision.revisionNumber} is no longer the current BOQ: revision ${newer.revisionNumber} has applied its rows since. Review the current revision instead`,
    {
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      currentRevisionId: newer.id,
      currentRevisionNumber: newer.revisionNumber,
    },
  );
}

async function submitBoqRevision(projectId, revisionId, options = {}) {
  await assertProjectAccess(projectId, options.orgId);
  const result = await prisma.$transaction(async (tx) => {
    const revision = await findBoqRevisionInProject(projectId, revisionId, tx);
    refuseComparisonOnlyReview(revision);
    await assertBoqRevisionCurrent(tx, projectId, revision);
    refuseStaleBoqReviewStep(revision, 'submit');
    return transitionBoqRevision(tx, {
      orgId: options.orgId,
      projectId,
      revision,
      toStatus: BOQ_REVISION_STATUS.UNDER_REVIEW,
      action: auditService.ACTIONS.STATUS_CHANGED,
      comment: trimOrNull(options.comment),
      options,
      metadata: { transition: 'revision.submit' },
    });
  });
  return serializeBoqRevision(result);
}

async function approveBoqRevision(projectId, revisionId, options = {}) {
  await assertProjectAccess(projectId, options.orgId);
  const result = await prisma.$transaction(async (tx) => {
    const revision = await findBoqRevisionInProject(projectId, revisionId, tx);
    refuseComparisonOnlyReview(revision);
    await assertBoqRevisionCurrent(tx, projectId, revision);
    refuseStaleBoqReviewStep(revision, 'approve');
    return transitionBoqRevision(tx, {
      orgId: options.orgId,
      projectId,
      revision,
      toStatus: BOQ_REVISION_STATUS.APPROVED,
      action: auditService.ACTIONS.APPROVED,
      comment: trimOrNull(options.comment),
      options,
      metadata: { transition: 'revision.approve' },
    });
  });
  return serializeBoqRevision(result);
}

/**
 * Locks the bill on an approved revision.
 *
 * The lock the product already had was only ever derived — the BOQ counted as
 * locked once the schedule was baselined — so the columns for an explicit
 * lock were never written. This writes them, beside the derived rule, never
 * instead of it: `getBoqBaselineLock` answers "locked" for either. Once
 * locked there is no unlock, exactly as a baselined schedule has none; a
 * later upload becomes a comparison-only revision, and a later lock is
 * refused. Only the current revision — the newest one whose rows were
 * applied — can be locked; the earlier applied revisions, whose rows it
 * replaced, are superseded at that moment so one revision is the baseline
 * and the audit trail says which uploads led up to it.
 */
async function lockBoqBaseline(projectId, revisionId, options = {}) {
  await assertProjectAccess(projectId, options.orgId);
  const comment = trimOrNull(options.comment);

  const result = await prisma.$transaction(async (tx) => {
    const revision = await findBoqRevisionInProject(projectId, revisionId, tx);
    refuseComparisonOnlyReview(revision);

    const alreadyLocked = await tx.boqRevision.findFirst({
      where: { projectId, baselineLocked: true },
      select: { id: true, revisionNumber: true, lockedAt: true, lockedBy: true },
    });
    if (alreadyLocked) {
      throw new HttpError(
        409,
        'BOQ_BASELINE_LOCKED',
        `BOQ baseline is already locked on revision ${alreadyLocked.revisionNumber}; a locked baseline cannot be unlocked or replaced`,
        { baseline: { locked: true, source: 'boq_revision', boqRevisionId: alreadyLocked.id, revisionNumber: alreadyLocked.revisionNumber, lockedAt: alreadyLocked.lockedAt, lockedBy: alreadyLocked.lockedBy } },
      );
    }
    await assertBoqRevisionCurrent(tx, projectId, revision);
    if (revision.status !== BOQ_REVISION_STATUS.APPROVED) {
      throw new HttpError(
        409,
        'BOQ_REVISION_NOT_APPROVED',
        'Only an approved BOQ revision can be locked as the baseline',
        { revisionId: revision.id, status: revision.status },
      );
    }

    const at = new Date();
    // The earlier applied revisions: each one's rows were replaced by the
    // next upload's, and the bill being locked is the sum of them all under
    // this revision's comparison. They stop being reviewable here.
    const previous = await tx.boqRevision.findMany({
      where: {
        projectId,
        id: { not: revision.id },
        status: { in: CURRENT_REVISION_STATUSES },
      },
      orderBy: { revisionNumber: 'asc' },
    });
    for (const old of previous) {
      await transitionBoqRevision(tx, {
        orgId: options.orgId,
        projectId,
        revision: old,
        toStatus: BOQ_REVISION_STATUS.SUPERSEDED,
        action: auditService.ACTIONS.SUPERSEDED,
        comment: `Superseded by the BOQ baseline locked on revision ${revision.revisionNumber}`,
        options,
        metadata: { transition: 'revision.supersede_for_baseline', supersededByRevisionId: revision.id },
      });
    }

    const locked = await transitionBoqRevision(tx, {
      orgId: options.orgId,
      projectId,
      revision,
      toStatus: BOQ_REVISION_STATUS.BASELINED,
      data: {
        baselineLocked: true,
        lockedBy: options.userId || null,
        lockedAt: at,
      },
      action: auditService.ACTIONS.BASELINE_LOCKED,
      comment,
      options,
      metadata: { transition: 'revision.baseline' },
    });

    // The rows carry the lock too, so the grid can say so row by row.
    const lockedRows = await tx.boqItem.updateMany({
      where: { projectId, isActive: true, baselineLocked: false },
      data: { baselineLocked: true },
    });

    return { revision: locked, lockedRows: lockedRows.count };
  });

  return {
    revision: serializeBoqRevision(result.revision),
    lockedRows: result.lockedRows,
    baseline: await getBoqBaselineLock(projectId),
  };
}

/** One revision with its comparison and the review steps recorded on it. */
async function getBoqRevision(projectId, revisionId, options = {}) {
  await assertProjectAccess(projectId, options.orgId);
  const revision = await findBoqRevisionInProject(projectId, revisionId);
  const events = await approvalWorkflowService.listEventsForRecords({
    projectId,
    recordType: approvalWorkflowService.RECORD_TYPES.BOQ_REVISION,
    recordIds: [revision.id],
  });
  return {
    ...serializeBoqRevision(revision),
    source: revision.source,
    createdBy: revision.createdBy ?? null,
    comparison: revision.compareJson ?? {},
    importedRows: Array.isArray(revision.importedRowsJson)
      ? revision.importedRowsJson
      : [],
    workflowEvents: events.get(revision.id) || [],
  };
}

async function processBoqUpload(projectId, fileBuffer, label, options = {}) {
  const project = options.orgId
    ? await prisma.project.findFirst({
        where: { id: projectId, orgId: options.orgId },
        select: { orgId: true },
      })
    : await prisma.project.findUnique({
        where: { id: projectId },
        select: { orgId: true },
      });
  if (!project)
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  // A dry run parses and compares only; nothing is written and no AI job is
  // queued, so it does not spend the organisation's AI quota.
  if (!options.dryRun) await assertAiQuota(project.orgId);

  let itemsWithAmounts;
  try {
    // Step 1: Parse
    const rawRows = parseExcelInput(fileBuffer);
    if (rawRows.length === 0) {
      throw new HttpError(
        400,
        'BOQ_VALIDATION_FAILED',
        'No data rows found in file',
      );
    }

    // Step 2: Validate
    const validation = validateBoqRows(rawRows);
    if (!validation.valid) {
      throw new HttpError(
        400,
        'BOQ_VALIDATION_FAILED',
        'BOQ file contains validation errors',
        {
          errors: validation.errors,
          errorCount: validation.errorCount ?? validation.errors.length,
          truncated: Boolean(validation.truncated),
        },
      );
    }

    // Step 3: Calculate amounts
    itemsWithAmounts = rawRows.map((row, idx) => ({
      code: normalizeCode(row.code),
      description: row.description,
      qty: Number(row.quantity),
      unit: row.unit,
      rate: toMoneyNumber(row.rate),
      amount: multiplyMoney(row.quantity, row.rate),
      isManual: false,
      sortOrder: idx,
      // The optional mapping_rule column (PC-3): a named rule travels with
      // the row; an absent column or empty cell leaves the rule alone.
      ...(typeof row.mappingRule === 'string' ? { mappingRule: row.mappingRule } : {}),
    }));
  } catch (error) {
    if (options.documentId) {
      await fileStorageService
        .markDocumentRejected({
          documentId: options.documentId,
          code: error.code || 'BOQ_UPLOAD_FAILED',
          message: error.message,
        })
        .catch(() => {});
    }
    throw error;
  }

  // Step 3b: normalise the units against the organisation's list (PC-1).
  // The unit as typed is kept on every row; the code beside it is the match,
  // and a spelling nobody recognises comes back as a warning — the upload is
  // never refused for it and the cell is never corrected behind the QS.
  const unitIndex = await uomService.loadUnitIndex(project.orgId);
  const { codes: unitCodes, warnings: unitWarnings } = uomService.normaliseRows(
    unitIndex,
    itemsWithAmounts,
    { rowNumberOf: (row) => row.sortOrder + 1 },
  );
  itemsWithAmounts.forEach((item, index) => {
    item.unitCode = unitCodes[index];
  });

  if (options.dryRun) {
    // The mapping_rule column is previewed as counts: how many rows the file
    // marks required, optional or not applicable, and how many say nothing.
    const mappingRules = itemsWithAmounts.reduce(
      (acc, item) => {
        const key =
          item.mappingRule === 'not_applicable'
            ? 'notApplicable'
            : item.mappingRule || 'unspecified';
        acc[key] += 1;
        return acc;
      },
      { required: 0, optional: 0, notApplicable: 0, unspecified: 0 },
    );
    return buildBoqUploadDryRun(projectId, itemsWithAmounts, label, {
      unitWarnings,
      mappingRules,
    });
  }

  // Step 4: Persist a revision and compare/import without deleting current rows.
  let revision;
  let comparison;
  let baseline;
  let mode = BOQ_REVISION_STATUS.IMPORTED;
  const mappingRuleWarnings = [];
  try {
    await prisma.$transaction(async (trx) => {
      await assertNoManualCodeConflicts(
        projectId,
        itemsWithAmounts.map((item) => item.code),
        trx,
      );

      baseline = await getBoqBaselineLock(projectId, trx);
      mode = baseline.locked
        ? BOQ_REVISION_STATUS.COMPARISON_ONLY
        : BOQ_REVISION_STATUS.IMPORTED;

      const existingUploadedItems = await trx.boqItem.findMany({
        where: { projectId, isManual: false, isActive: true },
        select: {
          id: true,
          code: true,
          description: true,
          qty: true,
          unit: true,
          rate: true,
          amount: true,
          sortOrder: true,
          baselineLocked: true,
        },
      });

      comparison = buildBoqComparison(existingUploadedItems, itemsWithAmounts);
      revision = await createBoqRevision(trx, {
        projectId,
        label,
        status: mode,
        importedRows: itemsWithAmounts,
        comparison,
        sourceDocumentId: options.documentId || null,
        createdBy: options.userId || null,
      });

      if (options.documentId && trx.projectDocument?.update) {
        await trx.projectDocument.update({
          where: { id: options.documentId },
          data: {
            status: 'linked',
            linkedEntityType: 'boq_revision',
            linkedEntityId: revision.id,
          },
        });
      }

      const existingByCode = new Map(
        existingUploadedItems.map((item) => [rowCodeKey(item.code), item]),
      );

      // mapping_rule column (PC-3): a row that would move an item with an
      // approved allocation to not_applicable keeps its rule — the approved
      // row is an official EV basis and must be rejected first — and the
      // upload says so rather than refusing the whole bill.
      const notApplicableItemIds = itemsWithAmounts
        .filter((item) => item.mappingRule === 'not_applicable')
        .map((item) => existingByCode.get(rowCodeKey(item.code))?.id)
        .filter(Boolean);
      const blockedByApprovedAllocation = new Set(
        notApplicableItemIds.length > 0
          ? (
              await trx.activityBoqAllocation.findMany({
                where: {
                  boqItemId: { in: notApplicableItemIds },
                  isActive: true,
                  status: 'approved',
                },
                select: { boqItemId: true },
              })
            ).map((row) => row.boqItemId)
          : [],
      );

      if (baseline.locked) {
        const candidateKeys = new Set([
          ...comparison.added.map((row) => rowCodeKey(row.code)),
          ...comparison.updated.map((row) => rowCodeKey(row.code)),
        ]);

        for (const item of itemsWithAmounts) {
          if (!candidateKeys.has(rowCodeKey(item.code))) continue;
          await trx.boqItem.create({
            data: boqItemData(projectId, revision.id, item, {
              isActive: false,
              supersededReason: BOQ_BASELINE_LOCK_REASON,
            }),
          });
        }
        await recordBoqAudit({
          tx: trx,
          orgId: options.orgId,
          projectId,
          entityType: auditService.ENTITY_TYPES.BOQ_REVISION,
          entityId: revision.id,
          action: auditService.ACTIONS.IMPORTED,
          actorId: options.userId || null,
          actorRole: options.userRole || null,
          oldStatus: null,
          newStatus: mode,
          newSummary: boqRevisionAuditSummary(revision),
          summary: {
            revisionNumber: revision.revisionNumber,
            status: mode,
            itemCount: revision.itemCount,
            addedCount: revision.addedCount,
            updatedCount: revision.updatedCount,
            blockedCount: revision.blockedCount,
          },
          metadata: {
            source: 'boq.upload',
            sourceDocumentId: options.documentId || null,
            baseline,
          },
        });
        if (options.orgId) {
          await approvalWorkflowService.recordTransition({
            tx: trx,
            orgId: options.orgId,
            projectId,
            recordType: approvalWorkflowService.RECORD_TYPES.BOQ_REVISION,
            recordId: revision.id,
            fromStatus: null,
            toStatus: mode,
            actorId: options.userId || null,
            actorRole: options.userRole || null,
            metadata: {
              revisionNumber: revision.revisionNumber,
              itemCount: revision.itemCount,
              addedCount: revision.addedCount,
              updatedCount: revision.updatedCount,
              blockedCount: revision.blockedCount,
              sourceDocumentId: options.documentId || null,
              baseline,
            },
          });
        }
        return;
      }

      for (const item of itemsWithAmounts) {
        const existing = existingByCode.get(rowCodeKey(item.code));
        if (existing) {
          const ruleBlocked =
            item.mappingRule === 'not_applicable' &&
            blockedByApprovedAllocation.has(existing.id);
          if (ruleBlocked) {
            mappingRuleWarnings.push({
              code: 'MAPPING_RULE_HAS_APPROVED_ALLOCATION',
              row: item.sortOrder + 1,
              itemCode: item.code,
              boqItemId: existing.id,
              message: `Row ${item.code} has an approved allocation and keeps its mapping rule; reject the allocation before marking it not applicable`,
            });
          }
          await trx.boqItem.update({
            where: { id: existing.id },
            data: {
              revisionId: revision.id,
              code: item.code,
              activeCodeKey: activeBoqCodeKey(item.code, true),
              description: item.description,
              qty: item.qty,
              unit: item.unit,
              unitCode: item.unitCode ?? null,
              rate: item.rate,
              amount: item.amount,
              sortOrder: item.sortOrder,
              isActive: true,
              ...(item.mappingRule && !ruleBlocked
                ? { mappingRule: item.mappingRule }
                : {}),
            },
          });
        } else {
          await trx.boqItem.create({
            data: boqItemData(projectId, revision.id, item, {
              isActive: true,
            }),
          });
        }
      }

      await recordBoqAudit({
        tx: trx,
        orgId: options.orgId,
        projectId,
        entityType: auditService.ENTITY_TYPES.BOQ_REVISION,
        entityId: revision.id,
        action: auditService.ACTIONS.IMPORTED,
        actorId: options.userId || null,
        actorRole: options.userRole || null,
        oldStatus: null,
        newStatus: mode,
        newSummary: boqRevisionAuditSummary(revision),
        summary: {
          revisionNumber: revision.revisionNumber,
          status: mode,
          itemCount: revision.itemCount,
          addedCount: revision.addedCount,
          updatedCount: revision.updatedCount,
          removedCount: revision.removedCount,
        },
        metadata: {
          source: 'boq.upload',
          sourceDocumentId: options.documentId || null,
          baseline,
        },
      });
      if (options.orgId) {
        await approvalWorkflowService.recordTransition({
          tx: trx,
          orgId: options.orgId,
          projectId,
          recordType: approvalWorkflowService.RECORD_TYPES.BOQ_REVISION,
          recordId: revision.id,
          fromStatus: null,
          toStatus: mode,
          actorId: options.userId || null,
          actorRole: options.userRole || null,
          metadata: {
            revisionNumber: revision.revisionNumber,
            itemCount: revision.itemCount,
            addedCount: revision.addedCount,
            updatedCount: revision.updatedCount,
            removedCount: revision.removedCount,
            sourceDocumentId: options.documentId || null,
            baseline,
          },
        });
      }
    });
  } catch (error) {
    if (options.documentId) {
      await fileStorageService
        .markDocumentRejected({
          documentId: options.documentId,
          code: error.code || 'BOQ_UPLOAD_FAILED',
          message: error.message,
        })
        .catch(() => {});
    }
    handleBoqUniqueError(error);
  }

  // Step 5: Enqueue the durable AI job for imported active rows, or record a
  // completed job for comparison-only uploads so clients keep one polling path.
  const jobOrgId =
    options.orgId ||
    (
      await prisma.project.findUnique({
        where: { id: projectId },
        select: { orgId: true },
      })
    )?.orgId ||
    null;
  const jobContext = {
    mode,
    revision: serializeBoqRevision(revision),
    comparison: comparison?.summary ?? null,
    baseline: baseline ?? null,
  };

  if (baseline?.locked) {
    const completed = await jobService.recordCompletedJob({
      orgId: jobOrgId,
      projectId,
      type: jobService.JOB_TYPES.BOQ_PARSE,
      requestedBy: options.userId || null,
      result: jobContext,
      progress: {
        step: "BOQ revision comparison saved; baseline rows were not changed.",
        progress: 100,
      },
    });

    return {
      jobId: completed.id,
      revisionId: revision.id,
      mode,
      baselineLocked: true,
      comparison: comparison?.summary ?? null,
      unitWarnings,
      mappingRuleWarnings,
    };
  }

  const job = await jobService.enqueueJob({
    orgId: jobOrgId,
    projectId,
    type: jobService.JOB_TYPES.BOQ_PARSE,
    requestedBy: options.userId || null,
    maxAttempts: 2,
    payload: {
      projectId,
      items: itemsWithAmounts,
      label,
      revisionId: revision.id,
      userId: options.userId || null,
    },
    progress: { step: "Preparing BOQ data...", progress: 10 },
    result: jobContext,
  });

  return {
    jobId: job.id,
    revisionId: revision.id,
    mode,
    baselineLocked: false,
    comparison: comparison?.summary ?? null,
    unitWarnings,
    mappingRuleWarnings,
  };
}

/**
 * Job handler for `boq.parse`: asks the AI for activity breakdowns of the
 * imported BOQ rows and stores them as draft allocations. Runs in the worker;
 * payload: { projectId, items, label, revisionId, userId }.
 */
async function runBoqActivityJob({ job, payload = {}, updateProgress }) {
  const jobId = job.id;
  const projectId = payload.projectId || job.projectId;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const options = {
    revisionId: payload.revisionId || null,
    userId: payload.userId || job.requestedBy || null,
  };

  const setBoqJob = (_jobId, data = {}) => {
    const { status, error, ...rest } = data;
    if (status === "error") {
      throw new JobError("BOQ_AI_FAILED", error || "AI processing failed", {
        retryable: false,
      });
    }
    Promise.resolve(updateProgress?.(rest)).catch(() => {});
  };

  if (!items.length) {
    throw new JobError("BOQ_JOB_EMPTY", "No BOQ rows to process", {
      retryable: false,
    });
  }

  try {
    setBoqJob(jobId, {
      status: 'running',
      step: 'Calling AI to generate activities...',
      progress: 30,
    });

    // The project is read inside the job's organisation, never by id alone:
    // the payload names the project, but the organisation is the row's
    // (architecture doc §3, Jobs). A project of another organisation, or one
    // archived meanwhile, ends the job rather than feeding its BOQ to the AI.
    const project = await prisma.project.findFirst({
      where: { id: projectId, orgId: job.orgId },
      select: {
        name: true,
        startDate: true,
        duration: true,
        durationUnit: true,
        currency: true,
        contractValue: true,
        projectCalendar: true,
      },
    });
    if (!project) {
      throw new JobError("BOQ_JOB_PROJECT_NOT_FOUND", "The project is not in this job's organisation", {
        retryable: false,
      });
    }

    const prompt = buildBoqActivityPrompt(project, items);

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawText = message.content[0]?.text ?? '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI returned non-JSON response');
    const parsed = JSON.parse(jsonMatch[0]);

    if (job.orgId) await incrementAiUsage(job.orgId);

    setBoqJob(jobId, { step: 'Saving activities...', progress: 70 });

    // Fetch saved BOQ items to get their IDs. Existing rows keep their
    // generated activity breakdowns; only rows without activities are expanded.
    const savedItems = await prisma.boqItem.findMany({
      where: {
        projectId,
        isManual: false,
        isActive: true,
        ...(options.revisionId ? { revisionId: options.revisionId } : {}),
      },
      select: {
        id: true,
        code: true,
        description: true,
        qty: true,
        unit: true,
        rate: true,
        amount: true,
        mappingRule: true,
        activityBoqAllocations: {
          where: { isActive: true },
          select: { id: true },
          take: 1,
        },
      },
    });
    const itemByCode = Object.fromEntries(
      savedItems.map((i) => [
        i.code,
        {
          id: i.id,
          description: i.description,
          qty: i.qty,
          unit: i.unit,
          rate: i.rate,
          amount: i.amount,
          mappingRule: i.mappingRule,
          hasActivities: (i.activityBoqAllocations ?? []).length > 0,
        },
      ]),
    );

    // Track all generated activity codes for predecessor linking
    const allGeneratedCodes = {}; // boqCode -> string[]
    let activitiesCreated = 0;

    for (const boqResult of parsed.boqActivities ?? []) {
      const boqItem = itemByCode[boqResult.boqCode];
      // A not_applicable row (preliminaries, provisional sums) is priced but
      // never scheduled: the job leaves it alone rather than failing the
      // whole bill on the guard in createOfficialBoqActivityAllocation.
      if (
        !boqItem ||
        boqItem.hasActivities ||
        boqItem.mappingRule === 'not_applicable'
      ) {
        continue;
      }

      const codes = [];
      const activities = (boqResult.activities ?? []).filter((act) =>
        String(act?.activityName || '').trim(),
      );
      const boqQuantity = toNumber(boqItem.qty);
      const totalSuggestedQuantity = activities.reduce(
        (sum, act) => sum + Math.max(0, toNumber(act.quantity)),
        0,
      );
      const quantityScale =
        boqQuantity > 0 && totalSuggestedQuantity > boqQuantity
          ? boqQuantity / totalSuggestedQuantity
          : 1;

      for (let i = 0; i < activities.length; i++) {
        const act = activities[i];
        const allocatedQuantity =
          Math.max(0, toNumber(act.quantity)) * quantityScale;
        if (allocatedQuantity <= 0) continue;

        let predecessorCode = null;
        if (
          act.predecessorIndex !== null &&
          act.predecessorIndex !== undefined
        ) {
          predecessorCode = codes[act.predecessorIndex] || null;
        } else if (
          act.predecessorBoqCode &&
          act.predecessorActivityIndex !== null
        ) {
          const prevCodes = allGeneratedCodes[act.predecessorBoqCode] || [];
          predecessorCode = prevCodes[act.predecessorActivityIndex] || null;
        }

        const activity = await prisma.$transaction((tx) =>
          createOfficialBoqActivityAllocation(tx, {
            projectId,
            boqItem,
            payload: {
              activityName: act.activityName,
              unit: act.unit || boqItem.unit,
              quantity: allocatedQuantity,
              rate: toMoneyNumber(boqItem.rate) || toMoneyNumber(act.rate),
              dependencyType: act.dependencyType || null,
              predecessorCode,
              sortOrder: i,
            },
            source: 'ai',
            userId: options.userId || null,
            calendarId: project?.projectCalendar ?? null,
          }),
        );
        codes.push(activity.activityCode);
        activitiesCreated += 1;
      }
      allGeneratedCodes[boqResult.boqCode] = codes;
    }

    setBoqJob(jobId, { step: "Complete", progress: 100 });
    return { activitiesCreated };
  } catch (err) {
    console.error("[boq] AI job error:", err);
    if (err instanceof JobError) throw err;
    throw new JobError(
      err.code && typeof err.code === "string" && !/^E[A-Z]+$/.test(err.code)
        ? err.code
        : "BOQ_AI_FAILED",
      err.message || "AI processing failed. Please try uploading again.",
      { retryable: isTransientError(err) },
    );
  }
}

// ── AI Prompt ─────────────────────────────────────────────────────────────────
function buildBoqActivityPrompt(project, boqItems) {
  const startDate = project?.startDate
    ? new Date(project.startDate).toISOString().split('T')[0]
    : 'TBD';
  const currency = project?.currency ?? 'USD';
  const totalBudget = Number(project?.contractValue ?? 0);

  // Sanitize BOQ items before injecting into the prompt so malformed
  // source data (common from Excel exports) doesn't silently produce
  // undefined/NaN/null fields with no visibility.
  const sanitizedBoqItems = boqItems.map((i, idx) => ({
    code: i.code ?? `UNKNOWN_${idx}`,
    description: i.description ? i.description.substring(0, 300) : '',
    quantity: Number.isFinite(Number(i.qty)) ? Number(i.qty) : 0,
    unit: i.unit ?? 'unit',
    rate: Number.isFinite(Number(i.rate)) ? Number(i.rate) : 0,
    amount: Number.isFinite(Number(i.amount)) ? Number(i.amount) : 0,
  }));

  return `You are a construction project planning expert. Break down each BOQ item into specific construction activities and define logical dependencies between them — both within each BOQ item and across BOQ items, reflecting real-world construction sequencing.

RULES:

1. ACTIVITY COUNT
   - Generate 1-5 specific construction activities per BOQ item.
   - For non-construction items (e.g. Preliminaries, Legal Clauses, Administrative, Health & Safety), generate EXACTLY 1 summary activity or "Level of Effort" task. Do not invent construction tasks for legal clauses.
   - Simple or low-complexity BOQ items (e.g. supply-and-fix of small components, minor fittings) may have as few as 1 activity. Do NOT pad trivial items with artificial steps just to reach a higher count.

2. ACTIVITY QUALITY
   - Activities must be practical, sequential, real-world construction tasks.
   - Activity names must be specific and descriptive, max 255 characters.
   - Use standard construction sequencing logic appropriate to the trade, for example:
     - Earthworks: excavation → backfill → compaction
     - Concrete works: formwork → reinforcement → pour → curing → strip formwork
     - Masonry: layout/marking → block/brick laying → curing → plastering
     - MEP: rough-in → testing → fixing/installation → commissioning
     - Finishes: surface preparation → application → curing/drying → final inspection/cleaning
   - Adapt this logic sensibly to whatever trade each BOQ item actually represents.

3. UNITS AND QUANTITIES
   - If an activity uses the SAME unit as its parent BOQ item, the quantities of all such activities MUST sum exactly to the BOQ item's total quantity (i.e., they represent sequential sub-portions of the same measured scope).
   - If an activity uses a DIFFERENT unit than the BOQ item (e.g., the BOQ item is in m² but an activity is naturally measured in days, crew-hours, trips, or lots), assign a realistic standalone quantity for that unit — do not force it into the summation.
   - Never produce zero or negative quantities. If a BOQ item's quantity, unit, or rate is missing or zero in the input, infer a reasonable construction-realistic value for the activities, but preserve the original boqCode and description exactly as given.

4. RATE FIELD SEMANTICS
   - The "rate" field on each activity is a PLANNING/SCHEDULING rate only (e.g., for sequencing or resource-loading purposes). It is intentionally decoupled from the original BOQ item's rate and amount — do NOT try to reconcile activity rate × quantity with the BOQ item's amount. Use realistic, trade-appropriate planning rates.

5. DEPENDENCY TYPES
   - Use ONLY: "FS" (Finish-to-Start), "SS" (Start-to-Start), or null (no dependency).

6. WITHIN-ITEM DEPENDENCIES
   - Sequence activities within a BOQ item logically using FS/SS as appropriate.
   - The first activity in a BOQ item has predecessorIndex = null UNLESS it has a cross-item dependency (see Rule 7).

7. CROSS-BOQ-ITEM DEPENDENCIES (IMPORTANT)
   - Apply your construction domain knowledge of standard trade sequencing to link BOQ items together, even if the input array is not already in logical construction order. Examples:
     - Excavation/earthworks → PCC/blinding → foundation concrete → backfill → structural columns/slabs → masonry → MEP rough-in → plastering/finishes → MEP fixing → painting → final handover items.
     - Curing/waiting activities in one BOQ item often gate the start of formwork-removal or next-stage activities in a subsequent BOQ item.
   - When such a relationship exists, set dependencyType, predecessorBoqCode, and predecessorActivityIndex on the dependent activity (typically the first activity of the dependent BOQ item, but not always).
   - Do not force cross-item dependencies where none plausibly exist — independent/parallel BOQ items (e.g. unrelated external works happening concurrently) should remain null.

8. MUTUAL EXCLUSIVITY OF PREDECESSOR FIELDS
   - For any single activity, populate EXACTLY ONE of the following, never both:
     (a) predecessorIndex (same-item dependency) — in this case predecessorBoqCode and predecessorActivityIndex must be null.
     (b) predecessorBoqCode + predecessorActivityIndex (cross-item dependency) — in this case predecessorIndex must be null.
   - If dependencyType is null, all three predecessor fields must be null.

9. COMPLETENESS
   - Every BOQ item from the input array must appear exactly once in the output "boqActivities" array, in the same order as the input, with boqCode matching exactly (including case and formatting).
   - Do not skip, merge, or invent BOQ items beyond what is provided in the input.

PROJECT CONTEXT:
- Name: ${project?.name ?? 'Construction Project'}
- Start Date: ${startDate}
- Duration: ${project?.duration ?? 12} ${project?.durationUnit ?? 'months'}
- Total Budget: ${currency} ${totalBudget.toLocaleString()}

BOQ ITEMS:
${JSON.stringify(sanitizedBoqItems, null, 2)}

Respond ONLY with valid JSON matching this exact structure:
{
  "boqActivities": [
    {
      "boqCode": "<exact code from input>",
      "activities": [
        {
          "activityName": "<max 255 chars>",
          "unit": "<unit string>",
          "quantity": <number>,
          "rate": <number>,
          "dependencyType": "FS" | "SS" | null,
          "predecessorIndex": <index in this item's activities, 0-based> | null,
          "predecessorBoqCode": "<boq code of predecessor if cross-item>" | null,
          "predecessorActivityIndex": <index in predecessor BOQ item's activities> | null
        }
      ]
    }
  ]
}

Do not include any explanation, markdown, or text outside the JSON.`;
}

// ── Get Full BOQ ───────────────────────────────────────────────────────────────
async function getProjectBoq(projectId, options = {}) {
  await assertProjectAccess(projectId, options.orgId);
  const [items, allocationSummary, revisions, baseline] = await Promise.all([
    prisma.boqItem.findMany({
      where: { projectId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: boqItemInclude,
    }),
    buildAllocationSummary({ projectId }),
    prisma.boqRevision.findMany({
      where: { projectId },
      orderBy: [{ revisionNumber: 'desc' }, { createdAt: 'desc' }],
      take: 10,
    }),
    getBoqBaselineLock(projectId),
  ]);

  const serializedRevisions = revisions.map(serializeBoqRevision);
  const currentRevision =
    serializedRevisions.find((revision) =>
      CURRENT_REVISION_STATUSES.includes(revision.status),
    ) || null;
  const latestRevision = serializedRevisions[0] || null;

  if (items.length === 0) {
    return {
      projectId,
      hasUploadedBoq: false,
      uploadedAt: null,
      items: [],
      financial: null,
      allocationSummary,
      baseline,
      currentRevision,
      latestRevision,
      revisions: serializedRevisions,
    };
  }

  const financial = await calculateProjectFinancials(
    projectId,
    items,
    allocationSummary,
  );
  const allocationByItem = allocationMap(allocationSummary);

  const latestItem = items.reduce(
    (latest, item) =>
      !latest || item.createdAt > latest.createdAt ? item : latest,
    null,
  );

  return {
    projectId,
    hasUploadedBoq: true,
    uploadedAt: currentRevision?.createdAt ?? latestItem?.createdAt ?? null,
    items: items.map((item) => mapBoqItem(item, allocationByItem.get(item.id))),
    financial,
    allocationSummary,
    baseline,
    currentRevision,
    latestRevision,
    revisions: serializedRevisions,
  };
}

function mapBoqItem(item, allocationTotals = null) {
  return {
    id: item.id,
    code: item.code || item.ref || '',
    description: item.description,
    quantity: item.qty,
    unit: item.unit,
    // Structure keys (PC-1): unitCode is the normalised unit beside the one
    // typed; the rest say where the row sits in the WBS, on site and in the
    // budget, and whether it must be scheduled at all.
    unitCode: item.unitCode ?? null,
    wbsNodeId: item.wbsNodeId ?? null,
    locationId: item.locationId ?? null,
    costCodeId: item.costCodeId ?? null,
    mappingRule: item.mappingRule ?? 'required',
    rate: item.rate,
    amount: item.amount,
    isManual: item.isManual,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    revisionId: item.revisionId ?? null,
    isActive: item.isActive ?? true,
    baselineLocked: Boolean(item.baselineLocked),
    activeAllocatedQuantity: allocationTotals?.activeAllocatedQuantity ?? 0,
    activeAllocatedAmount: allocationTotals?.activeAllocatedAmount ?? 0,
    approvedAllocatedQuantity: allocationTotals?.approvedAllocatedQuantity ?? 0,
    approvedAllocatedAmount: allocationTotals?.approvedAllocatedAmount ?? 0,
    pendingAllocatedAmount: allocationTotals?.pendingAllocatedAmount ?? 0,
    scheduledQuantity: allocationTotals?.scheduledQuantity ?? 0,
    scheduledValue: allocationTotals?.scheduledValue ?? 0,
    unscheduledQuantity:
      allocationTotals?.unscheduledQuantity ?? Number(item.qty || 0),
    unscheduledValue:
      allocationTotals?.unscheduledValue ?? toMoneyNumber(item.amount),
    earnedValue: allocationTotals?.earnedValue ?? 0,
    certifiedValue: allocationTotals?.certifiedValue ?? 0,
    unallocatedQuantity:
      allocationTotals?.unallocatedQuantity ?? Number(item.qty || 0),
    unallocatedAmount:
      allocationTotals?.unallocatedAmount ?? toMoneyNumber(item.amount),
    activities: (item.activityBoqAllocations ?? []).map((allocation) =>
      mapActivityAllocation(allocation, item),
    ),
  };
}

function mapActivityAllocation(allocation, boqItem) {
  const dependency = dependencyDisplay(allocation.activity);
  const quantity = toNumber(allocation.quantity);
  const amount = toMoneyNumber(allocation.amount);

  return {
    id: allocation.activityId,
    allocationId: allocation.id,
    boqItemId: allocation.boqItemId,
    activityCode: activityDisplayCode(allocation.activity),
    activityName: allocation.activity?.name ?? '',
    unit: boqItem.unit ?? null,
    quantity,
    rate:
      quantity > 0
        ? divideMoney(amount, quantity)
        : toMoneyNumber(boqItem.rate),
    budget: amount,
    dependencyType: dependency.dependencyType,
    predecessorCode: dependency.predecessorCode,
    isManual: allocation.source === 'manual',
    source: allocation.source,
    allocationStatus: allocation.status,
    sortOrder: allocation.activity?.sortOrder ?? boqItem.sortOrder ?? 0,
  };
}

// ── Update BOQ Item ───────────────────────────────────────────────────────────
async function updateBoqItem(projectId, itemId, data, options = {}) {
  await assertProjectAccess(projectId, options.orgId);
  await assertBoqEditable(projectId);
  const existing = await findBoqItemInProject(projectId, itemId);
  if (!existing)
    throw new HttpError(404, 'BOQ_ITEM_NOT_FOUND', 'BOQ item not found');
  if (existing.isActive === false) {
    throw new HttpError(
      409,
      'BOQ_ITEM_INACTIVE',
      'Historical BOQ rows cannot be edited from the current BOQ grid',
    );
  }

  const updateData = {};
  if (data.code !== undefined) {
    const code = normalizeCode(data.code);
    if (code !== existing.code) {
      await assertUniqueBoqItemCode(projectId, code, prisma, itemId);
    }
    updateData.code = code;
    updateData.activeCodeKey = activeBoqCodeKey(
      code,
      existing.isActive !== false,
    );
  }
  if (data.description !== undefined) updateData.description = data.description;
  if (data.quantity !== undefined) {
    updateData.qty = Number(data.quantity);
  }
  // A unit edit keeps what was typed and refreshes the normalised code beside
  // it; a spelling the organisation does not know is a warning, not a refusal.
  let unitWarning = null;
  if (data.unit !== undefined) {
    updateData.unit = data.unit;
    const normalised = await uomService.normalise({ orgId: options.orgId, unit: data.unit });
    updateData.unitCode = normalised.unitCode;
    unitWarning = normalised.warning;
  }
  if (data.rate !== undefined) updateData.rate = toMoneyNumber(data.rate);

  // Recalculate amount if qty or rate changed
  if (updateData.qty !== undefined || updateData.rate !== undefined) {
    const qty = updateData.qty ?? existing.qty;
    const rate = updateData.rate ?? existing.rate;
    updateData.amount = multiplyMoney(qty, rate);
  }

  let updated;
  let allocationWarnings = [];
  let rederivedAllocations = [];
  try {
    updated = await prisma.$transaction(async (tx) => {
      const row = await tx.boqItem.update({
        where: { id: itemId },
        data: updateData,
        include: boqItemInclude,
      });
      await recordBoqAudit({
        tx,
        orgId: options.orgId,
        projectId,
        entityType: auditService.ENTITY_TYPES.BOQ_ITEM,
        entityId: itemId,
        action: auditService.ACTIONS.UPDATED,
        actorId: options.userId || null,
        actorRole: options.userRole || null,
        oldSummary: boqItemAuditSummary(existing),
        newSummary: boqItemAuditSummary(row),
        summary: {
          code: row.code || null,
          description: row.description,
          amount: toMoneyNumber(row.amount),
        },
        metadata: { source: 'boq.manual_grid' },
      });
      // A rate or quantity change on an unlocked row (PC-3): draft
      // allocations are re-derived from what was typed for them; approved
      // rows are source rows and are only reported.
      if (updateData.rate !== undefined || updateData.qty !== undefined) {
        const rederived = await rederiveAllocationsForBoqItem(
          { projectId, boqItemId: itemId, userId: options.userId || null },
          tx,
        );
        allocationWarnings = rederived.warnings;
        rederivedAllocations = rederived.rederived;
      }
      return row;
    });
  } catch (error) {
    handleBoqAllocationCapacityError(error, itemId);
    handleBoqUniqueError(error);
  }

  const [allItems, allocationSummary] = await Promise.all([
    prisma.boqItem.findMany({ where: { projectId, isActive: true } }),
    buildAllocationSummary({ projectId }),
  ]);
  const financial = await calculateProjectFinancials(
    projectId,
    allItems,
    allocationSummary,
  );
  const allocationByItem = allocationMap(allocationSummary);

  return {
    item: mapBoqItem(updated, allocationByItem.get(updated.id)),
    financial,
    unitWarning,
    allocationWarnings,
    rederivedAllocations,
  };
}

// ── Create Manual BOQ Row ─────────────────────────────────────────────────────
async function createManualBoqItem(projectId, data, options = {}) {
  await assertProjectAccess(projectId, options.orgId);
  await assertBoqEditable(projectId);
  const code = normalizeCode(data.code);
  const amount = multiplyMoney(data.quantity, data.rate);
  // The unit stays as typed; the code beside it is the organisation's match,
  // and an unknown spelling is reported back as a warning (PC-1).
  const normalisedUnit = await uomService.normalise({ orgId: options.orgId, unit: data.unit });

  let itemWithActivities;
  try {
    itemWithActivities = await prisma.$transaction(async (tx) => {
      await assertUniqueBoqItemCode(projectId, code, tx);
      const count = await tx.boqItem.count({ where: { projectId } });
      const calendarId = await getProjectCalendar(projectId, tx);

      const item = await tx.boqItem.create({
        data: {
          projectId,
          code,
          activeCodeKey: activeBoqCodeKey(code, true),
          description: data.description,
          qty: Number(data.quantity),
          unit: data.unit,
          unitCode: normalisedUnit.unitCode,
          rate: toMoneyNumber(data.rate),
          amount,
          isManual: true,
          sortOrder: count,
        },
      });

      // A row may name an activity that exists, describe one to create, or name
      // neither — the last leaves the row unallocated so its quantity can be
      // split across several activities afterwards, which is what a bill item
      // spanning more than one piece of work actually needs.
      if (data.activityId || data.activityName) {
        await createOfficialBoqActivityAllocation(tx, {
          projectId,
          boqItem: item,
          payload: {
            activityId: data.activityId,
            activityName: data.activityName,
            quantity: Number(data.quantity),
            rate: toMoneyNumber(data.rate),
          },
          source: "manual",
          userId: options.userId || null,
          calendarId,
        });
      }

      const row = await tx.boqItem.findUnique({
        where: { id: item.id },
        include: boqItemInclude,
      });
      await recordBoqAudit({
        tx,
        orgId: options.orgId,
        projectId,
        entityType: auditService.ENTITY_TYPES.BOQ_ITEM,
        entityId: item.id,
        action: auditService.ACTIONS.CREATED,
        actorId: options.userId || null,
        actorRole: options.userRole || null,
        oldStatus: null,
        newStatus: 'draft',
        newSummary: boqItemAuditSummary(row),
        summary: {
          code: row.code || null,
          description: row.description,
          amount: toMoneyNumber(row.amount),
        },
        metadata: { source: 'boq.manual_grid' },
      });
      return row;
    });
  } catch (error) {
    handleBoqUniqueError(error);
  }

  const [allItems, allocationSummary] = await Promise.all([
    prisma.boqItem.findMany({ where: { projectId, isActive: true } }),
    buildAllocationSummary({ projectId }),
  ]);
  const financial = await calculateProjectFinancials(
    projectId,
    allItems,
    allocationSummary,
  );
  const allocationByItem = allocationMap(allocationSummary);

  return {
    item: mapBoqItem(
      itemWithActivities,
      allocationByItem.get(itemWithActivities.id),
    ),
    financial,
    unitWarning: normalisedUnit.warning,
  };
}

// ── Delete BOQ Item ───────────────────────────────────────────────────────────
/**
 * Whether removing a BOQ row's allocation retires the activity it points at:
 * only an activity the row itself minted (marked with the row when the row
 * created it) that carries no ledger entry, no stock movement, no cost record
 * and no live allocation on another row. Anything else — an activity the row
 * was merely allocated to, or one minted before the mark existed — keeps its
 * schedule and its history; only the allocation goes (Phase 21D, P21-169,
 * CX21-544).
 */
async function retiresWithRow(tx, { projectId, activityId, boqItemId }) {
  if (!tx.activity?.findFirst) return false;
  const activity = await tx.activity.findFirst({
    where: { id: activityId, projectId, mintedByBoqItemId: boqItemId },
    select: { id: true },
  });
  if (!activity) return false;
  const footprint = await Promise.all([
    tx.costLedgerEntry?.count ? tx.costLedgerEntry.count({ where: { activityId } }) : 0,
    tx.stockTransaction?.count ? tx.stockTransaction.count({ where: { activityId } }) : 0,
    tx.costRecord?.count ? tx.costRecord.count({ where: { activityId } }) : 0,
    tx.activityBoqAllocation?.count ? tx.activityBoqAllocation.count({ where: { activityId, isActive: true, boqItemId: { not: boqItemId } } }) : 0,
  ]);
  return footprint.every((count) => !count);
}

async function deleteBoqItem(projectId, itemId, options = {}) {
  await assertProjectAccess(projectId, options.orgId);
  await assertBoqEditable(projectId);
  const item = await findBoqItemInProject(projectId, itemId);
  if (!item)
    throw new HttpError(404, 'BOQ_ITEM_NOT_FOUND', 'BOQ item not found');
  if (item.isActive === false) {
    throw new HttpError(
      409,
      'BOQ_ITEM_INACTIVE',
      'Historical BOQ rows cannot be deleted',
    );
  }
  if (!item.isManual) {
    throw new HttpError(
      403,
      'BOQ_ITEM_NOT_DELETABLE',
      'Uploaded BOQ rows cannot be deleted',
    );
  }

  const allocations = await prisma.activityBoqAllocation.findMany({
    where: { projectId, boqItemId: itemId, isActive: true },
    select: { id: true, activityId: true, status: true },
  });
  const protectedAllocation = allocations.find(
    (allocation) =>
      activeStatuses.includes(allocation.status) &&
      allocation.status !== 'draft',
  );
  if (protectedAllocation) {
    throw new HttpError(
      409,
      'BOQ_ITEM_HAS_LINKED_ALLOCATIONS',
      'BOQ rows with submitted or approved activity allocations must be revised through the allocation workflow.',
    );
  }

  await prisma.$transaction(async (tx) => {
    // The eligibility check ran before the lock; hold the row and re-read the
    // allocations under it, so a submission or approval that landed since is
    // caught and not overwritten (Phase 21D, CX21-553).
    if (tx.$queryRaw) await tx.$queryRaw`SELECT id FROM "BoqItem" WHERE id = ${itemId} FOR UPDATE`;
    const held = tx.activityBoqAllocation.findMany
      ? await tx.activityBoqAllocation.findMany({ where: { projectId, boqItemId: itemId, isActive: true }, select: { id: true, activityId: true, status: true } })
      : allocations;
    const heldProtected = held.find((allocation) => activeStatuses.includes(allocation.status) && allocation.status !== 'draft');
    if (heldProtected) throw new HttpError(409, 'BOQ_ITEM_HAS_LINKED_ALLOCATIONS', 'BOQ rows with submitted or approved activity allocations must be revised through the allocation workflow.');
    if (held.length > 0) {
      await tx.activityBoqAllocation.updateMany({
        where: { id: { in: held.map((allocation) => allocation.id) } },
        data: {
          status: 'rejected',
          isActive: false,
          rejectedBy: options.userId || null,
          rejectedAt: new Date(),
          rejectedReason: 'Manual BOQ row deleted before allocation approval',
          updatedBy: options.userId || null,
        },
      });
      // Only an activity the row itself minted, marked as such, and that
      // carries nothing else retires with it; anything else keeps its
      // schedule and its history — a delete retired a live activity with
      // stock issued against it (P21-169), and creation time was then taken
      // for origin (CX21-544).
      const minted = [];
      for (const allocation of held) {
        if (await retiresWithRow(tx, { projectId, activityId: allocation.activityId, boqItemId: itemId })) minted.push(allocation.activityId);
      }
      if (minted.length) {
        await tx.activity.updateMany({
          where: { id: { in: minted } },
          data: {
            isActive: false,
            retiredAt: new Date(),
            retiredBy: options.userId || null,
            retiredReason: 'Manual BOQ row deleted before allocation approval',
          },
        });
      }
    }

    await tx.boqItem.delete({ where: { id: itemId } });
    await recordBoqAudit({
      tx,
      orgId: options.orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.BOQ_ITEM,
      entityId: itemId,
      action: auditService.ACTIONS.DELETED,
      actorId: options.userId || null,
      actorRole: options.userRole || null,
      oldStatus: item.isActive === false ? 'inactive' : 'active',
      newStatus: null,
      oldSummary: boqItemAuditSummary(item),
      summary: {
        code: item.code || null,
        description: item.description,
        amount: toMoneyNumber(item.amount),
      },
      metadata: {
        source: 'boq.manual_grid',
        retiredAllocationIds: allocations.map((allocation) => allocation.id),
      },
    });
  });

  const [allItems, allocationSummary] = await Promise.all([
    prisma.boqItem.findMany({ where: { projectId, isActive: true } }),
    buildAllocationSummary({ projectId }),
  ]);
  const financial = await calculateProjectFinancials(
    projectId,
    allItems,
    allocationSummary,
  );

  return { financial };
}

// ── Create Activity ───────────────────────────────────────────────────────────
async function createActivity(projectId, boqItemId, data, options = {}) {
  await assertProjectAccess(projectId, options.orgId);
  await assertBoqEditable(projectId);
  const item = await findBoqItemInProject(projectId, boqItemId);
  if (!item)
    throw new HttpError(404, 'BOQ_ITEM_NOT_FOUND', 'BOQ item not found');
  if (item.isActive === false) {
    throw new HttpError(
      409,
      'BOQ_ITEM_INACTIVE',
      'Historical BOQ rows cannot receive new activities',
    );
  }

  let activity;
  try {
    activity = await prisma.$transaction(async (tx) => {
      const calendarId = await getProjectCalendar(projectId, tx);
      const count = await tx.activityBoqAllocation.count({
        where: { boqItemId, isActive: true },
      });

      return createOfficialBoqActivityAllocation(tx, {
        projectId,
        boqItem: item,
        payload: {
          activityId: data.activityId,
          activityName: data.activityName,
          quantity: Number(data.quantity) || 0,
          rate: toMoneyNumber(data.rate),
          dependencyType: data.dependencyType || null,
          predecessorCode: data.predecessorCode || null,
          sortOrder: count,
        },
        source: 'manual',
        userId: options.userId || null,
        calendarId,
      });
    });
  } catch (error) {
    handleBoqUniqueError(error);
  }

  return { activity };
}

function findAllocationForBoqActivity(
  projectId,
  activityId,
  allocationId = null,
  tx = prisma,
) {
  return tx.activityBoqAllocation.findFirst({
    where: {
      projectId,
      activityId,
      id: allocationId || undefined,
      isActive: true,
    },
    include: {
      boqItem: true,
      activity: {
        include: {
          predecessorLinks: {
            include: {
              predecessor: {
                select: {
                  id: true,
                  name: true,
                  activityCode: true,
                  p6ActivityId: true,
                  wbsCode: true,
                  sortOrder: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });
}

// ── Update Activity ──────────────────────────────────────────────────────────
async function updateActivity(projectId, activityId, data, options = {}) {
  await assertProjectAccess(projectId, options.orgId);
  await assertBoqEditable(projectId);
  const existing = await findAllocationForBoqActivity(
    projectId,
    activityId,
    data?.allocationId || null,
  );
  if (!existing)
    throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found');
  if (existing.status !== 'draft') {
    throw new HttpError(
      409,
      'ALLOCATION_NOT_EDITABLE',
      'Only draft activity BOQ allocations can be edited from the BOQ grid',
    );
  }

  const quantity =
    data.quantity !== undefined
      ? toNumber(data.quantity)
      : toNumber(existing.quantity);
  const rate =
    data.rate !== undefined
      ? toMoneyNumber(data.rate)
      : quantity > 0
        ? divideMoney(existing.amount, quantity)
        : toMoneyNumber(existing.boqItem.rate);
  const amount =
    data.quantity !== undefined || data.rate !== undefined
      ? multiplyMoney(quantity, rate)
      : toMoneyNumber(existing.amount);
  assertPositiveAllocationValues({ quantity, amount });

  const existingTotals = await getActiveAllocationTotalsForBoqItem({
    boqItemId: existing.boqItemId,
    excludeAllocationId: existing.id,
  });
  assertAllocationCapacity({
    boqItem: existing.boqItem,
    existingTotals,
    nextQuantity: quantity,
    nextAmount: amount,
  });

  const updated = await prisma.$transaction(async (tx) => {
    const activityData = {};
    if (data.activityName !== undefined) {
      activityData.name = String(data.activityName || '').trim();
    }
    if (
      data.dependencyType !== undefined ||
      data.predecessorCode !== undefined
    ) {
      const predecessorCode = trimOrNull(data.predecessorCode);
      const dependencyType = data.dependencyType || 'FS';
      activityData.predecessors = predecessorCode
        ? `${predecessorCode} ${dependencyType}`
        : null;
    }
    if (Object.keys(activityData).length > 0) {
      await tx.activity.update({
        where: { id: existing.activityId },
        data: activityData,
      });
      if (activityData.predecessors !== undefined) {
        if (activityData.predecessors) {
          await replaceActivityDependencies(tx, {
            projectId,
            successorId: existing.activityId,
            predecessors: activityData.predecessors,
            source: existing.source || 'manual',
          });
        } else {
          await tx.activityDependency.deleteMany({
            where: { projectId, successorId: existing.activityId },
          });
        }
      }
    }

    await tx.activityBoqAllocation.update({
      where: { id: existing.id },
      data: {
        quantity,
        amount,
        weight: computeDefaultWeight({
          amount,
          boqItem: existing.boqItem,
        }),
        updatedBy: options.userId || null,
      },
    });

    return findAllocationForBoqActivity(
      projectId,
      existing.activityId,
      existing.id,
      tx,
    );
  });

  return { activity: mapActivityAllocation(updated, updated.boqItem) };
}

// ── Delete Activity ──────────────────────────────────────────────────────────
async function deleteActivity(projectId, activityId, options = {}) {
  await assertProjectAccess(projectId, options.orgId);
  await assertBoqEditable(projectId);
  if (!options.allocationId) {
    const activeAllocations = await prisma.activityBoqAllocation.findMany({
      where: { projectId, activityId, isActive: true },
      select: { id: true },
    });
    if (activeAllocations.length > 1) {
      throw new HttpError(
        409,
        'ALLOCATION_NOT_EDITABLE',
        'This schedule activity has multiple BOQ allocations. Remove the specific allocation from the allocation workflow.',
      );
    }
  }

  const allocation = await findAllocationForBoqActivity(
    projectId,
    activityId,
    options.allocationId || null,
  );
  if (!allocation)
    throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found');
  if (allocation.status !== 'draft') {
    throw new HttpError(
      409,
      'ALLOCATION_NOT_EDITABLE',
      'Submitted or approved activity allocations must be rejected or revised before removing the schedule activity',
    );
  }

  let activityRetired = false;
  await prisma.$transaction(async (tx) => {
    // Held and re-read under the lock: the status was checked before the
    // transaction, so a submission or approval that landed since is not
    // overwritten (Phase 21D, CX21-553).
    if (tx.$queryRaw) await tx.$queryRaw`SELECT id FROM "ActivityBoqAllocation" WHERE id = ${allocation.id} FOR UPDATE`;
    const fresh = tx.activityBoqAllocation.findFirst
      ? await tx.activityBoqAllocation.findFirst({ where: { id: allocation.id }, select: { status: true, isActive: true } })
      : allocation;
    if (fresh && (fresh.isActive === false || fresh.status !== 'draft')) {
      throw new HttpError(409, 'ALLOCATION_NOT_EDITABLE', 'Submitted or approved activity allocations must be rejected or revised before removing the schedule activity');
    }
    await tx.activityBoqAllocation.update({
      where: { id: allocation.id },
      data: {
        status: 'rejected',
        isActive: false,
        rejectedBy: options.userId || null,
        rejectedAt: new Date(),
        rejectedReason:
          'BOQ helper activity deleted before allocation approval',
        updatedBy: options.userId || null,
      },
    });
    // The activity itself goes only if the row minted it and nothing else
    // touched it; a live activity the link merely pointed at keeps its
    // schedule and its history — this path retired one with stock issued
    // against it (CX21-544).
    activityRetired = await retiresWithRow(tx, { projectId, activityId, boqItemId: allocation.boqItemId });
    if (activityRetired) {
      await tx.activity.update({
        where: { id: activityId },
        data: {
          isActive: false,
          retiredAt: new Date(),
          retiredBy: options.userId || null,
          retiredReason: 'BOQ helper activity deleted before allocation approval',
        },
      });
    }
  });

  return { allocationRejected: true, activityRetired };
}

/**
 * Activities that look like a shadow of the real programme.
 *
 * The shape is specific: an activity carrying live bill allocations, with no
 * duration and no logic joining it to anything, on a project where other
 * activities do have duration or logic. That is what a bill row minting its own
 * activity leaves behind once a real programme exists — money on a stub that is
 * on nobody's critical path and has no dates.
 *
 * It reports and stops there. Whether two activities are the same piece of work
 * is a judgement about the job, not a fact in the data, and acting on it would
 * move financial history.
 */
async function findShadowActivities(projectId, options = {}) {
  await assertProjectAccess(projectId, options.orgId);

  const activities = await prisma.activity.findMany({
    where: { projectId, isActive: true },
    select: {
      id: true,
      name: true,
      activityCode: true,
      p6ActivityId: true,
      duration: true,
      startDate: true,
      _count: { select: { predecessorLinks: true, successorLinks: true } },
    },
  });

  const hasLogic = (a) => a._count.predecessorLinks > 0 || a._count.successorLinks > 0;
  const hasDuration = (a) => Number(a.duration) > 0;
  const realProgrammeExists = activities.some((a) => hasDuration(a) || hasLogic(a));

  const allocations = await prisma.activityBoqAllocation.groupBy({
    by: ["activityId"],
    where: { projectId, isActive: true },
    _sum: { amount: true, quantity: true },
    _count: { _all: true },
  });
  const allocated = new Map(allocations.map((row) => [row.activityId, row]));

  const items = realProgrammeExists
    ? activities
        .filter((a) => allocated.has(a.id) && !hasDuration(a) && !hasLogic(a))
        .map((a) => {
          const row = allocated.get(a.id);
          return {
            code: "POTENTIAL_SHADOW_ACTIVITY",
            activityId: a.id,
            activityCode: a.activityCode,
            p6ActivityId: a.p6ActivityId,
            name: a.name,
            allocationCount: row._count._all,
            allocatedAmount: toMoneyNumber(row._sum.amount || 0),
            allocatedQuantity: Number(row._sum.quantity || 0),
            why: "Carries bill value but has no duration and no logic, on a project that already has a programme",
            sameNameAs: activities
              .filter(
                (other) =>
                  other.id !== a.id &&
                  String(other.name).trim().toLowerCase() === String(a.name).trim().toLowerCase(),
              )
              .map((other) => ({
                activityId: other.id,
                activityCode: other.activityCode,
                p6ActivityId: other.p6ActivityId,
                duration: other.duration,
              })),
          };
        })
    : [];

  return {
    projectId,
    scannedActivities: activities.length,
    realProgrammeExists,
    items,
    note: "Reported for review only. Nothing is merged or moved automatically.",
  };
}

module.exports = {
  findShadowActivities,
  runBoqActivityJob,
  // Exported so the prompt can be inspected and regression-tested without
  // calling the model. Main added this as a second `module.exports` beside the
  // function itself, which this assignment silently overwrote, so it is
  // listed here instead (Phase 20.6).
  buildBoqActivityPrompt,
  generateBoqTemplate,
  processBoqUpload,
  getProjectBoq,
  getBoqRevision,
  submitBoqRevision,
  approveBoqRevision,
  lockBoqBaseline,
  getBoqBaselineLock,
  BOQ_REVISION_STATUS,
  updateBoqItem,
  createManualBoqItem,
  deleteBoqItem,
  createActivity,
  updateActivity,
  deleteActivity,
};
