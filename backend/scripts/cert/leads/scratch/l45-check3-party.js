'use strict';
/**
 * L45 independent check, part 3 (scratch): the external-party angle, company 028 only.
 *
 * A guest of an external subcontractor party on project P (028-01) — a person
 * of ANOTHER firm working on one project of company 028 — addresses the RFI R
 * of project Q (where that firm has no presence) through P's custom-field
 * values routes. Same set-up technique as leads/lib/party-visibility.js
 * (invitation through the API, token from the certification mail log).
 */
const fs = require('fs');
const api = require('../../lib/api');
const { ATTACKER } = require('../_fib-constants');

const Q = process.argv[2];
const R = process.argv[3];
const P = ATTACKER.project;
const PM = ATTACKER.pm;
const API_LOG = process.env.CERT_API_LOG || 'C:/Temp/octapm-cert/logs/api.log';
const GUEST = { email: 'l45-subx@guests.c028.octapm-cert.test', name: 'L45 Guest Sub X' };
const PARTY_COMPANY = 'L45 Subcontractor X (cert leads)';
const line = (s) => console.log(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secretOf = () => {
  const v = process.env.CERT_PASSWORD;
  if (!v) throw new Error('CERT_PASSWORD is not set (backend/.env).');
  return v;
};
const tokenFromLog = (email) => {
  const text = fs.readFileSync(API_LOG, 'utf8');
  const marker = `[email:local] -> ${email} |`;
  const at = text.lastIndexOf(marker);
  if (at < 0) return null;
  const next = text.indexOf('[email:local] ->', at + marker.length);
  const block = text.slice(at, next < 0 ? undefined : next);
  const match = block.match(/accept-invite\?token=([A-Za-z0-9_\-.~%]+)/);
  return match ? decodeURIComponent(match[1]) : null;
};

(async () => {
  if (!Q || !R) throw new Error('usage: l45-check3-party.js <projectQ> <rfiR>');
  const pm = api.as(PM, ATTACKER.orgId);

  // party on P
  const listed = await pm.send('GET', `/projects/${P}/parties?status=all`);
  const d = listed.body?.data;
  const items = (Array.isArray(d) ? d : d?.items || d?.parties) || [];
  line(`PM lists parties of P -> ${listed.status}: ${items.map((p) => `${p.role}:${p.company?.name || p.companyName || p.name}`).join(' | ')}`);
  let party = items.find((p) => (p.company?.name || p.companyName || p.name) === PARTY_COMPANY);
  if (!party) {
    const made = await pm.send('POST', `/projects/${P}/parties`, { role: 'subcontractor', companyName: PARTY_COMPANY });
    line(`PM creates subcontractor party on P -> ${made.status} ${made.body?.error?.code || ''} ${made.body?.error?.message || ''}`);
    party = made.body?.data;
  }
  line(`party X = ${party?.id} role=${party?.role}`);

  // guest of that party
  const login = await api.raw('POST', '/auth/login', { json: { email: GUEST.email, password: secretOf() } });
  if (login.status !== 200) {
    const invited = await pm.send('POST', '/users/invitations', { email: GUEST.email, role: 'site_engineer', projectId: P, projectPartyId: party.id, note: 'L45 independent check' });
    line(`PM invites the guest -> ${invited.status} ${invited.body?.error?.code || ''} ${invited.body?.error?.message || ''}`);
    let token = null;
    for (let i = 0; i < 20 && !token; i += 1) {
      await sleep(250);
      token = tokenFromLog(GUEST.email);
    }
    if (!token) throw new Error('no invitation mail in the certification log');
    const accepted = await api.raw('POST', '/auth/invitations/accept', { json: { token, name: GUEST.name, password: secretOf() } });
    line(`guest accepts -> ${accepted.status} ${accepted.body?.error?.code || ''}`);
  } else line('guest already exists');
  const guest = api.as(GUEST.email);

  // who the guest is on P
  const projects = await guest.send('GET', '/projects');
  const pd = projects.body?.data;
  const plist = (Array.isArray(pd) ? pd : pd?.items || pd?.projects || pd?.rows) || [];
  line(`guest GET /projects -> ${projects.status}, sees ${plist.length} project(s): ${plist.map((p) => p.id).join(', ')}`);
  line(`guest GET /projects/Q/rfi/R -> ${(await guest.send('GET', `/projects/${Q}/rfi/${R}`)).status}`);
  line(`guest GET /projects/P/rfi/R -> ${(await guest.send('GET', `/projects/${P}/rfi/${R}`)).status}`);

  // PM plants a known value through Q
  const secret = `pm-secret-for-party-check-${Date.now()}`;
  const put = await pm.send('PUT', `/projects/${Q}/custom-fields/values/rfi/${R}`, { values: { cert_l45_probe: secret }, partial: true });
  line(`PM PUT via Q {cert_l45_probe:${secret}} -> ${put.status}`);

  const single = await guest.send('GET', `/projects/${P}/custom-fields/values/rfi/${R}`);
  line(`guest GET single values of R via P -> ${single.status} ${single.body?.error?.code || ''} values=${JSON.stringify(single.body?.data?.values)}`);
  const bulk = await guest.send('GET', `/projects/${P}/custom-fields/values?recordType=rfi&recordIds=${R}`);
  line(`guest GET bulk values of R via P -> ${bulk.status} ${bulk.body?.error?.code || ''} items=${JSON.stringify(bulk.body?.data?.items)}`);
  const stamp = `guest-wrote-${Date.now()}`;
  const write = await guest.send('PUT', `/projects/${P}/custom-fields/values/rfi/${R}`, { values: { cert_l45_probe: stamp }, partial: true });
  line(`guest PUT values of R via P -> ${write.status} ${write.body?.error?.code || ''} ${write.body?.error?.message || ''}`);
  const back = await pm.send('GET', `/projects/${Q}/custom-fields/values/rfi/${R}`);
  line(`PM GET via Q afterwards -> cert_l45_probe=${JSON.stringify(back.body?.data?.values?.cert_l45_probe)}`);

  // other record types the subcontractor profile can only read
  for (const type of ['commitment', 'sub_pay_app', 'change_order', 'ipc_certificate']) {
    const res = await guest.send('GET', `/projects/${P}/custom-fields/values?recordType=${type}&recordIds=${R}`);
    line(`guest bulk GET recordType=${type} via P -> ${res.status} ${res.body?.error?.code || ''}`);
  }

  const read = JSON.stringify(single.body || '').includes(secret) || JSON.stringify(bulk.body || '').includes(secret);
  const wrote = back.body?.data?.values?.cert_l45_probe === stamp;
  line('');
  line(`external guest read the Q record's value through P: ${read}; external guest's write landed on the Q record: ${wrote}`);
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exitCode = 1;
});
