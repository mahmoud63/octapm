'use strict';

/**
 * A person joins a company the only way the product allows (owner decisions
 * L38 and D-ID-1): that company invites the e-mail, and the person accepts.
 * An existing identity accepts with a session of its own (joinByInvitation);
 * a new e-mail accepts with the link alone and sets its name and password
 * (createByInvitation). Adding a person is always an invitation: POST /users
 * is the deprecated alias of POST /users/invitations, both answer 201 with the
 * invitation, and its `id` is the invitation's, never a user's.
 *
 * The invitation link is read from the product's local mail transport, which
 * writes each message to the console: in process (CERT_INPROCESS=1) the
 * console lines are captured here as they are written; against a running API
 * they are read from its log (CERT_API_LOG, else <work>/logs/api.log).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const api = require('./api');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const MARK = '[email:local] -> ';
const mails = [];
let capturing = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Keeps every local-transport message written in this process (they are still printed unless `quiet`). */
const captureMail = ({ quiet = false } = {}) => {
  if (capturing) return;
  capturing = true;
  const print = console.log.bind(console);
  console.log = (...args) => {
    const text = args.map(String).join(' ');
    if (text.startsWith(MARK)) {
      mails.push(text);
      if (quiet) return;
    }
    print(...args);
  };
};

const tokenIn = (text) => {
  const match = /accept-invite\?token=([A-Za-z0-9_\-.~%]+)/.exec(text || '');
  return match ? decodeURIComponent(match[1]) : null;
};

/** The invitation a mail names in its metadata (`invitationId`, as user.service inviteUser sends it), or null when the line carries none. */
const invitationIdIn = (text) => {
  const match = /["']?invitationId["']?\s*[:=]\s*["']?([0-9a-fA-F-]{36})/.exec(text || '');
  return match ? match[1].toLowerCase() : null;
};

/** The messages sent to `email` so far, oldest first: captured in process, else read from the API log. */
const mailsTo = (email) => {
  const head = `${MARK}${email} |`;
  if (process.env.CERT_INPROCESS === '1') return mails.filter((text) => text.startsWith(head));
  const log = process.env.CERT_API_LOG || path.join(WORK, 'logs', 'api.log');
  let text = '';
  try {
    text = fs.readFileSync(log, 'utf8');
  } catch {
    return [];
  }
  const found = [];
  for (let at = text.indexOf(head); at >= 0; at = text.indexOf(head, at + head.length)) {
    const next = text.indexOf(MARK, at + head.length);
    found.push(text.slice(at, next < 0 ? undefined : next));
  }
  return found;
};

/** The acceptance token of the newest invitation mail to `email`, waiting briefly for a log to be written. */
const latestInvitationToken = async (email, { after = 0 } = {}) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const list = mailsTo(email);
    if (list.length > after) return tokenIn(list[list.length - 1]);
    await sleep(250);
  }
  return null;
};

/** The invitation whose link carries `token`, read from the certification database (`db`, a pg client): the product stores only the link's sha256 (auth.service hashAccountToken). */
const invitationIdOfToken = async (db, token) => {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const rows = (await db.query('select id::text as id from "InvitationToken" where "tokenHash" = $1', [tokenHash])).rows;
  return rows[0]?.id?.toLowerCase() || null;
};

/**
 * The acceptance token of THE invitation the API answered with (`invitationId`,
 * the `id` of the 201), among the mails to `email` written after the first
 * `after` of them, waiting briefly for a log to be written.
 *
 * The match is the mail's metadata `invitationId`. The local log transport
 * (email.service sendEmail, provider "log") prints only "to | subject" and the
 * body — not the metadata — so on that transport a line carries no
 * invitationId. Then, with `db`, the link is matched by its hash to the
 * invitation's row; without it, the newest mail written since `after` is
 * taken: callers pass the count from before their own invitation, so the
 * newest is theirs unless another invitation to the same address raced it.
 */
const invitationTokenFor = async ({ email, invitationId, after = 0, db = null }) => {
  if (!email || !invitationId) return null;
  const wanted = String(invitationId).toLowerCase();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const list = mailsTo(email).slice(after);
    const named = list.filter((text) => invitationIdIn(text));
    const match = named.find((text) => invitationIdIn(text) === wanted);
    if (match) return tokenIn(match);
    if (list.length && !named.length) {
      if (!db) return tokenIn(list[list.length - 1]);
      for (const text of [...list].reverse()) {
        const token = tokenIn(text);
        if (token && (await invitationIdOfToken(db, token)) === wanted) return token;
      }
    }
    await sleep(250);
  }
  return null;
};

/** The subject (user id) of an access or identity token, read without verifying it. */
const subjectOf = (jwt) => {
  try {
    return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8')).sub || null;
  } catch {
    return null;
  }
};

