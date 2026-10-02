'use strict';
// Independent check of FILES-X1 (scratch; read-mostly). Company 041, project 041-01.
const { ask, head, line, listOf, main, stage, whoIs } = require('../_files-fixture');

main(async () => {
  const s = await stage();
  const { P, pm, subB } = s;
  const subBParty = s.party.subB.id;
  head('A. who SUB-B is');
  const me = await whoIs(pm, P, subB.email);
  const subBUserId = me?.userId || me?.id;
  line(`  SUB-B user id ${subBUserId}; party ${subBParty}`);

  head('B. the RFI as the PM sees it — is SUB-B a participant in any way?');
  const reg = listOf((await pm.send('GET', `${P}/doc-control/register?recordType=rfi&search=CERT-L23`)).body?.data);
  const row = reg.find((r) => String(r.title || '').startsWith('CERT-L23'));
  const rfiId = row.recordId;
  const rfi = await pm.GET(`${P}/rfi/${rfiId}`);
  line(`  ${rfi.ref} status=${rfi.status} createdBy=${rfi.createdBy} managerUserId=${rfi.managerUserId} ballInCourt=${rfi.ballInCourtUserId}`);
  line(`  ownerPartyId=${rfi.ownerPartyId} reviewerPartyId=${rfi.reviewerPartyId} approverPartyId=${rfi.approverPartyId}`);
  const ids = (list) => (list || []).map((a) => a.userId || a.id);
  line(`  assignees=${JSON.stringify(ids(rfi.assignees))} distribution=${JSON.stringify(ids(rfi.distribution))}`);
  const participant = [rfi.createdBy, rfi.managerUserId, rfi.ballInCourtUserId, ...ids(rfi.assignees), ...ids(rfi.distribution)].includes(subBUserId);
  line(`  SUB-B is a named participant of the RFI: ${participant}`);
  const pmList = listOf((await pm.send('GET', `${P}/rfi?limit=100`)).body?.data);
  line(`  PM's RFI list: ${pmList.length} rows; contains the RFI: ${pmList.some((r) => r.id === rfiId)}`);

  head('C. the rule on the write path — the same person, the same record');
  const patch = await ask('SUB-B', subB, 'PATCH', `${P}/rfi/${rfiId}`, { priority: rfi.priority });
  line(`  => the update route answers: ${patch.status} ${patch.body?.error?.code || ''}`);
  const official = await ask('SUB-B', subB, 'POST', `${P}/rfi/${rfiId}/responses`, { body: 'X1-CHECK official attempt', isOfficial: true });
  line(`  => official answer attempt: ${official.status} ${official.body?.error?.code || ''}`);
  if (official.status === 201) line('  !!! official answer accepted — extra finding');

  head('D. where SUB-B gets ids from');
  const regB = await ask('SUB-B', subB, 'GET', `${P}/doc-control/register?recordType=rfi&search=CERT-L23`);
  const regRows = listOf(regB.body?.data);
  line(`  register rows for SUB-B: ${regRows.length}; gives the id: ${regRows.some((r) => r.recordId === rfiId)}`);
  const regSub = await ask('SUB-B', subB, 'GET', `${P}/doc-control/register?recordType=submittal`);
  line(`  submittal register rows for SUB-B: ${listOf(regSub.body?.data).length}`);

  head('E. the submittal as the PM sees it — is SUB-B a reviewer on a step?');
  const subs = listOf((await pm.send('GET', `${P}/doc-control/register?recordType=submittal`)).body?.data);
  const submittalId = subs[0].recordId;
  const sub = await pm.GET(`${P}/submittals/${submittalId}`);
  line(`  keys: ${Object.keys(sub).join(',')}`);
  line(`  ${sub.ref} status=${sub.status} createdBy=${sub.createdBy} manager=${sub.managerUserId} ballInCourt=${sub.ballInCourtUserId}`);
  line(`  ownerPartyId=${sub.ownerPartyId} reviewerPartyId=${sub.reviewerPartyId} approverPartyId=${sub.approverPartyId}`);
  const stepUsersOf = (d) => (d.reviewSteps || []).flatMap((st) => (st.assignments || st.assignees || st.reviewers || []).map((a) => a.userId || a.user?.id || a.id));
  for (const st of sub.reviewSteps || []) line(`  step ${JSON.stringify(st).slice(0, 500)}`);
  line(`  SUB-B is a step reviewer: ${stepUsersOf(sub).includes(subBUserId)}; on distribution: ${(sub.distribution || []).some((p) => (p.id || p.userId) === subBUserId)}`);

  const allSubs = listOf((await pm.send('GET', `${P}/submittals?limit=100`)).body?.data);
  line(`  PM's submittal list: ${allSubs.length}; with any party routing: ${allSubs.filter((r) => r.ownerPartyId || r.reviewerPartyId || r.approverPartyId).length}`);
  const parties = listOf(await pm.GET(`${P}/parties?status=active`));
  const partyOfUser = new Map();
  for (const p of parties) for (const m of p.members || []) if (m.status === 'active') partyOfUser.set(m.userId, p);
  line(`  party members on the project: ${partyOfUser.size}`);
  for (const r of allSubs) {
    const d = await pm.GET(`${P}/submittals/${r.id}`);
    const users = stepUsersOf(d);
    const partyReviewers = users.filter((u) => partyOfUser.has(u));
    const routed = [d.ownerPartyId, d.reviewerPartyId, d.approverPartyId].filter(Boolean);
    const locked = partyReviewers.filter((u) => !routed.includes(partyOfUser.get(u).id));
    line(`  ${d.ref} ${d.status}: routed parties ${routed.length}; step reviewers ${users.length}; of them party members ${partyReviewers.length}; of those NOT in a routed party ${locked.length}${locked.length ? ` (${locked.map((u) => partyOfUser.get(u).role).join(',')})` : ''}`);
  }

  head('F. other by-id routes (read only)');
  await ask('SUB-B', subB, 'GET', `${P}/rfi/${rfiId}/export.pdf`, undefined, { binary: true });
  const pk = await ask('SUB-B', subB, 'GET', `${P}/submittals/packages`);
  const pkgs = listOf(pk.body?.data);
  if (pkgs[0]) {
    const one = await ask('SUB-B', subB, 'GET', `${P}/submittals/packages/${pkgs[0].id}`);
    const data = one.body?.data || {};
    const items = data.submittals || data.items || [];
    line(`  package keys: ${Object.keys(data).join(',')}`);
    line(`  package ${pkgs[0].ref} "${pkgs[0].name}": ${items.length} item(s) shown to SUB-B: ${items.slice(0, 5).map((i) => `${i.ref} ${String(i.title || '').slice(0, 50)}`).join(' | ')}`);
  }
});
