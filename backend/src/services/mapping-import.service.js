const crypto = require('crypto');
const XLSX = require('@e965/xlsx');
const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { normalizeBoqCode } = require('../utils/boq-code');
const { addMoney, toMoneyNumber } = require('../utils/money');
const approvalWorkflowService = require('./approval-workflow.service');
const allocationService = require('./activity-boq-allocation.service');

/**
 * Mapping-file import (mapping doc §5).
 *
 * A workbook with `boq_code`, `activity_code` and exactly one of `quantity`,
 * `amount` or `weight` per row. The dry run reports what an apply would do —
 * rows matched, codes nobody has, pairs already allocated, rows that would
 * breach the item's capacity, rows on not-applicable items — without writing
 * anything. Apply creates the matched rows as drafts with `source='import'`,
 * `suggestedBy='import'` and one `importBatchId`, through the same
 * `createAllocationInTx` the single create uses, so no rule is skipped.
 * "Undo batch" rejects the batch's rows that are still draft or submitted;
 * an approved row is an official EV basis and is reported, not touched.
 *
 * The same file applied twice creates nothing the second time: every pair
 * is then "existing", and the report says so.
 */

const HEADER_ALIASES = {
  boq_code: 'boqCode',
  'boq code': 'boqCode',
  boq: 'boqCode',
  'item code': 'boqCode',
  'item no': 'boqCode',
  'item no.': 'boqCode',
  code: 'boqCode',
  item: 'boqCode',
  activity_code: 'activityCode',
  'activity code': 'activityCode',
  activity: 'activityCode',
  'activity id': 'activityCode',
  activity_id: 'activityCode',
  task: 'activityCode',
  quantity: 'quantity',
  qty: 'quantity',
  amount: 'amount',
  value: 'amount',
  weight: 'weight',
  '%': 'weight',
  percent: 'weight',
  'weight %': 'weight',
  notes: 'notes',
  note: 'notes',
  location: 'locationCode',
  location_code: 'locationCode',
  'location code': 'locationCode',
};
const BASES = ['quantity', 'amount', 'weight'];
const MAX_REPORTED_ROWS = 200;
const UNDO_REASON = 'Import batch undone';

