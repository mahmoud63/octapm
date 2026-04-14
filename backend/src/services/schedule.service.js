const Anthropic = require('@anthropic-ai/sdk');
const XLSX = require('xlsx');
const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 120_000, // 2 min max per API call
});

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[schedule] ANTHROPIC_API_KEY not set');
}

const PHASES = [
  'Preliminary & General',
  'Earthworks & Foundations',
  'Concrete Structure',
  'Masonry & Blockwork',
  'Roofing',
  'External Works & Façade',
  'Internal Finishes',
  'Mechanical Services',
  'Electrical Services',
  'Specialist Systems',
  'External Landscaping',
  'Testing & Commissioning',
];

const JOB_STEPS = [
  {
    label: 'Pass 1: Structuring BOQ',
    description: 'Parsing and organizing BOQ rows',
  },
  {
    label: 'Pass 2: Generating CPM Schedule',
    description: 'Building activities and CPM logic',
  },
  {
    label: 'Pass 3: Allocating Resources',
    description: 'Assigning labor, equipment, and materials',
  },
];

function parseFileToText(file) {
  const ext = file.originalname.split('.').pop().toLowerCase();
  if (!['xlsx', 'xls', 'csv'].includes(ext)) {
    throw new HttpError(
      400,
      'UNSUPPORTED_FORMAT',
      'Supported formats: .xlsx, .xls, .csv',
    );
  }
  const wb = XLSX.read(file.buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils
    .sheet_to_json(ws, { header: 1, defval: '' })
    .map((r) => r.join(' | '))
    .join('\n');
}

function stripMarkdownJsonFences(raw) {
  return String(raw || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const numeric = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

/**
 * Attempt to repair truncated JSON from AI.
 * Handles: unclosed strings, trailing commas, missing closing brackets/braces.
 */
function repairJson(raw) {
  let s = String(raw || '').trim();

  s = s.replace(/,\s*([\]}])/g, '$1');

  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') braces += 1;
    else if (ch === '}') braces -= 1;
    else if (ch === '[') brackets += 1;
    else if (ch === ']') brackets -= 1;
  }

  if (inString) s += '"';
  s = s.replace(/,\s*$/, '');
  s += ']'.repeat(Math.max(0, brackets));
  s += '}'.repeat(Math.max(0, braces));
  return s;
}

function parseJsonWithRepair(cleaned, contextLabel) {
  try {
    return JSON.parse(cleaned);
  } catch {
    const repaired = repairJson(cleaned);
    try {
      const parsed = JSON.parse(repaired);
      console.warn(`[schedule] JSON repaired for ${contextLabel}`);
      return parsed;
    } catch {
      throw new Error(
        `AI returned invalid JSON for ${contextLabel} (repair failed)`,
      );
    }
  }
}

function getErrorStatus(err) {
  return err?.status || err?.statusCode || err?.response?.status;
}

function parseResetSeconds(value) {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Call Anthropic API with retry on 429/529.
 */
async function callWithRetry(apiFn, onRetry = null, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await apiFn();
    } catch (err) {
      const status = getErrorStatus(err);
      const isRateLimit = status === 429;
      const isOverloaded = status === 529;

      if ((isRateLimit || isOverloaded) && attempt < maxRetries) {
        let waitMs = isOverloaded ? 60_000 : 30_000;
        const headers = err?.headers || err?.response?.headers || {};
        const resetAfter =
          parseResetSeconds(headers['anthropic-ratelimit-reset-tokens']) ||
          parseResetSeconds(headers['retry-after']);
        if (resetAfter) {
          waitMs = Math.min((resetAfter + 2) * 1000, 120_000);
        }

        if (onRetry) onRetry(attempt, waitMs, status);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      throw err;
    }
  }

  throw new Error('AI request failed after retries');
}

async function structureBoqRows(rawText, { onRetry } = {}) {
  const msg = await callWithRetry(
    () =>
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system:
          'You are a BOQ parser. Return ONLY valid JSON array. No markdown.',
        messages: [
          {
            role: 'user',
            content: `Parse this BOQ data. Return JSON array where each object has: "ref","description","unit"(one of LS m m2 m3 Nr kg t hr),"qty"(number),"rate"(number),"amount"(number),"section"(one of: ${PHASES.join(', ')}). Skip header/total rows. Only return the JSON array.\n\nDATA:\n${rawText}`,
          },
        ],
      }),
    onRetry,
  );

  if (msg.stop_reason === 'max_tokens') {
    console.warn(
      '[schedule] AI response hit max_tokens - attempting JSON repair',
    );
  }

  const raw = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const cleaned = stripMarkdownJsonFences(raw || '[]');
  const parsed = parseJsonWithRepair(cleaned, 'BOQ parsing');

  if (!Array.isArray(parsed)) {
    throw new Error('AI returned invalid BOQ payload (expected array)');
  }

  return parsed.map((row) => {
    const qty = normalizeNumber(row?.qty);
    const rate = normalizeNumber(row?.rate);
    const amount =
      row?.amount !== undefined && row?.amount !== null && row?.amount !== ''
        ? normalizeNumber(row.amount)
        : qty * rate;

    return {
      ref: row?.ref ? String(row.ref).trim() : null,
      description: String(row?.description || '').trim(),
      unit: row?.unit ? String(row.unit).trim() : null,
      qty,
      rate,
      amount,
      section: row?.section
        ? String(row.section).trim()
        : 'Preliminary & General',
    };
  });
}

