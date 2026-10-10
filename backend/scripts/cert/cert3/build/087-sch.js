'use strict';

/**
 * CERT-3 deep population: 087-SCH "CERT3 Programme" (plan §3.2, D1 company 087;
 * serves WP-1 and WP-2). Starts Monday 2026-01-05 on a five-day calendar.
 *
 * Programme (answers inputs.F1, WP1):
 *   the stage-2 network built by hand first (14 activities A100..M900, the
 *   site engineer on every one but A330), so F1 is activated OVER it with all
 *   14 mapped by code (answers WP1.revisions.activate.record): F1 in hours
 *   (three WBS branches, M900 with equal early start and finish,
 *   phys_complete_pct 40 on A200) imported, reviewed, approved (HR-S2 is fixed
 *   at f599e67: the approval answers 200, and any other answer fails the build)
 *   and activated with the mapping GET .../mapping suggests (A100 onto the
 *   hand-built A100 by activity code, WP1.revisions.mapByCode.matchType;
 *   R1-9), every mapped activity keeping its id and its code (R1-8). F1b
 *   (A110 160 h, A140 left out) activated over it with A140 retired, then
 *   rolled back to F1. The rollback re-creates A140 as a new activity: its id
 *   is recorded as a finding (WP1-RB-1) and the site engineer is assigned to it
 *   again (R1-6).
 * Moments the build passes through, asserted there (adjudication G1):
 *   400 BOQ_REQUIRED_FOR_BASELINE while F1 is active and no bill is uploaded;
 *   409 REVISION_NOT_ACTIVATED while F1b is approved and not yet activated
 *   (the bill is uploaded before F1b so that the BOQ gates pass; R1-16);
 *   WP-1 T2 (A110 = 20: M900 EF 91, floats unchanged, A140 TF 47, A300 TF 20,
 *   12 critical; restored: M900 EF 81) before the baseline and the tail (R1-5);
 *   the unallocated refusal naming BOQ allocations before S-006 is covered; and
 *   A310's quantity sequence (below; R1-3, R1-4).
 * BOQ (answers inputs.boq087SCH): S-001..S-008 in m2/m3 (six priced in-scope
 *   rows, S-007 optional, S-008 not applicable); five activities allocated
 *   (A110 60,000; A120 30,000 and A130 90,000 from S-002; A310 135,000 = 900 m2;
 *   A320 72,000 over S-004 and S-005), S-006 (72,000) unallocated until the
 *   baseline step allocates it to A220 (the integration owner's reading,
 *   adjudication S-006, plan §0 item 5): the baseline is first refused for it,
 *   then locked.
 * Progress (answers inputs.methods087SCH): A110 percent; A120 percent with
 *   evidence required; A310 quantity (one item); A320 quantity (two items);
 *   A210 weighted milestones 20/30/50; A230 inspection (weights and the
 *   inspection flag read back, R1-17); A300 and A330 not configured. A form ITP
 *   template with one hold item and a scheduled instance on A130 (WP-2 T4
 *   starts from it). An uploaded site photo (the stored project document WP-2
 *   T3 uses as evidence, HR-X1). A310's quantities (answers WP2.quantitiesA310,
 *   builders' adjudication 087-SCH item 1): before any entry the bare-percent
 *   refusal; typed 450 (one entry minted, EV(A310) 67,500.00), a 90 m2 entry
 *   bundled (EV(A310) 81,000.00), its clientRequestId replayed, a daily log with
 *   a 30 m2 quantities row bundled (EV(A310) 85,500.00), a 10 m2 entry
 *   rejected, and a draft and a submitted entry left pending, so the entries
 *   stand in every state. WP-2's checks that need the setup EV of 0 run on
 *   fresh records in the WP-2 proof (MOMENT-MAP). A310's BOQ item S-003 then
 *   carries an executed commitment SOV line (900 m2), a stock receipt (1,000),
 *   an issue (600) and a return (50), and an IPC item (500 m2) half paid, so all
 *   six quantity figures are non-zero (answers WP2.quantityView).
 * Progress file (answers inputs.progressFile, WP2.importProgress): the
 *   generated progress XER, kept with the build state (its bytes and sha256)
 *   and dry-run against the activated programme as the site engineer.
 * Last: the tail activity T900 ending in 2027 (answers WP1.tail), added only
 *   after the CPM and baseline checks; then §3.2's assignment rule read live:
 *   the site engineer on every active activity except A330.
 *
 * Build choices the plan leaves open (accepted, builders' adjudication 087-SCH
 * items 3 and 4): contract value 459,000.00; explicit defaultRetentionRate 10
 * (HR-C1 configuration); end 2027-06-30; subcontract 130/m2; stock unit cost
 * 20; IPC period = the run month; payment 0.5 of net; daily log on run date -4;
 * A330 held by the planner; the hand-built activities and T900 keep the answer
 * book's names (activities are traced by project and code).
 *
 * Run (debug, in process, through the proof lock), from backend/ with
 * DATABASE_URL unset:
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/build/087-sch.js
 */

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const { is, files } = lib;
const SCHEDULE = lib.answers.schedule;
const IN = SCHEDULE.inputs;
const { WP1, WP2 } = SCHEDULE;
const R = SCHEDULE.rules;

const CODES = IN.F1.tasks.map((t) => t[0]);
const TASKS = Object.fromEntries(IN.F1.tasks.map(([code, name, wbs, hours, pred, pct], index) => [code, { code, name, wbs, hours, pred, pct, index, days: R.hoursToDays(hours) }]));
const METHODS = IN.methods087SCH;
const BOQ = files.boqRows.sch087();
const ROW = Object.fromEntries(BOQ.map((r) => [r.code, r]));
const TAIL = IN.tail087SCH;
const cents = (v) => lib.toCents(v);

/** The in-scope priced bill, S-001..S-006 (answers WP1.baseline.unallocated.inScopePriced): the contract value. */
const CONTRACT_VALUE = WP1.baseline.unallocated.inScopePriced.value / 100;
/**
 * Retention configured explicitly on the project (HR-C1, decided: no silent
 * fallback). 10% as 087-COM, 052-COM and 006-LITE (answers commercial
 * 006-LITE.ipcAfterConfiguration.retentionRate). The paid quantity is a share
 * of the net payable, so the rate does not move WP2.quantityView.paid.
 */
const RETENTION = 10;
/** The paid share of the certificate (answers WP2.quantityView.paid: amountPaid / netPayable = 0.5). */
const PAID_SHARE = WP2.quantityView.paid.value / WP2.quantityView.certified.value;
/** The activity the rollback re-creates (WP1-RB-1): the one row identified by its file code after the rollback. */
const REBUILT = 'A140';

const listOf = (data) => {
  if (Array.isArray(data)) return data;
  for (const key of ['items', 'entries', 'activities', 'allocations', 'submissions', 'files']) if (Array.isArray(data?.[key])) return data[key];
  return [];
};
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
/** The one row `pred` picks (adjudication G6: by identity, never by position); a BuildError unless exactly one matches. */
const exactlyOne = (rows, pred, what) => {
  const hits = (rows || []).filter(pred);
  if (hits.length !== 1) throw new lib.BuildError(`${what}: ${hits.length} rows match, exactly one is expected`);
  return hits[0];
};
/** For an adoption: the one row `pred` picks, null when none; a BuildError when several (resolve by hand). */
const atMostOne = (rows, pred, what) => {
  const hits = (rows || []).filter(pred);
  if (hits.length > 1) throw new lib.BuildError(`${what}: ${hits.length} rows match; at most one is expected (resolve by hand)`);
  return hits[0] || null;
};
/**
 * The one active activity of `code` (G6). Mapped and hand-built activities keep
 * their activityCode (asserted at activate.F1, R1-8: no fallback for them). The
 * one exception is A140 after the rollback: the product re-creates it from F1's
 * stored row, which states no activityCode, so it is found by the file code the
 * activation wrote (p6ActivityId); WP1-RB-1 records it.
 */
const activityOf = (rows, code, what) => exactlyOne(rows, (a) => a.activityCode === code || (code === REBUILT && !a.activityCode && a.p6ActivityId === code), `${what}: active activity ${code}`);
/** A row's code for messages and lists (never for selection). */
const labelOf = (a) => a?.activityCode || (a?.p6ActivityId ? `${a.p6ActivityId}(file code)` : a?.id);
const assignedIds = (a) => (a?.assignedEngineers || []).map((e) => (typeof e === 'string' ? e : e.userId || e.id || e.user?.id));
/** §3.2: the site engineer on every activity but A330 (answers inputs.methods087SCH.siteEngineerAssigned; T900 is outside F1, so the rule's "every activity"). */
const siteHolds = (code) => METHODS.siteEngineerAssigned.includes(code) || !CODES.includes(code);

/** A tiny valid PDF: the countersigned subcontract the execution takes (commitment.service executeCommitment). */
const signedPdf = (title) => Buffer.from(
  `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n4 0 obj<</Title(${title})>>endobj\ntrailer<</Root 1 0 R/Info 4 0 R>>\n%%EOF\n`,
  'latin1',
);
/** A 1 x 1 PNG (the site photo; scripts/cert/drivers/progress.js PNG_1X1). */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/**
 * The staged-content key of a schedule file (R1-10): what the product stages
 * from it, by the answer book's own rules (XER: each task's code, calendar id
 * and float, total_float_hr_cnt through rules.hoursToDays), in file order. The
 * revisions API names no source document, so this is how an interrupted
 * import is told apart from another revision.
 */
const modelKey = (model) => `xer|${model.activities.length}|${model.activities.map((a) => `${a.code}:${a.calendarId}:${R.hoursToDays(a.tfHours)}`).join(',')}`;
const revisionKey = (rev) => {
  const staged = [...(rev?.snapshotJson?.activities || [])].sort((x, y) => Number(x.sortOrder) - Number(y.sortOrder));
  return `${rev?.source}|${staged.length}|${rev?.source === 'xer' ? staged.map((a) => `${a.p6ActivityId}:${a.calendarId}:${a.totalFloat}`).join(',') : ''}`;
};
const F1MODEL = files.F1();
const F1BMODEL = files.F1b();
if (modelKey(F1MODEL) === modelKey(F1BMODEL)) throw new lib.BuildError('F1 and F1b stage the same content key, so an interrupted import could not be told apart (R1-10)');

