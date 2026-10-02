'use strict';
// Scratch: remove the cross-company link left by the checker's own run of l8-submittal-foreign-package-template.js
// (its cleanup archives the 028 submittal without unlinking it) and report what cannot be undone through the API.
const { as } = require('../../lib/api');
const { ATTACKER, VICTIM } = require('../_fib-constants');
const err = (r) => (r.body?.error ? `${r.body.error.code}: ${String(r.body.error.message).slice(0, 100)}` : '');

(async () => {
  const A = as(ATTACKER.pm, ATTACKER.orgId);
  const V = as(VICTIM.pm, VICTIM.orgId);
  const VP = `/projects/${VICTIM.project}/submittals`;
  const AP = `/projects/${ATTACKER.project}/submittals`;

  const mine = { pkg: '787e41e1-61ab-4a59-9180-2f2ebbb44801', sub: '0cb26376-5871-4dae-8382-bf7d6d441d39', tpl: 'd4e6c8f6-db02-4244-bd20-9156d9bc597d' };
  const rm = await V.send('DELETE', `${VP}/packages/${mine.pkg}/items/${mine.sub}`);
  console.log(`victim removes foreign item ${mine.sub} from PKG-002 -> ${rm.status} ${err(rm)} items now=${(rm.body?.data?.items || []).length}`);
  const at = await V.send('DELETE', `${VP}/workflow-templates/${mine.tpl}`);
  console.log(`victim archives the template the claimant's script created in this run -> ${at.status} ${err(at)}`);

  // the scratch check's first submittal: archived while still pointing at 042's template
  const scratchSub = '02072d4f-8a3d-4d41-9d36-d6b03a9d5b0b';
  const g = await A.send('GET', `${AP}/${scratchSub}`);
  console.log(`028 submittal ${scratchSub}: status=${g.body?.data?.status} package=${JSON.stringify(g.body?.data?.package)} workflowTemplate=${JSON.stringify(g.body?.data?.workflowTemplate)}`);
  const un = await A.send('PATCH', `${AP}/${scratchSub}`, { workflowTemplateId: null });
  console.log(`028 PATCH workflowTemplateId=null on it -> ${un.status} ${err(un)}`);
  const g2 = await A.send('GET', `${AP}/${mine.sub}`);
  console.log(`028 submittal ${mine.sub} (claimant script, this run): status=${g2.body?.data?.status} package=${JSON.stringify(g2.body?.data?.package)} workflowTemplate=${JSON.stringify(g2.body?.data?.workflowTemplate)}`);
})().catch((e) => { console.error('ERROR', e.stack || e.message); process.exitCode = 1; });