/**
 * Split BOQ rows into batches of <=60 items grouped by section.
 */
function chunkBoqRows(rows, maxPerBatch = 60) {
  if (!Array.isArray(rows) || rows.length <= maxPerBatch) return [rows || []];

  const bySection = {};
  for (const row of rows) {
    const sec = row.section || 'General';
    if (!bySection[sec]) bySection[sec] = [];
    bySection[sec].push(row);
  }

  const batches = [];
  let current = [];
  for (const sec of Object.keys(bySection)) {
    const items = bySection[sec];
    for (let i = 0; i < items.length; i += maxPerBatch) {
      const slice = items.slice(i, i + maxPerBatch);
      if (current.length + slice.length > maxPerBatch && current.length > 0) {
        batches.push(current);
        current = [];
      }
      current.push(...slice);
    }
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

function extractText(msg) {
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * Phase A: generate activities + CPM structure (core schedule).
 * Kept compact so output stays well under 8192 tokens.
 */
async function generateActivities(
  boqText,
  boqCount,
  project,
  batchLabel,
  prevContext,
  { onRetry } = {},
) {
  const totalBOQ = 0; // already encoded in boqText amounts
  const cv = project.contractValue
    ? `USD ${project.contractValue}`
    : 'see BOQ amounts';
  const duration = project.duration || 18;
  const durationUnit = project.durationUnit || 'months';
  const startDate = project.startDate
    ? new Date(project.startDate).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const batchRule = batchLabel
    ? `All activity IDs must be prefixed with ${batchLabel}- (e.g. ${batchLabel}-ACT-01).`
    : '';

  const msg = await callWithRetry(
    () =>
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        system:
          'Expert construction planning engineer. Return ONLY a raw JSON object — no markdown, no fences. Keep string values under 50 chars.',
        messages: [
          {
            role: 'user',
            content: `Generate a CPM schedule for this construction project.

PROJECT: ${project.name} | ${project.type || 'Construction'} | Start:${startDate} | Duration:${duration} ${durationUnit} | Value:${cv}

BOQ (${boqCount} items):
${boqText}

${batchRule}
${prevContext}

Return ONLY this JSON (no extra keys):
{"projectSummary":{"name":"","startDate":"","endDate":"","totalDuration":"","totalBudget":0,"totalActivities":0,"criticalActivities":0,"totalMilestones":0},"activities":[{"id":"","wbs":"","name":"","phase":"","duration":0,"earlyStart":0,"earlyFinish":0,"lateStart":0,"lateFinish":0,"totalFloat":0,"critical":false,"isMilestone":false,"predecessors":"","budget":0}],"criticalPath":[{"seq":0,"id":"","name":"","duration":0,"earlyStart":0,"earlyFinish":0}],"wbs":[{"code":"","level":1,"name":"","budget":0}],"milestones":[{"id":"","name":"","day":0,"phase":"","critical":false}]}

RULES:
- ES/EF/LS/LF = working days from day 0. TF = LF-EF.
- Generate 20-30 activities that cover all BOQ sections.
- ${batchRule || `Fit the full ${duration} ${durationUnit} duration.`}
- Output COMPLETE valid JSON — do not truncate.`,
          },
        ],
      }),
    onRetry,
  );

  if (msg.stop_reason === 'max_tokens') {
    console.warn('[schedule] Phase A hit max_tokens — attempting JSON repair');
  }

  const cleaned = stripMarkdownJsonFences(extractText(msg));
  return parseJsonWithRepair(cleaned, 'activities generation');
}

/**
 * Phase B: generate supporting data (risks, assumptions, long-lead, resources).
 * Non-fatal — if this fails the schedule is still saved with empty arrays.
 */
async function generateSupportData(project, activityNames, { onRetry } = {}) {
  const duration = project.duration || 18;
  const durationUnit = project.durationUnit || 'months';

  const msg = await callWithRetry(
    () =>
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system:
          'Expert construction planning engineer. Return ONLY a raw JSON object — no markdown, no fences. Keep string values under 60 chars.',
        messages: [
          {
            role: 'user',
            content: `Generate supporting risk and procurement data for:
PROJECT: ${project.name} | Duration: ${duration} ${durationUnit}
Activities: ${activityNames.slice(0, 20).join(', ')}

Return ONLY this JSON:
{"risks":[{"ref":"","description":"","probability":"medium","impact":"medium","severity":"MEDIUM","mitigation":"","phase":""}],"longLeadItems":[{"item":"","leadWeeks":0,"orderBy":"","activity":"","criticality":"medium","risk":""}],"assumptions":[{"ref":"","title":"","description":"","impact":""}],"resourceSummary":[{"phase":"","peakLabor":0,"avgLabor":0,"keyEquipment":"","keyMaterials":""}]}

RULES: 5-7 risks (HIGH/MEDIUM/LOW severity). 4-6 long-lead items. 4-6 assumptions. Complete valid JSON.`,
          },
        ],
      }),
    onRetry,
  );

  if (msg.stop_reason === 'max_tokens') {
    console.warn('[schedule] Phase B hit max_tokens — attempting JSON repair');
  }

  const cleaned = stripMarkdownJsonFences(extractText(msg));
  return parseJsonWithRepair(cleaned, 'support data generation');
}

