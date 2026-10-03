'use strict';

/**
 * Proof for the "rfi-submittal-routing" group — certification findings L40,
 * L42, FILES-X1 and X-PARTY-2 (one company's own project; a party guest or a
 * role reaching what its party / role must not).
 *
 * Every guard is shown twice: the refusal of the caller the record or the
 * decision is not theirs, AND the same request succeeding for the caller it
 * belongs to — so a fix that turned into a blanket refusal fails here too.
 *
 *   G1  RFI by id follows party routing (detail, thread read and write, assistant, official answer)
 *   G2  the assistant's record routes check the RFI before loading it
 *   G3  a refused official-answer promotion changes no thread flag
 *   G4  a thread entry is edited / removed only on an RFI routed to the caller
 *   G5  submittal by id follows party routing
 *   G6  packages: list, open and edit only through the caller's routed submittals
 *   G7  a party member packages only submittals routed to them
 *   G8  a party member takes out of a shared package only their own submittal
 *   G9  RFI status set through create / update needs the action's transition
 *   G10 RFI answer fields set through update need rfi.answer
 *   G11 submittal status set through create / update needs the action's transition
 *   G12 submittal review outcome set through update needs submittal.approve
 *   G13 a submittal status set through update respects a running workflow (409)
 *   G14 submittal review routes are changed only by the project team
 *
 * Stage: project 072-01 (company 072) and its party guests SUB-X, SUB-Y and
 * CONSULTANT (scripts/cert/leads/lib/party-visibility.js). Run in process:
 *
 *   $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/rfi-submittal-routing-proof.js [--only=G1,G9]
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

const check = (guard, kind, label, pass, detail = '') => {
  results.push({ guard, kind, label, pass: Boolean(pass), detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${guard} ${kind.padEnd(7)} ${label}${detail ? ` — ${detail}` : ''}`);
};
const refused = (res, codes = ['PROJECT_PARTY_RECORD_ACCESS_DENIED']) => [403, 404].includes(res.status) && codes.includes(res.body?.error?.code);
const said = (res) => `${res.status} ${res.body?.error?.code || ''}`.trim();
const data = (res) => res.body?.data;
const items = (res) => data(res)?.items || data(res)?.rows || [];

pv.main(async () => {
  const s = await pv.setup();
  const P = s.projectId;
  const tag = stamp();
  const X = s.subX;
  const Y = s.subY;
  const C = s.consultant;
  const PM = s.pm;
  const planner = pv.api.as(`planner@c${pv.CODE}.octapm-cert.test`);
  const site = pv.api.as(`site@c${pv.CODE}.octapm-cert.test`);
  const R = (id) => `/projects/${P}/rfi/${id}`;
  const S = (id) => `/projects/${P}/submittals/${id}`;
  const PK = (id) => `/projects/${P}/submittals/packages/${id}`;
  console.log(`rfi-submittal-routing proof — project ${P} (072-01), run ${tag}${ONLY.length ? `, only ${ONLY.join(',')}` : ''}`);

  // ── RFIs: party routing on every by-id path (L42 / FILES-X1) ──────────────
  if (wants('G1', 'G2', 'G3', 'G4')) {
    console.log('\n== RFI by id (G1-G4) ==');
    const yRfi = data(await Y.send('POST', `/projects/${P}/rfi`, { subject: `PROOF routing Y ${tag}`, question: `Y-ONLY question ${tag}`, status: 'open' }));
    const xRfi = data(await X.send('POST', `/projects/${P}/rfi`, { subject: `PROOF routing X ${tag}`, question: `X question ${tag}`, status: 'open' }));
    if (!yRfi?.id || !xRfi?.id) throw new Error('set-up: the guests could not raise their RFIs');
    // The consultant reviews X's RFI (routed), not Y's.
    await PM.send('PATCH', R(xRfi.id), { reviewerPartyId: s.parties.consultant });
    const pmOnY = await PM.send('POST', `${R(yRfi.id)}/responses`, { body: `PM reply on Y ${tag}` });
    const pmOnX = await PM.send('POST', `${R(xRfi.id)}/responses`, { body: `PM reply on X ${tag}` });
    const pmYId = (data(pmOnY)?.responses || []).find((row) => row.body === `PM reply on Y ${tag}`)?.id;
    const pmXId = (data(pmOnX)?.responses || []).find((row) => row.body === `PM reply on X ${tag}`)?.id;

    if (wants('G1')) {
      const detail = await X.send('GET', R(yRfi.id));
      check('G1', 'refuse', 'SUB-X opens SUB-Y\'s RFI', refused(detail), said(detail));
      const ownDetail = await X.send('GET', R(xRfi.id));
      check('G1', 'allow', 'SUB-X opens its own RFI', ownDetail.status === 200 && data(ownDetail)?.id === xRfi.id, said(ownDetail));
      const thread = await X.send('GET', `${R(yRfi.id)}/responses`);
      check('G1', 'refuse', 'SUB-X reads SUB-Y\'s thread', refused(thread), said(thread));
      const ownThread = await X.send('GET', `${R(xRfi.id)}/responses`);
      check('G1', 'allow', 'SUB-X reads its own thread', ownThread.status === 200 && items(ownThread).length >= 1, said(ownThread));
      const write = await X.send('POST', `${R(yRfi.id)}/responses`, { body: `X writing on Y ${tag}` });
      const yThreadAfter = items(await PM.send('GET', `${R(yRfi.id)}/responses`));
      check('G1', 'refuse', 'SUB-X writes into SUB-Y\'s thread', refused(write) && !yThreadAfter.some((row) => String(row.body).includes(`X writing on Y ${tag}`)), said(write));
      const ownWrite = await X.send('POST', `${R(xRfi.id)}/responses`, { body: `X writing on X ${tag}` });
      check('G1', 'allow', 'SUB-X writes into its own thread', ownWrite.status === 201, said(ownWrite));
      const pmRead = await PM.send('GET', R(yRfi.id));
      check('G1', 'allow', 'the PM (internal) opens SUB-Y\'s RFI', pmRead.status === 200 && data(pmRead)?.question === `Y-ONLY question ${tag}`, said(pmRead));
    }

    if (wants('G2')) {
      const summary = await X.send('POST', `${R(yRfi.id)}/ai/summary`, {});
      check('G2', 'refuse', 'SUB-X runs the assistant summary on SUB-Y\'s RFI', refused(summary), said(summary));
      const suggest = await X.send('POST', `${R(yRfi.id)}/ai/response`, {});
      check('G2', 'refuse', 'SUB-X runs the assistant response on SUB-Y\'s RFI', refused(suggest), said(suggest));
      const ownSummary = await X.send('POST', `${R(xRfi.id)}/ai/summary`, {});
      check('G2', 'allow', 'SUB-X runs the assistant summary on its own RFI', ownSummary.status === 200 && Boolean(data(ownSummary)?.summary), said(ownSummary));
    }

    if (wants('G3', 'G1')) {
      const before = items(await PM.send('GET', `${R(yRfi.id)}/responses`)).find((row) => row.id === pmYId);
      const promote = await C.send('POST', `${R(yRfi.id)}/responses/${pmYId}/official`, {});
      const after = items(await PM.send('GET', `${R(yRfi.id)}/responses`)).find((row) => row.id === pmYId);
      const yNow = data(await PM.send('GET', R(yRfi.id)));
      check('G3', 'refuse', 'the consultant (not routed) promotes a reply on SUB-Y\'s RFI to the official answer; nothing changes', refused(promote) && before?.isOfficial === false && after?.isOfficial === false && yNow?.status === 'open' && !yNow?.officialResponseId, `${said(promote)}; isOfficial ${before?.isOfficial} -> ${after?.isOfficial}; RFI ${yNow?.status}`);
      const ownPromote = await C.send('POST', `${R(xRfi.id)}/responses/${pmXId}/official`, {});
      const xNow = data(await PM.send('GET', R(xRfi.id)));
      check('G3', 'allow', 'the consultant (routed reviewer) promotes a reply on SUB-X\'s RFI', ownPromote.status === 200 && xNow?.status === 'answered' && xNow?.officialResponseId === pmXId && (xNow?.responses || []).find((row) => row.id === pmXId)?.isOfficial === true, `${said(ownPromote)}; RFI ${xNow?.status}`);
    }

    if (wants('G4')) {
      // X writes on its own RFI; the PM then routes that RFI to Y: X's old entry is out of reach.
      const xRfi2 = data(await X.send('POST', `/projects/${P}/rfi`, { subject: `PROOF re-routed ${tag}`, question: 'q', status: 'open' }));
      const written = data(await X.send('POST', `${R(xRfi2.id)}/responses`, { body: `X entry ${tag}` }));
      const entryId = (written?.responses || []).find((row) => row.body === `X entry ${tag}`)?.id;
      await PM.send('PATCH', R(xRfi2.id), { ownerPartyId: s.parties.subcontractorY });
      const edit = await X.send('PATCH', `${R(xRfi2.id)}/responses/${entryId}`, { body: `X edit while routed to Y ${tag}` });
      const remove = await X.send('DELETE', `${R(xRfi2.id)}/responses/${entryId}`);
      check('G4', 'refuse', 'SUB-X edits / removes its entry once the RFI is routed to SUB-Y', refused(edit) && refused(remove), `edit ${said(edit)}, remove ${said(remove)}`);
      await PM.send('PATCH', R(xRfi2.id), { ownerPartyId: s.parties.subcontractor });
      const editBack = await X.send('PATCH', `${R(xRfi2.id)}/responses/${entryId}`, { body: `X edit ${tag}` });
      const removeBack = await X.send('DELETE', `${R(xRfi2.id)}/responses/${entryId}`);
      check('G4', 'allow', 'SUB-X edits and removes its entry on an RFI routed to it', editBack.status === 200 && removeBack.status === 200, `edit ${said(editBack)}, remove ${said(removeBack)}`);
    }
  }

  // ── Submittals and packages: party routing (L42 / FILES-X1) ───────────────
  if (wants('G5', 'G6', 'G7', 'G8')) {
    console.log('\n== Submittals and packages (G5-G8) ==');
    const ySub = data(await Y.send('POST', `/projects/${P}/submittals`, { title: `PROOF Y submittal ${tag}` }));
    const xSub = data(await X.send('POST', `/projects/${P}/submittals`, { title: `PROOF X submittal ${tag}` }));
    const ySub2 = data(await Y.send('POST', `/projects/${P}/submittals`, { title: `PROOF Y shared ${tag}` }));
    const xSub2 = data(await X.send('POST', `/projects/${P}/submittals`, { title: `PROOF X shared ${tag}` }));
    const yPkg = data(await Y.send('POST', `/projects/${P}/submittals/packages`, { name: `PROOF Y package ${tag}`, submittalIds: [ySub.id] }));
    const mixed = data(await PM.send('POST', `/projects/${P}/submittals/packages`, { name: `PROOF shared package ${tag}`, submittalIds: [ySub2.id, xSub2.id] }));
    if (!ySub?.id || !xSub?.id || !yPkg?.id || !mixed?.id) throw new Error('set-up: submittals or packages were not made');

    if (wants('G5')) {
      const other = await X.send('GET', S(ySub.id));
      check('G5', 'refuse', 'SUB-X opens SUB-Y\'s submittal', refused(other), said(other));
      const own = await X.send('GET', S(xSub.id));
      check('G5', 'allow', 'SUB-X opens its own submittal', own.status === 200 && data(own)?.id === xSub.id, said(own));
      const pm = await PM.send('GET', S(ySub.id));
      check('G5', 'allow', 'the PM opens SUB-Y\'s submittal', pm.status === 200, said(pm));
    }

    if (wants('G6')) {
      const list = await X.send('GET', `/projects/${P}/submittals/packages`);
      const listed = items(list);
      const mixedSeen = listed.find((row) => row.id === mixed.id);
      check('G6', 'refuse', 'SUB-X\'s package list holds neither SUB-Y\'s package nor SUB-Y\'s item of the shared one', list.status === 200 && !listed.some((row) => row.id === yPkg.id) && mixedSeen && !(mixedSeen.items || []).some((item) => item.id === ySub2.id), `${listed.length} package(s)`);
      check('G6', 'allow', 'SUB-X\'s package list holds the shared package with its own item', Boolean(mixedSeen) && (mixedSeen.items || []).some((item) => item.id === xSub2.id));
      const open = await X.send('GET', PK(yPkg.id));
      const edit = await X.send('PATCH', PK(yPkg.id), { description: `edited by X ${tag}` });
      check('G6', 'refuse', 'SUB-X opens / edits SUB-Y\'s package', refused(open) && refused(edit), `open ${said(open)}, edit ${said(edit)}`);
      const xPkg = await X.send('POST', `/projects/${P}/submittals/packages`, { name: `PROOF X package ${tag}`, submittalIds: [xSub.id] });
      const xOpen = await X.send('GET', PK(data(xPkg)?.id));
      const xEdit = await X.send('PATCH', PK(data(xPkg)?.id), { description: `X's own ${tag}` });
      check('G6', 'allow', 'SUB-X makes, opens and edits its own package', xPkg.status === 201 && xOpen.status === 200 && xEdit.status === 200, `make ${said(xPkg)}, open ${said(xOpen)}, edit ${said(xEdit)}`);
      const pmOpen = await PM.send('GET', PK(yPkg.id));
      check('G6', 'allow', 'the PM opens SUB-Y\'s package with its item', pmOpen.status === 200 && (data(pmOpen)?.items || []).some((item) => item.id === ySub.id), said(pmOpen));
    }

    if (wants('G7')) {
      // An unpackaged submittal of Y's, so that nothing but the party rule stands in the way.
      const ySub3 = data(await Y.send('POST', `/projects/${P}/submittals`, { title: `PROOF Y loose ${tag}` }));
      const steal = await X.send('POST', `/projects/${P}/submittals/packages`, { name: `PROOF X takes Y ${tag}`, submittalIds: [ySub3.id] });
      const addSteal = await X.send('POST', `${PK(mixed.id)}/items`, { submittalIds: [ySub3.id] });
      const now = data(await PM.send('GET', S(ySub3.id)));
      check('G7', 'refuse', 'SUB-X packages SUB-Y\'s submittal (new package, or into a package it shares)', refused(steal) && refused(addSteal) && !now?.package, `${said(steal)}, ${said(addSteal)}; package ${now?.package?.ref || 'none'}`);
      // A submittal sits in one package only: a fresh one of X's for the allowed case.
      const xSub3 = data(await X.send('POST', `/projects/${P}/submittals`, { title: `PROOF X added ${tag}` }));
      const ownAdd = await X.send('POST', `${PK(mixed.id)}/items`, { submittalIds: [xSub3.id] });
      check('G7', 'allow', 'SUB-X adds its own submittal to the shared package', ownAdd.status === 200 && (data(ownAdd)?.items || []).some((item) => item.id === xSub3.id), said(ownAdd));
    }

    if (wants('G8')) {
      const takeOut = await X.send('DELETE', `${PK(mixed.id)}/items/${ySub2.id}`);
      const after = data(await PM.send('GET', S(ySub2.id)));
      check('G8', 'refuse', 'SUB-X takes SUB-Y\'s submittal out of the shared package', refused(takeOut) && after?.package?.id === mixed.id, `${said(takeOut)}; still in ${after?.package?.ref}`);
      const ownOut = await X.send('DELETE', `${PK(mixed.id)}/items/${xSub2.id}`);
      const ownAfter = data(await PM.send('GET', S(xSub2.id)));
      check('G8', 'allow', 'SUB-X takes its own submittal out of the shared package', ownOut.status === 200 && !ownAfter?.package, said(ownOut));
    }
  }

  // ── Decisions sent straight to create / update (L40) ──────────────────────
  if (wants('G9', 'G10')) {
    console.log('\n== RFI decisions through create / update (G9-G10) ==');
    const rfi = data(await X.send('POST', `/projects/${P}/rfi`, { subject: `PROOF L40 RFI ${tag}`, question: 'q', status: 'open' }));
    if (wants('G9')) {
      const close = await X.send('PATCH', R(rfi.id), { status: 'closed', response: 'self answer', comment: 'self close' });
      const answer = await X.send('PATCH', R(rfi.id), { status: 'answered' });
      const bornClosed = await X.send('POST', `/projects/${P}/rfi`, { subject: `PROOF born closed ${tag}`, question: 'q', status: 'closed' });
      const bornAnswered = await X.send('POST', `/projects/${P}/rfi`, { subject: `PROOF born answered ${tag}`, question: 'q', status: 'answered' });
      const still = data(await PM.send('GET', R(rfi.id)));
      check('G9', 'refuse', 'SUB-X closes / answers its RFI through PATCH, or raises it closed / answered', [close, answer, bornClosed, bornAnswered].every((res) => refused(res, ['FORBIDDEN'])) && still?.status === 'open', `${said(close)}, ${said(answer)}, ${said(bornClosed)}, ${said(bornAnswered)}; RFI ${still?.status}`);
      const edit = await X.send('PATCH', R(rfi.id), { discipline: 'Structural', status: 'open' });
      const raised = await X.send('POST', `/projects/${P}/rfi`, { subject: `PROOF raised open ${tag}`, question: 'q', status: 'open' });
      check('G9', 'allow', 'SUB-X edits its open RFI and raises one open', edit.status === 200 && raised.status === 201, `${said(edit)}, ${said(raised)}`);
      const pmRfi = data(await X.send('POST', `/projects/${P}/rfi`, { subject: `PROOF PM closes ${tag}`, question: 'q', status: 'open' }));
      const pmClose = await PM.send('PATCH', R(pmRfi.id), { status: 'closed', comment: 'closed by the PM' });
      check('G9', 'allow', 'the PM (rfi.close) closes an RFI through PATCH', pmClose.status === 200 && data(pmClose)?.status === 'closed', said(pmClose));
    }
    if (wants('G10')) {
      const answerText = await X.send('PATCH', R(rfi.id), { response: 'Use 450 mm — written by the subcontractor', answeredBy: 'The Engineer' });
      const still = data(await PM.send('GET', R(rfi.id)));
      check('G10', 'refuse', 'SUB-X writes the answer of its open RFI through PATCH', refused(answerText, ['FORBIDDEN']) && !still?.response, `${said(answerText)}; response ${JSON.stringify(still?.response)}`);
      const unchanged = await X.send('PATCH', R(rfi.id), { response: null, discipline: 'Civil' });
      check('G10', 'allow', 'SUB-X sends the answer field unchanged with an edit', unchanged.status === 200, said(unchanged));
      const pmAnswer = await PM.send('PATCH', R(rfi.id), { response: `PM wording ${tag}` });
      check('G10', 'allow', 'the PM (rfi.answer) writes the answer through PATCH', pmAnswer.status === 200 && data(pmAnswer)?.response === `PM wording ${tag}`, said(pmAnswer));
    }
  }

  if (wants('G11', 'G12', 'G13')) {
    console.log('\n== Submittal decisions through create / update (G11-G13) ==');
    const sub = data(await X.send('POST', `/projects/${P}/submittals`, { title: `PROOF L40 submittal ${tag}` }));
    const toReview = await X.send('PATCH', S(sub.id), { status: 'under_review' });
    if (wants('G11')) {
      check('G11', 'allow', 'SUB-X (submittal.submit) sends its submittal for review through PATCH', toReview.status === 200 && data(toReview)?.status === 'under_review', said(toReview));
      const approve = await X.send('PATCH', S(sub.id), { status: 'approved' });
      const reject = await X.send('PATCH', S(sub.id), { status: 'rejected', comment: 'x' });
      const born = await X.send('POST', `/projects/${P}/submittals`, { title: `PROOF born approved ${tag}`, status: 'approved' });
      const still = data(await PM.send('GET', S(sub.id)));
      check('G11', 'refuse', 'SUB-X approves / rejects its submittal through PATCH, or raises it approved', [approve, reject, born].every((res) => refused(res, ['FORBIDDEN'])) && still?.status === 'under_review' && !still?.responseCode, `${said(approve)}, ${said(reject)}, ${said(born)}; record ${still?.status}`);
    }
    if (wants('G12')) {
      const code = await X.send('PATCH', S(sub.id), { responseCode: 'approved', responseCodeLabel: 'Approved' });
      const still = data(await PM.send('GET', S(sub.id)));
      check('G12', 'refuse', 'SUB-X stamps a review outcome on its submittal through PATCH', refused(code, ['FORBIDDEN']) && !still?.responseCode, `${said(code)}; responseCode ${still?.responseCode}`);
      const pmCode = await PM.send('PATCH', S(sub.id), { responseCode: 'approved_as_noted' });
      check('G12', 'allow', 'the PM (submittal.approve) sets the review outcome through PATCH', pmCode.status === 200, said(pmCode));
    }
    if (wants('G13')) {
      const locked = data(await X.send('POST', `/projects/${P}/submittals`, { title: `PROOF locked ${tag}` }));
      await PM.send('PATCH', S(locked.id), { status: 'under_review' });
      const templateName = 'PROOF rfi-submittal-routing second review';
      const listed = items(await PM.send('GET', `/projects/${P}/workflows/templates?tool=submittal`));
      let template = listed.find((row) => row.name === templateName && row.status === 'active');
      if (!template) {
        const me = await PM.GET('/auth/me');
        template = data(await PM.send('POST', `/projects/${P}/workflows/templates`, { tool: 'submittal', name: templateName, description: 'Started by hand by the proof only.', isDefault: false, rules: [], steps: [{ key: 'review', name: 'Second review', type: 'response', assignees: [{ type: 'user', userId: me.id }], days: 5, responses: [{ key: 'approve', label: 'Approve', next: 'end_success' }, { key: 'reject', label: 'Reject', next: 'end_fail', requireComment: true }] }] }));
      }
      const instance = data(await PM.send('POST', `/projects/${P}/workflows/instances`, { tool: 'submittal', recordId: locked.id, templateId: template.id }));
      const whileRunning = await PM.send('PATCH', S(locked.id), { status: 'approved', comment: 'round the lock' });
      const record = data(await PM.send('GET', S(locked.id)));
      check('G13', 'refuse', 'the PM approves through PATCH while a workflow decides the submittal', whileRunning.status === 409 && whileRunning.body?.error?.code === 'WORKFLOW_RUNNING' && record?.status === 'under_review', `${said(whileRunning)}; record ${record?.status}`);
      await PM.send('POST', `/projects/${P}/workflows/instances/${instance?.id}/cancel`, { reason: 'proof finished' });
      const afterCancel = await PM.send('PATCH', S(locked.id), { status: 'approved', comment: 'approved once the workflow is cancelled' });
      check('G13', 'allow', 'the PM approves through PATCH once no workflow runs', afterCancel.status === 200 && data(afterCancel)?.status === 'approved', said(afterCancel));
    }
  }

  // ── Review routes (X-PARTY-2) ──────────────────────────────────────────────
  if (wants('G14')) {
    console.log('\n== Submittal review routes (G14) ==');
    const T = `/projects/${P}/submittals/workflow-templates`;
    const pmMe = await PM.GET('/auth/me');
    const xMe = await X.GET('/auth/me');
    const steps = (userId) => [{ name: 'Review', mode: 'sequential', days: 3, assignees: [{ type: 'user', userId }] }];
    const route = await PM.send('POST', T, { name: `PROOF route ${tag}`, description: 'PM route', isDefault: false, steps: steps(pmMe.id) });
    check('G14', 'allow', 'the PM creates a project review route', route.status === 201, said(route));
    const routeId = data(route)?.id;
    const create = await X.send('POST', T, { name: `PROOF X route ${tag}`, isDefault: true, steps: steps(xMe.id) });
    const rewrite = await X.send('PATCH', `${T}/${routeId}`, { steps: steps(xMe.id) });
    const archive = await X.send('DELETE', `${T}/${routeId}`);
    const after = items(await PM.send('GET', `${T}?scope=project&includeArchived=true`)).find((row) => row.id === routeId);
    check('G14', 'refuse', 'SUB-X creates, rewrites or archives a review route', [create, rewrite, archive].every((res) => refused(res, ['FORBIDDEN'])) && after?.status === 'active' && after?.steps?.[0]?.assignees?.[0]?.userId === pmMe.id, `${said(create)}, ${said(rewrite)}, ${said(archive)}; route ${after?.status}`);
    const siteCreate = await site.send('POST', T, { name: `PROOF site route ${tag}`, steps: steps(pmMe.id) });
    check('G14', 'refuse', 'a site engineer (no submittal.review, no workflow.manage) creates a review route', refused(siteCreate, ['FORBIDDEN']), said(siteCreate));
    const plannerRoute = await planner.send('POST', T, { name: `PROOF planner route ${tag}`, steps: steps(pmMe.id) });
    const plannerEdit = await planner.send('PATCH', `${T}/${data(plannerRoute)?.id}`, { description: 'edited by the planner' });
    const plannerArchive = await planner.send('DELETE', `${T}/${data(plannerRoute)?.id}`);
    check('G14', 'allow', 'the planning engineer (submittal.review) creates, edits and archives a route', plannerRoute.status === 201 && plannerEdit.status === 200 && plannerArchive.status === 200, `${said(plannerRoute)}, ${said(plannerEdit)}, ${said(plannerArchive)}`);
    const pmEdit = await PM.send('PATCH', `${T}/${routeId}`, { description: 'edited by the PM' });
    const pmArchive = await PM.send('DELETE', `${T}/${routeId}`);
    check('G14', 'allow', 'the PM edits and archives the route', pmEdit.status === 200 && pmArchive.status === 200, `${said(pmEdit)}, ${said(pmArchive)}`);
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
    console.log('\nVERDICT rfi-submittal-routing: DEFECT PRESENT');
    process.exitCode = 2;
  } else if (failedAllows.length) {
    console.log('\nVERDICT rfi-submittal-routing: OVER-BLOCKING (a legitimate caller is refused)');
    process.exitCode = 3;
  } else {
    console.log('\nVERDICT rfi-submittal-routing: FIXED (every refusal and every allowed case holds)');
    process.exitCode = 0;
  }
});
