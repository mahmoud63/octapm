'use strict';

/**
 * Proof for the "rfi-submittal-2" group — the independent review of the first
 * RFI / submittal round (findings R1-R13, one company's own project: a party
 * guest or a role reaching a decision, a figure or a record that is not theirs).
 *
 * Every guard is shown twice: the refusal of the caller the decision or the
 * record is not theirs, AND the same kind of request succeeding for the caller
 * it belongs to — so a fix that turned into a blanket refusal fails here too.
 *
 *   H1  (R1, R6, R12 — refuted) an RFI never moves into draft, nor from closed
 *       to answered: the approval-workflow transition table refuses those edges
 *       (409), and leaving closed for open needs rfi.reopen (403)
 *   H2  a closed RFI's impact figures change only for rfi.close        (R8)
 *   H3  a new RFI revision (bumpRevision) through PATCH needs rfi.reopen (R9)
 *   H4  the RFI assistant's record routes answer a caller without their
 *       permission the same for a missing and an existing RFI          (R11)
 *   H5  (R2 — refuted) a decided or in-review submittal never moves to pending,
 *       nor from approved back into review: the transition table refuses it
 *   H6  /submit, /resubmit and /review take only their own fields     (R3)
 *   H7  a reviewer the submittal's review route named opens it and decides
 *       it, alone and in its package; party routing holds for the rest (R4)
 *   H8  /:id/decide refuses an unrouted, unassigned guest the same whatever
 *       the submittal's status                                         (R11)
 *   H9  a party member files a submittal only into a package they can open (R10)
 *   H10 a decided submittal's review stamp is the reviewer's           (R8)
 *   H11 a new review cycle carries no response code of the last one
 *       (found reproducing R3: a resubmitted, then approved submittal kept
 *       the "Rejected" code of its earlier return)
 *
 * Stage: project 072-01 (company 072): the PM, the internal site engineer,
 * planner and QS, and the party guests SUB-X, SUB-Y and CONSULTANT
 * (scripts/cert/leads/lib/party-visibility.js). Run in process:
 *
 *   $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/rfi-submittal-2-proof.js [--only=H2,H6]
 *
 * Exit 0 = every refusal and every allowed case holds; 2 = a refusal failed
 * (a defect is present); 3 = only an allowed case failed (over-blocking);
 * 1 = the script itself failed.
 */

const pv = require('../leads/lib/party-visibility');

const ONLY = (process.argv.find((arg) => arg.startsWith('--only=')) || '').slice('--only='.length).split(',').filter(Boolean);
const wants = (...guards) => !ONLY.length || guards.some((guard) => ONLY.includes(guard));
const stamp = () => new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const results = [];
const MISSING = '0b5e2c1a-7d4f-4e3a-9c1b-2f6d8e0a4b7c';

