'use strict';

/**
 * A person joins another company the only way the product allows (owner
 * decision L38, 2026-10-05): that company invites the e-mail, and the person
 * accepts with a session of their own. The certification scripts that need a
 * person of two companies go through here.
 *
 * The invitation link is read from the product's local mail transport, which
 * writes each message to the console: in process (CERT_INPROCESS=1) the
 * console lines are captured here as they are written; against a running API
 * they are read from its log (CERT_API_LOG, else <work>/logs/api.log).
 */

const fs = require('fs');
const path = require('path');
const api = require('./api');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const MARK = '[email:local] -> ';
const mails = [];
let capturing = false;

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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
};

/** POST /auth/invitations/accept with the invitee's own session (`asEmail` signs in to its home company). */
const acceptAs = async ({ token, asEmail, name = 'Invitee', orgId = null }) =>
  api.raw('POST', '/auth/invitations/accept', { json: { token, name }, token: await api.tokenFor(asEmail, orgId) });

/**
 * `inviter` (an `api.as` person) brings `email` into its company with `role`,
 * through POST /users (`via: 'users'`) or POST /users/invitations, and the
 * person accepts with their own session. Returns { invited, accepted, token }.
 */
const joinByInvitation = async ({ inviter, email, role, via = 'invitations', name = 'Invitee', homeOrgId = null }) => {
  // Not quiet: a proof that counts e-mails through its own console wrapper still sees every message.
  captureMail();
  const before = mailsTo(email).length;
  const invited = via === 'users'
    ? await inviter.send('POST', '/users', { name, email, role })
    : await inviter.send('POST', '/users/invitations', { email, role });
  if (invited.status >= 300) return { invited, accepted: null, token: null };
  const token = await latestInvitationToken(email, { after: before });
  if (!token) return { invited, accepted: null, token: null };
  const accepted = await acceptAs({ token, asEmail: email, name, orgId: homeOrgId });
  api.forget(email);
  return { invited, accepted, token };
};

module.exports = { acceptAs, captureMail, joinByInvitation, latestInvitationToken, mailsTo, tokenIn };
