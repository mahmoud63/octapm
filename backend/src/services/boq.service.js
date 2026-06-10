const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { nextActivityCode } = require('../utils/activity-code');
const {
  addMoney,
  assertMoneyInput,
  divideMoney,
  multiplyMoney,
  toMoneyNumber,
} = require('../utils/money');
const { calculateFinancials } = require('./boq-calculation.service');
const { assertAiQuota, incrementAiUsage } = require('../middleware/subscription-gate');
const {
  assertAllocationCapacity,
  buildAllocationSummary,
  computeDefaultWeight,
} = require('./activity-boq-allocation.service');
const {
  replaceActivityDependencies,
} = require('./activity-dependency.service');
const fileStorageService = require('./file-storage.service');
const auditService = require('./audit.service');
const approvalWorkflowService = require('./approval-workflow.service');

const BOQ_REVISION_STATUS = Object.freeze({
  IMPORTED: 'imported',
  COMPARISON_ONLY: 'comparison_only',
});

const BOQ_BASELINE_LOCK_REASON =
  'Pending BOQ revision comparison; baseline is locked';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 120_000,
});

const normalizeCode = (value) => String(value ?? '').trim();
const activeStatuses = ['draft', 'submitted', 'approved'];
const trimOrNull = (value) => {
  const text = String(value ?? '').trim();
  return text || null;
};

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const dateSummary = (value) =>
  value ? new Date(value).toISOString() : null;

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

function handleBoqUniqueError(error) {
  if (error?.code !== 'P2002') throw error;

  const target = Array.isArray(error.meta?.target)
    ? error.meta.target
    : [String(error.meta?.target || '')];

  if (target.includes('activityCode')) {
    throw duplicateBoqActivityCodeError('generated');
  }

  if (target.includes('code')) {
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
    throw new HttpError(400, 'BOQ_ITEM_CODE_REQUIRED', 'BOQ item code is required');
  }

  const where = { projectId, code: normalizedCode, isActive: true };
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
      code: { in: normalizedCodes },
    },
    select: { code: true },
  });

  if (conflicts.length > 0) {
    throw duplicateBoqItemCodeError(conflicts[0].code);
  }
}

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
      baselinedSchedule?.baselinedAt ??
      lockedBoqRevision?.lockedAt ??
      null,
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
    .filter((item) => normalizeCode(item.code) && !incomingKeys.has(rowCodeKey(item.code)))
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

async function createBoqRevision(tx, {
  projectId,
  label,
  status,
  importedRows,
  comparison,
  sourceDocumentId = null,
  createdBy = null,
}) {
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
  return {
    projectId,
    revisionId,
    code: item.code,
    description: item.description,
    qty: item.qty,
    unit: item.unit,
    rate: item.rate,
    amount: item.amount,
    isManual: false,
    sortOrder: item.sortOrder,
    ...overrides,
  };
}