/** Ends the session an answer opened (a web answer carries its refresh token as a cookie). Best effort. */
const dropSession = async (res) => {
  const headers = res?.headers;
  const raw = headers?.getSetCookie?.() ?? headers?.get?.('set-cookie') ?? null;
  const cookies = [].concat(raw || [])
    .flatMap((line) => String(line).split(/,(?=\s*[^;=\s]+=)/))
    .map((cookie) => cookie.split(';')[0].trim())
    .filter((cookie) => cookie.includes('='));
  if (!cookies.length) return null;
  return api.raw('POST', '/auth/logout', { headers: { cookie: cookies.join('; ') }, json: {} }).catch(() => null);
};

/**
 * POST /auth/invitations/accept with the invitee's own session (`asEmail`
 * signs in to its home company). The link is `token`, or the one of
 * `invitationId` (invitationTokenFor, among the mails after `after`).
 */
const acceptAs = async ({ token = null, invitationId = null, asEmail, name = 'Invitee', orgId = null, after = 0, db = null }) => {
  const link = token || (await invitationTokenFor({ email: asEmail, invitationId, after, db }));
  return api.raw('POST', '/auth/invitations/accept', { json: { token: link, name }, token: await api.tokenFor(asEmail, orgId) });
};

/**
 * `inviter` (an `api.as` person, or anything with its `send`) brings the
 * existing identity `email` into its company with `role`, through POST /users
 * (`via: 'users'`, the deprecated alias) or POST /users/invitations — both
 * answer 201 with the invitation — and the person accepts with their own
 * session. Returns { invited, accepted, token }.
 */
const joinByInvitation = async ({ inviter, email, role, via = 'invitations', name = 'Invitee', homeOrgId = null, db = null }) => {
  // Not quiet: a proof that counts e-mails through its own console wrapper still sees every message.
  captureMail();
  const before = mailsTo(email).length;
  const invited = await inviter.send('POST', via === 'users' ? '/users' : '/users/invitations', { email, role });
  if (invited.status !== 201) return { invited, accepted: null, token: null };
  const token = await invitationTokenFor({ email, invitationId: invited.body?.data?.id, after: before, db });
  if (!token) return { invited, accepted: null, token: null };
  const accepted = await acceptAs({ token, asEmail: email, name, orgId: homeOrgId });
  api.forget(email);
  return { invited, accepted, token };
};

/**
 * A new person, made the one way the product allows (D-ID-1): `inviter` (an
 * `api.as` person, or anything with its `send`) invites the new e-mail —
 * POST /users/invitations, or POST /users with `via: 'users'` — with `role`
 * (and a project or project party when given), the matching link is read, and
 * it is accepted with no bearer, setting `name`, `password` (CERT_PASSWORD
 * unless given) and `phone`. The session the acceptance (or a sign-in) opened
 * is ended and forgotten. Returns { userId, email, invited, accepted, token };
 * userId is null when the invitation or the acceptance was refused (see
 * `invited` and `accepted`).
 */
const createByInvitation = async ({ inviter, email, role, name, password = process.env.CERT_PASSWORD, phone = null, projectId = null, projectPartyId = null, via = 'invitations', db = null }) => {
  if (!password) throw new Error('createByInvitation: CERT_PASSWORD is not set and no password was given');
  captureMail();
  const before = mailsTo(email).length;
  const offer = { email, role, ...(projectId ? { projectId } : {}), ...(projectPartyId ? { projectPartyId } : {}) };
  const invited = await inviter.send('POST', via === 'users' ? '/users' : '/users/invitations', offer);
  const refused = { userId: null, email, invited, accepted: null, token: null };
  if (invited.status !== 201) return refused;
  const token = await invitationTokenFor({ email, invitationId: invited.body?.data?.id, after: before, db });
  if (!token) return refused;
  const accepted = await api.raw('POST', '/auth/invitations/accept', { json: { token, name, password, ...(phone ? { phone } : {}) } });
  const data = accepted.body?.data || {};
  let userId = data.user?.id || subjectOf(data.tokens?.accessToken);
  await dropSession(accepted);
  if (accepted.status === 200 && !userId) {
    // Accepted without a session (signInRequired): the id comes from a sign-in, which is ended at once.
    const login = await api.raw('POST', '/auth/login', { json: { email, password } });
    const signedIn = login.body?.data || {};
    userId = signedIn.user?.id || subjectOf(signedIn.tokens?.accessToken || signedIn.identityToken);
    await dropSession(login);
  }
  api.forget(email);
  return { userId: accepted.status === 200 ? userId || null : null, email, invited, accepted, token };
};

module.exports = {
  acceptAs,
  captureMail,
  createByInvitation,
  invitationIdIn,
  invitationTokenFor,
  joinByInvitation,
  latestInvitationToken,
  mailsTo,
  tokenIn,
};
