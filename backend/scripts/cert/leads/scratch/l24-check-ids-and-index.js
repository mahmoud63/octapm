'use strict';
// Independent check for L24 (scratch): (1) can the attackers learn the document ids,
// (2) is any text indexed anywhere (031-01, 041-01, 041-02), (3) what the documents are.
const { EMAIL, as, line, head, listOf, main, projectId, stage } = require('../_files-fixture');

main(async () => {
  const s = await stage();
  const { P, pm, subB, site } = s;
  const targets = ['40b10e19-379b-4d7f-a3b0-660337f78200', '64d91e9b-e35f-4236-8c71-14e58867ae39', '92a28fd3-', '52b8b917-4297-48e0-9cce-629f2240404d', '03d6c145-', 'd50bac5c-a93b-4214-9277-00fe1ca38092'];
  head('1. who can learn the ids on 041-01 (jobs list)');
  for (const [label, session] of [['SUB-B', subB], ['SITE ENGINEER', site]]) {
    let cursor = null; let all = []; let pages = 0;
    do {
      const res = await session.send('GET', `${P}/jobs?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (res.status !== 200) { line(`  [${label}] GET ${P}/jobs -> ${res.status} ${res.body?.error?.code}`); break; }
      const items = listOf(res.body?.data);
      all = all.concat(items);
      cursor = res.body?.data?.nextCursor || res.body?.data?.meta?.nextCursor || res.body?.meta?.nextCursor || null;
      pages += 1;
    } while (cursor && pages < 10);
    const ids = new Set(all.map((job) => job.payload?.documentId).filter(Boolean));
    line(`  [${label}] jobs seen: ${all.length} (types: ${[...new Set(all.map((j) => j.type))].join(', ')}); distinct document ids published: ${ids.size}`);
    for (const t of targets) line(`      ${t}… published to ${label}: ${[...ids].some((id) => id.startsWith(t))}`);
  }
  head('2. index status');
  for (const [code, key, email] of [['041', '041-01', EMAIL.pm], ['041', '041-02', EMAIL.pm], ['031', '031-01', 'pm@c031.octapm-cert.test']]) {
    const res = await as(email).send('GET', `/projects/${projectId(code, key)}/documents/index-status`);
    line(`  ${key}: ${res.status} ${JSON.stringify(res.body?.data)}`);
  }
  head('3. the documents as the PM sees them (documentType / links) through the text route');
  for (const id of ['40b10e19-379b-4d7f-a3b0-660337f78200', '64d91e9b-e35f-4236-8c71-14e58867ae39', '52b8b917-4297-48e0-9cce-629f2240404d', 'd50bac5c-a93b-4214-9277-00fe1ca38092']) {
    const res = await pm.send('GET', `${P}/documents/${id}/text`);
    const d = res.body?.data?.document;
    line(`  ${id}: ${res.status} type=${d?.documentType} name=${d?.originalName} records=${JSON.stringify(d?.records)} revision=${JSON.stringify(d?.revision)} text=${JSON.stringify(res.body?.data?.text?.status)}`);
  }
  const P2 = `/projects/${projectId('041', '041-02')}`;
  const res = await pm.send('GET', `${P2}/documents/1bfbc701-eb8a-441b-9499-40e66bff82f7/text`);
  const d = res.body?.data?.document;
  line(`  1bfbc701 (bill): ${res.status} type=${d?.documentType} name=${d?.originalName} records=${JSON.stringify(d?.records)} revision=${JSON.stringify(d?.revision)}`);
});
