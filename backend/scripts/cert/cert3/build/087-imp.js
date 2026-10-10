'use strict';

/**
 * CERT-3 deep population: 087-IMP "CERT3 Import parity" (plan §3.2, D1 company
 * 087; serves WP-1 import parity). A scratch project holding the schedule
 * files WP-1's conversion, parity and import checks read:
 *
 *   F3        A 80 h, SS + 16 h, then B 24 h (a start-to-start predecessor
 *             that drives the finish), exactly as files.F3() writes it: as P6
 *             exports it, the late pass capped at the project finish (A TF 0 h,
 *             LF 10; B TF 40 h; answers WP1.T3.file, builders' adjudication
 *             087-SCH/087-IMP item 5). Imported (the staged late dates, float
 *             and critical row asserted), reviewed, approved and ACTIVATED.
 *   F2        the rounding file: 40/80/12/20/4/3 h, lags +16/-16/+12/-12 h, and
 *             X150 with a total float of -80 h. Staged as XER, and as MSPDI,
 *             where the book's parity figures are asserted (WP1.parity.mspdi*;
 *             R1-11).
 *   F4        an XER with two PROJECT rows. HEAD stages it as one draft with
 *             both projects' 17 activities merged, which is asserted (R1-19);
 *             WP1.imports.twoProjectXer expects a refusal or a project choice
 *             (HR-S4, undecided), persisted as a finding with ref HR-S4.
 *   F5        F1 with Windows-1252 names. Staged (WP-1 imports.windows1252).
 *   F6        F1 with a second calendar id on A300 and A330. Staged (WP-1
 *             imports.secondCalendar).
 *   F1        also as P6 XML, MSPDI and an xlsx with a calendar column. Staged,
 *             each asserted identical to F1 (WP1.parity.p6xml / .xlsx).
 *   F1float5  last: F1 with every file float of at least 5 days, the HR-S3
 *             reproduction file (WP1.revisions.hrS3Reproduction.file: "staged
 *             as a draft in 087-IMP"; R1-12), its staged float and critical
 *             rows asserted. It stays the open draft for WP-1 to submit.
 *
 * Every file is generated from the answer book by build/files.js, so a file
 * cannot drift from the figures its proofs assert. Each import supersedes the
 * open draft before it (WP1.revisions.secondImport), so at the end F3 is the
 * active revision, F1float5 is the open draft, and the other staged files are
 * superseded with their staged snapshots kept for the proofs to read.
 *
 * Each staged file has a key of its own, proven distinct between this build's
 * files when the module loads:
 *   XER         the staged content (R1-10): what the product stages from the
 *               file (each task's code, calendar id and float), equal to the
 *               live snapshot at every staging. An interrupted import is
 *               adopted by it; a revision of the same source and size that the
 *               build did not record and that does not carry the file's
 *               content stops the build (resolve by hand).
 *   P6 XML, MSPDI, xlsx   the import's stored document (round 2, R2-C): the
 *               documentId the import answers (document.documentId), read back
 *               at the staging and on every resume through GET
 *               documents/:id/text as this file (its filename, a
 *               schedule_import document of the file's size). The revisions API
 *               names no source document and no route lists schedule-import
 *               documents, so an interrupted import of these formats cannot be
 *               tied to its revision: none of that source and size unrecorded
 *               means it did not take effect (sent again); any such revision
 *               stops the build for a check by hand (G4: no lookup, fail closed).
 * An import is never re-sent blind.
 *
 * Departures from the answer book that the build observes are persisted
 * findings (adjudication G2): F4 merged (HR-S4), A's float after F3's
 * activation (HR-S1), and the critical flag of an MSP task with negative slack
 * (HR-S3), each only when HEAD differs from the book's value. F3's figures
 * after the activation must be exactly the book's value or exactly its recorded
 * today (HR-S1); any other set fails the build (round 2, R2-F).
 *
 * Moment-bound checks (adjudication G1): the WP-1 T4 networks (FS lead, FF and
 * SF) and the zero-rated and all-out-of-scope baseline refusals run live in the
 * WP-1 proof on this scratch project, on records of their own (R1-13, R1-16).
 *
 * Run (debug, in process, through the proof lock), from backend/ with
 * DATABASE_URL unset:
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/build/087-imp.js
 */

const lib = require('./lib');

const { is, files } = lib;
const SCHEDULE = lib.answers.schedule;
const { WP1 } = SCHEDULE;
const R = SCHEDULE.rules;

const listOf = (data) => (Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []);

/** The one row `pred` picks (adjudication G6: by identity, never by position); a BuildError unless exactly one matches. */
const exactlyOne = (rows, pred, what) => {
  const hits = (rows || []).filter(pred);
  if (hits.length !== 1) throw new lib.BuildError(`${what}: ${hits.length} rows match, exactly one is expected`);
  return hits[0];
};

