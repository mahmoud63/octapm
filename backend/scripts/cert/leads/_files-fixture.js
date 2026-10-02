'use strict';

/**
 * Shared set-up for the "files" lead group (L2, L23, L24). Not a lead itself.
 *
 * Everything goes through the certification API (lib/api.js). The fixture is
 * idempotent: a second run finds what the first one made and makes nothing new,
 * so the upload limiter (40 requests an hour per person per project) is not
 * spent by re-running a script.
 *
 * Project 041-01 (company 041) is the stage. It already has an owner, a
 * consultant, a contractor and one subcontractor party ("Concrete Works"),
 * executed subcontracts and a lien waiver. The fixture adds two more
 * subcontractor parties, each with one member who is a member of company 041
 * but is NOT assigned to the project — so that person reaches the project only
 * through the party (scope "party", role "external_party"):
 *
 *   SUB-A  "CERT-FILES Sub A Formwork"    mei.adeyemi.7@c041
 *   SUB-B  "CERT-FILES Sub B Electrical"  ibrahim.jensen.2@c041
 */

const fs = require('fs');
const crypto = require('crypto');
const { as, raw } = require('../lib/api');
const { buildPopulation } = require('../lib/spec');

const CODE = '041';
const PROJECT_KEY = '041-01';
const DOMAIN = `c${CODE}.octapm-cert.test`;
const EMAIL = {
  pm: `pm@${DOMAIN}`,
  planner: `planner@${DOMAIN}`,
  qs: `qs@${DOMAIN}`,
  site: `site@${DOMAIN}`,
  warehouse: `warehouse@${DOMAIN}`,
  subA: `mei.adeyemi.7@${DOMAIN}`,
  subB: `ibrahim.jensen.2@${DOMAIN}`,
};
const PARTY_NAME = { subA: 'CERT-FILES Sub A Formwork', subB: 'CERT-FILES Sub B Electrical' };

const inventory = (code = CODE) => JSON.parse(fs.readFileSync(`C:/Temp/octapm-cert/state/inventory/${code}.json`, 'utf8'));
const projectId = (code = CODE, key = PROJECT_KEY) => {
  const id = inventory(code).projects?.[key]?.id;
  if (!id) throw new Error(`no project ${key} in the inventory of company ${code}`);
  return id;
};
const company = (code = CODE) => buildPopulation().companies.find((row) => row.code === code);
const userId = (email, code = CODE) => {
  const person = company(code).people.find((row) => row.email === email);
  if (!person) throw new Error(`${email} is not in the population of company ${code}`);
  return person.id;
};

// ── printing ────────────────────────────────────────────────────────────────

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const line = (text = '') => console.log(text);
const head = (title) => line(`\n── ${title} ${'─'.repeat(Math.max(4, 76 - title.length))}`);

/** One line per answer: status, and either the error code or what the body is. */
const describe = (res) => {
  if (res.buffer) return `${res.status} ${res.headers.get('content-type') || ''} ${res.buffer.length} bytes sha256=${sha(res.buffer).slice(0, 16)}…`;
  const error = res.body?.error;
  if (error) return `${res.status} ${error.code}: ${String(error.message).slice(0, 140)}`;
  return `${res.status} ${String(res.text ?? '').slice(0, 160)}`;
};

/** Sends as a person and prints the exchange. `label` says who that person is. */
const ask = async (label, session, method, route, payload, options = {}) => {
  const res = await session.send(method, route, payload, options);
  line(`  [${label}] ${method} ${route}`);
  line(`      -> ${options.note ? `${options.note}: ` : ''}${describe(res)}`);
  return res;
};
/** A download: 200 comes back as bytes, anything else as the JSON refusal. */
const fetchFile = (label, session, route) => ask(label, session, 'GET', route, undefined, { binary: true });

/** Sends with a raw bearer (an API key); the bearer is never printed. */
const askWithKey = async (label, token, method, route) => {
  const res = await raw(method, route, { token, binary: true });
  line(`  [${label}] ${method} ${route}`);
  line(`      -> ${describe(res)}`);
  return res;
};

// ── files ───────────────────────────────────────────────────────────────────