async function calculateProjectFinancials(projectId, items, summary = null) {
  const allocationSummary = summary || (await buildAllocationSummary({ projectId }));
  return calculateFinancials(items, allocationSummary);
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
  return activity?.p6ActivityId || activity?.wbsCode || activity?.id || '';
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
  const quantity = toNumber(payload.quantity);
  const rate = toMoneyNumber(payload.rate ?? boqItem.rate);
  const amount =
    payload.amount !== undefined && payload.amount !== null
      ? toMoneyNumber(payload.amount)
      : multiplyMoney(quantity, rate);
  const activityName = String(payload.activityName || '').trim();

  if (!activityName) {
    throw new HttpError(
      400,
      'MISSING_FIELDS',
      'activityName is required',
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
    ? `${predecessorCode} ${dependencyType || 'FS'}`
    : null;

  const activity = await tx.activity.create({
    data: {
      projectId,
      name: activityName,
      wbsCode: activityCode,
      calendarId,
      category: payload.category || null,
      duration: Number(payload.duration) || 0,
      budget: amount,
      predecessors: predecessorText,
      batchId: payload.batchId || null,
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

// ── In-memory job store ───────────────────────────────────────────────────────
const boqJobs = new Map();

function setBoqJob(jobId, data) {
  boqJobs.set(jobId, { ...boqJobs.get(jobId), ...data, updatedAt: Date.now() });
}

function getBoqJob(jobId) {
  return boqJobs.get(jobId) || null;
}

// Clean up jobs older than 2 hours
const boqJobCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of boqJobs) {
    if (job.updatedAt < cutoff) boqJobs.delete(id);
  }
}, 30 * 60 * 1000);
boqJobCleanupTimer.unref?.();

// ── Excel Template ────────────────────────────────────────────────────────────
async function generateBoqTemplate() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('BOQ');

  sheet.columns = [
    { header: 'Code', key: 'code', width: 12 },
    { header: 'Description', key: 'description', width: 45 },
    { header: 'Quantity', key: 'quantity', width: 12 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Rate', key: 'rate', width: 14 },
    { header: 'Amount', key: 'amount', width: 16 },
  ];

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 22;

  // Example rows
  const examples = [
    { code: '1.1', description: 'Site Clearance and Demolition', quantity: 1200, unit: 'm²', rate: 15, amount: 18000 },
    { code: '1.2', description: 'Bulk Excavation', quantity: 3500, unit: 'm³', rate: 22, amount: 77000 },
    { code: '2.1', description: 'Reinforced Concrete Foundation', quantity: 450, unit: 'm³', rate: 350, amount: 157500 },
  ];

  examples.forEach((row) => {
    const r = sheet.addRow(row);
    r.getCell('amount').numFmt = '#,##0.00';
    r.getCell('rate').numFmt = '#,##0.00';
    r.getCell('quantity').numFmt = '#,##0.##';
  });

  // Note row
  sheet.addRow([]);
  const noteRow = sheet.addRow(['Note: The "Amount" column is auto-calculated (Quantity × Rate). You may leave it blank.']);
  noteRow.font = { italic: true, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(`A${noteRow.number}:F${noteRow.number}`);

  return workbook;
}

// ── Excel Parsing & Validation ────────────────────────────────────────────────
const REQUIRED_HEADERS = ['code', 'description', 'quantity', 'unit', 'rate'];
const HEADER_ALIASES = {
  'item no': 'code',
  'item number': 'code',
  'item code': 'code',
  'no': 'code',
  'no.': 'code',
  'desc': 'description',
  'item description': 'description',
  'work description': 'description',
  qty: 'quantity',
  'qty.': 'quantity',
  'unit rate': 'rate',
  'unit price': 'rate',
  'total': 'amount',
  'total amount': 'amount',
  'line total': 'amount',
};

function normalizeHeader(h) {
  return (h ?? '').toString().toLowerCase().trim().replace(/\s+/g, ' ');
}

function parseWorkbookRows(wb) {
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rows.length < 2) throw new HttpError(400, 'BOQ_VALIDATION_FAILED', 'File appears empty');

  // Find header row (first row with recognizable columns)
  let headerRowIdx = 0;
  let columnMap = {};

  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const rowHeaders = rows[i].map(normalizeHeader);
    const map = {};
    rowHeaders.forEach((h, idx) => {
      const canonical = HEADER_ALIASES[h] || h;
      if (REQUIRED_HEADERS.includes(canonical)) map[canonical] = idx;
    });
    if (Object.keys(map).length >= 3) {
      headerRowIdx = i;
      columnMap = map;
      break;
    }
  }

  const missing = REQUIRED_HEADERS.filter((h) => columnMap[h] === undefined && h !== 'amount');
  if (missing.length > 0) {
    throw new HttpError(400, 'BOQ_VALIDATION_FAILED', `Missing required columns: ${missing.join(', ')}`, {
      errors: [{ code: 'MISSING_COLUMNS', message: `Columns not found: ${missing.join(', ')}` }],
    });
  }

  const dataRows = rows.slice(headerRowIdx + 1);
  const parsed = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rawCode = row[columnMap.code];
    const rawDesc = row[columnMap.description];
    const rawQty = row[columnMap.quantity];
    const rawUnit = row[columnMap.unit];
    const rawRate = row[columnMap.rate];

    // Skip empty rows
    if (!rawCode && !rawDesc && !rawQty && !rawUnit && !rawRate) continue;
    // Skip section header rows (only code/description, no numeric data)
    if (!rawQty && !rawRate) continue;

    parsed.push({
      rowIndex: i + headerRowIdx + 2,
      code: rawCode?.toString().trim() || '',
      description: rawDesc?.toString().trim() || '',
      quantity: rawQty,
      unit: rawUnit?.toString().trim() || '',
      rate: rawRate,
    });
  }

  return parsed;
}

function parseExcelBuffer(buffer) {
  return parseWorkbookRows(XLSX.read(buffer, { type: 'buffer' }));
}

function parseExcelFile(filePath) {
  return parseWorkbookRows(XLSX.readFile(filePath));
}

function parseExcelInput(input) {
  if (Buffer.isBuffer(input)) return parseExcelBuffer(input);
  if (typeof input === 'string') return parseExcelFile(input);
  if (input?.path) return parseExcelFile(input.path);
  if (Buffer.isBuffer(input?.buffer)) return parseExcelBuffer(input.buffer);
  throw new HttpError(400, 'NO_FILE', 'No file uploaded');
}

function validateBoqRows(rows) {
  const errors = [];
  const seenCodes = new Map(); // normalized code -> first rowIndex

  rows.forEach((row) => {
    const r = row.rowIndex;

    if (!row.code) errors.push({ row: r, field: 'code', message: 'Code is required' });
    if (!row.description) errors.push({ row: r, field: 'description', message: 'Description is required' });
    if (!row.unit) errors.push({ row: r, field: 'unit', message: 'Unit is required' });

    const qty = Number(row.quantity);
    if (isNaN(qty) || qty <= 0) {
      errors.push({ row: r, field: 'quantity', message: 'Quantity must be a positive number' });
    }

    const rate = Number(row.rate);
    if (isNaN(rate) || rate < 0) {
      errors.push({ row: r, field: 'rate', message: 'Rate must be a non-negative number' });
    } else {
      try {
        assertMoneyInput('rate', row.rate);
      } catch (error) {
        errors.push({ row: r, field: 'rate', message: error.message });
      }
    }

    if (row.description && row.description.length > 500) {
      errors.push({ row: r, field: 'description', message: 'Description exceeds 500 characters' });
    }

    if (row.code) {
      const key = row.code.toString().trim().toLowerCase();
      if (seenCodes.has(key)) {
        errors.push({
          row: r,
          field: 'code',
          message: `Duplicate code "${row.code}" — also on row ${seenCodes.get(key)}`,
        });
      } else {
        seenCodes.set(key, r);
      }
    }
  });

  return { valid: errors.length === 0, errors };
}

// ── Main Upload Flow ───────────────────────────────────────────────────────────
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
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  await assertAiQuota(project.orgId);

  let itemsWithAmounts;
  try {
    // Step 1: Parse
    const rawRows = parseExcelInput(fileBuffer);
    if (rawRows.length === 0) {
      throw new HttpError(400, 'BOQ_VALIDATION_FAILED', 'No data rows found in file');
    }

    // Step 2: Validate
    const validation = validateBoqRows(rawRows);
    if (!validation.valid) {
      throw new HttpError(400, 'BOQ_VALIDATION_FAILED', 'BOQ file contains validation errors', {
        errors: validation.errors,
      });
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
    }));
  } catch (error) {
    if (options.documentId) {
      await fileStorageService.markDocumentRejected({
        documentId: options.documentId,
        code: error.code || 'BOQ_UPLOAD_FAILED',
        message: error.message,
      }).catch(() => {});
    }
    throw error;
  }

  // Step 4: Persist a revision and compare/import without deleting current rows.
  let revision;
  let comparison;
  let baseline;
  let mode = BOQ_REVISION_STATUS.IMPORTED;
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
          await trx.boqItem.update({
            where: { id: existing.id },
            data: {
              revisionId: revision.id,
              description: item.description,
              qty: item.qty,
              unit: item.unit,
              rate: item.rate,
              amount: item.amount,
              sortOrder: item.sortOrder,
              isActive: true,
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
      await fileStorageService.markDocumentRejected({
        documentId: options.documentId,
        code: error.code || 'BOQ_UPLOAD_FAILED',
        message: error.message,
      }).catch(() => {});
    }
    handleBoqUniqueError(error);
  }

  // Step 5: Kick off async AI job for imported active rows, or finish comparison-only uploads immediately.
  const jobId = uuidv4();
  if (baseline?.locked) {
    setBoqJob(jobId, {
      status: 'done',
      step: 'BOQ revision comparison saved; baseline rows were not changed.',
      progress: 100,
      projectId,
      mode,
      revision: serializeBoqRevision(revision),
      comparison: comparison?.summary ?? null,
      baseline,
      error: null,
    });

    return {
      jobId,
      revisionId: revision.id,
      mode,
      baselineLocked: true,
      comparison: comparison?.summary ?? null,
    };
  }

  setBoqJob(jobId, {
    status: 'processing',
    step: 'Preparing BOQ data...',
    progress: 10,
    projectId,
    mode,
    revision: serializeBoqRevision(revision),
    comparison: comparison?.summary ?? null,
    baseline: baseline ?? null,
    error: null,
  });

  processBoqAiAsync(
    projectId,
    jobId,
    itemsWithAmounts,
    label,
    { revisionId: revision.id },
  ).catch(() => {});

  return {
    jobId,
    revisionId: revision.id,
    mode,
    baselineLocked: false,
    comparison: comparison?.summary ?? null,
  };
}

