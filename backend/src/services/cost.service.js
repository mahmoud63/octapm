const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  addMoney,
  divideMoney,
  multiplyMoney,
  subtractMoney,
  toMoneyNumber,
} = require('../utils/money');
const {
  containsInsensitive,
  cursorArgs,
  equalsInsensitive,
  normalizeListQuery,
  toCursorPage,
  trimToNull,
} = require('../utils/list-query');
const {
  getApprovedActivityAllocationTotals,
} = require('./activity-boq-allocation.service');
const auditService = require('./audit.service');
// Source / derived / projection labels (control model §3) — labels only.
const {
  TRUTHS,
  projection,
  BUDGET_LABELS,
  COST_RECORD_FORECAST_BASIS_PER_RECORD,
  COST_RECORD_FORECAST_DEFAULT_RULE,
  COST_RECORD_PROJECTED_FINAL_COST_LABEL,
} = require('../utils/figure-truth');
// Where a record's stored forecast came from (owner decision R5-2).
const {
  FORECAST_BASIS,
  forecastOnCreate,
  forecastOnUpdate,
  forecastSourceMix,
  isAmountShaped,
  projectedFinalCost,
  withForecastBasis,
} = require('../utils/cost-forecast');
// Which order a caller who may not read the BOQ is given on sortBy=forecast:
// decided where every BOQ withholding is (utils/boq-figures).
const { costRecordsByVisibleForecast } = require('../utils/boq-figures');

// What each figure of the cost summary is, and from what. The same words for
// every project and reader; they describe keys, never values, so a figure
// utils/boq-figures withholds leaves only its label behind.
const COST_SUMMARY_TRUTH = Object.freeze({
  budget: {
    truth: TRUTHS.DERIVED,
    label: BUDGET_LABELS.register,
    derivedFrom: 'Budget register: original budget + approved changes + revisions on the budget lines',
    // The other two budgets the product states, each under its own name
    // (control model §3, consequence 1) — neither is this one.
    otherBudgets: [
      { label: BUDGET_LABELS.evBudgetAtCompletion, derivedFrom: 'Approved allocations + approved budget revisions', where: 'the earned-value report (totalBudget)' },
      { label: BUDGET_LABELS.contractWaterfall, derivedFrom: 'Project contract value + approved budget revisions', where: 'the budget revisions waterfall' },
    ],
  },
  allocatedToActivities: {
    truth: TRUTHS.DERIVED,
    label: 'Allocated to activities',
    derivedFrom: "The approved BOQ allocations of the activities with a cost record — not the project's budget",
  },
  totals: {
    budget: TRUTHS.DERIVED,
    committed: TRUTHS.DERIVED,
    actual: TRUTHS.DERIVED,
    forecast: projection('estimate_at_completion'),
    // Owner decision R5-2: this is the cost records' own projection, not the
    // earned-value EAC (revised budget ÷ CPI, D2) — the label says so.
    labels: { forecast: COST_RECORD_PROJECTED_FINAL_COST_LABEL },
    derivedFrom: {
      budget: "Each cost record's approved allocation",
      committed: 'Executed commitments and approved commitment change orders (commitment.service)',
      actual: 'The cost ledger (CostLedgerEntry)',
      forecast:
        "Σ each record's projected final cost (forecastSources counts each kind). An entered forecast counts as entered — 0 included — and never below the record's actual: below it, the actual counts. A default is not counted as a forecast: the larger of the record's budget and actual, as they are now, counts. A forecast whose source was not recorded counts when above 0 and not below actual; otherwise the larger of the record's budget and actual counts. Not the earned-value EAC (revised budget ÷ CPI)",
    },
  },
  records: {
    // Each record says its own basis (forecastSource, forecastBasis); the
    // summary's forecastSources counts them. No record's forecast is presented
    // as the default rule unless it is one (R5-2).
    forecast: projection(COST_RECORD_FORECAST_BASIS_PER_RECORD),
    derivedFrom: {
      forecast: `Per record, as its forecastSource says: entered on the record; the initial default when none was entered — ${COST_RECORD_FORECAST_DEFAULT_RULE}, as they were when it was set; or not recorded (written before the source was kept, treated as entered)`,
    },
    basis: FORECAST_BASIS,
  },
  eac: {
    truth: projection('estimate_at_completion'),
    label: `${COST_RECORD_PROJECTED_FINAL_COST_LABEL}: scenarios`,
    derivedFrom:
      'Actual + the cost to complete (most likely − actual): optimistic × 0.9, pessimistic × 1.15. Built from the cost records, not the earned-value EAC (revised budget ÷ CPI)',
  },
});

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
};