function extractJsonArray(rawText) {
  const cleaned = stripMarkdownJsonFences(rawText);
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  return parseJsonWithRepair(
    cleaned.slice(start, end + 1),
    'resource allocation',
  );
}

function normalizeResourceType(value) {
  const type = String(value || '')
    .toLowerCase()
    .trim();
  if (type === 'labour') return 'labor';
  if (['labor', 'equipment', 'material'].includes(type)) return type;
  return null;
}

async function allocateResources({
  projectName,
  activities,
  boqSummary,
  onRetry,
}) {
  const activityList = activities.slice(0, 80).map((activity) => ({
    activityId: activity.p6ActivityId || activity.wbsCode || activity.id,
    name: activity.name,
    duration: activity.duration,
    discipline: activity.category || 'general',
  }));

  const msg = await callWithRetry(
    () =>
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 7000,
        system:
          'You are a construction resource planner. Return ONLY valid JSON array. No markdown.',
        messages: [
          {
            role: 'user',
            content: `Project: ${projectName}\nBOQ summary: ${boqSummary || 'N/A'}\n\nFor each activity, allocate realistic resources.\nReturn ONLY JSON array in this exact shape:\n[\n  {\n    "activityId": "A-001",\n    "resources": [\n      { "resourceType": "labor", "resourceName": "Carpenter", "quantity": 4, "unit": "persons", "dailyRate": 80 }\n    ]\n  }\n]\n\nActivities:\n${JSON.stringify(activityList, null, 2)}\n\nRules:\n- resourceType must be labor, equipment, or material\n- quantity must be positive number\n- dailyRate should be realistic USD/day or USD/unit\n- Keep 1-4 resources per activity`,
          },
        ],
      }),
    onRetry,
  );

  const raw = extractText(msg);
  const parsed = extractJsonArray(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('AI did not return resource allocation array');
  }

  return parsed;
}

async function saveResourceAllocations(projectId, allocations) {
  await prisma.resourceAllocation.deleteMany({ where: { projectId } });

  const activities = await prisma.activity.findMany({
    where: { projectId },
    select: {
      id: true,
      duration: true,
      p6ActivityId: true,
      wbsCode: true,
      name: true,
    },
  });

  const lookup = new Map();
  for (const activity of activities) {
    lookup.set(activity.id, activity);
    if (activity.p6ActivityId) lookup.set(activity.p6ActivityId, activity);
    if (activity.wbsCode) lookup.set(activity.wbsCode, activity);
    lookup.set(activity.name, activity);
  }

  const rows = [];
  for (const block of allocations) {
    const activityKey = String(block?.activityId || '').trim();
    const activity = lookup.get(activityKey);
    if (!activity) continue;

    const resources = Array.isArray(block?.resources) ? block.resources : [];
    for (const resource of resources) {
      const resourceType = normalizeResourceType(resource?.resourceType);
      if (!resourceType) continue;

      const quantity = Math.max(0, Number(resource?.quantity) || 0);
      if (!quantity) continue;

      const dailyRate =
        resource?.dailyRate === null || resource?.dailyRate === undefined
          ? null
          : Math.max(0, Number(resource.dailyRate) || 0);

      const duration = Math.max(0, Number(activity.duration) || 0);
      const totalCost =
        dailyRate !== null
          ? Number((dailyRate * quantity * duration).toFixed(2))
          : null;

      rows.push({
        projectId,
        activityId: activity.id,
        resourceType,
        resourceName:
          String(resource?.resourceName || '').trim() || 'Unspecified',
        quantity,
        unit: resource?.unit ? String(resource.unit).trim() : null,
        dailyRate,
        totalCost,
        notes: null,
      });
    }
  }

  if (rows.length > 0) {
    await prisma.resourceAllocation.createMany({ data: rows });
  }

  return rows.length;
}

