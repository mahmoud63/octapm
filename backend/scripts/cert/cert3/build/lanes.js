'use strict';

/**
 * CERT-3 deep population: the lane steps that 052-SCH-EV, 052-COM, 052-FLD and
 * 006-LITE share (plan §3.2 "D2, company 052" and "D3, company 006"). Each
 * function adds named steps to a build `b` (lib.js); every creation is
 * asserted, every record carries the build's code, and every step resumes
 * without making anything twice.
 *
 * The figures come from the answer book (answers/schedule.js inputs.ev087 =
 * WP3.setup: the 087-EV BOQ E-001..E-005, its five approved allocations, its
 * loadings and direct costs), so a lane cannot drift from what its proofs
 * assert. A step that sets up a figure a later proof checks names its
 * answer-book key in a comment.
 *
 * Resumable (adjudication G4): every create, upload and act that can be cut
 * off has a find or a verify that reads the live record back; a record made
 * with no read-back route sits in a step whose verify re-reads it live. Rows
 * are picked by identity (code, id, notes), never by position (G6), and every
 * find by identity asserts that at most one row matches (atMostOne; a record
 * found by its ref carries that ref as its first word: taggedWith; R2-D).
 *
 * The debug harness that runs a lane body under another code lives outside
 * build/ (adjudication G9): C:\Temp\octapm-cert\scratch\build-debug\_debug-lane.js.
 */

const lib = require('./lib');

const { is } = lib;
const SCHEDULE = lib.answers.schedule;
const EV = SCHEDULE.inputs.ev087;
const CODES = SCHEDULE.inputs.F1.tasks.map((t) => t[0]);

/** The rows of a list answer: an array, or its items / allocations / rows / data. */
const listOf = (data) => {
  if (Array.isArray(data)) return data;
  for (const key of ['items', 'allocations', 'rows', 'orders', 'records', 'data']) if (Array.isArray(data?.[key])) return data[key];
  return [];
};
const cents = (v) => lib.toCents(v);

/**
 * Identity, not position (adjudication G6; builders' adjudication round 2, R2-D): the one row of
 * `rows` that `pred` names, or null when none does. Two or more is a duplicate: a BuildError
 * ("resolve it by hand"), never a pick. Every adoption and read-back find of the lanes and of the
 * builders that share them selects through this.
 */
const atMostOne = (s, rows, pred, what) => {
  const hits = (rows || []).filter(pred);
  s.assert(hits.length <= 1, `${what}: at most one record may match by identity, ${hits.length} do (a duplicate: resolve it by hand)`, hits.map((row) => row?.id ?? null));
  return hits.length === 1 ? hits[0] : null;
};
/**
 * A text tagged with `ref`: its first word IS the ref. A ref that merely begins another one
 * ('...-PROG-wp2.T3' inside '...-PROG-wp2.T3-draft') does not match, so a find by ref names one record.
 */
const taggedWith = (text, ref) => String(text || '').trim().split(/\s+/)[0] === ref;

// ── activities ──────────────────────────────────────────────────────────────
/**
 * code -> activity, as the planner (or the PM) reads them. A lane activates F1
 * on a fresh project (nothing is mapped), and a file's own code is staged as
 * the activity's p6ActivityId (schedule.service.js activityDataFromStaged: a
 * file states no activityCode), so the P6 id is the code's fallback.
 */
const codeOf = (a) => a.activityCode || a.p6ActivityId || null;
/** code -> the one active activity carrying it (R2-D: two active activities with one code is a BuildError, never the last one read). */
const activitiesByCode = async (s, b, persona) => {
  const rows = listOf(await s.get(persona, `${b.P}/activities`)).filter((a) => a.isActive !== false);
  const byCode = new Map();
  for (const a of rows) {
    const code = codeOf(a);
    s.assert(!byCode.has(code), `activity code ${code} names one active activity on ${b.code}'s project (G6), not ${byCode.get(code)?.id} and ${a.id}`);
    byCode.set(code, a);
  }
  return byCode;
};

// ── the F1 programme: imported, reviewed, approved, activated ───────────────
/**
 * F1 (answers inputs.F1; files.F1) through import, review, approval and
 * activation. `who`: { importer, submitter, approver, activator } personas.
 * Returns { revisionId, activities: { code: id } } from the activation step.
 * HR-S2 (milestones start = end) is fixed at f599e67 (WP1-MS-1): the approval
 * and the baseline must answer 200, and any other answer fails the build.
 */
