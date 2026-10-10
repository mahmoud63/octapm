'use strict';

/**
 * CERT-3 deep population, 052-SCH-EV "CERT3 Programme and EV" (plan §3.2 "D2,
 * company 052"), 052 Summit General Contractors, USD, America/Chicago.
 *
 * "the F1 programme through to baseline. The core gates of WP-2 (T1, T3, T4
 * hold point, quantity T2/T3) and WP-3 T1-T4, with the same figures in USD. The
 * reporting zone (America/Chicago) is asserted through
 * reporting.timeZoneSource. Order (decided in WP-0): WP-2 T1, T3 and T4; then
 * A110 raised to 100; then WP-3 T1-T4; then quantity T2/T3."
 * (answers schedule.js D2, adjudication S1: D2.order.)
 *
 * The figures exist only at their moment in that order (WP-3 T1 is gone once
 * A310's quantities are approved), so each is asserted when it stands
 * (adjudication G1; builders' adjudication 087-OTH/052/006 item 3: the WP-3
 * proof for 052 reads this build's results file for them and checks the live
 * end state):
 *   WP-1   F1 imported by the planner, submitted, approved / activated /
 *          baselined by the PM over the 087-EV bill E-001..E-005 fully allocated
 *          (D2.WP1, D2.WP3.setup.boq / allocations);
 *   WP-2   T1 A110 40% submitted by the site engineer: official progress still
 *          0 and the EV report byte-identical to the one read before the
 *          submission; the site engineer's approval 403; the QS approves: EV
 *          24,000.00 (D2.WP2.T1ev); approving again 200 with still one
 *          ActivityProgress row; rejecting the approved one 400
 *          APPROVED_PROGRESS_LOCKED (WP2.T1, R3-11);
 *          T3 A120 (evidence required): submitted without evidence 400 with
 *          nothing written, as a draft 200, approving that draft 400 (WP2.T3,
 *          R3-11); then 50% with an uploaded document: EV 39,000.00 (D2.WP2.T3ev);
 *          T4 A130 25% through the form ITP hold point, one moment per step
 *          (R3-12): refused 409 ITP_HOLD_POINT_OPEN while pending (one hold
 *          point, EV unchanged), again when answered "fail" and completed
 *          (state failed); reopened by the quality engineer with a reason,
 *          passed, completed; approved: EV 61,500.00 (D2.WP2.T4ev);
 *          A110 raised to 100: EV 97,500.00 (D2.WP3.T1.ev);
 *   WP-3   087-EV's loadings and direct costs (WP3.setup); T1 at today: every
 *          D2.WP3.T1 leaf (PV 387,000.00, EV 97,500.00, AC 80,000.00, SPI
 *          0.251938, CPI 1.21875, EAC 317,538.46, SV, CV, ETC) and BAC 387,000.00;
 *          the reporting zone through the API: timeZone America/Chicago,
 *          timeZoneSource 'project', timeZoneNote null (D2.WP3.timeZone /
 *          timeZoneSource / timeZoneNote: createProject copies the workspace
 *          zone onto the project; the plan's 'organisation' is a finding,
 *          WP3-TZ-1); T2 +30,000.00 on A120 dated 2026-10-01: AC 110,000.00,
 *          CPI 0.886364 with the alert, EAC 436,615.38 (D2.WP3.T2); T3 at the
 *          2026-02-28 cutoff: PV 180,000.00, EV 0, AC expected 70,000.00 (today
 *          20,000.00: L34, the step is BLOCKED L34 with what HEAD answers)
 *          (D2.WP3.T3); T4 runs in process (D2.WP3.T4), nothing to build;
 *   WP-2   quantity T2: A310 typed 0 refused 400 QUANTITY_INVALID; typed 450 of
 *          900 m2: one entry, 50%, EV(A310) 67,500.00; typed again 409
 *          QUANTITY_ENTRIES_REQUIRED; T3: a 90 m2 entry bundled: installed 540,
 *          EV(A310) 81,000.00 (D2.WP2.quantityT2evA310 / quantityT3evA310,
 *          WP2.quantitiesA310, R3-11).
 *
 * HR-S2 is fixed at f599e67 (WP1-MS-1): the F1 approval and baseline answer
 * 200. The body is exported for the debug harness, which lives outside build/
 * (adjudication G9): C:\Temp\octapm-cert\scratch\build-debug\_debug-lane.js.
 *
 * Run alone: node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/build/052-sch-ev.js
 */

const crypto = require('crypto');
const lib = require('./lib');
const lanes = require('./lanes');

const { is } = lib;
const S = lib.answers.schedule;
const D2 = S.D2;
const WP2 = S.WP2;
const EV = lanes.EV;
const listOf = lanes.listOf;
const { r6, atMostOne, taggedWith } = lanes; // G6 / R2-D: every find by identity names at most one record

/** A 1 x 1 PNG (the site photo; scripts/cert/drivers/progress.js PNG_1X1). */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** Sorted-key JSON (R1-20): the same report gives the same text whatever order its keys were written in. */
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
};

/** A submission row found again by its notes, in the shape the submit answers ({ submission }). */
const submissionFound = (row) => (row ? { submission: row } : null);

