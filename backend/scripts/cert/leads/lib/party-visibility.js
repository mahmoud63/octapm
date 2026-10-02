'use strict';

/**
 * Shared set-up for the party-visibility leads (L25, L40-L44, L46).
 *
 * Everything is done through the certification API, in company 072 only,
 * project 072-01 (Wastewater Treatment Works — the one project that carries
 * every record driver). The helper is idempotent: it creates what is missing
 * and reuses what is there, so every lead script can be run on its own, any
 * number of times.
 *
 * The external people are real guests: invited with POST /users/invitations
 * { projectId, projectPartyId }, the link read from the certification API's
 * mail log (e-mail is written to the log, never sent), and accepted with
 * POST /auth/invitations/accept. Nothing is written to the database directly.
 *
 *   SUB-X  guest of the project's existing subcontractor party
 *   SUB-Y  guest of a second subcontractor party created for these leads
 *   CONS   guest of the project's consultant party
 */

const fs = require('fs');
const path = require('path');
const api = require('../../lib/api');

const CODE = '072';
const PM = `pm@c${CODE}.octapm-cert.test`;
const STATE_DIR = process.env.CERT_STATE_DIR || 'C:/Temp/octapm-cert/state';
const API_LOG = process.env.CERT_API_LOG || 'C:/Temp/octapm-cert/logs/api.log';

const inventory = () => JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'inventory', `${CODE}.json`), 'utf8'));
const project = () => inventory().projects[`${CODE}-01`];

const GUESTS = {
  subX: { email: `pv-subx@guests.c${CODE}.octapm-cert.test`, name: 'PV Guest Sub X' },
  subY: { email: `pv-suby@guests.c${CODE}.octapm-cert.test`, name: 'PV Guest Sub Y' },
  consultant: { email: `pv-consultant@guests.c${CODE}.octapm-cert.test`, name: 'PV Guest Consultant' },
};
const SUB_Y_COMPANY = 'PV Subcontractor Y (cert leads)';

const password = () => {
  const value = process.env.CERT_PASSWORD;
  if (!value) throw new Error('CERT_PASSWORD is not set (backend/.env).');
  return value;
};

/** The acceptance token of the newest invitation mail written to the log for this address. */
const invitationTokenFromLog = (email) => {
  const text = fs.readFileSync(API_LOG, 'utf8');
  const marker = `[email:local] -> ${email} |`;
  const at = text.lastIndexOf(marker);
  if (at < 0) return null;
  const next = text.indexOf('[email:local] ->', at + marker.length);
  const block = text.slice(at, next < 0 ? undefined : next);
  const match = block.match(/accept-invite\?token=([A-Za-z0-9_\-.~%]+)/);
  return match ? decodeURIComponent(match[1]) : null;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const canSignIn = async (email) => {
  const res = await api.raw('POST', '/auth/login', { json: { email, password: password() } });
  return res.status === 200;
};

/** Invites `email` as a member of the project party and accepts the invitation. */
const ensureGuest = async ({ projectId, partyId, email, name, log = () => {} }) => {
  if (await canSignIn(email)) return { email, created: false };
  const pm = api.as(PM);
  const invited = await pm.send('POST', '/users/invitations', { email, role: 'site_engineer', projectId, projectPartyId: partyId, note: 'party-visibility certification leads' });
  if (invited.status !== 201) throw new Error(`invitation of ${email} refused: ${invited.status} ${invited.text?.slice(0, 300)}`);
  let token = null;
  for (let i = 0; i < 20 && !token; i += 1) {
    await sleep(250);
    token = invitationTokenFromLog(email);
  }
  if (!token) throw new Error(`no invitation mail for ${email} in ${API_LOG}`);
  const accepted = await api.raw('POST', '/auth/invitations/accept', { json: { token, name, password: password() } });
  if (accepted.status !== 200 && accepted.status !== 201) throw new Error(`acceptance by ${email} refused: ${accepted.status} ${accepted.text?.slice(0, 300)}`);
  log(`  (set-up) invited and accepted ${email} into party ${partyId}`);
  return { email, created: true };
};

/** The second subcontractor party of the project, created when missing. */
const ensureSubYParty = async ({ projectId, log = () => {} }) => {
  const pm = api.as(PM);
  const listed = await pm.GET(`/projects/${projectId}/parties?status=all`);
  const items = Array.isArray(listed) ? listed : listed.items || listed.parties || [];
  const found = items.find((p) => (p.company?.name || p.companyName || p.name) === SUB_Y_COMPANY);
  if (found) {
    if (found.status && found.status !== 'active') await pm.PATCH(`/projects/${projectId}/parties/${found.id}`, { status: 'active' });
    return found;
  }
  const created = await pm.POST(`/projects/${projectId}/parties`, { role: 'subcontractor', companyName: SUB_Y_COMPANY });
  log(`  (set-up) created party ${created.id} for ${SUB_Y_COMPANY}`);
  return created;
};

/**
 * Returns { projectId, parties, pm, subX, subY, consultant } — three signed-in
 * guests of three different external companies on project 072-01.
 */
const setup = async ({ log = console.log, need = ['subX', 'subY', 'consultant'] } = {}) => {
  const p = project();
  const projectId = p.id;
  const parties = { ...p.refs.parties };
  const out = { code: CODE, projectId, parties, pm: api.as(PM), pmEmail: PM, inventory: p, company: inventory().company };
  if (need.includes('subY')) {
    const partyY = await ensureSubYParty({ projectId, log });
    parties.subcontractorY = partyY.id;
    out.subYCompanyId = partyY.companyId || partyY.company?.id || null;
  }
  const partyOf = { subX: parties.subcontractor, subY: parties.subcontractorY, consultant: parties.consultant };
  for (const key of need) {
    const guest = GUESTS[key];
    await ensureGuest({ projectId, partyId: partyOf[key], email: guest.email, name: guest.name, log });
    out[key] = api.as(guest.email);
  }
  return out;
};

// ── printing ────────────────────────────────────────────────────────────────

const short = (value, max = 700) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return 'undefined';
  return text.length > max ? `${text.slice(0, max)}… (${text.length} chars)` : text;
};

/** Sends a request and prints it with its answer. */
const show = async (who, label, method, route, json, { max = 700, pick = null } = {}) => {
  const res = await who.send(method, route, json);
  console.log(`\n> [${label}] ${method} /api/v1${route}${json !== undefined ? `\n  body: ${short(json, 400)}` : ''}`);
  const shown = pick && res.body ? pick(res.body) : res.body ?? res.text;
  console.log(`< ${res.status} ${short(shown, max)}`);
  return res;
};

const verdict = (lead, word, sentence) => {
  console.log(`\nVERDICT ${lead}: ${word} — ${sentence}`);
  process.exitCode = word === 'CONFIRMED' || word === 'PARTLY_CONFIRMED' ? 2 : 0;
};

const main = (fn) =>
  fn().catch((error) => {
    console.error(`\nSCRIPT ERROR: ${error.stack || error.message}`);
    process.exitCode = 1;
  });

module.exports = { CODE, GUESTS, PM, SUB_Y_COMPANY, api, ensureGuest, inventory, main, project, setup, short, show, verdict };