const parseOptionalDate = (value, field = 'date') => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'INVALID_DATE', `${field} is invalid`);
  }

  return date;
};

const resolveActualThroughDate = ({ payload }) => {
  // The date the actual is good through is the ledger's (it advances it with
  // every posting). An edit writes it only when the caller supplies one;
  // writing back the date it had read erased a posting's advance that landed
  // in between (Phase 21D, CX21-436). `undefined` means "not written".
  return parseOptionalDate(payload.actualThroughDate, 'actualThroughDate');
};

const COST_RECORD_INCLUDE = {
  activity: {
    select: {
      id: true,
      name: true,
      wbsCode: true,
      category: true,
      sortOrder: true,
    },
  },
};

const COST_SORT_FIELDS = [
  'activity',
  'phase',
  'updated',
  'labour',
  'material',
  'equipment',
  'subcontract',
  'committed',
  'actual',
  'forecast',
];

const buildCostWhere = ({ projectId, query = {} }) => {
  const activity = { isActive: true };
  const where = { projectId, activity };

  const activityId = trimToNull(query.activityId);
  if (activityId) where.activityId = activityId;

  const category = trimToNull(query.category);
  if (category) activity.category = equalsInsensitive(category);

  const search = trimToNull(query.search);
  if (search) {
    activity.OR = [
      { name: containsInsensitive(search) },
      { wbsCode: containsInsensitive(search) },
      { category: containsInsensitive(search) },
    ];
  }

  return where;
};

const buildCostOrderBy = ({ sortBy, sortDir }) => {
  if (sortBy === 'activity') {
    return [{ activity: { sortOrder: sortDir } }, { id: sortDir }];
  }

  if (sortBy === 'phase') {
    return [{ activity: { category: sortDir } }, { id: sortDir }];
  }

  if (sortBy === 'updated') {
    return [{ updatedAt: sortDir }, { id: sortDir }];
  }

  return [{ [sortBy]: sortDir }, { id: sortDir }];
};

const attachApprovedBudgets = async ({ projectId, records }) => {
  const activityIds = records.map((record) => record.activityId).filter(Boolean);
  const allocationTotals = await getApprovedActivityAllocationTotals({
    projectId,
    activityIds,
  });
  // Rows whose committed is the executed commitments' figure are marked, so
  // the screen does not offer to edit what the edit would refuse (CX21-493).
  const { activitiesWithExecutedCommitments } = require('./commitment.service');
  const derived = await activitiesWithExecutedCommitments({ projectId });

  // Each record carries its forecast's source and basis (R5-2), so a default
  // is never read as an entered forecast.
  return records.map((record) => withForecastBasis({
    ...record,
    generatedBudget: record.budget,
    budget: allocationTotals.get(record.activityId)?.amount || 0,
    committedDerived: derived.has(record.activityId),
  }));
};

const findCostRecords = ({ projectId, query = {}, listQuery = null }) => {
  const normalized =
    listQuery ||
    normalizeListQuery(query, {
      allowedSorts: COST_SORT_FIELDS,
      defaultSortBy: 'activity',
      defaultSortDir: 'asc',
      defaultLimit: 25,
    });

  return prisma.costRecord.findMany({
    where: buildCostWhere({ projectId, query }),
    include: COST_RECORD_INCLUDE,
    orderBy: buildCostOrderBy(normalized),
    ...(listQuery
      ? {
          take: normalized.limit + 1,
          ...cursorArgs(normalized.cursor),
        }
      : {}),
  });
};

/**
 * One page of the register on sortBy=forecast for a caller who may not read
 * the BOQ: the default forecasts are withheld from that caller, so they do
 * not take part in the order either (utils/boq-figures
 * costRecordsByVisibleForecast). The order is worked from the three columns it
 * needs and the page's rows are then read by id; the cursor is the last row's
 * id, as on every other sort.
 */
