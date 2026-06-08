const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { nextActivityCode } = require('../utils/activity-code');
const { calculateFinancials } = require('./boq-calculation.service');
const { assertAiQuota, incrementAiUsage } = require('../middleware/subscription-gate');
const {
  buildAllocationSummary,
} = require('./activity-boq-allocation.service');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 120_000,
});

// ── In-memory job store ───────────────────────────────────────────────────────
const boqJobs = new Map();

function setBoqJob(jobId, data) {
  boqJobs.set(jobId, { ...boqJobs.get(jobId), ...data, updatedAt: Date.now() });
}

function getBoqJob(jobId) {
  return boqJobs.get(jobId) || null;
}

// Clean up jobs older than 2 hours
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of boqJobs) {
    if (job.updatedAt < cutoff) boqJobs.delete(id);
  }
}, 30 * 60 * 1000);

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

function parseExcelBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
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
async function processBoqUpload(projectId, fileBuffer, label) {
  const project = await prisma.project.findUnique({
    where: { id: projectId }, select: { orgId: true },
  });
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  await assertAiQuota(project.orgId);

  // Step 1: Parse
  const rawRows = parseExcelBuffer(fileBuffer);
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
  const itemsWithAmounts = rawRows.map((row, idx) => ({
    code: row.code,
    description: row.description,
    qty: Number(row.quantity),
    unit: row.unit,
    rate: Number(row.rate),
    amount: Number(row.quantity) * Number(row.rate),
    isManual: false,
    sortOrder: idx,
  }));

  // Step 4: Persist BOQ items (delete non-manual, re-insert)
  await prisma.$transaction(async (trx) => {
    await trx.boqItem.deleteMany({ where: { projectId, isManual: false } });
    await trx.boqItem.createMany({
      data: itemsWithAmounts.map((item) => ({
        projectId,
        code: item.code,
        description: item.description,
        qty: item.qty,
        unit: item.unit,
        rate: item.rate,
        amount: item.amount,
        isManual: false,
        sortOrder: item.sortOrder,
      })),
    });
  });

  // Step 5: Kick off async AI job
  const jobId = uuidv4();
  setBoqJob(jobId, {
    status: 'processing',
    step: 'Preparing BOQ data…',
    progress: 10,
    projectId,
    error: null,
  });

  processBoqAiAsync(projectId, jobId, itemsWithAmounts, label).catch(() => {});

  return { jobId };
}