async function generateCpmScheduleBatch(
  boqRows,
  project,
  batchLabel = null,
  prevContext = '',
  { onRetry } = {},
) {
  const boqText = boqRows
    .map(
      (r) =>
        `${r.ref || '-'}|${r.description}|${r.unit}|Qty:${r.qty}|Rate:${r.rate}|Amt:${r.amount}|Sec:${r.section}`,
    )
    .join('\n');

  // Phase A — core schedule (activities, CPM, WBS, milestones)
  const coreJson = await generateActivities(
    boqText,
    boqRows.length,
    project,
    batchLabel,
    prevContext,
    { onRetry },
  );

  // Phase B — supporting data (risks, long-lead, assumptions, resources)
  const activityNames = (coreJson.activities || []).map((a) => a.name || '');
  let supportJson = {
    risks: [],
    longLeadItems: [],
    assumptions: [],
    resourceSummary: [],
  };
  try {
    supportJson = await generateSupportData(project, activityNames, {
      onRetry,
    });
  } catch (e) {
    console.warn(
      '[schedule] Phase B (support data) failed — saving without it:',
      e.message,
    );
  }

  return { ...coreJson, ...supportJson };
}

async function generateCpmSchedule(boqRows, project, { onRetry } = {}) {
  return generateCpmScheduleBatch(boqRows, project, null, '', { onRetry });
}

async function generateCpmScheduleChunked(
  boqRows,
  project,
  { onBatchStart, onRetry } = {},
) {
  const batches = chunkBoqRows(boqRows, 60);

  if (batches.length === 1) {
    if (onBatchStart) onBatchStart(1, 1);
    return generateCpmSchedule(boqRows, project, {
      onRetry: (attempt, waitMs, status) => {
        if (onRetry) {
          onRetry(attempt, waitMs, {
            status,
            batchNum: 1,
            totalBatches: 1,
            batchLabel: 'B1',
          });
        }
      },
    });
  }

  const allActivities = [];
  let lastBatchIds = [];
  let mergedSchedule = null;

  for (let i = 0; i < batches.length; i += 1) {
    const batchNum = i + 1;
    const batchRows = batches[i];
    const batchLabel = `B${batchNum}`;

    if (onBatchStart) onBatchStart(batchNum, batches.length);

    const prevContext =
      lastBatchIds.length > 0
        ? `PREVIOUS BATCH ACTIVITY IDs (use as predecessors where logical): ${lastBatchIds.join(', ')}`
        : '';

    const batchSchedule = await generateCpmScheduleBatch(
      batchRows,
      project,
      batchLabel,
      prevContext,
      {
        onRetry: (attempt, waitMs, status) => {
          if (onRetry) {
            onRetry(attempt, waitMs, {
              status,
              batchNum,
              totalBatches: batches.length,
              batchLabel,
            });
          }
        },
      },
    );

    const tagged = (batchSchedule.activities || []).map((activity, index) => {
      const fallbackId = `ACT-${String(index + 1).padStart(2, '0')}`;
      const sourceId = String(activity.id || fallbackId).trim();
      const normalizedId = sourceId.startsWith(`${batchLabel}-`)
        ? sourceId
        : `${batchLabel}-${sourceId}`;

      return {
        ...activity,
        id: normalizedId,
        batchId: batchLabel,
      };
    });

    allActivities.push(...tagged);
    lastBatchIds = tagged.map((activity) => activity.id);

    if (!mergedSchedule) {
      mergedSchedule = {
        ...batchSchedule,
        activities: [...tagged],
        risks: [...(batchSchedule.risks || [])],
        longLeadItems: [...(batchSchedule.longLeadItems || [])],
        assumptions: [...(batchSchedule.assumptions || [])],
        wbs: [...(batchSchedule.wbs || [])],
        milestones: [...(batchSchedule.milestones || [])],
        resourceSummary: [...(batchSchedule.resourceSummary || [])],
        criticalPath: [...(batchSchedule.criticalPath || [])],
      };
    } else {
      mergedSchedule.activities = allActivities;
      mergedSchedule.risks = [
        ...(mergedSchedule.risks || []),
        ...(batchSchedule.risks || []),
      ];
      mergedSchedule.longLeadItems = [
        ...(mergedSchedule.longLeadItems || []),
        ...(batchSchedule.longLeadItems || []),
      ];
      mergedSchedule.assumptions = [
        ...(mergedSchedule.assumptions || []),
        ...(batchSchedule.assumptions || []),
      ];
      mergedSchedule.wbs = [
        ...(mergedSchedule.wbs || []),
        ...(batchSchedule.wbs || []),
      ];
      mergedSchedule.milestones = [
        ...(mergedSchedule.milestones || []),
        ...(batchSchedule.milestones || []),
      ];
      mergedSchedule.resourceSummary = [
        ...(mergedSchedule.resourceSummary || []),
        ...(batchSchedule.resourceSummary || []),
      ];
      mergedSchedule.criticalPath = [
        ...(mergedSchedule.criticalPath || []),
        ...(batchSchedule.criticalPath || []),
      ];
    }
  }

  const baseSummary = mergedSchedule?.projectSummary || {};
  const totalBudget = allActivities.reduce(
    (sum, activity) => sum + normalizeNumber(activity.budget),
    0,
  );
  mergedSchedule.activities = allActivities;
  mergedSchedule.projectSummary = {
    ...baseSummary,
    totalActivities: allActivities.length,
    criticalActivities: allActivities.filter((activity) =>
      Boolean(activity.critical),
    ).length,
    totalMilestones: allActivities.filter((activity) =>
      Boolean(activity.isMilestone),
    ).length,
    totalBudget,
  };

  return mergedSchedule;
}

