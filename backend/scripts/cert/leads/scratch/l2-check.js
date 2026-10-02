'use strict';
// Independent checker's probe for L2. Read only, apart from the fixture's own idempotent set-up.
const fixture = require('../_files-fixture');
const { raw } = require('../../lib/api');

const { fetchFile, head, line, listOf, main, stage } = fixture;

const DOC_RFI = '11626323-c9cd-4ceb-917d-6504ad1ff7ea';
const DOC_EXEC = '64d91e9b-e35f-4236-8c71-14e58867ae39';
const DOC_WAIVER = 'd50bac5c-a93b-4214-9277-00fe1ca38092';
const RFI = 'dcfdade8-4c11-4889-8af5-55f8b5888892';
const text = (buffer) => (buffer.toString('latin1').match(/\(([^)]*)\) Tj/g) || []).map((s) => s.slice(1, -4)).join(' | ');

main(async () => {
  const s = await stage();
  const { P, pm, subA, subB, site, warehouse } = s;

  head('A. what each document says (PM view)');
  for (const id of [DOC_RFI, DOC_EXEC, DOC_WAIVER]) {
    const file = await fetchFile('PM', pm, `${P}/workflow/uploads/${id}`);
    if (file.buffer) line(`      text: ${text(file.buffer).slice(0, 200)}`);
  }

  head('B. the same three documents through both doors');
  const table = [];
  for (const [label, session] of [['SUB-A', subA], ['SUB-B', subB], ['SITE', site], ['WAREHOUSE', warehouse]]) {
    for (const [name, id] of [['rfi attachment', DOC_RFI], ['executed subcontract', DOC_EXEC], ['lien waiver', DOC_WAIVER]]) {
      const ruled = await session.send('GET', `${P}/attachments/documents/${id}`, undefined, { binary: true });
      const open = await session.send('GET', `${P}/workflow/uploads/${id}`, undefined, { binary: true });
      table.push({ label, name, ruled: ruled.status, open: open.status, bytes: open.buffer ? text(open.buffer).slice(0, 90) : '' });
    }
  }
  for (const row of table) line(`  ${row.label.padEnd(10)} ${row.name.padEnd(22)} /attachments/documents=${row.ruled}  /workflow/uploads=${row.open}  ${row.bytes}`);

  head("C. what the jobs list tells SUB-B about SUB-A's document");
  const jobs = await subB.send('GET', `${P}/jobs?type=document.extract&limit=100`);
  const job = listOf(jobs.body?.data).find((row) => row.payload?.documentId === DOC_RFI);
  line(`  ${JSON.stringify(job, null, 1).slice(0, 1500)}`);
  const warehouseJobs = await warehouse.send('GET', `${P}/jobs?type=document.extract&limit=100`);
  line(`  WAREHOUSE jobs list: ${warehouseJobs.status}, ${listOf(warehouseJobs.body?.data).length} job(s)`);

  head('D. by storage key instead of id, and a made-up id');
  const mine = listOf((await subA.send('GET', `${P}/attachments?recordType=rfi&recordId=${RFI}`)).body?.data);
  const link = mine.find((row) => (row.documentId || row.document?.id) === DOC_RFI);
  const storageKey = link?.document?.storageKey || link?.storageKey || link?.document?.key;
  line(`  storage key in SUB-A's attachment row: ${storageKey ? 'yes' : 'no'} (document fields: ${Object.keys(link?.document || {}).join(',')})`);
  if (storageKey) await fetchFile('SUB-B', subB, `${P}/workflow/uploads/${encodeURIComponent(storageKey)}`);
  await fetchFile('SUB-B', subB, `${P}/workflow/uploads/00000000-0000-4000-8000-000000000000`);

  head('E. the same id on another project of company 041, and with no sign-in');
  const other = Object.entries(fixture.inventory('041').projects).find(([key]) => key !== '041-01');
  if (other) await fetchFile(`PM on ${other[0]}`, pm, `/projects/${other[1].id}/workflow/uploads/${DOC_RFI}`);
  const anon = await raw('GET', `${P}/workflow/uploads/${DOC_RFI}`, { binary: true });
  line(`  [nobody] GET ${P}/workflow/uploads/${DOC_RFI} -> ${anon.status} ${anon.body?.error?.code || ''}`);
});