// ── the files, generated from the answer book (plan §3.3) ──────────────────
const F3 = files.F3(); // as P6 exports it; refuses to load if it differs from answers WP1.T3.file
const F2 = files.F2();
const F4 = files.F4();
const F5 = files.F5();
const F6 = files.F6();
const F1 = files.F1();
const F1F5 = files.F1float5();

/** WP1.revisions.hrS3Reproduction.file: the generator writes the book's float hours (it cannot drift). */
const HRS3_FILE = WP1.revisions.hrS3Reproduction.file.value;
for (const a of F1F5.activities) {
  if (a.tfHours !== HRS3_FILE.totalFloatHours[a.code]) throw new lib.BuildError(`files.F1float5: ${a.code} float ${a.tfHours} h, answers WP1.revisions.hrS3Reproduction.file says ${HRS3_FILE.totalFloatHours[a.code]} h`);
}
/** WP1.parity: the book's MSPDI figures are F2's rows in file order (X100..X150, four links). */
const PARITY = WP1.parity;
if (PARITY.mspdiDurations.value.length !== F2.activities.length || PARITY.mspdiLags.value.length !== F2.links.length) {
  throw new lib.BuildError('answers WP1.parity.mspdiDurations / mspdiLags no longer have one figure per F2 row and link');
}
// MSPDI carries numeric UIDs (a build choice): its rows are told apart by name, so the names must be unique.
for (const model of [F1, F2]) {
  if (new Set(model.activities.map((a) => a.name)).size !== model.activities.length) throw new lib.BuildError(`${model.name}: activity names repeat, so an MSPDI row cannot be found by name`);
}

/**
 * The staged-content key of an XER file (R1-10): what the product stages from
 * it, by the answer book's own rules: each task's code, calendar id and float
 * (total_float_hr_cnt with rules.hoursToDays, the parser's rounding and clamp),
 * in file order. Only XER is keyed by content; P6 XML, MSPDI and xlsx are
 * keyed by their stored document (documentKey, R2-C).
 */
const modelKey = (source, models) => {
  const acts = models.flatMap((m) => m.activities);
  const body = source === 'xer' ? acts.map((a) => `${a.code}:${a.calendarId}:${R.hoursToDays(a.tfHours)}`).join(',') : '';
  return `${source}|${acts.length}|${body}`;
};
/** The same key read from a staged revision. */
const revisionKey = (rev) => {
  const staged = [...(rev?.snapshotJson?.activities || [])].sort((x, y) => Number(x.sortOrder) - Number(y.sortOrder));
  const body = rev?.source === 'xer' ? staged.map((a) => `${a.p6ActivityId}:${a.calendarId}:${a.totalFloat}`).join(',') : '';
  return `${rev?.source}|${staged.length}|${body}`;
};
/** The key of a P6 XML, MSPDI or xlsx file (R2-C): its stored document, named by the file's name (b.file(name)). */
const documentKey = (source, name) => `${source}|document:${name}`;
/** A staged file's key: XER by content, the other formats by their stored document. */
const keyOf = (source, models, name) => (source === 'xer' ? modelKey(source, models) : documentKey(source, name));
/**
 * Every file this build stages, in order, with the name it is uploaded under
 * (b.file(name)): each key must be its own (else an interrupted import could
 * adopt another's revision).
 */
const STAGED = [
  ['import.F3', 'xer', [F3], 'F3.xer'],
  ['import.F2', 'xer', [F2], 'F2.xer'],
  ['import.F4', 'xer', F4, 'F4.xer'],
  ['import.F5', 'xer', [F5], 'F5.xer'],
  ['import.F6', 'xer', [F6], 'F6.xer'],
  ['import.F1.p6xml', 'p6xml', [F1], 'F1.xml'],
  ['import.F1.mspdi', 'msp', [F1], 'F1.mspdi.xml'],
  ['import.F1.xlsx', 'xlsx', [F1], 'F1.xlsx'],
  ['import.F2.mspdi', 'msp', [F2], 'F2.mspdi.xml'],
  ['import.F1float5', 'xer', [F1F5], 'F1float5.xer'],
];
{
  const seen = new Map();
  for (const [step, source, models, name] of STAGED) {
    const key = keyOf(source, models, name);
    if (seen.has(key)) throw new lib.BuildError(`${step} and ${seen.get(key)} stage the same key, so an interrupted import could not be told apart (R1-10, R2-C)`);
    seen.set(key, step);
  }
}