function validateForGeneration(project, boqRows) {
  const errors = [];

  if (!project.name || !project.name.trim()) {
    errors.push('Project name is required');
  }
  if (!project.startDate) {
    errors.push('Project start date is required');
  }
  if (!project.duration || project.duration <= 0) {
    errors.push('Project duration must be greater than 0');
  }

  const describedRows = boqRows.filter(
    (row) => row.description && String(row.description).trim(),
  );
  if (describedRows.length < 2) {
    errors.push('At least 2 BOQ items with descriptions are required');
  }

  const negativeQty = boqRows.find((row) => normalizeNumber(row.qty) < 0);
  if (negativeQty) {
    errors.push(
      `Negative quantity found: "${negativeQty.description || 'Unknown item'}"`,
    );
  }

  const negativeRate = boqRows.find((row) => normalizeNumber(row.rate) < 0);
  if (negativeRate) {
    errors.push(
      `Negative rate found: "${negativeRate.description || 'Unknown item'}"`,
    );
  }

  return errors;
}

// -- In-memory async job store (TTL: 2 hours) --------------------------------
const jobs = new Map(); // jobId -> { status, step, error, projectId }

function setJob(jobId, data) {
  jobs.set(jobId, { ...jobs.get(jobId), ...data, updatedAt: Date.now() });
}

// Clean up jobs older than 2 hours every 30 minutes
setInterval(
  () => {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, job] of jobs) {
      if (job.updatedAt < cutoff) jobs.delete(id);
    }
  },
  30 * 60 * 1000,
);

const getJob = (jobId) => jobs.get(jobId) || null;

