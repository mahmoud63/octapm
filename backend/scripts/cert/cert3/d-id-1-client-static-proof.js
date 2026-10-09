'use strict';

/**
 * D-ID-1 P5 (CERT-3 plan §2.8): C9 (web client) and the static part of C17
 * (Android links reach the web, owner decision Q14). No database, no API.
 *
 *   node scripts/cert/cert3/d-id-1-client-static-proof.js        (from backend/)
 *
 * C9, web sources (frontend/src):
 *   - adding a person is only the invitation: no POST /users create call, no
 *     password or confirm field in the users feature, no "Person added"
 *     branch, no "add" dialog; the invite dialog shows exactly one toast;
 *   - the edit payload carries no `email`;
 *   - no call to /users/:id/reset-password remains; the reset action is
 *     POST /users/:id/password-reset-email;
 *   - a pending-invitations component lists (GET /users/invitations),
 *     revokes (DELETE) and re-sends the stored offer (POST …/resend, no body);
 *   - the SSO settings UI never sends `autoProvision: true`;
 *   - (D-ID-1 N4, Codex r2) an ended session reaches every caller as the
 *     SESSION_REVOKED error: the refresh catch picks the request's (else the
 *     refresh's) SESSION_REVOKED error, rejects the failing request and flushes
 *     every waiting one with it, fires the ended-session listener once, and the
 *     mutation toaster in main.tsx skips that error;
 *   - (D-ID-1 N4 residue, Codex r3) every explicit handler in the users and
 *     accept-invite features that toasts an error returns early on
 *     isEndedSession(error) before its first toast; isEndedSession is true
 *     only for a SESSION_REVOKED the request layer marked as a signed-in
 *     session's (so a sign-in step's refusal is still shown), and a request
 *     retried after a successful refresh that answers SESSION_REVOKED resets
 *     the store and fires the ended-session listener once (only while its
 *     sender is still the one signed in).
 * C17, mobile:
 *   - mobile/app.json Android intent filters: every https entry names a path,
 *     there is no catch-all "/" claim, and no auth page is claimed (an
 *     independent reading of Android's matcher, not the app's own test);
 *   - the resolver refuses the web-only roots and +native-intent hands an
 *     unresolved web link to the browser whole;
 *   - the mobile deep-link unit tests (deepLinks.test.ts, nativeIntent.test.ts)
 *     carry the Q14 assertions and pass (jest exit status recorded).
 *
 * Writes C:\Temp\octapm-cert\results\cert3\d-id-1-client-static-proof.json.
 * Exit 0 when every check holds, 2 otherwise, 1 on a script error.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const FRONT = path.join(REPO, 'frontend');
const MOBILE = path.join(REPO, 'mobile');
const RESULT_DIR = process.env.CERT_RESULTS_DIR || 'C:/Temp/octapm-cert/results/cert3';
const RESULT_FILE = path.join(RESULT_DIR, 'd-id-1-client-static-proof.json');
const EXPECTED_CHECKS = 19;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: ok ? undefined : detail || undefined });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n        ${detail}` : ''}`);
};

const read = (root, rel) => {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return null;
  }
};
const exists = (root, rel) => fs.existsSync(path.join(root, rel));

/** Every .ts/.tsx/.js/.jsx file under a directory (no generated route tree). */
const walk = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) && entry.name !== 'routeTree.gen.ts') {
      out.push(full);
    }
  }
  return out;
};
const sources = (root, rel) => walk(path.join(root, rel)).map((file) => ({
  file: path.relative(REPO, file).replace(/\\/g, '/'),
  text: fs.readFileSync(file, 'utf8'),
}));

/** Remove block comments and line comments (a `//` preceded by whitespace or at line start). */
const code = (text) => (text || '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1');

/** Files (and the first matching line) where a pattern appears in code. */
const hits = (files, pattern) => files.flatMap(({ file, text }) => {
  const stripped = code(text);
  const lines = stripped.split('\n');
  const found = lines.map((line, i) => (pattern.test(line) ? `${file}:${i + 1}: ${line.trim().slice(0, 140)}` : null)).filter(Boolean);
  return found;
});

/** The text of a brace block that starts at the first match of `head` (head included). */
const block = (text, head) => {
  const source = text || '';
  const match = source.match(head);
  if (!match) return null;
  const start = match.index;
  // The first brace at or after the head's last character (a head may end with its own `{`).
  const open = source.indexOf('{', start + Math.max(match[0].length - 1, 0));
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
};

