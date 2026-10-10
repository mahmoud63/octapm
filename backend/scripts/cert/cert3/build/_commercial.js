'use strict';

/**
 * Helpers shared by the commercial builders 087-COM, 087-COM-B, 087-COM-C and
 * 052-COM (plan §3.2). Not a builder: run-all.js never runs it, and nothing
 * here makes a record outside a step of the build that calls it.
 *
 *   pdf(text, filename)                 a one-page PDF as a files.js-style file object
 *   attach(s, name, persona, recordType, recordId, label)
 *                                       POST /attachments (field "files"): { attachmentId, documentId }.
 *                                       Read back from the record's attachment list; an interrupted
 *                                       upload is found there by its file name, never sent twice (R2-11)
 *   portal(b, method, route, json)      a public token route (RFQ / bid portal): no session, a 5xx fails
 *   portalAct(s, name, method, routeOf, json, { verify, label, expect, fields })
 *                                       a portal call recorded like an act (R2-10): marked pending in the
 *                                       state before it is sent and done after; an interrupted one is
 *                                       settled by `verify` (a live read), never re-sent blind. The state
 *                                       keeps `label` ('/public/bids/<token>/...'), never the token.
 *                                       `fields` (required) are asserted on the answer before the record
 *                                       is marked done; a mismatch is kept on the record and re-checked
 *                                       on every resume, never skipped (round 2, R2-C)
 *   tokenOf(url, marker)                the token at the end of a portal link (never logged)
 *   one(rows, test, what)               the one row that matches, by identity (adjudication G6)
 *   atMostOne(rows, test, what)         the row that matches by identity, or null; two or more is a
 *                                       BuildError (G6, round 2 R2-D: every adoption or read-back find)
 *   activitiesF1(b, { persona, engineer, only })
 *                                       step 'activities': the F1 network hand-built (POST /activities)
 *   costCodes(b, list)                  step 'cost-codes': company codes found or made, put on the project
 *   budgetLines(b, list)                step 'budget-lines'
 *   allocate(b, list)                   step 'allocations': create, submit, approve (read back live)
 *   progress(b, list)                   step 'progress': site submits, the planner approves (read back live;
 *                                       a submission is found by the PROG ref its notes carry, R2-C)
 *   cents(x), money(c), round2(x), listOf(data, ...keys)
 */

const lib = require('./lib');

const { is } = lib;
const cents = (value) => lib.toCents(value);
const money = (c) => Math.round(c) / 100;
const round2 = (value) => Math.round(Number(value) * 100) / 100;
const listOf = (data, ...keys) => {
  if (Array.isArray(data)) return data;
  for (const key of [...keys, 'items', 'rows', 'orders', 'data']) if (Array.isArray(data?.[key])) return data[key];
  return [];
};

/** The one row of `rows` that `test` matches: identity, never position (adjudication G6). */
const one = (rows, test, what) => {
  const hits = (Array.isArray(rows) ? rows : []).filter(test);
  if (hits.length !== 1) throw new lib.BuildError(`${what}: ${hits.length} rows match; exactly one is expected (identity, not position: adjudication G6)`);
  return hits[0];
};

/**
 * The row of `rows` that `test` matches by identity, or null when none does. Two or more is a
 * BuildError: an adoption or read-back find never takes the first of several (G6, round 2 R2-D).
 */
const atMostOne = (rows, test, what) => {
  const hits = (Array.isArray(rows) ? rows : []).filter(test);
  if (hits.length > 1) throw new lib.BuildError(`${what}: ${hits.length} rows match; at most one is expected (identity, not position: adjudication G6, R2-D)`);
  return hits[0] || null;
};

