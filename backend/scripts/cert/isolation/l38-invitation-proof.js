'use strict';

/**
 * L38 (owner decision 2026-10-05): an e-mail that already belongs to an
 * identity joins a company only by an invitation the identity accepts with a
 * session of its own, and nothing about the identity is disclosed before.
 *
 *   $env:DATABASE_URL = $null; $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/l38-invitation-proof.js [A=024] [B=025] [C=026]
 *
 * A invites; B is the home company of the existing identities; C is a second
 * company of one of them. Throwaway people, a fresh stamp each run:
 *   S  an identity of B only            M  an identity of B and C
 *   F  an identity of B with MFA on     X  an identity B has closed
 *   N  an e-mail with no identity
 * The owner's cases A-M, through POST /users and POST /users/invitations:
 * the answers for an existing and a missing e-mail have the same shape and
 * carry nothing of the identity; before acceptance there is no membership, no
 * listing, no workspace, no project access, no team place, no mention and no
 * notification; a pending invitation is replaced, not duplicated, and the old
 * link is dead; an expired or revoked link, the link alone, another person's
 * session, a wrong password, a password without the second factor and a
 * closed identity are refused with nothing written; acceptance with the
 * identity's own session creates exactly the offered membership and role; the
 * identity's credentials, MFA, home company and other memberships are
 * unchanged, and no other company's data changes.
 * And the independent review's cases: a former member (T) who left, or a row
 * an earlier version left `invited`, is not listed, activated or assigned, and
 * a former administrator invited as a site engineer returns as exactly that;
 * another identity's session with the right password, the password alone and
 * a session bound to another company's single sign-on are refused (U); two
 * invitations at once leave one pending and three acceptances at once let one
 * through; a party invitation whose party moved company is refused (V); the
 * project history does not say whether the e-mail had an account; a closed
 * account its own company reopens gets no session from the link (H); a custom
 * field of type person or company takes this company's only, and a report
 * never prints another company's person or company by name.
 *
 * Exit 0 when every check holds, 2 otherwise.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const crypto = require('crypto');
const fs = require('fs');
const api = require('../lib/api');
const invitations = require('../lib/invitations');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');
const { totp } = require('../../../src/utils/totp');

invitations.captureMail({ quiet: true });

const A_CODE = process.argv[2] || '024';
const B_CODE = process.argv[3] || '025';
const C_CODE = process.argv[4] || '026';
const STATE_DIR = process.env.CERT_STATE_DIR || 'C:/Temp/octapm-cert/state';
const STAMP = crypto.randomBytes(3).toString('hex');
const PASSWORD = process.env.CERT_PASSWORD;
const results = [];
const answers = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const said = (res) => (res ? `${res.status} ${res.body?.error?.code || ''}`.trim() : 'no answer');
const keep = (label, res) => {
  if (res) answers.push({ label, status: res.status, text: res.text || '' });
  return res;
};

const main = async () => {
  if (!PASSWORD) throw new Error('CERT_PASSWORD is not set');
  const { companies } = buildPopulation();
  const [A, B, C] = [A_CODE, B_CODE, C_CODE].map((code) => companies.find((c) => c.code === code));
  const db = await guard.connectCert();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const orgOf = async (code) => (await q('select id, name from "Organisation" where slug like $1', [`cert-${code}-%`]))[0];
  const [orgA, orgB, orgC] = [await orgOf(A_CODE), await orgOf(B_CODE), await orgOf(C_CODE)];
  const aPm = api.as(`pm@${A.domain}`);
  const bPm = api.as(`pm@${B.domain}`);
  const cPm = api.as(`pm@${C.domain}`);
  const aPmId = (await q('select id from "User" where email = $1', [`pm@${A.domain}`]))[0]?.id;
  const projectA = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'inventory', `${A.code}.json`), 'utf8')).projects[`${A.code}-01`].id;
  console.log(`l38 invitation proof: A ${A_CODE} invites, B ${B_CODE} home, C ${C_CODE} second company; stamp ${STAMP}${process.env.CERT_INPROCESS === '1' ? ', in process' : ''}\n`);

  // ── set-up: the existing identities, made through the API ──────────────────
  const person = (label) => ({ label, email: `l38.${label}.${STAMP}@${B.domain}`, name: `L38 ${label} ${STAMP}`, phone: `+1-555-${crypto.randomInt(1000, 9999)}` });
  const S = person('single');
  const M = person('multi');
  const F = person('mfa');
  const X = person('closed');
  const T = person('former');
  const U = person('proof');
  const V = person('party');
  const W = person('guest');
  const N = { email: `l38.new.${STAMP}@${A.domain}`, name: `L38 new ${STAMP}` };
  for (const p of [S, M, F, X, T, U, V, W]) {
    const made = keep(`setup ${p.label}`, await bPm.send('POST', '/users', { name: p.name, email: p.email, phone: p.phone, password: PASSWORD, role: 'qs' }));
    p.id = made.body?.data?.id;
  }
  await api.signIn(S.email); // a real lastLogin worth hiding
  const intoC = await invitations.joinByInvitation({ inviter: cPm, email: M.email, role: 'planning_eng', name: M.name });
  const fToken = await api.tokenFor(F.email);
  const setup = await api.raw('POST', '/auth/mfa/setup', { token: fToken, json: {} });
  const enabled = await api.raw('POST', '/auth/mfa/enable', { token: fToken, json: { code: totp(setup.body?.data?.secret || '') } });
  F.backupCodes = enabled.body?.data?.backupCodes || [];
  api.forget(F.email);
  const closed = keep('setup close X', await bPm.send('PATCH', `/users/${X.id}/deactivate`, {}));
  const xRow = (await q('select status from "User" where id = $1', [X.id]))[0];
  const mMemberships = await q('select "orgId" from "OrganizationMembership" where "userId" = $1 and status = \'active\'', [M.id]);
  check('setup: S, M, F, X, T, U and V exist in B; M is also a member of C; F has MFA on; X is closed',
    [S, M, F, X, T, U, V].every((p) => p.id) && said(intoC.accepted) === '200' && mMemberships.length === 2 && F.backupCodes.length > 0 && closed.status === 200 && xRow?.status === 'inactive',
    `ids ${[S, M, F, X].map((p) => Boolean(p.id)).join(',')}; M into C ${said(intoC.invited)} -> ${said(intoC.accepted)}; M active memberships ${mMemberships.length}; F mfa ${said(enabled)}; X ${said(closed)} ${xRow?.status}`);
  if (!results.every((r) => r.ok)) throw new Error('setup incomplete');

  // What must not change: the identities' own rows and their memberships elsewhere, and every other company's data.
  // (Not compared: lastLogin and the backup codes, which F's own sign-in below stamps and spends.)
  const everyone = [S, M, F, X, T, U, V].map((p) => p.id);
  const identityRows = async () => JSON.stringify(await q(`select id, "orgId", name, phone, email, role, status, "passwordHash", "mfaEnabled", "mfaSecretEnc", "ssoSubject", "ssoProvider", "isCompanyAdmin" from "User" where id = any($1::text[]) order by id`, [everyone]));
  const elsewhere = async () => JSON.stringify(await q(`select "userId", "orgId", role, status, kind, "isAdmin", "isOwner", "invitationId" from "OrganizationMembership" where "userId" = any($1::text[]) and "orgId" <> $2 order by "userId", "orgId"`, [everyone, orgA.id]));
  const identitiesBefore = await identityRows();
  const elsewhereBefore = await elsewhere();
  const printBefore = await fingerprint.take(db);

  const pending = async (email) => q(`select id, role, status, "invitedById" from "InvitationToken" where "orgId" = $1 and email = $2 and status = 'pending' and "acceptedAt" is null and "revokedAt" is null`, [orgA.id, email]);
  const membershipInA = async (userId) => (await q(`select role, status, kind, "isAdmin", "isOwner" from "OrganizationMembership" where "orgId" = $1 and "userId" = $2`, [orgA.id, userId]))[0] || null;
  const foreignWords = (p) => [p.name, p.phone, p.id, orgB.id, orgB.name, orgC.id, orgC.name].filter(Boolean);
  const carries = (res, words) => words.filter((w) => (res?.text || '').includes(w));

  // ── A, B, C, I, J: the answers ─────────────────────────────────────────────
  console.log('\n── the invitation answers ──');
  const invNew = keep('invite N', await aPm.send('POST', '/users/invitations', { email: N.email, role: 'qs' }));
  const tokenN = await invitations.latestInvitationToken(N.email);
  const invS = keep('invite S', await aPm.send('POST', '/users/invitations', { email: S.email, role: 'qs' }));
  const tokenS1 = await invitations.latestInvitationToken(S.email);
  const invM = keep('invite M', await aPm.send('POST', '/users/invitations', { email: M.email, role: 'qs' }));
  const invX = keep('invite X', await aPm.send('POST', '/users/invitations', { email: X.email, role: 'qs' }));
  const shape = (res) => Object.keys(res.body?.data || {}).sort().join(',');
  const kinds = (res) => Object.entries(res.body?.data || {}).filter(([k]) => !['id', 'email', 'createdAt', 'expiresAt'].includes(k)).map(([k, v]) => `${k}=${v === null ? 'null' : typeof v === 'string' && k !== 'role' && k !== 'status' ? typeof v : v}`).sort().join(',');
  check('A/B/C: POST /users/invitations answers 201 alike for a new e-mail, an identity of one company, of two companies, and a closed one',
    [invNew, invS, invM, invX].every((r) => r.status === 201) && new Set([invNew, invS, invM, invX].map(shape)).size === 1 && new Set([invNew, invS, invM, invX].map(kinds)).size === 1,
    [invNew, invS, invM, invX].map((r) => `${said(r)} {${shape(r)}} ${kinds(r)}`).join(' | '));
  for (const [label, res, p] of [['S', invS, S], ['M', invM, M], ['X', invX, X]]) {
    check(`I/J: the invitation answer for ${label} carries nothing of the identity or its companies`, carries(res, foreignWords(p)).length === 0 && !/existing|lastLogin|homeOrg|memberships/i.test(res.text || ''), carries(res, foreignWords(p)).join(', ') || 'clean');
  }
  check('A: inviting a new e-mail makes no account before acceptance', (await q('select count(*)::int as n from "User" where email = $1', [N.email]))[0].n === 0);

  // POST /users with an e-mail that already names an identity: an invitation, not a membership.
  const directS = keep('POST /users S', await aPm.send('POST', '/users', { name: 'Not their name', email: S.email, password: PASSWORD, role: 'site_engineer' }));
  const tokenS2 = await invitations.latestInvitationToken(S.email);
  const directX = keep('POST /users X', await aPm.send('POST', '/users', { name: 'Not their name', email: X.email, role: 'site_engineer' }));
  check('B: POST /users with an existing identity\'s e-mail answers 202 with an invitation (invited: true), no account fields',
    directS.status === 202 && directS.body?.data?.invited === true && directS.body?.data?.id !== S.id && !('existingIdentity' in (directS.body?.data || {})) && !('lastLogin' in (directS.body?.data || {})) && !('phone' in (directS.body?.data || {})),
    `${said(directS)} ${shape(directS)}`);
  check('B/J: …carrying nothing of the identity (its name, phone, id, home company)', carries(directS, foreignWords(S)).length === 0, carries(directS, foreignWords(S)).join(', ') || 'clean');
  check('B: a closed identity elsewhere is answered the same way (no USER_INACTIVE: its standing is not disclosed)', directX.status === 202 && shape(directX) === shape(directS) && carries(directX, foreignWords(X)).length === 0, `${said(directX)} ${shape(directX)}`);
  const sameDirect = keep('POST /users N2', await aPm.send('POST', '/users', { name: `L38 new2 ${STAMP}`, email: `l38.new2.${STAMP}@${A.domain}`, password: PASSWORD, role: 'qs' }));
  check('A: POST /users with a new e-mail still creates the account (201)', sameDirect.status === 201 && sameDirect.body?.data?.email === `l38.new2.${STAMP}@${A.domain}`, said(sameDirect));

  // ── D, E: pending and existing members ─────────────────────────────────────
  console.log('\n── pending and existing members ──');
  const pendingS = await pending(S.email);
  check('D: a second invitation to the same e-mail replaces the first: one pending invitation, the latest role', pendingS.length === 1 && pendingS[0].role === 'site_engineer' && pendingS[0].invitedById === aPmId, JSON.stringify(pendingS));
  const revokedAudit = await q(`select count(*)::int as n from "AuthAuditEvent" where "orgId" = $1 and action = 'invitation_revoked' and email = $2`, [orgA.id, S.email]);
  check('D/audit: the replaced invitation is audited as revoked', revokedAudit[0].n >= 1, `${revokedAudit[0].n} row(s)`);
  const member = `site@${A.domain}`;
  const invitesBefore = (await q('select count(*)::int as n from "InvitationToken" where "orgId" = $1 and email = $2', [orgA.id, member]))[0].n;
  const eInvite = keep('invite member', await aPm.send('POST', '/users/invitations', { email: member, role: 'qs' }));
  const eDirect = keep('POST /users member', await aPm.send('POST', '/users', { name: 'x', email: member, role: 'qs' }));
  const invitesAfter = (await q('select count(*)::int as n from "InvitationToken" where "orgId" = $1 and email = $2', [orgA.id, member]))[0].n;
  check('E: an existing member is refused (409 ALREADY_MEMBER / 409 EMAIL_EXISTS) and nothing is written', said(eInvite) === '409 ALREADY_MEMBER' && said(eDirect) === '409 EMAIL_EXISTS' && invitesAfter === invitesBefore, `${said(eInvite)} | ${said(eDirect)}; invitations ${invitesBefore} -> ${invitesAfter}`);

  // ── K: nothing before acceptance ───────────────────────────────────────────
  console.log('\n── before acceptance ──');
  for (const p of [S, M, X]) {
    const listed = await aPm.send('GET', `/users?search=${encodeURIComponent(p.email)}`);
    const rows = (listed.body?.data?.items || []).filter((u) => u.email === p.email);
    check(`K: ${p.label} has no membership in A and is not in A's people list`, !(await membershipInA(p.id)) && listed.status === 200 && rows.length === 0, `membership ${JSON.stringify(await membershipInA(p.id))}; listed ${rows.length}`);
  }
  const sSignIn = keep('S login', await api.raw('POST', '/auth/login', { json: { email: S.email, password: PASSWORD } }));
  const sToken = sSignIn.body?.data?.tokens?.accessToken || sSignIn.body?.data?.identityToken;
  const sWorkspaces = (sSignIn.body?.data?.memberships || []).map((m) => m.orgId);
  const sEnterA = keep('S enter A', await api.raw('POST', `/auth/workspaces/${orgA.id}/session`, { token: sToken, json: {} }));
  check('K: S cannot enter A (404 WORKSPACE_NOT_FOUND) and A is not among its workspaces', said(sEnterA) === '404 WORKSPACE_NOT_FOUND' && !sWorkspaces.includes(orgA.id), `${said(sEnterA)}; workspaces ${JSON.stringify(sWorkspaces)}`);
  const sReadsA = keep('S reads A project', await api.raw('GET', `/projects/${projectA}`, { token: sToken }));
  check('K: S\'s own session cannot read A\'s project', sReadsA.status === 404 || sReadsA.status === 403, said(sReadsA));
  const team = keep('team add S', await aPm.send('POST', `/projects/${projectA}/team`, { userId: S.id }));
  const task = await aPm.send('POST', `/projects/${projectA}/tasks`, { title: `L38 ${STAMP}` });
  const mention = keep('mention S', await aPm.send('POST', `/projects/${projectA}/comments`, { recordType: 'task', recordId: task.body?.data?.id, body: `L38 ${STAMP}`, mentionUserIds: [S.id] }));
  const notes = (await q(`select count(*)::int as n from "Notification" where "recipientUserId" = any($1::text[]) and "orgId" = $2`, [[S.id, M.id, F.id, X.id], orgA.id]))[0].n;
  const assigned = (await q(`select count(*)::int as n from "ProjectAssignment" where "userId" = any($1::text[]) and "projectId" in (select id from "Project" where "orgId" = $2)`, [[S.id, M.id, F.id, X.id], orgA.id]))[0].n;
  check('K: A cannot put S on a project team or mention S; no assignment and no notification in A for any invitee',
    said(team) === '404 USER_NOT_IN_ORGANISATION' && said(mention) === '400 COMMENT_MENTION_INVALID' && notes === 0 && assigned === 0,
    `team ${said(team)}; mention ${said(mention)}; notifications ${notes}; assignments ${assigned}`);

  // ── F, H: refused acceptances write nothing ────────────────────────────────
  console.log('\n── refused acceptances ──');
  const accept = (token, { bearer = null, password = null, name = 'Invitee' } = {}) => api.raw('POST', '/auth/invitations/accept', { json: { token, name, ...(password ? { password } : {}) }, token: bearer });
  const old = keep('old link', await accept(tokenS1, { bearer: sToken }));
  check('D/F: the replaced (revoked) link is refused even with S\'s own session, nothing written', old.status >= 400 && old.status < 500 && !(await membershipInA(S.id)), said(old));
  const alone = keep('link alone', await accept(tokenS2));
  const mToken = await api.tokenFor(M.email, orgB.id);
  const other = keep('M accepts S', await accept(tokenS2, { bearer: mToken }));
  const wrong = keep('wrong password', await accept(tokenS2, { password: 'Wrong-Passw0rd-1' }));
  check('H: the link alone, another identity\'s session and a wrong password are refused 401 INVITATION_SIGN_IN_REQUIRED, nothing written',
    [alone, other, wrong].every((r) => said(r) === '401 INVITATION_SIGN_IN_REQUIRED') && !(await membershipInA(S.id)) && !(await membershipInA(M.id)) && (await pending(S.email)).length === 1,
    `${said(alone)} | ${said(other)} | ${said(wrong)}`);
  // Expired: M's invitation, made to expire.
  const tokenM = await invitations.latestInvitationToken(M.email);
  await db.query(`update "InvitationToken" set "expiresAt" = now() - interval '1 minute' where "orgId" = $1 and email = $2 and status = 'pending'`, [orgA.id, M.email]);
  const expired = keep('expired', await accept(tokenM, { bearer: mToken }));
  check('F: an expired link is refused with M\'s own session, nothing written', expired.status >= 400 && expired.status < 500 && !(await membershipInA(M.id)), said(expired));
  // MFA: the password alone is not the identity's authentication.
  const invF = keep('invite F', await aPm.send('POST', '/users/invitations', { email: F.email, role: 'qs' }));
  const tokenF = await invitations.latestInvitationToken(F.email);
  const fPassword = keep('F password only', await accept(tokenF, { password: PASSWORD }));
  check('H: an identity with MFA cannot accept with its password alone (401 INVITATION_SIGN_IN_REQUIRED), nothing written', invF.status === 201 && said(fPassword) === '401 INVITATION_SIGN_IN_REQUIRED' && !(await membershipInA(F.id)), `${said(invF)}; ${said(fPassword)}`);
  // Closed identity.
  const tokenX = await invitations.latestInvitationToken(X.email);
  const xAccept = keep('X accepts', await accept(tokenX, { password: PASSWORD }));
  check('H: a closed identity cannot accept (403 USER_INACTIVE), nothing written', said(xAccept) === '403 USER_INACTIVE' && !(await membershipInA(X.id)), said(xAccept));

  // ── G, L: acceptance with the identity's own session ───────────────────────
  console.log('\n── acceptance ──');
  const sAccepted = keep('S accepts', await accept(tokenS2, { bearer: sToken }));
  const sInA = await membershipInA(S.id);
  check('G/L: S accepts with its own session: one active membership in A with exactly the offered role (site_engineer), member, no admin or ownership',
    sAccepted.status === 200 && sInA?.status === 'active' && sInA.role === 'site_engineer' && sInA.kind === 'member' && !sInA.isAdmin && !sInA.isOwner,
    `${said(sAccepted)}; ${JSON.stringify(sInA)}`);
  const acceptedRow = (await q(`select status, "acceptedById" from "InvitationToken" where "orgId" = $1 and email = $2 order by "createdAt" desc limit 1`, [orgA.id, S.email]))[0];
  check('G: the invitation is marked accepted by S', acceptedRow?.status === 'accepted' && acceptedRow.acceptedById === S.id, JSON.stringify(acceptedRow));
  const reused = keep('reuse', await accept(tokenS2, { bearer: sToken }));
  check('F: the accepted link cannot be used again', reused.status >= 400 && reused.status < 500, said(reused));
  // F with a full sign-in (password + a backup code).
  const fLogin = await api.raw('POST', '/auth/login', { json: { email: F.email, password: PASSWORD } });
  const fVerified = await api.raw('POST', '/auth/mfa/verify', { json: { mfaToken: fLogin.body?.data?.mfaToken, code: F.backupCodes[0] } });
  const fSession = fVerified.body?.data?.tokens?.accessToken || fVerified.body?.data?.identityToken;
  const fAccepted = keep('F accepts', await accept(tokenF, { bearer: fSession }));
  check('G: F accepts after a full sign-in with its second factor', fLogin.body?.data?.mfaRequired === true && Boolean(fSession) && fAccepted.status === 200 && (await membershipInA(F.id))?.role === 'qs', `${said(fLogin)} mfa ${fLogin.body?.data?.mfaRequired}; ${said(fVerified)}; ${said(fAccepted)}`);
  // A brand-new e-mail needs no session: it sets its password.
  const nAccepted = keep('N accepts', await accept(tokenN, { password: PASSWORD, name: N.name }));
  const nRow = (await q('select u."orgId", m.role, m.status from "User" u join "OrganizationMembership" m on m."userId" = u.id and m."orgId" = $2 where u.email = $1', [N.email, orgA.id]))[0];
  check('A: the new e-mail accepts with a password of its own and becomes a member of A with the offered role', nAccepted.status === 200 && nRow?.orgId === orgA.id && nRow.role === 'qs' && nRow.status === 'active', `${said(nAccepted)}; ${JSON.stringify(nRow)}`);
  // After acceptance S works in A with A's role only.
  api.forget(S.email);
  const sInto = await api.signIn(S.email, orgA.id);
  const listedS = (await aPm.send('GET', `/users?search=${encodeURIComponent(S.email)}`)).body?.data?.items?.find((u) => u.email === S.email);
  check('L/I: S enters A as a site engineer; A\'s list shows S with A\'s role, not B\'s', sInto.orgId === orgA.id && listedS?.role === 'site_engineer' && !('orgId' in (listedS || {})), `entered ${sInto.orgId === orgA.id}; listed ${JSON.stringify(listedS && { role: listedS.role, status: listedS.status })}`);

  // ── the independent review's cases (Codex, 2026-10-05) ──────────────────────
  console.log('\n── former members, races, foreign sessions, changed offers, a reopened account ──');
  // T: a member of A who was an administrator there and left. Leaving has no
  // route of its own, so the standing is written as the fixture.
  const tJoined = await invitations.joinByInvitation({ inviter: aPm, email: T.email, role: 'qs', name: T.name });
  await db.query(`update "OrganizationMembership" set "isAdmin" = true, status = 'left', "leftAt" = now() where "orgId" = $1 and "userId" = $2`, [orgA.id, T.id]);
  const tActivate = keep('activate T (left)', await aPm.send('PATCH', `/users/${T.id}/activate`, {}));
  check('M1: a former member who left cannot be activated by A (nothing changes)', said(tJoined.accepted) === '200' && tActivate.status >= 400 && tActivate.status < 500 && (await membershipInA(T.id))?.status === 'left', `join ${said(tJoined.accepted)}; activate ${said(tActivate)}; ${JSON.stringify(await membershipInA(T.id))}`);
  const tInvite = keep('re-invite T', await aPm.send('POST', '/users', { name: 'x', email: T.email, role: 'site_engineer' }));
  const tToken = await invitations.latestInvitationToken(T.email, { after: invitations.mailsTo(T.email).length - 1 });
  check('M1/M2: re-inviting the former member leaves the membership as it was (no "invited" row that lists or activates them)', tInvite.status === 202 && (await membershipInA(T.id))?.status === 'left', `${said(tInvite)}; ${JSON.stringify(await membershipInA(T.id))}`);
  // A row left "invited" by the code before this fix: not part of A either.
  await db.query(`update "OrganizationMembership" set status = 'invited' where "orgId" = $1 and "userId" = $2`, [orgA.id, T.id]);
  const tListed = ((await aPm.send('GET', `/users?search=${encodeURIComponent(T.email)}`)).body?.data?.items || []).filter((u) => u.email === T.email);
  const tActivate2 = keep('activate T (invited)', await aPm.send('PATCH', `/users/${T.id}/activate`, {}));
  const tTeam = keep('team add T (invited)', await aPm.send('POST', `/projects/${projectA}/team`, { userId: T.id }));
  check('M1/M2/M5: an "invited" row is not membership: not listed, not activatable, not addable to a team, and the refusal does not name the person',
    tListed.length === 0 && tActivate2.status >= 400 && tActivate2.status < 500 && said(tTeam) === '404 USER_NOT_IN_ORGANISATION' && !(tTeam.text || '').includes(T.name) && (await membershipInA(T.id))?.status === 'invited',
    `listed ${tListed.length}; activate ${said(tActivate2)}; team ${said(tTeam)}`);
  const tAccepted = keep('T accepts', await accept(tToken, { bearer: await api.tokenFor(T.email, orgB.id) }));
  const tNow = await membershipInA(T.id);
  check('A6/L: the former administrator accepts a site-engineer invitation and comes back as exactly that: no administration, no ownership',
    tAccepted.status === 200 && tNow?.status === 'active' && tNow.role === 'site_engineer' && tNow.kind === 'member' && tNow.isAdmin === false && tNow.isOwner === false,
    `${said(tAccepted)}; ${JSON.stringify(tNow)}`);

  // U: proofs that are not U's own session.
  const uInvite = keep('invite U', await aPm.send('POST', '/users/invitations', { email: U.email, role: 'qs' }));
  const tokenU = await invitations.latestInvitationToken(U.email);
  const mixed = keep('M bearer + U password', await accept(tokenU, { bearer: mToken, password: PASSWORD }));
  const uPasswordOnly = keep('U password only', await accept(tokenU, { password: PASSWORD }));
  const { createAccessToken } = require('../../../src/utils/tokens');
  const ssoBound = createAccessToken({ id: U.id, orgId: orgB.id, role: 'qs', email: U.email, name: U.name, ssoOrgId: orgB.id });
  const viaSso = keep('U SSO-bound to B', await accept(tokenU, { bearer: ssoBound }));
  check('A1/A2/H: another identity\'s session with the right password, the password alone, and U\'s own session bound to B\'s single sign-on are all refused; nothing written',
    uInvite.status === 201 && said(mixed) === '401 INVITATION_SIGN_IN_REQUIRED' && said(uPasswordOnly) === '401 INVITATION_SIGN_IN_REQUIRED' && said(viaSso) === '403 SSO_SESSION_BOUND' && !(await membershipInA(U.id)) && (await pending(U.email)).length === 1,
    `${said(mixed)} | ${said(uPasswordOnly)} | ${said(viaSso)}`);
  // Two invitations at once leave one pending; three acceptances at once of the two links let exactly one through.
  const before = invitations.mailsTo(U.email).length;
  const [inv1, inv2] = await Promise.all([aPm.send('POST', '/users/invitations', { email: U.email, role: 'qs' }), aPm.send('POST', '/users/invitations', { email: U.email, role: 'qs' })]);
  const uMails = invitations.mailsTo(U.email).slice(before).map(invitations.tokenIn);
  check('A5: two invitations at once leave exactly one pending', inv1.status === 201 && inv2.status === 201 && (await pending(U.email)).length === 1 && uMails.length === 2, `${said(inv1)} ${said(inv2)}; pending ${(await pending(U.email)).length}`);
  const uBearer = await api.tokenFor(U.email, orgB.id);
  const races = await Promise.all([accept(uMails[0], { bearer: uBearer }), accept(uMails[1], { bearer: uBearer }), accept(uMails[1], { bearer: uBearer })]);
  races.forEach((r, i) => keep(`race ${i}`, r));
  const uRows = await q(`select count(*)::int as n from "OrganizationMembership" where "orgId" = $1 and "userId" = $2`, [orgA.id, U.id]);
  const uAccepted = await q(`select count(*)::int as n from "InvitationToken" where "orgId" = $1 and email = $2 and status = 'accepted'`, [orgA.id, U.email]);
  check('A5: of three simultaneous acceptances exactly one succeeds; one membership, one accepted invitation',
    races.filter((r) => r.status === 200).length === 1 && races.filter((r) => r.status !== 200).every((r) => r.status >= 400 && r.status < 500) && uRows[0].n === 1 && uAccepted[0].n === 1,
    `${races.map(said).join(' | ')}; memberships ${uRows[0].n}; accepted ${uAccepted[0].n}`);

  // V: a party invitation whose party moves to another company before acceptance.
  const party = keep('create party', await aPm.send('POST', `/projects/${projectA}/parties`, { role: 'subcontractor', companyName: `L38 Party ${STAMP}` }));
  const partyId = party.body?.data?.id;
  const vInvite = keep('invite V to party', await aPm.send('POST', '/users/invitations', { email: V.email, role: 'site_engineer', projectId: projectA, projectPartyId: partyId }));
  const tokenV = await invitations.latestInvitationToken(V.email);
  const projectAudit = await q(`select to_jsonb(a)::text as row from "AuditEvent" a where "orgId" = $1 and "entityType" = 'user_invitation' and "entityId" = $2`, [orgA.id, vInvite.body?.data?.id]);
  check('M7: the project\'s history records the invitation without saying whether the e-mail has an account', vInvite.status === 201 && projectAudit.length === 1 && !projectAudit[0].row.includes('existingUser'), `${said(vInvite)}; ${projectAudit.length} row(s)`);
  const companyBefore = (await q('select "companyId" from "ProjectParty" where id = $1', [partyId]))[0]?.companyId;
  const moved = keep('move party', await aPm.send('PATCH', `/projects/${projectA}/parties/${partyId}`, { companyName: `L38 Other ${STAMP}` }));
  const companyAfter = (await q('select "companyId" from "ProjectParty" where id = $1', [partyId]))[0]?.companyId;
  const vAccepted = keep('V accepts moved party', await accept(tokenV, { bearer: await api.tokenFor(V.email, orgB.id) }));
  const vCompany = await q(`select count(*)::int as n from "CompanyMembership" where "userId" = $1 and "orgId" = $2`, [V.id, orgA.id]);
  check('A7: an invitation to a party that has since moved to another company is refused (409 INVITATION_OFFER_CHANGED); nothing written',
    party.status === 201 && moved.status === 200 && companyBefore !== companyAfter && said(vAccepted) === '409 INVITATION_OFFER_CHANGED' && !(await membershipInA(V.id)) && vCompany[0].n === 0 && (await pending(V.email)).length === 1,
    `party ${said(party)}; move ${said(moved)} ${companyBefore !== companyAfter}; ${said(vAccepted)}; company memberships ${vCompany[0].n}`);

  // H: an account of A's own that A closed, reopened by A's invitation: a new password, and no session from the link.
  const H = { email: `l38.home.${STAMP}@${A.domain}`, name: `L38 home ${STAMP}` };
  const hMade = keep('create H', await aPm.send('POST', '/users', { name: H.name, email: H.email, password: PASSWORD, role: 'qs' }));
  H.id = hMade.body?.data?.id;
  keep('close H', await aPm.send('PATCH', `/users/${H.id}/deactivate`, {}));
  keep('invite H', await aPm.send('POST', '/users/invitations', { email: H.email, role: 'qs' }));
  const tokenH = await invitations.latestInvitationToken(H.email);
  const newPassword = `${PASSWORD}x9`;
  const hAccepted = keep('H accepts', await accept(tokenH, { password: newPassword, name: H.name }));
  const hSignIn = await api.raw('POST', '/auth/login', { json: { email: H.email, password: newPassword } });
  check('A4: a closed account reopened by its own company sets its new password but gets no session from the link; it then signs in',
    hAccepted.status === 200 && hAccepted.body?.data?.signInRequired === true && !hAccepted.body?.data?.tokens && hSignIn.status === 200,
    `${said(hAccepted)} signInRequired=${hAccepted.body?.data?.signInRequired}; login ${said(hSignIn)}`);

  // ── the verification's cases (Codex, 2026-10-05) ───────────────────────────
  console.log('\n── a home identity whose membership ended or is only an invitation; malformed names; single sign-on ──');
  // H2: homed in A, its membership in A has ended (and then is only an invitation): the
  // home column does not make it part of A.
  const H2 = { email: `l38.homeleft.${STAMP}@${A.domain}`, name: `L38 home left ${STAMP}` };
  H2.id = keep('create H2', await aPm.send('POST', '/users', { name: H2.name, email: H2.email, password: PASSWORD, role: 'qs' })).body?.data?.id;
  for (const standing of ['left', 'invited']) {
    await db.query(`update "OrganizationMembership" set status = $3 where "orgId" = $1 and "userId" = $2`, [orgA.id, H2.id, standing]);
    const listedH2 = ((await aPm.send('GET', `/users?search=${encodeURIComponent(H2.email)}`)).body?.data?.items || []).filter((u) => u.email === H2.email);
    const activateH2 = keep(`activate H2 ${standing}`, await aPm.send('PATCH', `/users/${H2.id}/activate`, {}));
    const teamH2 = keep(`team H2 ${standing}`, await aPm.send('POST', `/projects/${projectA}/team`, { userId: H2.id }));
    const partyH2 = keep(`party H2 ${standing}`, await aPm.send('POST', `/projects/${projectA}/parties/${partyId}/members`, { userId: H2.id }));
    const partyRows = await q(`select count(*)::int as n from "ProjectPartyMember" where "userId" = $1`, [H2.id]);
    check(`M1-M5 (home): an identity homed in A whose membership is ${standing} is not listed, activated, put on a team or added to a party (and is not named)`,
      H2.id && listedH2.length === 0 && activateH2.status >= 400 && activateH2.status < 500 && said(teamH2) === '404 USER_NOT_IN_ORGANISATION' && !(teamH2.text || '').includes(H2.name) && partyH2.status >= 400 && partyH2.status < 500 && partyRows[0].n === 0 && (await membershipInA(H2.id))?.status === standing,
      `listed ${listedH2.length}; activate ${said(activateH2)}; team ${said(teamH2)}; party ${said(partyH2)} (${partyRows[0].n} rows); now ${(await membershipInA(H2.id))?.status}`);
  }
  // Malformed names are refused 400, never a 500.
  const N3 = `l38.new3.${STAMP}@${A.domain}`;
  keep('invite N3', await aPm.send('POST', '/users/invitations', { email: N3, role: 'qs' }));
  const tokenN3 = await invitations.latestInvitationToken(N3);
  const badNames = [];
  for (const name of [false, 0, 7, { first: 'x' }, ['x']]) badNames.push(keep(`N3 name ${JSON.stringify(name)}`, await api.raw('POST', '/auth/invitations/accept', { json: { token: tokenN3, name, password: PASSWORD } })));
  check('a malformed name (false, 0, a number, an object, an array) is refused 400 and writes nothing — never a 500',
    badNames.every((r) => r.status === 400) && (await q('select count(*)::int as n from "User" where email = $1', [N3]))[0].n === 0, badNames.map(said).join(' | '));
  // Single sign-on: A requires it for B's e-mail domain while these run.
  const policyBefore = (await q('select "ssoEnabled", "ssoRequired", "ssoDomainsJson" from "Organisation" where id = $1', [orgA.id]))[0];
  try {
    await db.query(`update "Organisation" set "ssoEnabled" = true, "ssoRequired" = true, "ssoDomainsJson" = $2::jsonb where id = $1`, [orgA.id, JSON.stringify([B.domain])]);
    // S is a member of A (site engineer). A project invitation, accepted with a session A's own
    // single sign-on issued: accepted, and the new session stays bound to A's sign-on.
    keep('S project invite 1', await aPm.send('POST', '/users/invitations', { email: S.email, role: 'site_engineer', projectId: projectA }));
    const tokenS3 = await invitations.latestInvitationToken(S.email);
    const sMembershipA = (await q(`select id from "OrganizationMembership" where "orgId" = $1 and "userId" = $2`, [orgA.id, S.id]))[0];
    const aSso = createAccessToken({ id: S.id, orgId: orgA.id, role: 'site_engineer', email: S.email, name: S.name, ssoOrgId: orgA.id, membershipId: sMembershipA?.id, kind: 'member' });
    const viaOwnSso = keep('S accepts via A SSO', await accept(tokenS3, { bearer: aSso }));
    const issued = viaOwnSso.body?.data?.tokens?.accessToken ? JSON.parse(Buffer.from(viaOwnSso.body.data.tokens.accessToken.split('.')[1], 'base64url').toString()) : null;
    check('A2/A3: a session issued by the workspace\'s own single sign-on accepts into it, and the new session stays bound to that sign-on',
      viaOwnSso.status === 200 && issued?.sso === orgA.id && issued?.orgId === orgA.id, `${said(viaOwnSso)}; claims sso=${issued?.sso} org=${issued?.orgId}`);
    // The same person with an ordinary session: accepted (consent given), but no session — A signs it in by SSO.
    keep('S project invite 2', await aPm.send('POST', '/users/invitations', { email: S.email, role: 'site_engineer', projectId: projectA }));
    const tokenS4 = await invitations.latestInvitationToken(S.email);
    api.forget(S.email);
    const sHome = await api.tokenFor(S.email, orgB.id);
    const viaPassword = keep('S accepts via ordinary session', await accept(tokenS4, { bearer: sHome }));
    check('A3: with an ordinary session the acceptance stands but no session is issued into an SSO-only workspace (signInRequired, SSO_REQUIRED)',
      viaPassword.status === 200 && viaPassword.body?.data?.signInRequired === true && viaPassword.body?.data?.reason?.code === 'SSO_REQUIRED' && !viaPassword.body?.data?.tokens,
      `${said(viaPassword)} ${JSON.stringify(viaPassword.body?.data?.reason || null)}`);
    // A brand-new account accepting while somebody else's session from A's SSO rides along
    // (a colleague signed in in the same browser): it lends the new account nothing.
    const NS = { email: `l38.newsso.${STAMP}@${B.domain}`, name: `L38 new sso ${STAMP}` };
    keep('invite NS', await aPm.send('POST', '/users/invitations', { email: NS.email, role: 'qs' }));
    const tokenNS = await invitations.latestInvitationToken(NS.email);
    const borrowed = keep('NS accepts with S SSO bearer', await accept(tokenNS, { bearer: aSso, password: PASSWORD, name: NS.name }));
    check('review: a new account accepting beside another person\'s SSO session gets no SSO-bound session (signInRequired, SSO_REQUIRED)',
      borrowed.status === 200 && borrowed.body?.data?.signInRequired === true && borrowed.body?.data?.reason?.code === 'SSO_REQUIRED' && !borrowed.body?.data?.tokens,
      `${said(borrowed)} ${JSON.stringify(borrowed.body?.data?.reason || null)} tokens=${Boolean(borrowed.body?.data?.tokens)}`);
  } finally {
    await db.query(`update "Organisation" set "ssoEnabled" = $2, "ssoRequired" = $3, "ssoDomainsJson" = $4::jsonb where id = $1`, [orgA.id, policyBefore.ssoEnabled, policyBefore.ssoRequired, JSON.stringify(policyBefore.ssoDomainsJson ?? [])]);
  }

  // W: a guest of A's party P1, suspended by A, then invited to a new party P3: acceptance
  // brings back only P3 — the old P1 place stays closed.
  const P1 = keep('party P1', await aPm.send('POST', `/projects/${projectA}/parties`, { role: 'subcontractor', companyName: `L38 P1 ${STAMP}` })).body?.data?.id;
  const wFirst = keep('invite W to P1', await aPm.send('POST', '/users/invitations', { email: W.email, role: 'site_engineer', projectId: projectA, projectPartyId: P1 }));
  const wToken1 = await invitations.latestInvitationToken(W.email);
  const wBearer = await api.tokenFor(W.email, orgB.id);
  const wJoined = keep('W accepts P1', await accept(wToken1, { bearer: wBearer }));
  const wOff = keep('A suspends W', await aPm.send('PATCH', `/users/${W.id}/deactivate`, {}));
  const P3 = keep('party P3', await aPm.send('POST', `/projects/${projectA}/parties`, { role: 'subcontractor', companyName: `L38 P3 ${STAMP}` })).body?.data?.id;
  keep('invite W to P3', await aPm.send('POST', '/users/invitations', { email: W.email, role: 'site_engineer', projectId: projectA, projectPartyId: P3 }));
  const wToken3 = await invitations.latestInvitationToken(W.email);
  api.forget(W.email);
  const wBack = keep('W accepts P3', await accept(wToken3, { bearer: await api.tokenFor(W.email, orgB.id) }));
  const wPlaces = Object.fromEntries((await q(`select "projectPartyId" as party, status from "ProjectPartyMember" where "userId" = $1 and "projectPartyId" = any($2::text[])`, [W.id, [P1, P3]])).map((r) => [r.party, r.status]));
  const wMembership = await membershipInA(W.id);
  check('review: a suspended guest who accepts a new party offer gets that party only — the earlier party place stays closed',
    wFirst.status === 201 && wJoined.status === 200 && wOff.status === 200 && wBack.status === 200 && wPlaces[P3] === 'active' && wPlaces[P1] === 'inactive' && wMembership?.status === 'active' && wMembership.kind === 'guest',
    `P1 ${wPlaces[P1]}; P3 ${wPlaces[P3]}; membership ${JSON.stringify(wMembership)}; ${said(wJoined)} ${said(wOff)} ${said(wBack)}`);

  // ── M8: person and company custom fields name only this company's ──────────
  console.log('\n── custom fields of type person and company ──');
  // Project fields: always in the project's schema (a company field outside the
  // project's fieldset would be refused as an unknown field, for any value).
  const defUser = keep('field user', await aPm.send('POST', `/projects/${projectA}/custom-fields/definitions`, { recordType: 'task', type: 'user', label: `L38 person ${STAMP}`, key: `l38p_${STAMP}` }));
  const defCompany = keep('field company', await aPm.send('POST', `/projects/${projectA}/custom-fields/definitions`, { recordType: 'task', type: 'company', label: `L38 company ${STAMP}`, key: `l38c_${STAMP}` }));
  const taskId = task.body?.data?.id;
  const setField = (values) => aPm.send('PUT', `/projects/${projectA}/custom-fields/values/task/${taskId}`, { values, partial: true });
  const bCompany = (await q('select id, name from "Company" where "orgId" = $1 order by "createdAt" limit 1', [orgB.id]))[0];
  const aCompany = (await q('select id from "Company" where "orgId" = $1 order by "createdAt" limit 1', [orgA.id]))[0];
  const keyU = defUser.body?.data?.key;
  const keyC = defCompany.body?.data?.key;
  const foreignPerson = keep('field foreign person', await setField({ [keyU]: M.id }));
  const nowherePerson = keep('field nowhere person', await setField({ [keyU]: crypto.randomUUID() }));
  const foreignCompany = keep('field foreign company', await setField({ [keyC]: bCompany.id }));
  const nowhereCompany = keep('field nowhere company', await setField({ [keyC]: crypto.randomUUID() }));
  const ownBoth = keep('field own', await setField({ [keyU]: S.id, [keyC]: aCompany.id }));
  const sameAnswer = (x, y) => said(x) === said(y) && (x.text || '').replace(/[0-9a-f-]{36}/g, '') === (y.text || '').replace(/[0-9a-f-]{36}/g, '');
  const refusedAs = (res, what) => said(res) === '400 CUSTOM_FIELD_INVALID' && (res.body?.error?.message || '').includes(`needs a ${what} of this organisation`);
  check('M8: another company\'s person or company in a custom field is refused exactly as one that exists nowhere; the company\'s own are accepted and stored',
    defUser.status === 201 && defCompany.status === 201 && refusedAs(foreignPerson, 'person') && sameAnswer(foreignPerson, nowherePerson) && refusedAs(foreignCompany, 'company') && sameAnswer(foreignCompany, nowhereCompany) && ownBoth.status === 200 && ownBoth.body?.data?.values?.[keyU] === S.id && carries(foreignPerson, foreignWords(M)).length === 0 && !(foreignCompany.text || '').includes(bCompany.name),
    `defs ${said(defUser)} ${said(defCompany)}; person ${foreignPerson.body?.error?.message} / ${said(nowherePerson)}; company ${foreignCompany.body?.error?.message} / ${said(nowhereCompany)}; own ${said(ownBoth)} ${ownBoth.body?.error?.message || ''}`);
  // A value stored before the check (written here as that residue) is shown as its bare id, never resolved to the other company's name.
  const task2 = await aPm.send('POST', `/projects/${projectA}/tasks`, { title: `L38 residue ${STAMP}` });
  const fieldIds = await q('select id, key from "CustomFieldDefinition" where "orgId" = $1 and key = any($2::text[])', [orgA.id, [keyU, keyC]]);
  for (const f of fieldIds) {
    await db.query(`insert into "CustomFieldValue" (id, "orgId", "projectId", "recordType", "recordId", "fieldId", "valueJson", "createdAt", "updatedAt") values ($1, $2, $3, 'task', $4, $5, $6::jsonb, now(), now())`,
      [crypto.randomUUID(), orgA.id, projectA, task2.body?.data?.id, f.id, JSON.stringify(f.key === keyU ? M.id : bCompany.id)]);
  }
  const customFields = require('../../../src/services/custom-field.service');
  const rows = [{ id: task2.body?.data?.id }, { id: taskId }];
  await customFields.attachValues({ orgId: orgA.id, recordType: 'task', rows });
  const shown = rows.map((r) => r.__custom || {});
  check('M8: a report shows a stored foreign person or company as its bare id, and the company\'s own by name',
    shown[0][keyU] === M.id && shown[0][keyC] === bCompany.id && shown[1][keyU] === S.name && typeof shown[1][keyC] === 'string' && shown[1][keyC] !== aCompany.id,
    JSON.stringify(shown));
  // The residue was written only to be read: it goes, so the reference census stays at zero.
  await db.query('delete from "CustomFieldValue" where "recordId" = $1', [task2.body?.data?.id]);

  // ── audit ──────────────────────────────────────────────────────────────────
  const audit = await q(`select action, "actorId", "userId", "metadataJson" as meta from "AuthAuditEvent" where "orgId" = $1 and email = $2 order by "createdAt"`, [orgA.id, S.email]);
  const created = audit.filter((row) => row.action === 'invitation_created');
  const acceptedAudit = audit.find((row) => row.action === 'invitation_accepted');
  check('audit: each invitation is recorded with its inviter, company and offered role; the acceptance with the identity',
    created.length >= 2 && created.every((row) => row.actorId === aPmId && row.meta?.role) && created.some((row) => row.meta?.via === 'users.create') && acceptedAudit?.userId === S.id,
    JSON.stringify(audit.map((row) => ({ action: row.action, actor: row.actorId === aPmId ? 'A pm' : row.actorId, role: row.meta?.role, via: row.meta?.via, reason: row.meta?.reason }))));

  // ── M: nothing changed elsewhere ───────────────────────────────────────────
  console.log('\n── nothing changed elsewhere ──');
  check('M: the identities\' own rows (home company, role, name, phone, password, MFA, SSO link, standing) are unchanged', (await identityRows()) === identitiesBefore);
  check('M: their memberships in every other company are unchanged', (await elsewhere()) === elsewhereBefore);
  const changes = fingerprint.compare(printBefore, await fingerprint.take(db)).filter((c) => !c.noise && c.org !== A_CODE);
  check('M: no other company\'s data changed', changes.length === 0, changes.map((c) => `${c.table}:${c.org}`).join(', ') || 'none');
  const fives = answers.filter((a) => a.status >= 500);
  check('no answer was a 5xx', fives.length === 0, fives.map((a) => `${a.label} ${a.status}`).join(', '));

  await db.end();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nl38 invitation proof: ${results.length - failed} passed, ${failed} failed of ${results.length}`);
  process.exitCode = failed ? 2 : 0;
};

main().catch((error) => {
  console.error(`SCRIPT ERROR: ${error.stack || error.message}`);
  process.exitCode = 1;
});