const esc = (value) => String(value).replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '-');
/** A small valid one-page PDF whose text is `lines`. */
const pdf = (lines) => {
  const stream = `BT /F1 11 Tf 56 780 Td 15 TL ${lines.map((text) => `(${esc(text)}) Tj T*`).join(' ')} ET`;
  const objects = [
    null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let n = 1; n < objects.length; n += 1) {
    offsets.push(Buffer.byteLength(out));
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
};
const pdfFile = (name, lines) => ({ filename: `${name}.pdf`, contentType: 'application/pdf', body: pdf(lines) });

// ── parties ─────────────────────────────────────────────────────────────────

const listOf = (data) => (Array.isArray(data) ? data : data?.items || data?.rows || data?.orders || data?.records || []);

/** The project's active party of this role for this company name; made when absent. */
const ensureParty = async (pm, P, { role, companyName }) => {
  const parties = listOf(await pm.GET(`${P}/parties?status=active`));
  const found = parties.find((row) => row.role === role && row.company?.name === companyName && row.status === 'active');
  if (found) return found;
  const made = await pm.POST(`${P}/parties`, { role, companyName });
  line(`  (set-up) party made: ${role} "${companyName}" ${made.id}`);
  return made;
};

const ensureMember = async (pm, P, party, email) => {
  const id = userId(email);
  const already = (party.members || []).some((member) => member.userId === id && member.status === 'active');
  if (already) return;
  await pm.POST(`${P}/parties/${party.id}/members`, { userId: id });
  line(`  (set-up) ${email} added to party ${party.company?.name || party.id}`);
};

/**
 * The stage: project, sessions and the parties. Returns
 * { P, pid, pm, planner, qs, site, warehouse, subA, subB, party: { subA, subB, contractor, consultant, concrete } }.
 */
const stage = async () => {
  const pid = projectId();
  const P = `/projects/${pid}`;
  const pm = as(EMAIL.pm);
  const partyA = await ensureParty(pm, P, { role: 'subcontractor', companyName: PARTY_NAME.subA });
  const partyB = await ensureParty(pm, P, { role: 'subcontractor', companyName: PARTY_NAME.subB });
  await ensureMember(pm, P, partyA, EMAIL.subA);
  await ensureMember(pm, P, partyB, EMAIL.subB);
  const parties = listOf(await pm.GET(`${P}/parties?status=active`));
  const byRole = (role, test = () => true) => parties.find((row) => row.role === role && test(row)) || null;
  return {
    pid,
    P,
    pm,
    planner: as(EMAIL.planner),
    qs: as(EMAIL.qs),
    site: as(EMAIL.site),
    warehouse: as(EMAIL.warehouse),
    subA: as(EMAIL.subA),
    subB: as(EMAIL.subB),
    party: {
      subA: parties.find((row) => row.id === partyA.id) || partyA,
      subB: parties.find((row) => row.id === partyB.id) || partyB,
      contractor: byRole('contractor'),
      consultant: byRole('consultant'),
      concrete: byRole('subcontractor', (row) => /Concrete Works/.test(row.company?.name || '')),
    },
  };
};

/** Prints how the API sees a person on the project (role, scope, parties) through the project's own team list. */
const whoIs = async (pm, P, email) => {
  const team = listOf(await pm.GET(`${P}/team`));
  const row = team.find((member) => member.email === email);
  line(`  ${email}: ${row ? `assignment=${row.assignmentRole || 'none'} source=${row.source} party=${row.party ? `${row.party.role} (${row.party.companyName || row.party.company?.name || row.party.projectPartyId || ''})` : 'none'} orgRole=${row.orgRole}` : 'not on the project team list'}`);
  return row;
};

const verdict = (lead, word, sentence) => {
  line(`\nVERDICT ${lead}: ${word} — ${sentence}`);
  process.exitCode = word === 'NOT_REPRODUCED' || word === 'EXPECTED_BEHAVIOUR' ? 0 : 2;
};

const main = (run) =>
  run().catch((error) => {
    console.error(`\nThe script could not finish: ${error.stack || error.message}`);
    process.exitCode = 1;
  });

module.exports = { CODE, PROJECT_KEY, EMAIL, PARTY_NAME, as, raw, ask, askWithKey, company, describe, ensureMember, ensureParty, fetchFile, head, inventory, line, listOf, main, pdf, pdfFile, projectId, sha, stage, userId, verdict, whoIs };