async function scheduleF1(b, { importer, submitter, approver, activator, model = null }) {
  const imported = await b.step('schedule.import.F1', async (s) => {
    // `model` is for the debug harness only (scratch\build-debug\_debug-lane.js); a plan build always imports the answer book's F1.
    const file = lib.files.xer(model || lib.files.F1(), { filename: b.file('F1.xer') });
    const data = await s.upload('schedule.import.F1', importer, `${b.P}/import/xer`, file, {
      fields: { revisionId: is.present },
      idOf: (d) => d?.revisionId ?? null,
      get: (id) => `${b.P}/schedule/revisions/${id}`,
      // R3-1: the unique key of an interrupted import is this build's own project, into which the lane
      // imports exactly one schedule file (the revision serializer carries no file name, and every import
      // is labelled 'XER Import'). A revision on it is the interrupted import, adopted; none means the
      // import made no revision; more than one is never guessed at.
      find: async (s2) => {
        const revs = listOf(await s2.get(importer, `${b.P}/schedule/revisions`));
        if (revs.length > 1) throw new lib.BuildError(`schedule.import.F1: ${revs.length} revisions on ${b.code}'s own project (${b.projectId}), where the lane imports exactly one; resolve by hand`, { revisions: revs.map((r) => [r.id, r.source, r.status, r.createdAt]) });
        if (!revs.length) return null;
        const [rev] = revs;
        s2.assert(rev.source === 'xer' && Number(rev.activityCount) === CODES.length, `the one revision on ${b.code}'s project is the F1 XER import (${CODES.length} activities)`, { id: rev.id, source: rev.source, activityCount: rev.activityCount });
        return { revisionId: rev.id, ...rev };
      },
    });
    // A rerun of this step after its upload was recorded gets the revision as read back (its id), not the
    // import's answer (R3-7, as 087-imp.js stage()): the revision id then comes from the record.
    const rec = b.state.records['schedule.import.F1'];
    const revisionId = data.revisionId ?? rec?.id ?? null;
    s.assert(typeof revisionId === 'string' && revisionId.length > 0, `the F1 import names its revision (answer ${JSON.stringify(data?.revisionId ?? null)}, record ${JSON.stringify(rec?.id ?? null)})`);
    const rev = await s.get(importer, `${b.P}/schedule/revisions/${revisionId}`);
    s.expectFields(rev, { status: 'draft' }, 'the imported revision');
    return { revisionId };
  });

  const R = `${b.P}/schedule/revisions/${imported.revisionId}`;
  const revisionIs = (status) => async (s2) => (await s2.get(importer, R))?.status === status;

  await b.step('schedule.submit.F1', async (s) => {
    await s.act('schedule.submit.F1', submitter, 'POST', `${R}/submit-review`, { comment: `${b.name('F1 for review')}` }, {
      fields: { status: 'under_review' },
      verify: async (s2) => ['under_review', 'approved', 'baselined'].includes((await s2.get(importer, R))?.status),
    });
    return { status: 'under_review' };
  }, { needs: ['schedule.import.F1'] });

  await b.step('schedule.approve.F1', async (s) => {
    // HR-S2 is fixed (WP1-MS-1, f599e67): M900's start = end passes the readiness date check, so the
    // approval answers 200 and any other answer fails the build.
    await s.act('schedule.approve.F1', approver, 'POST', `${R}/approve`, { comment: b.name('F1 approved') }, {
      fields: { status: 'approved' },
      verify: async (s2) => ['approved', 'baselined'].includes((await s2.get(importer, R))?.status),
    });
    return { status: 'approved' };
  }, { needs: ['schedule.submit.F1'] });

  const activated = await b.step('schedule.activate.F1', async (s) => {
    if (b.state.records['schedule.activate.F1']?.status !== 'done') {
      const mapping = await s.get(activator, `${R}/mapping`);
      s.assert(mapping?.counts?.existing === 0, 'the project has no activities before F1 is activated (a fresh project)', mapping?.counts);
      s.assert(mapping?.counts?.staged === CODES.length, `F1 stages ${CODES.length} activities`, mapping?.counts);
    }
    await s.act('schedule.activate.F1', activator, 'POST', `${R}/activate`, { mappings: [], unmappedRemovals: [], comment: b.name('F1 activated') }, {
      fields: { '$status': 200 },
      verify: async (s2) => Boolean((await s2.get(importer, R))?.isActive),
    });
    const rev = await s.get(importer, R);
    s.expectFields(rev, { isActive: true, status: 'approved' }, 'the activated revision');
    const acts = await activitiesByCode(s, b, activator);
    const ids = {};
    for (const code of CODES) {
      s.assert(acts.has(code), `activity ${code} exists after the activation`, [...acts.keys()]);
      ids[code] = acts.get(code).id;
    }
    s.assert(acts.size === CODES.length, `exactly ${CODES.length} active activities (found ${acts.size})`);
    const nullCodes = [...acts.values()].filter((a) => !a.activityCode).length;
    if (nullCodes) s.note(`activation on a fresh project left activityCode null on ${nullCodes} of ${acts.size} activities, the file's code being staged as p6ActivityId (schedule.service.js activityDataFromStaged); the lanes key activities by activityCode, else p6ActivityId`);
    return { revisionId: imported.revisionId, activities: ids, activityCodeNull: nullCodes };
  }, {
    needs: ['schedule.approve.F1'],
    verify: async (s, out) => {
      const acts = await activitiesByCode(s, b, activator);
      for (const [code, id] of Object.entries(out.activities)) if (acts.get(code)?.id !== id) return `activity ${code} is no longer ${id}`;
      return true;
    },
  });
  return activated;
}