const findCostRecordsByVisibleForecast = async ({ projectId, query, listQuery }) => {
  const keys = await prisma.costRecord.findMany({
    where: buildCostWhere({ projectId, query }),
    select: { id: true, forecast: true, forecastSource: true },
  });
  const ordered = costRecordsByVisibleForecast(keys, listQuery.sortDir);
  let start = 0;
  if (listQuery.cursor) {
    const at = ordered.findIndex((key) => key.id === listQuery.cursor);
    // A cursor that names no row of this list ends it, as the database's does.
    start = at < 0 ? ordered.length : at + 1;
  }
  const ids = ordered.slice(start, start + listQuery.limit + 1).map((key) => key.id);
  if (!ids.length) return [];
  const rows = await prisma.costRecord.findMany({
    where: { projectId, id: { in: ids } },
    include: COST_RECORD_INCLUDE,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
};

/**
 * `boqAccess` is the caller's BOQ access (utils/boq-figures boqFigureAccess).
 * It decides one thing here — the order on sortBy=forecast; what each row
 * carries is withheld by the route, as before. A caller that passes none is
 * treated as a BOQ reader (the service's other callers are not requests).
 */
const getCostRecords = async ({ orgId, projectId, query = {}, boqAccess = null }) => {
  await ensureProject({ orgId, projectId });

  const listQuery = normalizeListQuery(query, {
    allowedSorts: COST_SORT_FIELDS,
    defaultSortBy: 'activity',
    defaultSortDir: 'asc',
  });
  const forecastOrderWithheld = Boolean(boqAccess && !boqAccess.boq && listQuery.sortBy === 'forecast');
  const records = forecastOrderWithheld
    ? await findCostRecordsByVisibleForecast({ projectId, query, listQuery })
    : await findCostRecords({ projectId, query, listQuery });
  const page = toCursorPage(records, listQuery.limit);
  const rows = await attachApprovedBudgets({
    projectId,
    records: page.rows,
  });

  return {
    rows,
    pagination: page.pagination,
    // Said, not silent: the rows whose forecast this caller is not given are
    // not ordered by it.
    ...(forecastOrderWithheld
      ? {
          sortWithheld: {
            sortBy: 'forecast',
            reason:
              'Records with a default forecast are not ordered by it: they follow the others, in a fixed order. A default forecast is available only to members who may read the BOQ',
          },
        }
      : {}),
  };
};

const summarizeTotals = (records) =>
  records.reduce(
    (acc, record) => {
      acc.budget = addMoney(acc.budget, record.budget);
      acc.committed = addMoney(acc.committed, record.committed);
      acc.actual = addMoney(acc.actual, record.actual);
      acc.forecast = addMoney(acc.forecast, record.forecast);
      return acc;
    },
    { budget: 0, committed: 0, actual: 0, forecast: 0 },
  );

const getCostSummary = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const records = await attachApprovedBudgets({
    projectId,
    records: await findCostRecords({
      projectId,
      query: {},
      listQuery: null,
    }),
  });

  const byPhaseMap = new Map();
  for (const record of records) {
    const phase = record.activity?.category || 'General';
    const current = byPhaseMap.get(phase) || {
      phase,
      budget: 0,
      committed: 0,
      actual: 0,
      forecast: 0,
    };

    current.budget = addMoney(current.budget, record.budget);
    current.committed = addMoney(current.committed, record.committed);
    current.actual = addMoney(current.actual, record.actual);
    current.forecast = addMoney(current.forecast, estimateAtCompletion(record));
    byPhaseMap.set(phase, current);
  }

  const totals = summarizeTotals(records);
  // "Forecast" on the summary is the most-likely estimate at completion —
  // the same figure the scenario card shows, so one word means one thing.
  const mostLikely = records.reduce((sum, record) => addMoney(sum, estimateAtCompletion(record)), 0);
  totals.forecast = mostLikely;
  const eac = estimateScenarios({ actual: totals.actual, mostLikely });

  // The project's budget as the budget register states it — original,
  // approved changes, revisions, revised — so the cost cockpit and the
  // budget register give the same answer to "what is my budget?" (Phase 22A).
  // The per-activity figure is what has been allocated to activities, and
  // is labelled as such rather than as "the budget".
  const budget = await canonicalBudget({ orgId, projectId });

  return {
    records,
    byPhase: Array.from(byPhaseMap.values()).map((row) => ({
      ...row,
      variance: subtractMoney(row.budget, row.forecast),
      variancePct:
        row.budget > 0 ? ((row.budget - row.forecast) / row.budget) * 100 : 0,
    })),
    totals,
    eac,
    budget: { ...budget, label: BUDGET_LABELS.register, allocatedToActivities: totals.budget },
    // How many records' forecasts were entered, are the initial default, or
    // were not recorded (R5-2): the total above mixes them, and says so.
    forecastSources: forecastSourceMix(records),
    truth: COST_SUMMARY_TRUTH,
  };
};

/**
 * A record's estimate at completion: its forecast when that is a forecast at
 * completion (set, and not below what is already spent); otherwise the larger
 * of its budget and its actual — a record never expects to finish below what
 * it has already cost. The most-likely figure used to be a raw sum of
 * per-record forecasts, many of them unset, and sat below actual-to-date
 * while the optimistic and pessimistic cards were plain budget multiples
 * (Phase 22A, from the Phase 22 audit UX22-02).
 *
 * Labelled "Projected final cost (cost records)", never "the EAC": the EAC is
 * the earned-value report's revised budget ÷ CPI (owner decision D2), which
 * reads no cost record's forecast (R5-2).
 *
 * R5-2: an ENTERED forecast is never read as missing because it is falsy — an
 * entered 0 counts as 0 (never below the record's actual), where it used to be
 * replaced by the budget. A DEFAULT is not a forecast anybody made: the record
 * counts the larger of its budget and actual as they are now, not the default
 * frozen when it was set. The rule is keyed on the source; a row whose source
 * was not recorded counts exactly as before, and every existing row is one, so
 * no existing project's total moves (utils/cost-forecast projectedFinalCost).
 */
const estimateAtCompletion = (record) => projectedFinalCost(record);

/**
 * Scenarios vary only the cost to complete (EAC − actual), so they order
 * optimistic ≤ most likely ≤ pessimistic and none falls below actual.
 */
const estimateScenarios = ({ actual, mostLikely }) => {
  const toComplete = Math.max(0, subtractMoney(mostLikely, actual));
  return {
    basis: 'estimate_at_completion',
    actual,
    toComplete,
    optimistic: addMoney(actual, multiplyMoney(toComplete, 0.9)),
    mostLikely,
    pessimistic: addMoney(actual, multiplyMoney(toComplete, 1.15)),
  };
};

const canonicalBudget = async ({ orgId, projectId }) => {
  try {
    const { listBudgetLines } = require('./budget.service');
    const register = await listBudgetLines({ orgId, projectId });
    const totals = register?.summary?.totals || {};
    return {
      originalBudget: toMoneyNumber(totals.originalBudget ?? 0),
      approvedChanges: toMoneyNumber(totals.approvedChanges ?? 0),
      revisions: toMoneyNumber(totals.revisions ?? 0),
      revisedBudget: toMoneyNumber(totals.revisedBudget ?? 0),
      source: 'budget_register',
    };
  } catch {
    return { originalBudget: null, approvedChanges: null, revisions: null, revisedBudget: null, source: null };
  }
};

// A record's stored forecast (owner decision R5-2, utils/cost-forecast). A
// supplied forecast — 0 and "0" included — is stored as given and marked
// 'entered'. Only a record created without one gets the initial default, the
// larger of budget and actual (PC-7a 3d), marked 'default'; an edit re-derives
// that default only when it changes the budget, and never touches an entered
// or not-recorded forecast. It is a projection, never a source figure, and
// never feeds a certified one or the earned-value EAC.

const COST_RECORD_MONEY_FIELDS = ['labour', 'material', 'equipment', 'subcontract', 'indirect', 'overhead', 'contingency', 'budget', 'committed', 'actual', 'forecast'];

/**
 * The figures about to be written obey the CostRecord money check (each a
 * finite amount of 0 or more). The route validators refuse a negative figure
 * a caller sends; this catches one the service would compute, or a caller
 * that is not a route, as a business error naming the field — never the
 * database's refusal, which answered 500 and quoted the Prisma call
 * (PC-7a 3d).
 */
const assertCostRecordMoney = (data) => {
  for (const field of COST_RECORD_MONEY_FIELDS) {
    if (data[field] === undefined || data[field] === null) continue;
    let value = Number.NaN;
    try {
      value = toMoneyNumber(data[field]);
    } catch {
      // not an amount at all — refused below like a negative one
    }
    if (!Number.isFinite(value) || value < 0) {
      throw new HttpError(400, 'COST_RECORD_MONEY_INVALID', `${field} must be an amount of 0 or more`);
    }
  }
};

const runInTransaction = (fn) =>
  prisma.$transaction ? prisma.$transaction(fn) : fn(prisma);

const dateSummary = (value) =>
  value ? new Date(value).toISOString() : null;

const costRecordSummary = (record) => ({
  activityId: record.activityId,
  labour: toMoneyNumber(record.labour),
  material: toMoneyNumber(record.material),
  equipment: toMoneyNumber(record.equipment),
  subcontract: toMoneyNumber(record.subcontract),
  indirect: toMoneyNumber(record.indirect),
  overhead: toMoneyNumber(record.overhead),
  contingency: toMoneyNumber(record.contingency),
  budget: toMoneyNumber(record.budget),
  committed: toMoneyNumber(record.committed),
  actual: toMoneyNumber(record.actual),
  actualThroughDate: dateSummary(record.actualThroughDate),
  forecast: toMoneyNumber(record.forecast),
  // Where the forecast came from (R5-2) — the history says a default is one.
  forecastSource: record.forecastSource ?? null,
});

const burnRateSummary = (entry) => ({
  date: dateSummary(entry.date),
  amount: toMoneyNumber(entry.amount),
  category: entry.category || null,
  note: entry.note || null,
});

const CATEGORY_FIELDS = ['labour', 'material', 'equipment', 'subcontract', 'indirect', 'overhead', 'contingency'];

/**
 * Actual cost is a projection of the cost ledger (OCTA-FIN-LEDGER-059); a
 * figure typed onto the activity would be one the ledger never posted
 * (Phase 21D, CX21-412). An echo of the row's own figure is let through.
 */
const assertActualIsTheLedgers = ({ payload, existing }) => {
  if (payload.actual === undefined) return;
  if (Math.abs(toMoneyNumber(payload.actual) - toMoneyNumber(existing?.actual ?? 0)) > 0.005) {
    throw new HttpError(400, 'COST_ACTUAL_IS_DERIVED', 'Actual cost is posted through the cost ledger; it cannot be typed onto an activity');
  }
};

/**
 * Committed is the executed commitments' projection wherever one names the
 * activity (`recomputeCommitted` writes it); a figure typed there would hide
 * an obligation the project has entered. An activity no commitment names
 * keeps a typed figure, and an echo of the row's own figure is let through
 * (Phase 21D, CX21-493).
 */
const assertCommittedIsTheCommitments = async ({ tx, payload, existing, projectId, activityId }) => {
  if (payload.committed === undefined) return;
  if (Math.abs(toMoneyNumber(payload.committed) - toMoneyNumber(existing?.committed ?? 0)) <= 0.005) return;
  const { hasExecutedCommitmentOn } = require('./commitment.service');
  if (await hasExecutedCommitmentOn({ tx, projectId, activityId })) {
    throw new HttpError(400, 'COST_COMMITTED_IS_DERIVED', "Committed cost on this activity is the executed commitments' figure; it cannot be typed");
  }
};

/**
 * Only what the caller supplied is written. A copy of the row read before
 * the lock was written back over fields the caller never mentioned, and two
 * editors of different fields erased each other's work (Phase 21D, CX21-497);
 * budget, actual, its through-date and committed each have their own owner.
 * The forecast is decided apart (forecastFields), by R5-2's rules.
 */
/**
 * The payload as the service reads it: a money field sent as null is not
 * supplied — as the forecast's null is, and as the route's validator treats it
 * — so `{ budget: null }` writes nothing, where it wrote a budget of 0 and
 * dragged a default forecast down with it. A money field that is not an
 * amount at all (an array, an object) is refused; [7] used to be stored as 0.
 * actualThroughDate keeps its null: that one clears the date.
 */
const suppliedPayload = (payload = {}) => {
  const result = { ...payload };
  for (const field of COST_RECORD_MONEY_FIELDS) {
    if (result[field] === null) delete result[field];
    else if (result[field] !== undefined && !isAmountShaped(result[field])) {
      throw new HttpError(400, 'COST_RECORD_MONEY_INVALID', `${field} must be an amount of 0 or more`);
    }
  }
  return result;
};

const suppliedCostFields = ({ payload, existing }) => {
  const data = {};
  for (const field of CATEGORY_FIELDS) {
    if (payload[field] !== undefined) data[field] = toMoneyNumber(payload[field]);
  }
  if (payload.budget !== undefined) data.budget = toMoneyNumber(payload.budget);
  // committed is written only when it differs from the row's: an echo of the
  // figure read is not written back over a recompute that landed since the
  // read (Phase 21D, CX21-511)
  if (payload.committed !== undefined && Math.abs(toMoneyNumber(payload.committed) - toMoneyNumber(existing?.committed ?? 0)) > 0.005) {
    data.committed = toMoneyNumber(payload.committed);
  }
  const actualThroughDate = resolveActualThroughDate({ payload });
  if (actualThroughDate !== undefined) data.actualThroughDate = actualThroughDate;
  return data;
};

/**
 * The forecast an edit of an existing row writes, and its source (owner
 * decision R5-2): a supplied forecast is stored as given ('entered'); without
 * one an entered or not-recorded forecast is never touched, and a default is
 * re-derived — max(0, new budget, the row's actual) — only when this edit
 * changes the budget. `data` is what suppliedCostFields will write. A
 * client's forecastSource is refused at the route and never read here.
 */
const forecastFields = ({ payload, existing, data }) =>
  forecastOnUpdate({ payloadForecast: payload.forecast, existing, budget: data.budget });

const upsertCostRecord = async ({
  orgId,
  projectId,
  activityId,
  payload: sent,
  userId = null,
  userRole = null,
}) => {
  const payload = suppliedPayload(sent);
  await ensureProject({ orgId, projectId });

  const activity = await prisma.activity.findFirst({
    where: { id: activityId, projectId },
  });
  if (!activity) {
    throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found');
  }

  const allocationTotals = await getApprovedActivityAllocationTotals({
    projectId,
  });
  const approvedBudget = allocationTotals.get(activityId)?.amount || 0;

  return runInTransaction(async (tx) => {
    // One projection row per activity, whoever creates it: the pair is held
    // first and the row is read under it, so every decision below is made on
    // the row as it is now — not on a copy read before — and a posting that
    // created the row meanwhile is updated, not duplicated (Phase 21D,
    // CX21-464, CX21-497).
    if (tx.$executeRaw) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cost-record:${projectId}:${activityId}`}))`;
    const existing = await tx.costRecord.findFirst({ where: { projectId, activityId } });
    assertActualIsTheLedgers({ payload, existing });
    await assertCommittedIsTheCommitments({ tx, payload, existing, projectId, activityId });

    const data = suppliedCostFields({ payload, existing });
    let record;
    if (existing) {
      // A row found under the lock keeps the committed a commitment gave it
      // (Phase 21D, CX21-482) and every figure the caller did not mention.
      Object.assign(data, forecastFields({ payload, existing, data }));
      assertCostRecordMoney(data);
      record = await tx.costRecord.update({ where: { id: existing.id }, data });
    } else {
      const budget = data.budget ?? approvedBudget;
      const created = {
        committed: 0,
        ...data,
        budget,
        // Supplied → stored as given, 'entered'; missing → the initial
        // default max(0, budget, actual), 'default' (R5-2).
        ...forecastOnCreate({ payloadForecast: payload.forecast, budget, actual: 0 }),
      };
      assertCostRecordMoney(created);
      record = await tx.costRecord.create({
        data: {
          projectId,
          activityId,
          ...created,
        },
      });
    }

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.COST_RECORD,
      entityId: record.id,
      action: existing
        ? auditService.ACTIONS.UPDATED
        : auditService.ACTIONS.CREATED,
      actorId: userId,
      actorRole: userRole,
      oldSummary: existing ? costRecordSummary(existing) : null,
      newSummary: costRecordSummary(record),
      summary: {
        activityId,
        actual: toMoneyNumber(record.actual),
        committed: toMoneyNumber(record.committed),
        forecast: toMoneyNumber(record.forecast),
        forecastSource: record.forecastSource ?? null,
      },
      metadata: { source: 'cost_control' },
    });

    return withForecastBasis(record);
  });
};