async function runGeneratePipeline({
  jobId,
  orgId,
  projectId,
  rawText,
  project,
  label,
}) {
  try {
    // Step 2: structure BOQ
    setJob(jobId, {
      status: 'running',
      step: JOB_STEPS[0].label,
      currentStep: 0,
      totalSteps: JOB_STEPS.length,
      steps: JOB_STEPS,
      progress: 10,
    });
    let boqRows;
    try {
      boqRows = await structureBoqRows(rawText, {
        onRetry: (attempt, waitMs, status) => {
          const seconds = Math.max(1, Math.round(waitMs / 1000));
          const label = status === 529 ? 'API overloaded' : 'Rate limited';
          setJob(jobId, {
            step: `${JOB_STEPS[0].label} (${label} - retrying in ${seconds}s, attempt ${attempt})`,
          });
        },
      });
    } catch (e) {
      console.error('[schedule] BOQ parsing failed:', e);
      return setJob(jobId, {
        status: 'error',
        error: `AI BOQ parsing failed: ${e.message}`,
      });
    }
    if (!Array.isArray(boqRows) || boqRows.length === 0) {
      return setJob(jobId, {
        status: 'error',
        error: 'No BOQ items found in file',
      });
    }

    const validationErrors = validateForGeneration(project, boqRows);
    if (validationErrors.length > 0) {
      return setJob(jobId, {
        status: 'error',
        error: `Validation failed:\n• ${validationErrors.join('\n• ')}`,
      });
    }

    // Step 3: generate CPM schedule
    setJob(jobId, {
      step: JOB_STEPS[1].label,
      currentStep: 1,
      progress: 45,
    });
    let scheduleJson;
    try {
      scheduleJson = await generateCpmScheduleChunked(boqRows, project, {
        onBatchStart: (batchNum, totalBatches) => {
          if (totalBatches > 1) {
            setJob(jobId, {
              step: `${JOB_STEPS[1].label} (batch ${batchNum}/${totalBatches})`,
              progress: Math.min(75, 45 + batchNum * 5),
            });
          } else {
            setJob(jobId, { step: JOB_STEPS[1].label, progress: 65 });
          }
        },
        onRetry: (attempt, waitMs, context) => {
          const seconds = Math.max(1, Math.round(waitMs / 1000));
          const label =
            context?.status === 529 ? 'API overloaded' : 'Rate limited';
          const batchSuffix =
            context?.totalBatches > 1
              ? ` for batch ${context.batchNum} of ${context.totalBatches}`
              : '';
          setJob(jobId, {
            step: `${JOB_STEPS[1].label} (${label}${batchSuffix}, retrying in ${seconds}s, attempt ${attempt})`,
          });
        },
      });
    } catch (e) {
      console.error('[schedule] CPM generation failed:', e);
      return setJob(jobId, {
        status: 'error',
        error: `AI schedule generation failed: ${e.message}`,
      });
    }

    // Step 4: persist
    setJob(jobId, { step: 'Saving generated schedule', progress: 80 });
    await prisma.$transaction(async (tx) => {
      await tx.boqItem.deleteMany({ where: { projectId } });
      await tx.activityMaterial.deleteMany({
        where: { activity: { projectId } },
      });
      await tx.activityEquipment.deleteMany({
        where: { activity: { projectId } },
      });
      await tx.activityAssignment.deleteMany({
        where: { activity: { projectId } },
      });
      await tx.activityProgress.deleteMany({
        where: { activity: { projectId } },
      });
      await tx.costRecord.deleteMany({ where: { projectId } });
      await tx.longLeadItem.deleteMany({ where: { projectId } });
      await tx.risk.deleteMany({ where: { projectId } });
      await tx.activity.deleteMany({ where: { projectId } });

      await tx.boqItem.createMany({
        data: boqRows.map((row, i) => ({
          projectId,
          ref: row.ref || null,
          description: String(row.description || ''),
          unit: row.unit || null,
          qty: normalizeNumber(row.qty),
          rate: normalizeNumber(row.rate),
          amount: normalizeNumber(row.amount),
          section: row.section || null,
          sortOrder: i,
        })),
      });

      const activities = Array.isArray(scheduleJson.activities)
        ? scheduleJson.activities
        : [];
      if (activities.length > 0) {
        await tx.activity.createMany({
          data: activities.map((activity, i) => ({
            projectId,
            name: String(activity.name || 'Activity'),
            wbsCode: activity.wbs || null,
            category: activity.phase || null,
            duration: Number(activity.duration) || 0,
            earlyStart: Number(activity.earlyStart) || 0,
            earlyFinish: Number(activity.earlyFinish) || 0,
            lateStart:
              activity.lateStart != null ? Number(activity.lateStart) : null,
            lateFinish:
              activity.lateFinish != null ? Number(activity.lateFinish) : null,
            totalFloat:
              activity.totalFloat != null ? Number(activity.totalFloat) : null,
            budget: Number(activity.budget) || 0,
            isMilestone: Boolean(activity.isMilestone),
            isCritical: Boolean(activity.critical),
            predecessors: activity.predecessors || null,
            batchId: activity.batchId || null,
            sortOrder: i,
          })),
        });
      }

      const createdActivities = await tx.activity.findMany({
        where: { projectId },
        select: {
          id: true,
          name: true,
          wbsCode: true,
          budget: true,
          category: true,
        },
      });

      if (createdActivities.length > 0) {
        await tx.costRecord.createMany({
          data: createdActivities.map((activity) => ({
            activityId: activity.id,
            projectId,
            budget: activity.budget || 0,
            labour: (activity.budget || 0) * 0.35,
            material: (activity.budget || 0) * 0.3,
            equipment: (activity.budget || 0) * 0.15,
            subcontract: (activity.budget || 0) * 0.1,
            indirect: (activity.budget || 0) * 0.05,
            overhead: (activity.budget || 0) * 0.03,
            contingency: (activity.budget || 0) * 0.02,
            committed: 0,
            actual: 0,
            forecast: activity.budget || 0,
          })),
        });
      }

      if (Array.isArray(scheduleJson.risks) && scheduleJson.risks.length > 0) {
        await tx.risk.createMany({
          data: scheduleJson.risks.map((risk, i) => ({
            projectId,
            ref: risk.ref || `RSK-${String(i + 1).padStart(2, '0')}`,
            description: String(risk.description || ''),
            probability: String(risk.probability || 'medium').toLowerCase(),
            impact: String(risk.impact || 'medium').toLowerCase(),
            severity: String(risk.severity || 'MEDIUM').toUpperCase(),
            mitigation: risk.mitigation || null,
            phase: risk.phase || null,
            owner: risk.owner || null,
            status: risk.status || 'open',
          })),
        });
      }

      if (
        Array.isArray(scheduleJson.longLeadItems) &&
        scheduleJson.longLeadItems.length > 0
      ) {
        const activityLookup = new Map();
        createdActivities.forEach((activity) => {
          activityLookup.set(
            String(activity.name || '').toLowerCase(),
            activity.id,
          );
          if (activity.wbsCode) {
            activityLookup.set(
              String(activity.wbsCode).toLowerCase(),
              activity.id,
            );
          }
        });

        await tx.longLeadItem.createMany({
          data: scheduleJson.longLeadItems.map((item) => {
            const activityRef = String(item.activity || '').toLowerCase();
            return {
              projectId,
              activityId: activityLookup.get(activityRef) || null,
              item: String(item.item || ''),
              leadWeeks: Number(item.leadWeeks) || 0,
              orderBy: item.orderBy || null,
              criticality: item.criticality || null,
              risk: item.risk || null,
              status: 'not_ordered',
              supplier: null,
            };
          }),
        });
      }

      const activityCount = activities.length;
      const criticalCount = activities.filter(
        (activity) => activity.critical,
      ).length;
      const totalBudget = scheduleJson.projectSummary?.totalBudget || 0;

      await tx.scheduleRevision.create({
        data: {
          projectId,
          label: label || 'AI Generated',
          activityCount,
          criticalCount,
          totalBudget,
          snapshotJson: scheduleJson,
        },
      });
    });

    // Step 5: pass 3 resource allocation (non-fatal)
    setJob(jobId, {
      step: JOB_STEPS[2].label,
      currentStep: 2,
      progress: 88,
    });

    try {
      const savedActivities = await prisma.activity.findMany({
        where: { projectId },
        select: {
          id: true,
          name: true,
          category: true,
          duration: true,
          p6ActivityId: true,
          wbsCode: true,
        },
      });

      const boqSummary = boqRows
        .slice(0, 20)
        .map((row) => `${row.section || 'General'}: ${row.description}`)
        .join('; ');

      const allocations = await allocateResources({
        projectName: project.name,
        activities: savedActivities,
        boqSummary,
        onRetry: (attempt, waitMs, status) => {
          const seconds = Math.max(1, Math.round(waitMs / 1000));
          const label = status === 529 ? 'API overloaded' : 'Rate limited';
          setJob(jobId, {
            step: `${JOB_STEPS[2].label} (${label} - retrying in ${seconds}s, attempt ${attempt})`,
          });
        },
      });

      const resourceCount = await saveResourceAllocations(
        projectId,
        allocations,
      );
      setJob(jobId, {
        step: `${JOB_STEPS[2].label} (${resourceCount} records)`,
        progress: 97,
      });
    } catch (resourceError) {
      console.warn(
        '[schedule] Pass 3 resource allocation failed (non-fatal):',
        resourceError.message,
      );
      setJob(jobId, {
        step: `${JOB_STEPS[2].label} skipped: ${resourceError.message}`,
      });
    }

    setJob(jobId, {
      status: 'done',
      step: 'Complete',
      currentStep: JOB_STEPS.length,
      totalSteps: JOB_STEPS.length,
      steps: JOB_STEPS,
      progress: 100,
    });
  } catch (e) {
    console.error('[schedule] Pipeline error:', e);
    setJob(jobId, {
      status: 'error',
      error: e.message || 'Unexpected error',
      steps: JOB_STEPS,
      totalSteps: JOB_STEPS.length,
    });
  }
}