const normalizeHeader = (header) =>
  String(header ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

const normalizeCodeKey = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

/**
 * Reads the first sheet. The header row is the first of the first five rows
 * that names both a BOQ code and an activity code column.
 */
const parseMappingWorkbook = (input) => {
  let workbook;
  try {
    workbook = Buffer.isBuffer(input)
      ? XLSX.read(input, { type: 'buffer' })
      : XLSX.readFile(typeof input === 'string' ? input : input?.path);
  } catch (error) {
    throw new HttpError(400, 'MAPPING_IMPORT_INVALID', 'The mapping file could not be read as a workbook', {
      reason: error.message,
    });
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) : [];
  if (rows.length < 2) {
    throw new HttpError(400, 'MAPPING_IMPORT_INVALID', 'The mapping file has no data rows');
  }

  let headerRowIdx = -1;
  let columns = {};
  for (let i = 0; i < Math.min(5, rows.length); i += 1) {
    const map = {};
    rows[i].forEach((header, index) => {
      const canonical = HEADER_ALIASES[normalizeHeader(header)];
      if (canonical && map[canonical] === undefined) map[canonical] = index;
    });
    if (map.boqCode !== undefined && map.activityCode !== undefined) {
      headerRowIdx = i;
      columns = map;
      break;
    }
  }
  if (headerRowIdx < 0) {
    throw new HttpError(
      400,
      'MAPPING_IMPORT_INVALID',
      'The mapping file needs boq_code and activity_code columns and one of quantity, amount or weight',
    );
  }
  const figureColumns = BASES.filter((basis) => columns[basis] !== undefined);
  if (figureColumns.length === 0) {
    throw new HttpError(
      400,
      'MAPPING_IMPORT_INVALID',
      'The mapping file needs a quantity, amount or weight column',
    );
  }

  const parsed = [];
  rows.slice(headerRowIdx + 1).forEach((row, offset) => {
    const rowIndex = headerRowIdx + offset + 2;
    const boqCode = row[columns.boqCode];
    const activityCode = row[columns.activityCode];
    const figures = {};
    for (const basis of figureColumns) {
      const value = row[columns[basis]];
      if (!isBlank(value)) figures[basis] = value;
    }
    if (isBlank(boqCode) && isBlank(activityCode) && Object.keys(figures).length === 0) return;
    parsed.push({
      rowIndex,
      boqCode: normalizeBoqCode(boqCode),
      activityCode: String(activityCode ?? '').trim(),
      figures,
      notes: columns.notes !== undefined && !isBlank(row[columns.notes]) ? String(row[columns.notes]).trim() : null,
      locationCode: columns.locationCode !== undefined && !isBlank(row[columns.locationCode]) ? String(row[columns.locationCode]).trim() : null,
    });
  });

  return { rows: parsed, columns: Object.keys(columns) };
};

const ensureProject = async ({ orgId, projectId }, tx = prisma) => {
  const project = await tx.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  return project;
};

/**
 * Matches every parsed row against the project and judges it the way apply
 * would, keeping a running total per item so two rows on one item are judged
 * together. Returns the plan: the rows to create, and the rest with why not.
 */
const planImport = async ({ projectId, rows }, tx = prisma) => {
  const [items, activities, existingPairs, locations] = await Promise.all([
    tx.boqItem.findMany({
      where: { projectId, isActive: true },
      select: { id: true, code: true, ref: true, qty: true, rate: true, amount: true, mappingRule: true },
    }),
    tx.activity.findMany({
      where: { projectId, isActive: true },
      select: { id: true, activityCode: true, p6ActivityId: true, name: true },
    }),
    tx.activityBoqAllocation.findMany({
      where: { projectId, isActive: true },
      select: { boqItemId: true, activityId: true, quantity: true, amount: true },
    }),
    tx.location.findMany({
      where: { projectId },
      select: { id: true, code: true, name: true },
    }),
  ]);

  const itemByCode = new Map();
  for (const item of items) {
    for (const code of [item.code, item.ref]) {
      const key = normalizeCodeKey(code);
      if (key && !itemByCode.has(key)) itemByCode.set(key, item);
    }
  }
  const activityByCode = new Map();
  for (const activity of activities) {
    for (const code of [activity.activityCode, activity.p6ActivityId]) {
      const key = normalizeCodeKey(code);
      if (key && !activityByCode.has(key)) activityByCode.set(key, activity);
    }
  }
  const locationByCode = new Map();
  for (const location of locations) {
    const key = normalizeCodeKey(location.code);
    if (key && !locationByCode.has(key)) locationByCode.set(key, location);
    const nameKey = normalizeCodeKey(location.name);
    if (nameKey && !locationByCode.has(nameKey)) locationByCode.set(nameKey, location);
  }

  const taken = new Set(existingPairs.map((pair) => `${pair.boqItemId}:${pair.activityId}`));
  const totals = new Map();
  for (const pair of existingPairs) {
    const current = totals.get(pair.boqItemId) || { quantity: 0, amount: 0 };
    current.quantity += Number(pair.quantity) || 0;
    current.amount = addMoney(current.amount, pair.amount);
    totals.set(pair.boqItemId, current);
  }

  const plan = { create: [], unmatched: [], existing: [], breaches: [], notApplicable: [], invalid: [] };
  const seenInFile = new Set();

  for (const row of rows) {
    const item = itemByCode.get(normalizeCodeKey(row.boqCode));
    const activity = activityByCode.get(normalizeCodeKey(row.activityCode));
    if (!item || !activity) {
      plan.unmatched.push({
        rowIndex: row.rowIndex,
        boqCode: row.boqCode,
        activityCode: row.activityCode,
        reason: !item && !activity ? 'BOQ_AND_ACTIVITY_NOT_FOUND' : !item ? 'BOQ_ITEM_NOT_FOUND' : 'ACTIVITY_NOT_FOUND',
      });
      continue;
    }
    const figureKeys = Object.keys(row.figures);
    if (figureKeys.length !== 1) {
      plan.invalid.push({
        rowIndex: row.rowIndex,
        boqCode: row.boqCode,
        activityCode: row.activityCode,
        reason: figureKeys.length === 0 ? 'FIGURE_MISSING' : 'AMBIGUOUS_BASIS',
        message:
          figureKeys.length === 0
            ? 'Give a quantity, an amount or a weight'
            : `Give one of quantity, amount or weight, not ${figureKeys.join(' and ')}`,
      });
      continue;
    }
    const basis = figureKeys[0];
    const typed = Number(row.figures[basis]);
    if (!Number.isFinite(typed) || typed <= 0) {
      plan.invalid.push({
        rowIndex: row.rowIndex,
        boqCode: row.boqCode,
        activityCode: row.activityCode,
        reason: 'FIGURE_INVALID',
        message: `${basis} must be a positive number`,
      });
      continue;
    }
    if ((item.mappingRule || 'required') === 'not_applicable') {
      plan.notApplicable.push({ rowIndex: row.rowIndex, boqCode: row.boqCode, activityCode: row.activityCode, boqItemId: item.id });
      continue;
    }
    const pairKey = `${item.id}:${activity.id}`;
    if (taken.has(pairKey) || seenInFile.has(pairKey)) {
      plan.existing.push({
        rowIndex: row.rowIndex,
        boqCode: row.boqCode,
        activityCode: row.activityCode,
        boqItemId: item.id,
        activityId: activity.id,
        reason: seenInFile.has(pairKey) ? 'DUPLICATE_IN_FILE' : 'DUPLICATE_ACTIVE_ALLOCATION',
      });
      continue;
    }

    const figures = allocationService.deriveFigures({
      basis,
      quantity: basis === 'quantity' ? typed : undefined,
      amount: basis === 'amount' ? typed : undefined,
      weight: basis === 'weight' ? typed : undefined,
      boqItem: item,
    });
    const running = totals.get(item.id) || { quantity: 0, amount: 0 };
    const nextQuantity = running.quantity + figures.quantity;
    const nextAmount = addMoney(running.amount, figures.amount);
    if (nextQuantity > Number(item.qty) + 0.000001 || nextAmount > toMoneyNumber(item.amount) + 0.01) {
      plan.breaches.push({
        rowIndex: row.rowIndex,
        boqCode: row.boqCode,
        activityCode: row.activityCode,
        boqItemId: item.id,
        activityId: activity.id,
        // Quantity is judged before amount, as the capacity check does.
        reason: nextQuantity > Number(item.qty) + 0.000001 ? 'ALLOCATION_QUANTITY_EXCEEDED' : 'ALLOCATION_AMOUNT_EXCEEDED',
        itemQuantity: Number(item.qty),
        itemAmount: toMoneyNumber(item.amount),
        wouldBeQuantity: nextQuantity,
        wouldBeAmount: nextAmount,
      });
      continue;
    }

    let location = null;
    if (row.locationCode) {
      location = locationByCode.get(normalizeCodeKey(row.locationCode)) || null;
      if (!location) {
        plan.unmatched.push({
          rowIndex: row.rowIndex,
          boqCode: row.boqCode,
          activityCode: row.activityCode,
          reason: 'LOCATION_NOT_FOUND',
        });
        continue;
      }
    }

    totals.set(item.id, { quantity: nextQuantity, amount: nextAmount });
    seenInFile.add(pairKey);
    plan.create.push({
      rowIndex: row.rowIndex,
      boqCode: row.boqCode,
      activityCode: row.activityCode,
      boqItemId: item.id,
      activityId: activity.id,
      basis,
      typed,
      quantity: figures.quantity,
      amount: figures.amount,
      weight: figures.weight,
      notes: row.notes,
      locationId: location?.id ?? null,
    });
  }

  return plan;
};

const sample = (rows) => rows.slice(0, MAX_REPORTED_ROWS);

const buildReport = (plan, { rowCount, columns, batchId = null, created = [], failed = [] }) => ({
  rowCount,
  columns,
  batchId,
  summary: {
    matched: plan.create.length,
    unmatched: plan.unmatched.length,
    existing: plan.existing.length,
    breaches: plan.breaches.length,
    notApplicable: plan.notApplicable.length,
    invalid: plan.invalid.length,
    created: created.length,
    failed: failed.length,
    totalAmount: plan.create.reduce((sum, row) => addMoney(sum, row.amount), 0),
  },
  matched: sample(plan.create),
  unmatched: sample(plan.unmatched),
  existing: sample(plan.existing),
  breaches: sample(plan.breaches),
  notApplicable: sample(plan.notApplicable),
  invalid: sample(plan.invalid),
  created: sample(created),
  failed: sample(failed),
  rowLimit: MAX_REPORTED_ROWS,
});

/**
 * The dry run: parse, plan, report. Nothing is written.
 */
const dryRunImport = async ({ orgId, projectId, file }) => {
  await ensureProject({ orgId, projectId });
  const { rows, columns } = parseMappingWorkbook(file);
  const plan = await planImport({ projectId, rows });
  return { dryRun: true, ...buildReport(plan, { rowCount: rows.length, columns }) };
};

/**
 * Apply: the same plan, then one draft per matched row inside one
 * transaction, all stamped with the batch id. A row the service refuses at
 * write time (a rule the plan could not see, such as a location outside the
 * item's zone) fails the row, not the batch.
 */
const applyImport = async ({ orgId, projectId, userId, file }) => {
  await ensureProject({ orgId, projectId });
  const { rows, columns } = parseMappingWorkbook(file);
  const batchId = crypto.randomUUID();

  const { plan, created, failed } = await prisma.$transaction(async (tx) => {
    const planned = await planImport({ projectId, rows }, tx);
    const done = [];
    const refused = [];
    for (const row of planned.create) {
      try {
        const allocation = await allocationService.createAllocationInTx(tx, {
          orgId,
          projectId,
          userId,
          importBatchId: batchId,
          payload: {
            boqItemId: row.boqItemId,
            activityId: row.activityId,
            basis: row.basis,
            quantity: row.basis === 'quantity' ? row.typed : undefined,
            amount: row.basis === 'amount' ? row.typed : undefined,
            weight: row.basis === 'weight' ? row.typed : undefined,
            source: 'import',
            suggestedBy: 'import',
            notes: row.notes,
            locationId: row.locationId,
          },
        });
        done.push({ rowIndex: row.rowIndex, allocationId: allocation.id, boqItemId: row.boqItemId, activityId: row.activityId, amount: allocation.amount, quantity: allocation.quantity, warnings: allocation.warnings });
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        refused.push({ rowIndex: row.rowIndex, boqCode: row.boqCode, activityCode: row.activityCode, code: error.code, message: error.message });
      }
    }
    return { plan: planned, created: done, failed: refused };
  });

  return {
    dryRun: false,
    ...buildReport(plan, { rowCount: rows.length, columns, batchId: created.length > 0 ? batchId : null, created, failed }),
  };
};

/**
 * Undo: reject every row of the batch that is still draft or submitted. An
 * approved row is left as it is and named in the answer; a rejected one is
 * already out and counted as such.
 *
 * The allocation workflow knows no draft → rejected step (a draft is
 * withdrawn by rejecting it after submission), so a draft is submitted and
 * rejected in one transaction, both steps recorded with the undo as their
 * reason: the history says what happened rather than skipping the rule.
 */
const undoImportBatch = async ({ orgId, projectId, userId, batchId }) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const rows = await tx.activityBoqAllocation.findMany({
      where: { projectId, importBatchId: batchId },
      select: { id: true, status: true, isActive: true, boqItemId: true, activityId: true, quantity: true, amount: true },
    });
    if (rows.length === 0) {
      throw new HttpError(404, 'MAPPING_IMPORT_BATCH_NOT_FOUND', 'No allocations carry this import batch id');
    }

    const rejected = [];
    const kept = [];
    const alreadyOut = [];
    const now = new Date();
    for (const row of rows) {
      if (row.status === 'approved') {
        kept.push({ allocationId: row.id, status: row.status });
        continue;
      }
      if (row.status === 'rejected' || !row.isActive) {
        alreadyOut.push({ allocationId: row.id, status: row.status });
        continue;
      }
      const metadata = {
        boqItemId: row.boqItemId,
        activityId: row.activityId,
        quantity: row.quantity,
        amount: row.amount,
        importBatchId: batchId,
      };
      if (row.status === 'draft') {
        await tx.activityBoqAllocation.update({
          where: { id: row.id },
          data: { status: 'submitted', submittedBy: userId || null, submittedAt: now, updatedBy: userId || null },
        });
        await approvalWorkflowService.recordTransition({
          tx,
          orgId,
          projectId,
          recordType: approvalWorkflowService.RECORD_TYPES.BOQ_ALLOCATION,
          recordId: row.id,
          fromStatus: 'draft',
          toStatus: 'submitted',
          actorId: userId,
          metadata: { ...metadata, undo: true },
        });
      }
      await tx.activityBoqAllocation.update({
        where: { id: row.id },
        data: {
          status: 'rejected',
          isActive: false,
          rejectedBy: userId || null,
          rejectedAt: now,
          rejectedReason: UNDO_REASON,
          updatedBy: userId || null,
        },
      });
      await approvalWorkflowService.recordTransition({
        tx,
        orgId,
        projectId,
        recordType: approvalWorkflowService.RECORD_TYPES.BOQ_ALLOCATION,
        recordId: row.id,
        fromStatus: 'submitted',
        toStatus: 'rejected',
        actorId: userId,
        reason: UNDO_REASON,
        metadata,
      });
      rejected.push({ allocationId: row.id, fromStatus: row.status });
    }

    return {
      batchId,
      total: rows.length,
      rejected: rejected.length,
      keptApproved: kept.length,
      alreadyRejected: alreadyOut.length,
      rejectedAllocations: rejected,
      keptAllocations: kept,
    };
  });

module.exports = {
  parseMappingWorkbook,
  planImport,
  dryRunImport,
  applyImport,
  undoImportBatch,
};