const updateCostRecord = async ({
  orgId,
  projectId,
  costRecordId,
  payload: sent,
  userId = null,
  userRole = null,
}) => {
  const payload = suppliedPayload(sent);
  await ensureProject({ orgId, projectId });

  const found = await prisma.costRecord.findFirst({
    where: { id: costRecordId, projectId },
  });
  if (!found) {
    throw new HttpError(404, 'COST_RECORD_NOT_FOUND', 'Cost record not found');
  }

  return runInTransaction(async (tx) => {
    // The (project, activity) pair is held — the ledger, the commitments and
    // the upsert hold it too — and the row is read again under it: the edit
    // is decided on the row as it is now (Phase 21D, CX21-497).
    if (tx.$executeRaw) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cost-record:${projectId}:${found.activityId}`}))`;
    const existing = await tx.costRecord.findFirst({ where: { id: costRecordId, projectId } });
    if (!existing) {
      throw new HttpError(404, 'COST_RECORD_NOT_FOUND', 'Cost record not found');
    }
    assertActualIsTheLedgers({ payload, existing });
    await assertCommittedIsTheCommitments({ tx, payload, existing, projectId, activityId: existing.activityId });

    const data = suppliedCostFields({ payload, existing });
    Object.assign(data, forecastFields({ payload, existing, data }));
    assertCostRecordMoney(data);
    const record = await tx.costRecord.update({ where: { id: costRecordId }, data });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.COST_RECORD,
      entityId: costRecordId,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      actorRole: userRole,
      oldSummary: costRecordSummary(existing),
      newSummary: costRecordSummary(record),
      summary: {
        activityId: record.activityId,
        actual: toMoneyNumber(record.actual),
        committed: toMoneyNumber(record.committed),
        forecast: toMoneyNumber(record.forecast),
        forecastSource: record.forecastSource ?? null,
      },
      metadata: { source: 'cost_control' },
    });

    return withForecastBasis(record);
  });
};

