'use strict';

/**
 * L4 — Prime contract clientCompanyId.
 *
 * A person of company 030 with contract.manage edits company 030's OWN prime
 * contract, setting clientCompanyId to a Company id that belongs to company
 * 040. The API must refuse (404/400). The defect is present when the write is
 * accepted, and worse when the answer's `client` is company 040's company
 * name.
 *
 *   node scripts/cert/leads/l4-prime-contract-foreign-client.js
 *
 * Exit code 0 = refused; 2 = the defect is present.
 */

const { as } = require('../lib/api');

const LEAD = 'L4';
const OWN = '030';
const OTHER = '040';
const mail = (who, code) => `${who}@c${code}.octapm-cert.test`;
const show = (label, value) => console.log(`${label} ${JSON.stringify(value)}`);
const listOf = (data) => (Array.isArray(data) ? data : data?.items || data?.rows || []);

const main = async () => {
  const ownPm = as(mail('pm', OWN));
  const otherPm = as(mail('pm', OTHER));

  const ownCompanies = listOf((await ownPm.send('GET', '/companies')).body?.data);
  const otherCompanies = listOf((await otherPm.send('GET', '/companies')).body?.data);
  const foreign = otherCompanies.find((c) => /Property Group/.test(c.name)) || otherCompanies[0];
  const ownClient = ownCompanies.find((c) => /Property Group|Municipality|Authority/.test(c.name)) || ownCompanies[0];
  console.log(`Other company's Company record (the id sent): ${foreign.id} — "${foreign.name}"`);
  console.log(`Is that id in company ${OWN}'s own company directory? ${ownCompanies.some((c) => c.id === foreign.id)}`);

  const project = listOf((await ownPm.send('GET', '/projects')).body?.data).find((p) => p.name === 'Metro Depot') || listOf((await ownPm.send('GET', '/projects')).body?.data)[0];
  console.log(`Company ${OWN} project: ${project.id} "${project.name}"`);

  const before = await ownPm.send('GET', `/projects/${project.id}/prime-contract`);
  const originalClientId = before.body?.data?.clientCompanyId ?? null;
  console.log(`Prime contract before: clientCompanyId=${originalClientId}, client=${JSON.stringify(before.body?.data?.client ?? null)}`);

  const attempt = async (label, companyId) => {
    console.log(`\n--- ${label}`);
    console.log(`> ${ownPm.email}  PATCH /api/v1/projects/${project.id}/prime-contract`);
    show('> body', { clientCompanyId: companyId });
    const res = await ownPm.send('PATCH', `/projects/${project.id}/prime-contract`, { clientCompanyId: companyId });
    console.log(`< ${res.status}${res.body?.error ? ` ${res.body.error.code}: ${res.body.error.message}` : ''}`);
    show('< clientCompanyId / client', { clientCompanyId: res.body?.data?.clientCompanyId ?? null, client: res.body?.data?.client ?? null });
    const leaks = res.status < 300 && res.body?.data?.client && String(res.body.data.client).includes(foreign.name);
    return { status: res.status, accepted: res.status < 300, client: res.body?.data?.client ?? null, leaks };
  };

  // Control: an own-company company id is accepted (if the directory has one).
  const control = ownClient ? await attempt('control: own company directory id', ownClient.id) : { accepted: null };

  const result = await attempt("set clientCompanyId to company 040's Property Group", foreign.id);

  // Read it back to confirm the foreign name is served on GET too.
  const read = await ownPm.send('GET', `/projects/${project.id}/prime-contract`);
  console.log(`\n--- read back GET /api/v1/projects/${project.id}/prime-contract`);
  show('< clientCompanyId / client', { clientCompanyId: read.body?.data?.clientCompanyId ?? null, client: read.body?.data?.client ?? null });
  const readLeaks = read.body?.data?.client && String(read.body.data.client).includes(foreign.name);

  // Restore the original client so the company is left as found.
  const restore = await ownPm.send('PATCH', `/projects/${project.id}/prime-contract`, { clientCompanyId: originalClientId });
  console.log(`\n(cleanup) restored clientCompanyId to ${originalClientId}: ${restore.status}`);

  if (!result.accepted) {
    console.log(`\nVERDICT ${LEAD}: NOT_REPRODUCED — the API refused the foreign clientCompanyId (${result.status}).`);
    process.exitCode = 0;
    return;
  }
  if (result.leaks || readLeaks) {
    console.log(`\nVERDICT ${LEAD}: CONFIRMED — the foreign clientCompanyId was accepted (${result.status}) and the contract's client is now company ${OTHER}'s company name "${result.client}".`);
    process.exitCode = 2;
  } else {
    console.log(`\nVERDICT ${LEAD}: PARTLY_CONFIRMED — the foreign clientCompanyId was accepted (${result.status}) but the answer did not show company ${OTHER}'s name (client=${JSON.stringify(result.client)}).`);
    process.exitCode = 2;
  }
};

main().catch((error) => {
  console.error(error);
  console.log(`VERDICT ${LEAD}: NOT_REPRODUCED — the script failed before a result: ${error.message}`);
  process.exitCode = 1;
});