const check = (guard, kind, label, pass, detail = '') => {
  results.push({ guard, kind, label, pass: Boolean(pass), detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${guard} ${kind.padEnd(7)} ${label}${detail ? ` — ${detail}` : ''}`);
};
const refused = (res, codes) => [403, 404, 409].includes(res.status) && codes.includes(res.body?.error?.code);
const said = (res) => `${res.status} ${res.body?.error?.code || ''}`.trim();
const data = (res) => res.body?.data;
const ok = (res) => res.status >= 200 && res.status < 300;
const same = (a, b) => a.status === b.status && (a.body?.error?.code || null) === (b.body?.error?.code || null);
const FORBIDDEN = ['FORBIDDEN'];
const NO_EDGE = ['APPROVAL_WORKFLOW_INVALID_TRANSITION'];
const PARTY = ['PROJECT_PARTY_RECORD_ACCESS_DENIED'];

pv.main(async () => {
  const s = await pv.setup();
  const P = s.projectId;
  const tag = stamp();
  const X = s.subX;
  const Y = s.subY;
  const C = s.consultant;
  const PM = s.pm;
  const site = pv.api.as(`site@c${pv.CODE}.octapm-cert.test`);
  const planner = pv.api.as(`planner@c${pv.CODE}.octapm-cert.test`);
  const qs = pv.api.as(`qs@c${pv.CODE}.octapm-cert.test`);
  const R = (id) => `/projects/${P}/rfi/${id}`;
  const S = (id) => `/projects/${P}/submittals/${id}`;
  const PK = (id) => `/projects/${P}/submittals/packages/${id}`;
  console.log(`rfi-submittal-2 proof — project ${P} (072-01), run ${tag}${ONLY.length ? `, only ${ONLY.join(',')}` : ''}`);

  const need = (res, what) => {
    if (!ok(res)) throw new Error(`set-up: ${what} answered ${said(res)} ${JSON.stringify(res.body?.error?.details || '').slice(0, 300)}`);
    return data(res);
  };
  const rfiOf = async (who, fields) => need(await who.send('POST', `/projects/${P}/rfi`, { question: 'q', status: 'open', ...fields }), `raising RFI "${fields.subject}"`);
  const rfiNow = async (id) => data(await PM.send('GET', R(id)));
  const answered = async (id, text) => need(await PM.send('POST', `${R(id)}/answer`, { response: text }), 'the PM answering');
  const closed = async (id) => need(await PM.send('POST', `${R(id)}/close`, { comment: 'closed by the PM' }), 'the PM closing');
  const subOf = async (who, fields) => need(await who.send('POST', `/projects/${P}/submittals`, fields), `raising submittal "${fields.title}"`);
  const submitted = async (who, id, body = { revision: 'A' }) => need(await who.send('POST', `${S(id)}/submit`, body), 'submitting');
  const subNow = async (id) => data(await PM.send('GET', S(id)));
  const approved = async (id) => need(await PM.send('POST', `${S(id)}/approve`, { comment: 'approved by the PM' }), 'the PM approving');
  const rejected = async (id) => need(await PM.send('POST', `${S(id)}/reject`, { reason: 'rejected by the PM' }), 'the PM rejecting');

  // ── H1: RFI edges that would undo a decision or reach a draft (R1, R6, R12 — refuted) ──
  if (wants('H1')) {
    console.log('\n== H1 RFI edges into draft, or from closed to answered (R1, R6, R12 — refuted) ==');
    const r1 = await rfiOf(X, { subject: `PROOF2 H1 decided ${tag}` });
    await answered(r1.id, `PM answer ${tag}`);
    const ansDraft = await X.send('PATCH', R(r1.id), { status: 'draft' });
    const ansOpen = await site.send('PATCH', R(r1.id), { status: 'open' });
    const afterAns = await rfiNow(r1.id);
    check('H1', 'refuse', 'SUB-X moves an answered RFI to draft (no edge); the site engineer (no rfi.reject) moves it back to open', refused(ansDraft, NO_EDGE) && refused(ansOpen, FORBIDDEN) && afterAns?.status === 'answered', `${said(ansDraft)}, ${said(ansOpen)}; RFI ${afterAns?.status}`);
    await closed(r1.id);
    const toDraft = await X.send('PATCH', R(r1.id), { status: 'draft' });
    const thenOpen = await X.send('PATCH', R(r1.id), { status: 'open' });
    const rewrite = await site.send('PATCH', R(r1.id), { status: 'answered', response: `site rewrite ${tag}` });
    const pmSees = await PM.send('GET', R(r1.id));
    const afterClosed = data(pmSees);
    check('H1', 'refuse', 'SUB-X moves a closed RFI to draft or to open; the site engineer (rfi.answer, no rfi.reopen) moves it to answered with a new answer', refused(toDraft, NO_EDGE) && refused(thenOpen, FORBIDDEN) && refused(rewrite, NO_EDGE) && pmSees.status === 200 && afterClosed?.status === 'closed' && afterClosed?.response === `PM answer ${tag}`, `${said(toDraft)}, ${said(thenOpen)}, ${said(rewrite)}; PM GET ${said(pmSees)}, RFI ${afterClosed?.status}, response ${JSON.stringify(afterClosed?.response)}`);
    const r2 = await rfiOf(X, { subject: `PROOF2 H1 open ${tag}` });
    const openDraft = await X.send('PATCH', R(r2.id), { status: 'draft' });
    const pmDraft = await PM.send('PATCH', R(r2.id), { status: 'draft' });
    const born = await X.send('POST', `/projects/${P}/rfi`, { subject: `PROOF2 H1 born draft ${tag}`, question: 'q', status: 'draft' });
    const afterOpen = await rfiNow(r2.id);
    check('H1', 'refuse', 'SUB-X and the PM send an open RFI back to draft; SUB-X raises one as a draft (no draft can exist, so none is private)', refused(openDraft, NO_EDGE) && refused(pmDraft, NO_EDGE) && refused(born, NO_EDGE) && afterOpen?.status === 'open', `${said(openDraft)}, ${said(pmDraft)}, raise ${said(born)}; RFI ${afterOpen?.status}`);
    const siteAnswer = await site.send('PATCH', R(r2.id), { status: 'answered', response: `site answer ${tag}` });
    const pmBack = await PM.send('PATCH', R(r2.id), { status: 'open', comment: 'returned by the PM' });
    const pmReopen = await PM.send('PATCH', R(r1.id), { status: 'open', comment: 'reopened by the PM' });
    check('H1', 'allow', 'the site engineer (rfi.answer) answers an open RFI through PATCH; the PM returns it (rfi.reject) and reopens a closed one (rfi.reopen)', siteAnswer.status === 200 && data(siteAnswer)?.status === 'answered' && pmBack.status === 200 && data(pmBack)?.status === 'open' && pmReopen.status === 200 && data(pmReopen)?.status === 'open', `${said(siteAnswer)}, ${said(pmBack)}, ${said(pmReopen)}`);
  }

  // ── H2: a closed RFI's figures (R8) ───────────────────────────────────────
  if (wants('H2')) {
    console.log('\n== H2 a closed RFI\'s impact figures (R8) ==');
    const r4 = await rfiOf(X, { subject: `PROOF2 H2 figures ${tag}`, costImpact: true, costImpactAmount: 1000, scheduleImpactFlag: true, scheduleImpact: 3 });
    const openEdit = await X.send('PATCH', R(r4.id), { costImpactAmount: 1100 });
    check('H2', 'allow', 'SUB-X changes the cost figure of its open RFI', openEdit.status === 200 && Number(data(openEdit)?.costImpactAmount) === 1100, said(openEdit));
    await answered(r4.id, `figures answer ${tag}`);
    await closed(r4.id);
    const xFig = await X.send('PATCH', R(r4.id), { costImpactAmount: 999999 });
    const siteFig = await site.send('PATCH', R(r4.id), { scheduleImpact: 40, scheduleImpactFlag: true });
    const xFlag = await X.send('PATCH', R(r4.id), { costImpact: false });
    const after = await rfiNow(r4.id);
    check('H2', 'refuse', 'SUB-X and the site engineer change the cost / schedule figures of a closed RFI', refused(xFig, FORBIDDEN) && refused(siteFig, FORBIDDEN) && refused(xFlag, FORBIDDEN) && Number(after?.costImpactAmount) === 1100 && Number(after?.scheduleImpact) === 3 && after?.costImpact === true, `${said(xFig)}, ${said(siteFig)}, ${said(xFlag)}; cost ${after?.costImpactAmount}, days ${after?.scheduleImpact}, flagged ${after?.costImpact}`);
    const unchanged = await X.send('PATCH', R(r4.id), { discipline: 'Civil', costImpact: true, costImpactAmount: 1100, scheduleImpactFlag: true, scheduleImpact: 3 });
    check('H2', 'allow', 'SUB-X edits its closed RFI sending the figures unchanged', unchanged.status === 200 && data(unchanged)?.discipline === 'Civil', said(unchanged));
    const pmFix = await PM.send('PATCH', R(r4.id), { costImpactAmount: 1200 });
    check('H2', 'allow', 'the PM (rfi.close) corrects the cost figure of a closed RFI', pmFix.status === 200 && Number((await rfiNow(r4.id))?.costImpactAmount) === 1200, said(pmFix));
  }

  // ── H3: a new revision through PATCH (R9) ─────────────────────────────────
  if (wants('H3')) {
    console.log('\n== H3 a new RFI revision through PATCH (R9) ==');
    const r5 = await rfiOf(X, { subject: `PROOF2 H3 revision ${tag}` });
    await answered(r5.id, `official ${tag}`);
    const before = await rfiNow(r5.id);
    const bump = await X.send('PATCH', R(r5.id), { bumpRevision: true });
    const after = await rfiNow(r5.id);
    check('H3', 'refuse', 'SUB-X starts a new revision of its answered RFI through PATCH, clearing the official answer', refused(bump, FORBIDDEN) && Boolean(before?.officialResponseId) && after?.officialResponseId === before?.officialResponseId && Number(after?.revision) === Number(before?.revision), `${said(bump)}; revision ${before?.revision} -> ${after?.revision}, official ${before?.officialResponseId ? 'set' : 'none'} -> ${after?.officialResponseId ? 'set' : 'none'}`);
    const xEdit = await X.send('PATCH', R(r5.id), { discipline: 'Structural', bumpRevision: false });
    const pmBump = await PM.send('PATCH', R(r5.id), { bumpRevision: true });
    check('H3', 'allow', 'SUB-X edits with bumpRevision false; the PM (rfi.reopen) starts a new revision through PATCH', xEdit.status === 200 && pmBump.status === 200 && Number((await rfiNow(r5.id))?.revision) === Number(before?.revision) + 1, `${said(xEdit)}, ${said(pmBump)}`);
  }

  // ── H4: the RFI assistant's record routes (R11) ───────────────────────────
  if (wants('H4')) {
    console.log('\n== H4 the RFI assistant answers a caller without its permission alike (R11) ==');
    const reach = await qs.send('GET', `/projects/${P}/rfi?limit=1`);
    if (reach.status !== 200) throw new Error(`set-up: the QS does not reach the project's RFIs (${said(reach)})`);
    const r6 = await rfiOf(X, { subject: `PROOF2 H4 assistant ${tag}` });
    const missing = await qs.send('POST', `${R(MISSING)}/ai/response`, {});
    const existing = await qs.send('POST', `${R(r6.id)}/ai/response`, {});
    check('H4', 'refuse', 'the QS (no rfi submit) asks the assistant for a response on a missing and on an existing RFI: one answer for both', refused(missing, FORBIDDEN) && same(missing, existing), `missing ${said(missing)}, existing ${said(existing)}`);
    const qsSummary = await qs.send('POST', `${R(r6.id)}/ai/summary`, {});
    const qsMissing = await qs.send('POST', `${R(MISSING)}/ai/summary`, {});
    const xSummary = await X.send('POST', `${R(r6.id)}/ai/summary`, {});
    check('H4', 'allow', 'the QS (rfi read) and SUB-X (routed) summarise the RFI with the assistant; a missing one is not found', qsSummary.status === 200 && xSummary.status === 200 && qsMissing.status === 404, `${said(qsSummary)}, ${said(xSummary)}, missing ${said(qsMissing)}`);
    const yRfi = await rfiOf(Y, { subject: `PROOF2 H4 Y ${tag}` });
    const xOnY = await X.send('POST', `${R(yRfi.id)}/ai/summary`, {});
    check('H4', 'refuse', 'SUB-X summarises SUB-Y\'s RFI with the assistant', refused(xOnY, PARTY), said(xOnY));
  }

  // ── H5: submittal edges that would undo a decision (R2 — refuted) ─────────
  if (wants('H5')) {
    console.log('\n== H5 submittal edges that would undo a decision or a submission (R2 — refuted) ==');
    const s6 = await subOf(X, { title: `PROOF2 H5 approved ${tag}` });
    await submitted(X, s6.id);
    await approved(s6.id);
    const unApprove = await X.send('PATCH', S(s6.id), { status: 'pending' });
    const reReview = await X.send('PATCH', S(s6.id), { status: 'under_review' });
    const pmUnApprove = await PM.send('PATCH', S(s6.id), { status: 'pending' });
    const a6 = await subNow(s6.id);
    check('H5', 'refuse', 'SUB-X (and the PM) take the approval off an approved submittal (to pending, or back to review)', refused(unApprove, NO_EDGE) && refused(reReview, NO_EDGE) && refused(pmUnApprove, NO_EDGE) && a6?.status === 'approved' && a6?.responseCode === 'approved', `${said(unApprove)}, ${said(reReview)}, PM ${said(pmUnApprove)}; ${a6?.status} ${a6?.responseCode}`);
    const s7 = await subOf(X, { title: `PROOF2 H5 in review ${tag}` });
    await submitted(X, s7.id);
    const pullBack = await X.send('PATCH', S(s7.id), { status: 'pending' });
    const s8 = await subOf(X, { title: `PROOF2 H5 rejected ${tag}` });
    await submitted(X, s8.id);
    await rejected(s8.id);
    const unReject = await X.send('PATCH', S(s8.id), { status: 'pending' });
    const a7 = await subNow(s7.id);
    const a8 = await subNow(s8.id);
    check('H5', 'refuse', 'SUB-X pulls its submittal out of review, or takes the rejection off a rejected one (to pending)', refused(pullBack, NO_EDGE) && refused(unReject, NO_EDGE) && a7?.status === 'under_review' && a8?.status === 'rejected', `${said(pullBack)}, ${said(unReject)}; ${a7?.status}, ${a8?.status}`);
    const resubmit = await X.send('PATCH', S(s8.id), { status: 'under_review', revision: 'B' });
    check('H5', 'allow', 'SUB-X sends its rejected submittal for review again (the resubmission edge)', resubmit.status === 200 && data(resubmit)?.status === 'under_review', said(resubmit));
  }

  // ── H6: the action routes take only their own fields (R3) ─────────────────
  if (wants('H6')) {
    console.log('\n== H6 /submit, /resubmit and /review take only their own fields (R3) ==');
    const s5 = await subOf(X, { title: `PROOF2 H6 stamped ${tag}` });
    const sub = await X.send('POST', `${S(s5.id)}/submit`, { revision: 'A', comment: 'for review', responseCode: 'approved', responseCodeLabel: 'Approved' });
    const a5 = await subNow(s5.id);
    check('H6', 'allow', 'SUB-X submits its submittal with its revision', sub.status === 200 && a5?.status === 'under_review' && a5?.revision === 'A', `${said(sub)}; ${a5?.status} rev ${a5?.revision}`);
    check('H6', 'refuse', '/submit: SUB-X carries a response code into its submittal', !a5?.responseCode, `responseCode ${a5?.responseCode}`);
    const review = await planner.send('POST', `${S(s5.id)}/review`, { comment: `planner review ${tag}`, responseCode: 'approved_as_noted', responseCodeLabel: 'Approved as noted' });
    const r5 = await subNow(s5.id);
    check('H6', 'allow', 'the planner (submittal.review) records a review comment', review.status === 200 && r5?.remarks === `planner review ${tag}`, said(review));
    check('H6', 'refuse', '/review: the planner (no submittal.approve) stamps a response code', !r5?.responseCode, `responseCode ${r5?.responseCode}`);
    await rejected(s5.id);
    const j5 = await subNow(s5.id);
    check('H6', 'refuse', 'the PM then rejects it: the record says "rejected", not a code carried in earlier', j5?.status === 'rejected' && j5?.responseCode === 'rejected', `${j5?.status} ${j5?.responseCode} (${j5?.responseCodeLabel})`);
    const resub = await X.send('POST', `${S(s5.id)}/resubmit`, { revision: 'B', reason: 'revised', responseCode: 'approved', responseCodeLabel: 'Approved' });
    const b5 = await subNow(s5.id);
    check('H6', 'allow', 'SUB-X resubmits with revision B', resub.status === 200 && b5?.status === 'under_review' && b5?.revision === 'B', `${said(resub)}; ${b5?.status} rev ${b5?.revision}`);
    check('H6', 'refuse', '/resubmit: SUB-X stamps a response code', b5?.responseCode !== 'approved', `responseCode ${b5?.responseCode}`);
  }

  // ── H7 / H8: review-step reviewers, and the decide route's refusals (R4, R11) ──
  if (wants('H7', 'H8')) {
    console.log('\n== H7 a reviewer the review route named opens and decides (R4) / H8 the decide route\'s refusals (R11) ==');
    const route = need(await PM.send('POST', `/projects/${P}/submittals/workflow-templates`, { name: `PROOF2 consultant review ${tag}`, description: 'A consultant-party step; no reviewing party on the record.', isDefault: false, steps: [{ name: 'Consultant review', mode: 'sequential', days: 5, assignees: [{ type: 'party_role', role: 'consultant' }] }] }), 'the PM creating a review route');
    const cMe = await C.GET('/auth/me');
    if (wants('H7')) {
      const s1 = await subOf(X, { title: `PROOF2 H7 packaged ${tag}`, workflowTemplateId: route.id });
      const s2 = await subOf(X, { title: `PROOF2 H7 alone ${tag}`, workflowTemplateId: route.id });
      const pkg = need(await X.send('POST', `/projects/${P}/submittals/packages`, { name: `PROOF2 H7 package ${tag}`, submittalIds: [s1.id] }), 'SUB-X packaging');
      await submitted(X, s1.id);
      await submitted(X, s2.id);
      const routed = await subNow(s2.id);
      const assigned = (routed?.activeStep?.assignments || []).some((row) => row.userId === cMe.id);
      if (!assigned || routed.reviewerPartyId || routed.approverPartyId) throw new Error(`set-up: the consultant is not (only) a step reviewer: assigned ${assigned}, reviewer party ${routed?.reviewerPartyId}`);
      const open = await C.send('GET', S(s2.id));
      const pkgOpen = await C.send('GET', PK(pkg.id));
      const listed = (data(await C.send('GET', `/projects/${P}/submittals/packages`))?.items || []).find((row) => row.id === pkg.id);
      check('H7', 'allow', 'the consultant (step reviewer, its party not on the record) opens the submittal, and its package (also in its list)', open.status === 200 && data(open)?.activeStep?.id === routed.activeStep.id && pkgOpen.status === 200 && (data(pkgOpen)?.items || []).some((item) => item.id === s1.id) && Boolean(listed), `${said(open)}, package ${said(pkgOpen)}, listed ${Boolean(listed)}`);
      const pkgDecide = await C.send('POST', `${PK(pkg.id)}/decide`, { decision: 'approve', comment: 'consultant approves the package' });
      const decided = (data(pkgDecide)?.results || []).find((row) => row.submittalId === s1.id);
      const oneDecide = await C.send('POST', `${S(s2.id)}/decide`, { decision: 'approve', comment: 'consultant approves' });
      const n1 = await subNow(s1.id);
      const n2 = await subNow(s2.id);
      check('H7', 'allow', 'the consultant decides the package and the single submittal; both are approved', pkgDecide.status === 200 && decided?.decided === true && oneDecide.status === 200 && n1?.status === 'approved' && n2?.status === 'approved', `package ${said(pkgDecide)} ${JSON.stringify(decided || null)}, single ${said(oneDecide)}; ${n1?.status}, ${n2?.status}`);
      const yOwn = await subOf(Y, { title: `PROOF2 H7 Y unrouted ${tag}` });
      const cOnY = await C.send('GET', S(yOwn.id));
      const yOnX = await Y.send('GET', S(s2.id));
      const yPkg = await Y.send('GET', PK(pkg.id));
      check('H7', 'refuse', 'the consultant opens SUB-Y\'s submittal it reviews nothing on; SUB-Y opens SUB-X\'s submittal and package', refused(cOnY, PARTY) && refused(yOnX, PARTY) && refused(yPkg, PARTY), `${said(cOnY)}, ${said(yOnX)}, ${said(yPkg)}`);
    }
    if (wants('H8')) {
      const yPending = await subOf(Y, { title: `PROOF2 H8 pending ${tag}` });
      const yReview = await subOf(Y, { title: `PROOF2 H8 in review ${tag}` });
      await submitted(Y, yReview.id);
      const onPending = await C.send('POST', `${S(yPending.id)}/decide`, { decision: 'approve' });
      const onReview = await C.send('POST', `${S(yReview.id)}/decide`, { decision: 'approve' });
      check('H8', 'refuse', 'the consultant (unrouted, no step) decides SUB-Y\'s pending and in-review submittals: one refusal, the status not told', refused(onPending, PARTY) && same(onPending, onReview), `pending ${said(onPending)}, in review ${said(onReview)}`);
      const s3 = await subOf(X, { title: `PROOF2 H8 assigned ${tag}`, workflowTemplateId: route.id });
      await submitted(X, s3.id);
      const own = await C.send('POST', `${S(s3.id)}/decide`, { decision: 'approve' });
      const pmOwn = await PM.send('POST', `${S(yReview.id)}/decide`, { decision: 'approve' });
      check('H8', 'allow', 'the consultant decides a submittal its step names it on; the PM still gets the plain answer on one without steps', own.status === 200 && (await subNow(s3.id))?.status === 'approved' && pmOwn.status === 409 && pmOwn.body?.error?.code === 'SUBMITTAL_NO_ACTIVE_STEP', `${said(own)}, PM ${said(pmOwn)}`);
    }
  }

  // ── H9: filing into a package (R10) ───────────────────────────────────────
  if (wants('H9')) {
    console.log('\n== H9 a party member files a submittal only into a package they can open (R10) ==');
    const ySub = await subOf(Y, { title: `PROOF2 H9 Y item ${tag}` });
    const yPkg = need(await Y.send('POST', `/projects/${P}/submittals/packages`, { name: `PROOF2 H9 Y package ${tag}`, submittalIds: [ySub.id] }), 'SUB-Y packaging');
    const xSub = await subOf(X, { title: `PROOF2 H9 X item ${tag}` });
    const move = await X.send('PATCH', S(xSub.id), { packageId: yPkg.id });
    const born = await X.send('POST', `/projects/${P}/submittals`, { title: `PROOF2 H9 born in Y ${tag}`, packageId: yPkg.id });
    const xNow = await subNow(xSub.id);
    const peek = await X.send('GET', PK(yPkg.id));
    const rename = await X.send('PATCH', PK(yPkg.id), { name: `renamed by X ${tag}` });
    const yNow = data(await PM.send('GET', PK(yPkg.id)));
    check('H9', 'refuse', 'SUB-X files its submittal into SUB-Y\'s package (PATCH, or raised in it), then opens and renames the package', [move, born].every((res) => refused(res, PARTY)) && !xNow?.package && refused(peek, PARTY) && refused(rename, PARTY) && yNow?.name === `PROOF2 H9 Y package ${tag}` && !(yNow?.items || []).some((item) => item.title === `PROOF2 H9 born in Y ${tag}`), `${said(move)}, ${said(born)}; package ${xNow?.package?.ref || 'none'}; open ${said(peek)}, rename ${said(rename)}`);
    // The same package sent with /submit: the action takes no package (R3), and the package rule (R10) stands behind it.
    const xSent = await subOf(X, { title: `PROOF2 H9 X sent ${tag}` });
    const viaSubmit = await X.send('POST', `${S(xSent.id)}/submit`, { revision: 'A', packageId: yPkg.id });
    const sentNow = await subNow(xSent.id);
    check('H9', 'refuse', 'SUB-X sends its submittal for review with SUB-Y\'s package in the body', !sentNow?.package && (viaSubmit.status === 200 || refused(viaSubmit, PARTY)), `${said(viaSubmit)}; package ${sentNow?.package?.ref || 'none'}`);
    const xPkg = need(await X.send('POST', `/projects/${P}/submittals/packages`, { name: `PROOF2 H9 X package ${tag}` }), 'SUB-X making a package');
    const own = await X.send('PATCH', S(xSub.id), { packageId: xPkg.id });
    const again = await X.send('PATCH', S(xSub.id), { packageId: xPkg.id, discipline: 'Civil' });
    const ownBorn = await X.send('POST', `/projects/${P}/submittals`, { title: `PROOF2 H9 born in X ${tag}`, packageId: xPkg.id });
    const xSub2 = await subOf(X, { title: `PROOF2 H9 X second ${tag}` });
    const pmMove = await PM.send('PATCH', S(xSub2.id), { packageId: yPkg.id });
    check('H9', 'allow', 'SUB-X files into its own package (PATCH, edit with it unchanged, raised in it); the PM files into any package', own.status === 200 && (await subNow(xSub.id))?.package?.id === xPkg.id && again.status === 200 && ownBorn.status === 201 && pmMove.status === 200, `${said(own)}, ${said(again)}, ${said(ownBorn)}, PM ${said(pmMove)}`);
  }

  // ── H10: a decided submittal's review stamp (R8) ──────────────────────────
  if (wants('H10')) {
    console.log('\n== H10 a decided submittal\'s review stamp (R8) ==');
    const s9 = await subOf(X, { title: `PROOF2 H10 approved ${tag}` });
    await submitted(X, s9.id);
    await approved(s9.id);
    const before = await subNow(s9.id);
    const date = await X.send('PATCH', S(s9.id), { reviewedOn: '2020-01-01T00:00:00.000Z' });
    const notes = await X.send('PATCH', S(s9.id), { remarks: `Approved without comment ${tag}` });
    const s10 = await subOf(X, { title: `PROOF2 H10 rejected ${tag}` });
    await submitted(X, s10.id);
    await rejected(s10.id);
    const rDate = await X.send('PATCH', S(s10.id), { reviewedOn: '2020-01-01T00:00:00.000Z' });
    const after = await subNow(s9.id);
    const r10 = await subNow(s10.id);
    check('H10', 'refuse', 'SUB-X rewrites the review date or the notes of its approved submittal, or the review date of its rejected one', [date, notes, rDate].every((res) => refused(res, FORBIDDEN)) && after?.reviewedOn === before?.reviewedOn && after?.remarks === before?.remarks && new Date(r10?.reviewedOn).getUTCFullYear() !== 2020, `${said(date)}, ${said(notes)}, ${said(rDate)}; reviewedOn ${before?.reviewedOn} -> ${after?.reviewedOn}, remarks ${JSON.stringify(after?.remarks)}`);
    const xNotes = await X.send('PATCH', S(s10.id), { remarks: `Notes for the resubmission ${tag}` });
    const xSame = await X.send('PATCH', S(s9.id), { reviewedOn: before?.reviewedOn, remarks: before?.remarks, discipline: 'Civil' });
    const pmNotes = await PM.send('PATCH', S(s9.id), { remarks: `PM note ${tag}` });
    check('H10', 'allow', 'SUB-X keeps notes on its returned submittal and sends the stamp unchanged; the PM (submittal.approve) annotates the approved one', xNotes.status === 200 && xSame.status === 200 && pmNotes.status === 200 && (await subNow(s9.id))?.remarks === `PM note ${tag}`, `${said(xNotes)}, ${said(xSame)}, ${said(pmNotes)}`);
  }

  // ── H11: no stale response code into a new review cycle ───────────────────
  if (wants('H11')) {
    console.log('\n== H11 a new review cycle carries no response code of the last one ==');
    const s12 = await subOf(X, { title: `PROOF2 H11 returned ${tag}` });
    await submitted(X, s12.id);
    await rejected(s12.id);
    need(await X.send('POST', `${S(s12.id)}/resubmit`, { revision: 'B', reason: 'revised' }), 'SUB-X resubmitting');
    const inReview = await subNow(s12.id);
    await approved(s12.id);
    const done = await subNow(s12.id);
    check('H11', 'refuse', 'a rejected submittal, resubmitted and then approved, keeps the old "Rejected" code', !inReview?.responseCode && done?.status === 'approved' && done?.responseCode === 'approved' && done?.responseCodeLabel === 'Approved', `in review: ${inReview?.responseCode}; approved: ${done?.responseCode} (${done?.responseCodeLabel})`);
    const s13 = await subOf(X, { title: `PROOF2 H11 return required ${tag}` });
    await submitted(X, s13.id);
    need(await PM.send('POST', `${S(s13.id)}/resubmit`, { reason: 'revise the anchors' }), 'the PM requiring resubmission');
    need(await X.send('POST', `${S(s13.id)}/resubmit`, { revision: 'B', reason: 'anchors revised' }), 'SUB-X resubmitting');
    await rejected(s13.id);
    const back = await subNow(s13.id);
    check('H11', 'refuse', 'a submittal returned for resubmission, resubmitted and rejected, keeps the old "Revise and resubmit" code', back?.status === 'rejected' && back?.responseCode === 'rejected', `${back?.status} ${back?.responseCode}`);
    const s14 = await subOf(X, { title: `PROOF2 H11 PM code ${tag}` });
    await submitted(X, s14.id);
    await rejected(s14.id);
    const pmCode = await PM.send('PATCH', S(s14.id), { status: 'under_review', responseCode: 'approved_as_noted', comment: 'PM sets the code with the new review' });
    const pmUnder = await PM.send('PATCH', S(s14.id), { responseCode: 'custom', responseCodeLabel: 'Hold for samples' });
    check('H11', 'allow', 'the PM (submittal.approve) sets a code together with a new review cycle, and during it', pmCode.status === 200 && data(pmCode)?.responseCode === 'approved_as_noted' && pmUnder.status === 200 && (await subNow(s14.id))?.responseCode === 'custom', `${said(pmCode)} ${data(pmCode)?.responseCode}, ${said(pmUnder)}`);
  }

  // ── verdict ────────────────────────────────────────────────────────────────
  const failedRefusals = results.filter((row) => row.kind === 'refuse' && !row.pass);
  const failedAllows = results.filter((row) => row.kind === 'allow' && !row.pass);
  console.log(`\n${results.length} checks: ${results.filter((row) => row.pass).length} pass, ${failedRefusals.length} refusal(s) failed, ${failedAllows.length} allowed case(s) failed`);
  for (const row of [...failedRefusals, ...failedAllows]) console.log(`  FAILED ${row.guard} ${row.kind} ${row.label} — ${row.detail}`);
  const guards = [...new Set(results.map((row) => row.guard))];
  for (const guard of guards) {
    const rows = results.filter((row) => row.guard === guard);
    console.log(`  ${guard}: refuse ${rows.filter((r) => r.kind === 'refuse' && r.pass).length}/${rows.filter((r) => r.kind === 'refuse').length}, allow ${rows.filter((r) => r.kind === 'allow' && r.pass).length}/${rows.filter((r) => r.kind === 'allow').length}`);
  }
  if (failedRefusals.length) {
    console.log('\nVERDICT rfi-submittal-2: DEFECT PRESENT');
    process.exitCode = 2;
  } else if (failedAllows.length) {
    console.log('\nVERDICT rfi-submittal-2: OVER-BLOCKING (a legitimate caller is refused)');
    process.exitCode = 3;
  } else {
    console.log('\nVERDICT rfi-submittal-2: FIXED (every refusal and every allowed case holds)');
    process.exitCode = 0;
  }
});