const toProjectDurationDays = (project) => {
  if (project.duration && project.duration > 0) {
    if (project.durationUnit === 'days') return project.duration;
    if (project.durationUnit === 'weeks') return project.duration * 7;
    return project.duration * 30;
  }

  if (project.startDate && project.endDate) {
    const diff =
      (new Date(project.endDate).getTime() -
        new Date(project.startDate).getTime()) /
      (1000 * 60 * 60 * 24);
    return Math.max(1, Math.round(diff));
  }

  return 30;
};

const getBurnRate = async ({ orgId, projectId }) => {
  const project = await ensureProject({ orgId, projectId });

  const entries = await prisma.burnRateEntry.findMany({
    where: { projectId },
    orderBy: { date: 'asc' },
  });

  const byDate = new Map();
  for (const entry of entries) {
    const key = new Date(entry.date).toISOString().slice(0, 10);
    byDate.set(key, addMoney(byDate.get(key) || 0, entry.amount));
  }

  const durationDays = toProjectDurationDays(project);
  const budgetRate =
    durationDays > 0 ? divideMoney(project.contractValue, durationDays) : 0;

  const data = Array.from(byDate.entries()).map(([date, actual]) => ({
    date,
    actual,
    budget: budgetRate,
  }));

  return { budgetRate, data };
};

const addBurnRateEntry = async ({
  orgId,
  projectId,
  payload,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  return runInTransaction(async (tx) => {
    const entry = await tx.burnRateEntry.create({
      data: {
        projectId,
        date: payload.date ? new Date(payload.date) : new Date(),
        amount: toMoneyNumber(payload.amount),
        category: payload.category?.trim() || null,
        note: payload.note?.trim() || null,
      },
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.BURN_RATE_ENTRY,
      entityId: entry.id,
      action: auditService.ACTIONS.CREATED,
      actorId: userId,
      actorRole: userRole,
      newSummary: burnRateSummary(entry),
      summary: {
        amount: toMoneyNumber(entry.amount),
        category: entry.category || null,
      },
      metadata: { source: 'cost_control.burn_rate' },
    });

    return entry;
  });
};

module.exports = {
  getCostRecords,
  getCostSummary,
  upsertCostRecord,
  updateCostRecord,
  getBurnRate,
  addBurnRateEntry,
};