/** The try { … } body inside a block, and the catch { … } body after it. */
const tryCatch = (text) => {
  const t = text || '';
  const tryAt = t.search(/\btry\s*\{/);
  if (tryAt < 0) return { tryBody: null, catchBody: null };
  const tryBody = block(t.slice(tryAt), /\btry\s*\{/);
  const rest = t.slice(tryAt + (tryBody || '').length);
  const catchBody = block(rest, /\bcatch\s*\([^)]*\)\s*\{/);
  return { tryBody, catchBody };
};
const toasts = (text) => (code(text).match(/\btoast\.(success|error|warning|info|message)\s*\(|\btoast\s*\(/g) || []);

const main = () => {
  const front = sources(FRONT, 'src');
  const usersFeature = front.filter((f) => f.file.startsWith('frontend/src/features/users/'));
  const F = (rel) => read(FRONT, rel);

  console.log('── C9 web: one way in ──');

  // C9.1 No direct-create call: nothing POSTs to the bare /users collection.
  const createCalls = hits(front, /\.(post|put)\s*(<[^>]*>)?\s*\(\s*['"`]\/users\/?['"`]/);
  const createCallsVerb = hits(front, /method\s*:\s*['"`]POST['"`].*['"`]\/users\/?['"`]|['"`]\/users\/?['"`].*method\s*:\s*['"`]POST['"`]/);
  check('C9.1 no web source calls POST /users (the retired direct create)', createCalls.length === 0 && createCallsVerb.length === 0,
    [...createCalls, ...createCallsVerb].join(' | '));

  // C9.2 No password or confirm field anywhere in the users feature.
  const pwField = [
    ...hits(usersFeature, /<PasswordInput\b/),
    ...hits(usersFeature, /type\s*=\s*\{?\s*['"`]password['"`]/),
    ...hits(usersFeature, /name\s*=\s*\{?\s*['"`](password|confirmPassword|newPassword)['"`]/),
    ...hits(usersFeature, /\b(password|confirmPassword|newPassword|temporaryPassword)\??\s*:/),
  ];
  check('C9.2 the users feature has no password or confirm field, schema key or payload key', pwField.length === 0, pwField.join(' | '));

  // C9.3 No "Person added" branch and no "add"/"resetPassword" dialog; the old reset dialog is gone.
  const personAdded = front.flatMap(({ file, text }) => (/person\s+added/i.test(text) ? [file] : []));
  const provider = F('src/features/users/components/users-provider.tsx');
  const dialogUnion = (code(provider).match(/type\s+UsersDialogType\s*=([\s\S]*?)\n\s*\n|type\s+UsersDialogType\s*=([^;]*?)(?=\ntype|\nconst|\nexport)/) || [])[0] || '';
  const dialogNames = (dialogUnion.match(/['"]([A-Za-z]+)['"]/g) || []).map((s) => s.slice(1, -1));
  const oldDialog = exists(FRONT, 'src/features/users/components/users-reset-password-dialog.tsx');
  const dialogsFile = F('src/features/users/components/users-dialogs.tsx');
  check('C9.3 no "Person added" branch, no add or set-password dialog type, the admin reset dialog is deleted',
    personAdded.length === 0 && dialogNames.length > 0 && !dialogNames.some((n) => /^(add|create|resetPassword|reset)$/i.test(n)) && !oldDialog && !/ResetPasswordDialog/.test(code(dialogsFile)),
    `personAdded=${personAdded.join(',') || 'none'} dialogTypes=${JSON.stringify(dialogNames)} oldDialogFile=${oldDialog} dialogsRefOld=${/ResetPasswordDialog/.test(code(dialogsFile))}`);

  // C9.4 The invite dialog: the invitation API only, its payload keys, one toast per outcome.
  const hooks = F('src/features/users/hooks/use-users.ts');
  const inviteHook = block(hooks, /export const useInviteUserMutation\s*=/);
  const invitePayloadType = (code(inviteHook).match(/mutationFn:\s*\(payload:\s*\{([\s\S]*?)\}\)/) || [])[1] || '';
  const invitePayloadKeys = (invitePayloadType.match(/\b([A-Za-z]+)\??\s*:/g) || []).map((k) => k.replace(/\??\s*:$/, ''));
  const inviteAllowed = ['email', 'role', 'projectId', 'companyId', 'projectPartyId', 'note'];
  const inviteDialog = F('src/features/users/components/users-invite-dialog.tsx');
  const onSubmit = block(inviteDialog, /const onSubmit\s*=\s*async/);
  const { tryBody, catchBody } = tryCatch(onSubmit);
  const tryToasts = toasts(tryBody);
  // Each catch path: split at the early `return`s; every path shows at most one toast.
  const catchPaths = (code(catchBody) || '').split(/\breturn\b/);
  const catchToastCounts = catchPaths.map((p) => toasts(p).length);
  const mutateArg = block(onSubmit, /inviteUser\.mutateAsync\(\s*/);
  const mutateKeys = (code(mutateArg).match(/^\s*([A-Za-z]+)\s*:/gm) || []).map((k) => k.replace(/\s*:$/, '').trim());
  check('C9.4 the add dialog sends only the invitation (POST /users/invitations, offer keys only) and shows exactly one toast per outcome',
    /apiClient\.post\(\s*['"`]\/users\/invitations['"`]\s*,\s*payload\s*\)/.test(code(inviteHook))
      && invitePayloadKeys.length > 0 && invitePayloadKeys.every((k) => inviteAllowed.includes(k))
      && mutateKeys.length > 0 && mutateKeys.every((k) => inviteAllowed.includes(k))
      && /useInviteUserMutation\(\)/.test(code(inviteDialog))
      && tryToasts.length === 1 && /toast\.success\(/.test(tryToasts[0])
      && catchToastCounts.length > 0 && catchToastCounts.every((n) => n <= 1),
    `hookPayloadKeys=${JSON.stringify(invitePayloadKeys)} dialogKeys=${JSON.stringify(mutateKeys)} tryToasts=${JSON.stringify(tryToasts)} catchToastsPerPath=${JSON.stringify(catchToastCounts)}`);

  console.log('\n── C9 web: edit, reset, pending, SSO ──');

  // C9.5 The edit payload has no `email`.
  const updateType = block(hooks, /export type UserUpdatePayload\s*=/);
  const updateHook = block(hooks, /export const useUpdateUserMutation\s*=/);
  const actionDialog = F('src/features/users/components/users-action-dialog.tsx');
  const changed = (code(actionDialog).match(/const changedFields\s*=[\s\S]*?\n\}\)\n/) || [])[0] || '';
  const formSchema = block(actionDialog, /const formSchema\s*=\s*z\.object\(/);
  const actionEmailKeys = hits([{ file: 'frontend/src/features/users/components/users-action-dialog.tsx', text: actionDialog || '' }], /\bemail\s*:/);
  check('C9.5 the edit payload carries no `email` (payload type, changed-fields builder, form schema, dialog); e-mail is shown read-only',
    Boolean(updateType) && !/\bemail\b/.test(code(updateType))
      && /apiClient\.patch\(\s*`\/users\/\$\{userId\}`\s*,\s*payload\s*\)/.test(code(updateHook))
      && changed.length > 0 && !/\bemail\b/.test(changed)
      && Boolean(formSchema) && !/\bemail\b/.test(code(formSchema))
      && actionEmailKeys.length === 0
      && /value=\{currentRow\.email\}[\s\S]{0,40}readOnly/.test(actionDialog || ''),
    `typeHasEmail=${/\bemail\b/.test(code(updateType))} changedHasEmail=${/\bemail\b/.test(changed)} schemaHasEmail=${/\bemail\b/.test(code(formSchema))} emailKeys=${actionEmailKeys.join(' | ')}`);

  // C9.6 No call to /users/${…}/reset-password remains anywhere.
  const oldReset = [
    ...hits(front, /\/users\/\$\{[^}]*\}\/reset-password/),
    ...hits(front, /['"`]\/users\/[^'"`]*\/reset-password['"`]/),
    ...hits(front, /\/users\/['"`]\s*\+[^;]*['"`]\/reset-password/),
  ];
  check('C9.6 no web source calls /users/:id/reset-password', oldReset.length === 0, oldReset.join(' | '));

  // C9.7 The reset action is the reset e-mail.
  const resetHook = block(hooks, /export const useSendPasswordResetEmailMutation\s*=/);
  const rowActions = F('src/features/users/components/data-table-row-actions.tsx');
  const resetDialog = F('src/features/users/components/users-send-reset-email-dialog.tsx');
  check('C9.7 the reset action calls POST /users/:id/password-reset-email (no body) from the row action and its dialog',
    /apiClient\s*\.post\(\s*`\/users\/\$\{userId\}\/password-reset-email`\s*\)/.test(code(resetHook))
      && /setOpen\(\s*['"]sendResetEmail['"]\s*\)/.test(code(rowActions)) && /Send password-reset e-mail/.test(rowActions || '')
      && /useSendPasswordResetEmailMutation\(\)/.test(code(resetDialog)) && /sendResetEmail\.mutate\(\s*userId\s*,/.test(code(resetDialog))
      && /UsersSendResetEmailDialog/.test(code(dialogsFile)),
    `hook=${Boolean(resetHook)} rowAction=${/setOpen\(\s*['"]sendResetEmail['"]\s*\)/.test(code(rowActions))} dialog=${/sendResetEmail\.mutate\(\s*userId\s*,/.test(code(resetDialog))}`);

  // C9.8 Pending invitations: list, revoke and resend the stored offer.
  const listHook = block(hooks, /export const useInvitationsQuery\s*=/);
  const revokeHook = block(hooks, /export const useRevokeInvitationMutation\s*=/);
  const resendHook = block(hooks, /export const useResendInvitationMutation\s*=/);
  const pending = F('src/features/users/components/users-pending-invitations.tsx');
  const usersIndex = F('src/features/users/index.tsx');
  const listOk = /apiClient\s*\.get\(\s*['"`]\/users\/invitations['"`]/.test(code(listHook));
  const revokeOk = /apiClient\s*\.delete\(\s*`\/users\/invitations\/\$\{invitationId\}`\s*\)/.test(code(revokeHook));
  const resendOk = /apiClient\s*\.post\(\s*`\/users\/invitations\/\$\{invitationId\}\/resend`\s*\)/.test(code(resendHook));
  const pendingUses = ['useInvitationsQuery(', 'useRevokeInvitationMutation()', 'useResendInvitationMutation()'].every((s) => code(pending).includes(s));
  const resendOnlyId = /resend\.mutate\(\s*invitation\.id\s*,/.test(code(pending));
  const revokeOnlyId = /revoke\.mutate\(\s*invitation\.id\s*,/.test(code(pending));
  const shownToInviters = /canInvite\s*\?[\s\S]{0,1500}<UsersPendingInvitations\s*\/>/.test(code(usersIndex));
  check('C9.8 a pending-invitations component lists (GET /users/invitations), revokes (DELETE …/:id) and re-sends the stored offer (POST …/:id/resend, no body), shown to inviters',
    listOk && revokeOk && resendOk && pendingUses && resendOnlyId && revokeOnlyId && shownToInviters,
    `list=${listOk} revoke=${revokeOk} resendNoBody=${resendOk} componentUsesHooks=${pendingUses} resendOnlyId=${resendOnlyId} revokeOnlyId=${revokeOnlyId} gatedByCanInvite=${shownToInviters}`);

  // C9.9 The SSO settings UI sends no autoProvision: true.
  const autoTrue = hits(front, /autoProvision\s*:\s*(true|!0|!\s*false)/);
  const security = F('src/features/company/hooks/use-security.ts');
  const payloadType = block(security, /export interface SsoSettingsPayload\s*/);
  const securityPage = F('src/features/company/security.tsx');
  const save = block(securityPage, /const save\s*=\s*async/);
  const updateSsoHook = block(security, /export const useUpdateSso\s*=/);
  check('C9.9 the SSO settings UI never sends autoProvision: true (no such literal; not in the payload type or the save payload)',
    autoTrue.length === 0 && Boolean(payloadType) && !/autoProvision|defaultRole/.test(code(payloadType))
      && Boolean(save) && /update\.mutateAsync\(/.test(save) && !/autoProvision|defaultRole/.test(code(save))
      && /apiClient\.put\(\s*['"`]\/company\/security\/sso['"`]\s*,\s*payload\s*\)/.test(code(updateSsoHook)),
    `literalTrue=${autoTrue.join(' | ') || 'none'} payloadTypeHasKey=${/autoProvision|defaultRole/.test(code(payloadType))} saveHasKey=${/autoProvision|defaultRole/.test(code(save))}`);

  console.log('\n── C9 web: an ended session (D-ID-1 N4) ──');

  // C9.10 (N4, Codex D-ID-1 diff review r2): a reset revokes the refresh rows,
  // so the refresh answers REFRESH_TOKEN_REUSED while the request answered
  // SESSION_REVOKED. Every failing and waiting caller must get the
  // SESSION_REVOKED error (which main.tsx does not toast), and the
  // ended-session listener fire once — not one refresh-error toast per caller.
  const client = F('src/services/api/client.ts');
  const clientCode = code(client);
  const mainTsx = F('src/main.tsx');
  const revokedPredicate = /export const isSessionRevokedError\s*=\s*\(error: unknown\)\s*=>\s*axios\.isAxiosError\(error\)\s*&&\s*error\.response\?\.status\s*===\s*401\s*&&[\s\S]{0,200}?\?\.code\s*===\s*'SESSION_REVOKED'/.test(clientCode);
  const responseInterceptor = block(client, /apiClient\.interceptors\.response\.use\(/);
  const { catchBody: refreshCatch } = tryCatch(responseInterceptor);
  const rc = code(refreshCatch);
  const picksEnded = /const\s+ended\s*=\s*isSessionRevokedError\(\s*error\s*\)\s*\?\s*error\s*:\s*isSessionRevokedError\(\s*refreshError\s*\)\s*\?\s*refreshError\s*:\s*null/.test(rc);
  const failureIsEnded = /const\s+failure\s*=\s*ended\s*(\?\?|\|\|)\s*refreshError\b/.test(rc);
  const flushCalls = rc.match(/flushPendingRequests\(\s*([^)]*?)\s*\)/g) || [];
  const flushesFailure = flushCalls.length === 1 && /flushPendingRequests\(\s*failure\s*\)/.test(flushCalls[0]);
  const rejects = rc.match(/Promise\.reject\(\s*([^)]*?)\s*\)/g) || [];
  const rejectsFailure = rejects.length === 1 && /Promise\.reject\(\s*failure\s*\)/.test(rejects[0]) && /\breturn\s+Promise\.reject\(\s*failure\s*\)/.test(rc);
  const flushBeforeReject = rc.search(/flushPendingRequests\(\s*failure\s*\)/) >= 0 && rc.search(/flushPendingRequests\(\s*failure\s*\)/) < rc.search(/return\s+Promise\.reject\(\s*failure\s*\)/);
  // Round 4 (N4 residue): the retried-request branch is a second, deliberate
  // call site, asserted on its own by C9.12. Outside that branch the refresh
  // catch remains the one call (C9.12 also pins the total at exactly two).
  const retryBranchText = block(clientCode, /if\s*\(\s*originalRequest\._retry\s*\|\|\s*isAuthRequest\s*\)\s*\{/) || '';
  const listenerCalls = (clientCode.replace(retryBranchText, '').match(/sessionEndedListener\s*(\?\.)?\s*\(/g) || []).length;
  const listenerOnceOnEnded = listenerCalls === 1 && /if\s*\(\s*askedFor\s*!==\s*null\s*&&\s*ended\s*\)\s*\{?\s*sessionEndedListener\?\.\(\)/.test(rc);
  const flushFn = block(client, /const flushPendingRequests\s*=/);
  const flushRejectsWithIt = /\(\s*error:\s*unknown\s*,\s*token\?:\s*string\s*\)/.test(code(flushFn)) && /pending\.reject\(\s*error\s*\)/.test(code(flushFn));
  const pushBlock = block(responseInterceptor, /pendingRequests\.push\(/);
  const waitersKeepReject = /^\s*reject\s*,?\s*$/m.test(code(pushBlock)) || /\breject\s*:\s*reject\b/.test(code(pushBlock));
  const mutationCacheBlock = block(mainTsx, /mutationCache:\s*new MutationCache\(/);
  const mc = code(mutationCacheBlock);
  const toasterSkips = /import\s*\{[^}]*\bisSessionRevokedError\b[^}]*\}\s*from\s*'@\/services\/api\/client'/.test(code(mainTsx))
    && /if\s*\(\s*isSessionRevokedError\(\s*error\s*\)\s*\)\s*return\b/.test(mc)
    && mc.search(/if\s*\(\s*isSessionRevokedError\(\s*error\s*\)\s*\)\s*return\b/) < mc.search(/handleServerError\(\s*error\s*\)/);
  check('C9.10 (N4) an ended session reaches every caller as SESSION_REVOKED: the refresh catch picks the request\'s (else the refresh\'s) SESSION_REVOKED error, rejects the failing request and flushes every waiting one with it, fires the ended-session listener once, and main.tsx does not toast it',
    Boolean(client) && Boolean(refreshCatch) && revokedPredicate && picksEnded && failureIsEnded && flushesFailure && rejectsFailure && flushBeforeReject
      && listenerOnceOnEnded && flushRejectsWithIt && waitersKeepReject && toasterSkips,
    `predicate=${revokedPredicate} catchFound=${Boolean(refreshCatch)} picksEnded=${picksEnded} failureIsEnded=${failureIsEnded} flushCalls=${JSON.stringify(flushCalls)} rejects=${JSON.stringify(rejects)} flushBeforeReject=${flushBeforeReject} listenerCalls=${listenerCalls} listenerOnceOnEnded=${listenerOnceOnEnded} flushRejectsWithIt=${flushRejectsWithIt} waitersKeepReject=${waitersKeepReject} toasterSkips=${toasterSkips}`);

  console.log('\n── C9 web: no second toast for an ended session (D-ID-1 N4 residue, Codex r3) ──');

  // C9.11 Explicit handlers. main.tsx's toaster skips SESSION_REVOKED, but a
  // dialog's own catch (or a mutate() onError) toasted it a second time beside
  // the ended-session listener. Every handler in the users and accept-invite
  // features that toasts the error it receives must first return on
  // isEndedSession(<that error>) — imported from the request layer — and the
  // handlers known today must all be found (the reader is not vacuous).
  const handlerFiles = front.filter((f) => f.file.startsWith('frontend/src/features/users/') || f.file.startsWith('frontend/src/features/auth/accept-invite/'));
  const TOAST = /\btoast\.(success|error|warning|info|message)\s*\(|\btoast\s*\(/;
  const lineOf = (text, index) => text.slice(0, index).split('\n').length;
  const handlers = [];
  for (const { file, text } of handlerFiles) {
    const src = code(text);
    const imports = /import\s*\{[^}]*\bisEndedSession\b[^}]*\}\s*from\s*'@\/services\/api\/client'/.test(src);
    for (const m of src.matchAll(/\bcatch\s*\(\s*(\w+)\s*\)\s*\{/g)) {
      handlers.push({ file, imports, kind: 'catch', param: m[1], line: lineOf(src, m.index), body: block(src.slice(m.index), /\bcatch\s*\(\s*\w+\s*\)\s*\{/) });
    }
    for (const m of src.matchAll(/\bonError\s*:\s*\(\s*(\w+)\s*\)\s*=>\s*/g)) {
      const after = src.slice(m.index + m[0].length);
      const isBlock = after.startsWith('{');
      // An expression body cannot hold the guard: its text up to the next option or the call's end.
      const end = after.search(/\n\s*(on[A-Z]\w*\s*:|\}\s*\)|\}\s*,)/);
      handlers.push({ file, imports, kind: 'onError', param: m[1], line: lineOf(src, m.index), body: isBlock ? block(after, /^\{/) : null, expression: isBlock ? null : after.slice(0, end < 0 ? 400 : end) });
    }
    for (const m of src.matchAll(/\.catch\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*/g)) {
      const after = src.slice(m.index + m[0].length);
      const isBlock = after.startsWith('{');
      const end = after.search(/\)\s*(\n|\.)/);
      handlers.push({ file, imports, kind: '.catch', param: m[1], line: lineOf(src, m.index), body: isBlock ? block(after, /^\{/) : null, expression: isBlock ? null : after.slice(0, end < 0 ? 400 : end) });
    }
  }
  const toasting = handlers.filter((h) => TOAST.test(h.body || h.expression || ''));
  const unguarded = toasting.filter((h) => {
    if (!h.body) return true; // a toasting expression body has no room for the guard
    const guard = h.body.search(new RegExp(String.raw`\bif\s*\(\s*isEndedSession\(\s*${h.param}\s*\)\s*\)\s*\{?\s*return\b`));
    return !h.imports || guard < 0 || guard > h.body.search(TOAST);
  });
  const knownHandlers = {
    'frontend/src/features/users/components/data-table-row-actions.tsx': 1,
    'frontend/src/features/users/components/users-action-dialog.tsx': 1,
    'frontend/src/features/users/components/users-dialogs.tsx': 1,
    'frontend/src/features/users/components/users-invite-dialog.tsx': 1,
    'frontend/src/features/users/components/users-pending-invitations.tsx': 2,
    'frontend/src/features/users/components/users-send-reset-email-dialog.tsx': 1,
    'frontend/src/features/auth/accept-invite/components/accept-invite-form.tsx': 2,
  };
  const missingKnown = Object.entries(knownHandlers)
    .filter(([file, n]) => toasting.filter((h) => h.file === file).length < n)
    .map(([file, n]) => `${file} (${toasting.filter((h) => h.file === file).length}/${n})`);
  check('C9.11 (N4 residue) every handler in the users and accept-invite features that toasts the error it receives returns early on isEndedSession(error) first (imported from the request layer); the nine known handlers are found',
    toasting.length >= 9 && missingKnown.length === 0 && unguarded.length === 0,
    `toastingHandlers=${toasting.length} missingKnown=${missingKnown.join(', ') || 'none'} unguarded=${unguarded.map((h) => `${h.file}:${h.line} ${h.kind}(${h.param})${h.imports ? '' : ' [no import]'}${h.body ? '' : ' [expression body]'}`).join(' | ') || 'none'}`);

  // C9.12 The request layer. isEndedSession is true only for a SESSION_REVOKED
  // the interceptor marked as a signed-in session's (a sign-in step's or a
  // bearer acceptance's refusal, which nobody announces, is still shown); the
  // three places that hand such an error to callers mark it; and a request
  // retried after a successful refresh that answers SESSION_REVOKED ends the
  // session itself — the store reset and the listener fired once, only while
  // its sender is still the one signed in — before it is rejected.
  const ri = code(responseInterceptor);
  const helperOk = /export const isEndedSession\s*=\s*\(\s*error:\s*unknown\s*\)\s*=>\s*isSessionRevokedError\(\s*error\s*\)\s*&&\s*endedSessionErrors\.has\(\s*error(\s+as\s+object)?\s*\)/.test(clientCode);
  const markerOk = /const\s+endedSessionErrors\s*=\s*new\s+WeakSet<object>\(\)/.test(clientCode)
    && /const\s+markEndedSession\s*=\s*\(\s*error:\s*unknown\s*\)\s*=>\s*\{[^}]*endedSessionErrors\.add\(\s*error\s*\)/.test(clientCode)
    && (clientCode.match(/endedSessionErrors\.add\(/g) || []).length === 1;
  const markCalls = (clientCode.match(/\bmarkEndedSession\(/g) || []).length;
  const retryBranch = block(ri, /if\s*\(\s*originalRequest\._retry\s*\|\|\s*isAuthRequest\s*\)\s*\{/) || '';
  const revokedRetry = block(retryBranch, /if\s*\(\s*originalRequest\._retry\s*&&\s*isSessionRevokedError\(\s*error\s*\)\s*\)\s*\{/) || '';
  const senderVar = (revokedRetry.match(/const\s+(\w+)\s*=\s*originalRequest\._sentBy\s*\?\?\s*null/) || [])[1] || null;
  const senderKnown = Boolean(senderVar) && new RegExp(String.raw`if\s*\(\s*${senderVar}\s*!==\s*null\s*\)\s*\{`).test(revokedRetry);
  const marksRetried = /markEndedSession\(\s*error\s*\)/.test(revokedRetry);
  const authDecl = revokedRetry.match(/const\s*\{\s*auth(?:\s*:\s*(\w+))?\s*\}\s*=\s*useAuthStore\.getState\(\)/);
  const authName = authDecl ? authDecl[1] || 'auth' : null;
  const onlyWhileSender = Boolean(authName && senderVar) && new RegExp(String.raw`if\s*\(\s*\(\s*${authName}\.user\?\.id\s*\?\?\s*null\s*\)\s*===\s*${senderVar}\s*\)\s*\{\s*${authName}\.reset\(\)\s*;?\s*sessionEndedListener\?\.\(\)\s*;?\s*\}`).test(revokedRetry);
  const retryListeners = (retryBranch.match(/sessionEndedListener\s*(\?\.)?\s*\(/g) || []).length;
  const retryRejectsAfter = Boolean(revokedRetry) && retryBranch.search(/return\s+Promise\.reject\(\s*error\s*\)/) > retryBranch.indexOf(revokedRetry);
  const marksRefresh = /if\s*\(\s*ended\s*&&\s*askedFor\s*!==\s*null\s*\)\s*\{?\s*markEndedSession\(\s*ended\s*\)/.test(rc)
    && rc.search(/markEndedSession\(\s*ended\s*\)/) < rc.search(/flushPendingRequests\(\s*failure\s*\)/);
  const staleBranch = block(ri, /if\s*\(\s*sentBy\s*!==\s*null\s*&&\s*sentBy\s*!==\s*signedInNow\s*\)\s*\{/) || '';
  const marksStale = /if\s*\(\s*isSessionRevokedError\(\s*error\s*\)\s*\)\s*\{?\s*markEndedSession\(\s*error\s*\)/.test(staleBranch)
    && staleBranch.search(/markEndedSession\(/) < staleBranch.search(/return\s+Promise\.reject\(\s*error\s*\)/);
  const listenerTotal = (clientCode.match(/sessionEndedListener\s*(\?\.)?\s*\(/g) || []).length;
  check('C9.12 (N4 residue) isEndedSession is true only for an error the interceptor marked; the retried-request, stale-sender and refresh-failure paths mark it; a retried request answering SESSION_REVOKED resets the store and fires the listener once, only while its sender is signed in, before rejecting',
    helperOk && markerOk && markCalls === 3 && Boolean(retryBranch) && Boolean(revokedRetry) && senderKnown && marksRetried && onlyWhileSender
      && retryListeners === 1 && retryRejectsAfter && marksRefresh && marksStale && listenerTotal === 2,
    `helper=${helperOk} marker=${markerOk} markCalls=${markCalls} retryBranch=${Boolean(retryBranch)} revokedRetry=${Boolean(revokedRetry)} sender=${senderVar} senderKnown=${senderKnown} marksRetried=${marksRetried} onlyWhileSender=${onlyWhileSender} retryListeners=${retryListeners} retryRejectsAfter=${retryRejectsAfter} marksRefresh=${marksRefresh} marksStale=${marksStale} listenerTotal=${listenerTotal}`);

  console.log('\n── C17 mobile: Android claims (app.json) ──');

  let app = null;
  try {
    app = JSON.parse(read(MOBILE, 'app.json'));
  } catch (error) {
    app = { error: error.message };
  }
  const filters = app?.expo?.android?.intentFilters || [];
  const data = filters.flatMap((f) => f.data || []);
  const https = data.filter((d) => /^https?$/i.test(d.scheme || ''));
  /** Android PatternMatcher (PATTERN_SIMPLE_GLOB): `.` any char, `X*` zero or more X, `\\` escapes; greedy regex over-approximates. */
  const globToRegex = (glob) => {
    let out = '';
    for (let i = 0; i < glob.length; i += 1) {
      const c = glob[i];
      if (c === '\\' && i + 1 < glob.length) { out += glob[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i += 1; continue; }
      if (c === '.') out += '.';
      else if (c === '*') out += '*';
      else out += c.replace(/[+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${out}$`);
  };
  const claims = (d, p) => {
    if (d.path !== undefined) return d.path === p;
    if (d.pathPrefix !== undefined) return p.startsWith(d.pathPrefix);
    if (d.pathPattern !== undefined) return globToRegex(d.pathPattern).test(p);
    if (d.pathAdvancedPattern !== undefined) return true;
    if (d.pathSuffix !== undefined) return p.endsWith(d.pathSuffix);
    return true; // no path attribute: the whole host
  };
  const hosts = [...new Set(https.map((d) => d.host).filter(Boolean))];

  // C17.1 Every https entry names exactly one path and none is a catch-all.
  const pathAttrs = (d) => ['path', 'pathPrefix', 'pathPattern', 'pathSuffix', 'pathAdvancedPattern'].filter((k) => d[k] !== undefined);
  const badEntries = https.filter((d) => pathAttrs(d).length !== 1 || d.pathPrefix === '/' || d.pathPrefix === '' || d.path === '/' || d.pathAdvancedPattern !== undefined
    || (d.pathPattern !== undefined && (claims(d, '/') || claims(d, '/anything-at-all'))) || !d.host);
  check('C17.1 every Android https intent entry names one path; there is no catch-all "/" prefix, root path or whole-site pattern',
    !app.error && filters.length > 0 && https.length > 0 && badEntries.length === 0,
    app.error ? `app.json unreadable: ${app.error}` : `filters=${filters.length} https=${https.length} bad=${JSON.stringify(badEntries)}`);

  // C17.2 No auth page is claimed on any registered host.
  const webOnly = ['/', '/accept-invite', '/reset-password', '/forgot-password', '/sign-in', '/sign-up', '/otp', '/sso/complete', '/sso/callback', '/sso/', '/o/acme/accept-invite', '/o/acme/reset-password', '/o/acme/sso/complete', '/o/acme/sign-in'];
  const claimedAuth = [];
  for (const host of hosts) for (const p of webOnly) if (https.some((d) => d.host === host && claims(d, p))) claimedAuth.push(`${host}${p}`);
  check('C17.2 no auth path (accept-invite, reset-password, forgot-password, sign-in, sign-up, otp, sso/*) or the site root is claimed on any host',
    hosts.length > 0 && claimedAuth.length === 0, `hosts=${JSON.stringify(hosts)} claimed=${claimedAuth.join(', ')}`);

  // C17.3 Positive control: the record paths the resolver opens are still claimed on both hosts (the reader is not vacuous).
  const P = 'a2153ef4-0bbb-4b9a-875c-44a0f69f9a12';
  const owned = ['/projects', `/projects/${P}/rfi`, '/tasks', '/inventory', `/o/acme/projects/${P}/rfi`];
  const missing = [];
  for (const host of ['app.octapm.com', 'octapm.com']) for (const p of owned) if (!https.some((d) => d.host === host && claims(d, p))) missing.push(`${host}${p}`);
  check('C17.3 control: the record paths the app opens stay claimed on app.octapm.com and octapm.com', missing.length === 0, `unclaimed=${missing.join(', ')}`);

  console.log('\n── C17 mobile: resolver and hand-off (static) ──');

  const deep = read(MOBILE, 'src/navigation/deepLinks.ts');
  const intent = read(MOBILE, 'app/+native-intent.ts');
  const webOnlyRoots = (code(deep).match(/const WEB_ONLY_ROOTS\s*=\s*\[([^\]]*)\]/) || [])[1] || '';
  const roots = (webOnlyRoots.match(/['"]([^'"]+)['"]/g) || []).map((s) => s.slice(1, -1));
  const resolverRefuses = /if\s*\(\s*WEB_ONLY_ROOTS\.includes\(\s*head\s*\)\s*&&\s*WEB_LINK\.test\(\s*input\.trim\(\)\s*\)\s*\)\s*return\s+null/.test(code(deep));
  const redirect = block(intent, /export function redirectSystemPath\([^\n]*\{[ \t]*$/m);
  const handTo = block(intent, /function handToBrowser\s*\(/);
  const handsOff = /if\s*\(\s*!resolved\s*\)\s*\{\s*handToBrowser\(\s*path\s*\)/.test(code(redirect));
  const fullUrl = /webHandoffUrl\(\s*path\s*,\s*env\.webOrigin\s*\)/.test(code(handTo)) && /WebBrowser\.openBrowserAsync\(\s*url\s*\)/.test(code(handTo));
  const handoffFn = block(deep, /export function webHandoffUrl\s*\(/);
  const returnsWhole = /return\s+registered\s*\|\|\s*origin\s*===\s*own\s*\?\s*url\s*:\s*null/.test(code(handoffFn)) && /const url\s*=\s*input\.trim\(\)/.test(code(handoffFn));
  check('C17.4 resolveLink refuses the web-only roots (accept-invite, reset-password, forgot-password, sso) on a web link',
    ['accept-invite', 'reset-password', 'forgot-password', 'sso'].every((r) => roots.includes(r)) && resolverRefuses,
    `WEB_ONLY_ROOTS=${JSON.stringify(roots)} refusalLine=${resolverRefuses}`);
  check('C17.5 redirectSystemPath hands an unresolved link to the browser (expo-web-browser) with the whole URL, query included',
    /import \* as WebBrowser from ['"]expo-web-browser['"]/.test(intent || '') && handsOff && fullUrl && returnsWhole,
    `handsOffWhenUnresolved=${handsOff} opensWebHandoffUrl=${fullUrl} handoffReturnsWholeUrl=${returnsWhole}`);

  console.log('\n── C17 mobile: unit tests ──');

  // C17.6 The unit tests carry the Q14 assertions (so a deleted test cannot pass silently).
  const deepTest = read(MOBILE, 'src/navigation/deepLinks.test.ts') || '';
  const intentTest = read(MOBILE, 'src/navigation/nativeIntent.test.ts') || '';
  const resolverAsserts = ['accept-invite', 'reset-password', 'forgot-password', 'sso/complete'].every((p) => new RegExp(`resolveLink\\(\`\\$\\{host\\}/${p.replace('/', '\\/')}[^)]*\\)\\)\\.toBeNull\\(\\)`).test(deepTest));
  const handoffAsserts = /expect\(opened\)\.toHaveBeenCalledWith\(url\)/.test(intentTest)
    && /handOff\(\s*['"`]https:\/\/app\.octapm\.com\/accept-invite\?token=[^'"`]+&[^'"`]+['"`]\s*\)/.test(intentTest)
    && /handOff\(\s*['"`]https:\/\/octapm\.com\/reset-password\?token=/.test(intentTest)
    && /handOff\(\s*['"`]https:\/\/app\.octapm\.com\/sso\/complete\?/.test(intentTest);
  const appJsonAsserts = /import appConfig from ['"]\.\.\/\.\.\/app\.json['"]/.test(intentTest) && /expect\(d\.pathPrefix\)\.not\.toBe\(['"]\/['"]\)/.test(intentTest);
  check('C17.6 the mobile unit tests assert the Q14 contract (resolver nulls, whole-URL hand-off, app.json claims)',
    resolverAsserts && handoffAsserts && appJsonAsserts,
    `resolverNulls=${resolverAsserts} handoffWithQuery=${handoffAsserts} appJsonStatic=${appJsonAsserts}`);

  // C17.7 Run them: jest from mobile/, both files, exit 0, no failures.
  const jestBin = path.join(MOBILE, 'node_modules', 'jest', 'bin', 'jest.js');
  let jest = { status: null, out: '', error: null };
  if (!fs.existsSync(jestBin)) {
    jest.error = `jest not found at ${jestBin}`;
  } else {
    const run = spawnSync(process.execPath, [jestBin, 'src/navigation/deepLinks.test.ts', 'src/navigation/nativeIntent.test.ts', '--ci', '--colors=false'], {
      cwd: MOBILE,
      env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
    jest = { status: run.status, out: `${run.stdout || ''}\n${run.stderr || ''}`, error: run.error ? run.error.message : null };
  }
  const suites = (jest.out.match(/Test Suites:\s*([^\n]*)/) || [])[1] || '';
  const tests = (jest.out.match(/Tests:\s*([^\n]*)/) || [])[1] || '';
  const suitesPassed = Number((suites.match(/(\d+) passed/) || [])[1] || 0);
  const testsPassed = Number((tests.match(/(\d+) passed/) || [])[1] || 0);
  const anyFailed = /\bfailed\b/.test(suites) || /\bfailed\b/.test(tests);
  const failLines = jest.out.split('\n').filter((l) => /●|✕|FAIL /.test(l)).slice(0, 12).join(' / ');
  check('C17.7 mobile deep-link unit tests (deepLinks.test.ts, nativeIntent.test.ts) run through jest and exit 0',
    jest.status === 0 && !jest.error && suitesPassed === 2 && testsPassed > 0 && !anyFailed,
    `exit=${jest.status} error=${jest.error || 'none'} suites="${suites}" tests="${tests}" ${failLines}`);
  console.log(`        jest: exit ${jest.status}; suites ${suites || '?'}; tests ${tests || '?'}`);

  if (results.length !== EXPECTED_CHECKS) {
    check(`fixed check count is ${EXPECTED_CHECKS}`, false, `ran ${results.length}`);
  }

  const failed = results.filter((r) => !r.ok);
  const summary = {
    proof: 'd-id-1-client-static-proof',
    checks: ['C9', 'C17 (static)'],
    ranAt: new Date().toISOString(),
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    jest: { exit: jest.status, suites, tests, error: jest.error },
    results,
  };
  try {
    fs.mkdirSync(RESULT_DIR, { recursive: true });
    fs.writeFileSync(RESULT_FILE, JSON.stringify(summary, null, 1));
  } catch (error) {
    console.error(`could not write ${RESULT_FILE}: ${error.message}`);
  }
  console.log(`\nd-id-1 client static proof: ${summary.passed} passed, ${summary.failed} failed of ${summary.total}`);
  process.exitCode = failed.length ? 2 : 0;
};

try {
  main();
} catch (error) {
  console.error(`SCRIPT ERROR: ${error.stack || error.message}`);
  process.exitCode = 1;
}