/**
 * WP1 CPM figures the activation must already give (answers WP1.T1 / D2.WP1):
 * 12 critical, A140 TF 47, A300 TF 20, M900 EF 81. Read from GET /schedule.
 */
async function assertF1Cpm(b, persona) {
  return b.step('schedule.cpm.F1', async (s) => {
    const schedule = await s.get(persona, `${b.P}/schedule`);
    const rows = listOf(schedule?.activities || schedule);
    const by = new Map(rows.map((a) => [codeOf(a), a]));
    const tf = (c) => (by.get(c)?.totalFloat === null || by.get(c)?.totalFloat === undefined ? null : Number(by.get(c).totalFloat));
    // answers D2.WP1.A140_TF / A300_TF / M900_EF / criticalCount (= WP1.T1)
    s.assert(tf('A140') === SCHEDULE.D2.WP1.A140_TF.value, `A140 TF ${SCHEDULE.D2.WP1.A140_TF.value} (got ${tf('A140')})`);
    s.assert(tf('A300') === SCHEDULE.D2.WP1.A300_TF.value, `A300 TF ${SCHEDULE.D2.WP1.A300_TF.value} (got ${tf('A300')})`);
    s.assert(Number(by.get('M900')?.earlyFinish) === SCHEDULE.D2.WP1.M900_EF.value, `M900 EF ${SCHEDULE.D2.WP1.M900_EF.value} (got ${by.get('M900')?.earlyFinish})`);
    const critical = rows.filter((a) => Number(a.totalFloat) <= 0).map((a) => codeOf(a)).sort();
    s.assert(critical.length === SCHEDULE.D2.WP1.criticalCount.value, `${SCHEDULE.D2.WP1.criticalCount.value} critical activities (got ${critical.join(',')})`);
    return { critical, A140: tf('A140'), A300: tf('A300'), M900EF: Number(by.get('M900').earlyFinish) };
  }, { needs: ['schedule.activate.F1'] });
}

/** Site engineers on activities (PATCH engineerIds), so their progress submissions pass the assignment rule. */
async function assignEngineers(b, { persona, engineer, codes, step = 'schedule.assign' }) {
  const activities = b.isDone('schedule.activate.F1') ? b.out('schedule.activate.F1').activities : null;
  return b.step(step, async (s) => {
    const userId = await b.userId(engineer);
    const out = {};
    for (const code of codes) {
      const id = activities[code];
      await s.act(`${step}.${code}`, persona, 'PATCH', `${b.P}/activities/${id}`, { engineerIds: [userId] }, {
        fields: { id, assignedEngineers: (v) => (Array.isArray(v) && v.some((e) => e.id === userId)) || `${engineer} among the assigned engineers` },
        // Interrupted: the activity is read back; the engineer on it means the PATCH took effect.
        verify: async (s2) => ((await s2.get(persona, `${b.P}/activities/${id}`))?.assignedEngineers || []).some((e) => e.id === userId),
      });
      out[code] = userId;
    }
    return out;
  }, {
    needs: ['schedule.activate.F1'],
    verify: async (s, out) => {
      for (const [code, userId] of Object.entries(out)) {
        const a = await s.get(persona, `${b.P}/activities/${activities[code]}`);
        const engineers = (a?.assignedEngineers || []).map((e) => e.id); // activity.service.js serializer
        if (!engineers.includes(userId)) return `${code} no longer carries ${engineer} (${userId}): ${JSON.stringify(engineers)}`;
      }
      return true;
    },
  });
}

// ── cost codes on the project ───────────────────────────────────────────────
/**
 * Company cost codes for this build (created by `admin`, a company
 * administrator) selected onto the project. `codes`: [{ suffix, name, category }].
 * Returns { code -> costCodeId }.
 */