async function processBoqAiAsync(projectId, jobId, items, label, options = {}) {
  try {
    setBoqJob(jobId, { status: 'running', step: 'Calling AI to generate activities...', progress: 30 });

    const project = await prisma.project.findUnique({
      where: { id: projectId },
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

    const proj = await prisma.project.findUnique({
      where: { id: projectId }, select: { orgId: true },
    });
    if (proj) await incrementAiUsage(proj.orgId);

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
          hasActivities: (i.activityBoqAllocations ?? []).length > 0,
        },
      ]),
    );

    // Track all generated activity codes for predecessor linking
    const allGeneratedCodes = {}; // boqCode -> string[]

    for (const boqResult of parsed.boqActivities ?? []) {
      const boqItem = itemByCode[boqResult.boqCode];
      if (!boqItem || boqItem.hasActivities) continue;

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
        if (act.predecessorIndex !== null && act.predecessorIndex !== undefined) {
          predecessorCode = codes[act.predecessorIndex] || null;
        } else if (act.predecessorBoqCode && act.predecessorActivityIndex !== null) {
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
      }
      allGeneratedCodes[boqResult.boqCode] = codes;
    }

    setBoqJob(jobId, { status: 'done', step: 'Complete', progress: 100 });
  } catch (err) {
    console.error('[boq] AI async error:', err);
    setBoqJob(jobId, {
      status: 'error',
      step: 'AI processing failed',
      error: err.message || 'AI processing failed. Please try uploading again.',
    });
  }
}