lib.main('087-IMP', async (b) => {
  // ── the project (plan §3.2 087-IMP: scratch; F1's start and calendar so the files' dates read the same) ──
  await b.project({
    title: 'Import parity',
    payload: {
      startDate: SCHEDULE.inputs.start,
      endDate: '2026-12-31',
      projectCalendar: 'five_day',
      currency: 'EGP',
      type: 'building',
      contractType: 'unit_rate',
      clientName: b.name('Client'),
    },
    fields: { projectCalendar: 'five_day', currency: 'EGP', startDate: is.day(SCHEDULE.inputs.start) },
  });
  // The planner imports and submits; the PM (the project's creator) approves and activates.
  await b.team({ planner: 'planning_eng' });

  const revisions = async (s) => listOf(await s.get('planner', `${b.P}/schedule/revisions`));
  const revision = (s, id) => s.get('planner', `${b.P}/schedule/revisions/${id}`);

  /**
   * R2-C: the stored document of a P6 XML, MSPDI or xlsx import, read back as
   * this file: the documentId the import answered (document.documentId), and
   * GET documents/:id/text naming it with the file's name (originalName), as a
   * schedule_import document of the file's size. Null when it holds, else what
   * differs (a non-200 read included).
   */
  const documentProblem = async (s, documentId, file) => {
    if (typeof documentId !== 'string' || !documentId) return `the import named no stored document (document.documentId ${JSON.stringify(documentId)})`;
    const route = `${b.P}/documents/${documentId}/text`;
    const res = await s.send('pm', 'GET', route);
    if (res.status !== 200) return `GET documents/${documentId}/text answered ${lib.said(res)}`;
    const doc = res.body?.data?.document || {};
    const problems = [];
    if (doc.documentId !== documentId) problems.push(`documentId ${JSON.stringify(doc.documentId)}`);
    if (doc.originalName !== file.filename) problems.push(`originalName ${JSON.stringify(doc.originalName)}, not ${JSON.stringify(file.filename)}`);
    if (doc.documentType !== 'schedule_import') problems.push(`documentType ${JSON.stringify(doc.documentType)}, not "schedule_import"`);
    if (Number(doc.sizeBytes) !== file.bytes) problems.push(`sizeBytes ${doc.sizeBytes}, not ${file.bytes}`);
    return problems.length ? `the stored document ${documentId} is not ${file.filename}: ${problems.join('; ')}` : null;
  };

  /**
   * An import the build sent and whose answer was never recorded (a killed run).
   * None of that source and size that the build did not record: it did not take
   * effect (sent again). XER: one that carries the file's staged content
   * (R1-10) is adopted, in the shape of the import's answer. P6 XML, MSPDI and
   * xlsx are keyed by their stored document (R2-C), which no revision names and
   * no route lists: any unrecorded revision of that source and size stops the
   * build for a check by hand (G4: no lookup, fail closed). Anything else: the
   * build stops (resolve by hand), never sends it blind.
   */
  const findStaged = (step, source, models, file) => async (s) => {
    const count = models.reduce((n, m) => n + m.activities.length, 0);
    const key = modelKey(source, models);
    const claimed = new Set(Object.entries(b.state.records).filter(([name, r]) => name !== step && r.id).map(([, r]) => r.id));
    const candidates = (await revisions(s)).filter((r) => r.source === source && Number(r.activityCount) === count && !claimed.has(r.id));
    if (!candidates.length) return null;
    if (source !== 'xer') {
      throw new lib.BuildError(`${step}: ${candidates.length} ${source} revision(s) of ${count} activities exist that this build did not record (${candidates.map((c) => c.id).join(', ')}). This import is keyed by its stored document (${file.filename}; R2-C), which the revisions API does not name, so whether it made one of them cannot be read; check by hand, then record it or remove records["${step}"] from ${b.stateFile}`);
    }
    const matching = [];
    for (const c of candidates) {
      const rev = await revision(s, c.id);
      if (revisionKey(rev) === key) matching.push(rev);
    }
    if (matching.length !== 1) {
      throw new lib.BuildError(`${step}: ${candidates.length} ${source} revision(s) of ${count} activities exist that this build did not record (${candidates.map((c) => c.id).join(', ')}), and ${matching.length} of them carry this file's staged content; resolve by hand, then remove records["${step}"] from ${b.stateFile}`);
    }
    const rev = matching[0];
    return { revisionId: rev.id, staged: true, imported: rev.activityCount, dependencyCount: (rev.snapshotJson?.dependencies || []).length };
  };

  /**
   * One file staged as a draft revision: 201, the revision id, the number of
   * activities and links the generated models carry; read back as a draft of
   * that source carrying the file's content; then `check(s, staged, deps, rev)`
   * asserts what makes it the plan's file and returns what it asserted.
   */
  const stage = ({ step, kind, source, models, file, check = null, later = ['draft', 'superseded'] }) => {
    // The file is the one STAGED lists for the step, so its key is the one proven distinct at load.
    const listed = STAGED.find(([name]) => name === step);
    b.assert(Boolean(listed) && listed[1] === source && file.filename === b.file(listed[3]), `${step}: STAGED lists it as ${listed ? `${listed[1]} ${b.file(listed[3])}` : 'nothing'}; it stages ${source} ${file.filename}`);
    return b.step(step, async (s) => {
      const count = models.reduce((n, m) => n + m.activities.length, 0);
      const links = models.reduce((n, m) => n + m.links.length, 0);
      const data = await s.upload(step, 'planner', `${b.P}/import/${kind}`, file, {
        expect: 201,
        idOf: (d) => d?.revisionId ?? null,
        get: (id) => `${b.P}/schedule/revisions/${id}`,
        fields: { staged: true, revisionId: is.present, imported: count, dependencyCount: links },
        find: findStaged(step, source, models, file),
      });
      // A rerun of this step after its upload was recorded gets the revision as read back (its id), not the
      // import's answer: the revision id and the stored document (the R2-C key) then come from the record.
      const rec = b.state.records[step];
      const revisionId = data.revisionId ?? rec?.id ?? null;
      const documentId = data.document?.documentId ?? rec?.data?.document?.documentId ?? null;
      const rev = await revision(s, revisionId);
      s.expectFields(rev, { status: 'draft', source, isActive: false, activityCount: count }, 'the staged revision');
      const staged = rev.snapshotJson?.activities || [];
      const deps = rev.snapshotJson?.dependencies || [];
      s.assert(staged.length === count, `the snapshot stages ${count} activities (it has ${staged.length})`);
      s.assert(deps.length === links, `the snapshot stages ${links} links (it has ${deps.length})`);
      if (source === 'xer') {
        // The adoption key is proven on every live staging (R1-10): the snapshot carries the file's content.
        s.assert(revisionKey(rev) === modelKey(source, models), `the staged snapshot carries the file's content key (${modelKey(source, models).slice(0, 160)}; got ${revisionKey(rev).slice(0, 160)})`);
      } else {
        // The key is the import's stored document (R2-C): its documentId, read back as this file.
        const problem = await documentProblem(s, documentId, file);
        s.assert(problem === null, `${step}: the import's stored document is ${file.filename} (${problem})`);
      }
      const asserted = check ? check(s, staged, deps, rev) : null;
      return { revisionId, source, activities: count, links, file: file.filename, sha256: file.sha256, documentId, key: source === 'xer' ? 'staged content' : `stored document ${documentId}`, ...(asserted ? { asserted } : {}) };
    }, {
      verify: async (s, out) => {
        const rev = await revision(s, out.revisionId);
        if (rev?.source !== out.source || Number(rev?.activityCount) !== out.activities) return `revision ${out.revisionId} is ${rev?.source} with ${rev?.activityCount} activities`;
        if (out.file !== file.filename) return `${step} recorded ${out.file}; the build stages ${file.filename}`;
        if (source === 'xer') {
          if (revisionKey(rev) !== modelKey(source, models)) return `revision ${out.revisionId} no longer carries ${out.file}'s staged content`;
        } else {
          const problem = await documentProblem(s, out.documentId, file);
          if (problem) return `${step}: ${problem}`;
        }
        return later.includes(rev.status) || `revision ${out.revisionId} is ${rev.status}, not one of ${later.join(', ')}`;
      },
    });
  };

  /** A staged row by its file code (XER, P6 XML, xlsx) or, for MSPDI's numeric UIDs, by its name. */
  const rowOf = (staged, a, by, what) => exactlyOne(staged, (x) => (by === 'name' ? x.name === a.name : x.p6ActivityId === a.code), `${what}: ${a.code}${by === 'name' ? ` ("${a.name}")` : ''} in the staged snapshot`);
  /** The staged link of a model link, between the two staged rows. */
  const linkOf = (deps, pred, succ, what) => exactlyOne(deps, (d) => d.predecessorRef === pred.draftKey && d.successorRef === succ.draftKey, `${what}: the staged link ${pred.p6ActivityId} -> ${succ.p6ActivityId}`);

  /** WP1.parity.p6xml / .xlsx ("identical"): the staged durations, links and lags are F1's. */
  const identicalToF1 = (by, what) => (s, staged, deps) => {
    const durations = {};
    for (const a of F1.activities) {
      const row = rowOf(staged, a, by, what);
      s.assert(Number(row.duration) === a.days, `${what}: ${a.code} stages ${a.days} working days, as F1 (got ${row.duration})`);
      durations[a.code] = Number(row.duration);
    }
    for (const l of F1.links) {
      const pred = rowOf(staged, F1.activities.find((a) => a.code === l.pred), by, what);
      const succ = rowOf(staged, F1.activities.find((a) => a.code === l.succ), by, what);
      const d = linkOf(deps, pred, succ, what);
      s.assert(d.relationshipType === l.type && Number(d.lagDays) === l.lagDays, `${what}: ${l.pred} -> ${l.succ} stages ${l.type} lag ${l.lagDays}, as F1 (got ${d.relationshipType} lag ${d.lagDays})`);
    }
    return { durations, links: F1.links.length, lagsAllZero: true };
  };

  // ── F3: a start-to-start predecessor that drives the finish, activated (plan §3.2; answers WP1.T3) ──
  const T3F = WP1.T3.file;
  const f3 = await stage({
    step: 'import.F3', kind: 'xer', source: 'xer', models: [F3], file: files.xer(F3, { filename: b.file('F3.xer') }), later: ['draft', 'under_review', 'approved'],
    check: (s, staged) => {
      // answers WP1.T3.file.stagedLate / stagedCriticalCount: the file's late dates and float as staged; one critical row (A)
      const late = {};
      for (const a of F3.activities) {
        const row = rowOf(staged, a, 'code', 'F3');
        const want = T3F.stagedLate.value[a.code];
        s.expectFields(row, { lateStart: is.number(want.lateStart), lateFinish: is.number(want.lateFinish), totalFloat: is.number(want.totalFloat) }, `F3 ${a.code} as staged (answers WP1.T3.file.stagedLate)`);
        late[a.code] = { lateStart: row.lateStart, lateFinish: row.lateFinish, totalFloat: row.totalFloat, isCritical: row.isCritical };
      }
      const critical = staged.filter((x) => x.isCritical === true).map((x) => x.p6ActivityId).sort();
      s.assert(critical.length === T3F.stagedCriticalCount.value, `F3 stages ${T3F.stagedCriticalCount.value} critical row(s) (answers WP1.T3.file.stagedCriticalCount; got ${critical.join(',') || 'none'})`);
      return { stagedLate: late, stagedCritical: critical };
    },
  });
  const R3 = `${b.P}/schedule/revisions/${f3.revisionId}`;
  const statusOf3 = async (s) => (await s.get('planner', R3))?.status;

  await b.step('submit.F3', async (s) => {
    // answers WP1.revisions.submitByPlanner: draft -> under_review
    await s.act('submit.F3', 'planner', 'POST', `${R3}/submit-review`, { comment: b.name('F3 for review') }, {
      fields: { id: f3.revisionId, status: WP1.revisions.submitByPlanner.value },
      verify: async (s2) => ['under_review', 'approved'].includes(await statusOf3(s2)),
    });
    return { status: 'under_review' };
  }, { needs: ['import.F3'] });

  await b.step('approve.F3', async (s) => {
    // F3 has no milestone; its staged float (A 0 h, WP1.T3.file) marks the critical row the approval needs.
    await s.act('approve.F3', 'pm', 'POST', `${R3}/approve`, { comment: b.name('F3 approved') }, {
      fields: { id: f3.revisionId, status: 'approved' },
      verify: async (s2) => (await statusOf3(s2)) === 'approved',
    });
    return { status: 'approved' };
  }, { needs: ['submit.F3'] });

  await b.step('activate.F3', async (s) => {
    if (!(await s.get('pm', R3))?.isActive) {
      // Before the activation (a rerun after it took effect skips this read; the act's verify adopts it).
      const mapping = await s.get('pm', `${R3}/mapping`);
      s.expectFields(mapping, { 'counts.existing': 0, 'counts.staged': F3.activities.length }, 'the activation mapping (a fresh project: nothing to map)');
    }
    // No active schedule yet: the mapping list is empty (routes/schedule.js ACTIVATION_MAPPINGS_REQUIRED).
    await s.act('activate.F3', 'pm', 'POST', `${R3}/activate`, { mappings: [], unmappedRemovals: [], comment: b.name('F3 activated') }, {
      fields: {
        'revision.id': f3.revisionId,
        'revision.isActive': true,
        'activation.newActivities': is.count(F3.activities.length),
        'activation.updatedActivities': is.count(0),
        'activation.retiredActivities': is.count(0),
        'activation.dependencyCount': F3.links.length,
      },
      verify: async (s2) => Boolean((await s2.get('pm', R3))?.isActive),
    });
    // The CPM pass ran inside the activation (WP-1 "Activation. CPM runs inside the activation
    // transaction"). Asserted: the F3 figures that are the same today and under HR-S1's cap
    // (answers WP1.T3.A.ES/EF, WP1.T3.B.*). The activated rows are new, so they are found by the
    // file code the activation wrote (p6ActivityId), exactly one each.
    const acts = listOf(await s.get('pm', `${b.P}/activities`)).filter((a) => a.isActive !== false);
    s.assert(acts.length === F3.activities.length, `${F3.activities.length} active activities after F3's activation (found ${acts.length})`);
    const T3 = WP1.T3;
    const firm = {
      A: { earlyStart: T3.A.ES.value, earlyFinish: T3.A.EF.value },
      B: { earlyStart: T3.B.ES.value, earlyFinish: T3.B.EF.value, lateStart: T3.B.LS.value, lateFinish: T3.B.LF.value, totalFloat: T3.B.TF.value },
    };
    const ids = {};
    const read = {};
    for (const [code, want] of Object.entries(firm)) {
      const a = exactlyOne(acts, (x) => x.p6ActivityId === code, `F3 activity ${code} after the activation`);
      s.expectFields(a, Object.fromEntries(Object.entries(want).map(([k, v]) => [k, is.number(v)])), `F3 ${code} after activation (answers WP1.T3.${code})`);
      ids[code] = a.id;
      read[code] = { ES: a.earlyStart, EF: a.earlyFinish, LS: a.lateStart, LF: a.lateFinish, TF: a.totalFloat };
    }
    // A's late figures and the critical count are the HR-S1 observation of the product's CPM (adjudication
    // item 5): answers WP1.T3.A.LS/LF/TF and WP1.T3.criticalCount carry the capped values (value) and
    // HEAD's uncapped ones (today). Round 2, R2-F: the four figures must be exactly the value set or
    // exactly the today set; the HR-S1 finding is made only on the today match; anything else fails.
    const A = read.A;
    const critical = acts.filter((x) => Number(x.totalFloat) <= 0).map((x) => x.p6ActivityId).sort();
    const want = { LS: T3.A.LS.value, LF: T3.A.LF.value, TF: T3.A.TF.value, criticalCount: T3.criticalCount.value };
    const today = { LS: T3.A.LS.today, LF: T3.A.LF.today, TF: T3.A.TF.today, criticalCount: T3.criticalCount.today };
    const got = { LS: Number(A.LS), LF: Number(A.LF), TF: Number(A.TF), criticalCount: critical.length };
    const matches = (set) => Object.keys(got).every((k) => set[k] !== undefined && set[k] === got[k]);
    const verdict = matches(want) ? 'value' : matches(today) ? 'today' : 'wrong';
    s.assert(verdict !== 'wrong', `F3 activated: the product's CPM gives A LS ${got.LS}, LF ${got.LF}, TF ${got.TF} and ${got.criticalCount} critical (${critical.join(',') || 'none'}); answers WP1.T3.A.LS/LF/TF and WP1.T3.criticalCount give neither that value (${want.LS}/${want.LF}/${want.TF}, ${want.criticalCount}) nor the recorded today (${today.LS}/${today.LF}/${today.TF}, ${today.criticalCount}; HR-S1)`);
    if (verdict === 'today') {
      s.finding('HR-S1', `F3 activated in 087-IMP: the product's CPM gives A LS ${got.LS}, LF ${got.LF}, TF ${got.TF} and ${got.criticalCount} critical activit${got.criticalCount === 1 ? 'y' : 'ies'} (${critical.join(',') || 'none'}), exactly the book's today; answers WP1.T3.A.LS/LF/TF and WP1.T3.criticalCount expect ${want.LS}/${want.LF}/${want.TF} and ${want.criticalCount} under HR-S1's recommendation (LF capped at the project finish, undecided).`);
    }
    return { revisionId: f3.revisionId, activities: ids, figures: read, critical, hrS1: { verdict, observed: got, value: want, today } };
  }, {
    needs: ['approve.F3'],
    verify: async (s, out) => {
      const rev = await s.get('pm', R3);
      if (!rev?.isActive) return `F3's revision ${out.revisionId} is no longer active`;
      const acts = listOf(await s.get('pm', `${b.P}/activities`));
      for (const [code, id] of Object.entries(out.activities)) if (!acts.some((a) => a.id === id && a.isActive !== false)) return `F3 activity ${code} (${id}) is no longer active`;
      return true;
    },
  });

  // ── F2: rounding, lag and negative-float rows (answers WP1.conversion.*; inputs.F2) ──
  await stage({
    step: 'import.F2', kind: 'xer', source: 'xer', models: [F2], file: files.xer(F2, { filename: b.file('F2.xer') }),
    check: (s, staged, deps) => {
      s.note(`F2 staged durations ${F2.activities.map((a) => `${a.code}=${rowOf(staged, a, 'code', 'F2').duration}`).join(' ')}; lags ${deps.map((d) => d.lagDays).join(' ')}; X150 float ${rowOf(staged, F2.activities.find((a) => a.code === 'X150'), 'code', 'F2').totalFloat} (WP1.conversion judges them)`);
      return null;
    },
  });

  // ── F4: an XER with two projects (answers WP1.imports.twoProjectXer; HR-S4 undecided; R1-19) ──
  // HEAD merges the two projects into one draft; that is asserted (status draft, 17 activities) and
  // the book's expectation (refused, or the user asked which project) is persisted as a finding.
  await stage({
    step: 'import.F4', kind: 'xer', source: 'xer', models: F4, file: files.xer(F4, { filename: b.file('F4.xer') }),
    check: (s, staged) => {
      const fromEach = {};
      for (const m of F4) {
        for (const a of m.activities) rowOf(staged, a, 'code', `F4 project ${m.projectId}`);
        fromEach[m.projectId] = m.activities.length;
      }
      const total = F4.reduce((n, m) => n + m.activities.length, 0);
      s.finding('HR-S4', `F4, an XER with two PROJECT rows (${F4.map((m) => `${m.projectId} ${m.activities.length}`).join(', ')}), answered 201 and was staged as one draft revision with both projects' ${total} TASK rows merged (status draft, activityCount ${total}). answers WP1.imports.twoProjectXer expects ${JSON.stringify(WP1.imports.twoProjectXer.value)} (refused, or the user asked which project: HR-S4 recommendation, undecided); the book's today: ${WP1.imports.twoProjectXer.today}.`);
      return { merged: fromEach, activities: total };
    },
  });

  // ── F5: F1 with Windows-1252 names (answers WP1.imports.windows1252; HR-S4) ──
  await stage({
    step: 'import.F5', kind: 'xer', source: 'xer', models: [F5], file: files.xer(F5, { filename: b.file('F5.xer'), encoding: 'win1252' }),
    check: (s, staged) => {
      s.note(`F5 staged names: ${Object.keys(files.F5_NAMES).map((c) => `${c}=${JSON.stringify(rowOf(staged, F5.activities.find((a) => a.code === c), 'code', 'F5').name)}`).join(', ')} (written in Windows-1252: ${Object.values(files.F5_NAMES).map((n) => JSON.stringify(n)).join(', ')}; WP1.imports.windows1252 judges them, HR-S4)`);
      return null;
    },
  });

  // ── F6: F1 with a second calendar id on A300 and A330 (answers WP1.imports.secondCalendar; HR-S4) ──
  await stage({
    step: 'import.F6', kind: 'xer', source: 'xer', models: [F6], file: files.xer(F6, { filename: b.file('F6.xer') }),
    check: (s, staged) => {
      s.note(`F6 staged calendars: ${['A100', 'A300', 'A330'].map((c) => `${c}=${rowOf(staged, F6.activities.find((a) => a.code === c), 'code', 'F6').calendarId}`).join(', ')} (the file names clndr_id 2 on A300 and A330; WP1.imports.secondCalendar judges it)`);
      return null;
    },
  });

  // ── the F1 programme as P6 XML, MSPDI and xlsx with a calendar column (answers WP1.parity.p6xml / .xlsx) ──
  await stage({ step: 'import.F1.p6xml', kind: 'p6xml', source: 'p6xml', models: [F1], file: files.p6xml(F1, { filename: b.file('F1.xml') }), check: identicalToF1('code', 'F1 as P6 XML (answers WP1.parity.p6xml)') });
  await stage({ step: 'import.F1.mspdi', kind: 'msp', source: 'msp', models: [F1], file: files.mspdi(F1, { filename: b.file('F1.mspdi.xml') }), check: identicalToF1('name', 'F1 as MSPDI') });
  await stage({ step: 'import.F1.xlsx', kind: 'xlsx', source: 'xlsx', models: [F1], file: files.scheduleXlsx(F1, { filename: b.file('F1.xlsx'), calendar: 'five_day' }), check: identicalToF1('code', 'F1 as xlsx with a calendar column (answers WP1.parity.xlsx)') });

  // ── F2 as MSPDI: the parity figures (answers WP1.parity.mspdiDurations, mspdiLags, mspNegativeSlack*; R1-11) ──
  await stage({
    step: 'import.F2.mspdi', kind: 'msp', source: 'msp', models: [F2], file: files.mspdi(F2, { filename: b.file('F2.mspdi.xml') }),
    check: (s, staged, deps) => {
      const durations = {};
      F2.activities.forEach((a, i) => {
        const row = rowOf(staged, a, 'name', 'F2 as MSPDI');
        s.assert(Number(row.duration) === PARITY.mspdiDurations.value[i], `F2 as MSPDI: ${a.code} (${a.hours} h) stages ${PARITY.mspdiDurations.value[i]} working days (answers WP1.parity.mspdiDurations; got ${row.duration})`);
        durations[a.code] = Number(row.duration);
      });
      const lags = [];
      F2.links.forEach((l, i) => {
        const pred = rowOf(staged, F2.activities.find((a) => a.code === l.pred), 'name', 'F2 as MSPDI');
        const succ = rowOf(staged, F2.activities.find((a) => a.code === l.succ), 'name', 'F2 as MSPDI');
        const d = linkOf(deps, pred, succ, 'F2 as MSPDI');
        s.assert(Number(d.lagDays) === PARITY.mspdiLags.value[i], `F2 as MSPDI: ${l.pred} -> ${l.succ} (${l.lagHours} h) stages lag ${PARITY.mspdiLags.value[i]} (answers WP1.parity.mspdiLags; got ${d.lagDays})`);
        lags.push(Number(d.lagDays));
      });
      const x150 = rowOf(staged, F2.activities.find((a) => a.code === 'X150'), 'name', 'F2 as MSPDI');
      s.assert(Number(x150.totalFloat) === PARITY.mspNegativeSlackDays.value, `F2 as MSPDI: X150 (TotalSlack -80 h) stages ${PARITY.mspNegativeSlackDays.value} days of float (answers WP1.parity.mspNegativeSlackDays; got ${x150.totalFloat})`);
      if (x150.isCritical !== PARITY.mspNegativeSlackCritical.value) {
        s.finding('HR-S3', `F2 as MSPDI in 087-IMP: X150 stages total float ${x150.totalFloat} days with isCritical ${x150.isCritical}; answers WP1.parity.mspNegativeSlackCritical expects ${PARITY.mspNegativeSlackCritical.value} (an MSP task with negative slack must be critical: HR-S3 recommendation, undecided); the book's today: ${PARITY.mspNegativeSlackCritical.today}.`);
      }
      return { durations, lags, X150: { totalFloat: Number(x150.totalFloat), isCritical: x150.isCritical } };
    },
  });

  // ── last: F1float5, the HR-S3 reproduction file, left as the open draft (answers WP1.revisions.hrS3Reproduction.file; R1-12) ──
  await stage({
    step: 'import.F1float5', kind: 'xer', source: 'xer', models: [F1F5], file: files.xer(F1F5, { filename: b.file('F1float5.xer') }),
    check: (s, staged) => {
      const floats = {};
      for (const a of F1F5.activities) {
        const row = rowOf(staged, a, 'code', 'F1float5');
        const days = R.hoursToDays(HRS3_FILE.totalFloatHours[a.code]);
        s.assert(Number(row.totalFloat) === days, `F1float5: ${a.code} stages ${days} days of float (${HRS3_FILE.totalFloatHours[a.code]} h, answers WP1.revisions.hrS3Reproduction.file; got ${row.totalFloat})`);
        floats[a.code] = Number(row.totalFloat);
      }
      // "Staged isCritical = round(file TF days) === 0": every file float is 5 days or more, so no row.
      const want = Object.values(HRS3_FILE.totalFloatHours).filter((h) => R.hoursToDays(h) === 0).length;
      const critical = staged.filter((x) => x.isCritical === true).map((x) => x.p6ActivityId).sort();
      s.assert(critical.length === want, `F1float5 stages ${want} critical rows (answers WP1.revisions.hrS3Reproduction.file; got ${critical.join(',') || 'none'})`);
      return { floats, stagedCritical: critical };
    },
  });

  // ── where the imports stand: F3 active, F1float5 the open draft, the rest superseded (answers WP1.revisions.secondImport) ──
  await b.step('revisions.read', async (s) => {
    const all = await revisions(s);
    const steps = STAGED.map(([step]) => step);
    const want = { 'import.F3': 'approved', 'import.F1float5': 'draft' };
    const states = {};
    for (const step of steps) {
      const id = b.out(step).revisionId;
      const r = exactlyOne(all, (x) => x.id === id, `${step}'s revision ${id} in the list`);
      // each later import superseded the open draft before it (WP1.revisions.secondImport.openDraft)
      const expected = want[step] || WP1.revisions.secondImport.openDraft.value;
      s.assert(r.status === expected, `${step}'s revision is ${expected} (it is ${r.status})`);
      states[step] = r.status;
    }
    // the active revision is untouched by the imports (WP1.revisions.secondImport.activeRevision)
    const active = all.filter((r) => r.isActive);
    s.assert(active.length === 1 && active.every((r) => r.id === b.out('import.F3').revisionId), `F3 is the one active revision (active: ${active.map((r) => r.id).join(', ')})`);
    return { states, revisions: all.length };
  }, { needs: ['activate.F3', 'import.F1float5'] });
});