// Returns immediately with jobId; processing runs in background
const startGenerateJob = async ({ orgId, projectId, file, label = null }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project)
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  let rawText;
  try {
    rawText = parseFileToText(file);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(
      400,
      'FILE_PARSE_ERROR',
      `Could not read file: ${e.message}`,
    );
  }
  if (!rawText.trim())
    throw new HttpError(400, 'EMPTY_FILE', 'No content found in file');

  const jobId = `${projectId}-${Date.now()}`;
  setJob(jobId, {
    status: 'running',
    step: JOB_STEPS[0].label,
    currentStep: 0,
    totalSteps: JOB_STEPS.length,
    steps: JOB_STEPS,
    progress: 5,
    projectId,
  });

  // Fire-and-forget - do NOT await
  runGeneratePipeline({ jobId, orgId, projectId, rawText, project, label });

  return { jobId };
};

const getProjectSchedule = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project)
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  const revision = await prisma.scheduleRevision.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });

  if (!revision) return null;

  const activities = await prisma.activity.findMany({
    where: { projectId },
    include: {
      progress: { orderBy: { updatedAt: 'desc' }, take: 1 },
    },
    orderBy: { sortOrder: 'asc' },
  });

  const snap = revision.snapshotJson || {};

  return {
    revision: {
      id: revision.id,
      label: revision.label,
      activityCount: revision.activityCount,
      criticalCount: revision.criticalCount,
      totalBudget: revision.totalBudget,
      createdAt: revision.createdAt,
      projectSummary: snap.projectSummary || null,
      risks: snap.risks || [],
      milestones: snap.milestones || [],
      wbs: snap.wbs || [],
      resourceSummary: snap.resourceSummary || [],
      longLeadItems: snap.longLeadItems || [],
      assumptions: snap.assumptions || [],
      criticalPath: snap.criticalPath || [],
    },
    activities: activities.map((activity) => {
      const latestProgress = activity.progress[0] ?? null;
      const pct = latestProgress?.pctComplete ?? 0;
      const actualCost = latestProgress?.actualCost ?? null;
      const actualStart = latestProgress?.actualStart ?? null;
      const actualFinish = latestProgress?.actualFinish ?? null;
      let status = 'todo';
      if (pct >= 100) status = 'complete';
      else if (pct > 0) status = 'in_progress';
      else if (activity.endDate && new Date() > new Date(activity.endDate))
        status = 'delayed';

      const { progress, ...activityWithoutProgress } = activity;
      return {
        ...activityWithoutProgress,
        pctComplete: pct,
        actualCost,
        actualStart,
        actualFinish,
        status,
      };
    }),
  };
};