// ── AI Prompt ─────────────────────────────────────────────────────────────────
function buildBoqActivityPrompt(project, boqItems) {
  const startDate = project?.startDate ? new Date(project.startDate).toISOString().split('T')[0] : 'TBD';
  const currency = project?.currency ?? 'USD';
  const totalBudget = project?.contractValue ?? 0;

  return `You are a construction project planning expert. Break down each BOQ item into specific construction activities and define logical dependencies between them.

RULES:
1. For each BOQ item, generate 1-5 specific construction activities
2. Activities must be practical, sequential construction tasks
3. Use ONLY these dependency types:
   - "FS" (Finish-to-Start): Activity B cannot start until Activity A finishes
   - "SS" (Start-to-Start): Activity B can start when Activity A starts
   - null: No dependency
4. The first activity in each BOQ item typically has null dependency within that item, but may depend on a previous BOQ item
5. Activity names must be specific, max 255 characters
6. Keep unit and quantity realistic relative to the BOQ item
7. Quantities across activities under one BOQ item should logically relate to the BOQ item's total quantity

PROJECT CONTEXT:
- Name: ${project?.name ?? 'Construction Project'}
- Start Date: ${startDate}
- Duration: ${project?.duration ?? 12} ${project?.durationUnit ?? 'months'}
- Total Budget: ${currency} ${totalBudget.toLocaleString()}

BOQ ITEMS:
${JSON.stringify(boqItems.map((i) => ({ code: i.code, description: i.description, quantity: i.qty, unit: i.unit, rate: i.rate, amount: i.amount })), null, 2)}

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
    serializedRevisions.find((revision) => revision.status === BOQ_REVISION_STATUS.IMPORTED) ||
    null;
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

  const latestItem = items.reduce((latest, item) =>
    !latest || item.createdAt > latest.createdAt ? item : latest, null
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
    rate: quantity > 0 ? divideMoney(amount, quantity) : toMoneyNumber(boqItem.rate),
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
  const existing = await prisma.boqItem.findFirst({
    where: { id: itemId, projectId },
  });
  if (!existing) throw new HttpError(404, 'BOQ_ITEM_NOT_FOUND', 'BOQ item not found');
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
  }
  if (data.description !== undefined) updateData.description = data.description;
  if (data.quantity !== undefined) {
    updateData.qty = Number(data.quantity);
  }
  if (data.unit !== undefined) updateData.unit = data.unit;
  if (data.rate !== undefined) updateData.rate = toMoneyNumber(data.rate);

  // Recalculate amount if qty or rate changed
  if (updateData.qty !== undefined || updateData.rate !== undefined) {
    const qty = updateData.qty ?? existing.qty;
    const rate = updateData.rate ?? existing.rate;
    updateData.amount = multiplyMoney(qty, rate);
  }

  let updated;
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

  return { item: mapBoqItem(updated, allocationByItem.get(updated.id)), financial };
}

// ── Create Manual BOQ Row ─────────────────────────────────────────────────────
async function createManualBoqItem(projectId, data, options = {}) {
  await assertProjectAccess(projectId, options.orgId);
  await assertBoqEditable(projectId);
  const code = normalizeCode(data.code);
  const amount = multiplyMoney(data.quantity, data.rate);

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
          description: data.description,
          qty: Number(data.quantity),
          unit: data.unit,
          rate: toMoneyNumber(data.rate),
          amount,
          isManual: true,
          sortOrder: count,
        },
      });

      await createOfficialBoqActivityAllocation(tx, {
        projectId,
        boqItem: item,
        payload: {
          activityName: data.activityName,
          quantity: Number(data.quantity),
          rate: toMoneyNumber(data.rate),
        },
        source: 'manual',
        userId: options.userId || null,
        calendarId,
      });

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
  };
}

// â”€â”€ Delete BOQ Item â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function deleteBoqItem(projectId, itemId, options = {}) {
  await assertProjectAccess(projectId, options.orgId);
  await assertBoqEditable(projectId);
  const item = await prisma.boqItem.findFirst({ where: { id: itemId, projectId } });
  if (!item) throw new HttpError(404, 'BOQ_ITEM_NOT_FOUND', 'BOQ item not found');
  if (item.isActive === false) {
    throw new HttpError(
      409,
      'BOQ_ITEM_INACTIVE',
      'Historical BOQ rows cannot be deleted',
    );
  }
  if (!item.isManual) {
    throw new HttpError(403, 'BOQ_ITEM_NOT_DELETABLE', 'Uploaded BOQ rows cannot be deleted');
  }

  const allocations = await prisma.activityBoqAllocation.findMany({
    where: { projectId, boqItemId: itemId, isActive: true },
    select: { id: true, activityId: true, status: true },
  });
  const protectedAllocation = allocations.find((allocation) =>
    activeStatuses.includes(allocation.status) && allocation.status !== 'draft',
  );
  if (protectedAllocation) {
    throw new HttpError(
      409,
      'BOQ_ITEM_HAS_LINKED_ALLOCATIONS',
      'BOQ rows with submitted or approved activity allocations must be revised through the allocation workflow.',
    );
  }

  await prisma.$transaction(async (tx) => {
    if (allocations.length > 0) {
      await tx.activityBoqAllocation.updateMany({
        where: { id: { in: allocations.map((allocation) => allocation.id) } },
        data: {
          status: 'rejected',
          isActive: false,
          rejectedBy: options.userId || null,
          rejectedAt: new Date(),
          rejectedReason: 'Manual BOQ row deleted before allocation approval',
          updatedBy: options.userId || null,
        },
      });
      await tx.activity.updateMany({
        where: { id: { in: allocations.map((allocation) => allocation.activityId) } },
        data: {
          isActive: false,
          retiredAt: new Date(),
          retiredBy: options.userId || null,
          retiredReason: 'Manual BOQ row deleted before allocation approval',
        },
      });
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

// â”€â”€ Create Activity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function createActivity(projectId, boqItemId, data, options = {}) {
  await assertProjectAccess(projectId, options.orgId);
  await assertBoqEditable(projectId);
  const item = await prisma.boqItem.findFirst({ where: { id: boqItemId, projectId } });
  if (!item) throw new HttpError(404, 'BOQ_ITEM_NOT_FOUND', 'BOQ item not found');
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

function findAllocationForBoqActivity(projectId, activityId, allocationId = null, tx = prisma) {
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

// â”€â”€ Update Activity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function updateActivity(projectId, activityId, data, options = {}) {
  await assertProjectAccess(projectId, options.orgId);
  await assertBoqEditable(projectId);
  const existing = await findAllocationForBoqActivity(
    projectId,
    activityId,
    data?.allocationId || null,
  );
  if (!existing) throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found');
  if (existing.status !== 'draft') {
    throw new HttpError(
      409,
      'ALLOCATION_NOT_EDITABLE',
      'Only draft activity BOQ allocations can be edited from the BOQ grid',
    );
  }

  const quantity =
    data.quantity !== undefined ? toNumber(data.quantity) : toNumber(existing.quantity);
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
    if (data.dependencyType !== undefined || data.predecessorCode !== undefined) {
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

// â”€â”€ Delete Activity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  if (!allocation) throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found');
  if (allocation.status !== 'draft') {
    throw new HttpError(
      409,
      'ALLOCATION_NOT_EDITABLE',
      'Submitted or approved activity allocations must be rejected or revised before removing the schedule activity',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.activityBoqAllocation.update({
      where: { id: allocation.id },
      data: {
        status: 'rejected',
        isActive: false,
        rejectedBy: options.userId || null,
        rejectedAt: new Date(),
        rejectedReason: 'BOQ helper activity deleted before allocation approval',
        updatedBy: options.userId || null,
      },
    });
    await tx.activity.update({
      where: { id: activityId },
      data: {
        isActive: false,
        retiredAt: new Date(),
        retiredBy: options.userId || null,
        retiredReason: 'BOQ helper activity deleted before allocation approval',
      },
    });
  });

  return null;
}

module.exports = {
  getBoqJob,
  generateBoqTemplate,
  processBoqUpload,
  getProjectBoq,
  updateBoqItem,
  createManualBoqItem,
  deleteBoqItem,
  createActivity,
  updateActivity,
  deleteActivity,
};