async function costCodes(b, { admin, codes, step = 'cost.codes' }) {
  return b.step(step, async (s) => {
    const out = {};
    for (const c of codes) {
      const code = `C3-${b.code}-${c.suffix}`;
      const name = b.name(c.name);
      const find = async (s2) => atMostOne(s2, listOf(await s2.get(admin, `/company/cost-codes?search=${encodeURIComponent(code)}&includeArchived=true`)), (row) => row.code === code, `company cost code ${code}`);
      const data = await s.create(`${step}.${c.suffix}`, admin, '/company/cost-codes', { code, name, category: c.category, status: 'active' }, {
        fields: { code, name, category: c.category },
        get: () => `/company/cost-codes?search=${encodeURIComponent(code)}&includeArchived=true`,
        adopt: true,
        find,
      });
      out[c.suffix] = data.id;
    }
    const selected = await s.act(`${step}.select`, admin, 'PUT', `${b.P}/budget/cost-codes`, { costCodeIds: Object.values(out) }, {
      fields: { items: (v) => Array.isArray(v) || 'a list of the project cost codes' },
      // Interrupted: the project's cost codes are read back; every code on it means the PUT took effect.
      verify: async (s2) => {
        const on = new Set(listOf(await s2.get(admin, `${b.P}/budget/cost-codes`)).map((row) => row.costCodeId || row.id));
        return Object.values(out).every((id) => on.has(id));
      },
    });
    const onProject = new Set(listOf(selected).map((row) => row.costCodeId || row.id));
    for (const [suffix, id] of Object.entries(out)) s.assert(onProject.has(id), `cost code ${suffix} (${id}) is selected onto the project`, [...onProject]);
    return out;
  }, {
    verify: async (s, out) => {
      const list = listOf(await s.get(admin, `${b.P}/budget/cost-codes`));
      const on = new Set(list.map((row) => row.costCodeId || row.id));
      for (const [suffix, id] of Object.entries(out)) if (!on.has(id)) return `cost code ${suffix} is no longer on the project`;
      return true;
    },
  });
}

// ── the bill (answers inputs.ev087.boq = WP3.setup.boq, E-001..E-005) ───────
async function boqEv(b, { uploader, step = 'boq.upload' }) {
  const rows = lib.files.boqRows.ev();
  const expectedTotal = rows.reduce((sum, r) => sum + cents(r.quantity * r.rate), 0);
  return b.step(step, async (s) => {
    const file = lib.files.boqWorkbook(rows, { filename: b.file('BOQ.xlsx'), title: b.name('Bill of quantities') });
    const label = b.name('Bill');
    const listItems = async (s2) => listOf(await s2.get(uploader, `${b.P}/boq`));
    // The project's BOQ revisions as GET /boq lists them (boq.service.js getProjectBoq: `revisions`, each serializeBoqRevision: id, label, status, baselineLocked, ...).
    const revisionsOf = async (s2) => {
      const boq = await s2.get(uploader, `${b.P}/boq`);
      return Array.isArray(boq?.revisions) ? boq.revisions : [];
    };
    const data = await s.upload(step, uploader, `${b.P}/boq/upload`, file, {
      expect: 200,
      form: { label },
      // The upload's answer (its revisionId, mode 'imported', baselineLocked false), or on an adoption the live
      // revision row of this build's label (id, status, baselineLocked), as the commercial builders assert it (R3-6).
      fields: {
        revisionId: (v, d) => Boolean(v || (d?.label === label && d?.id)) || 'a revision id (or the adopted revision of this label)',
        mode: (v, d) => v === 'imported' || (v === undefined && d?.label === label) || "mode 'imported' (or the adopted revision of this label)",
        baselineLocked: false,
      },
      idOf: (d) => d?.revisionId ?? d?.id ?? null,
      get: (id) => `${b.P}/boq/revisions/${id}`,
      // An interrupted upload is adopted from the live BOQ revision this build's label names (GET /boq lists it;
      // identity, at most one: R2-D), never a constructed object (R3-6).
      find: async (s2) => atMostOne(s2, await revisionsOf(s2), (r) => r.label === label, `BOQ revision ${label}`),
    });
    // After the upload was recorded, a rerun gets the revision as read back (its id, not revisionId): the record's id then (R3-7).
    const rec = b.state.records[step];
    const revisionId = data.revisionId ?? data.id ?? rec?.id ?? null;
    s.assert(typeof revisionId === 'string' && revisionId.length > 0, `the bill upload names its revision (answer ${JSON.stringify(data?.revisionId ?? data?.id ?? null)}, record ${JSON.stringify(rec?.id ?? null)})`);
    const items = await listItems(s);
    const byCode = {};
    for (const r of rows) {
      const it = atMostOne(s, items, (i) => i.code === r.code && i.isActive !== false, `BOQ row ${r.code}`);
      s.assert(Boolean(it), `BOQ row ${r.code} is on the project`, items.map((i) => i.code));
      s.assert(cents(it.amount) === cents(r.quantity * r.rate), `${r.code} amount ${r.quantity} x ${r.rate}`, it);
      byCode[r.code] = it.id;
    }
    const total = items.filter((i) => i.isActive !== false).reduce((sum, i) => sum + cents(i.amount), 0);
    // answers WP3.setup.boq: 387,000.00 in scope, five rows (D2.WP3.setup.boq / D3.boq.rows)
    s.assert(total === expectedTotal, `the bill totals ${lib.formatCents(expectedTotal)} (got ${lib.formatCents(total)})`);
    return { revisionId, items: byCode, totalCents: total };
  });
}

