'use strict';

/**
 * L46 — The assistant answers from body.projectId with no project-access check.
 *
 * Actor: a site engineer of company 072 who is NOT assigned to project 072-01
 * (james.rojas.9@ — an ordinary member; GET /projects lists two other
 * projects for them and GET /projects/072-01 answers 403).
 *
 * No AI key is configured on the certification API, so the model is never
 * called. What is tested is whether the access check happens BEFORE the
 * retrieval and the model step: the project-mounted assistant refuses the
 * project (403); the organisation-mounted assistant must refuse the same
 * projectId in the body.
 *
 * Exit code 0 = POST /assistant/ask refuses a projectId the caller cannot
 * open; 2 = it accepts it and works on that project.
 */

const fs = require('fs');
const path = require('path');
const pv = require('./lib/party-visibility');

const ACTOR = `james.rojas.9@c${pv.CODE}.octapm-cert.test`;

pv.main(async () => {
  const P = pv.project().id;
  const who = pv.api.as(ACTOR);
  const pm = pv.api.as(pv.PM);

  console.log('L46 — the assistant asked about a project the caller is not assigned to');
  console.log(`project ${P} (072-01), caller ${ACTOR} (site engineer, member of company 072)`);

  const truth = await pm.GET(`/projects/${P}`);
  const me = await who.GET('/auth/me');
  console.log(`  caller role: ${me.role}, company admin: ${me.isCompanyAdmin}`);

  console.log('\n=== Controls: the caller cannot open the project ===');
  const list = await pv.show(who, 'SITE ENG', 'GET', '/projects?limit=100', undefined, { pick: (b) => (b?.data?.items || b?.data || []).map((p) => p.name) });
  const listed = (list.body?.data?.items || list.body?.data || []).some((p) => p.id === P);
  const direct = await pv.show(who, 'SITE ENG', 'GET', `/projects/${P}`);
  const mounted = await pv.show(who, 'SITE ENG', 'POST', `/projects/${P}/assistant/ask`, { question: 'What is the contract value and who is the client of this project?' });
  if (listed || direct.status === 200) {
    return pv.verdict('L46', 'NOT_REPRODUCED', `${ACTOR} can open the project (the set-up changed): pick another unassigned member.`);
  }

  console.log('\n=== The organisation-mounted assistant, with the project id in the body ===');
  const ask = await pv.show(who, 'SITE ENG', 'POST', '/assistant/ask', { question: 'What is the contract value and who is the client of this project?', projectId: P }, {
    max: 900,
    pick: (b) => (b?.data ? { conversationId: b.data.conversationId, projectId: b.data.projectId, degraded: b.data.degraded, answer: b.data.message?.content, sources: b.data.message?.sources, retrieval: b.data.retrieval } : b),
  });
  const data = ask.body?.data || null;

  let conversation = null;
  if (data?.conversationId) {
    conversation = await pv.show(who, 'SITE ENG', 'GET', `/assistant/conversations/${data.conversationId}`, undefined, { max: 400, pick: (b) => (b?.data ? { id: b.data.id, projectId: b.data.projectId, project: b.data.project, title: b.data.title, messages: (b.data.messages || []).length } : b) });
  }

  console.log('\n=== For comparison: an external-party guest at the same route ===');
  const s = await pv.setup({ need: ['subX'], log: () => {} });
  const other = Object.values(pv.inventory().projects).find((p) => p.id !== P);
  const guest = await pv.show(s.subX, 'SUB-X guest', 'POST', '/assistant/ask', { question: 'What is the contract value?', projectId: other.id }, { max: 300 });

  console.log('\n=== A project id of another company (026): does the missing check cross companies? ===');
  const foreign = Object.values(JSON.parse(fs.readFileSync(path.join(process.env.CERT_STATE_DIR || 'C:/Temp/octapm-cert/state', 'projects.json'), 'utf8'))['026'])[0];
  const cross = await pv.show(who, 'SITE ENG', 'POST', '/assistant/ask', { question: 'Who is the client?', projectId: foreign.id }, {
    max: 420,
    pick: (b) => ({ code: b?.error?.code, message: b?.error?.message ? String(b.error.message).replace(/\s+/g, ' ').slice(-150) : undefined, data: b?.data ? { projectId: b.data.projectId, retrieval: b.data.retrieval } : undefined }),
  });
  const crossLeak = cross.status === 200 && JSON.stringify(cross.body).includes(foreign.name);
  if (cross.body?.data?.conversationId) await who.send('DELETE', `/assistant/conversations/${cross.body.data.conversationId}`);

  // Leave no conversation behind.
  if (data?.conversationId) await who.send('DELETE', `/assistant/conversations/${data.conversationId}`);

  const namedProject = (data?.retrieval?.projects || []).includes(truth.name);
  console.log('\nSummary');
  console.log(`  GET /projects/${P} as the caller: ${direct.status} ${direct.body?.error?.code || ''}`);
  console.log(`  POST /projects/${P}/assistant/ask: ${mounted.status} ${mounted.body?.error?.code || ''}`);
  console.log(`  POST /assistant/ask {projectId}: ${ask.status}${data ? ` — worked on project ${data.projectId}; retrieval.projects = ${JSON.stringify(data.retrieval?.projects)}; sources ${data.retrieval?.sources}; degraded ${data.degraded}` : ` ${ask.body?.error?.code || ''}`}`);
  console.log(`  conversation stored against the project: ${conversation?.body?.data?.projectId === P}`);
  console.log(`  guest at /assistant/ask: ${guest.status} ${guest.body?.error?.code || ''}`);
  console.log(`  another company's project id: ${cross.status} ${cross.body?.error?.code || ''} — ${crossLeak ? 'ITS NAME WAS RETURNED (cross-company)' : cross.status === 500 ? 'stopped only by the database\'s composite foreign key (an unhandled 500, not a 403/404); nothing of the other company returned' : 'nothing of the other company returned'}`);
  console.log('  what the model would be sent with a key configured (assistant.service buildMessages): the project\'s name, status, client name, contract value and currency, start and end dates, and the document hits of retrieval.service (searchDocuments with the caller\'s company role, no project access).');

  if (ask.status === 200 && data?.projectId === P) {
    return pv.verdict(
      'L46',
      namedProject ? 'CONFIRMED' : 'PARTLY_CONFIRMED',
      `POST /assistant/ask accepts the projectId of a project the caller is refused everywhere else (403) and runs retrieval on it — the answer names the project ("${truth.name}") and a conversation is stored against it; no access check precedes the model step (the model itself is not configured here).`,
    );
  }
  return pv.verdict('L46', 'NOT_REPRODUCED', `POST /assistant/ask refused the unassigned project (${ask.status} ${ask.body?.error?.code || ''}).`);
});
