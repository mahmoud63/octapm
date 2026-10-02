'use strict';

/**
 * X-FINANCE-2 (found while reproducing L37) — create-project-from-template takes the
 * project's fields without the validation POST /projects applies.
 *
 * POST /projects validates every field (projectPayloadValidators: retention
 * 0-100, cutoff day 1-31, money >= 0, a three-letter currency, a status from a
 * list). POST /company/project-templates/:id/create-project validates the
 * name only and hands the rest of the body to the same service.
 *
 * Company 041 (Enterprise, no project limit, so the limit of L37 plays no
 * part). For each field: the value is sent to POST /projects (control: 400
 * expected) and to the template door. Every project made is archived at the
 * end, and so is the template.
 *
 * Exit code 0 = the template door refuses every value POST /projects refuses;
 * 2 = it stores one, or answers 500.
 */

const { call, must, who, section, say, stamp, verdict, run } = require('./_finance-lib');

const LEAD = 'X-FINANCE-2';
const COMPANY = '041';

const CASES = [
  ['defaultRetentionRate', 500, 'a retention rate of 500%'],
  ['reportingCutoffDay', 99, 'a reporting cutoff on day 99 of the month'],
  ['status', 'bogus', 'a status that is not one of the four'],
  ['ldRatePerDay', -5, 'negative liquidated damages per day'],
  ['contractValue', -100, 'a negative contract value'],
  ['weatherAllowanceDays', -3, 'a negative weather allowance'],
  ['currency', 'EUROS', 'a five-letter currency'],
];

run(LEAD, async () => {
  const pm = who(COMPANY, 'pm');
  const made = [];

  section('0. a template with no settings');
  const template = await must(pm, 'POST', '/company/project-templates', { name: `X2 template ${stamp()}`, description: 'Certification extra X2' }, { show: (d) => ({ id: d.id, name: d.name }) });

  const rows = [];
  for (const [field, value, meaning] of CASES) {
    section(`${field} = ${JSON.stringify(value)} — ${meaning}`);
    const control = await call(pm, 'POST', '/projects', { name: `X2 control ${field} ${stamp()}`, [field]: value }, { show: (d) => ({ id: d.id, [field]: d[field] }), max: 300 });
    if (control.ok) made.push(control.data.id);
    const viaTemplate = await call(pm, 'POST', `/company/project-templates/${template.id}/create-project`, { name: `X2 template ${field} ${stamp()}`, [field]: value }, { show: (d) => ({ id: d.project?.id ?? d.id, [field]: (d.project ?? d)[field] }), max: 400 });
    let stored;
    if (viaTemplate.ok) {
      const id = viaTemplate.data.project?.id ?? viaTemplate.data.id;
      made.push(id);
      const read = await call(pm, 'GET', `/projects/${id}`, undefined, { quiet: true });
      stored = read.data?.[field];
      say(`   stored on the project: ${field} = ${JSON.stringify(stored)}`);
    }
    rows.push({ field, value, control: control.status, template: viaTemplate.status, code: viaTemplate.error?.code ?? null, stored });
  }

  section('putting things back');
  for (const id of made) await call(pm, 'DELETE', `/projects/${id}`, undefined, { quiet: true });
  await call(pm, 'DELETE', `/company/project-templates/${template.id}`, undefined, { quiet: true });
  say(`   archived ${made.length} project(s) and the template`);

  section('result');
  for (const row of rows) {
    const same = row.control === row.template || (row.control >= 400 && row.control < 500 && row.template >= 400 && row.template < 500);
    say(`   ${same ? 'ok   ' : 'WRONG'} ${row.field} = ${JSON.stringify(row.value)}: POST /projects ${row.control}; template door ${row.template}${row.code ? ` ${row.code}` : ''}${row.stored !== undefined ? `, stored ${JSON.stringify(row.stored)}` : ''}`);
  }
  const refusedByControl = rows.filter((row) => row.control >= 400 && row.control < 500);
  const accepted = refusedByControl.filter((row) => row.template >= 200 && row.template < 300);
  const crashed = refusedByControl.filter((row) => row.template >= 500);
  if (!accepted.length && !crashed.length) {
    return verdict(LEAD, 'NOT_REPRODUCED', 'the template door refused every value POST /projects refuses.');
  }
  return verdict(
    LEAD,
    'CONFIRMED',
    `of ${refusedByControl.length} values POST /projects refuses with 400, create-project-from-template stored ${accepted.length} (${accepted.map((row) => `${row.field}=${JSON.stringify(row.stored ?? row.value)}`).join(', ') || 'none'}) and answered 500 to ${crashed.length} (${crashed.map((row) => row.field).join(', ') || 'none'}).`
  );
});