/**
 * The five approved allocations (answers WP3.setup.allocations = D2.WP3.setup.allocations
 * = D3.boq.allocated): each E-row whole to its activity. creator creates and
 * submits, approver approves.
 */
async function allocationsEv(b, { creator, approver, step = 'boq.allocations' }) {
  const rows = lib.files.boqRows.ev();
  return b.step(step, async (s) => {
    const items = b.out('boq.upload').items;
    const activities = b.out('schedule.activate.F1').activities;
    const list = `${b.P}/activity-boq-allocations?includeInactive=true`;
    const out = {};
    for (const r of rows) {
      const [activity, quantity, amount] = r.allocations[0];
      const key = `${r.code}.${activity}`;
      const boqItemId = items[r.code];
      const activityId = activities[activity];
      const find = async (s2) => atMostOne(s2, listOf(await s2.get(creator, list)), (a) => a.boqItemId === boqItemId && a.activityId === activityId && a.status !== 'rejected', `allocation ${key}`);
      const created = await s.create(`${step}.${key}`, creator, `${b.P}/activity-boq-allocations`, {
        boqItemId, activityId, quantity, amount, source: 'manual', notes: b.ref(`ALLOC-${key}`),
      }, {
        fields: { boqItemId, activityId, amount: is.cents(amount), quantity: is.number(quantity) },
        get: null, // no GET /:id; the list answers { allocations, summary }: the step's verify reads it
        find,
      });
      const A = `${b.P}/activity-boq-allocations/${created.id}`;
      const statusOf = async (s2) => listOf(await s2.get(creator, list)).find((a) => a.id === created.id)?.status;
      await s.act(`${step}.${key}.submit`, creator, 'POST', `${A}/submit`, {}, {
        fields: { status: 'submitted' },
        verify: async (s2) => ['submitted', 'approved'].includes(await statusOf(s2)),
      });
      await s.act(`${step}.${key}.approve`, approver, 'POST', `${A}/approve`, {}, {
        fields: { status: 'approved' },
        verify: async (s2) => (await statusOf(s2)) === 'approved',
      });
      out[activity] = { id: created.id, amountCents: cents(amount) };
    }
    const approved = listOf(await s.get(creator, list)).filter((a) => a.status === 'approved' && a.isActive !== false);
    const total = approved.reduce((sum, a) => sum + cents(a.amount), 0);
    // answers D2.WP3.setup.allocations (= WP3.setup.allocations): 387,000.00 = BAC
    const expected = Object.values(SCHEDULE.D2.WP3.setup.allocations.value).reduce((x, y) => x + y, 0);
    s.assert(total === expected, `the approved allocations total ${lib.formatCents(expected)} (got ${lib.formatCents(total)})`, approved.map((a) => [a.activityId, a.amount, a.status]));
    return out;
  }, {
    needs: ['boq.upload', 'schedule.activate.F1'],
    verify: async (s, out) => {
      const rows = listOf(await s.get(creator, `${b.P}/activity-boq-allocations?includeInactive=true`));
      for (const [activity, a] of Object.entries(out)) {
        const row = rows.find((r) => r.id === a.id);
        if (!row || row.status !== 'approved' || lib.toCents(row.amount) !== a.amountCents) return `the ${activity} allocation ${a.id} is ${row ? `${row.status} ${row.amount}` : 'gone'}`;
      }
      return true;
    },
  });
}

/** The baseline lock of the active F1 revision (WP1 baseline; D2.WP1.baseline / D3.F1byPm.steps). */
async function baselineF1(b, { persona, step = 'schedule.baseline.F1' }) {
  return b.step(step, async (s) => {
    const { revisionId } = b.out('schedule.activate.F1');
    const R = `${b.P}/schedule/revisions/${revisionId}`;
    // HR-S2 is fixed (WP1-MS-1, f599e67): the baseline answers 200; any other answer fails the build.
    await s.act(step, persona, 'POST', `${R}/baseline`, { comment: b.name('F1 baseline') }, {
      fields: { '$status': 200 },
      verify: async (s2) => (await s2.get(persona, R))?.status === 'baselined',
    });
    const rev = await s.get(persona, R);
    s.expectFields(rev, { status: 'baselined', isActive: true }, 'the baselined revision');
    return { revisionId, status: rev.status };
  }, { needs: ['boq.allocations', 'schedule.activate.F1'] });
}