async function body(b, opts = {}) {
  const debug = Boolean(opts.debug);
  b.assert(D2.WP3.T1.ev.value === 9750000 && D2.WP2.T1ev.value === 2400000 && D2.WP2.T3ev.value === 3900000 && D2.WP2.T4ev.value === 6150000, 'answers D2: EV 24,000 / 39,000 / 61,500 / 97,500');
  b.assert(D2.WP2.T4ev.value === WP2.T4.reopenedPassed.ev.value && D2.WP2.T3ev.value === WP2.T4.evUnchanged.value, 'answers D2.WP2 agree with WP2.T4');

  await b.project({
    title: 'Programme and EV',
    payload: { startDate: S.inputs.start, endDate: '2026-12-31', projectCalendar: 'five_day', currency: 'USD', type: 'building', contractType: 'unit_rate' },
    fields: { projectCalendar: 'five_day', currency: 'USD', startDate: is.day(S.inputs.start) },
  });
  await b.team({ planner: 'planning_eng', qs: 'qs', site: 'site_engineer', quality: null, cost: 'cost_controller', finance: 'finance' });

  // ── WP-1: F1 through to baseline (D2.WP1) ──
  await lanes.scheduleF1(b, { importer: 'planner', submitter: 'planner', approver: 'pm', activator: 'pm', model: opts.f1Model });
  if (!debug) await lanes.assertF1Cpm(b, 'planner');
  const codes = await lanes.costCodes(b, { admin: 'pm', codes: [{ suffix: '01', name: 'Works', category: 'subcontract' }] });
  await lanes.boqEv(b, { uploader: 'qs' });
  await lanes.allocationsEv(b, { creator: 'planner', approver: 'qs' });
  // The site engineer on the activities whose progress the lane submits (not A330: WP-2 T2's 403 stays possible).
  await lanes.assignEngineers(b, { persona: 'planner', engineer: 'site', codes: ['A110', 'A120', 'A130', 'A310', 'A320'] });
  await lanes.baselineF1(b, { persona: 'pm' });

  const act = () => b.out('schedule.activate.F1').activities;
  const evAt = (s, cutoff = null) => lanes.evTotals(s, b, 'cost', cutoff);
  const assertEv = async (s, cents, label) => {
    const t = await evAt(s);
    s.assert(lib.toCents(t.ev) === cents, `${label}: EV ${lib.formatCents(cents)} (got ${t.ev})`, t.raw);
    return t;
  };
  /** The EV report as JSON with sorted keys and without asOfDate (the read time), hashed (WP2.T1.evReportAfterSubmit). */
  const evHash = async (s) => {
    const report = JSON.parse(JSON.stringify(await s.get('cost', `${b.P}/reports/ev`)));
    if (report.reporting) delete report.reporting.asOfDate;
    return crypto.createHash('sha256').update(canonical(report)).digest('hex');
  };

  // ── progress methods (WP2.setup.methods for the activities this lane uses) ──
  await b.step('progress.methods', async (s) => {
    const config = { A110: { method: 'percent', evidenceRequired: false }, A120: { method: 'percent', evidenceRequired: true }, A310: { method: 'quantity', quantityUnit: 'm2' } };
    const out = {};
    for (const [code, cfg] of Object.entries(config)) {
      const route = `${b.P}/activities/${act()[code]}/progress-method`;
      await s.act(`method.${code}`, 'planner', 'PUT', route, { ...cfg, notes: `${b.ref(`METHOD-${code}`)} ${cfg.method}` }, {
        named: true,
        fields: { method: cfg.method, ...(cfg.evidenceRequired !== undefined ? { evidenceRequired: cfg.evidenceRequired } : {}), ...(cfg.quantityUnit ? { quantityUnit: cfg.quantityUnit } : {}) },
        verify: async (s2) => {
          const read = await s2.get('planner', route);
          return read?.method === cfg.method && (cfg.evidenceRequired === undefined || read?.evidenceRequired === cfg.evidenceRequired);
        },
      });
      out[code] = cfg.method;
    }
    // WP2.setup.A310planned: 900 m2 planned from the approved allocation (E-004).
    const view = await s.get('planner', `${b.P}/activities/${act().A310}/quantities`);
    s.expectFields(view, { 'progress.method': 'quantity', 'progress.planned.value': is.number(WP2.setup.A310planned.value) }, 'A310 planned quantity');
    return out;
  }, { needs: ['boq.allocations', 'schedule.activate.F1'] });

  // ── the form ITP: one hold item, an instance on A130 (WP-2 T4) ──
  /** The hold point of THIS instance and item on A130, by identity (G6): { open, mine: [...] }. */
  const holdsOf = async (s2, instanceId, holdItemId) => {
    const list = await s2.get('quality', `${b.P}/forms/hold-points?activityId=${act().A130}`);
    return { open: list?.open, mine: (list?.holdPoints || []).filter((h) => h.instanceId === instanceId && h.itemId === holdItemId) };
  };
  const itp = await b.step('itp', async (s) => {
    const name = b.name('Foundation pour ITP');
    const templates = `${b.P}/forms/templates`;
    const template = await s.create('itp.template', 'quality', templates, {
      name, type: 'itp', status: 'active', description: `${b.ref('ITP-T1')} inspection and test plan for the foundation pour`,
      sections: [{ title: 'Before the pour', items: [{ label: 'Formwork, reinforcement and cover checked and released for the pour', responseType: 'pass_fail', isHoldPoint: true, reference: 'Structural GA' }] }],
    }, {
      fields: { name, type: 'itp', status: 'active', holdPointCount: 1, itemCount: 1 },
      get: (id) => `${templates}/${id}`,
      find: async (s2) => atMostOne(s2, listOf(await s2.get('quality', `${templates}?scope=project&type=itp`)), (t) => t.name === name, `ITP template ${name}`),
    });
    const holdItems = (template.sections || []).flatMap((sec) => sec.items || []).filter((i) => i.isHoldPoint);
    s.assert(holdItems.length === 1, 'the template carries exactly one hold item', template.sections);
    const holdItemId = holdItems[0].id;
    const clientRequestId = b.ref('ITP-A130');
    const instance = await s.create('itp.instance', 'quality', `${b.P}/forms`, {
      templateId: template.id, title: b.name('ITP A130 foundation pour'), activityId: act().A130, inspectorUserId: await b.userId('quality'), clientRequestId,
    }, {
      fields: {
        templateId: template.id, type: 'itp', activityId: act().A130, status: 'scheduled',
        // WP2.T4.holdState: the one hold item of this instance, pending
        holdPoints: (v) => {
          const mine = (v || []).filter((h) => h.itemId === holdItemId);
          return (Array.isArray(v) && v.length === 1 && mine.length === 1 && mine[0].state === WP2.T4.holdState.value) || `one hold point on item ${holdItemId}, ${WP2.T4.holdState.value}`;
        },
      },
      get: (id) => `${b.P}/forms/${id}`,
      // An interrupted create is found by its clientRequestId on A130's ITP instances (exactly one).
      find: async (s2) => {
        const rows = listOf(await s2.get('quality', `${b.P}/forms?activityId=${act().A130}&type=itp`)).filter((f) => f.clientRequestId === clientRequestId);
        if (rows.length > 1) throw new lib.BuildError(`itp.instance: ${rows.length} ITP instances carry ${clientRequestId}; resolve by hand`);
        return rows[0] ? s2.get('quality', `${b.P}/forms/${rows[0].id}`) : null;
      },
    });
    const holds = await holdsOf(s, instance.id, holdItemId);
    // WP2.T4.openList: 1 open, pending (this instance's hold item)
    s.assert(holds.open === WP2.T4.openList.value && holds.mine.length === 1 && holds.mine[0].state === WP2.T4.holdState.value, `A130 shows ${WP2.T4.openList.value} open hold point, this instance's, ${WP2.T4.holdState.value}`, holds);
    return { templateId: template.id, instanceId: instance.id, holdItemId };
  }, { needs: ['schedule.activate.F1'] });

  // ── an uploaded site photo: the stored project document A120's evidence names (HR-X1) ──
  const photo = await b.step('photo', async (s) => {
    const filename = b.file('site-photo.png');
    const mine = (d) => listOf(d).filter((f) => f.fileName === filename || f.filename === filename);
    const data = await s.upload('photo', 'site', `${b.P}/site-reporting/uploads`, { filename, body: PNG_1X1, contentType: 'image/png' }, {
      field: 'files',
      // The upload answers the files it stored: this one, by its name (G6). No lookup lists them, so an
      // interrupted upload is never sent again (fail closed); the step's verify reads the file back.
      idOf: (d) => (mine(d).length === 1 ? mine(d)[0].documentId : null),
      get: null,
      fields: { $status: 201, '0': (v, d) => (mine(d).length === 1 && Boolean(mine(d)[0].key)) || `one stored file named ${filename}` },
    });
    const [file] = mine(data);
    return { documentId: file.documentId, key: file.key, filename };
  }, {
    needs: ['team'],
    verify: async (s, out) => {
      const res = await s.send('site', 'GET', `${b.P}/site-reporting/uploads/${out.documentId}`);
      return res.status === 200 || `the site photo ${out.documentId} reads back ${lib.said(res)}`;
    },
  });

  // ── WP-2 T1: A110 40% (WP2.T1, D2.WP2.T1ev, R3-11), each gate at its moment ──
  // The EV report before the submission, the reference of the byte-identical check (WP2.T1.evReportAfterSubmit).
  const evBefore = await b.step('wp2.T1.before', async (s) => {
    const t = await evAt(s);
    s.assert(lib.toCents(t.ev) === WP2.setup.evBefore.value, `no approved progress yet: EV ${lib.formatCents(WP2.setup.evBefore.value)} (got ${t.ev})`, t.raw);
    return { evHash: await evHash(s), ev: t.ev, reference: 'sha256 of the GET /reports/ev answer as sorted-key JSON without reporting.asOfDate' };
  }, { needs: ['schedule.assign', 'boq.allocations', 'progress.methods'] });
  await lanes.progress(b, {
    step: 'wp2.T1', code: 'A110', pct: 40, submitter: 'site', approver: 'qs', needs: ['schedule.assign', 'boq.allocations', 'progress.methods', 'wp2.T1.before'],
    gates: {
      beforeApprove: async (s, ctx) => {
        const out = {};
        if (ctx.waiting) {
          // WP2.T1.officialAfterSubmit: 0 (only approval writes official progress); WP2.T1.evReportAfterSubmit: byte-identical
          const official = Number((await s.get('qs', ctx.A))?.pctComplete);
          s.assert(official === WP2.T1.officialAfterSubmit.value, `A110 official progress stays ${WP2.T1.officialAfterSubmit.value} after the submission (got ${official})`);
          const hash = await evHash(s);
          s.assert(hash === evBefore.evHash, `the EV report is byte-identical after the submission (${WP2.T1.evReportAfterSubmit.value}; before ${evBefore.evHash}, after ${hash})`);
          Object.assign(out, { officialAfterSubmit: official, evReportAfterSubmit: hash === evBefore.evHash ? 'byte_identical' : hash });
        }
        // WP2.T1.siteApprove: 403 FORBIDDEN (progress:approve is PM, planning engineer, QS)
        const site = await s.refused('wp2.T1.site-approve', 'site', 'POST', ctx.approveRoute, {}, WP2.T1.siteApprove.value, {
          named: false,
          find: async (s2) => (await ctx.subs(s2)).find((x) => x.id === ctx.submissionId && x.status === 'approved') || null,
        });
        return { ...out, siteApprove: site.said };
      },
      afterApprove: async (s, ctx) => {
        // WP2.T1.approveAgain: 200, idempotent, still one ActivityProgress row for the submission
        await s.act('wp2.T1.approve-again', 'qs', 'POST', ctx.approveRoute, {}, {
          fields: { '$status': WP2.T1.approveAgain.http.value, status: 'approved', id: ctx.submissionId },
          verify: async (s2) => (await ctx.subs(s2)).find((x) => x.id === ctx.submissionId)?.status === 'approved',
        });
        const history = (await s.get('qs', `${ctx.A}/detail`))?.sections?.progress?.approvedHistory;
        const rows = listOf(history?.items ?? history).filter((row) => row.submissionId === ctx.submissionId);
        s.assert(rows.length === WP2.T1.approveAgain.progressRows.value, `still ${WP2.T1.approveAgain.progressRows.value} ActivityProgress row for the submission after approving it again (got ${rows.length})`, history);
        // WP2.T1.rejectApproved: 400 APPROVED_PROGRESS_LOCKED
        const reject = await s.refused('wp2.T1.reject-approved', 'qs', 'POST', `${ctx.A}/progress-submissions/${ctx.submissionId}/reject`, { reason: b.name('Rejecting the approved A110 submission (WP-2 T1 gate)') }, WP2.T1.rejectApproved.value, {
          find: async (s2) => (await ctx.subs(s2)).find((x) => x.id === ctx.submissionId && x.status === 'rejected') || null,
        });
        return { approveAgain: WP2.T1.approveAgain.http.value, progressRows: rows.length, rejectApproved: reject.said };
      },
    },
  });
  await b.step('wp2.T1.ev', async (s) => ({ ev: (await assertEv(s, D2.WP2.T1ev.value, 'WP-2 T1')).ev }), { needs: ['wp2.T1'] });

  // ── WP-2 T3: A120 (evidence required): the gates (WP2.T3, R3-11), then 50% with the uploaded photo: EV 39,000.00 ──
  await b.step('wp2.T3.gates', async (s) => {
    const A = `${b.P}/activities/${act().A120}`;
    const subs = async (s2) => listOf(await s2.get('qs', `${A}/progress-submissions`));
    const noEvidenceRef = b.ref('PROG-wp2.T3-no-evidence');
    // WP2.T3.submittedNoEvidence: 400 PROGRESS_EVIDENCE_REQUIRED, and nothing written (WP2.T3.rowsWritten)
    const noEvidence = await s.refused('wp2.T3.no-evidence', 'site', 'POST', `${A}/progress`, {
      pctComplete: 50, status: 'submitted', source: 'manual', notes: `${noEvidenceRef} A120 50% without evidence`,
    }, WP2.T3.submittedNoEvidence.value, {
      find: async (s2) => atMostOne(s2, await subs(s2), (x) => taggedWith(x.notes, noEvidenceRef), `submission ${noEvidenceRef}`),
    });
    const written = (await subs(s)).filter((x) => taggedWith(x.notes, noEvidenceRef)).length;
    s.assert(written === WP2.T3.rowsWritten.value, `the refused submission wrote ${WP2.T3.rowsWritten.value} rows (found ${written})`);
    // WP2.T3.draft: 200 (drafts skip the submit-time gate)
    const draftRef = b.ref('PROG-wp2.T3-draft');
    const draft = await s.create('wp2.T3.draft', 'site', `${A}/progress`, {
      pctComplete: 50, status: 'draft', source: 'manual', notes: `${draftRef} A120 50% draft without evidence`,
    }, {
      expect: WP2.T3.draft.value,
      idOf: (d) => d?.submission?.id ?? null,
      fields: { 'submission.status': 'draft', 'submission.id': is.present },
      get: () => `${A}/progress-submissions`,
      find: async (s2) => submissionFound(atMostOne(s2, await subs(s2), (x) => taggedWith(x.notes, draftRef), `draft ${draftRef}`)),
    });
    const draftId = draft?.submission?.id ?? draft?.id;
    // WP2.T3.approveDraft: 400 PROGRESS_EVIDENCE_REQUIRED (the gate applies again at approval)
    const approveDraft = await s.refused('wp2.T3.approve-draft', 'qs', 'POST', `${A}/progress-submissions/${draftId}/approve`, {}, WP2.T3.approveDraft.value, {
      named: false,
      find: async (s2) => (await subs(s2)).find((x) => x.id === draftId && x.status === 'approved') || null,
    });
    const after = (await subs(s)).filter((x) => x.id === draftId);
    s.assert(after.length === 1 && after[0].status === 'draft', 'the draft stays a draft after its approval is refused', after);
    return { submittedNoEvidence: noEvidence.said, rowsWritten: written, draftId, draft: WP2.T3.draft.value, approveDraft: approveDraft.said };
  }, { needs: ['schedule.assign', 'progress.methods', 'wp2.T1.ev'] });
  await lanes.progress(b, {
    step: 'wp2.T3', code: 'A120', pct: 50, submitter: 'site', approver: 'qs', needs: ['schedule.assign', 'progress.methods', 'photo', 'wp2.T3.gates'],
    payload: photo ? { evidence: { photos: [{ key: photo.key, documentId: photo.documentId, fileName: photo.filename, caption: b.name('Blinding poured') }], notes: b.name('Blinding to level, photographed') } } : {},
  });
  await b.step('wp2.T3.ev', async (s) => ({ ev: (await assertEv(s, D2.WP2.T3ev.value, 'WP-2 T3')).ev }), { needs: ['wp2.T3'] });

  // ── WP-2 T4: A130 25% through the hold point (WP2.T4, D2.WP2.T4ev), one moment per step (R3-12) ──
  const A130 = () => `${b.P}/activities/${act().A130}`;
  const F = () => `${b.P}/forms/${itp.instanceId}`;
  const formOf = (s2) => s2.get('quality', F());
  /** The response to the hold item, by identity: undefined when the item is not on the instance exactly once. */
  const holdResponse = async (s2) => {
    const items = ((await formOf(s2))?.sections || []).flatMap((sec) => sec.items || []).filter((i) => i.id === itp.holdItemId);
    return items.length === 1 ? items[0].response?.value ?? null : undefined;
  };
  const t4subs = async (s2) => listOf(await s2.get('qs', `${A130()}/progress-submissions`));
  const t4 = await b.step('wp2.T4.submit', async (s) => {
    const ref = b.ref('PROG-wp2.T4');
    const submitted = await s.create('wp2.T4.submit', 'site', `${A130()}/progress`, { pctComplete: 25, status: 'submitted', source: 'manual', notes: `${ref} A130 25%` }, {
      expect: WP2.T4.submit.value,
      idOf: (d) => d?.submission?.id ?? null,
      fields: { 'submission.status': 'submitted', 'submission.id': is.present },
      get: () => `${A130()}/progress-submissions`,
      find: async (s2) => submissionFound(atMostOne(s2, await t4subs(s2), (x) => taggedWith(x.notes, ref), `submission ${ref}`)),
    });
    return { submissionId: submitted?.submission?.id ?? submitted?.id };
  }, { needs: ['itp', 'schedule.assign', 'wp2.T3.ev'] });
  const approveT4 = () => `${A130()}/progress-submissions/${t4.submissionId}/approve`;
  const t4row = async (s2) => (await t4subs(s2)).find((x) => x.id === t4.submissionId) || null;
  const t4approvedRow = async (s2) => {
    const row = await t4row(s2);
    return row && row.status === 'approved' ? row : null;
  };

  // The hold pending: WP2.T4.approve 409 with one hold point (WP2.T4.holdPoints), state pending, EV unchanged (WP2.T4.evUnchanged).
  await b.step('wp2.T4.pending', async (s) => {
    const refusal = await s.refused('wp2.T4.approve.pending', 'qs', 'POST', approveT4(), {}, WP2.T4.approve.value, { named: false, find: t4approvedRow });
    const out = { approve: refusal.said };
    if (refusal.res) {
      const named = refusal.res.body?.error?.details?.holdPoints;
      s.assert(Array.isArray(named) && named.length === WP2.T4.holdPoints.value && named.filter((h) => h.instanceId === itp.instanceId && h.itemId === itp.holdItemId).length === 1, `the refusal names ${WP2.T4.holdPoints.value} hold point, this instance's`, refusal.res.body?.error);
      out.refusalHoldPoints = named.length;
    }
    const holds = await holdsOf(s, itp.instanceId, itp.holdItemId);
    s.assert(holds.mine.length === 1 && holds.mine[0].state === WP2.T4.holdState.value, `the hold point is ${WP2.T4.holdState.value}`, holds);
    const ev = lib.toCents((await evAt(s)).ev);
    s.assert(ev === WP2.T4.evUnchanged.value, `EV unchanged while the hold is open: ${lib.formatCents(WP2.T4.evUnchanged.value)} (got ${lib.formatCents(ev)})`);
    s.assert((await t4row(s))?.status === 'submitted', 'the A130 submission still waits');
    return { ...out, holdState: holds.mine[0].state, open: holds.open, evCents: ev };
  }, { needs: ['wp2.T4.submit'] });

  // Answered "fail" and completed: still 409, the hold failed (WP2.T4.failed).
  await b.step('wp2.T4.failed', async (s) => {
    await s.act('wp2.T4.itp.start', 'site', 'POST', `${F()}/start`, {}, {
      fields: { status: 'in_progress' },
      verify: async (s2) => (await formOf(s2))?.status !== 'scheduled',
    });
    await s.act('wp2.T4.itp.answer-fail', 'site', 'PUT', `${F()}/responses`, { responses: [{ itemId: itp.holdItemId, value: 'fail' }] }, {
      fields: { status: 'in_progress' },
      verify: async (s2) => (await holdResponse(s2)) === 'fail',
    });
    await s.act('wp2.T4.itp.complete-fail', 'site', 'POST', `${F()}/complete`, {}, {
      fields: { status: 'complete', outcome: 'fail' },
      verify: async (s2) => (await formOf(s2))?.outcome === 'fail',
    });
    const refusal = await s.refused('wp2.T4.approve.failed', 'qs', 'POST', approveT4(), {}, WP2.T4.failed.approve.value, { named: false, find: t4approvedRow });
    const holds = await holdsOf(s, itp.instanceId, itp.holdItemId);
    s.assert(holds.mine.length === 1 && holds.mine[0].state === WP2.T4.failed.state.value, `the hold point is ${WP2.T4.failed.state.value}`, holds);
    const form = await formOf(s);
    s.assert(form?.status === 'complete' && form?.outcome === 'fail', 'the instance is complete with outcome fail', { status: form?.status, outcome: form?.outcome });
    return { approve: refusal.said, holdState: holds.mine[0].state, outcome: form.outcome };
  }, { needs: ['wp2.T4.pending'] });

  // The quality engineer reopens with a reason, answers "pass" and completes (HR-Q1: a completed instance, the hold item passed).
  await b.step('wp2.T4.passed', async (s) => {
    await s.act('wp2.T4.itp.reopen', 'quality', 'POST', `${F()}/reopen`, { reason: b.name('Formwork corrected and re-inspected') }, {
      fields: { status: (v) => v !== 'complete' || 'reopened' },
      // Interrupted: reopened when the instance is no longer the completed, failed one.
      verify: async (s2) => {
        const form = await formOf(s2);
        return form?.status !== 'complete' || form?.outcome === 'pass';
      },
    });
    if (b.state.records['wp2.T4.itp.restart'] || (await formOf(s))?.status === 'scheduled') {
      await s.act('wp2.T4.itp.restart', 'quality', 'POST', `${F()}/start`, {}, { fields: { status: 'in_progress' }, verify: async (s2) => (await formOf(s2))?.status !== 'scheduled' });
    }
    await s.act('wp2.T4.itp.answer-pass', 'quality', 'PUT', `${F()}/responses`, { responses: [{ itemId: itp.holdItemId, value: 'pass' }] }, {
      fields: { status: 'in_progress' },
      verify: async (s2) => (await holdResponse(s2)) === 'pass',
    });
    await s.act('wp2.T4.itp.complete-pass', 'quality', 'POST', `${F()}/complete`, {}, {
      fields: { status: 'complete', outcome: 'pass' },
      verify: async (s2) => (await formOf(s2))?.outcome === 'pass',
    });
    const holds = await holdsOf(s, itp.instanceId, itp.holdItemId);
    s.assert(holds.mine.length === 0, 'the passed hold point is no longer open', holds);
    const form = await formOf(s);
    s.assert(form?.status === 'complete' && form?.outcome === 'pass', 'the instance is complete with outcome pass', { status: form?.status, outcome: form?.outcome });
    return { status: form.status, outcome: form.outcome, open: holds.open };
  }, { needs: ['wp2.T4.failed'] });

  // WP2.T4.reopenedPassed.approve: 200; EV 61,500.00 (D2.WP2.T4ev = WP2.T4.reopenedPassed.ev)
  await b.step('wp2.T4', async (s) => {
    await s.act('wp2.T4.approve', 'qs', 'POST', approveT4(), {}, {
      fields: { '$status': WP2.T4.reopenedPassed.approve.value, status: 'approved' },
      verify: async (s2) => Boolean(await t4approvedRow(s2)),
    });
    const t = await assertEv(s, D2.WP2.T4ev.value, 'WP-2 T4');
    return { submissionId: t4.submissionId, ev: t.ev };
  }, { needs: ['wp2.T4.passed'] });

  // ── A110 raised to 100 (D2.order): EV 97,500.00 ──
  await lanes.progress(b, { step: 'a110.100', code: 'A110', pct: 100, submitter: 'site', approver: 'qs', needs: ['wp2.T4'] });
  await b.step('a110.100.ev', async (s) => ({ ev: (await assertEv(s, D2.WP3.T1.ev.value, 'A110 at 100')).ev }), { needs: ['a110.100'] });

  // ── WP-3 setup: 087-EV's loadings and direct costs (D2.WP3.setup; WP3.setup.loadings / directCosts) ──
  await lanes.loadingsEv(b, { creator: 'cost', approver: 'finance' });
  await lanes.directCostsEv(b, { creator: 'cost', approver: 'finance', costCodeId: codes['01'] });

  // ── WP-3 T1 at today: every D2.WP3.T1 leaf, BAC, and the reporting zone (D2.WP3.timeZone / timeZoneSource / timeZoneNote) ──
  await b.step('wp3.T1', async (s) => {
    const t = await evAt(s);
    const bac = Object.values(D2.WP3.setup.allocations.value).reduce((x, y) => x + y, 0); // 387,000.00
    s.assert(lib.toCents(t.bac) === bac, `BAC ${lib.formatCents(bac)} (got ${t.bac})`, t.raw);
    const figures = lanes.assertMetricLeaves(s, t, D2.WP3.T1, 'D2.WP3.T1');
    s.assert(figures.ev - figures.pv === D2.WP3.T1.sv.value && figures.ev - figures.ac === D2.WP3.T1.cv.value && figures.eac - figures.ac === D2.WP3.T1.etc.value, 'SV, CV and ETC agree with the reported PV, EV, AC and EAC', t.raw);
    let zone;
    if (debug) {
      // The debug harness runs this body in 087: the zone is that company's, the source the same rule's.
      const rep = t.reporting || {};
      s.assert(rep.timeZone === b.company.timezone && rep.timeZoneSource === D2.WP3.timeZoneSource.value, `the reporting zone is ${b.company.timezone}, source '${D2.WP3.timeZoneSource.value}' (got ${rep.timeZone}, ${rep.timeZoneSource})`, rep);
      zone = { timeZone: rep.timeZone, timeZoneSource: rep.timeZoneSource, timeZoneNote: rep.timeZoneNote };
    } else {
      // (and, where the plan's 'organisation' differs, the WP3-TZ-1 finding: lanes.assertReportingZone)
      zone = lanes.assertReportingZone(s, b, t.reporting, D2.WP3, 'D2.WP3');
    }
    return { bac: lib.toCents(t.bac), ...figures, ...zone };
  }, { needs: ['a110.100.ev', 'ev.loadings', 'ev.costs'] });

  // ── WP-3 T2: +30,000.00 on A120 dated 2026-10-01 (D2.WP3.T2) ──
  await lanes.directCostsEv(b, { creator: 'cost', approver: 'finance', costCodeId: codes['01'], rows: [EV.t2Cost], step: 'ev.costs.T2', needs: ['wp3.T1'] });
  await b.step('wp3.T2', async (s) => lanes.assertMetricLeaves(s, await evAt(s), D2.WP3.T2, 'D2.WP3.T2'), { needs: ['ev.costs.T2'] });

  // ── WP-3 T3: cutoff 2026-02-28 (D2.WP3.T3): AC expected 70,000.00; HEAD 20,000.00 (L34) ──
  await b.step('wp3.T3', async (s) => {
    const t = await evAt(s, '2026-02-28');
    const want = D2.WP3.T3;
    s.assert(lib.toCents(t.pv) === want.pv.value && lib.toCents(t.ev) === want.ev.value, `PV ${lib.formatCents(want.pv.value)} and EV 0 at the 2026-02-28 cutoff (got ${t.pv} / ${t.ev})`, t.raw);
    // D2.WP3.T3.cutoff: the end of 2026-02-28 in America/Chicago (the debug harness runs in 087's zone: not compared there).
    if (!debug) s.assert(t.reporting?.cutoffDate === want.cutoff.value, `the cutoff instant is ${want.cutoff.value} (got ${t.reporting?.cutoffDate})`, t.reporting);
    const ac = lib.toCents(t.ac);
    if (ac === want.ac.value) return { pv: t.pv, ev: t.ev, ac: t.ac, cutoffDate: t.reporting?.cutoffDate ?? null };
    if (ac === want.ac.today) s.blocked('L34', { expected: lib.formatCents(want.ac.value), today: t.ac, pv: t.pv, ev: t.ev, cutoffDate: t.reporting?.cutoffDate ?? null, note: 'AC at a past cutoff: HEAD keeps one cumulative CostRecord per activity (A110 60,000 through 09-30 drops out whole); red until L34 is fixed (HR-E1)' });
    s.assert(false, `AC at the 2026-02-28 cutoff is neither ${lib.formatCents(want.ac.value)} nor L34's ${lib.formatCents(want.ac.today)} (got ${t.ac})`, t.raw);
    return null;
  }, { needs: ['wp3.T2'] });
  b.note('WP-3 T4 runs in process (answers D2.WP3.T4 "as WP3.T4"): nothing to build');

  // ── WP-2 quantity T2/T3 on A310 (WP2.quantitiesA310; D2.WP2.quantityT2evA310 / quantityT3evA310) ──
  const A310 = () => `${b.P}/activities/${act().A310}`;
  const a310subs = async (s2) => listOf(await s2.get('qs', `${A310()}/progress-submissions`));
  /**
   * EV(A310): A310's own row of the EV report, by identity (exactly one; G6). The breakdown names an activity
   * by its code (earned-value.service.js: activityId = activityCode || p6ActivityId || id), so the row is
   * the one whose activityId is A310's code or its id.
   */
  const evA310 = async (s) => {
    const t = await evAt(s);
    const rows = t.activityBreakdown.filter((a) => a.activityId === 'A310' || a.activityId === act().A310);
    s.assert(rows.length === 1, `the EV report breaks A310 down exactly once (found ${rows.length})`, t.activityBreakdown.map((a) => a.activityId));
    return lib.toCents(rows[0].ev);
  };
  const entriesOn = async (s2, status = null) => listOf(await s2.get('site', `${b.P}/quantity-progress?activityId=${act().A310}${status ? `&status=${status}` : ''}`));
  await b.step('wp2.qty.T2', async (s) => {
    // WP2.quantitiesA310.typedZero: 400 QUANTITY_INVALID
    const zeroRef = b.ref('PROG-qty.T2-zero');
    const zero = await s.refused('wp2.qty.T2.zero', 'site', 'POST', `${A310()}/progress`, {
      status: 'submitted', source: 'manual', method: 'quantity', quantityComplete: 0, quantityUnit: 'm2', notes: `${zeroRef} A310 typed 0 m2`,
    }, WP2.quantitiesA310.typedZero.value, {
      find: async (s2) => atMostOne(s2, await a310subs(s2), (x) => taggedWith(x.notes, zeroRef), `submission ${zeroRef}`),
    });
    const ref = b.ref('PROG-qty.T2');
    const made = await s.create('wp2.qty.T2.submit', 'site', `${A310()}/progress`, { status: 'submitted', source: 'manual', method: 'quantity', quantityComplete: 450, quantityUnit: 'm2', notes: `${ref} A310 typed 450 m2` }, {
      expect: 200,
      idOf: (d) => d?.submission?.id ?? null,
      fields: { 'submission.status': 'submitted', 'submission.id': is.present },
      get: () => `${A310()}/progress-submissions`,
      find: async (s2) => submissionFound(atMostOne(s2, await a310subs(s2), (x) => taggedWith(x.notes, ref), `submission ${ref}`)),
    });
    const id = made?.submission?.id ?? made?.id;
    await s.act('wp2.qty.T2.approve', 'qs', 'POST', `${A310()}/progress-submissions/${id}/approve`, {}, { fields: { status: 'approved' }, verify: async (s2) => (await a310subs(s2)).find((x) => x.id === id)?.status === 'approved' });
    const official = Number((await s.get('qs', A310()))?.pctComplete);
    s.assert(official === WP2.quantitiesA310.typed450.pct.value, `A310 official ${WP2.quantitiesA310.typed450.pct.value}% (got ${official})`);
    // WP2.quantitiesA310.typed450.entriesCreated: one approved entry minted
    const entries = await entriesOn(s);
    s.assert(entries.length === WP2.quantitiesA310.typed450.entriesCreated.value && entries.every((e) => e.status === 'approved'), `typed 450 minted ${WP2.quantitiesA310.typed450.entriesCreated.value} approved entry on A310 (found ${entries.map((e) => `${e.quantity} ${e.status}`).join(', ')})`);
    const ev = await evA310(s);
    s.assert(ev === D2.WP2.quantityT2evA310.value, `EV(A310) ${lib.formatCents(D2.WP2.quantityT2evA310.value)} (got ${lib.formatCents(ev)})`);
    // WP2.quantitiesA310.typedAgain: 409 QUANTITY_ENTRIES_REQUIRED (a typed quantity once entries exist)
    const againRef = b.ref('PROG-qty.T2-again');
    const again = await s.refused('wp2.qty.T2.typed-again', 'site', 'POST', `${A310()}/progress`, {
      status: 'submitted', source: 'manual', method: 'quantity', quantityComplete: 450, quantityUnit: 'm2', notes: `${againRef} A310 typed 450 m2 again`,
    }, WP2.quantitiesA310.typedAgain.value, {
      find: async (s2) => atMostOne(s2, await a310subs(s2), (x) => taggedWith(x.notes, againRef), `submission ${againRef}`),
    });
    return { typedZero: zero.said, submissionId: id, official, entries: entries.length, evA310: ev, typedAgain: again.said };
  }, { needs: ['wp3.T1', 'progress.methods', 'schedule.assign'] });

  await b.step('wp2.qty.T3', async (s) => {
    const items = b.out('boq.upload').items;
    const allocationId = b.out('boq.allocations').A310.id;
    const clientRequestId = b.ref('QTY-A310-90');
    const entry = await s.create('wp2.qty.T3.entry', 'site', `${b.P}/quantity-progress`, {
      activityId: act().A310, boqItemId: items['E-004'], allocationId, quantity: 90, date: b.past(b.date(-1)), status: 'submitted', note: `${clientRequestId} 90 m2`, clientRequestId,
    }, {
      idOf: (d) => d?.entry?.id ?? null,
      fields: { 'entry.status': 'submitted', 'entry.quantity': is.number(90) },
      get: (id) => `${b.P}/quantity-progress/${id}`,
      find: async (s2) => {
        const rows = (await entriesOn(s2)).filter((e) => e.clientRequestId === clientRequestId);
        if (rows.length > 1) throw new lib.BuildError(`wp2.qty.T3.entry: ${rows.length} entries carry ${clientRequestId}; resolve by hand`);
        return rows[0] ? { entry: rows[0] } : null;
      },
    });
    const entryId = entry?.entry?.id ?? entry?.id;
    const ref = b.ref('PROG-qty.T3');
    const made = await s.create('wp2.qty.T3.submit', 'site', `${A310()}/progress`, { status: 'submitted', source: 'manual', entryIds: [entryId], notes: `${ref} A310 90 m2 bundled` }, {
      expect: 200,
      idOf: (d) => d?.submission?.id ?? null,
      fields: { 'submission.status': 'submitted', 'submission.id': is.present },
      get: () => `${A310()}/progress-submissions`,
      find: async (s2) => submissionFound(atMostOne(s2, await a310subs(s2), (x) => taggedWith(x.notes, ref), `submission ${ref}`)),
    });
    const id = made?.submission?.id ?? made?.id;
    await s.act('wp2.qty.T3.approve', 'qs', 'POST', `${A310()}/progress-submissions/${id}/approve`, {}, { fields: { status: 'approved' }, verify: async (s2) => (await a310subs(s2)).find((x) => x.id === id)?.status === 'approved' });
    const installed = (await entriesOn(s, 'approved')).reduce((sum, e) => sum + Number(e.quantity), 0);
    s.assert(installed === WP2.quantitiesA310.bundle90.installed.value, `installed ${WP2.quantitiesA310.bundle90.installed.value} m2 (got ${installed})`);
    const official = Number((await s.get('qs', A310()))?.pctComplete);
    s.assert(r6(official) === r6(WP2.quantitiesA310.bundle90.pct.value), `A310 official ${WP2.quantitiesA310.bundle90.pct.value}% (got ${official})`);
    const ev = await evA310(s);
    s.assert(ev === D2.WP2.quantityT3evA310.value, `EV(A310) ${lib.formatCents(D2.WP2.quantityT3evA310.value)} (got ${lib.formatCents(ev)})`);
    return { entryId, submissionId: id, installed, official, evA310: ev };
  }, { needs: ['wp2.qty.T2'] });
}

if (require.main === module) lib.main('052-SCH-EV', (b) => body(b));
module.exports = { body };