async function processBoqAiAsync(projectId, jobId, items, label) {
  try {
    setBoqJob(jobId, { status: 'running', step: 'Calling AI to generate activities…', progress: 30 });

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, startDate: true, duration: true, durationUnit: true, currency: true, contractValue: true },
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

    setBoqJob(jobId, { step: 'Saving activities…', progress: 70 });

    // Fetch saved BOQ items to get their IDs
    const savedItems = await prisma.boqItem.findMany({
      where: { projectId, isManual: false },
      select: { id: true, code: true, description: true },
    });
    const itemByCode = Object.fromEntries(
      savedItems.map((i) => [i.code, { id: i.id, description: i.description }]),
    );

    // Track all generated activity codes for predecessor linking
    const allGeneratedCodes = {}; // boqCode -> string[]

    for (const boqResult of parsed.boqActivities ?? []) {
      const boqItem = itemByCode[boqResult.boqCode];
      if (!boqItem) continue;
      const boqItemId = boqItem.id;

      const codes = [];
      for (let i = 0; i < (boqResult.activities ?? []).length; i++) {
        const act = boqResult.activities[i];
        const activityCode = await nextActivityCode(projectId, boqItem.description);
        codes.push(activityCode);

        let predecessorCode = null;
        if (act.predecessorIndex !== null && act.predecessorIndex !== undefined) {
          predecessorCode = codes[act.predecessorIndex] || null;
        } else if (act.predecessorBoqCode && act.predecessorActivityIndex !== null) {
          const prevCodes = allGeneratedCodes[act.predecessorBoqCode] || [];
          predecessorCode = prevCodes[act.predecessorActivityIndex] || null;
        }

        await prisma.boqActivity.create({
          data: {
            boqItemId,
            projectId,
            activityCode,
            activityName: act.activityName,
            unit: act.unit,
            quantity: Number(act.quantity) || 0,
            rate: Number(act.rate) || 0,
            budget: (Number(act.quantity) || 0) * (Number(act.rate) || 0),
            dependencyType: act.dependencyType || null,
            predecessorCode,
            isManual: false,
            sortOrder: i,
          },
        });
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
async function getProjectBoq(projectId) {
  const [items, allocationSummary] = await Promise.all([
    prisma.boqItem.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
      include: {
        boqActivities: { orderBy: { sortOrder: 'asc' } },
      },
    }),
    buildAllocationSummary({ projectId }),
  ]);

  if (items.length === 0) {
    return {
      projectId,
      hasUploadedBoq: false,
      uploadedAt: null,
      items: [],
      financial: null,
      allocationSummary,
    };
  }

  const financial = await calculateFinancials(items);
  const allocationByItem = new Map(
    allocationSummary.items.map((item) => [item.boqItemId, item]),
  );

  const latestItem = items.reduce((latest, item) =>
    !latest || item.createdAt > latest.createdAt ? item : latest, null
  );

  return {
    projectId,
    hasUploadedBoq: true,
    uploadedAt: latestItem?.createdAt ?? null,
    items: items.map((item) => mapBoqItem(item, allocationByItem.get(item.id))),
    financial,
    allocationSummary,
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
    activeAllocatedQuantity: allocationTotals?.activeAllocatedQuantity ?? 0,
    activeAllocatedAmount: allocationTotals?.activeAllocatedAmount ?? 0,
    approvedAllocatedQuantity: allocationTotals?.approvedAllocatedQuantity ?? 0,
    approvedAllocatedAmount: allocationTotals?.approvedAllocatedAmount ?? 0,
    pendingAllocatedAmount: allocationTotals?.pendingAllocatedAmount ?? 0,
    unallocatedQuantity:
      allocationTotals?.unallocatedQuantity ?? Number(item.qty || 0),
    unallocatedAmount:
      allocationTotals?.unallocatedAmount ?? Number(item.amount || 0),
    activities: (item.boqActivities ?? []).map(mapActivity),
  };
}

function mapActivity(act) {
  return {
    id: act.id,
    boqItemId: act.boqItemId,
    activityCode: act.activityCode,
    activityName: act.activityName,
    unit: act.unit,
    quantity: act.quantity,
    rate: act.rate,
    budget: act.budget,
    dependencyType: act.dependencyType,
    predecessorCode: act.predecessorCode,
    isManual: act.isManual,
    sortOrder: act.sortOrder,
  };
}

// ── Update BOQ Item ───────────────────────────────────────────────────────────
async function updateBoqItem(projectId, itemId, data) {
  const updateData = {};
  if (data.code !== undefined) updateData.code = data.code;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.quantity !== undefined) {
    updateData.qty = Number(data.quantity);
  }
  if (data.unit !== undefined) updateData.unit = data.unit;
  if (data.rate !== undefined) updateData.rate = Number(data.rate);

  // Recalculate amount if qty or rate changed
  if (updateData.qty !== undefined || updateData.rate !== undefined) {
    const existing = await prisma.boqItem.findUnique({ where: { id: itemId } });
    if (!existing) throw new HttpError(404, 'BOQ_ITEM_NOT_FOUND', 'BOQ item not found');
    const qty = updateData.qty ?? existing.qty;
    const rate = updateData.rate ?? existing.rate;
    updateData.amount = qty * rate;
  }

  const updated = await prisma.boqItem.update({
    where: { id: itemId, projectId },
    data: updateData,
    include: { boqActivities: { orderBy: { sortOrder: 'asc' } } },
  });

  const allItems = await prisma.boqItem.findMany({ where: { projectId } });
  const financial = await calculateFinancials(allItems);

  return { item: mapBoqItem(updated), financial };
}