// ── planned value and actual cost (answers inputs.ev087 loadings / directCosts) ─
/**
 * The five cost loadings of 087-EV (WP3.setup.loadings: 60,000 on 01-23, 30,000
 * on 01-28, 90,000 on 02-13, 135,000 on 03-20, 72,000 on 04-10), created and
 * submitted by `creator`, approved by `approver`. PV at any cutoff after 04-10 is
 * 387,000.00 (WP3.T1.pv).
 */
async function loadingsEv(b, { creator, approver, step = 'ev.loadings' }) {
  return b.step(step, async (s) => {
    const activities = b.out('schedule.activate.F1').activities;
    const list = `${b.P}/reports/cost-loading`;
    const out = {};
    for (const [code, amount, date] of EV.loadings) {
      b.past(date);
      const key = `${code}.${date}`;
      const find = async (s2) => atMostOne(s2, listOf(await s2.get(creator, list)), (row) => taggedWith(row.notes, b.ref(`PV-${key}`)), `cost loading ${b.ref(`PV-${key}`)}`);
      const row = await s.create(`${step}.${key}`, creator, list, {
        activityId: activities[code], plannedDate: date, plannedValue: amount, source: 'manual', baselineVersion: 'BL0', status: 'submitted',
        notes: `${b.ref(`PV-${key}`)} planned value`,
      }, {
        fields: { activityId: activities[code], plannedValue: is.cents(amount), status: 'submitted', plannedDate: is.day(date) },
        get: () => list,
        find,
      });
      await s.act(`${step}.${key}.approve`, approver, 'POST', `${list}/${row.id}/approve`, {}, {
        fields: { status: 'approved' },
        verify: async (s2) => listOf(await s2.get(creator, list)).find((r) => r.id === row.id)?.status === 'approved',
      });
      out[key] = row.id;
    }
    return out;
  }, { needs: ['schedule.activate.F1'] });
}

/**
 * The 087-EV direct costs (WP3.setup.directCosts: A110 50,000 on 01-20 and 10,000
 * on 09-30; A130 20,000 on 02-10), one direct cost each, one line on the
 * activity and a cost code, created and submitted by `creator`, approved by
 * `approver`. AC at a cutoff of the run date: 80,000.00 (WP3.T1.ac).
 * `extra` adds rows (e.g. WP3.T2's 30,000 on A120 dated 10-01) under their own step.
 */
async function directCostsEv(b, { creator, approver, costCodeId, rows = EV.directCosts, step = 'ev.costs', needs = [] }) {
  return b.step(step, async (s) => {
    const activities = b.out('schedule.activate.F1').activities;
    const base = `${b.P}/direct-costs`;
    const out = {};
    for (const [code, amount, date] of rows) {
      b.past(date);
      const key = `${code}.${date}`;
      const ref = b.ref(`DC-${key}`);
      const find = async (s2) => atMostOne(s2, listOf(await s2.get(creator, `${base}?q=${encodeURIComponent(ref)}`)), (row) => taggedWith(row.description, ref), `direct cost ${ref}`);
      const dc = await s.create(`${step}.${key}`, creator, base, {
        type: 'expense', description: `${ref} cost on ${code}`, costDate: date,
        lines: [{ description: `${ref} ${code}`, costCodeId, activityId: activities[code], costType: 'subcontract', amount }],
      }, {
        fields: { status: 'draft', total: is.cents(amount), costDate: date },
        find,
      });
      const D = `${base}/${dc.id}`;
      await s.act(`${step}.${key}.submit`, creator, 'POST', `${D}/submit`, {}, {
        fields: { status: 'pending' },
        verify: async (s2) => ['pending', 'approved', 'paid'].includes((await s2.get(creator, D))?.status),
      });
      await s.act(`${step}.${key}.approve`, approver, 'POST', `${D}/approve`, {}, {
        // The one line this direct cost carries (G6: asserted to be the only one, not read by position).
        fields: { status: 'approved', lines: (v) => (Array.isArray(v) && v.length === 1 && lib.toCents(v[0].postedAmount) === cents(amount)) || `one line posted at ${amount}` },
        verify: async (s2) => ['approved', 'paid'].includes((await s2.get(creator, D))?.status),
      });
      out[key] = dc.id;
    }
    return out;
  }, { needs: ['schedule.activate.F1', ...needs] });
}