/** A one-page PDF that says `text` (a files.js-style object for s.upload). */
const pdf = (text, filename) => {
  const safe = String(text).replace(/[()\\]/g, ' ');
  const stream = `BT /F1 11 Tf 40 760 Td (${safe}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const body = Buffer.from(out, 'latin1');
  return { filename, body, contentType: 'application/pdf', bytes: body.length };
};

/**
 * Uploads one PDF onto a record; returns { attachmentId, documentId }. The record's attachment
 * list (GET /attachments?recordType&recordId) is the read-back route, and the attachment is the
 * one row carrying this build's file name (unique in the build): an interrupted upload is adopted
 * from it, never sent again (adjudication R2-11).
 */
const attach = async (s, name, persona, recordType, recordId, label) => {
  const b = s.b;
  const file = pdf(`${label} ${b.code}`, b.file(`${name}.pdf`));
  const listRoute = `${b.P}/attachments?recordType=${encodeURIComponent(recordType)}&recordId=${encodeURIComponent(recordId)}`;
  const named = (row) => Boolean(row) && row.recordId === recordId && (row.document?.originalName === file.filename || row.fileName === file.filename);
  const theOne = (data) => {
    const rows = listOf(data, 'attachments').filter(named);
    if (rows.length > 1) throw new lib.BuildError(`attach ${name}: ${rows.length} attachments named ${file.filename} on ${recordType} ${recordId}; exactly one is expected`);
    return rows[0] || null;
  };
  const data = await s.upload(name, persona, `${b.P}/attachments`, file, {
    field: 'files',
    form: { recordType, recordId, caption: `${label} (${b.code})` },
    get: listRoute,
    idOf: (d) => theOne(d)?.id ?? null,
    fields: { documentId: (v, d) => Boolean(theOne(d)?.documentId) || `one attachment named ${file.filename}, with its project document` },
    find: async (s2) => {
      const row = theOne(await s2.get(persona, listRoute));
      return row ? { items: [row] } : null;
    },
  });
  // Made or adopted now: the answer's list; read back on a resume: the row itself.
  const row = Array.isArray(data?.items) || Array.isArray(data?.attachments) ? theOne(data) : data;
  if (!row?.id || !row.documentId) throw new lib.BuildError(`attach ${name}: no attachment with its project document came back`);
  return { attachmentId: row.id, documentId: row.documentId };
};

/** A public token route (no session): the vendor or bidder side. A 5xx fails the build. */
const portal = async (b, method, route, json) => {
  const res = await lib.api.raw(method, route, json === undefined ? {} : { json });
  b._track(res, `portal ${method} ${route.replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/, '/<token>')}`);
  return res;
};

/**
 * A portal call recorded like an act (adjudication R2-10): pending in the state before it is sent,
 * done after, so a killed run never sends it twice. An interrupted call is settled by `verify(s)`,
 * which reads the live record through a session: true adopts it, false sends it again. `routeOf` is
 * called only when the call is sent (a bidder's link is asked for then). The state keeps `label`,
 * never the link's token, and not the answer.
 *
 * `fields` (required, as for the lib's acts) are asserted on the answer BEFORE the record is marked
 * done (round 2, R2-C). The call took effect either way, so the record is kept done (never sent
 * again), but with the mismatches in `fieldProblems`, and the build fails. A resume meets such a
 * record again and fails again: there is no read-back route to re-assert it, so it is checked by
 * hand (the lib's rule for a done record with field problems and no GET), never skipped.
 */
const portalAct = async (s, name, method, routeOf, json, { verify, label, expect = 200, fields = null } = {}) => {
  const b = s.b;
  if (typeof verify !== 'function') throw new lib.BuildError(`portal ${name}: a verify that reads the live record settles an interrupted call (R2-10)`);
  if (typeof label !== 'string' || !label.includes('<token>')) throw new lib.BuildError(`portal ${name}: label is the route with its token written <token>`);
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || !Object.keys(fields).length) {
    throw new lib.BuildError(`portal ${name}: fields names the key fields the answer must carry; a portal call is asserted, never just sent (R2-C)`);
  }
  const existing = b._checkRecordName(name, s);
  const stamp = () => new Date().toISOString();
  if (existing?.status === 'done') {
    if (existing.fieldProblems?.length) {
      throw new lib.BuildError(`portal ${name}: sent earlier and answered with ${existing.fieldProblems.join('; ')}; a portal call has no GET to read it again, so check it by hand, then remove records["${name}"] from ${b.stateFile}`);
    }
    s.reused += 1;
    b.counts.reused += 1;
    return null;
  }
  if (existing?.status === 'unexpected') {
    throw new lib.BuildError(`portal ${name}: an earlier run was answered ${existing.said} where ${expect} was expected, so it is never sent again; resolve it by hand, then remove records["${name}"] from ${b.stateFile}`);
  }
  if (existing?.status === 'pending') {
    if ((await verify(s)) === true) {
      b.state.records[name] = { ...existing, status: 'done', adopted: true, at: stamp() };
      b.save();
      s.reused += 1;
      b.counts.adopted += 1;
      b._log('ADOPTED', `${name} (sent by an earlier run; the live record shows it took effect)`);
      return null;
    }
    b._log('RESEND', `${name}: the interrupted call did not take effect; sending it again`);
  }
  const route = await routeOf();
  b.state.records[name] = { kind: 'act', step: s.name, status: 'pending', persona: 'portal', method, route: label, sentAt: stamp() };
  b.save();
  const res = await portal(b, method, route, json);
  const said = lib.said(res);
  if (res.status !== expect) {
    if (res.status >= 200 && res.status < 300) b.state.records[name] = { ...b.state.records[name], status: 'unexpected', said, at: stamp() };
    else delete b.state.records[name]; // refused: nothing was made
    b.save();
    throw new lib.BuildError(`portal ${name}: ${method} ${label} answered ${said}; expected ${expect}`, { said });
  }
  const data = res.body?.data ?? null;
  // Asserted before the record is marked done (R2-C): the mismatches are kept on the record.
  const problems = lib.fieldProblems(data, fields, res);
  b.state.records[name] = { kind: 'act', step: s.name, status: 'done', id: null, persona: 'portal', method, route: label, said, at: stamp(), fieldProblems: problems };
  b.save();
  s.made += 1;
  b.counts.made += 1;
  if (problems.length) throw new lib.BuildError(`portal ${name}: ${method} ${label} answered ${said} but ${problems.join('; ')}`, { said });
  return data;
};

/** The token at the end of a portal link (`/rfq/<token>` or `/bid/<token>`). */
const tokenOf = (url, marker) => {
  const token = String(url || '').split(marker)[1];
  if (!token) throw new lib.BuildError(`a portal link without ${marker}<token> came back`);
  return token.split(/[?#]/)[0];
};

// ── the F1 network, hand-built ─────────────────────────────────────────────
/**
 * The answer book's F1 network (files.F1(): 14 activities, durations = hours / 8,
 * FS links) made by hand with POST /activities, so the commercial projects
 * carry the activity codes the answer book's figures name (A110, A120, A130,
 * A310, A320 ...) without an XER import and its approval (HR-S2 territory).
 * `only` limits it to some codes (their predecessors outside the set dropped).
 */
const activitiesF1 = (b, { persona = 'planner', engineer = 'site', only = null, step = 'activities' } = {}) =>
  b.step(step, async (s) => {
    const model = lib.files.F1();
    const wbs = Object.fromEntries(model.wbs.map((w) => [w.key, w.name]));
    const wanted = model.activities.filter((a) => !only || only.includes(a.code));
    const engineerId = await b.userId(engineer);
    const existing = listOf(await s.get(persona, `${b.P}/activities`));
    const ids = {};
    for (const [index, a] of wanted.entries()) {
      const preds = model.links.filter((l) => l.succ === a.code && ids[l.pred]);
      const payload = {
        name: `${a.name} (${b.code})`,
        activityCode: a.code,
        wbsCode: wbs[a.wbs],
        duration: a.days,
        isMilestone: a.milestone,
        sortOrder: index,
        engineerIds: [engineerId],
        ...(preds.length ? { dependencies: preds.map((l) => ({ predecessorId: ids[l.pred], relationshipType: l.type, lagDays: l.lagDays })) } : {}),
      };
      const data = await s.create(`activity.${a.code}`, persona, `${b.P}/activities`, payload, {
        fields: { activityCode: a.code, duration: a.days },
        adopt: true,
        find: async () => atMostOne(existing, (row) => row.activityCode === a.code, `activity ${a.code}`),
      });
      ids[a.code] = data.id;
    }
    const rows = listOf(await s.get(persona, `${b.P}/activities`));
    s.assert(rows.length === wanted.length, `${wanted.length} activities on the project (found ${rows.length})`);
    // One row per code (G6), the one this step made or adopted: the float of each code is read from it.
    const byCode = Object.fromEntries(wanted.map((a) => [a.code, one(rows, (row) => row.activityCode === a.code, `activity ${a.code}`)]));
    for (const a of wanted) s.assert(byCode[a.code].id === ids[a.code], `activity ${a.code} is the row this step made or adopted (${ids[a.code]}; read ${byCode[a.code].id})`);
    const floats = Object.fromEntries(wanted.map((a) => [a.code, byCode[a.code].totalFloat ?? null]));
    // The whole network: the product's CPM gives the answer book's float (A140 47, A300 20, the rest 0).
    if (!only) for (const a of wanted) s.assert(Number(floats[a.code]) === a.tf, `${a.code} total float ${a.tf} (read ${floats[a.code]})`);
    return { ids, floats, model: wanted.map((a) => ({ code: a.code, days: a.days, tf: a.tf })) };
  }, {
    verify: async (s, out) => {
      const rows = listOf(await s.get(persona, `${b.P}/activities`));
      for (const [code, id] of Object.entries(out.ids)) if (!rows.some((row) => row.id === id && row.activityCode === code)) return `activity ${code} ${id} is gone`;
      return true;
    },
  });

// ── cost codes and budget lines ────────────────────────────────────────────
/**
 * `list`: [{ code, name, category }]. A code the company already holds is
 * reused (the population's 01-100 ...); one it lacks is made under the name
 * given (which carries the build's code). Every code is put on the project.
 */
const costCodes = (b, list, { persona = 'pm' } = {}) =>
  b.step('cost-codes', async (s) => {
    const library = listOf(await s.get(persona, '/company/cost-codes?includeArchived=false'));
    const ids = {};
    for (const { code, name, category } of list) {
      const found = atMostOne(library, (row) => row.code === code && row.status !== 'archived', `company cost code ${code}`);
      if (found) {
        ids[code] = found.id;
        continue;
      }
      const data = await s.create(`cost-code.${code}`, persona, '/company/cost-codes', { code, name, category, status: 'active' }, {
        fields: { code, category },
        get: '/company/cost-codes?includeArchived=false',
        adopt: true,
        find: async (s2) => atMostOne(listOf(await s2.get(persona, '/company/cost-codes?includeArchived=false')), (row) => row.code === code, `company cost code ${code}`),
        named: code.includes(b.code) || name.includes(b.code),
      });
      ids[code] = data.id;
    }
    await s.act('cost-codes.project', persona, 'PUT', `${b.P}/budget/cost-codes`, { costCodeIds: Object.values(ids) }, {
      fields: { '$status': 200 },
      verify: async (s2) => {
        const onProject = listOf(await s2.get(persona, `${b.P}/budget/cost-codes`));
        return Object.values(ids).every((id) => onProject.some((row) => (row.costCodeId || row.id) === id));
      },
    });
    const onProject = listOf(await s.get(persona, `${b.P}/budget/cost-codes`));
    for (const [code, id] of Object.entries(ids)) s.assert(onProject.some((row) => (row.costCodeId || row.id) === id), `cost code ${code} is on the project`);
    return { ids };
  });

/** `list`: [{ code, costType, originalBudget, description }] on codes of the 'cost-codes' step. */
const budgetLines = (b, list, { persona = 'cost' } = {}) =>
  b.step('budget-lines', async (s) => {
    const codeIds = b.out('cost-codes').ids;
    const existing = listOf(await s.get(persona, `${b.P}/budget/lines`), 'lines');
    const ids = {};
    for (const line of list) {
      const key = `${line.code}:${line.costType}`;
      const data = await s.create(`budget-line.${key}`, persona, `${b.P}/budget/lines`, {
        costCodeId: codeIds[line.code],
        costType: line.costType,
        description: `${line.description} (${b.code})`,
        originalBudget: line.originalBudget,
        status: 'active',
      }, {
        fields: { costType: line.costType, originalBudget: is.cents(line.originalBudget), costCodeId: codeIds[line.code] },
        adopt: true,
        find: async () => atMostOne(existing, (row) => row.costCodeId === codeIds[line.code] && row.costType === line.costType, `budget line ${key}`),
      });
      ids[key] = data.id;
    }
    const rows = listOf(await s.get(persona, `${b.P}/budget/lines`), 'lines');
    const original = rows.reduce((sum, row) => sum + cents(row.originalBudget), 0);
    const expected = list.reduce((sum, line) => sum + cents(line.originalBudget), 0);
    s.assert(original === expected, `the original budget is the sum of its lines: ${money(expected)} (read ${money(original)})`);
    return { ids, originalCents: original };
  }, { needs: ['cost-codes'] });

// ── allocations and progress ───────────────────────────────────────────────
/**
 * `list`: [{ key, boqCode, activity, quantity, amount }]: created by the
 * planner, submitted by the planner, approved by the QS (the drivers' split).
 * Each allocation is read back from the project's allocation list on a resume
 * (the get: null rule, R3-16).
 */
const allocate = (b, list, { boqItems, activityIds, creator = 'planner', approver = 'qs' } = {}) =>
  b.step('allocations', async (s) => {
    const route = `${b.P}/activity-boq-allocations`;
    const read = async () => listOf(await s.get(creator, route), 'allocations');
    const before = await read();
    const ids = {};
    for (const row of list) {
      const boqItemId = boqItems[row.boqCode];
      const activityId = activityIds[row.activity];
      s.assert(Boolean(boqItemId && activityId), `allocation ${row.key}: bill row ${row.boqCode} and activity ${row.activity} exist`);
      const made = await s.create(`allocation.${row.key}`, creator, route, {
        boqItemId,
        activityId,
        quantity: row.quantity,
        amount: row.amount,
        source: 'manual',
        notes: `${b.ref(`ALLOC-${row.key}`)}`,
      }, {
        get: route,
        idOf: (d) => d?.id ?? d?.allocation?.id ?? null,
        fields: { quantity: row.quantity, amount: is.cents(row.amount) },
        adopt: true,
        find: async () => atMostOne(before, (r) => r.boqItemId === boqItemId && r.activityId === activityId && r.isActive !== false, `allocation ${row.key}`),
      });
      const id = made?.id ?? made?.allocation?.id;
      ids[row.key] = id;
      // Each transition also runs while its own record is pending (a killed run's), so its verify settles it (G4).
      const pending = (name) => b.state.records[name]?.status === 'pending';
      const status = (await read()).find((r) => r.id === id)?.status;
      if (status === 'draft' || pending(`allocation.${row.key}.submit`)) {
        await s.act(`allocation.${row.key}.submit`, creator, 'POST', `${route}/${id}/submit`, {}, {
          fields: { status: 'submitted' },
          verify: async () => ['submitted', 'approved'].includes((await read()).find((r) => r.id === id)?.status),
        });
      }
      if ((await read()).find((r) => r.id === id)?.status === 'submitted' || pending(`allocation.${row.key}.approve`)) {
        await s.act(`allocation.${row.key}.approve`, approver, 'POST', `${route}/${id}/approve`, {}, {
          fields: { status: 'approved' },
          verify: async () => (await read()).find((r) => r.id === id)?.status === 'approved',
        });
      }
    }
    const rows = await read();
    for (const row of list) {
      const got = rows.find((r) => r.id === ids[row.key]);
      s.expectFields(got, { status: 'approved', amount: is.cents(row.amount), quantity: row.quantity }, `allocation ${row.key}`);
    }
    return { ids };
  });

/**
 * `list`: [{ activity, pct }]: the site engineer (assigned to the activity)
 * submits percent progress, the planner approves. One submission per
 * activity and target, identified by the PROG ref its notes carry (R2-C):
 * found by that ref, never by its percentage or status. An activity already
 * at the target with nothing of this step pending is left alone. Each
 * submission is read back from its activity's submission list on a resume.
 */
const progress = (b, list, { activityIds, submitter = 'site', approver = 'planner', step = 'progress' } = {}) =>
  b.step(step, async (s) => {
    const out = {};
    const pendingRecord = (name) => b.state.records[name]?.status === 'pending';
    for (const { activity, pct } of list) {
      const id = activityIds[activity];
      const submissions = `${b.P}/activities/${id}/progress-submissions`;
      const ref = b.ref(`PROG-${activity}-${pct}`);
      const createName = `progress.${activity}.${pct}`;
      const approveName = `${createName}.approve`;
      // The ref is a whole word of the notes ('PROG-A110-10' never matches 'PROG-A110-100').
      const carries = (row) => String(row?.notes || '').split(/\s+/).includes(ref);
      const mine = async (s2) => atMostOne(listOf(await s2.get(approver, submissions)), carries, `${activity}: the submission ${ref}`);
      const current = await s.get(approver, `${b.P}/activities/${id}`);
      const approvedNow = current.approvedProgressUpdatedAt ? Number(current.pctComplete) : null;
      if (approvedNow === pct && !pendingRecord(createName) && !pendingRecord(approveName)) {
        out[activity] = { pct, submissionId: (await mine(s))?.id ?? null, already: true };
        continue;
      }
      // Made, read back, or adopted by its ref (adopt: true: a submission of this ref is never made twice).
      const made = await s.create(createName, submitter, `${b.P}/activities/${id}/progress`, {
        pctComplete: pct,
        progressMethod: 'percent',
        status: 'submitted',
        source: 'manual',
        notes: `Measured on site for valuation ${ref}`,
      }, {
        expect: 200,
        get: submissions,
        idOf: (d) => d?.submission?.id ?? d?.id ?? null,
        fields: { pctComplete: (v, d) => Number(d?.submission?.pctComplete ?? d?.pctComplete) === pct || `a submission of ${pct}%` },
        adopt: true,
        find: mine,
      });
      const submissionId = made?.submission?.id ?? made?.id;
      s.assert(Boolean(submissionId), `${activity}: the submission ${ref} has an id`);
      const status = async (s2) => (await mine(s2))?.status;
      // The approval runs while the submission waits, or while its own record is pending (a killed run's),
      // so the lib's verify settles it; a done record is read back without a request.
      if ((await status(s)) === 'submitted' || b.state.records[approveName]) {
        await s.act(approveName, approver, 'POST', `${submissions}/${submissionId}/approve`, {}, {
          fields: { status: 'approved' },
          verify: async (s2) => (await status(s2)) === 'approved',
        });
      }
      const row = await mine(s);
      s.expectFields(row, { id: submissionId, status: 'approved', pctComplete: pct }, `${activity}: the submission ${ref}`);
      out[activity] = { pct, submissionId, status: row.status };
    }
    for (const { activity, pct } of list) {
      const row = await s.get(approver, `${b.P}/activities/${activityIds[activity]}`);
      s.expectFields(row, { pctComplete: pct, approvedProgressUpdatedAt: is.present }, `${activity} approved progress`);
    }
    return out;
  });

module.exports = { activitiesF1, allocate, atMostOne, attach, budgetLines, cents, costCodes, listOf, money, one, pdf, portal, portalAct, progress, round2, tokenOf };
