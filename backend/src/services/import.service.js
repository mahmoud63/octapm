const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  parseXer,
  extractActivities: extractXerActivities,
  extractRelationships: extractXerRelationships,
} = require('../parsers/xer-parser');
const {
  parseP6Xml,
  hoursToDays: p6HoursToDays,
} = require('../parsers/p6xml-parser');
const {
  parseMspXml,
  parseDurationDays,
  parseLagDays,
  tenthsOfMinutesToDays,
} = require('../parsers/msp-parser');
const { parseScheduleXlsx } = require('../parsers/schedule-xlsx-parser');
const { applyCpmToProject, dateToWorkingDay } = require('./cpm.service');

// How many staged activities and dependencies a dry-run report carries back;
// the counts are complete, the rows are a sample to review.
const DRY_RUN_ROW_LIMIT = 50;
const { runPostImportSeeding } = require('./post-import.service');
const progressService = require('./progress.service');

const REVISION_STATUS = Object.freeze({
  DRAFT: 'draft',
  UNDER_REVIEW: 'under_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  BASELINED: 'baselined',
  SUPERSEDED: 'superseded',
});

const OPEN_REVISION_STATUSES = [
  REVISION_STATUS.DRAFT,
  REVISION_STATUS.UNDER_REVIEW,
  REVISION_STATUS.APPROVED,
];

const normalizeRevisionStatus = (status) =>
  Object.values(REVISION_STATUS).includes(status)
    ? status
    : REVISION_STATUS.DRAFT;

const statusTransitionLog = (revision) =>
  Array.isArray(revision?.statusTransitionLog)
    ? revision.statusTransitionLog
    : [];

const appendStatusTransition = (revision, { to, userId, at, comment }) => [
  ...statusTransitionLog(revision),
  {
    from: normalizeRevisionStatus(revision?.status),
    to,
    by: userId || null,
    at: at.toISOString(),
    comment,
    reason: null,
  },
];

async function supersedeOpenScheduleRevisions(tx, { projectId, userId = null }) {
  const revisions = await tx.scheduleRevision.findMany({
    where: {
      projectId,
      isActive: false,
      status: { in: OPEN_REVISION_STATUSES },
    },
  });

  const at = new Date();
  for (const revision of revisions) {
    await tx.scheduleRevision.update({
      where: { id: revision.id },
      data: {
        status: REVISION_STATUS.SUPERSEDED,
        supersededBy: userId,
        supersededAt: at,
        statusTransitionLog: appendStatusTransition(revision, {
          to: REVISION_STATUS.SUPERSEDED,
          userId,
          at,
          comment: 'Superseded by an imported schedule revision',
        }),
      },
    });
  }
}

async function ensureProject(orgId, projectId) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
}

function parseMaybeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function dayOffset(dateValue, projectStartDate, calendarOptions = {}) {
  const date = parseMaybeDate(dateValue);
  if (!date || !projectStartDate) return null;

  const workingDayOffset = dateToWorkingDay(
    projectStartDate,
    date,
    calendarOptions,
  );
  if (workingDayOffset !== null) return workingDayOffset;

  const diffMs = date.getTime() - projectStartDate.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function normalizePct(value) {
  const pct = Number(value);
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

const trimOrNull = (value) => {
  const text = String(value || '').trim();
  return text || null;
};

function stagedActivityKey(item, index) {
  return (
    trimOrNull(
      item.sourceActivityId ||
        item.sourceTaskId ||
        item.uid ||
        item.p6ActivityId ||
        item.wbsCode,
    ) || `import-${index + 1}`
  );
}

function isoOrNull(value) {
  const date = parseMaybeDate(value);
  return date ? date.toISOString() : null;
}

function buildImportSnapshot({ project, activities, relationships, wbsNodes, source, calendars }) {
  const projectStart = project.startDate ? new Date(project.startDate) : null;
  const refToDraftKey = new Map();
  const seen = new Set();

  const stagedActivities = activities.map((item, index) => {
    let draftKey = stagedActivityKey(item, index);
    if (seen.has(draftKey)) draftKey = `${draftKey}#${index + 1}`;
    seen.add(draftKey);

    const refs = [
      item.sourceTaskId,
      item.sourceActivityId,
      item.uid,
      item.p6ActivityId,
      item.wbsCode,
      draftKey,
    ];
    for (const ref of refs) {
      const key = trimOrNull(ref);
      if (key && !refToDraftKey.has(key)) refToDraftKey.set(key, draftKey);
    }

    const duration = Math.max(
      0,
      Number(item.originalDuration ?? item.duration ?? 0) || 0,
    );
    const calendarId =
      trimOrNull(item.calendarId) || project.projectCalendar || null;
    const calendarOptions = {
      calendarId,
      projectCalendar: project.projectCalendar,
    };

    return {
      draftKey,
      sourceActivityId: trimOrNull(item.sourceActivityId || item.sourceTaskId),
      uid: trimOrNull(item.uid),
      p6ActivityId: trimOrNull(item.p6ActivityId),
      name: item.name || 'Imported Activity',
      wbsCode: trimOrNull(item.wbsCode),
      calendarId,
      duration,
      originalDuration:
        item.originalDuration != null ? Number(item.originalDuration) : null,
      remainingDuration:
        item.remainingDuration != null ? Number(item.remainingDuration) : null,
      physComplete: normalizePct(item.physComplete),
      earlyStart: dayOffset(item.earlyStartDate, projectStart, calendarOptions),
      earlyFinish: dayOffset(
        item.earlyFinishDate,
        projectStart,
        calendarOptions,
      ),
      lateStart: dayOffset(item.lateStartDate, projectStart, calendarOptions),
      lateFinish: dayOffset(item.lateFinishDate, projectStart, calendarOptions),
      totalFloat:
        item.totalFloat != null ? Math.round(Number(item.totalFloat) || 0) : null,
      isCritical: Math.round(Number(item.totalFloat) || 0) === 0,
      startDate: isoOrNull(item.earlyStartDate),
      endDate: isoOrNull(item.earlyFinishDate),
      sortOrder: index,
    };
  });

  const dependencies = [];
  for (const rel of relationships) {
    const succRef = trimOrNull(rel.succTaskId || rel.succId || rel.succUid);
    const predRef = trimOrNull(rel.predTaskId || rel.predId || rel.predUid);
    const successorRef = succRef ? refToDraftKey.get(succRef) : null;
    const predecessorRef = predRef ? refToDraftKey.get(predRef) : null;

    if (!successorRef || !predecessorRef || successorRef === predecessorRef) {
      continue;
    }

    dependencies.push({
      predecessorRef,
      successorRef,
      relationshipType: rel.relType || rel.type || 'FS',
      lagDays: Math.round(Number(rel.lagDays) || 0),
      source: 'import',
      importSource: source,
      externalPredecessorRef: predRef,
      externalSuccessorRef: succRef,
      importMetadata: {
        source,
        rawRelationship: rel,
      },
    });
  }

  return {
    source,
    importedAt: new Date().toISOString(),
    activityCount: stagedActivities.length,
    wbs: wbsNodes,
    calendars,
    activities: stagedActivities,
    dependencies,
  };
}

async function persistImport({
  project,
  activities,
  relationships,
  wbsNodes,
  source,
  calendars = [],
  userId = null,
}) {
  const snapshot = buildImportSnapshot({
    project,
    activities,
    relationships,
    wbsNodes,
    source,
    calendars,
  });
  let revisionId = null;

  await prisma.$transaction(async (tx) => {
    await supersedeOpenScheduleRevisions(tx, {
      projectId: project.id,
      userId,
    });

    const createdAt = new Date();
    const revision = await tx.scheduleRevision.create({
      data: {
        projectId: project.id,
        label: `${source.toUpperCase()} Import`,
        activityCount: activities.length,
        criticalCount: activities.filter((item) => (item.totalFloat || 0) === 0)
          .length,
        totalBudget: 0,
        source,
        isActive: false,
        status: REVISION_STATUS.DRAFT,
        snapshotJson: snapshot,
        statusTransitionLog: [
          {
            from: null,
            to: REVISION_STATUS.DRAFT,
            by: userId,
            at: createdAt.toISOString(),
            comment: 'Staged imported schedule revision created',
            reason: null,
          },
        ],
      },
    });
    revisionId = revision.id;
  });

  return {
    staged: true,
    revisionId,
    imported: activities.length,
    wbsNodes: wbsNodes.length,
    criticalActivities: activities.filter((item) => (item.totalFloat || 0) === 0)
      .length,
    dependencyCount: snapshot.dependencies.length,
    message:
      'Schedule import staged as a draft revision. Activate after mapping review and approval.',
  };
}

async function importXer({
  projectId,
  orgId,
  xerContent,
  replaceExisting = false,
  userId = null,
}) {
  const project = await ensureProject(orgId, projectId);

  const tables = parseXer(xerContent);
  const parsed = extractXerActivities(tables);
  const relationships = extractXerRelationships(tables);

  if (!parsed.activities.length) {
    throw new HttpError(400, 'PARSE_ERROR', 'No activities found in XER file');
  }

  return persistImport({
    project,
    replaceExisting,
    activities: parsed.activities,
    relationships,
    wbsNodes: parsed.wbsNodes,
    calendars: parsed.calendars,
    source: 'xer',
    userId,
  });
}

async function importP6Xml({
  projectId,
  orgId,
  xmlContent,
  replaceExisting = false,
  userId = null,
}) {
  const project = await ensureProject(orgId, projectId);
  const parsed = await parseP6Xml(xmlContent);

  const wbsCodeMap = new Map(
    parsed.wbsNodes.map((wbs) => [
      String(wbs.objectId || ''),
      wbs.code || null,
    ]),
  );

  const activities = parsed.activities.map((activity) => ({
    sourceActivityId: activity.sourceActivityId,
    p6ActivityId: activity.p6ActivityId,
    name: activity.name,
    wbsCode:
      wbsCodeMap.get(String(activity.wbsId || '')) || activity.wbsId || null,
    calendarId: activity.calendarId || null,
    originalDuration: p6HoursToDays(activity.plannedDurationHours),
    remainingDuration: p6HoursToDays(activity.remainingDurationHours),
    physComplete: normalizePct(activity.physComplete),
    earlyStartDate: activity.earlyStart,
    earlyFinishDate: activity.earlyFinish,
    lateStartDate: activity.lateStart,
    lateFinishDate: activity.lateFinish,
    totalFloat: p6HoursToDays(activity.totalFloatHours),
  }));

  if (!activities.length) {
    throw new HttpError(400, 'PARSE_ERROR', 'No activities found in P6 XML');
  }

  const relationships = parsed.relationships.map((rel) => ({
    succId: rel.succId,
    predId: rel.predId,
    relType: rel.type,
    lagDays: rel.lagDays,
  }));

  return persistImport({
    project,
    replaceExisting,
    activities,
    relationships,
    wbsNodes: parsed.wbsNodes,
    source: 'p6xml',
    userId,
  });
}

/**
 * The WBS an MSPDI file carries, in the snapshot node shape the XER and xlsx
 * parsers use (`wbsId`, `parentWbsId`, `code`, `name`, `seqNum`). Project
 * writes a unique outline number on every task, summary or not, so the
 * nodes are the summary tasks and every prefix above them: a work task is
 * the activity, not a node of its own, and only the outline above it ("1.2"
 * for task "1.2.3") is taken. A summary task gives its node a proper name.
 */
function mspWbsNodes(tasks) {
  const nodes = new Map();
  for (const task of tasks || []) {
    // UID 0 is the project summary row Project writes above the outline.
    if (task.uid === '0') continue;
    const outline = String(task.wbsCode || '')
      .split('.')
      .map((part) => part.trim())
      .filter(Boolean);
    const parts = task.isSummary ? outline : outline.slice(0, -1);
    let parent = null;
    let code = '';
    for (const part of parts) {
      code = code ? `${code}.${part}` : part;
      if (!nodes.has(code)) {
        nodes.set(code, {
          wbsId: code,
          parentWbsId: parent,
          name: code,
          code,
          seqNum: nodes.size + 1,
        });
      }
      parent = code;
    }
    if (task.isSummary && code && nodes.has(code) && String(task.name || '').trim()) {
      nodes.get(code).name = String(task.name).trim();
    }
  }
  return [...nodes.values()];
}

async function importMsp({
  projectId,
  orgId,
  xmlContent,
  replaceExisting = false,
  userId = null,
}) {
  const project = await ensureProject(orgId, projectId);
  const parsed = await parseMspXml(xmlContent);

  const workTasks = parsed.tasks.filter(
    (task) =>
      !task.isSummary && task.uid !== '0' && String(task.name || '').trim(),
  );

  if (!workTasks.length) {
    throw new HttpError(400, 'PARSE_ERROR', 'No work tasks found in MSP XML');
  }

  const activities = workTasks.map((task) => {
    const duration = parseDurationDays(task.durationIso);
    // MSPDI TotalSlack is in tenths of a minute (4800 per 8-hour day).
    const totalFloat = tenthsOfMinutesToDays(task.totalSlackMinutes);

    return {
      uid: task.uid,
      sourceTaskId: task.uid,
      p6ActivityId: task.uid,
      name: task.name,
      wbsCode: task.wbsCode,
      calendarId: null,
      originalDuration: duration,
      remainingDuration: duration,
      physComplete: normalizePct(task.percentComplete),
      earlyStartDate: task.start,
      earlyFinishDate: task.finish,
      lateStartDate: null,
      lateFinishDate: null,
      totalFloat,
    };
  });

  const relationships = [];
  for (const task of workTasks) {
    for (const pred of task.predecessors || []) {
      relationships.push({
        succUid: task.uid,
        predUid: pred.predUid,
        relType: pred.type,
        lagDays: parseLagDays(pred.lagDurationIso),
      });
    }
  }

  return persistImport({
    project,
    replaceExisting,
    activities,
    relationships,
    wbsNodes: mspWbsNodes(parsed.tasks),
    source: 'msp',
    userId,
  });
}

/**
 * Excel schedule import (PC-2). The workbook parser produces the same
 * activities / relationships / WBS shape as the XER and MSPDI parsers, so
 * the staged revision is built and persisted by the same code and activates
 * through the same mapping review. With `dryRun` the staged snapshot is built
 * and reported but nothing is written.
 */
async function importScheduleXlsx({
  projectId,
  orgId,
  input,
  dryRun = false,
  userId = null,
}) {
  const project = await ensureProject(orgId, projectId);
  const parsed = parseScheduleXlsx(input);

  if (!parsed.activities.length) {
    throw new HttpError(400, 'PARSE_ERROR', 'No activities found in schedule workbook');
  }

  const staged = {
    project,
    activities: parsed.activities,
    relationships: parsed.relationships,
    wbsNodes: parsed.wbsNodes,
    calendars: parsed.calendars,
    source: 'xlsx',
    userId,
  };

  if (dryRun) {
    const snapshot = buildImportSnapshot(staged);
    return {
      dryRun: true,
      staged: false,
      source: 'xlsx',
      activityCount: snapshot.activities.length,
      dependencyCount: snapshot.dependencies.length,
      wbsNodeCount: parsed.wbsNodes.length,
      criticalActivities: snapshot.activities.filter((item) => item.isCritical).length,
      issueCount: parsed.issues.length,
      issues: parsed.issues.slice(0, 200),
      activities: snapshot.activities.slice(0, DRY_RUN_ROW_LIMIT),
      dependencies: snapshot.dependencies.slice(0, DRY_RUN_ROW_LIMIT),
      rowLimit: DRY_RUN_ROW_LIMIT,
      message: 'Dry run: nothing was written. Import without dryRun to stage this schedule as a draft revision.',
    };
  }

  const result = await persistImport(staged);
  return { ...result, issues: parsed.issues, issueCount: parsed.issues.length };
}

// How many per-row outcomes a progress import answers with; the counts are
// complete, the rows are what a reviewer reads first.
const PROGRESS_IMPORT_ROW_LIMIT = 500;

/**
 * The percentages a progress file carries, keyed by P6 activity id — null
 * for an activity the file names without stating a percentage (the parsers'
 * `physCompleteStated`); a schedule reads such a row as 0, a progress import
 * skips it.
 */
async function parseProgressFile({ format, content }) {
  const normalized = String(format || '').toLowerCase();
  let activities;
  if (normalized === 'xer') {
    activities = extractXerActivities(parseXer(content)).activities;
  } else if (normalized === 'p6xml') {
    activities = (await parseP6Xml(content)).activities;
  } else {
    throw new HttpError(400, 'INVALID_FORMAT', 'format must be xer or p6xml');
  }
  return new Map(
    activities
      .filter((a) => a.p6ActivityId)
      .map((a) => [
        String(a.p6ActivityId),
        a.physCompleteStated === false ? null : normalizePct(a.physComplete),
      ]),
  );
}

// A structured refusal (an HttpError, or anything shaped like one) is a
// row's outcome; anything else is a fault and fails the request.
const refusalOf = (error) =>
  error && error.code && error.status
    ? { code: error.code, message: error.message }
    : null;

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * POST /projects/:id/import/progress — the percentages in a P6 file become
 * progress the way progress is made everywhere else in the product: a
 * ProgressSubmission per activity, official only when the approval writer
 * (progress.service approveProgressSubmissionWithClient: evidence gate, ITP
 * hold points, audit, ActivityProgress row) says so.
 *
 * Authority is the importer's own (PC-6, owner decision). `canApprove` is the
 * permission engine's answer to progress `submission.approve` on this
 * project for this person — the same answer the approve route gets. Without
 * it every matched row is a 'submitted' submission and nothing is official.
 * With it each row is submitted and then approved through the writer; a row
 * a gate refuses stays pending with the gate's reason and never fails the
 * file. Nothing here writes ActivityProgress and no approved row is ever
 * rewritten — a later approval is a new row, exactly as the writer does.
 *
 * The file's figure is a percentage, so the submission names the `percent`
 * method as a manual percentage entry would; on an activity measured another
 * way the writer records the method the submission names (it does not
 * refuse), and the row is flagged `methodMismatch` for the reviewer.
 *
 * Only a figure that moves something is written. A row whose figure is
 * already the activity's current official figure — the latest approved
 * ActivityProgress percentage, and 0 for an activity with no approved
 * progress at all — is 'unchanged' and creates nothing, so a full-programme
 * export does not put one 0% row per unstarted activity in the approval
 * queue. A row the file names without stating a percentage is 'skipped',
 * with its reason, never a submission.
 *
 * A figure that already waits in an open import submission: for a
 * submit-only person, or when the open row is a draft (it waits for
 * evidence, not for approval), the row is 'already_pending' — no second
 * submission; `waitingStatus` says where it waits. For a person with
 * approval authority and a 'submitted' import row at the same figure, the
 * import approves THAT submission through the writer and its gates — it is
 * the same figure under this person's own authority — so the row answers
 * with the pending submission's id and `approvesPending: true` (a gate that
 * refuses leaves it pending with the reason, as for any other row). When the
 * figure differs, a new submission is made and approved as for any other
 * row. Either way, every OTHER older submitted import row on the activity
 * at another figure — there may be several — is left exactly as the writer
 * leaves a superseded manual submission — untouched, still in the queue —
 * and each is reported on the row (`superseded`, newest first) and in
 * `supersededPendingSubmissions` (one entry per submission; the count is of
 * submissions, not rows) so the approver can reject them from the queue.
 * Nothing here rejects or deletes a submission. Any other figure is written
 * again — the writer keeps no idempotency key of its own.
 *
 * `dryRun` answers the per-row plan for this person without writing, and the
 * plan is read from the writer's own rules, not assumed: the assignment
 * assertion the writer runs (assertProgressSubmitAllowed), the activity's
 * evidence requirement, and — for an approver — the ITP hold points the
 * approval gate checks (form.service.openHoldPoints). A row those rules would
 * refuse is previewed as 'refuse'; one a gate would hold (kept as a draft for
 * a submit-only person, left pending for an approver) as 'hold'. The import
 * itself still trusts the writer for every row; the preview only stops
 * promising rows the writer will not write.
 */
async function importProgress({
  projectId,
  orgId,
  format,
  content,
  userId = null,
  userRole = null,
  canApprove = false,
  dryRun = false,
}) {
  await ensureProject(orgId, projectId);
  const progressMap = await parseProgressFile({ format, content });

  const dbActivities = await prisma.activity.findMany({
    where: { projectId, isActive: true, p6ActivityId: { not: null } },
    select: {
      id: true,
      name: true,
      p6ActivityId: true,
      progressMethod: { select: { method: true, evidenceRequired: true } },
      progress: {
        where: { status: 'approved' },
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { id: true, pctComplete: true, source: true },
      },
      progressSubmissions: {
        where: { status: { in: ['draft', 'submitted'] }, source: 'import' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, pctComplete: true, status: true, evidenceJson: true },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  const matchedKeys = new Set();
  const plan = [];
  for (const activity of dbActivities) {
    const key = String(activity.p6ActivityId || '');
    if (!progressMap.has(key)) continue;
    matchedKeys.add(key);
    const stated = progressMap.get(key);
    const pctComplete = stated === null ? null : normalizePct(stated);
    const activityMethod = progressService.normalizeMethod(
      activity.progressMethod?.method || 'percent',
    );
    const official = activity.progress[0] || null;
    // The current official figure: an activity with no approved progress
    // stands at 0%, so a 0% row for an unstarted activity changes nothing.
    const officialPct = official ? normalizePct(official.pctComplete) : 0;
    const waiting = activity.progressSubmissions.find(
      (row) => normalizePct(row.pctComplete) === pctComplete,
    );
    // Every older submitted import row at another figure, newest first — all
    // of them, since a queue can hold more than one (a site engineer's 30
    // then 32): each is left there, and each is reported by a row that is
    // written. A draft is not in the queue and is not one of them.
    const olderPending = activity.progressSubmissions
      .filter((row) => row.status === 'submitted' && normalizePct(row.pctComplete) !== pctComplete)
      .map((row) => ({ submissionId: row.id, pctComplete: normalizePct(row.pctComplete) }));
    const row = {
      activityId: activity.id,
      p6ActivityId: key,
      name: activity.name,
      pctComplete,
      officialPctComplete: official ? officialPct : null,
      activityMethod,
      methodMismatch: activityMethod !== 'percent',
      submissionId: null,
      progressId: null,
      waitingStatus: null,
      approvesPending: false,
      superseded: [],
      reason: null,
    };
    if (pctComplete === null) {
      row.status = 'skipped';
      row.reason = {
        code: 'PROGRESS_PERCENT_MISSING',
        message: 'The file names this activity without a percentage; nothing written',
      };
    } else if (officialPct === pctComplete) {
      row.status = 'unchanged';
      row.reason = {
        code: 'PROGRESS_ALREADY_OFFICIAL',
        message: official
          ? `Already the official figure (${pctComplete}%); nothing written`
          : `No approved progress yet, so the activity already stands at ${pctComplete}%; nothing written`,
      };
    } else if (waiting && canApprove && waiting.status === 'submitted') {
      // The same figure, already in the queue, under this person's own
      // authority: approve that submission rather than make a second one.
      row.status = 'approve';
      row.submissionId = waiting.id;
      row.waitingStatus = waiting.status;
      row.approvesPending = true;
      row.evidenceRequired =
        Boolean(activity.progressMethod?.evidenceRequired) &&
        !progressService.hasEvidence(waiting.evidenceJson);
      // The other older rows at other figures are left in the queue just
      // the same, and this person — the one the report exists for — is told.
      row.superseded = olderPending;
    } else if (waiting) {
      // A draft is not in any approver's queue: it waits for evidence, and
      // the reason says so rather than calling it "awaiting approval".
      row.status = 'already_pending';
      row.submissionId = waiting.id;
      row.waitingStatus = waiting.status;
      row.reason = {
        code: 'PROGRESS_ALREADY_PENDING',
        message:
          waiting.status === 'draft'
            ? `An import submission at ${pctComplete}% is already kept as a draft awaiting evidence; no second submission`
            : `An import submission at ${pctComplete}% is already awaiting approval; no second submission`,
      };
    } else {
      row.status = canApprove ? 'approve' : 'submit';
      row.evidenceRequired = Boolean(activity.progressMethod?.evidenceRequired);
      // Left in the queue, as the writer leaves a superseded manual
      // submission; the approver is told so they can reject them.
      row.superseded = olderPending;
    }
    plan.push(row);
  }

  // The preview: what the writer's own rules say about each row this person
  // would write. Assignment first (the writer's assertion, run once for every
  // row; its refusal names the activities it would refuse), then the evidence
  // requirement, then — for an approver — the hold points the approval gate
  // reads. Stored beside the row; the import loop never consults it. A row
  // that approves an already-pending submission makes no submission of its
  // own, so the assignment rule (a submitter's) is not asked about it.
  const toWrite = plan.filter((row) => row.status === 'approve' || row.status === 'submit');
  const toSubmit = toWrite.filter((row) => !row.approvesPending);
  let unassigned = new Set();
  let assignmentRefusal = null;
  try {
    await progressService.assertProgressSubmitAllowed({
      projectId,
      activityIds: toSubmit.map((row) => row.activityId),
      userId,
      userRole,
    });
  } catch (error) {
    if (error?.code !== 'ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED') throw error;
    unassigned = new Set(error.details?.activityIds || toSubmit.map((row) => row.activityId));
    assignmentRefusal = refusalOf(error);
  }
  // Required lazily, as progress.service does, to keep clear of a service cycle.
  const { openHoldPoints } = require('./form.service');
  for (const row of toWrite) {
    if (unassigned.has(row.activityId)) {
      row.expected = { status: 'refuse', reason: assignmentRefusal };
      continue;
    }
    if (row.evidenceRequired) {
      row.expected = {
        status: 'hold',
        reason: {
          code: 'PROGRESS_EVIDENCE_REQUIRED',
          message: canApprove
            ? 'This activity requires evidence before progress can be approved; the row would be left pending'
            : 'This activity requires evidence before progress can be submitted; the row would be kept as a draft',
        },
      };
      continue;
    }
    if (canApprove) {
      const holdPoints = await openHoldPoints({ projectId, activityId: row.activityId });
      if (holdPoints.length) {
        const first = holdPoints[0];
        row.expected = {
          status: 'hold',
          reason: {
            code: 'ITP_HOLD_POINT_OPEN',
            message: `${holdPoints.length} ITP hold point${holdPoints.length === 1 ? '' : 's'} on this activity ${holdPoints.length === 1 ? 'has' : 'have'} not passed (${first.ref}: ${first.label} — ${first.state}); the row would be left pending`,
          },
        };
        continue;
      }
    }
    row.expected = { status: row.status, reason: null };
  }

  const notMatched = Math.max(0, progressMap.size - matchedKeys.size);
  const authority = {
    canApprove: Boolean(canApprove),
    basis: 'progress submission.approve on this project',
    outcome: canApprove ? 'approved' : 'submitted',
  };
  // An older pending import row at another figure is superseded only by a
  // row that was (or would be) written — including one that approves an
  // already-pending submission; a refused or skipped row leaves it as the
  // only figure in the queue, and it is not reported.
  const WRITTEN = new Set(['approve', 'submit', 'hold', 'approved', 'pending', 'submitted', 'draft']);
  const settleSuperseded = (rows) => {
    for (const row of rows) {
      if (row.superseded.length && !WRITTEN.has(row.status)) row.superseded = [];
    }
    return rows;
  };
  const summarize = (rows) => {
    const count = (status) => rows.filter((row) => row.status === status).length;
    // One entry per submission left in the queue, not per row: an activity
    // may leave several behind.
    const superseded = rows.flatMap((row) => row.superseded.map((older) => ({ row, older })));
    return {
      matched: rows.length,
      notMatched,
      submitted: count('submitted'),
      draft: count('draft'),
      approved: count('approved'),
      pending: count('pending'),
      unchanged: count('unchanged'),
      alreadyPending: count('already_pending'),
      skipped: count('skipped'),
      refused: count('refused'),
      supersededPending: superseded.length,
      supersededPendingSubmissions: superseded.map(({ row, older }) => ({
        activityId: row.activityId,
        p6ActivityId: row.p6ActivityId,
        name: row.name,
        submissionId: older.submissionId,
        pctComplete: older.pctComplete,
        importedPctComplete: row.pctComplete,
      })),
    };
  };
  const supersededClause = (counts) =>
    counts.supersededPending
      ? ` ${plural(counts.supersededPending, 'older pending import submission')} at another figure left in the approval queue (superseded pending) — reject ${counts.supersededPending === 1 ? 'it' : 'them'} there.`
      : '';

  // Of the rows approved (or to be approved), how many are already-pending
  // submissions at the same figure taken into this person's authority.
  const approvesPendingClause = (rows, { preview = false } = {}) => {
    const count = rows.filter((row) => row.approvesPending).length;
    if (!count) return '';
    const stood = preview
      ? `to be approved as ${count === 1 ? 'it stands' : 'they stand'}`
      : `approved as ${count === 1 ? 'it stood' : 'they stood'}`;
    return ` (${count} of them already pending at the same figure, ${stood})`;
  };

  // What a row answers with: never the plan's working fields.
  const answerRow = ({ expected, evidenceRequired, ...row }) => row;

  if (dryRun) {
    const previewed = settleSuperseded(
      plan.map((row) =>
        row.expected ? answerRow({ ...row, status: row.expected.status, reason: row.expected.reason }) : answerRow(row),
      ),
    );
    const counts = summarize(previewed);
    const count = (status) => previewed.filter((row) => row.status === status).length;
    const would = {
      wouldSubmit: count('submit'),
      wouldApprove: count('approve'),
      wouldHold: count('hold'),
      wouldRefuse: count('refuse'),
    };
    const held = previewed.filter((row) => row.status === 'hold');
    const holdReasons = [...new Set(held.map((row) => row.reason.code))]
      .map((code) => (code === 'PROGRESS_EVIDENCE_REQUIRED' ? 'evidence required' : code === 'ITP_HOLD_POINT_OPEN' ? 'ITP hold point open' : code))
      .join(', ');
    return {
      dryRun: true,
      authority,
      ...counts,
      ...would,
      rows: previewed.slice(0, PROGRESS_IMPORT_ROW_LIMIT),
      rowLimit: PROGRESS_IMPORT_ROW_LIMIT,
      // The legacy field: how many official figures this call would change.
      updated: 0,
      message:
        (canApprove
          ? `Dry run: nothing was written. For you ${plural(would.wouldApprove, 'row')} would be submitted and approved through the progress approval gates${approvesPendingClause(previewed.filter((row) => row.status === 'approve'), { preview: true })}; ${would.wouldHold} would be left pending${held.length ? ` (${holdReasons})` : ''}, ${would.wouldRefuse} would be refused, ${counts.unchanged} already official, ${counts.alreadyPending} already pending, ${counts.skipped} skipped (no percentage), ${notMatched} not matched.`
          : `Dry run: nothing was written. For you ${plural(would.wouldSubmit, 'row')} would be submitted for approval — not official until an approver approves them; ${would.wouldHold} would be kept as draft (evidence required), ${would.wouldRefuse} would be refused, ${counts.unchanged} already official, ${counts.alreadyPending} already pending, ${counts.skipped} skipped (no percentage), ${notMatched} not matched.`) +
        supersededClause(counts),
    };
  }

  const notes = `Imported from progress file (${String(format).toLowerCase()})`;
  for (const row of plan) {
    if (row.status !== 'approve' && row.status !== 'submit') continue;
    const submit = (status) =>
      progressService.createProgressSubmission({
        orgId,
        projectId,
        activityId: row.activityId,
        userId,
        userRole,
        payload: { pctComplete: row.pctComplete, method: 'percent', source: 'import', status, notes },
      });
    let submissionId = null;
    if (row.approvesPending) {
      // The same figure already waits in the queue: no second submission —
      // that one is approved, under this person's authority, below.
      submissionId = row.submissionId;
      row.status = row.waitingStatus;
    } else {
      let submission;
      try {
        submission = await submit('submitted');
      } catch (error) {
        // The writer's own allowance: a row without the evidence the activity
        // demands may still be kept as a draft, for someone to attach it to.
        if (error?.code !== 'PROGRESS_EVIDENCE_REQUIRED') {
          const reason = refusalOf(error);
          if (!reason) throw error;
          row.status = 'refused';
          row.reason = reason;
          continue;
        }
        try {
          submission = await submit('draft');
        } catch (draftError) {
          const reason = refusalOf(draftError);
          if (!reason) throw draftError;
          row.status = 'refused';
          row.reason = reason;
          continue;
        }
        row.reason = refusalOf(error);
      }
      submissionId = submission.id;
      row.submissionId = submission.id;
      row.status = submission.status;
    }
    if (!canApprove) continue;

    try {
      const approved = await progressService.approveProgressSubmission({
        orgId,
        projectId,
        activityId: row.activityId,
        submissionId,
        userId,
      });
      row.status = 'approved';
      row.reason = null;
      const progress = await prisma.activityProgress.findUnique({
        where: { submissionId: approved.id },
        select: { id: true },
      });
      row.progressId = progress?.id || null;
    } catch (error) {
      const reason = refusalOf(error);
      if (!reason) throw error;
      row.status = 'pending';
      row.reason = reason;
    }
  }

  const counts = summarize(settleSuperseded(plan));
  const message =
    (canApprove
      ? `${plural(counts.approved, 'row')} approved through the progress approval gates${approvesPendingClause(plan.filter((row) => row.status === 'approved'))}, ${counts.pending} left pending (a gate refused), ${counts.refused} refused, ${counts.unchanged} already official, ${counts.alreadyPending} already pending, ${counts.skipped} skipped (no percentage), ${notMatched} not matched.`
      : `${plural(counts.submitted, 'row')} submitted for approval — not official until approved; ${counts.draft} kept as draft (evidence required), ${counts.refused} refused, ${counts.unchanged} already official, ${counts.alreadyPending} already pending, ${counts.skipped} skipped (no percentage), ${notMatched} not matched.`) +
    supersededClause(counts);

  return {
    dryRun: false,
    authority,
    ...counts,
    rows: plan.slice(0, PROGRESS_IMPORT_ROW_LIMIT).map(answerRow),
    rowLimit: PROGRESS_IMPORT_ROW_LIMIT,
    // The legacy field: how many official figures this call changed.
    updated: counts.approved,
    message,
  };
}

async function recalculateProjectCpm({ projectId, orgId }) {
  await ensureProject(orgId, projectId);
  return applyCpmToProject(projectId);
}

async function seedLinkedModules({ projectId, orgId }) {
  await ensureProject(orgId, projectId);
  return runPostImportSeeding(projectId);
}

module.exports = {
  importXer,
  importP6Xml,
  importMsp,
  importScheduleXlsx,
  importProgress,
  recalculateProjectCpm,
  seedLinkedModules,
};