// ── progress (submitted by an assigned engineer, approved) ──────────────────
/**
 * One progress claim on `code` at `pct`, submitted by `submitter`, approved by
 * `approver`; asserts the official percent after approval. `payload` adds to
 * the submission (method, evidence, quantities).
 *
 * `gates` (G1, moment-bound checks of WP-2 asserted where the build passes
 * through their moment): beforeApprove(s, ctx) runs while the submission waits
 * for approval, afterApprove(s, ctx) once it is official. ctx = { A,
 * submissionId, approveRoute, subs, waiting } where `waiting` is true only when
 * no approval has been sent yet in any run (so a figure that holds only before
 * approval is read only then). Each gate records its own requests, so a
 * resumed step re-sends none of them; its result goes to the step's out.
 */
async function progress(b, { step, code, pct, submitter, approver, payload = {}, needs = [], approveKnown = null, gates = {} }) {
  return b.step(step, async (s) => {
    const activityId = b.out('schedule.activate.F1').activities[code];
    const A = `${b.P}/activities/${activityId}`;
    const subs = async (s2) => listOf(await s2.get(approver, `${A}/progress-submissions`));
    const submitted = await s.create(`${step}.submit`, submitter, `${A}/progress`, {
      pctComplete: pct, status: 'submitted', source: 'manual', notes: `${b.ref(`PROG-${step}`)} ${code} ${pct}%`, ...payload,
    }, {
      expect: 200,
      idOf: (d) => d?.submission?.id ?? null,
      fields: { 'submission.status': 'submitted', 'submission.id': is.present },
      get: () => `${A}/progress-submissions`,
      // An interrupted submit is found by its notes (tagged with this step's ref, exactly; at most one), in
      // the shape the submit answers ({ submission }).
      find: async (s2) => {
        const row = atMostOne(s2, await subs(s2), (x) => taggedWith(x.notes, b.ref(`PROG-${step}`)), `progress submission ${b.ref(`PROG-${step}`)}`);
        return row ? { submission: row } : null;
      },
    });
    const submissionId = submitted?.submission?.id ?? submitted?.id;
    const approveRoute = `${A}/progress-submissions/${submissionId}/approve`;
    const ctx = { A, activityId, submissionId, approveRoute, subs, waiting: !b.state.records[`${step}.approve`] };
    const before = gates.beforeApprove ? await gates.beforeApprove(s, ctx) : undefined;
    await s.act(`${step}.approve`, approver, 'POST', approveRoute, {}, {
      fields: { status: 'approved' },
      verify: async (s2) => (await subs(s2)).find((x) => x.id === submissionId)?.status === 'approved',
      ...(approveKnown ? { known: approveKnown } : {}),
    });
    const activity = await s.get(approver, A);
    const official = Number(activity?.pctComplete ?? activity?.progress?.pctComplete);
    s.assert(official === pct, `${code} official progress ${pct}% after approval (got ${official})`, { pctComplete: activity?.pctComplete });
    const after = gates.afterApprove ? await gates.afterApprove(s, ctx) : undefined;
    return { submissionId, code, pct, ...(before !== undefined ? { beforeApprove: before } : {}), ...(after !== undefined ? { afterApprove: after } : {}) };
  }, { needs: ['schedule.activate.F1', ...needs] });
}

// ── the EV report ───────────────────────────────────────────────────────────
/** GET /reports/ev (cutoff today unless given): the project totals as numbers. */
const evTotals = async (s, b, persona, cutoffDate = null) => {
  const r = await s.get(persona, `${b.P}/reports/ev${cutoffDate ? `?cutoffDate=${cutoffDate}` : ''}`);
  // earned-value.service.js buildEvReport: the project figures sit at the top level (totalBudget, pv, ev, ac, eac, spi, cpi).
  s.assert(r && r.totalBudget !== undefined && r.ev !== undefined, 'the EV report carries totalBudget, pv, ev and ac', r && Object.keys(r));
  return {
    raw: {
      totalBudget: r.totalBudget, pv: r.pv, ev: r.ev, ac: r.ac, eac: r.eac, eacBasis: r.eacBasis, spi: r.spi, cpi: r.cpi, sv: r.sv, cv: r.cv, etc: r.etc,
      spiAlert: r.alerts?.spiAlert, cpiAlert: r.alerts?.cpiAlert, reporting: r.reporting,
    },
    bac: r.totalBudget,
    pv: r.pv,
    ev: r.ev,
    ac: r.ac,
    spi: r.spi,
    cpi: r.cpi,
    eac: r.eac,
    reporting: r.reporting || null,
    activityBreakdown: Array.isArray(r.activityBreakdown) ? r.activityBreakdown : [],
  };
};

/** Ratios are compared at six decimals, as the answer book states them. */
const r6 = (x) => (x === null || x === undefined ? null : Number(Number(x).toFixed(6)));