const listRevisions = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return prisma.scheduleRevision.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      label: true,
      activityCount: true,
      criticalCount: true,
      totalBudget: true,
      createdAt: true,
    },
  });
};

const getRevision = async ({ orgId, projectId, revisionId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return prisma.scheduleRevision.findFirst({
    where: { id: revisionId, projectId },
  });
};

const lockBaseline = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  const activities = await prisma.activity.findMany({
    where: { projectId },
    select: { id: true, earlyStart: true, earlyFinish: true },
  });

  if (activities.length === 0) {
    return { locked: 0 };
  }

  await prisma.$transaction(
    activities.map((activity) =>
      prisma.activity.update({
        where: { id: activity.id },
        data: {
          baselineStart: activity.earlyStart,
          baselineFinish: activity.earlyFinish,
        },
      }),
    ),
  );

  return { locked: activities.length };
};

const getResourcePlan = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  const resources = await prisma.resourceAllocation.findMany({
    where: { projectId },
    include: {
      activity: {
        select: {
          id: true,
          name: true,
          p6ActivityId: true,
          wbsCode: true,
        },
      },
    },
    orderBy: [{ activityId: 'asc' }, { createdAt: 'asc' }],
  });

  const groupedMap = new Map();
  for (const row of resources) {
    if (!groupedMap.has(row.activityId)) {
      groupedMap.set(row.activityId, {
        activity: {
          id: row.activity.id,
          activityId:
            row.activity.p6ActivityId ||
            row.activity.wbsCode ||
            row.activity.id,
          name: row.activity.name,
        },
        resources: [],
      });
    }

    groupedMap.get(row.activityId).resources.push({
      id: row.id,
      resourceType: row.resourceType,
      resourceName: row.resourceName,
      quantity: row.quantity,
      unit: row.unit,
      dailyRate: row.dailyRate,
      totalCost: row.totalCost,
      notes: row.notes,
    });
  }

  const summary = {
    totalLaborCost: 0,
    totalEquipmentCost: 0,
    totalMaterialCost: 0,
  };

  for (const row of resources) {
    const cost = Number(row.totalCost || 0);
    if (row.resourceType === 'labor') summary.totalLaborCost += cost;
    if (row.resourceType === 'equipment') summary.totalEquipmentCost += cost;
    if (row.resourceType === 'material') summary.totalMaterialCost += cost;
  }

  return {
    resources: Array.from(groupedMap.values()),
    summary,
  };
};

module.exports = {
  startGenerateJob,
  getJob,
  getProjectSchedule,
  listRevisions,
  getRevision,
  lockBaseline,
  getResourcePlan,
};