lib.main('087-SCH', async (b) => {
  const P = () => b.P;

  // ── the project (plan §3.2: starts Monday 2026-01-05, five-day calendar) ──
  await b.project({
    title: 'Programme',
    payload: {
      startDate: IN.start,
      endDate: '2027-06-30', // after the tail's finish (answers WP1.tail.earlyFinishDate 2027-02-02)
      projectCalendar: 'five_day',
      currency: 'EGP',
      type: 'building',
      contractType: 'unit_rate',
      clientName: b.name('Client'),
      contractValue: CONTRACT_VALUE,
      defaultRetentionRate: RETENTION,
    },
    fields: { projectCalendar: 'five_day', currency: 'EGP', startDate: is.day(IN.start) },
  });
  await b.step('project.terms', async (s) => {
    // The commercial terms the IPC certifies under: the contract value (the certify gate,
    // CONTRACT_VALUE_NOT_ESTABLISHED) and the explicit retention (HR-C1).
    const p = await s.get('pm', P());
    s.expectFields(p, { contractValue: is.cents(CONTRACT_VALUE), defaultRetentionRate: is.number(RETENTION) }, 'the project terms');
    return { contractValue: CONTRACT_VALUE, defaultRetentionRate: RETENTION };
  }, { needs: ['project'] });

  // The planner plans; the site engineer submits progress and records quantities; the QS
  // approves progress, keeps the bill and the IPC; the quality engineer keeps the ITP; the
  // warehouse keeper moves stock; finance invoices and records payment. The PM (the
  // project's creator) approves revisions, activates, baselines and executes.
  await b.team({ planner: 'planning_eng', site: 'site_engineer', qs: 'qs', quality: null, warehouse: 'warehouse', finance: 'finance' });

  // ── reads ────────────────────────────────────────────────────────────────
  const activities = async (s, persona = 'planner') => listOf(await s.get(persona, `${P()}/activities`)).filter((a) => a.isActive !== false);
  const revisions = async (s) => listOf(await s.get('planner', `${P()}/schedule/revisions`));
  const revision = (s, id) => s.get('planner', `${P()}/schedule/revisions/${id}`);
  /** The CPM figures of `codes` against answers WP1.T1 (ES/EF/LS/LF/TF) on the rows read. */
  const assertT1 = (s, rows, label, codes = CODES) => {
    for (const code of codes) {
      const a = activityOf(rows, code, label);
      const want = WP1.T1[code];
      s.expectFields(a, {
        earlyStart: is.number(want.ES.value), earlyFinish: is.number(want.EF.value),
        lateStart: is.number(want.LS.value), lateFinish: is.number(want.LF.value), totalFloat: is.number(want.TF.value),
      }, `${label}: ${code} (answers WP1.T1.${code})`);
    }
    const critical = rows.filter((a) => num(a.totalFloat) !== null && num(a.totalFloat) <= 0).map(labelOf).sort();
    s.assert(critical.length === WP1.T1.criticalCount.value, `${label}: ${WP1.T1.criticalCount.value} critical activities (answers WP1.T1.criticalCount; got ${critical.join(',')})`);
    return critical;
  };
  /** A revision that was baselined: what a baseline refusal would have made had it been wrongly accepted. */
  const baselinedFind = (revisionId) => async (s2) => {
    const rev = await revision(s2, revisionId);
    return rev?.status === 'baselined' ? rev : null;
  };
  /**
   * A refusal at its moment, with its message and details asserted by `check`
   * (R1-16). It is recorded (s.refused), so a later run never sends it blind;
   * `find` tells whether an interrupted one was wrongly accepted (a re-probe of a
   * refusal is idempotent, R1-18). A rerun of the same step after the refusal
   * was recorded (its answer is not kept) asks again: a refusal makes nothing,
   * and nothing has moved since, because the next step has not run.
   */
  const probe = async (s, name, persona, method, route, payload, expected, { find, check = null }) => {
    const first = await s.refused(name, persona, method, route, payload, expected, { find });
    let res = first.res;
    if (!res) {
      res = await s.send(persona, method, route, payload);
      s.assert(lib.said(res) === expected, `${name}: asked again on a rerun of this step (the refusal was recorded, its answer was not kept), it answers ${lib.said(res)}, not ${expected}`);
    }
    const error = res.body?.error || {};
    return { said: lib.said(res), message: error.message || null, ...(check ? check(error) || {} : {}) };
  };

  // ── 1. the hand-built programme: the stage-2 network (answers inputs.F1, WP1.T1) ──
  // Activity codes and names are the answer book's (A100 must map onto A100 by code, plan WP-1);
  // they carry no build code (named: false) — the project does (adjudication 087-SCH item 4).
  // The site engineer is on every activity but A330, which the planner holds
  // (answers inputs.methods087SCH.siteEngineerAssigned).
  const hand = await b.step('programme.hand', async (s) => {
    const site = await b.userId('site');
    const planner = await b.userId('planner');
    const ids = {};
    for (const code of CODES) {
      const t = TASKS[code];
      const engineer = siteHolds(code) ? site : planner;
      const data = await s.create(`activity.${code}`, 'planner', `${P()}/activities`, {
        name: t.name,
        activityCode: code,
        wbsCode: IN.wbs[t.wbs],
        duration: t.days,
        isMilestone: t.hours === 0,
        sortOrder: t.index,
        engineerIds: [engineer],
        ...(t.pred ? { dependencies: [{ predecessorId: ids[t.pred], relationshipType: 'FS', lagDays: 0 }] } : {}),
      }, {
        named: false,
        fields: { activityCode: code, name: t.name, duration: is.number(t.days), isMilestone: t.hours === 0 },
        get: (id) => `${P()}/activities/${id}`,
        find: async (s2) => atMostOne(await activities(s2), (a) => a.activityCode === code, `hand-built ${code}`),
      });
      ids[code] = data.id;
    }
    const rows = await activities(s);
    s.assert(rows.length === CODES.length, `${CODES.length} active activities (found ${rows.length})`);
    s.assert(new Set(rows.map((a) => a.wbsCode)).size === Object.keys(IN.wbs).length, 'three WBS branches (answers WP1.T1.network.wbsBranches)');
    const critical = assertT1(s, rows, 'the hand-built programme');
    return { ids, critical, site, planner };
  }, {
    verify: async (s, out) => {
      const rows = await activities(s);
      for (const [code, id] of Object.entries(out.ids)) if (!rows.some((a) => a.id === id) && code !== REBUILT) return `activity ${code} (${id}) is no longer active`;
      return true;
    },
  });
  const ID = hand.ids;
  /** True when the row holds §3.2's assignment for `code`, else what is wrong. */
  const assignmentHolds = (a, code) => {
    const engineers = assignedIds(a);
    if (siteHolds(code)) return engineers.includes(hand.site) || `${code}: the site engineer is not assigned (assigned ${JSON.stringify(engineers)})`;
    return (engineers.includes(hand.planner) && !engineers.includes(hand.site)) || `${code}: the planner, not the site engineer, holds it (assigned ${JSON.stringify(engineers)})`;
  };

  await b.step('programme.assignments', async (s) => {
    // The assignment the progress writer checks (ActivityAssignment = engineerIds;
    // ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED): the site engineer on all but A330.
    const out = {};
    for (const code of CODES) {
      const a = await s.get('planner', `${P()}/activities/${ID[code]}`);
      const holds = assignmentHolds(a, code);
      s.assert(holds === true, holds);
      out[code] = siteHolds(code) ? 'site' : 'planner';
    }
    return out;
  }, {
    needs: ['programme.hand'],
    // Live on a resume: the hand-built activities still active hold their assignment (A140's is
    // retired by F1b; the active A140 is checked by the closing 'assignments' step).
    verify: async (s) => {
      const rows = await activities(s);
      for (const code of CODES) {
        const a = rows.find((x) => x.id === ID[code]);
        if (!a) continue;
        const holds = assignmentHolds(a, code);
        if (holds !== true) return holds;
      }
      return true;
    },
  });

  // ── 2. F1 imported in hours, reviewed, approved, activated over the hand-built programme ──
  /**
   * An import the build sent and whose answer was never recorded (a killed run),
   * found by the content it stages (R1-10). None of that source and size that
   * the build did not record: it did not take effect (sent again). One that
   * carries the file's content: adopted. Anything else stops the build.
   */
  const findStaged = (record, model) => async (s) => {
    const key = modelKey(model);
    const claimed = new Set(Object.entries(b.state.records).filter(([name, r]) => name !== record && r.id).map(([, r]) => r.id));
    const candidates = (await revisions(s)).filter((r) => r.source === 'xer' && Number(r.activityCount) === model.activities.length && !claimed.has(r.id));
    if (!candidates.length) return null;
    const matching = [];
    for (const c of candidates) {
      const rev = await revision(s, c.id);
      if (revisionKey(rev) === key) matching.push(rev);
    }
    if (matching.length !== 1) {
      throw new lib.BuildError(`${record}: ${candidates.length} xer revision(s) of ${model.activities.length} activities exist that this build did not record (${candidates.map((c) => c.id).join(', ')}), and ${matching.length} carry this file's staged content; resolve by hand, then remove records["${record}"] from ${b.stateFile}`);
    }
    const rev = matching[0];
    return { revisionId: rev.id, staged: true, imported: rev.activityCount, dependencyCount: (rev.snapshotJson?.dependencies || []).length, wbsNodes: (rev.snapshotJson?.wbs || []).length };
  };
  const staging = (step, model, filename, needs = []) => b.step(step, async (s) => {
    const file = files.xer(model, { filename: b.file(filename) });
    const data = await s.upload(step, 'planner', `${P()}/import/xer`, file, {
      expect: 201,
      idOf: (d) => d?.revisionId ?? null,
      get: (id) => `${P()}/schedule/revisions/${id}`,
      fields: { staged: true, revisionId: is.present, imported: model.activities.length, dependencyCount: model.links.length, wbsNodes: model.wbs.length },
      find: findStaged(step, model),
    });
    // A rerun of this step after its upload was recorded gets the revision as read back (its id), not the
    // import's answer (R3-7, as 087-imp.js stage()): the revision id then comes from the record.
    const revisionId = data.revisionId ?? b.state.records[step]?.id ?? null;
    s.assert(typeof revisionId === 'string' && revisionId.length > 0, `the import of ${filename} names its revision (answer ${JSON.stringify(data?.revisionId ?? null)}, record ${JSON.stringify(b.state.records[step]?.id ?? null)})`);
    const rev = await revision(s, revisionId);
    s.expectFields(rev, { status: 'draft', source: 'xer', isActive: false, activityCount: model.activities.length }, 'the staged revision');
    const staged = rev.snapshotJson?.activities || [];
    s.assert(staged.length === model.activities.length, `${model.activities.length} activities staged`);
    // The adoption key is proven on every live staging (R1-10): the snapshot carries the file's content.
    s.assert(revisionKey(rev) === modelKey(model), `the staged snapshot carries ${filename}'s content key (got ${revisionKey(rev).slice(0, 160)})`);
    if (model === F1MODEL) {
      // answers WP1.T1.stagedSnapshot: A200 phys_complete_pct 40 staged; M900 early start = early finish (HR-S2's reproduction)
      const a200 = exactlyOne(staged, (a) => a.p6ActivityId === 'A200', 'staged A200');
      const m900 = exactlyOne(staged, (a) => a.p6ActivityId === 'M900', 'staged M900');
      s.assert(num(a200.physComplete) === WP1.T1.stagedSnapshot.A200physComplete.value, `A200 stages phys_complete_pct ${WP1.T1.stagedSnapshot.A200physComplete.value} (got ${a200.physComplete})`);
      s.assert(String(m900.startDate).slice(0, 10) === WP1.T1.stagedSnapshot.M900startEqualsFinish.value && String(m900.endDate).slice(0, 10) === WP1.T1.stagedSnapshot.M900startEqualsFinish.value, `M900 stages start = finish = ${WP1.T1.stagedSnapshot.M900startEqualsFinish.value} (got ${m900.startDate} / ${m900.endDate})`);
    }
    return { revisionId, keys: Object.fromEntries(staged.map((a) => [a.p6ActivityId, a.draftKey])), file: file.filename, sha256: file.sha256 };
  }, {
    needs,
    verify: async (s, out) => {
      const rev = await revision(s, out.revisionId);
      return (rev?.source === 'xer' && Number(rev?.activityCount) === model.activities.length && revisionKey(rev) === modelKey(model)) || `revision ${out.revisionId} reads ${rev?.source} with ${rev?.activityCount} activities, or no longer carries ${filename}'s content`;
    },
  });
  /** The revision lifecycle in order; a transition already taken reads at or past its status (superseded is past all). */
  const LIFECYCLE = ['draft', 'under_review', 'approved', 'baselined', 'superseded'];
  const transition = (step, persona, revisionStep, action, body, { status, needs }) => b.step(step, async (s) => {
    const { revisionId } = b.out(revisionStep);
    const RV = `${P()}/schedule/revisions/${revisionId}`;
    await s.act(step, persona, 'POST', `${RV}/${action}`, body, {
      fields: { id: revisionId, status },
      verify: async (s2) => LIFECYCLE.indexOf((await revision(s2, revisionId))?.status) >= LIFECYCLE.indexOf(status),
    });
    return { revisionId, status };
  }, { needs });

  await staging('import.F1', F1MODEL, 'F1.xer');
  // answers WP1.revisions.submitByPlanner: draft -> under_review (the planner submits)
  await transition('submit.F1', 'planner', 'import.F1', 'submit-review', { comment: b.name('F1 for review') }, { status: WP1.revisions.submitByPlanner.value, needs: ['import.F1'] });
  // answers WP1.revisions.approve.pm: under_review -> approved. HR-S2 is decided and fixed at f599e67
  // (M900's equal start and finish passes date_sanity): 200 is the only answer that builds (R1-7).
  await transition('approve.F1', 'pm', 'import.F1', 'approve', { comment: b.name('F1 approved') }, { status: WP1.revisions.approve.pm.value, needs: ['submit.F1'] });

  /**
   * Activates `revisionStep`'s revision over the active programme, mapping
   * `codes` and retiring `retire`. With `suggested`, the mapping is the one GET
   * .../mapping suggests, read and asserted first (R1-9); otherwise it is made
   * by code. Every mapped activity keeps its id and its activity code (R1-8).
   */
  const activation = (step, revisionStep, { codes, retire = [], record, needs, suggested = false }) => b.step(step, async (s) => {
    const { revisionId, keys } = b.out(revisionStep);
    const RV = `${P()}/schedule/revisions/${revisionId}`;
    let mappings = [];
    let unmappedRemovals = [];
    let suggestion = null;
    if (!(await revision(s, revisionId))?.isActive) {
      // Before the activation (a rerun after it took effect skips this read; the act's verify adopts it).
      const current = await activities(s, 'pm');
      if (suggested) {
        const mapping = await s.get('pm', `${RV}/mapping`);
        s.expectFields(mapping, { 'counts.existing': codes.length, 'counts.staged': codes.length, 'counts.suggestedMappings': codes.length, 'counts.unmappedExisting': 0, 'counts.newActivities': 0 }, 'the activation mapping GET .../mapping suggests');
        const list = mapping.suggestedMappings || [];
        const matchTypes = {};
        for (const code of codes) {
          const old = activityOf(current, code, 'before the activation');
          const sug = exactlyOne(list, (m) => m.oldActivityId === old.id, `the suggested mapping of ${code}`);
          s.assert(sug.newActivityKey === keys[code], `${code} is suggested onto the staged ${code} (${keys[code]}; got ${sug.newActivityKey})`);
          matchTypes[code] = sug.matchType;
        }
        // answers WP1.revisions.mapByCode.matchType: XER A100 onto the hand-built A100 by activity code
        s.assert(matchTypes.A100 === WP1.revisions.mapByCode.matchType.value, `A100 is suggested by ${WP1.revisions.mapByCode.matchType.value} (answers WP1.revisions.mapByCode.matchType; got ${matchTypes.A100})`);
        suggestion = { counts: mapping.counts, matchTypes };
        s.note(`${step}: GET .../mapping suggested ${codes.length} mappings, each onto its own code; match types ${JSON.stringify(matchTypes)}; activated with exactly these suggestions`);
        mappings = list.map(({ oldActivityId, newActivityKey }) => ({ oldActivityId, newActivityKey }));
      } else {
        mappings = codes.map((code) => ({ oldActivityId: activityOf(current, code, 'before the activation').id, newActivityKey: keys[code] }));
      }
      unmappedRemovals = retire.map((code) => ({ oldActivityId: activityOf(current, code, 'before the activation').id, reason: b.name(`${code} retired by the revision`) }));
    }
    const data = await s.act(step, 'pm', 'POST', `${RV}/activate`, { mappings, unmappedRemovals, comment: b.name(`${revisionStep.slice(7)} activated`) }, {
      fields: {
        'revision.id': revisionId,
        'revision.isActive': true,
        'activation.updatedActivities': is.count(record.updated),
        'activation.newActivities': is.count(record.new),
        'activation.retiredActivities': is.count(record.retired),
        'activation.dependencyCount': record.dependencyCount,
      },
      verify: async (s2) => Boolean((await revision(s2, revisionId))?.isActive),
    });
    // R1-8: every mapped activity keeps its hand-built id and its code (answers
    // WP1.revisions.mapByCode.activityCodeAfterActivation, "A100"), exactly one row per code.
    const rows = await activities(s, 'pm');
    const ids = {};
    for (const code of codes) {
      const a = exactlyOne(rows, (x) => x.activityCode === code, `${step}: the activity carrying code ${code}`);
      s.assert(a.id === ID[code], `${step}: ${code} keeps its id ${ID[code]} (got ${a.id})`);
      ids[code] = a.id;
    }
    s.assert(exactlyOne(rows, (x) => x.id === ID.A100, `${step}: A100`).activityCode === WP1.revisions.mapByCode.activityCodeAfterActivation.value, `A100 keeps activityCode ${WP1.revisions.mapByCode.activityCodeAfterActivation.value} (answers WP1.revisions.mapByCode.activityCodeAfterActivation)`);
    for (const code of retire) s.assert(!rows.some((x) => x.activityCode === code), `${code} is retired`);
    // The hand-built activities carry no budget (0 -> 0 here); "activation keeps the budget" is certified by
    // wp1-activation-code-repro.js and the WP-1 proof (adjudication 087-SCH item 6).
    s.note(`${step}: budget after activation A110 ${exactlyOne(rows, (x) => x.id === ID.A110, 'A110').budget ?? null} (the hand-built programme carries none)`);
    return {
      revisionId,
      ids,
      suggestion,
      activation: data?.activation ? { updated: data.activation.updatedActivities.length, new: data.activation.newActivities.length, retired: data.activation.retiredActivities.length, dependencyCount: data.activation.dependencyCount } : null,
    };
  }, {
    needs,
    verify: async (s, out) => {
      // The revision was activated (a later activation or a rollback may have superseded it since), and
      // every mapped activity still stands, except A140, which F1b retires and the rollback brings back as
      // a new activity (answers WP1.revisions.F1b, WP1.revisions.rollback; WP1-RB-1).
      const rev = await revision(s, out.revisionId);
      if (!rev?.activatedAt) return `revision ${out.revisionId} reads as never activated`;
      const rows = await activities(s, 'pm');
      for (const code of codes.filter((c) => c !== REBUILT)) if (!rows.some((a) => a.id === out.ids[code])) return `${code} (${out.ids[code]}) is no longer active`;
      return true;
    },
  });

  // answers WP1.revisions.activate.record: updated 14, new 0, retired 0, dependencyCount 13 (the hand-built
  // choreography), and WP1.revisions.activate.full: active, CPM inside the activation.
  const ACT = WP1.revisions.activate.record;
  await activation('activate.F1', 'import.F1', { codes: CODES, suggested: true, record: { updated: ACT.updated.value, new: ACT.new.value, retired: ACT.retired.value, dependencyCount: ACT.dependencyCount.value }, needs: ['approve.F1', 'programme.hand'] });
  await b.step('cpm.F1', async (s) => {
    // answers WP1.T1 (every row), WP1.T1.criticalCount 12, M900 early finish 2026-04-28 (WP1.T1.M900earlyFinishDate)
    const rows = await activities(s);
    const critical = assertT1(s, rows, 'F1 activated');
    const m900 = activityOf(rows, 'M900', 'F1 activated');
    s.assert(String(m900.earlyFinishDate || m900.endDate || '').slice(0, 10) === WP1.T1.M900earlyFinishDate.value, `M900 finishes ${WP1.T1.M900earlyFinishDate.value} (got ${m900.earlyFinishDate} / ${m900.endDate})`);
    return { critical };
  }, { needs: ['activate.F1'] });

  // ── 3. the baseline with no bill: refused at its moment, F1 active and nothing uploaded (answers WP1.baseline.noBoq; R1-16) ──
  await b.step('baseline.noBoq', async (s) => {
    const f1 = b.out('import.F1').revisionId;
    s.assert((await revision(s, f1))?.isActive === true, 'F1 is the active revision');
    s.assert(listOf(await s.get('qs', `${P()}/boq`)).length === 0, 'no BOQ row is on the project yet');
    return probe(s, 'baseline.noBoq', 'pm', 'POST', `${P()}/schedule/revisions/${f1}/baseline`, { comment: b.name('baseline before the bill is uploaded') }, WP1.baseline.noBoq.value, { find: baselinedFind(f1) });
  }, { needs: ['cpm.F1'] });

  // ── 4. the bill (answers inputs.boq087SCH; WP1.baseline.unallocated.inScopePriced) ──
  // Uploaded before F1b, so the BOQ gates pass when F1b is approved and not yet activated (R1-16).
  const bill = await b.step('boq.upload', async (s) => {
    const file = files.boqWorkbook(BOQ, { filename: b.file('BOQ.xlsx'), title: b.name('Bill of quantities') });
    const items = async (s2) => listOf(await s2.get('qs', `${P()}/boq`));
    const data = await s.upload('boq.upload', 'qs', `${P()}/boq/upload`, file, {
      expect: [200, 201],
      form: { label: b.name('Bill') },
      fields: { revisionId: is.present },
      idOf: (d) => d?.revisionId ?? d?.revision?.id ?? null,
      get: (id) => `${P()}/boq/revisions/${id}`,
      find: async (s2) => {
        const mine = (await items(s2)).filter((i) => ROW[i.code]);
        if (mine.length !== BOQ.length) return null;
        const revisionIds = [...new Set(mine.map((i) => i.revisionId || i.boqRevisionId).filter(Boolean))];
        if (revisionIds.length > 1) throw new lib.BuildError(`boq.upload: the bill's rows belong to ${revisionIds.length} revisions; resolve by hand`);
        return revisionIds.length === 1 ? { revisionId: revisionIds[0] } : null;
      },
    });
    const rows = await items(s);
    const out = {};
    for (const r of BOQ) {
      const it = exactlyOne(rows, (i) => i.code === r.code && i.isActive !== false, `BOQ row ${r.code}`);
      s.expectFields(it, { amount: is.cents(r.quantity * r.rate), unit: r.unit, mappingRule: files.MAPPING_RULE_CELL[r.mappingRule] }, `BOQ row ${r.code}`);
      out[r.code] = it.id;
    }
    const inScope = BOQ.filter((r) => r.mappingRule === 'in_scope').reduce((sum, r) => sum + cents(r.quantity * r.rate), 0);
    s.assert(inScope === WP1.baseline.unallocated.inScopePriced.value, `the in-scope bill is ${lib.formatCents(WP1.baseline.unallocated.inScopePriced.value)} (answers WP1.baseline.unallocated.inScopePriced)`);
    // After the upload was recorded, a rerun gets the revision as read back (its id): the record's id then (R3-7).
    return { revisionId: data.revisionId ?? data.revision?.id ?? b.state.records['boq.upload']?.id ?? null, items: out, file: file.filename, sha256: file.sha256 };
  }, { needs: ['project', 'baseline.noBoq'] });
  const ITEM = bill.items;

  // ── 5. F1b: A110 160 h and A140 left out — supersede, mapping, one retirement, rollback (answers WP1.revisions.F1b, .rollback) ──
  // F1b is staged only once F1 is active: an import supersedes the open draft (answers WP1.revisions.secondImport),
  // and F1 under review must not be superseded by it.
  await staging('import.F1b', F1BMODEL, 'F1b.xer', ['activate.F1']);
  await transition('submit.F1b', 'planner', 'import.F1b', 'submit-review', { comment: b.name('F1b for review') }, { status: WP1.revisions.submitByPlanner.value, needs: ['import.F1b', 'activate.F1'] });
  await transition('approve.F1b', 'pm', 'import.F1b', 'approve', { comment: b.name('F1b approved') }, { status: WP1.revisions.approve.pm.value, needs: ['submit.F1b'] });

  // The baseline of an approved revision still staged: refused at its moment (answers WP1.baseline.notActivated; R1-16).
  await b.step('baseline.notActivated', async (s) => {
    const f1b = b.out('import.F1b').revisionId;
    const rev = await revision(s, f1b);
    s.assert(rev?.status === 'approved' && rev?.isActive === false, `F1b is approved and not activated (it is ${rev?.status}, active ${rev?.isActive})`);
    return probe(s, 'baseline.notActivated', 'pm', 'POST', `${P()}/schedule/revisions/${f1b}/baseline`, { comment: b.name('baseline of F1b before its activation') }, WP1.baseline.notActivated.value, { find: baselinedFind(f1b) });
  }, { needs: ['approve.F1b', 'boq.upload'] });

  const F1B = WP1.revisions.F1b;
  await activation('activate.F1b', 'import.F1b', {
    codes: CODES.filter((c) => c !== REBUILT),
    retire: [REBUILT],
    record: { updated: F1B.record.updated.value, new: F1B.record.new.value, retired: F1B.record.retired.value, dependencyCount: F1B.record.dependencyCount.value },
    needs: ['approve.F1b', 'baseline.notActivated'],
  });
  await b.step('cpm.F1b', async (s) => {
    const rows = await activities(s);
    // answers WP1.revisions.F1b.M900_EF 91, A300_TF 20, A110days 20, previousRevision superseded
    s.expectFields(activityOf(rows, 'M900', 'under F1b'), { earlyFinish: is.number(F1B.M900_EF.value) }, 'M900 under F1b');
    s.expectFields(activityOf(rows, 'A300', 'under F1b'), { totalFloat: is.number(F1B.A300_TF.value) }, 'A300 under F1b');
    s.expectFields(activityOf(rows, 'A110', 'under F1b'), { duration: is.number(F1B.A110days.value) }, 'A110 under F1b');
    s.assert(!rows.some((a) => a.activityCode === REBUILT || a.p6ActivityId === REBUILT), 'A140 is retired');
    s.expectFields(await revision(s, b.out('import.F1').revisionId), { status: F1B.previousRevision.value }, "F1's revision after F1b's activation");
    return { M900: F1B.M900_EF.value };
  }, { needs: ['activate.F1b'] });
  await b.step('rollback.F1b', async (s) => {
    const f1b = b.out('import.F1b').revisionId;
    const f1 = b.out('import.F1').revisionId;
    const a140Before = ID[REBUILT]; // the hand-built A140, kept by F1's activation (asserted there), retired by F1b
    await s.act('rollback.F1b', 'pm', 'POST', `${P()}/schedule/revisions/${f1b}/rollback`, { reason: b.name('F1b rolled back to F1') }, {
      fields: { 'revision.id': f1, 'revision.isActive': true },
      verify: async (s2) => Boolean((await revision(s2, f1))?.isActive),
    });
    const rows = await activities(s);
    // answers WP1.revisions.rollback.M900_EF 81 (F1 again: A110 10 days, A140 back)
    s.expectFields(activityOf(rows, 'M900', 'after the rollback'), { earlyFinish: is.number(WP1.revisions.rollback.M900_EF.value) }, 'M900 after the rollback');
    s.assert(rows.length === CODES.length, `14 active activities with A140 back (found ${rows.length})`);
    const a140 = activityOf(rows, REBUILT, 'after the rollback');
    const sameId = a140.id === a140Before;
    const engineersBefore = assignedIds(a140);
    // answers WP1.revisions.rollback.A140id: "same id as before the retirement" (assumption; plan WP-9
    // "activation and rollback keep ids"). HEAD re-creates it: a finding (adjudication R1-6, suspect WP1-RB-1).
    if (!sameId) {
      s.finding('WP1-RB-1', `Rolling back F1b to F1 in 087-SCH brought A140 back as a new activity ${a140.id} (activityCode ${JSON.stringify(a140.activityCode ?? null)}, p6ActivityId ${JSON.stringify(a140.p6ActivityId ?? null)}, assigned engineers ${JSON.stringify(engineersBefore)}); the A140 retired by F1b, ${a140Before}, stays inactive. answers WP1.revisions.rollback.A140id expects ${JSON.stringify(WP1.revisions.rollback.A140id.value)}. The site engineer is assigned to the new A140 again (R1-6).`);
    }
    // R1-6: the site engineer on the active A140 (§3.2: every activity except A330)
    await s.act('A140.engineer', 'planner', 'PATCH', `${P()}/activities/${a140.id}`, { engineerIds: [hand.site] }, {
      fields: { id: a140.id, assignedEngineers: (v) => (Array.isArray(v) && v.some((e) => e.id === hand.site)) || 'the site engineer among the assigned engineers' },
      verify: async (s2) => assignedIds(await s2.get('planner', `${P()}/activities/${a140.id}`)).includes(hand.site),
    });
    const ids = Object.fromEntries(CODES.map((code) => [code, activityOf(rows, code, 'after the rollback').id]));
    return { ids, a140: { before: a140Before, after: a140.id, sameId, activityCode: a140.activityCode ?? null, p6ActivityId: a140.p6ActivityId ?? null, engineersBeforeReassignment: engineersBefore } };
  }, { needs: ['cpm.F1b'] });

  // ── 6. WP-1 T2 at its moment, on F1 again, before the baseline and the tail (answers WP1.T2; R1-5) ──
  await b.step('cpm.T2', async (s) => {
    const T2 = WP1.T2;
    const A110 = b.out('rollback.F1b').ids.A110;
    const route = `${P()}/activities/${A110}`;
    const durationNow = async (s2) => num((await s2.get('planner', route))?.duration);
    const idsBefore = (await activities(s)).map((a) => a.id).sort();
    const restoreSent = Boolean(b.state.records['T2.A110.restore']);
    await s.act('T2.A110.20', 'planner', 'PATCH', route, { duration: T2.A110duration.value }, {
      fields: { id: A110, duration: is.number(T2.A110duration.value) },
      verify: async (s2) => (await durationNow(s2)) === T2.A110duration.value,
    });
    let at20 = 'asserted by an earlier attempt of this step, before the restore was sent (its note keeps the figures)';
    if (!restoreSent) {
      const rows = await activities(s);
      const m900 = activityOf(rows, 'M900', 'A110 = 20');
      s.expectFields(m900, { earlyFinish: is.number(T2.M900_EF.value) }, 'M900 with A110 = 20 (answers WP1.T2.M900_EF)');
      s.assert(String(m900.earlyFinishDate || '').slice(0, 10) === T2.M900date.value, `M900 finishes ${T2.M900date.value} with A110 = 20 (answers WP1.T2.M900date; got ${m900.earlyFinishDate})`);
      for (const code of ['A140', 'A300']) {
        const want = T2[code];
        s.expectFields(activityOf(rows, code, 'A110 = 20'), { earlyStart: is.number(want.ES.value), earlyFinish: is.number(want.EF.value), lateFinish: is.number(want.LF.value), totalFloat: is.number(want.TF.value) }, `${code} with A110 = 20 (answers WP1.T2.${code})`);
      }
      // "floats unchanged": every row's float is its WP1.T1 float
      for (const code of CODES) s.expectFields(activityOf(rows, code, 'A110 = 20'), { totalFloat: is.number(WP1.T1[code].TF.value) }, `${code}'s float is unchanged with A110 = 20`);
      const critical = rows.filter((a) => num(a.totalFloat) !== null && num(a.totalFloat) <= 0).map(labelOf).sort();
      s.assert(critical.length === T2.criticalCount.value, `${T2.criticalCount.value} critical with A110 = 20 (answers WP1.T2.criticalCount; got ${critical.join(',')})`);
      const idsAfter = rows.map((a) => a.id).sort();
      s.assert(idsAfter.length === T2.idsUnchanged.value && JSON.stringify(idsAfter) === JSON.stringify(idsBefore), `the ${T2.idsUnchanged.value} activity ids are unchanged by the recalculation (answers WP1.T2.idsUnchanged)`);
      at20 = { M900: { EF: num(m900.earlyFinish), date: String(m900.earlyFinishDate).slice(0, 10) }, A140: { TF: num(activityOf(rows, 'A140', 'A110 = 20').totalFloat) }, A300: { TF: num(activityOf(rows, 'A300', 'A110 = 20').totalFloat) }, critical: critical.length, ids: idsAfter.length };
      s.note(`WP1.T2 at A110 = 20, asserted at its moment: ${JSON.stringify(at20)}`);
    }
    // restored: A110 back to its F1 duration (answers WP1.T2.restored)
    await s.act('T2.A110.restore', 'planner', 'PATCH', route, { duration: WP1.T1.network.durations.value.A110 }, {
      fields: { id: A110, duration: is.number(WP1.T1.network.durations.value.A110) },
      verify: async (s2) => (await durationNow(s2)) === WP1.T1.network.durations.value.A110,
    });
    const rows = await activities(s);
    const m900 = activityOf(rows, 'M900', 'A110 restored');
    s.expectFields(m900, { earlyFinish: is.number(T2.restored.M900_EF.value) }, 'M900 with A110 restored (answers WP1.T2.restored.M900_EF)');
    s.assert(String(m900.earlyFinishDate || '').slice(0, 10) === T2.restored.M900date.value, `M900 finishes ${T2.restored.M900date.value} again (answers WP1.T2.restored.M900date; got ${m900.earlyFinishDate})`);
    assertT1(s, rows, 'A110 restored');
    return { at20, restored: { M900: { EF: num(m900.earlyFinish), date: String(m900.earlyFinishDate).slice(0, 10) } } };
  }, { needs: ['rollback.F1b'] });

  // ── 7. the allocations: five activities, S-006 left for the baseline step (answers WP2.setup.allocations, WP1.baseline.unallocated) ──
  const allocationList = `${P()}/activity-boq-allocations?includeInactive=true`;
  /** One allocation, created and submitted by the planner, approved by the QS. */
  const allocate = async (s, key, { boq, activityId, quantity, amount }) => {
    const ref = b.ref(`ALLOC-${key}`);
    const find = async (s2) => atMostOne(listOf(await s2.get('planner', allocationList)), (a) => String(a.notes || '').includes(ref) && a.status !== 'rejected', `allocation ${ref}`);
    const created = await s.create(`alloc.${key}`, 'planner', `${P()}/activity-boq-allocations`, {
      boqItemId: ITEM[boq], activityId, quantity, amount, source: 'manual', notes: `${ref} ${boq} to ${key.split('.')[1]}`,
    }, {
      fields: { boqItemId: ITEM[boq], activityId, amount: is.cents(amount), quantity: is.number(quantity) },
      // No GET by id, and the list answers { allocations, summary }: read back by the step's verify.
      get: null,
      find,
    });
    const A = `${P()}/activity-boq-allocations/${created.id}`;
    const statusOf = async (s2) => listOf(await s2.get('planner', allocationList)).find((a) => a.id === created.id)?.status;
    await s.act(`alloc.${key}.submit`, 'planner', 'POST', `${A}/submit`, {}, { fields: { id: created.id, status: 'submitted' }, verify: async (s2) => ['submitted', 'approved'].includes(await statusOf(s2)) });
    await s.act(`alloc.${key}.approve`, 'qs', 'POST', `${A}/approve`, {}, { fields: { id: created.id, status: 'approved' }, verify: async (s2) => (await statusOf(s2)) === 'approved' });
    return created.id;
  };
  /** Every allocation id still approved and active (a step's read-back). */
  const approvedStill = async (s, ids) => {
    const rows = listOf(await s.get('planner', allocationList));
    for (const id of ids) {
      const a = rows.find((x) => x.id === id);
      if (!a || a.status !== 'approved' || a.isActive === false) return `allocation ${id} is ${a ? `${a.status}${a.isActive === false ? ', inactive' : ''}` : 'gone'}`;
    }
    return true;
  };
  const allocations = await b.step('boq.allocations', async (s) => {
    const out = {};
    for (const r of BOQ) {
      for (const [code, quantity, amount] of r.allocations) out[`${r.code}.${code}`] = await allocate(s, `${r.code}.${code}`, { boq: r.code, activityId: ID[code], quantity, amount });
    }
    const list = await s.get('planner', allocationList);
    const approved = listOf(list).filter((a) => a.status === 'approved' && a.isActive !== false);
    const total = approved.reduce((sum, a) => sum + cents(a.amount), 0);
    // answers WP1.baseline.unallocated.allocatedAmount = 387,000.00 (the five activities; WP-0 stage3 table)
    s.assert(total === WP1.baseline.unallocated.allocatedAmount.value, `the approved allocations total ${lib.formatCents(WP1.baseline.unallocated.allocatedAmount.value)} (got ${lib.formatCents(total)})`);
    const perActivity = {};
    for (const a of approved) {
      const code = Object.keys(ID).find((c) => ID[c] === a.activityId);
      perActivity[code] = (perActivity[code] || 0) + cents(a.amount);
    }
    // answers WP2.setup.allocations (cents per activity)
    s.assert(JSON.stringify(Object.fromEntries(Object.entries(perActivity).sort())) === JSON.stringify(Object.fromEntries(Object.entries(WP2.setup.allocations.value).sort())), `allocations per activity ${JSON.stringify(WP2.setup.allocations.value)} (got ${JSON.stringify(perActivity)})`);
    s.assert(!approved.some((a) => a.boqItemId === ITEM['S-006']), 'S-006 is not allocated before the baseline step');
    return out;
  }, {
    needs: ['boq.upload', 'programme.hand'],
    verify: async (s, out) => approvedStill(s, Object.values(out)),
  });

  // ── 8. the baseline: refused while S-006 is unallocated, the refusal naming BOQ allocations (R1-16) ──
  await b.step('baseline.unallocated', async (s) => {
    const f1 = b.out('import.F1').revisionId;
    s.assert((await revision(s, f1))?.isActive === true, 'F1 is the active revision again');
    const U = WP1.baseline.unallocated;
    return probe(s, 'baseline.unallocated', 'pm', 'POST', `${P()}/schedule/revisions/${f1}/baseline`, { comment: b.name('baseline before S-006 is allocated') }, U.refusal.value, {
      find: baselinedFind(f1),
      check: (error) => {
        // answers WP1.baseline.unallocated.refusal: "the message names BOQ allocations"; the one failing
        // baseline check is the allocation coverage, S-006's 72,000.00 in scope unallocated
        const failing = (error.details?.checks || []).filter((c) => c.severity === 'blocking' && !c.passed && (!Array.isArray(c.requiredFor) || c.requiredFor.includes('baseline')));
        s.assert(String(error.message || '').includes('BOQ allocations'), `the refusal names BOQ allocations (message: ${String(error.message || '').slice(0, 300)})`);
        s.assert(failing.length === 1 && failing[0].key === 'allocations', `the one failing baseline check is the allocations (got ${failing.map((c) => c.key).join(', ') || 'none'})`);
        const d = failing[0].details || {};
        const inScopeUnallocated = cents(d.unallocatedAmount) - cents(d.optionalUnallocatedAmount || 0);
        s.assert(inScopeUnallocated === U.unallocatedAmount.value, `${lib.formatCents(U.unallocatedAmount.value)} in scope unallocated (answers WP1.baseline.unallocated.unallocatedAmount; got ${d.unallocatedAmount} less optional ${d.optionalUnallocatedAmount})`);
        s.assert(cents(d.approvedAllocatedAmount) === U.allocatedAmount.value, `${lib.formatCents(U.allocatedAmount.value)} approved allocated (answers WP1.baseline.unallocated.allocatedAmount; got ${d.approvedAllocatedAmount})`);
        return { failing: failing.map((c) => c.key), inScopeUnallocatedCents: inScopeUnallocated, approvedAllocatedCents: cents(d.approvedAllocatedAmount) };
      },
    });
  }, { needs: ['boq.allocations', 'cpm.T2'] });

  // ── 9. then S-006 to A220 and the baseline locked (answers WP1.baseline.covered) ──
  await b.step('baseline', async (s) => {
    const f1 = b.out('import.F1').revisionId;
    const RV = `${P()}/schedule/revisions/${f1}`;
    const ids = b.out('rollback.F1b').ids;
    // answers WP1.baseline.covered.coverAllocation: S-006 slab screed to A220, 1,200 m2, 72,000.00 (the integration owner's reading)
    const [code, quantity, amount] = ROW['S-006'].coveredAtBaselineBy;
    const s006 = await allocate(s, `S-006.${code}`, { boq: 'S-006', activityId: ids[code], quantity, amount });
    await s.act('baseline.lock', 'pm', 'POST', `${RV}/baseline`, { comment: b.name('F1 baseline') }, {
      fields: { 'revision.id': f1, 'revision.status': WP1.baseline.covered.status.value },
      verify: async (s2) => (await revision(s2, f1))?.status === 'baselined',
    });
    const rows = await activities(s);
    // answers WP1.baseline.covered.locked 14 and equalsEarly: the baseline is the early dates at the lock
    // (A300 51/61 = covered.A300, M900 81/81 = covered.M900). The activity list states the baseline as dates.
    const locked = rows.filter((a) => a.baselineStartDate && a.baselineFinishDate);
    s.assert(locked.length === WP1.baseline.covered.locked.value, `${WP1.baseline.covered.locked.value} activities carry a baseline (got ${locked.length})`);
    for (const c of CODES) {
      const a = activityOf(rows, c, 'after the lock');
      const [es, ef] = WP1.baseline.covered.equalsEarly.value[c];
      s.expectFields(a, {
        earlyStart: is.number(es), earlyFinish: is.number(ef),
        baselineStartDate: is.day(String(a.earlyStartDate).slice(0, 10)), baselineFinishDate: is.day(String(a.earlyFinishDate).slice(0, 10)),
      }, `${c}'s baseline (the early dates of offsets ${es}/${ef})`);
    }
    const approved = listOf(await s.get('planner', allocationList)).filter((a) => a.status === 'approved' && a.isActive !== false);
    // answers WP1.baseline.covered.totalAllocated 459,000.00 (the EV budget after the baseline; the integration owner's reading)
    s.assert(approved.reduce((sum, a) => sum + cents(a.amount), 0) === WP1.baseline.covered.totalAllocated.value, `${lib.formatCents(WP1.baseline.covered.totalAllocated.value)} allocated after the baseline step`);
    return { revisionId: f1, status: 'baselined', s006 };
  }, {
    needs: ['baseline.unallocated', 'rollback.F1b'],
    verify: async (s, out) => ((await revision(s, out.revisionId))?.status === 'baselined' ? approvedStill(s, [out.s006]) : `revision ${out.revisionId} is no longer baselined`),
  });

  // ── 10. progress methods per activity (answers inputs.methods087SCH; WP2.setup.methods) ──
  const METHOD_CONFIG = {
    A110: { method: 'percent', evidenceRequired: false },
    A120: { method: 'percent', evidenceRequired: true },
    A310: { method: 'quantity', quantityUnit: 'm2' },
    A320: { method: 'quantity', quantityUnit: 'm2' },
    A210: { method: 'weighted_milestone', milestoneWeights: METHODS.A210.weights.map((weight, i) => ({ id: `m${i + 1}`, name: ['Formwork erected', 'Reinforcement fixed', 'Concrete poured'][i], weight })) },
    A230: { method: 'inspection', inspectionRequired: true },
  };
  /** True when the stored method of `code` reads back as configured (R1-17: the weights and the inspection flag too), else what differs. */
  const methodHolds = (code, m) => {
    const want = METHOD_CONFIG[code];
    if (m?.method !== want.method) return `${code}'s method is ${m?.method}, not ${want.method}`;
    if (want.evidenceRequired !== undefined && m.evidenceRequired !== want.evidenceRequired) return `${code}'s evidenceRequired is ${m.evidenceRequired}`;
    if (want.quantityUnit && m.quantityUnit !== want.quantityUnit) return `${code}'s unit is ${m.quantityUnit}`;
    if (want.inspectionRequired !== undefined && m.inspectionRequired !== want.inspectionRequired) return `${code}'s inspectionRequired is ${m.inspectionRequired}`;
    if (want.milestoneWeights) {
      // answers inputs.methods087SCH.A210.weights 20/30/50, each milestone by its id
      for (const w of want.milestoneWeights) {
        const stored = (m.milestoneWeights || []).filter((x) => x.id === w.id);
        if (stored.length !== 1 || Number(stored[0].weight) !== w.weight) return `${code}'s milestone ${w.id} reads ${JSON.stringify(stored)}, not weight ${w.weight}`;
      }
      if ((m.milestoneWeights || []).length !== want.milestoneWeights.length) return `${code} carries ${(m.milestoneWeights || []).length} milestones`;
    }
    return true;
  };
  await b.step('progress.methods', async (s) => {
    const out = {};
    for (const [code, body] of Object.entries(METHOD_CONFIG)) {
      const route = `${P()}/activities/${ID[code]}/progress-method`;
      const data = await s.act(`method.${code}`, 'planner', 'PUT', route, { ...body, notes: `${b.ref(`METHOD-${code}`)} ${body.method}` }, {
        named: true,
        fields: { method: body.method, ...(body.evidenceRequired !== undefined ? { evidenceRequired: body.evidenceRequired } : {}), ...(body.quantityUnit ? { quantityUnit: body.quantityUnit } : {}) },
        verify: async (s2) => (await s2.get('planner', route))?.method === body.method,
      });
      // R1-17: read back what was stored (HR-P3: a PUT resets what it omits)
      const stored = await s.get('planner', route);
      const holds = methodHolds(code, stored);
      s.assert(holds === true, holds);
      out[code] = { id: data?.id ?? stored?.id ?? null, method: body.method, ...(code === 'A210' ? { weights: stored.milestoneWeights.map((w) => [w.id, Number(w.weight)]) } : {}), ...(code === 'A230' ? { inspectionRequired: stored.inspectionRequired } : {}) };
    }
    for (const code of ['A300', 'A330']) {
      // answers inputs.methods087SCH.A300/A330: not configured
      const res = await s.send('planner', 'GET', `${P()}/activities/${ID[code]}/progress-method`);
      const m = res.body?.data;
      s.assert(res.status === 404 || (res.status === 200 && (!m || !m.id || m.configured === false)), `${code} carries no configured method (got ${lib.said(res)} ${JSON.stringify(m)?.slice(0, 200)})`);
    }
    // answers WP2.setup.A310planned 900 m2 and A320planned 600 m2: planned from the approved allocations
    for (const [code, planned] of [['A310', WP2.setup.A310planned.value], ['A320', WP2.setup.A320planned.value]]) {
      const view = await s.get('planner', `${P()}/activities/${ID[code]}/quantities`);
      s.expectFields(view, { 'progress.method': 'quantity', 'progress.planned.value': is.number(planned), 'progress.planned.plannedBasis': 'approved_allocations' }, `${code}'s planned quantity`);
    }
    return out;
  }, {
    needs: ['boq.allocations'],
    verify: async (s) => {
      for (const code of Object.keys(METHOD_CONFIG)) {
        const holds = methodHolds(code, await s.get('planner', `${P()}/activities/${ID[code]}/progress-method`));
        if (holds !== true) return holds;
      }
      return true;
    },
  });

  // ── 11. the form ITP: a template with a hold item and an instance on A130 (WP-2 T4 starts here) ──
  await b.step('itp', async (s) => {
    const name = b.name('Foundation pour ITP');
    const templates = `${P()}/forms/templates`;
    const template = await s.create('itp.template', 'quality', templates, {
      name,
      type: 'itp',
      status: 'active',
      description: `${b.ref('ITP-T1')} inspection and test plan for the foundation pour`,
      sections: [{ title: 'Before the pour', items: [{ label: 'Formwork, reinforcement and cover checked and released for the pour', responseType: 'pass_fail', isHoldPoint: true, reference: 'Structural GA' }] }],
    }, {
      fields: { name, type: 'itp', status: 'active', holdPointCount: 1, itemCount: 1 },
      get: (id) => `${templates}/${id}`,
      find: async (s2) => atMostOne(listOf(await s2.get('quality', `${templates}?scope=project&type=itp`)), (t) => t.name === name, `ITP template ${name}`),
    });
    const clientRequestId = b.ref('ITP-A130');
    const onlyPending = (v) => (Array.isArray(v) && v.length === 1 && v.every((h) => h.state === WP2.T4.holdState.value)) || `one hold point, ${WP2.T4.holdState.value}`;
    const instance = await s.create('itp.instance', 'quality', `${P()}/forms`, {
      templateId: template.id,
      title: b.name('ITP A130 foundation pour'),
      activityId: ID.A130,
      inspectorUserId: await b.userId('quality'),
      clientRequestId,
    }, {
      fields: { templateId: template.id, type: 'itp', activityId: ID.A130, status: 'scheduled', holdPoints: onlyPending },
      get: (id) => `${P()}/forms/${id}`,
      // An interrupted create is found by its clientRequestId among A130's instances of the template.
      find: async (s2) => atMostOne(listOf(await s2.get('quality', `${P()}/forms?activityId=${ID.A130}&templateId=${template.id}&status=all`)), (f) => f.clientRequestId === clientRequestId, `ITP instance ${clientRequestId}`),
    });
    // answers WP2.T4.openList: /forms/hold-points?activityId=A130 shows 1 open, state pending, on this instance
    const open = await s.get('quality', `${P()}/forms/hold-points?activityId=${ID.A130}`);
    s.expectFields(open, { open: WP2.T4.openList.value }, 'the open hold points on A130');
    const hold = exactlyOne(open.holdPoints || [], (h) => h.instanceId === instance.id, 'the open hold point of the A130 instance');
    s.assert(hold.state === WP2.T4.holdState.value, `the hold point is ${WP2.T4.holdState.value} (answers WP2.T4.holdState; got ${hold.state})`);
    return { templateId: template.id, instanceId: instance.id };
  }, { needs: ['programme.hand'] });

  // ── 12. an uploaded site photo: the stored project document WP-2 T3 uses as A120's evidence (HR-X1) ──
  // The product lists site-reporting uploads nowhere (no route reads them by name), so an interrupted
  // upload cannot be found: it stops the build for a check by hand and is never re-sent (G4, fail closed).
  await b.step('photo', async (s) => {
    const filename = b.file('site-photo.png');
    const named = (d) => listOf(d).filter((f) => f.originalName === filename && f.documentId);
    const data = await s.upload('photo', 'site', `${P()}/site-reporting/uploads`, { filename, body: PNG_1X1, contentType: 'image/png' }, {
      field: 'files',
      idOf: (d) => (named(d).length === 1 ? named(d)[0].documentId : null),
      get: null,
      fields: { length: (_, d) => named(d).length === 1 || `exactly one uploaded file named ${filename}` },
    });
    const file = exactlyOne(listOf(data), (f) => f.originalName === filename, `the uploaded ${filename}`);
    const res = await s.send('site', 'GET', `${P()}/site-reporting/uploads/${encodeURIComponent(file.key)}`);
    s.assert(res.status === 200, `the photo reads back (GET answered ${lib.said(res)})`);
    return { documentId: file.documentId, key: file.key, url: file.url ?? null, filename };
  }, {
    needs: ['team'],
    verify: async (s, out) => (await s.send('site', 'GET', `${P()}/site-reporting/uploads/${encodeURIComponent(out.key)}`)).status === 200 || `the photo ${out.key} no longer reads back`,
  });

  // ── 13. A310's quantities, in every entry state, each figure at its moment (answers WP2.quantitiesA310; item 1, R1-3, R1-4) ──
  const A310 = `${P()}/activities/${ID.A310}`;
  const s003 = ITEM['S-003'];
  const alloc310 = () => allocations['S-003.A310'];
  const submissions = async (s, A = A310) => listOf(await s.get('qs', `${A}/progress-submissions`));
  const entries = async (s, query) => listOf(await s.get('site', `${P()}/quantity-progress?${query}`));
  const officialPct = async (s, A = A310) => num((await s.get('qs', A))?.pctComplete);
  /**
   * EV(A310) on the EV report's default basis (QS: cost and BOQ readers). 087-SCH
   * has no reporting period, so the report is cut ad hoc at the end of today in
   * the project's zone and counts every approval made so far; asserted, so a
   * basis cut before the read (R1-1's window) cannot pass silently.
   */
  const evA310 = async (s) => {
    const readAt = new Date().toISOString();
    const report = await s.get('qs', `${P()}/reports/ev`);
    // The breakdown names each activity by its code in `activityId` (A310), or by its id: either, exactly one row.
    const row = exactlyOne(report?.activityBreakdown || [], (a) => a.activityId === 'A310' || a.activityId === ID.A310, 'A310 in the EV report');
    const cutoff = report?.reporting?.cutoffDate ?? null;
    s.assert(Boolean(cutoff) && Date.parse(cutoff) >= Date.parse(readAt), `the EV report is cut at or after the read (${readAt}; cutoff ${cutoff})`);
    return { ev: row.ev, pct: row.pct ?? null, budget: row.budget ?? null, projectEv: report?.ev ?? null, cutoffDate: cutoff, cutoffLocalDate: report?.reporting?.cutoffLocalDate ?? null, timeZone: report?.reporting?.timeZone ?? null, readAt };
  };
  const assertEv = (s, ev, leaf, key) => s.assert(cents(ev.ev) === leaf.value, `EV(A310) ${lib.formatCents(leaf.value)} (answers ${key}; got ${ev.ev})`);
  /** A claim on A310 (site), then approved or rejected by the QS. */
  const claim = async (s, key, body, outcome) => {
    const ref = b.ref(`PROG-${key}`);
    const made = await s.create(`claim.${key}`, 'site', `${A310}/progress`, { status: 'submitted', source: 'manual', ...body, notes: `${ref} ${body.notes || ''}`.trim() }, {
      expect: [200, 201],
      idOf: (d) => d?.submission?.id ?? null,
      fields: { 'submission.status': 'submitted', 'submission.id': is.present },
      get: () => `${A310}/progress-submissions`,
      // adopted in the answer's own shape; an interrupted claim is still submitted (its approval is the next request)
      find: async (s2) => {
        const row = atMostOne(await submissions(s2), (x) => String(x.notes || '').includes(ref), `claim ${ref}`);
        return row ? { submission: row } : null;
      },
    });
    const id = made?.submission?.id ?? made?.id;
    const base = `${A310}/progress-submissions/${id}`;
    const statusOf = async (s2) => (await submissions(s2)).find((x) => x.id === id)?.status;
    if (outcome === 'approved') {
      await s.act(`claim.${key}.approve`, 'qs', 'POST', `${base}/approve`, {}, { fields: { id, status: 'approved' }, verify: async (s2) => (await statusOf(s2)) === 'approved' });
    } else {
      await s.act(`claim.${key}.reject`, 'qs', 'POST', `${base}/reject`, { reason: b.name(`${key} rejected: measured twice`) }, { fields: { id, status: 'rejected' }, verify: async (s2) => (await statusOf(s2)) === 'rejected' });
    }
    return id;
  };
  /** A quantity entry on S-003 for A310 (site), by clientRequestId. */
  const entry = (s, key, quantity, date, status) => {
    const clientRequestId = b.ref(`QTY-${key}`);
    return s.create(`entry.${key}`, 'site', `${P()}/quantity-progress`, {
      activityId: ID.A310, boqItemId: s003, allocationId: alloc310(), quantity, date: b.past(date), status, note: `${clientRequestId} ${quantity} m2`, clientRequestId,
    }, {
      idOf: (d) => d?.entry?.id ?? null,
      fields: { 'entry.status': status, 'entry.quantity': is.number(quantity), 'entry.clientRequestId': clientRequestId, 'entry.replayed': (v) => v === false || v === undefined || 'a new entry, not a replay' },
      get: (id) => `${P()}/quantity-progress/${id}`,
      // adopted in the answer's own shape (an entry that was bundled since reads submitted until its claim is settled)
      find: async (s2) => {
        const row = atMostOne(await entries(s2, `activityId=${ID.A310}`), (e) => e.clientRequestId === clientRequestId, `entry ${clientRequestId}`);
        return row ? { entry: row } : null;
      },
    });
  };
  const installedOn = async (s) => {
    const approved = await entries(s, `activityId=${ID.A310}&status=approved`);
    return approved.reduce((sum, e) => sum + Number(e.quantity), 0);
  };

  await b.step('qty.barePercent', async (s) => {
    // answers WP2.quantitiesA310.barePercent: before any entry, a percent with no entry and no typed
    // quantity on the quantity activity is refused 400 QUANTITY_NO_ENTRIES_TO_BUNDLE (its moment)
    s.assert((await entries(s, `activityId=${ID.A310}`)).length === 0, 'A310 has no quantity entry yet');
    const ref = b.ref('PROG-barePercent');
    return probe(s, 'qty.barePercent', 'site', 'POST', `${A310}/progress`, { status: 'submitted', source: 'manual', method: 'quantity', pctComplete: 50, notes: `${ref} A310 50% with no quantity` }, WP2.quantitiesA310.barePercent.value, {
      find: async (s2) => atMostOne(await submissions(s2), (x) => String(x.notes || '').includes(ref), `submission ${ref}`),
    });
  }, { needs: ['progress.methods'] });

  await b.step('qty.typed450', async (s) => {
    // answers WP2.quantitiesA310.typed450: 450 of 900 m2 = 50%, one approved entry minted (source 'submission'), EV(A310) 67,500.00
    const id = await claim(s, 'typed450', { method: 'quantity', quantityComplete: 450, quantityUnit: 'm2', notes: 'A310 typed 450 m2' }, 'approved');
    const minted = await entries(s, `activityId=${ID.A310}&status=approved`);
    s.assert(minted.length === WP2.quantitiesA310.typed450.entriesCreated.value, `${WP2.quantitiesA310.typed450.entriesCreated.value} approved entry minted (got ${minted.length})`);
    const one = exactlyOne(minted, (e) => e.source === 'submission' && Number(e.quantity) === 450, 'the entry minted by the typed 450');
    s.assert(await officialPct(s) === WP2.quantitiesA310.typed450.pct.value, `A310 official ${WP2.quantitiesA310.typed450.pct.value}%`);
    const ev = await evA310(s);
    assertEv(s, ev, WP2.quantitiesA310.typed450.evA310, 'WP2.quantitiesA310.typed450.evA310');
    return { submissionId: id, entryId: one.id, evA310: ev };
  }, { needs: ['qty.barePercent'] });

  const bundle90 = await b.step('qty.bundle90', async (s) => {
    const made = await entry(s, 'A310-90', 90, b.date(-6), 'submitted');
    const id = await claim(s, 'bundle90', { entryIds: [made.entry?.id ?? made.id], notes: 'A310 90 m2 bundled' }, 'approved');
    // answers WP2.quantitiesA310.bundle90: installed 540, 60%, EV(A310) 81,000.00
    s.assert(await installedOn(s) === WP2.quantitiesA310.bundle90.installed.value, `installed ${WP2.quantitiesA310.bundle90.installed.value} m2`);
    s.assert(await officialPct(s) === WP2.quantitiesA310.bundle90.pct.value, `A310 official ${WP2.quantitiesA310.bundle90.pct.value}%`);
    const ev = await evA310(s);
    assertEv(s, ev, WP2.quantitiesA310.bundle90.evA310, 'WP2.quantitiesA310.bundle90.evA310');
    return { entryId: made.entry?.id ?? made.id, submissionId: id, evA310: ev };
  }, { needs: ['qty.typed450'] });

  await b.step('qty.replay', async (s) => {
    // answers WP2.quantitiesA310.replay: the same clientRequestId answers replayed:true with the stored entry, nothing created
    const clientRequestId = b.ref('QTY-A310-90');
    const original = b.state.records['entry.A310-90'];
    await s.act('qty.replay', 'site', 'POST', `${P()}/quantity-progress`, {
      activityId: ID.A310, boqItemId: s003, allocationId: alloc310(), quantity: 90, date: original.data?.entry?.date?.slice(0, 10) || b.date(-6), status: 'submitted', note: `${clientRequestId} 90 m2`, clientRequestId,
    }, {
      fields: { 'entry.id': bundle90.entryId, 'entry.replayed': WP2.quantitiesA310.replay.replayed.value, created: 0, replayed: 1 },
      // A replay changes nothing: an interrupted one is read live (exactly the one entry carries the
      // clientRequestId, else the build stops) and asked again, which is the same replay.
      verify: async (s2) => {
        const same = (await entries(s2, `activityId=${ID.A310}`)).filter((e) => e.clientRequestId === clientRequestId);
        if (same.length !== 1 || same[0].id !== bundle90.entryId) throw new lib.BuildError(`qty.replay: ${same.length} entries carry ${clientRequestId} (${same.map((e) => e.id).join(', ')}); the replay must leave exactly ${bundle90.entryId}`);
        return false;
      },
    });
    return { entryId: bundle90.entryId, replayed: true };
  }, { needs: ['qty.bundle90'] });

  const dailyLog = await b.step('qty.dailylog', async (s) => {
    // answers WP2.quantitiesA310.dailyLog: a daily log quantities row of 30 m2 mints exactly one submitted entry
    const day = b.date(-4);
    const ref = b.ref('DL-A310-30');
    const logOf = (s2) => s2.get('site', `${P()}/daily-logs/${day}`);
    const log = await s.create('dailylog.row', 'site', `${P()}/daily-logs/${day}/entries/quantities`, {
      activityId: ID.A310, boqItemId: s003, allocationId: alloc310(), quantity: 30, unitCode: 'm2', notes: `${ref} blockwork laid today`, clientRequestId: ref,
    }, {
      idOf: (d) => d?.id ?? null,
      fields: { date: is.day(day), 'sections.quantities': (v) => (Array.isArray(v) && v.filter((row) => String(row.notes || '').includes(ref) && Number(row.quantity) === 30).length === 1) || 'exactly one 30 m2 quantities row carrying the ref' },
      get: () => `${P()}/daily-logs/${day}`,
      // G4 (R2-C): only a 404 reads as "nothing logged"; any other answer stops the build (a 5xx
      // already fails in send), never swallowed into a re-send.
      find: async (s2) => {
        const res = await s2.send('site', 'GET', `${P()}/daily-logs/${day}`);
        if (res.status === 404) return null;
        if (res.status !== 200) throw new lib.BuildError(`dailylog.row find: GET daily-logs/${day} answered ${lib.said(res)}; only 200 (read the log) or 404 (nothing logged) tells whether the row was made`);
        const l = res.body?.data;
        return l && (l.sections?.quantities || []).some((row) => String(row.notes || '').includes(ref)) ? l : null;
      },
    });
    await s.act('dailylog.submit', 'site', 'POST', `${P()}/daily-logs/${day}/submit`, {}, {
      fields: { id: log.id, status: 'submitted' },
      verify: async (s2) => ['submitted', 'approved'].includes((await logOf(s2))?.status),
    });
    const minted = await entries(s, `dailyLogId=${log.id}`);
    s.assert(minted.length === WP2.quantitiesA310.dailyLog.entries.value, `exactly ${WP2.quantitiesA310.dailyLog.entries.value} entry minted from the log (got ${minted.length})`);
    const one = exactlyOne(minted, (e) => e.source === 'daily_log' && e.activityId === ID.A310, 'the entry minted from the log');
    s.expectFields(one, { quantity: is.number(30), status: 'submitted', source: 'daily_log', boqItemId: s003, activityId: ID.A310 }, 'the minted entry');
    return { day, logId: log.id, entryId: one.id };
  }, { needs: ['qty.replay'] });

  await b.step('qty.dailylog570', async (s) => {
    const id = await claim(s, 'dailylog570', { entryIds: [dailyLog.entryId], notes: 'A310 daily log 30 m2 bundled' }, 'approved');
    // answers WP2.quantitiesA310.dailyLog: installed 570, 63.333% (3 dp), EV(A310) 85,500.00
    s.assert(await installedOn(s) === WP2.quantitiesA310.dailyLog.installed.value, `installed ${WP2.quantitiesA310.dailyLog.installed.value} m2`);
    const pct = await officialPct(s);
    s.assert(Math.abs(pct - WP2.quantitiesA310.dailyLog.pct.value) < 0.0005, `A310 official ${WP2.quantitiesA310.dailyLog.pct.value.toFixed(3)}% (got ${pct})`);
    const ev = await evA310(s);
    assertEv(s, ev, WP2.quantitiesA310.dailyLog.evA310, 'WP2.quantitiesA310.dailyLog.evA310');
    return { submissionId: id, evA310: ev };
  }, { needs: ['qty.dailylog'] });

  await b.step('qty.rejected10', async (s) => {
    // answers WP2.quantitiesA310.rejectedState: a further 10 m2 entry bundled, the QS rejects it; nothing official moves
    const made = await entry(s, 'A310-10', 10, b.date(-3), 'submitted');
    const entryId = made.entry?.id ?? made.id;
    const id = await claim(s, 'rejected10', { entryIds: [entryId], notes: 'A310 10 m2 bundled, disputed' }, 'rejected');
    const e = await s.get('site', `${P()}/quantity-progress/${entryId}`);
    s.expectFields(e, { status: WP2.quantitiesA310.rejectedState.entryStatus.value }, 'the rejected entry');
    s.assert(await installedOn(s) === WP2.quantitiesA310.dailyLog.installed.value, 'installed stays 570 m2');
    return { entryId, submissionId: id };
  }, { needs: ['qty.dailylog570'] });

  await b.step('qty.pending', async (s) => {
    // the draft and submitted states, left pending (plan §3.2 "quantity entries in every state")
    const draft = await entry(s, 'A310-draft', 5, b.date(-1), 'draft');
    const submitted = await entry(s, 'A310-submitted', 5, b.date(-1), 'submitted');
    const all = await entries(s, `activityId=${ID.A310}`);
    const states = [...new Set(all.map((e) => e.status))].sort();
    s.assert(['approved', 'draft', 'rejected', 'submitted'].every((st) => states.includes(st)), `A310's entries stand in every state (got ${states.join(', ')})`);
    s.assert(await installedOn(s) === WP2.quantitiesA310.dailyLog.installed.value, 'installed stays 570 m2 (approved entries only)');
    return { draft: draft.entry?.id ?? draft.id, submitted: submitted.entry?.id ?? submitted.id, states };
  }, { needs: ['qty.rejected10'] });

  // ── 14. the other five quantity figures on S-003 (answers WP2.quantityView) ──
  // committed 900: an executed subcontract with an SOV line of 900 m2 on S-003 (QS raises, PM approves and executes)
  await b.step('commitment', async (s) => {
    const vendorName = b.name('Blockwork subcontractor');
    const vendorSearch = `/companies?limit=100&search=${encodeURIComponent(vendorName)}`;
    const vendor = await s.create('vendor', 'pm', '/companies', { name: vendorName, type: 'subcontractor', status: 'active' }, {
      fields: { name: vendorName, status: 'active' },
      get: () => vendorSearch,
      adopt: true,
      find: async (s2) => atMostOne(listOf(await s2.get('pm', vendorSearch)), (c) => c.name === vendorName, `vendor ${vendorName}`),
    });
    const title = b.name('Blockwork subcontract S-003');
    const list = `${P()}/commitments`;
    const c = await s.create('commitment.create', 'qs', list, {
      type: 'subcontract', title, description: `${b.ref('SC-1')} supply and lay 200 mm blockwork`, vendorCompanyId: vendor.id, retentionRate: RETENTION, currency: 'EGP',
      startDate: '2026-03-01', endDate: '2026-06-30',
      lines: [{ description: 'Blockwork walls 200 mm (S-003)', boqItemId: s003, activityId: ID.A310, unit: 'm2', qty: WP2.quantityView.committed.value, rate: 130, amount: WP2.quantityView.committed.value * 130 }],
    }, {
      fields: { title, status: 'draft', vendorCompanyId: vendor.id },
      find: async (s2) => atMostOne(listOf(await s2.get('qs', list)), (x) => x.title === title, `commitment ${title}`),
    });
    const C = `${list}/${c.id}`;
    const statusOf = async (s2) => (await s2.get('qs', C))?.status;
    const order = ['draft', 'pending', 'approved', 'executed'];
    const reached = (st) => async (s2) => order.indexOf(await statusOf(s2)) >= order.indexOf(st);
    await s.act('commitment.submit', 'qs', 'POST', `${C}/submit`, {}, { fields: { id: c.id, status: 'pending' }, verify: reached('pending') });
    await s.act('commitment.approve', 'pm', 'POST', `${C}/approve`, {}, { fields: { id: c.id, status: 'approved' }, verify: reached('approved') });
    await s.upload('commitment.execute', 'pm', `${C}/execute`, { filename: b.file('SC-1-signed.pdf'), body: signedPdf(b.ref('SC-1')), contentType: 'application/pdf' }, {
      expect: 200,
      form: { note: b.name('countersigned by both parties') },
      fields: { id: c.id, status: 'executed' },
      get: () => C,
      find: async (s2) => ((await statusOf(s2)) === 'executed' ? s2.get('qs', C) : null),
    });
    const read = await s.get('qs', C);
    s.expectFields(read, { status: 'executed' }, 'the executed subcontract');
    const line = exactlyOne(read.lines || [], (l) => l.boqItemId === s003, 'the subcontract line on S-003');
    s.assert(Number(line.qty) === WP2.quantityView.committed.value, `the S-003 line commits ${WP2.quantityView.committed.value} m2 (got ${line.qty})`);
    return { vendorId: vendor.id, commitmentId: c.id };
  }, { needs: ['qty.pending'] });

  // received 1,000, issued 600, returned 50: one project store, one item in m2 (the warehouse keeper)
  await b.step('stock', async (s) => {
    // A warehouse code and a SKU are unique in the organisation, whatever the project or status, so they
    // carry this project's token: the same on every resume, never the code of an earlier (archived) build.
    const token = b.projectId.slice(0, 8).toUpperCase();
    const whCode = `087SCH-${token}`;
    const whName = b.name('Site store');
    const whList = `/inventory/warehouses?projectId=${b.projectId}`;
    const wh = await s.create('stock.warehouse', 'warehouse', '/inventory/warehouses', { code: whCode, name: whName, projectId: b.projectId, notes: b.ref('STORE') }, {
      fields: { code: whCode, name: whName },
      get: () => whList,
      adopt: true,
      find: async (s2) => atMostOne(listOf(await s2.get('warehouse', whList)), (w) => w.code === whCode, `warehouse ${whCode}`),
    });
    const sku = b.ref(`BLK200-${token}`);
    const item = await s.create('stock.item', 'warehouse', '/inventory/items', { sku, name: b.name('Blockwork 200 mm'), unit: 'm2', projectId: b.projectId, unitCost: 20 }, {
      fields: { sku, unit: 'm2' },
      get: (id) => `/inventory/items/${id}`,
      adopt: true,
      find: async (s2) => atMostOne(listOf(await s2.get('warehouse', `/inventory/items?projectId=${b.projectId}&search=${encodeURIComponent(sku)}`)), (i) => i.sku === sku, `stock item ${sku}`),
    });
    const txList = `/inventory/stock/transactions?itemId=${item.id}`;
    const move = (key, route, type, quantity, date, extra = {}) => {
      const reference = b.ref(key);
      // A receipt answers the movement; an issue answers { movements: [...], costPosted }: the one carrying the reference.
      const movementOf = (d) => (Array.isArray(d?.movements) ? atMostOne(d.movements, (m) => m.reference === reference, `the ${type} carrying ${reference}`) : d);
      return s.create(`stock.${key}`, 'warehouse', `/inventory/stock/${route}`, {
        itemId: item.id, warehouseId: wh.id, quantity, projectId: b.projectId, activityId: ID.A310, boqItemId: s003, reference, occurredAt: b.past(date), notes: `${reference} ${route} ${quantity} m2`, ...extra,
      }, {
        idOf: (d) => movementOf(d)?.id ?? null,
        fields: {
          movement: (_, d) => {
            const m = movementOf(d);
            return (m?.type === type && Math.abs(Number(m.quantity)) === quantity && m.boqItemId === s003 && m.activityId === ID.A310 && m.reference === reference) || `a ${type} of ${quantity} m2 on S-003 / A310 carrying ${reference}`;
          },
        },
        get: () => txList,
        find: async (s2) => atMostOne(listOf(await s2.get('warehouse', txList)), (t) => t.reference === reference, `stock movement ${reference}`),
      });
    };
    // answers WP2.quantityView.received 1,000 and issued 550 = 600 issued - 50 returned
    await move('GRN-1', 'receive', 'receipt', WP2.quantityView.received.value, b.date(-8), { unitCost: 20 });
    await move('ISS-1', 'issue', 'issue', 600, b.date(-7));
    await move('RET-1', 'return', 'return', 600 - WP2.quantityView.issued.value, b.date(-5));
    return { warehouseId: wh.id, itemId: item.id };
  }, { needs: ['qty.pending'] });

  // certified 500 and paid 250: an IPC with S-003/A310 at 500 m2 (QS), certified (PM), invoiced and half paid (finance)
  const ipcPeriod = b.today.slice(0, 7);
  const IPC = `${P()}/ipc/${ipcPeriod}`;
  const invoiceNumber = b.ref(`INV-${ipcPeriod}`);
  const paymentReference = b.ref(`PMT-${ipcPeriod}`);
  const invoicesOf = (c) => c?.invoices || [];
  /** The certificate's payments (its own list and its invoices'), one per id. */
  const paymentsOf = (c) => [...new Map([...(c?.payments || []), ...invoicesOf(c).flatMap((i) => i.payments || [])].map((p) => [p.id, p])).values()];
  await b.step('ipc', async (s) => {
    const read = (s2) => s2.get('qs', IPC);
    const exists = async (s2) => atMostOne(listOf(await s2.get('qs', `${P()}/ipc`)), (c) => c.period === ipcPeriod, `IPC ${ipcPeriod}`);
    await s.create('ipc.period', 'qs', `${P()}/ipc`, { period: ipcPeriod, label: b.name(`IPC ${ipcPeriod}`) }, {
      named: false, // a period is named by its month; the project carries the code
      fields: { period: ipcPeriod },
      get: () => IPC,
      idOf: (d) => d?.id ?? null,
      adopt: true,
      find: exists,
    });
    const cert = await read(s);
    const items = listOf(cert?.items || cert);
    const line = exactlyOne(items, (it) => it.boqItemId === s003 && (it.allocation?.activityId ?? it.activityId) === ID.A310, 'the certificate item S-003 / A310');
    const order = ['draft', 'submitted', 'certified', 'invoiced', 'partially_paid', 'paid'];
    const reached = (st) => async (s2) => order.indexOf((await read(s2))?.status) >= order.indexOf(st);
    await s.act('ipc.item', 'qs', 'PATCH', `${IPC}/items/${line.id}`, { qty: WP2.quantityView.certified.value, rate: ROW['S-003'].rate }, {
      fields: { id: line.id, qty: is.number(WP2.quantityView.certified.value) },
      verify: async (s2) => Number(listOf((await read(s2))?.items).find((it) => it.id === line.id)?.qty) === WP2.quantityView.certified.value,
    });
    await s.act('ipc.submit', 'qs', 'POST', `${IPC}/submit`, {}, { fields: { status: 'submitted' }, verify: reached('submitted') });
    await s.act('ipc.certify', 'pm', 'POST', `${IPC}/certify`, { comment: b.name(`IPC ${ipcPeriod} certified`) }, { fields: { status: 'certified' }, verify: reached('certified') });
    const certified = await read(s);
    const gross = cents(ROW['S-003'].rate * WP2.quantityView.certified.value);
    const retention = Math.round((gross * RETENTION) / 100);
    s.expectFields(certified, {
      status: 'certified',
      totalCert: is.cents(gross / 100), totalRet: is.cents(retention / 100), netPayable: is.cents((gross - retention) / 100),
      // EV at certification is A310's alone, 135,000.00 x 570 / 900 (answers WP2.quantitiesA310.dailyLog.evA310)
      earnedValueAtCertification: is.cents(WP2.quantitiesA310.dailyLog.evA310.value / 100),
      overCertificationAmount: is.cents(0),
    }, `the certificate (500 m2 x ${ROW['S-003'].rate} = ${lib.formatCents(gross)}, ${RETENTION}% retained)`);
    await s.create('ipc.invoice', 'finance', `${IPC}/invoice/issue`, { invoiceNumber, invoiceDate: b.today, dueDate: b.date(30, { future: true }) }, {
      idOf: (d) => d?.id ?? null,
      fields: { invoiceNumber, status: 'issued', grossAmount: is.cents(gross / 100), retentionHeld: is.cents(retention / 100), netAmount: is.cents((gross - retention) / 100) },
      get: null, // read back live by this step's verify (the certificate carries its invoices)
      find: async (s2) => atMostOne(invoicesOf(await read(s2)), (inv) => inv.invoiceNumber === invoiceNumber, `invoice ${invoiceNumber}`),
    });
    const net = cents(certified.netPayable);
    const amount = (net * PAID_SHARE) / 100;
    s.assert(Number.isInteger(net * PAID_SHARE), `half the net payable is a whole number of cents (${net} cents)`);
    await s.create('ipc.payment', 'finance', `${IPC}/payments`, { amount, paymentReference, paymentDate: b.today, paymentMethod: 'bank_transfer', notes: b.name('half the net payable') }, {
      idOf: (d) => d?.payment?.id ?? null,
      fields: { 'payment.amount': is.cents(amount), 'payment.paymentReference': paymentReference, 'invoice.status': 'partially_paid', 'certificate.paymentStatus': 'partially_paid' },
      get: null, // read back live by this step's verify (the certificate carries its payments)
      // R1-22: an interrupted payment is adopted by its own record, found by its reference on the certificate.
      find: async (s2) => {
        const cert2 = await read(s2);
        const payment = atMostOne(paymentsOf(cert2), (p) => p.paymentReference === paymentReference, `payment ${paymentReference}`);
        if (!payment) return null;
        const invoice = exactlyOne(invoicesOf(cert2), (inv) => inv.invoiceNumber === invoiceNumber, `invoice ${invoiceNumber}`);
        return { payment, invoice, certificate: cert2 };
      },
    });
    const paid = await read(s);
    s.expectFields(paid, { amountPaid: is.cents(amount), paymentStatus: 'partially_paid', balanceDue: is.cents((net - cents(amount)) / 100) }, 'the certificate after the payment');
    return { period: ipcPeriod, itemId: line.id, grossCents: gross, netCents: net, paidCents: cents(amount) };
  }, {
    needs: ['qty.pending', 'project.terms'],
    // The invoice and the payment have no read of their own: the certificate is read live and must carry both, as recorded.
    verify: async (s, out) => {
      const cert = await s.get('qs', IPC);
      const invoice = invoicesOf(cert).filter((inv) => inv.invoiceNumber === invoiceNumber);
      if (invoice.length !== 1 || invoice[0].id !== b.id('ipc.invoice')) return `invoice ${invoiceNumber} reads ${invoice.map((i) => i.id).join(', ') || 'nowhere'}, recorded ${b.id('ipc.invoice')}`;
      const payment = paymentsOf(cert).filter((p) => p.paymentReference === paymentReference);
      if (payment.length !== 1 || payment[0].id !== b.id('ipc.payment')) return `payment ${paymentReference} reads ${payment.map((p) => p.id).join(', ') || 'nowhere'}, recorded ${b.id('ipc.payment')}`;
      if (cents(payment[0].amount) !== out.paidCents) return `payment ${paymentReference} is ${payment[0].amount}, recorded ${lib.formatCents(out.paidCents)}`;
      return true;
    },
  });

  await b.step('quantities.S-003', async (s) => {
    // answers WP2.quantityView: installed 570, committed 900, received 1,000, issued 550 (600 - 50), certified 500, paid 250;
    // certified > installed is false. Every figure non-zero (plan §3.2).
    const view = await s.get('qs', `${P()}/boq/items/${s003}/quantities`);
    const q = WP2.quantityView;
    s.expectFields(view, {
      'figures.installed.value': is.number(q.installed.value),
      'figures.committed.value': is.number(q.committed.value),
      'figures.received.value': is.number(q.received.value),
      'figures.issued.value': is.number(q.issued.value),
      'figures.certified.value': is.number(q.certified.value),
      'figures.paid.value': is.number(q.paid.value),
      'comparisons.certifiedOverInstalled.flag': q.certifiedAboveInstalled.value,
    }, "S-003's six quantity figures");
    return Object.fromEntries(['installed', 'committed', 'received', 'issued', 'certified', 'paid'].map((k) => [k, view.figures[k].value]));
  }, { needs: ['commitment', 'stock', 'ipc'] });

  // ── 15. the progress file (answers inputs.progressFile; WP2.importProgress) ──
  await b.step('progress.file', async (s) => {
    // The generated progress XER (A110 70, A130 50, A310 30), kept beside the build state so WP-2's
    // import proof uses these exact bytes, and dry-run against the activated programme as the site
    // engineer: nothing is written (the import itself is WP-2's, after T1; answers WP2.importProgress).
    const file = files.progressXer(IN.progressFile, { filename: b.file('progress.xer') });
    const dir = path.join(lib.STATE_DIR, 'files', b.code);
    fs.mkdirSync(dir, { recursive: true });
    const saved = files.save(file, dir);
    const before = (await submissions(s, `${P()}/activities/${ID.A110}`)).length;
    const res = await s.send('site', 'POST', `${P()}/import/progress?dryRun=true`, undefined, { file, form: { format: 'xer' } });
    s.assert(res.status === 200, `the dry run answers 200 (got ${lib.said(res)})`, res.body?.error);
    const rows = listOf(res.body?.data?.rows || res.body?.data);
    const a310 = exactlyOne(rows, (r) => r.p6ActivityId === 'A310', 'the A310 row of the dry run');
    // answers WP2.importProgress.site.A310row: A310 is measured by quantity, so its percent row is refused PROGRESS_METHOD_MISMATCH
    s.assert(String(a310.reason?.code || a310.code || '') === 'PROGRESS_METHOD_MISMATCH', `the A310 row is refused PROGRESS_METHOD_MISMATCH (got ${JSON.stringify(a310)?.slice(0, 300)})`);
    s.assert((await submissions(s, `${P()}/activities/${ID.A110}`)).length === before, 'the dry run wrote no submission');
    return { path: saved, sha256: file.sha256, bytes: file.bytes, rows: rows.map((r) => [r.p6ActivityId, r.status]) };
  }, {
    needs: ['activate.F1', 'progress.methods'],
    verify: async (s, out) => {
      const file = files.progressXer(IN.progressFile, { filename: b.file('progress.xer') });
      return (fs.existsSync(out.path) && file.sha256 === out.sha256) || `the progress file ${out.path} is missing or no longer the generated bytes`;
    },
  });

  // ── 16. last: the tail activity T900 ending in 2027 (answers WP1.tail), after the CPM and baseline steps ──
  await b.step('tail', async (s) => {
    const ids = b.out('rollback.F1b').ids;
    const t900 = await s.create('activity.T900', 'planner', `${P()}/activities`, {
      name: TAIL.name, activityCode: TAIL.code, wbsCode: IN.wbs.ARC, duration: TAIL.durationDays, isMilestone: false, sortOrder: CODES.length,
      engineerIds: [hand.site], dependencies: [{ predecessorId: ids[TAIL.predecessor], relationshipType: TAIL.relationship, lagDays: TAIL.lagDays }],
    }, {
      named: false,
      fields: { activityCode: TAIL.code, duration: is.number(TAIL.durationDays) },
      get: (id) => `${P()}/activities/${id}`,
      find: async (s2) => atMostOne(await activities(s2), (a) => a.activityCode === TAIL.code, TAIL.code),
    });
    const rows = await activities(s);
    const T = WP1.tail;
    const tail = activityOf(rows, TAIL.code, 'with the tail');
    s.expectFields(tail, { earlyStart: is.number(T.ES.value), earlyFinish: is.number(T.EF.value), totalFloat: is.number(T.TF.value) }, 'T900');
    s.assert(String(tail.earlyFinishDate || tail.endDate || '').slice(0, 10) === T.earlyFinishDate.value, `T900 finishes ${T.earlyFinishDate.value}, in 2027 (got ${tail.earlyFinishDate} / ${tail.endDate})`);
    s.expectFields(activityOf(rows, 'M900', 'with the tail'), { totalFloat: is.number(T.M900_TF.value) }, 'M900 with the tail');
    s.expectFields(activityOf(rows, 'A140', 'with the tail'), { totalFloat: is.number(T.A140_TF.value) }, 'A140 with the tail');
    s.expectFields(activityOf(rows, 'A300', 'with the tail'), { totalFloat: is.number(T.A300_TF.value) }, 'A300 with the tail');
    s.assert(rows.filter((a) => num(a.totalFloat) !== null && num(a.totalFloat) <= 0).length === T.criticalCount.value, `${T.criticalCount.value} critical with the tail`);
    // answers WP1.tail.baseline: added after the lock, so no baseline until a new one is locked
    s.assert(!tail.baselineStartDate && !tail.baselineFinishDate, 'T900 has no baseline until a new one is locked');
    return { id: t900.id };
  }, { needs: ['baseline', 'progress.file'] });

  // ── 17. §3.2's assignment rule at the end, live: the site engineer on every active activity except A330 (R1-6) ──
  const assignmentsHold = async (s) => {
    const rows = await activities(s);
    if (rows.length !== CODES.length + 1) return `${rows.length} active activities, not the ${CODES.length} of F1 and T900`;
    const out = {};
    for (const a of rows) {
      const code = a.activityCode || (a.p6ActivityId === REBUILT ? REBUILT : null);
      if (!code) return `active activity ${a.id} carries no code`;
      const holds = assignmentHolds(a, code);
      if (holds !== true) return holds;
      out[code] = siteHolds(code) ? 'site' : 'planner';
    }
    return out;
  };
  await b.step('assignments', async (s) => {
    const out = await assignmentsHold(s);
    s.assert(typeof out === 'object', typeof out === 'string' ? out : 'the assignments hold');
    return out;
  }, {
    needs: ['tail'],
    verify: async (s) => {
      const out = await assignmentsHold(s);
      return typeof out === 'object' || out;
    },
  });
});