/**
 * The EV report's figure for an answer-book metric leaf (schedule.js
 * metricLeaves: bac pv ev ac spi spiAlert cpi cpiAlert eac eacBasis sv cv etc),
 * in the leaf's unit: cents for money, six decimals for a ratio, the value
 * itself for a flag or a state.
 */
const metricOf = (t, key, unit) => {
  const raw = { bac: t.raw.totalBudget, ...t.raw }[key];
  if (unit === 'cents') return raw === null || raw === undefined ? raw : lib.toCents(raw);
  if (unit === 'ratio') return r6(raw);
  return raw;
};

/**
 * Asserts every leaf of an answer-book metric node (e.g. D3.WP3.T1, D2.WP3.T2)
 * against the EV report read in `t` (evTotals), one assertion per leaf, and
 * returns the figures read: { key: { got, want } }.
 */
const assertMetricLeaves = (s, t, node, label) => {
  const out = {};
  const leaves = Object.entries(node).filter(([, leaf]) => leaf && typeof leaf === 'object' && 'value' in leaf && 'unit' in leaf);
  s.assert(leaves.length > 0, `${label}: the answer-book node has metric leaves`);
  for (const [key, leaf] of leaves) {
    const got = metricOf(t, key, leaf.unit);
    s.assert(got !== undefined, `${label}: the EV report carries ${key}`, Object.keys(t.raw));
    s.assert(got === leaf.value, `${label}: ${key} ${leaf.unit === 'cents' ? lib.formatCents(leaf.value) : JSON.stringify(leaf.value)} (got ${leaf.unit === 'cents' && typeof got === 'number' ? lib.formatCents(got) : JSON.stringify(got)})`, t.raw);
    out[key] = got;
  }
  return out;
};

/**
 * The reporting zone through the API (answers schedule.js <node>.timeZone,
 * timeZoneSource, timeZoneNote; builders' adjudication 087-EV item 5 and
 * 087-OTH/052/006 item 2): createProject copies the workspace zone onto the
 * project, so the source reads 'project' AND the zone is the company's. The
 * book's zone is checked against the company the build resolved (plan §3.1).
 */
const assertReportingZone = (s, b, reporting, node, label) => {
  const rep = reporting || {};
  s.assert(node.timeZone.value === b.company.timezone, `${label}: the answer book's zone ${node.timeZone.value} is company ${b.company.code}'s (${b.company.timezone})`);
  s.assert(rep.timeZone === node.timeZone.value, `${label}: reporting.timeZone ${node.timeZone.value} (got ${rep.timeZone})`, rep);
  s.assert(rep.timeZoneSource === node.timeZoneSource.value, `${label}: reporting.timeZoneSource '${node.timeZoneSource.value}' (got ${rep.timeZoneSource})`, rep);
  s.assert(rep.timeZoneNote === node.timeZoneNote.value, `${label}: reporting.timeZoneNote ${JSON.stringify(node.timeZoneNote.value)} (got ${JSON.stringify(rep.timeZoneNote)})`, rep);
  // The plan (§3.2, premise A8) says the source is the organisation; the book settled 'project' on paper.
  // That departure from the plan is persisted (G2) under the suspect registered for it, WP3-TZ-1.
  if (node.timeZoneSource.planDisagrees && rep.timeZoneSource !== node.timeZoneSource.planValue) {
    s.finding('WP3-TZ-1', `${label}: plan §3.2 and premise A8 expect reporting.timeZoneSource '${node.timeZoneSource.planValue}'. GET /reports/ev on ${b.code} answers timeZoneSource '${rep.timeZoneSource}', timeZone ${rep.timeZone} (company ${b.company.code}'s zone), timeZoneNote ${JSON.stringify(rep.timeZoneNote)}: createProject copies the workspace zone onto the project (ENT-6), so the figures are the company zone's. The answer book carries '${node.timeZoneSource.value}' (planValue '${node.timeZoneSource.planValue}'). Open for WP-3 confirm-first: does a later change of the company zone reach existing projects?`);
  }
  return { timeZone: rep.timeZone, timeZoneSource: rep.timeZoneSource, timeZoneNote: rep.timeZoneNote, cutoffDate: rep.cutoffDate ?? null };
};

module.exports = {
  CODES,
  EV,
  SCHEDULE,
  activitiesByCode,
  allocationsEv,
  atMostOne,
  assertF1Cpm,
  assertMetricLeaves,
  assertReportingZone,
  assignEngineers,
  baselineF1,
  boqEv,
  costCodes,
  directCostsEv,
  evTotals,
  listOf,
  loadingsEv,
  progress,
  r6,
  scheduleF1,
  taggedWith,
};