// ── Create Manual BOQ Row ─────────────────────────────────────────────────────
async function createManualBoqItem(projectId, data) {
  const count = await prisma.boqItem.count({ where: { projectId } });
  const amount = Number(data.quantity) * Number(data.rate);

  const item = await prisma.boqItem.create({
    data: {
      projectId,
      code: data.code,
      description: data.description,
      qty: Number(data.quantity),
      unit: data.unit,
      rate: Number(data.rate),
      amount,
      isManual: true,
      sortOrder: count,
    },
  });

  // Activity code is auto-generated, never supplied by the client (BRD rule)
  const activityCode = await nextActivityCode(projectId, data.description);
  await prisma.boqActivity.create({
    data: {
      boqItemId: item.id,
      projectId,
      activityCode,
      activityName: data.activityName,
      unit: data.unit,
      quantity: Number(data.quantity),
      rate: Number(data.rate),
      budget: amount,
      isManual: true,
      sortOrder: 0,
    },
  });

  const itemWithActivities = await prisma.boqItem.findUnique({
    where: { id: item.id },
    include: { boqActivities: { orderBy: { sortOrder: 'asc' } } },
  });

  const allItems = await prisma.boqItem.findMany({ where: { projectId } });
  const financial = await calculateFinancials(allItems);

  return { item: mapBoqItem(itemWithActivities), financial };
}

// ── Delete BOQ Item ───────────────────────────────────────────────────────────
async function deleteBoqItem(projectId, itemId) {
  const item = await prisma.boqItem.findUnique({ where: { id: itemId, projectId } });
  if (!item) throw new HttpError(404, 'BOQ_ITEM_NOT_FOUND', 'BOQ item not found');
  if (!item.isManual) {
    throw new HttpError(403, 'BOQ_ITEM_NOT_DELETABLE', 'Uploaded BOQ rows cannot be deleted');
  }

  await prisma.boqItem.delete({ where: { id: itemId } });

  const allItems = await prisma.boqItem.findMany({ where: { projectId } });
  const financial = await calculateFinancials(allItems);

  return { financial };
}

// ── Create Activity ───────────────────────────────────────────────────────────
async function createActivity(projectId, boqItemId, data) {
  const item = await prisma.boqItem.findUnique({ where: { id: boqItemId, projectId } });
  if (!item) throw new HttpError(404, 'BOQ_ITEM_NOT_FOUND', 'BOQ item not found');

  const count = await prisma.boqActivity.count({ where: { boqItemId } });
  const activityCode = await nextActivityCode(projectId, item.description);
  const budget = (Number(data.quantity) || 0) * (Number(data.rate) || 0);

  const activity = await prisma.boqActivity.create({
    data: {
      boqItemId,
      projectId,
      activityCode,
      activityName: data.activityName,
      unit: data.unit,
      quantity: Number(data.quantity) || 0,
      rate: Number(data.rate) || 0,
      budget,
      dependencyType: data.dependencyType || null,
      predecessorCode: data.predecessorCode || null,
      isManual: true,
      sortOrder: count,
    },
  });

  return { activity: mapActivity(activity) };
}

// ── Update Activity ───────────────────────────────────────────────────────────
async function updateActivity(projectId, activityId, data) {
  const updateData = {};
  if (data.activityName !== undefined) updateData.activityName = data.activityName;
  if (data.unit !== undefined) updateData.unit = data.unit;
  if (data.quantity !== undefined) updateData.quantity = Number(data.quantity);
  if (data.rate !== undefined) updateData.rate = Number(data.rate);
  if (data.dependencyType !== undefined) updateData.dependencyType = data.dependencyType || null;
  if (data.predecessorCode !== undefined) updateData.predecessorCode = data.predecessorCode || null;

  if (updateData.quantity !== undefined || updateData.rate !== undefined) {
    const existing = await prisma.boqActivity.findUnique({ where: { id: activityId } });
    if (!existing) throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found');
    const qty = updateData.quantity ?? existing.quantity;
    const rate = updateData.rate ?? existing.rate;
    updateData.budget = qty * rate;
  }

  const updated = await prisma.boqActivity.update({
    where: { id: activityId, projectId },
    data: updateData,
  });

  return { activity: mapActivity(updated) };
}

// ── Delete Activity ───────────────────────────────────────────────────────────
async function deleteActivity(projectId, activityId) {
  const activity = await prisma.boqActivity.findUnique({ where: { id: activityId, projectId } });
  if (!activity) throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found');
  await prisma.boqActivity.delete({ where: { id: activityId } });
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
