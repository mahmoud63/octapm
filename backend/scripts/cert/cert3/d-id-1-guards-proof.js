'use strict';

/**
 * D-ID-1 round 2: the identity lock, the legacy shared suspension and the
 * emergency switch's full coverage (CERT-3 plan §2.8; the Codex diff review
 * C:\Temp\octapm-cert\scratch\did1-diff-codex-review.md, findings 4-8 and its
 * TEST GAPS "Credential-event concurrency", "Shared legacy suspension" and
 * "Complete emergency-switch coverage").
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/d-id-1-guards-proof.js [A=052] [B=025]
 *
 * In process (CERT_INPROCESS=1), on the certification database, through the
 * lock runner only. Throwaway people of a fresh stamp, made through the
 * product (invitation, then acceptance) unless marked "fixture".
 *
 * A  The identity lock (finding 4). Six people homed in A, each an active
 *    member of A only, each with a pending invitation from B (workspace-only,
 *    or to B's project 01 for the mid-flight cases), the three MFA subjects
 *    with two-factor on. The proof holds the product's own lock on a second
 *    connection and polls pg_locks for the ungranted waiters:
 *      queue orders: pg_advisory_xact_lock(hashtext('identity'), hashtext(P.id))
 *        held; the first operation is started and seen waiting on it, then the
 *        second; the lock is released and Postgres grants it in queue order;
 *      mid-flight: a row lock (FOR UPDATE) on B's project row, so P's
 *        acceptance stops at its project assignment with its B membership
 *        written but not committed, while holding the identity lock; A's
 *        operation is started and seen waiting on that identity lock.
 *    Deactivation by A and the admin MFA reset by A, each against B's
 *    acceptance, each in the three interleavings; the exact outcome of each is
 *    asserted (the code's order: acceptance takes (B, e-mail) then the
 *    identity lock, then holds the credential epoch FOR SHARE; deactivation
 *    takes (A, e-mail), suspends the A row, then the identity lock, then closes
 *    the identity only when no other present membership exists; the MFA reset
 *    takes the identity lock, then clears only when no other present
 *    membership exists). Never a closed identity or a cleared factor while a B
 *    membership exists.
 * B  Legacy shared suspension (finding 5). L homed in A, member of A and B;
 *    fixture: L's A membership row deleted (a legacy home member who is also a
 *    member elsewhere). A legacy A bearer (no `mid`) is minted after the
 *    deletion through POST /auth/workspaces/:A/session. A deactivates L: an A
 *    row is written SUSPENDED, the identity stays open, the legacy A bearer is
 *    refused, L still enters B.
 * C  The emergency switch (findings 6-8): with AUTH_MEMBERSHIP_WRITE=false (in
 *    process, restored in finally) a project user permission set and removed,
 *    a party template set, an assigned permission template edited, an unused
 *    one archived, a project made from a template that assigns people, and an
 *    operator's owner-recovery approval (operators with two-factor, as in the
 *    owner-recovery proof) each answer 503 MEMBERSHIP_WRITES_SUSPENDED and
 *    write nothing; removing someone from a project still works.
 *
 * Round 3 (the Codex diff review round 2,
 * C:\Temp\octapm-cert\scratch\did1-diff-codex-review-r2.md: items 4 and 6, N1,
 * R2 and its TEST GAPS; the fixes in did1-round3-fixes.md):
 * W  Workspace creation against identity-wide events (item 4). Four people
 *    homed in A, members of A only (two with two-factor on). The person's
 *    identity lock is held on the second connection; POST /organisations as
 *    the person (its own A bearer) and A's deactivation, or A's admin MFA
 *    reset, are queued on it in both orders and released. Creation first: the
 *    workspace exists with the person as its owner and the identity stays open
 *    (epoch unchanged) / the factor stays (403 IDENTITY_SHARED). Close or reset
 *    first: the identity is closed (epoch + 1) / the factor cleared, and the
 *    creation, authorised by a session that event ended, must be refused
 *    (401 SESSION_REVOKED or USER_INACTIVE, as the product refuses a stale
 *    session or a closed identity elsewhere) and write no workspace. Never a
 *    closed identity or a cleared factor while the person holds a membership
 *    outside A. The workspaces carry the certification naming rule
 *    ("CERT 931 ... (CERT-931)"); no product route deletes a workspace, so
 *    they stay, and G.fingerprint leaves CERT-931 out.
 * S  The emergency switch on the remaining paths (item 6), with
 *    AUTH_MEMBERSHIP_WRITE=false: PATCH /projects/:id/parties/:partyId
 *    changing the template, access level, role or permissions, or reopening a
 *    closed party, and PATCH /projects/:id carrying a widening party
 *    (project.service updateProject -> company-party.service
 *    syncProjectParties -> upsertProjectPartyWithTx) answer 503 and change no
 *    row; a contact edit and closing the party answer 200. A closed party is
 *    not found by id (404), so its reopening is tried through the upserts that
 *    find it by company and role (POST /parties, PATCH /projects/:id): 503.
 *    POST /integrations/api-clients answers 503 and makes no key; PATCH of a
 *    key's scopes, projectIds or expiresAt answers 503 and changes nothing; a
 *    rename and DELETE /integrations/api-clients/:id (the revocation) answer 200.
 * N  A role edit against a deactivation (N1). Three people homed in A as site
 *    engineers who are also members of B (a suspension in A leaves the
 *    identity open, so only the membership refuses the A bearer), one homed in
 *    A only. Queue orders on the (A, e-mail) lock held on the second
 *    connection; mid-flight: the person's A membership row held FOR UPDATE, so
 *    the role edit stops at its write while holding the (A, e-mail) lock, and
 *    the deactivation is seen waiting on that lock. The end is always
 *    suspended with role qs and the A bearer refused. The conditional write
 *    itself is proved in process: changeMembership reads the row itself, so it
 *    is handed a client whose organizationMembership.findFirst returns the row
 *    as read and, before returning it, has the person deactivated through the
 *    API: 409 MEMBERSHIP_CHANGED, nothing written.
 * R  Legacy suspension against acceptance (R2). Two people homed in A with no
 *    A row (fixture, as in B), members of B, each with a pending A project
 *    invitation; the (A, e-mail) lock held, the acceptance (own B bearer) and
 *    A's deactivation queued in both orders. Acceptance first: 200, then the
 *    deactivation suspends the row the acceptance wrote (200, no unique
 *    violation, no 5xx). Deactivation first: it writes the suspended row from
 *    legacy and revokes the link; the acceptance gets 400
 *    INVITATION_TOKEN_INVALID. Either way the legacy A bearer is refused.
 *
 * Round 4 (the Codex diff review round 3,
 * C:\Temp\octapm-cert\scratch\did1-diff-codex-review-r3.md; the fixes in
 * did1-round4-fixes.md):
 * P  A party contact edit against a concurrent closure. Three parties on A's
 *    project, each with an active guest member. The party row is held FOR
 *    UPDATE on the second connection; the contact edit (PATCH by id, or the
 *    upsert POST /parties that finds the party by company and role) is seen
 *    waiting on it (pg_stat_activity, pg_locks); the second connection then
 *    closes the party (status inactive, as a PATCH closure writes it, members
 *    kept) and commits. Switch off: the PATCH answers 404 and the upsert 503;
 *    switch on: the PATCH answers 404; the closure is never undone. Control:
 *    without the race both contact edits go through with the switch off.
 * U  Standing under the (A, e-mail) lock, as the population owner of A. With
 *    the switch off, a revoke queued before a grant whose pre-lock snapshot
 *    still shows administration: the grant is judged against the row under
 *    the lock and refused 503. With the switch on, a grant and a revoke queued
 *    on the lock end with the User mirror equal to the membership; with the
 *    person's User row also held FOR NO KEY UPDATE on a third connection, the
 *    grant is seen stopped at its mirror write while still holding the lock
 *    (the mirror is written in the standing change's own transaction).
 * O  Two owners of a throwaway company workspace (CERT-931 naming; its
 *    subscription written as a running trial, fixture) demote each other
 *    while the owners lock and both owner rows are held: one 200, one 409
 *    LAST_OWNER, exactly one owner left.
 * E  Legacy materialisation by a role edit against deactivation: three site
 *    engineers homed in A with no A row (fixture, as in B), members of B.
 *    Queue orders on the (A, e-mail) lock, and mid-flight: A's organisation
 *    row held FOR UPDATE stops the role edit at its materialising insert while
 *    it holds the (A, e-mail) lock. Always one A row, suspended; the legacy A
 *    bearer refused; no unique violation, no 5xx.
 * F  POST /organisations with the switch off: 503, no workspace written.
 *
 * Fixtures (SQL, throwaway people only): L's A membership row deleted, and the
 * same for the two R people (the product writes a suspended one back; restored
 * by SQL at the end only if it did not). Cleanup (finally, best effort):
 * pending invitations of the run revoked, the parties deleted, the templates
 * archived, any project of the run deleted, the run's API keys revoked, the
 * recovery target's grant (if any) removed and the target suspended through
 * the product, the environment restored. The W workspaces stay (see W).
 * Round 4 adds: the E people's A rows deleted (restored as in B); the P
 * closure written by SQL on the run's own parties (the concurrent closure the
 * race needs); the O workspace's trial (restored to its earlier state); the
 * race parties removed and any administration of the run revoked through the
 * product. The O and F workspaces stay, as the W ones.
 *
 * Exit 0 when every check holds, 2 otherwise.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const guard = require('../lib/cert-env');
// The application's database module reads DATABASE_URL when it first connects:
// the certification database, before anything under src/ is loaded.
process.env.DATABASE_URL = guard.certDatabaseUrl();
for (const name of ['JOB_WORKER_ENABLED', 'SCHEDULERS_ENABLED', 'EXCEPTIONS_ENGINE_ENABLED']) process.env[name] = 'false';
// The proof prints its own PASS/FAIL lines; the app's per-request log is off for this process.
process.env.REQUEST_LOG_FORMAT = 'off';

const crypto = require('crypto');
const fs = require('fs');
const api = require('../lib/api');
const invitations = require('../lib/invitations');
const { buildPopulation } = require('../lib/spec');
const fingerprint = require('../isolation/fingerprint');
const { totp } = require('../../../src/utils/totp');

invitations.captureMail({ quiet: true });

const NAME = 'd-id-1-guards';
const A_CODE = process.argv[2] || '052';
const B_CODE = process.argv[3] || '025';
const STATE_DIR = process.env.CERT_STATE_DIR || 'C:/Temp/octapm-cert/state';
const RESULT_DIR = 'C:/Temp/octapm-cert/results/cert3';
const STAMP = crypto.randomBytes(3).toString('hex');
const PASSWORD = process.env.CERT_PASSWORD;
const RUN_START = new Date();
const STEP_MS = 30_000;
/** How long a forced interleaving waits to see a waiter (Prisma's interactive transactions time out at 5 s). */
const WAIT_MS = 4_000;
const SWITCH_CODE = 'MEMBERSHIP_WRITES_SUSPENDED';
const SWITCH_MESSAGE = 'Adding people and widening access are paused';
const ENV_AT_START = { AUTH_MEMBERSHIP_WRITE: process.env.AUTH_MEMBERSHIP_WRITE, RECOVERY_OPERATOR_EMAILS: process.env.RECOVERY_OPERATOR_EMAILS };
/** The certification code the W workspaces carry in their name ("(CERT-931)") and so in their slug ("cert-931-..."). */
const WS_CODE = '931';
/** How the product refuses a request whose session a credential event ended, or whose identity is closed. */
const STALE_REFUSALS = ['401 SESSION_REVOKED', '401 USER_INACTIVE', '403 USER_INACTIVE'];
const IDENTITY_LOCK_SQL = "select pg_advisory_xact_lock(hashtext('identity'), hashtext($1::text))";
const ORG_EMAIL_LOCK_SQL = 'select pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))';

// ── the fixed list of checks ──────────────────────────────────────────────────
const PLAN = [
  ['A.setup', 'A setup: six people homed in A, each an active member of A only, each with a pending B invitation (two workspace-only and one to B\'s project per operation); the three MFA subjects have two-factor on'],
  ['A.deact.accept-first', 'A identity lock held: B acceptance queued first, then A\'s deactivation queued behind it (2 waiters); released: acceptance 200, deactivation 200; B membership active, A suspended, identity active, epoch unchanged, link accepted'],
  ['A.deact.deact-first', 'A identity lock held: A\'s deactivation queued first, then B acceptance (2 waiters); released: deactivation 200 closes the identity (inactive, epoch +1), acceptance 401 SESSION_REVOKED, no B membership, the B link still pending'],
  ['A.deact.midflight', 'A acceptance holds the identity lock with its B membership written but uncommitted (stopped on a row lock of B\'s project); A\'s deactivation waits on the identity lock; released: acceptance 200, deactivation 200, identity active, B active with the project assignment, A suspended'],
  ['A.mfa.accept-first', 'A identity lock held: B acceptance queued first, then A\'s admin MFA reset (2 waiters); released: acceptance 200, reset 403 IDENTITY_SHARED; factor, secret and epoch unchanged; B membership active'],
  ['A.mfa.reset-first', 'A identity lock held: A\'s admin MFA reset queued first, then B acceptance (2 waiters); released: reset 200 { reset: true }, factor cleared, epoch +1; acceptance 401 SESSION_REVOKED; no B membership; the link still pending'],
  ['A.mfa.midflight', 'A acceptance holds the identity lock with its B membership uncommitted; A\'s admin MFA reset waits on the identity lock; released: acceptance 200, reset 403 IDENTITY_SHARED, factor intact, B active with the project assignment'],
  ['A.invariant', 'A across the six interleavings no identity is closed and no factor cleared while a B membership exists'],
  ['B.setup', 'B setup: L homed in A, a member of B; fixture: L\'s A membership row deleted; a legacy A bearer (no mid) minted after the deletion is admitted (GET /auth/me 200, active A, no membership)'],
  ['B.suspend', 'B A deactivates L: 200; an A membership row now exists: suspended, member, role qs, no admin, no owner; audited membership.suspended from legacy; the identity stays active with the same epoch'],
  ['B.bearer', 'B the legacy A bearer is refused 401 USER_INACTIVE; a new A workspace session is refused 403 USER_INACTIVE; no unrevoked A refresh session remains'],
  ['B.enters-b', 'B L still enters B: the B bearer minted before still reads /auth/me (active B), a B refresh session survives, and a fresh sign-in lands in B'],
  ['C.setup', 'C setup: four permission templates; X on A\'s project with template T1; a party; a project template assigning X; operators op1 and op2 with two-factor; recovery target T an active member of A; op1\'s recovery request recorded'],
  ['C.setUserPermission', 'C switch off: PUT /projects/:id/team/:userId/permissions answers 503 MEMBERSHIP_WRITES_SUSPENDED; X\'s permission row is unchanged (template T1), no audit row'],
  ['C.removeUserPermission', 'C switch off: DELETE /projects/:id/team/:userId/permissions answers 503 MEMBERSHIP_WRITES_SUSPENDED; X\'s permission row is still there, unchanged, no audit row'],
  ['C.setPartyTemplate', 'C switch off: PUT /projects/:id/team/parties/:partyId/permissions answers 503 MEMBERSHIP_WRITES_SUSPENDED; the party\'s template is unchanged, no audit row'],
  ['C.updateTemplate', 'C switch off: PATCH /permissions/templates/:id of an assigned template answers 503 MEMBERSHIP_WRITES_SUSPENDED; name, description, status and tools unchanged, no audit row'],
  ['C.archiveTemplate', 'C switch off: DELETE /permissions/templates/:id answers 503 MEMBERSHIP_WRITES_SUSPENDED; the template stays active, no audit row'],
  ['C.projectFromTemplate', 'C switch off: POST /company/project-templates/:id/create-project (a template that assigns people) answers 503 MEMBERSHIP_WRITES_SUSPENDED; no Project row of that name, A\'s project count unchanged'],
  ['C.recovery', 'C switch off: op2 approving op1\'s owner-recovery request (operators verified) is refused 503 MEMBERSHIP_WRITES_SUSPENDED; no execution row, T neither owner nor administrator, no grant event; the refusal is audited'],
  ['C.removeMember', 'C switch off: DELETE /projects/:id/team/:userId still works: 200 { removed: true }; no assignment and no permission row left'],
  // ── round 3: the Codex diff review round 2 ──
  ['W.setup', 'W setup: four people homed in A, each an active member of A only (no membership anywhere else), each with its own A bearer; the two MFA subjects have two-factor on'],
  ['W.deact.create-first', 'W identity lock held: POST /organisations queued first, then A\'s deactivation (2 waiters); released: creation 201, deactivation 200; the new workspace exists with the person its active owner; identity active, epoch unchanged; A suspended'],
  ['W.deact.deact-first', `W identity lock held: A's deactivation queued first, then POST /organisations (2 waiters); released: deactivation 200 closes the identity (inactive, epoch +1); the creation is refused (${STALE_REFUSALS.join(' / ')}) and no workspace of that name and no membership outside A exist`],
  ['W.mfa.create-first', 'W identity lock held: POST /organisations queued first, then A\'s admin MFA reset (2 waiters); released: creation 201 (the person owns the workspace), reset 403 IDENTITY_SHARED; factor, secret and epoch unchanged'],
  ['W.mfa.reset-first', `W identity lock held: A's admin MFA reset queued first, then POST /organisations (2 waiters); released: reset 200 { reset: true }, factor cleared, epoch +1; the creation is refused (${STALE_REFUSALS.join(' / ')}) and no workspace of that name and no membership outside A exist`],
  ['W.invariant', 'W across the four interleavings no identity is closed and no factor cleared while the person holds a membership (active or suspended) outside A'],
  ['S.setup', 'S setup (switch on): a second party on A\'s project (subcontractor, collaborator, no template, no permissions), an external permission template, and an API key (*:read, A\'s project only, expiring in 30 days)'],
  ['S.party.template', 'S switch off: PATCH /projects/:id/parties/:partyId with a permissionTemplateId answers 503 MEMBERSHIP_WRITES_SUSPENDED; the party row is unchanged'],
  ['S.party.access', 'S switch off: PATCH /projects/:id/parties/:partyId with accessLevel admin answers 503 MEMBERSHIP_WRITES_SUSPENDED; the party row is unchanged'],
  ['S.party.role', 'S switch off: PATCH /projects/:id/parties/:partyId with role contractor answers 503 MEMBERSHIP_WRITES_SUSPENDED; the party row is unchanged'],
  ['S.party.permissions', 'S switch off: PATCH /projects/:id/parties/:partyId with permissions answers 503 MEMBERSHIP_WRITES_SUSPENDED; the party row is unchanged'],
  ['S.party.contact', 'S switch off: PATCH /projects/:id/parties/:partyId with only contactName answers 200; the contact name changed and nothing else'],
  ['S.project.parties', 'S switch off: PATCH /projects/:id carrying parties that widen the party (accessLevel admin) answers 503 MEMBERSHIP_WRITES_SUSPENDED; the project row, the party row and A\'s company count are unchanged'],
  ['S.party.close', 'S switch off: PATCH /projects/:id/parties/:partyId with status inactive answers 200; the party is inactive and nothing else changed'],
  ['S.party.reactivate', 'S switch off: the closed party cannot be reopened: PATCH /projects/:id/parties/:partyId {status: active} answers 404 PROJECT_PARTY_NOT_FOUND (a closed party is not found by id); the upserts that find it by company and role, POST /projects/:id/parties and PATCH /projects/:id {parties}, answer 503 MEMBERSHIP_WRITES_SUSPENDED; the party row is unchanged (still inactive), no second party of that company'],
  ['S.key.create', 'S switch off: POST /integrations/api-clients (*:write) answers 503 MEMBERSHIP_WRITES_SUSPENDED; no ApiClient row of that name'],
  ['S.key.scopes', 'S switch off: PATCH /integrations/api-clients/:id with scopes [*:write] answers 503 MEMBERSHIP_WRITES_SUSPENDED; the key row is unchanged'],
  ['S.key.projects', 'S switch off: PATCH /integrations/api-clients/:id with projectIds [] answers 503 MEMBERSHIP_WRITES_SUSPENDED; the key row is unchanged'],
  ['S.key.expiry', 'S switch off: PATCH /integrations/api-clients/:id with a later expiresAt answers 503 MEMBERSHIP_WRITES_SUSPENDED; the key row is unchanged'],
  ['S.key.name', 'S switch off: PATCH /integrations/api-clients/:id with only a name answers 200; the name changed, scopes, projects, expiry and status did not'],
  ['S.key.revoke', 'S switch off: DELETE /integrations/api-clients/:id (the revocation) answers 200; the key is revoked, its scopes, projects and expiry unchanged'],
  ['N.setup', 'N setup: three site engineers homed in A who are also active members of B, each with an admitted A bearer; a fourth homed in A only; every A row active, member, site_engineer, no admin, no owner'],
  ['N.edit-first', 'N (A, e-mail) lock held: PATCH /users/:id {role: qs} queued first, then the deactivation (2 waiters); released: role edit 200, deactivation 200; A row suspended with role qs, one role_changed event; identity active, epoch unchanged, B active; the A bearer refused 401 USER_INACTIVE'],
  ['N.deact-first', 'N (A, e-mail) lock held: the deactivation queued first, then PATCH /users/:id {role: qs} (2 waiters); released: deactivation 200, then the role edit 200 applied to the suspended row (role qs, status still suspended), one role_changed event; identity active, epoch unchanged, B active; the A bearer refused 401 USER_INACTIVE'],
  ['N.midflight', 'N the A membership row held FOR UPDATE: the role edit stops at its write holding the (A, e-mail) lock; the deactivation is seen waiting on that lock; released: role edit 200, deactivation 200; A row suspended with role qs; identity active, B active; the A bearer refused 401 USER_INACTIVE'],
  ['N.stale-read', 'N in process: changeMembership {role: qs} on a membership read as active, deactivated through the API between its read and its write, throws 409 MEMBERSHIP_CHANGED; the row stays suspended with role site_engineer, no role_changed event'],
  ['R.setup', 'R setup: two people homed in A, members of B; fixture: their A rows deleted; a legacy A bearer (no mid) admitted for each; a pending A project invitation for each'],
  ['R.accept-first', 'R (A, e-mail) lock held: the acceptance (own B bearer) queued first, then A\'s deactivation (2 waiters); released: acceptance 200, deactivation 200 (no unique violation, no 5xx); the A row the acceptance wrote is suspended (member, qs, no admin, no owner); link accepted; no A project assignment; identity active, epoch unchanged, B active; the legacy A bearer and any A token the acceptance returned refused 401'],
  ['R.deact-first', 'R (A, e-mail) lock held: A\'s deactivation queued first, then the acceptance (2 waiters); released: deactivation 200 writes the suspended A row from legacy (audited) and revokes the link; acceptance 400 INVITATION_TOKEN_INVALID; no A project assignment; identity active, epoch unchanged, B active; the legacy A bearer refused 401 USER_INACTIVE'],
  // ── round 4: the Codex diff review round 3 ──
  ['P.setup', 'P setup (switch on): three parties on A\'s project (subcontractor, collaborator, no template, no permissions), each with an active guest member (invited to the first party, added to the other two)'],
  ['P.control', 'P switch off, no race: a contact-only PATCH /projects/:id/parties/:partyId answers 200, and a contact-only upsert that finds a party by company and role (POST /projects/:id/parties) answers 201 with that party; only the contact name changed on each'],
  ['P.race.off', 'P switch off: the party row held FOR UPDATE on the second connection; a contact-only PATCH by id is seen waiting on it (pg_stat_activity and pg_locks); the second connection closes the party (status inactive) and commits; the edit answers 404 PROJECT_PARTY_NOT_FOUND; the party stays inactive, its contact name and every other field as the closure left them'],
  ['P.race.key', `P switch off: the same race on the upsert that finds the party by company and role (POST /projects/:id/parties, contact name only): it waits on the held row, then answers 503 ${SWITCH_CODE} (reopening is judged against the closed row); the party stays inactive and unchanged; still one party of that company`],
  ['P.race.on', 'P switch on: the same race on a contact-only PATCH by id: the edit answers 404 PROJECT_PARTY_NOT_FOUND and the closure is not undone (the party stays inactive, its contact name unchanged)'],
  ['U.setup', 'U setup: the population owner of A is an active owner; three throwaway people homed in A: one granted administration by the owner with the switch on (PATCH /users/:id 200; membership admin, User.isCompanyAdmin true), two site engineers without administration (membership and User.role site_engineer)'],
  ['U.admin-snapshot', `U switch off: the administrator's (A, e-mail) lock held; the owner's PATCH /users/:id {isCompanyAdmin: false} queued first, then {isCompanyAdmin: true}, which passes the pre-lock check against a snapshot that still shows administration (2 waiters); released: revoke 200, grant 503 ${SWITCH_CODE}; membership and User.isCompanyAdmin stay false; one admin_revoked event, no new admin_granted event`],
  ['U.mirror.queued', 'U switch on: the (A, e-mail) lock held; the owner\'s {isCompanyAdmin: true, role: planning_eng} queued first, then {isCompanyAdmin: false, role: qs} (2 waiters); released: both 200; the membership ends qs without administration and the User mirror equals it (role qs, isCompanyAdmin false)'],
  ['U.mirror.held', 'U switch on: the same queue with the person\'s User row held FOR NO KEY UPDATE on a third connection: once the lock is released the grant stops at its User mirror write still holding the (A, e-mail) lock (one session blocked by the row, the revoke still waiting on the lock, the committed membership as before: site_engineer, no administration); the row released: both 200, the membership qs without administration, the User mirror equal to it'],
  ['O.setup', `O setup: a throwaway person creates a company workspace (CERT-${WS_CODE} naming) and owns it (fixture: its subscription written as a running trial); a second joins it by invitation and is made owner by the first (PATCH /users/:id {isOwner: true} 200); the workspace has exactly two active owners`],
  ['O.race', 'O the workspace\'s owners lock (pg_advisory_xact_lock(hashtext(\'owners\'), hashtext(orgId))) and both owners\' membership rows held on the second connection; each owner demotes the other (PATCH /users/:id {isOwner: false}), both seen waiting on the owners lock; released: exactly one 200 and one 409 LAST_OWNER; the workspace has exactly one active owner, the actor of the demotion that succeeded'],
  ['E.setup', 'E setup: three site engineers homed in A who are also active members of B; fixture: their A rows deleted; a legacy A bearer (no mid) admitted for each; User.role site_engineer'],
  ['E.edit-first', 'E (A, e-mail) lock held: PATCH /users/:id {role: qs} (which materialises the missing A row) queued first, then the deactivation (2 waiters); released: role edit 200, deactivation 200 (no 5xx, no 409 CONFLICT); one A row: suspended, member, qs, no admin, no owner; User.role qs; identity active, epoch unchanged, B active; the legacy A bearer refused 401 USER_INACTIVE'],
  ['E.deact-first', 'E (A, e-mail) lock held: the deactivation queued first, then PATCH /users/:id {role: qs} (2 waiters); released: deactivation 200 writes the suspended row from legacy; the role edit applies to that row without reactivating it (200, role qs) or is refused 400/409 (not CONFLICT; role unchanged); one A row, suspended, no admin, no owner; identity active, epoch unchanged, B active; the legacy A bearer refused 401 USER_INACTIVE'],
  ['E.midflight', 'E A\'s organisation row held FOR UPDATE on the second connection: the role edit stops at its materialising insert while holding the (A, e-mail) lock; the deactivation is seen waiting on that lock; released: role edit 200, deactivation 200 (no unique violation, no 5xx); one A row, suspended with role qs; identity active, epoch unchanged, B active; the legacy A bearer refused 401 USER_INACTIVE'],
  ['F.create-off', `F switch off: POST /organisations (CERT-${WS_CODE} naming) by an active person answers 503 ${SWITCH_CODE}; no Organisation row of that name, the caller's memberships unchanged, no workspace.created event`],
  ['G.fingerprint', `no company other than A, B and the run's own CERT-${WS_CODE} workspaces changed during the run`],
  ['G.5xx', 'no answer was a 5xx other than the expected 503 MEMBERSHIP_WRITES_SUSPENDED'],
];
const EXPECTED_CHECKS = PLAN.length;
const recorded = new Map();
const check = (id, ok, detail = '') => {
  const entry = PLAN.find(([key]) => key === id);
  if (!entry) throw new Error(`unknown check ${id}`);
  if (recorded.has(id)) throw new Error(`check ${id} recorded twice`);
  recorded.set(id, { id, name: entry[1], ok: Boolean(ok), detail: ok ? undefined : String(detail).slice(0, 4000) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${entry[1]}${!ok && detail ? `\n        ${String(detail).slice(0, 1500)}` : ''}`);
};
const said = (res) => (res ? `${res.status} ${res.body?.error?.code || ''}`.trim() : 'no answer');
const answers = [];
const keep = (label, res) => {
  if (res && typeof res.status === 'number') answers.push({ label, status: res.status, code: res.body?.error?.code || null });
  return res;
};
const settle = (promise) => promise.catch((error) => ({ status: 0, body: { error: { code: `THROWN ${error.message}` } }, text: '' }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const decode = (jwt) => {
  try {
    return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

// ── authenticator codes: one per 30-second step and person (as the owner-recovery proof) ──
const counterNow = () => Math.floor(Date.now() / STEP_MS);
const nextCode = async (op) => {
  for (;;) {
    const now = counterNow();
    const step = Math.max(op.lastStep + 1, now);
    if (step <= now + 1) {
      op.lastStep = step;
      return totp(op.secret, { time: step * STEP_MS + 1 });
    }
    await sleep((step - 1) * STEP_MS - Date.now() + 750);
  }
};

// What the cleanup needs, filled in as the run makes it.
const ctx = {
  db: null,
  lockDb: null,
  sideOpen: false,
  runEmails: new Set(),
  partyId: null,
  projectA: null,
  teamMemberId: null,
  permissionTemplates: [],
  projectTemplates: [],
  projectNames: [],
  recoveryTarget: null,
  legacy: null,
  aPm: null,
  // round 3
  legacyMore: [],
  workspaceNames: [],
  partyCompanyNames: [],
  apiKeyNames: [],
  // round 4
  rowDb: null,
  rowOpen: false,
  aOwner: null,
  raceParties: [],
  adminsToRevoke: [],
  trialFixtures: [],
};

const main = async () => {
  if (!PASSWORD) throw new Error('CERT_PASSWORD is not set');
  if (process.env.CERT_INPROCESS !== '1') throw new Error('run through C:\\Temp\\octapm-cert\\run-locked.js (CERT_INPROCESS=1)');
  const { companies } = buildPopulation();
  const [A, B] = [A_CODE, B_CODE].map((code) => companies.find((c) => c.code === code));
  const db = await guard.connectCert();
  const lockDb = await guard.connectCert();
  ctx.db = db;
  ctx.lockDb = lockDb;
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const one = async (sql, params = []) => (await q(sql, params))[0] || null;
  const orgOf = async (code) => one('select id, name from "Organisation" where slug like $1', [`cert-${code}-%`]);
  const [orgA, orgB] = [await orgOf(A_CODE), await orgOf(B_CODE)];
  const aPm = api.as(`pm@${A.domain}`);
  const bPm = api.as(`pm@${B.domain}`);
  ctx.aPm = aPm;
  const inventory = (code) => JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'inventory', `${code}.json`), 'utf8'));
  const projectA = inventory(A.code).projects[`${A.code}-01`].id;
  const projectB = inventory(B.code).projects[`${B.code}-01`].id;
  ctx.projectA = projectA;
  const sidePid = (await lockDb.query('select pg_backend_pid() as pid')).rows[0].pid;
  console.log(`${NAME}: A ${A_CODE} (${orgA?.id}), B ${B_CODE} (${orgB?.id}); B project ${projectB}; stamp ${STAMP}; ${EXPECTED_CHECKS} checks\n`);
  const printBefore = await fingerprint.take(db);

  const mail = (label, domain) => {
    const email = `did1g.${label}.${STAMP}@${domain}`.toLowerCase();
    ctx.runEmails.add(email);
    return email;
  };
  const membershipIn = async (orgId, userId) => one('select id, role, status, kind, "isAdmin", "isOwner" from "OrganizationMembership" where "orgId" = $1 and "userId" = $2', [orgId, userId]);
  const userState = async (id) => one('select "orgId", status, "credentialEpoch" as epoch, "mfaEnabled", "mfaSecretEnc" from "User" where id = $1', [id]);

  // ── locks held on the second connection, and what Postgres says is waiting ──
  const sideBegin = async (sql, params) => {
    await lockDb.query('begin');
    ctx.sideOpen = true;
    await lockDb.query(sql, params);
  };
  const sideEnd = async (how) => {
    if (!ctx.sideOpen) return;
    ctx.sideOpen = false;
    await lockDb.query(how);
  };
  const IDENTITY_KEYS = `locktype = 'advisory' and objsubid = 2
      and database = (select oid from pg_database where datname = current_database())
      and classid::text::bigint = ((hashtext('identity')::bigint + 4294967296) % 4294967296)
      and objid::text::bigint = ((hashtext($1::text)::bigint + 4294967296) % 4294967296)`;
  // Requests waiting on, and sessions holding, the product's identity lock of one person.
  const identityWaiters = async (userId) => (await one(`select count(*)::int as n from pg_locks where not granted and ${IDENTITY_KEYS}`, [userId])).n;
  const identityHolders = async (userId) => (await one(`select count(*)::int as n from pg_locks where granted and ${IDENTITY_KEYS}`, [userId])).n;
  // Sessions blocked by the proof's second connection.
  const blockedBySide = async () => (await one('select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [sidePid])).n;
  const waitFor = async (probe, n, timeoutMs = WAIT_MS) => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const now = await probe();
      if (now >= n || Date.now() > until) return now;
      await sleep(30);
    }
  };
  // The (organisation, e-mail) lock invitations, acceptances, deactivations,
  // activations and role edits of one e-mail in one workspace take:
  // pg_advisory_xact_lock(hashtext(orgId), hashtext(email)).
  const ORG_EMAIL_KEYS = `locktype = 'advisory' and objsubid = 2
      and database = (select oid from pg_database where datname = current_database())
      and classid::text::bigint = ((hashtext($1::text)::bigint + 4294967296) % 4294967296)
      and objid::text::bigint = ((hashtext($2::text)::bigint + 4294967296) % 4294967296)`;
  const orgEmailWaiters = async (orgId, email) => (await one(`select count(*)::int as n from pg_locks where not granted and ${ORG_EMAIL_KEYS}`, [orgId, email])).n;
  const orgEmailHolders = async (orgId, email) => (await one(`select count(*)::int as n from pg_locks where granted and ${ORG_EMAIL_KEYS}`, [orgId, email])).n;
  // A lock held on the second connection; `first` started and seen waiting
  // (`waiters` reaches 1), then `second` (2); committed, Postgres grants in queue order.
  const queued = async ({ lockSql, lockParams, waiters, first, second }) => {
    await sideBegin(lockSql, lockParams);
    const p1 = first();
    const q1 = await waitFor(waiters, 1);
    const p2 = second();
    const q2 = await waitFor(waiters, 2);
    await sideEnd('commit');
    const [r1, r2] = await Promise.all([p1, p2]);
    return { q1, q2, r1, r2 };
  };

  const section = async (title, fn) => {
    console.log(`\n── ${title} ──`);
    try {
      await fn();
    } catch (error) {
      console.log(`SECTION ERROR (${title}): ${error.stack || error.message}`);
      if (ctx.sideOpen) {
        ctx.sideOpen = false;
        await lockDb.query('rollback').catch(() => null);
      }
      if (ctx.rowOpen) {
        ctx.rowOpen = false;
        await ctx.rowDb?.query('rollback').catch(() => null);
      }
    }
  };
  const makePerson = async (label, inviter, domain, role = 'qs', extra = {}) => {
    const p = { label, email: mail(label, domain), name: `DID1G ${label} ${STAMP}` };
    const made = await invitations.createByInvitation({ inviter, email: p.email, role, name: p.name, password: PASSWORD, db, ...extra });
    keep(`setup ${label} invite`, made.invited);
    keep(`setup ${label} accept`, made.accepted);
    p.id = made.userId;
    p.made = `${said(made.invited)} -> ${said(made.accepted)}`;
    return p;
  };
  const enableMfa = async (p, token) => {
    const setup = keep(`setup ${p.label} mfa`, await api.raw('POST', '/auth/mfa/setup', { token, json: {} }));
    p.secret = setup.body?.data?.secret || '';
    const step = counterNow();
    const enabled = keep(`setup ${p.label} mfa enable`, await api.raw('POST', '/auth/mfa/enable', { token, json: { code: totp(p.secret, { time: step * STEP_MS + 1 }) } }));
    p.lastStep = step;
    p.mfaOn = enabled.status === 200;
    return p.mfaOn;
  };

  // ════════════════════════════════════════════════════════════════════════════
  // A the identity lock
  // ════════════════════════════════════════════════════════════════════════════
  await section('A the identity lock', async () => {
    const subject = async (label, { mfa = false, project = false } = {}) => {
      const p = await makePerson(label, aPm, A.domain);
      p.mfa = mfa;
      if (!p.id) return p;
      // A bearer of P's own A session: the acceptance's proof. Enabling the
      // factor afterwards moves no credential epoch, so it stays valid.
      p.bearer = await api.tokenFor(p.email, orgA.id);
      if (mfa) await enableMfa(p, p.bearer);
      const before = invitations.mailsTo(p.email).length;
      const inv = keep(`setup ${label} B invites`, await bPm.send('POST', '/users/invitations', { email: p.email, role: 'qs', ...(project ? { projectId: projectB } : {}) }));
      p.invited = inv;
      p.invitationId = inv.status === 201 ? inv.body?.data?.id || null : null;
      p.link = p.invitationId ? await invitations.invitationTokenFor({ email: p.email, invitationId: p.invitationId, after: before, db }) : null;
      p.before = await userState(p.id);
      p.aBefore = await membershipIn(orgA.id, p.id);
      p.bBefore = await membershipIn(orgB.id, p.id);
      return p;
    };
    const D1 = await subject('id-d1');
    const D2 = await subject('id-d2');
    const D3 = await subject('id-d3', { project: true });
    const M1 = await subject('id-m1', { mfa: true });
    const M2 = await subject('id-m2', { mfa: true });
    const M3 = await subject('id-m3', { mfa: true, project: true });
    const all = [D1, D2, D3, M1, M2, M3];
    const setupOk = all.every((p) => p.id && p.bearer && p.link && p.invited?.status === 201 && p.before?.status === 'active' && p.before.orgId === orgA.id
      && p.aBefore?.status === 'active' && p.aBefore.kind === 'member' && !p.bBefore && (!p.mfa || (p.mfaOn && p.before.mfaEnabled === true && p.before.mfaSecretEnc)));
    check('A.setup', setupOk, all.map((p) => `${p.label}: ${p.made}; bearer ${Boolean(p.bearer)}; B invite ${said(p.invited)} link ${Boolean(p.link)}; user ${p.before?.status}/${p.before?.orgId === orgA.id}; A ${p.aBefore?.status}; B ${p.bBefore?.status || 'none'}; mfa ${p.mfa ? `${p.mfaOn}/${p.before?.mfaEnabled}` : '-'}`).join(' | '));
    if (!setupOk) throw new Error('setup A incomplete');
    await aPm.token();

    const acceptB = (p) => settle(api.raw('POST', '/auth/invitations/accept', { json: { token: p.link, name: p.name }, token: p.bearer })).then((r) => keep(`A ${p.label} accepts B`, r));
    const deactivate = (p) => settle(aPm.send('PATCH', `/users/${p.id}/deactivate`, {})).then((r) => keep(`A ${p.label} deactivated by A`, r));
    const resetMfa = (p) => settle(aPm.send('POST', `/company/security/users/${p.id}/mfa/reset`, {})).then((r) => keep(`A ${p.label} MFA reset by A`, r));
    const stateOf = async (p) => ({
      user: await userState(p.id),
      a: await membershipIn(orgA.id, p.id),
      b: await membershipIn(orgB.id, p.id),
      link: (await one('select status from "InvitationToken" where id = $1', [p.invitationId]))?.status || null,
      bAssigned: (await one('select count(*)::int as n from "ProjectAssignment" where "projectId" = $1 and "userId" = $2', [projectB, p.id])).n,
    });
    const show = (s) => `user ${s.user?.status} epoch ${s.user?.epoch} mfa ${s.user?.mfaEnabled}; A ${s.a?.status || 'none'}; B ${s.b?.status || 'none'}; link ${s.link}; B assignment ${s.bAssigned}`;

    // The person's identity lock held on the second connection; `first` started
    // and seen waiting on it, then `second`; released, Postgres grants in queue order.
    const ordered = async (p, first, second) => {
      await sideBegin("select pg_advisory_xact_lock(hashtext('identity'), hashtext($1::text))", [p.id]);
      const p1 = first(p);
      const q1 = await waitFor(() => identityWaiters(p.id), 1);
      const p2 = second(p);
      const q2 = await waitFor(() => identityWaiters(p.id), 2);
      await sideEnd('commit');
      const [r1, r2] = await Promise.all([p1, p2]);
      return { q1, q2, r1, r2 };
    };
    // B's project row held FOR UPDATE: P's acceptance passes the identity lock,
    // writes its B membership, and stops at the project assignment (its foreign
    // key needs a key-share lock on that row). A's operation is then started and
    // seen waiting on the identity lock the acceptance holds.
    const midflight = async (p, guardOp) => {
      await sideBegin('select id from "Project" where id = $1 for update', [projectB]);
      const pa = acceptB(p);
      const held = await waitFor(blockedBySide, 1);
      const heldIdentity = await identityHolders(p.id);
      const pg = guardOp(p);
      const queued = await waitFor(() => identityWaiters(p.id), 1);
      await sideEnd('rollback');
      const [ra, rg] = await Promise.all([pa, pg]);
      return { held, heldIdentity, queued, ra, rg };
    };
    const finals = [];

    // ── deactivation by A against B's acceptance ──
    const d1 = await ordered(D1, acceptB, deactivate);
    const s1 = await stateOf(D1);
    finals.push({ p: D1, s: s1 });
    check('A.deact.accept-first', d1.q1 >= 1 && d1.q2 >= 2 && d1.r1.status === 200 && d1.r2.status === 200
      && s1.b?.status === 'active' && s1.a?.status === 'suspended' && s1.user?.status === 'active' && s1.user.epoch === D1.before.epoch && s1.link === 'accepted',
      `waiters ${d1.q1}/${d1.q2}; acceptance ${said(d1.r1)}; deactivation ${said(d1.r2)}; ${show(s1)}; epoch before ${D1.before.epoch}`);

    const d2 = await ordered(D2, deactivate, acceptB);
    const s2 = await stateOf(D2);
    finals.push({ p: D2, s: s2 });
    check('A.deact.deact-first', d2.q1 >= 1 && d2.q2 >= 2 && d2.r1.status === 200 && said(d2.r2) === '401 SESSION_REVOKED'
      && s2.user?.status === 'inactive' && s2.user.epoch === D2.before.epoch + 1 && !s2.b && s2.a?.status === 'suspended' && s2.link === 'pending',
      `waiters ${d2.q1}/${d2.q2}; deactivation ${said(d2.r1)}; acceptance ${said(d2.r2)}; ${show(s2)}; epoch before ${D2.before.epoch}`);

    const d3 = await midflight(D3, deactivate);
    const s3 = await stateOf(D3);
    finals.push({ p: D3, s: s3 });
    check('A.deact.midflight', d3.held >= 1 && d3.heldIdentity === 1 && d3.queued >= 1 && d3.ra.status === 200 && d3.rg.status === 200
      && s3.user?.status === 'active' && s3.user.epoch === D3.before.epoch && s3.b?.status === 'active' && s3.bAssigned === 1 && s3.a?.status === 'suspended' && s3.link === 'accepted',
      `acceptance stopped on the row lock ${d3.held}, holding the identity lock ${d3.heldIdentity}; deactivation waiting on it ${d3.queued}; acceptance ${said(d3.ra)}; deactivation ${said(d3.rg)}; ${show(s3)}; epoch before ${D3.before.epoch}`);

    // ── admin MFA reset by A against B's acceptance ──
    const m1 = await ordered(M1, acceptB, resetMfa);
    const t1 = await stateOf(M1);
    finals.push({ p: M1, s: t1 });
    check('A.mfa.accept-first', m1.q1 >= 1 && m1.q2 >= 2 && m1.r1.status === 200 && said(m1.r2) === '403 IDENTITY_SHARED'
      && t1.user?.mfaEnabled === true && t1.user.mfaSecretEnc === M1.before.mfaSecretEnc && t1.user.epoch === M1.before.epoch && t1.user.status === 'active' && t1.b?.status === 'active' && t1.link === 'accepted',
      `waiters ${m1.q1}/${m1.q2}; acceptance ${said(m1.r1)}; reset ${said(m1.r2)}; ${show(t1)}; secret same ${t1.user?.mfaSecretEnc === M1.before.mfaSecretEnc}; epoch before ${M1.before.epoch}`);

    const m2 = await ordered(M2, resetMfa, acceptB);
    const t2 = await stateOf(M2);
    finals.push({ p: M2, s: t2 });
    check('A.mfa.reset-first', m2.q1 >= 1 && m2.q2 >= 2 && m2.r1.status === 200 && m2.r1.body?.data?.reset === true && said(m2.r2) === '401 SESSION_REVOKED'
      && t2.user?.mfaEnabled === false && t2.user.mfaSecretEnc === null && t2.user.epoch === M2.before.epoch + 1 && !t2.b && t2.link === 'pending',
      `waiters ${m2.q1}/${m2.q2}; reset ${said(m2.r1)} ${JSON.stringify(m2.r1.body?.data ?? null)}; acceptance ${said(m2.r2)}; ${show(t2)}; epoch before ${M2.before.epoch}`);

    const m3 = await midflight(M3, resetMfa);
    const t3 = await stateOf(M3);
    finals.push({ p: M3, s: t3 });
    check('A.mfa.midflight', m3.held >= 1 && m3.heldIdentity === 1 && m3.queued >= 1 && m3.ra.status === 200 && said(m3.rg) === '403 IDENTITY_SHARED'
      && t3.user?.mfaEnabled === true && t3.user.mfaSecretEnc === M3.before.mfaSecretEnc && t3.user.epoch === M3.before.epoch && t3.b?.status === 'active' && t3.bAssigned === 1,
      `acceptance stopped on the row lock ${m3.held}, holding the identity lock ${m3.heldIdentity}; reset waiting on it ${m3.queued}; acceptance ${said(m3.ra)}; reset ${said(m3.rg)}; ${show(t3)}`);

    const broken = finals.filter(({ p, s }) => {
      const bPresent = Boolean(s.b) && ['active', 'suspended'].includes(s.b.status);
      const closed = s.user?.status !== 'active';
      const cleared = p.mfa && (s.user?.mfaEnabled !== true || s.user.mfaSecretEnc !== p.before.mfaSecretEnc);
      return bPresent && (closed || cleared);
    });
    check('A.invariant', finals.length === 6 && broken.length === 0, `${finals.length} interleavings; broken: ${broken.map(({ p, s }) => `${p.label}: ${show(s)}`).join(' | ') || 'none'}`);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // B legacy shared suspension
  // ════════════════════════════════════════════════════════════════════════════
  await section('B legacy shared suspension', async () => {
    const L = await makePerson('legacy', aPm, A.domain);
    const joined = L.id ? await invitations.joinByInvitation({ inviter: bPm, email: L.email, role: 'qs', name: L.name, homeOrgId: orgA.id, db }) : null;
    keep('setup legacy B invite', joined?.invited);
    keep('setup legacy B accept', joined?.accepted);
    const bothBefore = L.id ? [await membershipIn(orgA.id, L.id), await membershipIn(orgB.id, L.id)] : [null, null];
    // L's own B session, minted while L is in A and B (sign-in, the identity token, B chosen).
    const bToken = L.id ? await api.tokenFor(L.email, orgB.id) : null;
    // Fixture: the A membership row goes, so L is a legacy home member of A who is also a member of B.
    const removed = L.id && bothBefore[0] ? await db.query('delete from "OrganizationMembership" where "orgId" = $1 and "userId" = $2', [orgA.id, L.id]) : { rowCount: 0 };
    ctx.legacy = { id: L.id, rowDeleted: removed.rowCount === 1 };
    const legacy = keep('B legacy A session', await api.raw('POST', `/auth/workspaces/${orgA.id}/session`, { token: bToken }));
    const legacyToken = legacy.body?.data?.tokens?.accessToken || null;
    const claims = decode(legacyToken);
    const meBefore = keep('B legacy bearer before', await api.raw('GET', '/auth/me', { token: legacyToken }));
    const uBefore = await userState(L.id);
    const aNow = await membershipIn(orgA.id, L.id);
    const bNow = await membershipIn(orgB.id, L.id);
    const setupOk = Boolean(L.id) && joined?.accepted?.status === 200 && bothBefore[0]?.status === 'active' && bothBefore[1]?.status === 'active' && Boolean(bToken)
      && removed.rowCount === 1 && !aNow && bNow?.status === 'active' && uBefore?.orgId === orgA.id && uBefore.status === 'active'
      && legacy.status === 200 && claims?.orgId === orgA.id && claims?.sub === L.id && !claims?.mid
      && meBefore.status === 200 && meBefore.body?.data?.active?.orgId === orgA.id && meBefore.body?.data?.active?.membershipId === null;
    check('B.setup', setupOk, `${L.made}; join ${said(joined?.invited)} -> ${said(joined?.accepted)}; before A ${bothBefore[0]?.status} B ${bothBefore[1]?.status}; fixture deleted ${removed.rowCount}; now A ${aNow?.status || 'none'} B ${bNow?.status}; user ${uBefore?.status} home A ${uBefore?.orgId === orgA.id}; legacy session ${said(legacy)} org ${claims?.orgId === orgA.id} mid ${claims?.mid || 'none'}; me ${said(meBefore)} ${JSON.stringify(meBefore.body?.data?.active ?? null)}`);
    if (!setupOk) throw new Error('setup B incomplete');

    const deact = keep('B A deactivates L', await aPm.send('PATCH', `/users/${L.id}/deactivate`, {}));
    const aRow = await membershipIn(orgA.id, L.id);
    const audited = (await one(`select count(*)::int as n from "AuthAuditEvent" where "orgId" = $1 and "userId" = $2 and "entityType" = 'membership' and action = 'membership.suspended' and "metadataJson"->>'from' = 'legacy'`, [orgA.id, L.id])).n;
    const uAfter = await userState(L.id);
    check('B.suspend', deact.status === 200 && aRow?.status === 'suspended' && aRow.kind === 'member' && aRow.role === 'qs' && aRow.isAdmin === false && aRow.isOwner === false
      && audited === 1 && uAfter?.status === 'active' && uAfter.epoch === uBefore.epoch,
      `${said(deact)}; A row ${JSON.stringify(aRow)}; audited ${audited}; identity ${uAfter?.status} epoch ${uBefore.epoch} -> ${uAfter?.epoch}`);

    const meAfter = keep('B legacy bearer after', await api.raw('GET', '/auth/me', { token: legacyToken }));
    const again = keep('B new A session', await api.raw('POST', `/auth/workspaces/${orgA.id}/session`, { token: bToken }));
    const live = async (orgId) => (await one('select count(*)::int as n from "RefreshSession" where "userId" = $1 and "orgId" = $2 and "revokedAt" is null', [L.id, orgId])).n;
    const liveA = await live(orgA.id);
    const liveB = await live(orgB.id);
    check('B.bearer', said(meAfter) === '401 USER_INACTIVE' && said(again) === '403 USER_INACTIVE' && liveA === 0,
      `legacy bearer ${said(meAfter)}; new A session ${said(again)}; unrevoked A refresh sessions ${liveA}`);

    const meB = keep('B bearer of B', await api.raw('GET', '/auth/me', { token: bToken }));
    api.forget(L.email);
    let fresh = null;
    let freshError = null;
    try {
      fresh = await api.signIn(L.email, orgB.id);
    } catch (error) {
      freshError = error.message;
    }
    const meFresh = fresh?.token ? keep('B fresh B session', await api.raw('GET', '/auth/me', { token: fresh.token })) : null;
    check('B.enters-b', meB.status === 200 && meB.body?.data?.active?.orgId === orgB.id && liveB >= 1 && fresh?.orgId === orgB.id && meFresh?.status === 200 && meFresh.body?.data?.active?.orgId === orgB.id,
      `B bearer ${said(meB)} ${JSON.stringify(meB.body?.data?.active ?? null)}; unrevoked B refresh sessions ${liveB}; fresh sign-in ${fresh ? `org B ${fresh.orgId === orgB.id}` : freshError}; ${meFresh ? `${said(meFresh)} ${JSON.stringify(meFresh.body?.data?.active ?? null)}` : ''}`);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // C the emergency switch
  // ════════════════════════════════════════════════════════════════════════════
  await section('C the emergency switch', async () => {
    const X = await makePerson('switch-member', aPm, A.domain);
    const T = await makePerson('recovery-target', aPm, A.domain);
    ctx.recoveryTarget = T.id ? { id: T.id } : null;
    const op1 = await makePerson('op1', bPm, B.domain);
    const op2 = await makePerson('op2', bPm, B.domain);
    for (const op of [op1, op2]) {
      if (!op.id) continue;
      await enableMfa(op, await api.tokenFor(op.email));
      api.forget(op.email);
    }
    const permissionTemplate = async (key, body) => {
      const name = `DID1G ${key} ${STAMP}`;
      const res = keep(`setup permission template ${key}`, await aPm.send('POST', '/permissions/templates', { name, ...body }));
      const id = res.status === 201 ? res.body?.data?.id || null : null;
      if (id) ctx.permissionTemplates.push(id);
      return { key, name, res, id };
    };
    const T1 = await permissionTemplate('t1', { kind: 'internal', baseRole: 'qs' });
    const T2 = await permissionTemplate('t2', { kind: 'internal', baseRole: 'site_engineer' });
    const T3 = await permissionTemplate('t3', { kind: 'external', basePartyRole: 'subcontractor' });
    const T4 = await permissionTemplate('t4', { kind: 'internal', baseRole: 'qs' });
    const team = X.id ? keep('setup X on the team', await aPm.send('POST', `/projects/${projectA}/team`, { userId: X.id })) : null;
    if (team?.status === 201 || team?.status === 200) ctx.teamMemberId = X.id;
    const perm = X.id && T1.id ? keep('setup X permission T1', await aPm.send('PUT', `/projects/${projectA}/team/${X.id}/permissions`, { templateId: T1.id })) : null;
    const party = keep('setup party', await aPm.send('POST', `/projects/${projectA}/parties`, { role: 'subcontractor', companyName: `DID1G Party ${STAMP}` }));
    const partyId = party.status === 201 ? party.body?.data?.id || null : null;
    ctx.partyId = partyId;
    const pt = X.id ? keep('setup project template', await aPm.send('POST', '/company/project-templates', { name: `DID1G template ${STAMP}`, assignments: [{ userId: X.id, role: 'qs' }] })) : null;
    const ptId = pt?.status === 201 ? pt.body?.data?.id || null : null;
    if (ptId) ctx.projectTemplates.push(ptId);
    process.env.RECOVERY_OPERATOR_EMAILS = [op1.email, op2.email].join(',');
    const recovery = require('../../../src/services/owner-recovery.service');
    let request = null;
    let requestError = null;
    if (op1.mfaOn && T.id) {
      try {
        request = await recovery.requestRecovery({ orgId: orgA.id, userId: T.id, ticket: `CERT-G-${STAMP}`, reason: `D-ID-1 guards proof, emergency switch coverage (${STAMP})`, operatorEmail: op1.email, totp: await nextCode(op1) });
      } catch (error) {
        requestError = `${error.status} ${error.code}`;
      }
    }
    const permRow = async () => one('select id, "templateId", "overridesJson"::text as overrides, "updatedAt"::text as at from "ProjectUserPermission" where "projectId" = $1 and "userId" = $2', [projectA, X.id]);
    const templateRow = async (id) => one('select name, description, status, "updatedAt"::text as at, (select count(*)::int from "PermissionTemplateTool" t where t."templateId" = p.id) as tools from "PermissionTemplate" p where p.id = $1', [id]);
    const partyRow = async () => one('select "permissionTemplateId", "updatedAt"::text as at from "ProjectParty" where id = $1', [partyId]);
    const auditFor = async (ids) => (await one('select count(*)::int as n from "AuthAuditEvent" where "entityId" = any($1::text[])', [ids.filter(Boolean)])).n;
    const tBefore = T.id ? await membershipIn(orgA.id, T.id) : null;
    const permBefore = X.id ? await permRow() : null;
    const setupOk = [X, T, op1, op2].every((p) => p.id) && op1.mfaOn && op2.mfaOn && [T1, T2, T3, T4].every((t) => t.id)
      && [200, 201].includes(team?.status) && perm?.status === 200 && permBefore?.templateId === T1.id && Boolean(partyId) && Boolean(ptId)
      && Boolean(request?.requestId) && tBefore?.status === 'active' && tBefore.kind === 'member' && tBefore.isOwner === false && tBefore.isAdmin === false;
    check('C.setup', setupOk, `people ${[X, T, op1, op2].map((p) => `${p.label} ${p.made}`).join(', ')}; mfa op1 ${op1.mfaOn} op2 ${op2.mfaOn}; templates ${[T1, T2, T3, T4].map((t) => `${t.key} ${said(t.res)}`).join(', ')}; team ${said(team)}; permission ${said(perm)} row ${permBefore?.templateId === T1.id}; party ${said(party)}; project template ${said(pt)}; request ${request?.requestId || requestError}; T ${JSON.stringify(tBefore)}`);
    if (!setupOk) throw new Error('setup C incomplete');

    await aPm.token();
    const off = (res) => said(res) === `503 ${SWITCH_CODE}`;
    const realConsoleError = console.error;
    let switchStacks = 0;
    const switchBefore = process.env.AUTH_MEMBERSHIP_WRITE;
    try {
      // The development error handler prints the stack of every 5xx; the switch's
      // expected 503s are counted here instead of printed.
      console.error = (...args) => {
        if (args.map(String).join(' ').includes(SWITCH_MESSAGE)) {
          switchStacks += 1;
          return;
        }
        realConsoleError(...args);
      };
      process.env.AUTH_MEMBERSHIP_WRITE = 'false';

      // A project user permission set and removed.
      const permAuditBefore = await auditFor([permBefore.id, `${projectA}:${X.id}`]);
      const setPerm = keep('C off set user permission', await aPm.send('PUT', `/projects/${projectA}/team/${X.id}/permissions`, { templateId: T2.id }));
      const permAfterSet = await permRow();
      const permAuditAfterSet = await auditFor([permBefore.id, `${projectA}:${X.id}`]);
      check('C.setUserPermission', off(setPerm) && JSON.stringify(permAfterSet) === JSON.stringify(permBefore) && permAuditAfterSet === permAuditBefore,
        `${said(setPerm)}; row ${JSON.stringify(permBefore)} -> ${JSON.stringify(permAfterSet)}; audit ${permAuditBefore} -> ${permAuditAfterSet}`);
      const removePerm = keep('C off remove user permission', await aPm.send('DELETE', `/projects/${projectA}/team/${X.id}/permissions`));
      const permAfterRemove = await permRow();
      const permAuditAfterRemove = await auditFor([permBefore.id, `${projectA}:${X.id}`]);
      check('C.removeUserPermission', off(removePerm) && JSON.stringify(permAfterRemove) === JSON.stringify(permBefore) && permAuditAfterRemove === permAuditBefore,
        `${said(removePerm)}; row ${JSON.stringify(permBefore)} -> ${JSON.stringify(permAfterRemove)}; audit ${permAuditBefore} -> ${permAuditAfterRemove}`);

      // A party template.
      const partyBefore = await partyRow();
      const partyAuditBefore = await auditFor([partyId]);
      const setParty = keep('C off set party template', await aPm.send('PUT', `/projects/${projectA}/team/parties/${partyId}/permissions`, { templateId: T3.id }));
      const partyAfter = await partyRow();
      const partyAuditAfter = await auditFor([partyId]);
      check('C.setPartyTemplate', off(setParty) && JSON.stringify(partyAfter) === JSON.stringify(partyBefore) && partyBefore?.permissionTemplateId !== T3.id && partyAuditAfter === partyAuditBefore,
        `${said(setParty)}; party ${JSON.stringify(partyBefore)} -> ${JSON.stringify(partyAfter)}; audit ${partyAuditBefore} -> ${partyAuditAfter}`);

      // An assigned template edited; an unused one archived.
      const t1Before = await templateRow(T1.id);
      const t1AuditBefore = await auditFor([T1.id]);
      const update = keep('C off update assigned template', await aPm.send('PATCH', `/permissions/templates/${T1.id}`, { name: `${T1.name} widened`, description: 'widened while the switch is off' }));
      const t1After = await templateRow(T1.id);
      const t1AuditAfter = await auditFor([T1.id]);
      check('C.updateTemplate', off(update) && JSON.stringify(t1After) === JSON.stringify(t1Before) && t1Before?.status === 'active' && t1AuditAfter === t1AuditBefore,
        `${said(update)}; template ${JSON.stringify(t1Before)} -> ${JSON.stringify(t1After)}; audit ${t1AuditBefore} -> ${t1AuditAfter}`);
      const t4Before = await templateRow(T4.id);
      const t4AuditBefore = await auditFor([T4.id]);
      const archive = keep('C off archive template', await aPm.send('DELETE', `/permissions/templates/${T4.id}`));
      const t4After = await templateRow(T4.id);
      const t4AuditAfter = await auditFor([T4.id]);
      check('C.archiveTemplate', off(archive) && t4After?.status === 'active' && JSON.stringify(t4After) === JSON.stringify(t4Before) && t4AuditAfter === t4AuditBefore,
        `${said(archive)}; template ${JSON.stringify(t4Before)} -> ${JSON.stringify(t4After)}; audit ${t4AuditBefore} -> ${t4AuditAfter}`);

      // A project made from a template that assigns people.
      const projectName = `DID1G project ${STAMP}`;
      ctx.projectNames.push(projectName);
      const projectsBefore = (await one('select count(*)::int as n from "Project" where "orgId" = $1', [orgA.id])).n;
      const fromTemplate = keep('C off project from template', await aPm.send('POST', `/company/project-templates/${ptId}/create-project`, { name: projectName }));
      const named = (await one('select count(*)::int as n from "Project" where name = $1', [projectName])).n;
      const projectsAfter = (await one('select count(*)::int as n from "Project" where "orgId" = $1', [orgA.id])).n;
      const madeAudit = (await one(`select count(*)::int as n from "AuthAuditEvent" where "entityId" = $1 and action = 'project_created'`, [ptId])).n;
      check('C.projectFromTemplate', off(fromTemplate) && named === 0 && projectsAfter === projectsBefore && madeAudit === 0,
        `${said(fromTemplate)}; projects named so ${named}; A projects ${projectsBefore} -> ${projectsAfter}; project_created audit ${madeAudit}`);

      // An operator's owner-recovery approval (op1 requested; op2 approves).
      let approval;
      try {
        approval = { ok: true, result: await recovery.approveRecovery({ requestId: request.requestId, operatorEmail: op2.email, totp: await nextCode(op2) }) };
        ctx.recoveryTarget.granted = true;
      } catch (error) {
        approval = { ok: false, status: error.status, code: error.code, message: error.message };
      }
      const executed = (await one(`select count(*)::int as n from "AuthAuditEvent" where "entityType" = 'owner_recovery' and action = 'owner_recovery.executed' and "metadataJson"->>'requestId' = $1`, [request.requestId])).n;
      const tAfter = await membershipIn(orgA.id, T.id);
      const grants = (await one(`select count(*)::int as n from "AuthAuditEvent" where "entityType" = 'membership' and "orgId" = $1 and "userId" = $2 and action in ('membership.owner_granted', 'membership.admin_granted')`, [orgA.id, T.id])).n;
      const refused = (await one(`select count(*)::int as n from "AuthAuditEvent" where "entityType" = 'owner_recovery' and action = 'owner_recovery.refused' and "metadataJson"->>'requestId' = $1 and "metadataJson"->>'step' = 'approve' and "metadataJson"->>'code' = $2`, [request.requestId, SWITCH_CODE])).n;
      check('C.recovery', !approval.ok && approval.status === 503 && approval.code === SWITCH_CODE && executed === 0 && JSON.stringify(tAfter) === JSON.stringify(tBefore) && grants === 0 && refused === 1,
        `${approval.ok ? `approved ${JSON.stringify(approval.result)}` : `${approval.status} ${approval.code}`}; executed rows ${executed}; T ${JSON.stringify(tBefore)} -> ${JSON.stringify(tAfter)}; grant events ${grants}; refusal audited ${refused}`);

      // Narrowing still works: X taken off the project.
      const removeMember = keep('C off remove from project', await aPm.send('DELETE', `/projects/${projectA}/team/${X.id}`));
      const assigned = (await one('select count(*)::int as n from "ProjectAssignment" where "projectId" = $1 and "userId" = $2', [projectA, X.id])).n;
      const permLeft = (await one('select count(*)::int as n from "ProjectUserPermission" where "projectId" = $1 and "userId" = $2', [projectA, X.id])).n;
      if (removeMember.status === 200) ctx.teamMemberId = null;
      check('C.removeMember', removeMember.status === 200 && removeMember.body?.data?.removed === true && assigned === 0 && permLeft === 0,
        `${said(removeMember)} ${JSON.stringify(removeMember.body?.data ?? null)}; assignments ${assigned}; permission rows ${permLeft}`);
    } finally {
      if (switchBefore === undefined) delete process.env.AUTH_MEMBERSHIP_WRITE;
      else process.env.AUTH_MEMBERSHIP_WRITE = switchBefore;
      console.error = realConsoleError;
      console.log(`        (${switchStacks} expected 503 stack traces from the development error handler not printed)`);
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // W workspace creation against identity-wide events (round 2, item 4)
  // ════════════════════════════════════════════════════════════════════════════
  await section('W workspace creation against identity-wide events', async () => {
    const outsideA = async (userId) => q('select "orgId"::text as "orgId", status, kind, "isOwner", "isAdmin" from "OrganizationMembership" where "userId" = $1 and "orgId" <> $2', [userId, orgA.id]);
    const subject = async (label, { mfa = false } = {}) => {
      const p = await makePerson(label, aPm, A.domain);
      p.mfa = mfa;
      p.wsName = `CERT ${WS_CODE} did1g ${label} ${STAMP} (CERT-${WS_CODE})`;
      ctx.workspaceNames.push(p.wsName);
      if (!p.id) return p;
      // The person's own A session: what authorises the creation.
      p.bearer = await api.tokenFor(p.email, orgA.id);
      if (mfa) await enableMfa(p, p.bearer);
      p.before = await userState(p.id);
      p.aBefore = await membershipIn(orgA.id, p.id);
      p.outsideBefore = await outsideA(p.id);
      return p;
    };
    const W1 = await subject('ws-d1');
    const W2 = await subject('ws-d2');
    const W3 = await subject('ws-m1', { mfa: true });
    const W4 = await subject('ws-m2', { mfa: true });
    const all = [W1, W2, W3, W4];
    const setupOk = all.every((p) => p.id && p.bearer && p.before?.status === 'active' && p.before.orgId === orgA.id && p.aBefore?.status === 'active' && p.aBefore.kind === 'member'
      && p.outsideBefore.length === 0 && (!p.mfa || (p.mfaOn && p.before.mfaEnabled === true && p.before.mfaSecretEnc)));
    check('W.setup', setupOk, all.map((p) => `${p.label}: ${p.made}; bearer ${Boolean(p.bearer)}; user ${p.before?.status}/${p.before?.orgId === orgA.id}; A ${p.aBefore?.status}; outside A ${p.outsideBefore?.length}; mfa ${p.mfa ? `${p.mfaOn}/${p.before?.mfaEnabled}` : '-'}`).join(' | '));
    if (!setupOk) throw new Error('setup W incomplete');
    await aPm.token();

    const createWs = (p) => settle(api.raw('POST', '/organisations', { token: p.bearer, json: { name: p.wsName } })).then((r) => keep(`W ${p.label} creates a workspace`, r));
    const deactivate = (p) => settle(aPm.send('PATCH', `/users/${p.id}/deactivate`, {})).then((r) => keep(`W ${p.label} deactivated by A`, r));
    const resetMfa = (p) => settle(aPm.send('POST', `/company/security/users/${p.id}/mfa/reset`, {})).then((r) => keep(`W ${p.label} MFA reset by A`, r));
    const identityQueue = (p, first, second) => queued({ lockSql: IDENTITY_LOCK_SQL, lockParams: [p.id], waiters: () => identityWaiters(p.id), first: () => first(p), second: () => second(p) });
    const wsState = async (p) => {
      const orgs = await q('select id::text as id from "Organisation" where name = $1', [p.wsName]);
      const outside = await outsideA(p.id);
      return {
        user: await userState(p.id),
        a: await membershipIn(orgA.id, p.id),
        orgs,
        outside,
        owner: orgs.length === 1 ? outside.find((m) => m.orgId === orgs[0].id) || null : null,
      };
    };
    const showW = (s) => `user ${s.user?.status} epoch ${s.user?.epoch} mfa ${s.user?.mfaEnabled}; A ${s.a?.status || 'none'}; workspaces of that name ${s.orgs.length}; memberships outside A: ${s.outside.map((m) => `${m.status}${m.isOwner ? ' owner' : ''}`).join(', ') || 'none'}`;
    const createdOk = (r, s) => r.status === 201 && s.orgs.length === 1 && r.body?.data?.organisation?.id === s.orgs[0].id && s.owner?.status === 'active' && s.owner.isOwner === true;
    const notCreated = (r, s) => STALE_REFUSALS.includes(said(r)) && s.orgs.length === 0 && s.outside.length === 0;
    const finals = [];

    // ── deactivation by A against the creation ──
    const w1 = await identityQueue(W1, createWs, deactivate);
    const s1 = await wsState(W1);
    finals.push({ p: W1, s: s1 });
    check('W.deact.create-first', w1.q1 >= 1 && w1.q2 >= 2 && createdOk(w1.r1, s1) && w1.r2.status === 200
      && s1.user?.status === 'active' && s1.user.epoch === W1.before.epoch && s1.a?.status === 'suspended',
      `waiters ${w1.q1}/${w1.q2}; creation ${said(w1.r1)}; deactivation ${said(w1.r2)}; ${showW(s1)}; epoch before ${W1.before.epoch}`);

    const w2 = await identityQueue(W2, deactivate, createWs);
    const s2 = await wsState(W2);
    finals.push({ p: W2, s: s2 });
    check('W.deact.deact-first', w2.q1 >= 1 && w2.q2 >= 2 && w2.r1.status === 200
      && s2.user?.status === 'inactive' && s2.user.epoch === W2.before.epoch + 1 && s2.a?.status === 'suspended' && notCreated(w2.r2, s2),
      `waiters ${w2.q1}/${w2.q2}; deactivation ${said(w2.r1)}; creation ${said(w2.r2)}${w2.r2.status === 201 ? ` (workspace ${w2.r2.body?.data?.organisation?.id} made after the identity was closed)` : ''}; ${showW(s2)}; epoch before ${W2.before.epoch}`);

    // ── admin MFA reset by A against the creation ──
    const w3 = await identityQueue(W3, createWs, resetMfa);
    const s3 = await wsState(W3);
    finals.push({ p: W3, s: s3 });
    check('W.mfa.create-first', w3.q1 >= 1 && w3.q2 >= 2 && createdOk(w3.r1, s3) && said(w3.r2) === '403 IDENTITY_SHARED'
      && s3.user?.mfaEnabled === true && s3.user.mfaSecretEnc === W3.before.mfaSecretEnc && s3.user.epoch === W3.before.epoch && s3.user.status === 'active',
      `waiters ${w3.q1}/${w3.q2}; creation ${said(w3.r1)}; reset ${said(w3.r2)}; ${showW(s3)}; secret same ${s3.user?.mfaSecretEnc === W3.before.mfaSecretEnc}; epoch before ${W3.before.epoch}`);

    const w4 = await identityQueue(W4, resetMfa, createWs);
    const s4 = await wsState(W4);
    finals.push({ p: W4, s: s4 });
    check('W.mfa.reset-first', w4.q1 >= 1 && w4.q2 >= 2 && w4.r1.status === 200 && w4.r1.body?.data?.reset === true
      && s4.user?.mfaEnabled === false && s4.user.mfaSecretEnc === null && s4.user.epoch === W4.before.epoch + 1 && notCreated(w4.r2, s4),
      `waiters ${w4.q1}/${w4.q2}; reset ${said(w4.r1)} ${JSON.stringify(w4.r1.body?.data ?? null)}; creation ${said(w4.r2)}${w4.r2.status === 201 ? ` (workspace ${w4.r2.body?.data?.organisation?.id} made after the factor was cleared)` : ''}; ${showW(s4)}; epoch before ${W4.before.epoch}`);

    const broken = finals.filter(({ p, s }) => {
      const elsewhere = s.outside.some((m) => ['active', 'suspended'].includes(m.status));
      const closed = s.user?.status !== 'active';
      const cleared = p.mfa && (s.user?.mfaEnabled !== true || s.user.mfaSecretEnc !== p.before.mfaSecretEnc);
      return elsewhere && (closed || cleared);
    });
    check('W.invariant', finals.length === 4 && broken.length === 0, `${finals.length} interleavings; broken: ${broken.map(({ p, s }) => `${p.label}: ${showW(s)}`).join(' | ') || 'none'}`);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // S the emergency switch: party updates and API keys (round 2, item 6)
  // ════════════════════════════════════════════════════════════════════════════
  await section('S the emergency switch: party updates and API keys', async () => {
    const partyCompany = `DID1G Party2 ${STAMP}`;
    ctx.partyCompanyNames.push(partyCompany);
    const created = keep('S setup party', await aPm.send('POST', `/projects/${projectA}/parties`, { role: 'subcontractor', companyName: partyCompany }));
    const partyId = created.status === 201 ? created.body?.data?.id || null : null;
    const tpl = keep('S setup permission template', await aPm.send('POST', '/permissions/templates', { name: `DID1G t5 ${STAMP}`, kind: 'external', basePartyRole: 'subcontractor' }));
    const tplId = tpl.status === 201 ? tpl.body?.data?.id || null : null;
    if (tplId) ctx.permissionTemplates.push(tplId);
    const keyName = `DID1G key ${STAMP}`;
    ctx.apiKeyNames.push(keyName);
    const keyMade = keep('S setup API key', await aPm.send('POST', '/integrations/api-clients', { name: keyName, scopes: ['*:read'], projectIds: [projectA], expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() }));
    const keyId = keyMade.status === 201 ? keyMade.body?.data?.id || null : null;

    const partyRow = async () => (await one('select row_to_json(p)::text as row from "ProjectParty" p where id = $1', [partyId]))?.row || null;
    const partyFields = async () => one('select role::text as role, "accessLevel", "permissionProfile", "permissionsJson"::text as perms, "permissionTemplateId", status, "contactName", "companyId" from "ProjectParty" where id = $1', [partyId]);
    const keyRow = async () => (await one('select row_to_json(k)::text as row from "ApiClient" k where id = $1', [keyId]))?.row || null;
    const keyFields = async () => one('select name, scopes, "projectIds", "expiresAt"::text as "expiresAt", status, "revokedAt"::text as "revokedAt" from "ApiClient" where id = $1', [keyId]);
    const projectRow = async () => (await one('select row_to_json(p)::text as row from "Project" p where id = $1', [projectA]))?.row || null;
    const companyCount = async () => (await one('select count(*)::int as n from "Company" where "orgId" = $1', [orgA.id])).n;
    const without = (row, ...keys) => JSON.stringify(Object.fromEntries(Object.entries(row || {}).filter(([k]) => !keys.includes(k))));
    const pStart = partyId ? await partyFields() : null;
    const kStart = keyId ? await keyFields() : null;
    const setupOk = Boolean(partyId) && Boolean(tplId) && Boolean(keyId)
      && pStart?.status === 'active' && pStart.role === 'subcontractor' && pStart.accessLevel === 'collaborator' && pStart.permissionTemplateId === null && pStart.perms === '{}'
      && kStart?.status === 'active' && JSON.stringify(kStart.scopes) === '["*:read"]' && JSON.stringify(kStart.projectIds) === JSON.stringify([projectA]) && Boolean(kStart.expiresAt);
    check('S.setup', setupOk, `party ${said(created)} ${JSON.stringify(pStart)}; template ${said(tpl)}; key ${said(keyMade)} ${JSON.stringify(kStart)}`);
    if (!setupOk) throw new Error('setup S incomplete');

    await aPm.token();
    const off = (res) => said(res) === `503 ${SWITCH_CODE}`;
    const realConsoleError = console.error;
    let switchStacks = 0;
    const switchBefore = process.env.AUTH_MEMBERSHIP_WRITE;
    try {
      console.error = (...args) => {
        if (args.map(String).join(' ').includes(SWITCH_MESSAGE)) {
          switchStacks += 1;
          return;
        }
        realConsoleError(...args);
      };
      process.env.AUTH_MEMBERSHIP_WRITE = 'false';

      // ── the party: PATCH /projects/:id/parties/:partyId ──
      const patchParty = (label, body) => aPm.send('PATCH', `/projects/${projectA}/parties/${partyId}`, body).then((r) => keep(label, r));
      const partyRefused = async (id, label, body) => {
        const before = await partyRow();
        const res = await patchParty(label, body);
        const after = await partyRow();
        check(id, off(res) && before !== null && after === before, `${said(res)}; row ${after === before ? 'unchanged' : `${before} -> ${after}`}`);
      };
      await partyRefused('S.party.template', 'S off party template', { permissionTemplateId: tplId });
      await partyRefused('S.party.access', 'S off party access level', { accessLevel: 'admin' });
      await partyRefused('S.party.role', 'S off party role', { role: 'contractor' });
      await partyRefused('S.party.permissions', 'S off party permissions', { permissions: { rfis: ['read', 'create', 'update', 'delete'] } });

      const cBefore = await partyFields();
      const contactName = `DID1G contact ${STAMP}`;
      const contact = await patchParty('S off party contact', { contactName });
      const cAfter = await partyFields();
      check('S.party.contact', contact.status === 200 && cAfter?.contactName === contactName && without(cAfter, 'contactName') === without(cBefore, 'contactName'),
        `${said(contact)}; ${JSON.stringify(cBefore)} -> ${JSON.stringify(cAfter)}`);

      // ── the party through the project: PATCH /projects/:id { parties } ──
      const prBefore = await projectRow();
      const ptBefore = await partyRow();
      const coBefore = await companyCount();
      const viaProject = keep('S off project parties', await aPm.send('PATCH', `/projects/${projectA}`, { parties: [{ role: 'subcontractor', companyName: partyCompany, accessLevel: 'admin' }] }));
      const prAfter = await projectRow();
      const ptAfter = await partyRow();
      const coAfter = await companyCount();
      check('S.project.parties', off(viaProject) && prAfter === prBefore && ptAfter === ptBefore && coAfter === coBefore,
        `${said(viaProject)}; project row ${prAfter === prBefore ? 'unchanged' : 'CHANGED'}; party row ${ptAfter === ptBefore ? 'unchanged' : `${ptBefore} -> ${ptAfter}`}; A companies ${coBefore} -> ${coAfter}`);

      // ── closing the party, then reopening it ──
      const kBeforeClose = await partyFields();
      const close = await patchParty('S off party close', { status: 'inactive' });
      const closed = await partyFields();
      check('S.party.close', close.status === 200 && closed?.status === 'inactive' && without(closed, 'status') === without(kBeforeClose, 'status'),
        `${said(close)}; ${JSON.stringify(kBeforeClose)} -> ${JSON.stringify(closed)}`);
      // A closed party is not found by id (assertProjectParty reads active
      // parties only), so it is reopened through the upserts that find it by
      // (project, company, role): POST /parties and PATCH /projects/:id.
      const reopenBefore = await partyRow();
      const reopenById = await patchParty('S off party reactivate (PATCH by id)', { status: 'active' });
      const reopenPost = keep('S off party reactivate (POST upsert)', await aPm.send('POST', `/projects/${projectA}/parties`, { role: 'subcontractor', companyName: partyCompany }));
      const reopenProject = keep('S off party reactivate (project PATCH)', await aPm.send('PATCH', `/projects/${projectA}`, { parties: [{ role: 'subcontractor', companyName: partyCompany }] }));
      const reopenAfter = await partyRow();
      const stillClosed = (await partyFields())?.status;
      const ofCompany = (await one('select count(*)::int as n from "ProjectParty" p join "Company" c on c.id = p."companyId" where p."projectId" = $1 and c.name = $2', [projectA, partyCompany])).n;
      check('S.party.reactivate', said(reopenById) === '404 PROJECT_PARTY_NOT_FOUND' && off(reopenPost) && off(reopenProject)
        && reopenBefore !== null && reopenAfter === reopenBefore && stillClosed === 'inactive' && ofCompany === 1,
        `PATCH by id ${said(reopenById)}; POST upsert ${said(reopenPost)}; project PATCH ${said(reopenProject)}; row ${reopenAfter === reopenBefore ? 'unchanged' : `${reopenBefore} -> ${reopenAfter}`}; status ${stillClosed}; parties of that company ${ofCompany}`);

      // ── API keys ──
      const key2 = `DID1G key2 ${STAMP}`;
      ctx.apiKeyNames.push(key2);
      const createKey = keep('S off key create', await aPm.send('POST', '/integrations/api-clients', { name: key2, scopes: ['*:write'] }));
      const madeKeys = (await one('select count(*)::int as n from "ApiClient" where name = $1', [key2])).n;
      check('S.key.create', off(createKey) && madeKeys === 0, `${said(createKey)}; ApiClient rows named so ${madeKeys}`);

      const patchKey = (label, body) => aPm.send('PATCH', `/integrations/api-clients/${keyId}`, body).then((r) => keep(label, r));
      const keyRefused = async (id, label, body) => {
        const before = await keyRow();
        const res = await patchKey(label, body);
        const after = await keyRow();
        check(id, off(res) && before !== null && after === before, `${said(res)}; row ${after === before ? 'unchanged' : `${before} -> ${after}`}`);
      };
      await keyRefused('S.key.scopes', 'S off key scopes', { scopes: ['*:write'] });
      await keyRefused('S.key.projects', 'S off key projects', { projectIds: [] });
      await keyRefused('S.key.expiry', 'S off key expiry', { expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString() });

      const nBefore = await keyFields();
      const renamed = `DID1G key renamed ${STAMP}`;
      ctx.apiKeyNames.push(renamed);
      const rename = await patchKey('S off key rename', { name: renamed });
      const nAfter = await keyFields();
      check('S.key.name', rename.status === 200 && nAfter?.name === renamed && nAfter.status === 'active' && without(nAfter, 'name') === without(nBefore, 'name'),
        `${said(rename)}; ${JSON.stringify(nBefore)} -> ${JSON.stringify(nAfter)}`);

      const rBefore = await keyFields();
      const revoke = keep('S off key revoke', await aPm.send('DELETE', `/integrations/api-clients/${keyId}`));
      const rAfter = await keyFields();
      check('S.key.revoke', revoke.status === 200 && rAfter?.status === 'revoked' && Boolean(rAfter.revokedAt) && without(rAfter, 'status', 'revokedAt') === without(rBefore, 'status', 'revokedAt'),
        `${said(revoke)}; ${JSON.stringify(rBefore)} -> ${JSON.stringify(rAfter)}`);
    } finally {
      if (switchBefore === undefined) delete process.env.AUTH_MEMBERSHIP_WRITE;
      else process.env.AUTH_MEMBERSHIP_WRITE = switchBefore;
      console.error = realConsoleError;
      console.log(`        (${switchStacks} expected 503 stack traces from the development error handler not printed)`);
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // N a role edit against a deactivation (round 2, N1)
  // ════════════════════════════════════════════════════════════════════════════
  await section('N role edit against deactivation', async () => {
    const shared = async (label) => {
      const p = await makePerson(label, aPm, A.domain, 'site_engineer');
      if (!p.id) return p;
      const joined = await invitations.joinByInvitation({ inviter: bPm, email: p.email, role: 'qs', name: p.name, homeOrgId: orgA.id, db });
      keep(`setup ${label} B invite`, joined?.invited);
      keep(`setup ${label} B accept`, joined?.accepted);
      p.joined = `${said(joined?.invited)} -> ${said(joined?.accepted)}`;
      p.joinedOk = joined?.accepted?.status === 200;
      p.bearer = await api.tokenFor(p.email, orgA.id);
      p.before = await userState(p.id);
      p.aBefore = await membershipIn(orgA.id, p.id);
      p.bBefore = await membershipIn(orgB.id, p.id);
      p.meBefore = keep(`setup ${label} A bearer`, await api.raw('GET', '/auth/me', { token: p.bearer }));
      return p;
    };
    const N1 = await shared('n1-edit-first');
    const N2 = await shared('n1-deact-first');
    const N3 = await shared('n1-midflight');
    const N4 = await makePerson('n1-stale', aPm, A.domain, 'site_engineer');
    if (N4.id) N4.aBefore = await membershipIn(orgA.id, N4.id);
    const engineer = (m) => m?.status === 'active' && m.kind === 'member' && m.role === 'site_engineer' && m.isAdmin === false && m.isOwner === false;
    const setupOk = [N1, N2, N3].every((p) => p.id && p.joinedOk && p.bearer && engineer(p.aBefore) && p.bBefore?.status === 'active'
      && p.before?.status === 'active' && p.before.orgId === orgA.id && p.meBefore?.status === 200 && p.meBefore.body?.data?.active?.orgId === orgA.id)
      && Boolean(N4.id) && engineer(N4.aBefore);
    check('N.setup', setupOk, [N1, N2, N3].map((p) => `${p.label}: ${p.made}; B ${p.joined}; A ${JSON.stringify(p.aBefore)}; B ${p.bBefore?.status}; user ${p.before?.status}; me ${said(p.meBefore)}`).join(' | ') + ` | ${N4.label}: ${N4.made}; A ${JSON.stringify(N4.aBefore)}`);
    if (!setupOk) throw new Error('setup N incomplete');
    await aPm.token();

    const roleEdit = (p) => settle(aPm.send('PATCH', `/users/${p.id}`, { role: 'qs' })).then((r) => keep(`N ${p.label} role edit`, r));
    const deactivate = (p) => settle(aPm.send('PATCH', `/users/${p.id}/deactivate`, {})).then((r) => keep(`N ${p.label} deactivated by A`, r));
    const roleEvents = async (userId) => (await one(`select count(*)::int as n from "AuthAuditEvent" where "orgId" = $1 and "userId" = $2 and "entityType" = 'membership' and action = 'membership.role_changed'`, [orgA.id, userId])).n;
    const nState = async (p) => ({
      user: await userState(p.id),
      a: await membershipIn(orgA.id, p.id),
      b: await membershipIn(orgB.id, p.id),
      roleEvents: await roleEvents(p.id),
      me: keep(`N ${p.label} A bearer after`, await api.raw('GET', '/auth/me', { token: p.bearer })),
    });
    const showN = (s) => `A ${s.a ? `${s.a.status}/${s.a.role}` : 'none'}; B ${s.b?.status || 'none'}; user ${s.user?.status} epoch ${s.user?.epoch}; role_changed events ${s.roleEvents}; A bearer ${said(s.me)}`;
    const endsSuspended = (p, s) => s.a?.status === 'suspended' && s.a.role === 'qs' && s.roleEvents === 1
      && s.user?.status === 'active' && s.user.epoch === p.before.epoch && s.b?.status === 'active' && said(s.me) === '401 USER_INACTIVE';
    const emailQueue = (p, first, second) => queued({ lockSql: ORG_EMAIL_LOCK_SQL, lockParams: [orgA.id, p.email], waiters: () => orgEmailWaiters(orgA.id, p.email), first: () => first(p), second: () => second(p) });

    const n1 = await emailQueue(N1, roleEdit, deactivate);
    const t1 = await nState(N1);
    check('N.edit-first', n1.q1 >= 1 && n1.q2 >= 2 && n1.r1.status === 200 && n1.r2.status === 200 && endsSuspended(N1, t1),
      `waiters ${n1.q1}/${n1.q2}; role edit ${said(n1.r1)}; deactivation ${said(n1.r2)}; ${showN(t1)}; epoch before ${N1.before.epoch}`);

    const n2 = await emailQueue(N2, deactivate, roleEdit);
    const t2 = await nState(N2);
    check('N.deact-first', n2.q1 >= 1 && n2.q2 >= 2 && n2.r1.status === 200 && n2.r2.status === 200 && endsSuspended(N2, t2),
      `waiters ${n2.q1}/${n2.q2}; deactivation ${said(n2.r1)}; role edit ${said(n2.r2)}; ${showN(t2)}; epoch before ${N2.before.epoch}`);

    // Mid-flight: the A row held FOR UPDATE stops the role edit at its write,
    // inside its transaction, after it took the (A, e-mail) lock.
    await sideBegin('select id from "OrganizationMembership" where "orgId" = $1 and "userId" = $2 for update', [orgA.id, N3.id]);
    const pe = roleEdit(N3);
    const held = await waitFor(blockedBySide, 1);
    const heldLock = await orgEmailHolders(orgA.id, N3.email);
    const pd = deactivate(N3);
    const waiting = await waitFor(() => orgEmailWaiters(orgA.id, N3.email), 1);
    await sideEnd('rollback');
    const [re, rd] = await Promise.all([pe, pd]);
    const t3 = await nState(N3);
    check('N.midflight', held >= 1 && heldLock === 1 && waiting >= 1 && re.status === 200 && rd.status === 200 && endsSuspended(N3, t3),
      `role edit stopped on the row lock ${held}, holding the (A, e-mail) lock ${heldLock}; deactivation waiting on it ${waiting}; role edit ${said(re)}; deactivation ${said(rd)}; ${showN(t3)}; epoch before ${N3.before.epoch}`);

    // The conditional write, in process: changeMembership reads the row itself
    // (findMembership -> organizationMembership.findFirst); the client handed
    // to it returns that read only after the person was deactivated through
    // the API, so its write is made on a stale read.
    const membershipService = require('../../../src/services/membership.service');
    const appPrisma = require('../../../src/config/db').prisma;
    const realMemberships = appPrisma.organizationMembership;
    let gateRuns = 0;
    let between = null;
    const gatedMemberships = {
      findFirst: async (args) => {
        const read = await realMemberships.findFirst(args);
        if (gateRuns === 0) {
          gateRuns += 1;
          between = keep('N stale: deactivated between the read and the write', await aPm.send('PATCH', `/users/${N4.id}/deactivate`, {}));
        }
        return read;
      },
      findMany: (args) => realMemberships.findMany(args),
      findUnique: (args) => realMemberships.findUnique(args),
      count: (args) => realMemberships.count(args),
      updateMany: (args) => realMemberships.updateMany(args),
      update: (args) => realMemberships.update(args),
      create: (args) => realMemberships.create(args),
    };
    const staleClient = {
      organizationMembership: gatedMemberships,
      authAuditEvent: appPrisma.authAuditEvent,
      $queryRaw: (...args) => appPrisma.$queryRaw(...args),
      $executeRaw: (...args) => appPrisma.$executeRaw(...args),
    };
    const pmRow = await one('select id from "User" where email = $1', [`pm@${A.domain}`.toLowerCase()]);
    let outcome;
    try {
      const result = await membershipService.changeMembership({ tx: staleClient, orgId: orgA.id, userId: N4.id, actor: { id: pmRow?.id, role: 'pm' }, changes: { role: 'qs' } });
      outcome = { ok: true, changed: result?.changed, membership: { status: result?.membership?.status, role: result?.membership?.role } };
    } catch (error) {
      outcome = { ok: false, status: error.status, code: error.code, message: error.message };
    }
    const t4 = await membershipIn(orgA.id, N4.id);
    const e4 = await roleEvents(N4.id);
    check('N.stale-read', gateRuns === 1 && between?.status === 200 && !outcome.ok && outcome.status === 409 && outcome.code === 'MEMBERSHIP_CHANGED'
      && t4?.status === 'suspended' && t4.role === 'site_engineer' && e4 === 0,
      `gate ${gateRuns}; deactivation between ${said(between)}; changeMembership ${outcome.ok ? `wrote ${JSON.stringify(outcome)}` : `${outcome.status} ${outcome.code}`}; A row ${JSON.stringify(t4)}; role_changed events ${e4}`);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // R legacy suspension against acceptance (round 2, R2)
  // ════════════════════════════════════════════════════════════════════════════
  await section('R legacy suspension against acceptance', async () => {
    const legacyPerson = async (label) => {
      const L = await makePerson(label, aPm, A.domain);
      if (!L.id) return L;
      const joined = await invitations.joinByInvitation({ inviter: bPm, email: L.email, role: 'qs', name: L.name, homeOrgId: orgA.id, db });
      keep(`setup ${label} B invite`, joined?.invited);
      keep(`setup ${label} B accept`, joined?.accepted);
      L.joined = `${said(joined?.invited)} -> ${said(joined?.accepted)}`;
      L.joinedOk = joined?.accepted?.status === 200;
      L.bToken = await api.tokenFor(L.email, orgB.id);
      // Fixture: the A row goes (a legacy home member who is also a member of B), as in B.
      const removed = await db.query('delete from "OrganizationMembership" where "orgId" = $1 and "userId" = $2', [orgA.id, L.id]);
      L.rowDeleted = removed.rowCount === 1;
      ctx.legacyMore.push({ id: L.id, rowDeleted: L.rowDeleted });
      L.legacy = keep(`setup ${label} legacy A session`, await api.raw('POST', `/auth/workspaces/${orgA.id}/session`, { token: L.bToken }));
      L.legacyToken = L.legacy.body?.data?.tokens?.accessToken || null;
      L.claims = decode(L.legacyToken);
      L.meBefore = keep(`setup ${label} legacy bearer`, await api.raw('GET', '/auth/me', { token: L.legacyToken }));
      const before = invitations.mailsTo(L.email).length;
      L.inv = keep(`setup ${label} A project invitation`, await aPm.send('POST', '/users/invitations', { email: L.email, role: 'qs', projectId: projectA }));
      L.invitationId = L.inv.status === 201 ? L.inv.body?.data?.id || null : null;
      L.link = L.invitationId ? await invitations.invitationTokenFor({ email: L.email, invitationId: L.invitationId, after: before, db }) : null;
      L.before = await userState(L.id);
      L.aNow = await membershipIn(orgA.id, L.id);
      L.bNow = await membershipIn(orgB.id, L.id);
      return L;
    };
    const L1 = await legacyPerson('r2-accept-first');
    const L2 = await legacyPerson('r2-deact-first');
    const ready = (L) => Boolean(L.id) && L.joinedOk && Boolean(L.bToken) && L.rowDeleted && !L.aNow && L.bNow?.status === 'active'
      && L.before?.status === 'active' && L.before.orgId === orgA.id && L.legacy?.status === 200 && L.claims?.orgId === orgA.id && L.claims?.sub === L.id && !L.claims?.mid
      && L.meBefore?.status === 200 && L.meBefore.body?.data?.active?.orgId === orgA.id && L.meBefore.body?.data?.active?.membershipId === null
      && L.inv?.status === 201 && Boolean(L.link);
    check('R.setup', ready(L1) && ready(L2), [L1, L2].map((L) => `${L.label}: ${L.made}; B ${L.joined}; fixture deleted ${L.rowDeleted}; A ${L.aNow?.status || 'none'}; B ${L.bNow?.status}; user ${L.before?.status}/${L.before?.orgId === orgA.id}; legacy session ${said(L.legacy)} mid ${L.claims?.mid || 'none'}; me ${said(L.meBefore)} ${JSON.stringify(L.meBefore?.body?.data?.active ?? null)}; invitation ${said(L.inv)} link ${Boolean(L.link)}`).join(' | '));
    if (!ready(L1) || !ready(L2)) throw new Error('setup R incomplete');
    await aPm.token();

    const accept = (L) => settle(api.raw('POST', '/auth/invitations/accept', { json: { token: L.link, name: L.name }, token: L.bToken })).then((r) => keep(`R ${L.label} accepts A`, r));
    const deactivate = (L) => settle(aPm.send('PATCH', `/users/${L.id}/deactivate`, {})).then((r) => keep(`R ${L.label} deactivated by A`, r));
    const emailQueue = (L, first, second) => queued({ lockSql: ORG_EMAIL_LOCK_SQL, lockParams: [orgA.id, L.email], waiters: () => orgEmailWaiters(orgA.id, L.email), first: () => first(L), second: () => second(L) });
    const rState = async (L) => ({
      user: await userState(L.id),
      a: await membershipIn(orgA.id, L.id),
      b: await membershipIn(orgB.id, L.id),
      link: (await one('select status from "InvitationToken" where id = $1', [L.invitationId]))?.status || null,
      assigned: (await one('select count(*)::int as n from "ProjectAssignment" where "projectId" = $1 and "userId" = $2', [projectA, L.id])).n,
      fromLegacy: (await one(`select count(*)::int as n from "AuthAuditEvent" where "orgId" = $1 and "userId" = $2 and "entityType" = 'membership' and action = 'membership.suspended' and "metadataJson"->>'from' = 'legacy'`, [orgA.id, L.id])).n,
      liveA: (await one('select count(*)::int as n from "RefreshSession" where "userId" = $1 and "orgId" = $2 and "revokedAt" is null', [L.id, orgA.id])).n,
      me: keep(`R ${L.label} legacy bearer after`, await api.raw('GET', '/auth/me', { token: L.legacyToken })),
    });
    const showR = (s) => `A ${s.a ? `${s.a.status}/${s.a.kind}/${s.a.role}${s.a.isAdmin ? '/admin' : ''}${s.a.isOwner ? '/owner' : ''}` : 'none'}; B ${s.b?.status || 'none'}; user ${s.user?.status} epoch ${s.user?.epoch}; link ${s.link}; A project assignment ${s.assigned}; suspended-from-legacy events ${s.fromLegacy}; unrevoked A refresh sessions ${s.liveA}; legacy bearer ${said(s.me)}`;
    const suspendedRow = (a) => a?.status === 'suspended' && a.kind === 'member' && a.role === 'qs' && a.isAdmin === false && a.isOwner === false;
    const identityKept = (L, s) => s.user?.status === 'active' && s.user.epoch === L.before.epoch && s.b?.status === 'active';

    const r1 = await emailQueue(L1, accept, deactivate);
    const u1 = await rState(L1);
    const returned = r1.r1.body?.data?.tokens?.accessToken || null;
    const meReturned = returned ? keep('R acceptance token after', await api.raw('GET', '/auth/me', { token: returned })) : null;
    check('R.accept-first', r1.q1 >= 1 && r1.q2 >= 2 && r1.r1.status === 200 && r1.r2.status === 200
      && suspendedRow(u1.a) && u1.link === 'accepted' && u1.assigned === 0 && identityKept(L1, u1) && said(u1.me) === '401 USER_INACTIVE' && (!meReturned || meReturned.status === 401),
      `waiters ${r1.q1}/${r1.q2}; acceptance ${said(r1.r1)}${r1.r1.body?.data?.signInRequired ? ` (signInRequired ${r1.r1.body.data.reason?.code || ''})` : ''}; deactivation ${said(r1.r2)} ${r1.r2.status >= 500 ? r1.r2.text?.slice(0, 300) : ''}; ${showR(u1)}; epoch before ${L1.before.epoch}; token returned by the acceptance ${meReturned ? said(meReturned) : 'none'}`);

    const r2 = await emailQueue(L2, deactivate, accept);
    const u2 = await rState(L2);
    check('R.deact-first', r2.q1 >= 1 && r2.q2 >= 2 && r2.r1.status === 200 && said(r2.r2) === '400 INVITATION_TOKEN_INVALID'
      && suspendedRow(u2.a) && u2.fromLegacy === 1 && u2.link === 'revoked' && u2.assigned === 0 && identityKept(L2, u2) && said(u2.me) === '401 USER_INACTIVE',
      `waiters ${r2.q1}/${r2.q2}; deactivation ${said(r2.r1)}; acceptance ${said(r2.r2)}; ${showR(u2)}; epoch before ${L2.before.epoch}`);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Round 4: the Codex diff review round 3 (did1-diff-codex-review-r3.md) and
  // its fixes (did1-round4-fixes.md)
  // ════════════════════════════════════════════════════════════════════════════
  // The switch set for `fn` only (read per call by the product), restored after;
  // the development error handler's stacks of the expected 503s are counted, not printed.
  const withSwitch = async (value, fn) => {
    const before = process.env.AUTH_MEMBERSHIP_WRITE;
    const realConsoleError = console.error;
    let stacks = 0;
    console.error = (...args) => {
      if (args.map(String).join(' ').includes(SWITCH_MESSAGE)) {
        stacks += 1;
        return;
      }
      realConsoleError(...args);
    };
    process.env.AUTH_MEMBERSHIP_WRITE = value;
    try {
      return await fn();
    } finally {
      if (before === undefined) delete process.env.AUTH_MEMBERSHIP_WRITE;
      else process.env.AUTH_MEMBERSHIP_WRITE = before;
      console.error = realConsoleError;
      if (stacks) console.log(`        (${stacks} expected 503 stack traces from the development error handler not printed)`);
    }
  };
  // Ungranted lock requests (pg_locks) of the sessions the second connection blocks.
  const sideLockWaits = async () => (await one(`select count(*)::int as n from pg_locks l
      where not l.granted and l.pid in (select a.pid from pg_stat_activity a where $1 = any(pg_blocking_pids(a.pid)))`, [sidePid])).n;
  const blockedByPid = async (pid) => (await one('select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).n;
  const strip = (row, ...keys) => JSON.stringify(Object.fromEntries(Object.entries(row || {}).filter(([k]) => !keys.includes(k))));

  // ── P: a party contact edit against a concurrent closure (round-3 finding "contact edit reopens a party") ──
  await section('P party contact edit against a concurrent closure', async () => {
    const parties = [];
    for (const key of ['p1', 'p2', 'p3']) {
      const companyName = `DID1G Race ${key} ${STAMP}`;
      const res = keep(`P setup party ${key}`, await aPm.send('POST', `/projects/${projectA}/parties`, { role: 'subcontractor', companyName }));
      const id = res.status === 201 ? res.body?.data?.id || null : null;
      if (id) ctx.raceParties.push(id);
      parties.push({ key, companyName, res, id });
    }
    const [P1, P2, P3] = parties;
    const G = { label: 'race-guest', email: mail('race-guest', A.domain), name: `DID1G race-guest ${STAMP}` };
    const madeG = P1.id ? await invitations.createByInvitation({ inviter: aPm, email: G.email, role: 'site_engineer', name: G.name, password: PASSWORD, projectId: projectA, projectPartyId: P1.id, db }) : null;
    keep('P setup guest invite', madeG?.invited);
    keep('P setup guest accept', madeG?.accepted);
    G.id = madeG?.userId || null;
    const adds = [];
    for (const P of [P2, P3]) {
      if (G.id && P.id) adds.push(keep(`P setup guest on ${P.key}`, await aPm.send('POST', `/projects/${projectA}/parties/${P.id}/members`, { userId: G.id })));
    }
    const fields = async (id) => one('select role::text as role, "accessLevel", "permissionProfile", "permissionsJson"::text as perms, "permissionTemplateId", status, "contactName", "contactEmail", "contactPhone", "companyId" from "ProjectParty" where id = $1', [id]);
    const guestOn = async (id) => (G.id ? (await one('select status from "ProjectPartyMember" where "projectPartyId" = $1 and "userId" = $2', [id, G.id]))?.status || null : null);
    for (const P of parties) {
      P.start = P.id ? await fields(P.id) : null;
      P.guest = P.id ? await guestOn(P.id) : null;
    }
    const setupOk = parties.every((P) => P.id && P.start?.status === 'active' && P.start.role === 'subcontractor' && P.start.accessLevel === 'collaborator'
      && P.start.permissionTemplateId === null && P.start.perms === '{}' && P.guest === 'active')
      && Boolean(G.id) && adds.length === 2 && adds.every((r) => r.status === 201);
    check('P.setup', setupOk, `${parties.map((P) => `${P.key} ${said(P.res)} ${JSON.stringify(P.start)} guest ${P.guest}`).join(' | ')}; guest ${said(madeG?.invited)} -> ${said(madeG?.accepted)}; added ${adds.map(said).join(', ')}`);
    if (!setupOk) throw new Error('setup P incomplete');
    await aPm.token();

    // The party row held FOR UPDATE on the second connection; `request` is
    // started and seen waiting on it; the second connection then closes the
    // party as a PATCH closure writes it (status inactive, members kept) and
    // commits: a concurrent closure that won the row.
    const closedUnder = async (P, request) => {
      await sideBegin('select id from "ProjectParty" where id = $1 for update', [P.id]);
      const pending = request();
      const blocked = await waitFor(blockedBySide, 1);
      const lockWaits = await sideLockWaits();
      await lockDb.query(`update "ProjectParty" set status = 'inactive', "updatedAt" = (now() at time zone 'utc') where id = $1`, [P.id]);
      await sideEnd('commit');
      const res = await pending;
      return { blocked, lockWaits, res };
    };
    const patchContact = (P, label, contactName) => () => settle(aPm.send('PATCH', `/projects/${projectA}/parties/${P.id}`, { contactName })).then((r) => keep(label, r));
    const upsertContact = (P, label, contactName) => () => settle(aPm.send('POST', `/projects/${projectA}/parties`, { role: 'subcontractor', companyName: P.companyName, contactName })).then((r) => keep(label, r));
    const ofCompany = async (P) => (await one('select count(*)::int as n from "ProjectParty" p join "Company" c on c.id = p."companyId" where p."projectId" = $1 and c.name = $2', [projectA, P.companyName])).n;

    await withSwitch('false', async () => {
      // Control: no race, contact edits by id and by (company, role) go through.
      const b1 = await fields(P1.id);
      const contact1 = `DID1G control ${STAMP}`;
      const byId = await patchContact(P1, 'P off control contact by id', contact1)();
      const a1 = await fields(P1.id);
      const b3 = await fields(P3.id);
      const contact3 = `DID1G control key ${STAMP}`;
      const byKey = await upsertContact(P3, 'P off control contact by key', contact3)();
      const a3 = await fields(P3.id);
      check('P.control', byId.status === 200 && a1?.contactName === contact1 && strip(a1, 'contactName') === strip(b1, 'contactName')
        && byKey.status === 201 && byKey.body?.data?.id === P3.id && a3?.contactName === contact3 && strip(a3, 'contactName') === strip(b3, 'contactName'),
        `by id ${said(byId)}: ${JSON.stringify(b1)} -> ${JSON.stringify(a1)}; by key ${said(byKey)} id ${byKey.body?.data?.id === P3.id ? 'same' : byKey.body?.data?.id}: ${JSON.stringify(b3)} -> ${JSON.stringify(a3)}`);

      // The contact edit by id across a closure.
      const r1 = await closedUnder(P1, patchContact(P1, 'P off contact edit across a closure', `DID1G stale ${STAMP}`));
      const e1 = await fields(P1.id);
      check('P.race.off', r1.blocked >= 1 && r1.lockWaits >= 1 && said(r1.res) === '404 PROJECT_PARTY_NOT_FOUND'
        && e1?.status === 'inactive' && e1.contactName === contact1 && strip(e1, 'status') === strip(a1, 'status'),
        `edit blocked by the held row ${r1.blocked} (ungranted locks ${r1.lockWaits}); edit ${said(r1.res)}; party ${JSON.stringify(a1)} -> ${JSON.stringify(e1)}; guest place ${await guestOn(P1.id)}`);

      // The upsert by (company, role) across a closure.
      const r3 = await closedUnder(P3, upsertContact(P3, 'P off key upsert across a closure', `DID1G stale key ${STAMP}`));
      const e3 = await fields(P3.id);
      const n3 = await ofCompany(P3);
      check('P.race.key', r3.blocked >= 1 && r3.lockWaits >= 1 && said(r3.res) === `503 ${SWITCH_CODE}`
        && e3?.status === 'inactive' && e3.contactName === contact3 && strip(e3, 'status') === strip(a3, 'status') && n3 === 1,
        `upsert blocked by the held row ${r3.blocked} (ungranted locks ${r3.lockWaits}); upsert ${said(r3.res)}; party ${JSON.stringify(a3)} -> ${JSON.stringify(e3)}; parties of that company ${n3}; guest place ${await guestOn(P3.id)}`);
    });

    await withSwitch('true', async () => {
      const b2 = await fields(P2.id);
      const r2 = await closedUnder(P2, patchContact(P2, 'P on contact edit across a closure', `DID1G stale on ${STAMP}`));
      const e2 = await fields(P2.id);
      check('P.race.on', r2.blocked >= 1 && r2.lockWaits >= 1 && said(r2.res) === '404 PROJECT_PARTY_NOT_FOUND'
        && e2?.status === 'inactive' && e2.contactName === b2?.contactName && strip(e2, 'status') === strip(b2, 'status'),
        `edit blocked by the held row ${r2.blocked} (ungranted locks ${r2.lockWaits}); edit ${said(r2.res)}; party ${JSON.stringify(b2)} -> ${JSON.stringify(e2)}; guest place ${await guestOn(P2.id)}`);
    });
  });

  // ── U: standing changes under the (A, e-mail) lock (round-3 findings "unchanged admin field" and "delayed User mirror") ──
  await section('U standing changes under the (A, e-mail) lock', async () => {
    const aOwnerEmail = String(A.people.find((p) => p.isOwner)?.email || '').toLowerCase();
    const aOwner = api.as(aOwnerEmail, orgA.id);
    ctx.aOwner = aOwner;
    const ownerRow = aOwnerEmail ? await one('select id from "User" where email = $1', [aOwnerEmail]) : null;
    const ownerM = ownerRow ? await membershipIn(orgA.id, ownerRow.id) : null;
    const Ma = await makePerson('u-admin', aPm, A.domain, 'qs');
    const Mb = await makePerson('u-mirror-q', aPm, A.domain, 'site_engineer');
    const Mc = await makePerson('u-mirror-h', aPm, A.domain, 'site_engineer');
    for (const p of [Ma, Mb, Mc]) if (p.id) ctx.adminsToRevoke.push(p.id);
    await aOwner.token();
    const grant = Ma.id ? keep('U setup admin grant (switch on)', await aOwner.send('PATCH', `/users/${Ma.id}`, { isCompanyAdmin: true })) : null;
    const standing = async (id) => ({
      m: await membershipIn(orgA.id, id),
      u: await one('select "orgId", role, "isCompanyAdmin" from "User" where id = $1', [id]),
    });
    const sa = Ma.id ? await standing(Ma.id) : null;
    const sb = Mb.id ? await standing(Mb.id) : null;
    const sc = Mc.id ? await standing(Mc.id) : null;
    const engineer = (s) => s?.m?.status === 'active' && s.m.kind === 'member' && s.m.role === 'site_engineer' && s.m.isAdmin === false && s.m.isOwner === false
      && s.u?.orgId === orgA.id && s.u.role === 'site_engineer' && s.u.isCompanyAdmin === false;
    const setupOk = ownerM?.isOwner === true && ownerM.status === 'active'
      && grant?.status === 200 && sa?.m?.status === 'active' && sa.m.isAdmin === true && sa.m.isOwner === false && sa.u?.orgId === orgA.id && sa.u.isCompanyAdmin === true
      && engineer(sb) && engineer(sc);
    check('U.setup', setupOk, `owner ${aOwnerEmail} ${JSON.stringify(ownerM)}; ${[Ma, Mb, Mc].map((p) => `${p.label} ${p.made}`).join(', ')}; grant ${said(grant)}; admin ${JSON.stringify(sa)}; mirror-q ${JSON.stringify(sb)}; mirror-h ${JSON.stringify(sc)}`);
    if (!setupOk) throw new Error('setup U incomplete');

    const ownerPatch = (label, id, body) => () => settle(aOwner.send('PATCH', `/users/${id}`, body)).then((r) => keep(label, r));
    const events = async (id) => Object.fromEntries((await q(`select action, count(*)::int as n from "AuthAuditEvent" where "orgId" = $1 and "userId" = $2 and "entityType" = 'membership'
        and action in ('membership.admin_granted', 'membership.admin_revoked', 'membership.role_changed') group by action`, [orgA.id, id])).map((r) => [r.action, r.n]));
    const mirrored = (s) => Boolean(s?.m && s.u) && s.u.isCompanyAdmin === Boolean(s.m.isAdmin || s.m.isOwner) && s.u.role === s.m.role;
    const showS = (s) => `membership ${s?.m ? `${s.m.status}/${s.m.role}${s.m.isAdmin ? '/admin' : ''}${s.m.isOwner ? '/owner' : ''}` : 'none'}; User ${s?.u ? `${s.u.role}${s.u.isCompanyAdmin ? '/admin' : ''}` : 'none'}`;

    // (b) A grant judged against a stale snapshot, with the switch off.
    await withSwitch('false', async () => {
      const evBefore = await events(Ma.id);
      const b = await queued({
        lockSql: ORG_EMAIL_LOCK_SQL,
        lockParams: [orgA.id, Ma.email],
        waiters: () => orgEmailWaiters(orgA.id, Ma.email),
        first: ownerPatch('U off admin revoke', Ma.id, { isCompanyAdmin: false }),
        second: ownerPatch('U off admin grant on a stale snapshot', Ma.id, { isCompanyAdmin: true }),
      });
      const s = await standing(Ma.id);
      const ev = await events(Ma.id);
      const n = (bag, key) => bag[key] || 0;
      check('U.admin-snapshot', b.q1 >= 1 && b.q2 >= 2 && b.r1.status === 200 && said(b.r2) === `503 ${SWITCH_CODE}`
        && s.m?.status === 'active' && s.m.isAdmin === false && s.m.isOwner === false && s.u?.isCompanyAdmin === false
        && n(ev, 'membership.admin_granted') === n(evBefore, 'membership.admin_granted') && n(ev, 'membership.admin_revoked') === n(evBefore, 'membership.admin_revoked') + 1,
        `waiters ${b.q1}/${b.q2}; revoke ${said(b.r1)}; grant ${said(b.r2)}; ${showS(s)}; events ${JSON.stringify(evBefore)} -> ${JSON.stringify(ev)}`);
    });

    // (c) The User mirror is written in the standing change's own transaction.
    const toAdmin = { isCompanyAdmin: true, role: 'planning_eng' };
    const fromAdmin = { isCompanyAdmin: false, role: 'qs' };
    const mq = await queued({
      lockSql: ORG_EMAIL_LOCK_SQL,
      lockParams: [orgA.id, Mb.email],
      waiters: () => orgEmailWaiters(orgA.id, Mb.email),
      first: ownerPatch('U mirror grant', Mb.id, toAdmin),
      second: ownerPatch('U mirror revoke', Mb.id, fromAdmin),
    });
    const sq = await standing(Mb.id);
    check('U.mirror.queued', mq.q1 >= 1 && mq.q2 >= 2 && mq.r1.status === 200 && mq.r2.status === 200
      && sq.m?.status === 'active' && sq.m.role === 'qs' && sq.m.isAdmin === false && sq.m.isOwner === false && mirrored(sq),
      `waiters ${mq.q1}/${mq.q2}; grant ${said(mq.r1)}; revoke ${said(mq.r2)}; ${showS(sq)}`);

    // The same queue with the person's User row held FOR NO KEY UPDATE on a third
    // connection (an UPDATE of User waits on it; the key-share locks of inserts
    // naming the person do not): the grant, released from the (A, e-mail) lock,
    // reaches its mirror write and stops there.
    const rowDb = await guard.connectCert();
    ctx.rowDb = rowDb;
    const rowPid = (await rowDb.query('select pg_backend_pid() as pid')).rows[0].pid;
    await sideBegin(ORG_EMAIL_LOCK_SQL, [orgA.id, Mc.email]);
    await rowDb.query('begin');
    ctx.rowOpen = true;
    await rowDb.query('select id from "User" where id = $1 for no key update', [Mc.id]);
    const p1 = ownerPatch('U held grant', Mc.id, toAdmin)();
    const w1 = await waitFor(() => orgEmailWaiters(orgA.id, Mc.email), 1);
    const p2 = ownerPatch('U held revoke', Mc.id, fromAdmin)();
    const w2 = await waitFor(() => orgEmailWaiters(orgA.id, Mc.email), 2);
    await sideEnd('commit');
    const atMirror = await waitFor(() => blockedByPid(rowPid), 1);
    // A mirror written after the transaction would let the revoke run to its own
    // mirror write meanwhile: two sessions on the row. It stays one.
    const onRow = await waitFor(() => blockedByPid(rowPid), 2, 1200);
    const stillWaiting = await orgEmailWaiters(orgA.id, Mc.email);
    const holding = await orgEmailHolders(orgA.id, Mc.email);
    const midway = await membershipIn(orgA.id, Mc.id);
    ctx.rowOpen = false;
    await rowDb.query('commit');
    const [h1, h2] = await Promise.all([p1, p2]);
    const sh = await standing(Mc.id);
    check('U.mirror.held', w1 >= 1 && w2 >= 2 && atMirror === 1 && onRow === 1 && stillWaiting === 1 && holding === 1
      && midway?.role === 'site_engineer' && midway.isAdmin === false
      && h1.status === 200 && h2.status === 200 && sh.m?.status === 'active' && sh.m.role === 'qs' && sh.m.isAdmin === false && mirrored(sh),
      `waiters ${w1}/${w2}; released: blocked on the User row ${atMirror} then ${onRow}; still waiting on the (A, e-mail) lock ${stillWaiting}, holding it ${holding}; committed membership meanwhile ${midway ? `${midway.role}${midway.isAdmin ? '/admin' : ''}` : 'none'}; grant ${said(h1)}; revoke ${said(h2)}; ${showS(sh)}`);
  });

  // ── O: two owners demoting each other (round-3 finding "concurrent owner removals leave zero owners") ──
  await section('O two owners demoting each other', async () => {
    const O1 = await makePerson('own-1', aPm, A.domain);
    const O2 = await makePerson('own-2', aPm, A.domain);
    const zName = `CERT ${WS_CODE} did1g owners ${STAMP} (CERT-${WS_CODE})`;
    ctx.workspaceNames.push(zName);
    const o1Bearer = O1.id ? await api.tokenFor(O1.email, orgA.id) : null;
    const made = o1Bearer ? keep('O setup workspace', await api.raw('POST', '/organisations', { token: o1Bearer, json: { name: zName } })) : null;
    const zId = made?.status === 201 ? made.body?.data?.organisation?.id || null : null;
    // A new workspace starts with no trial (subscription incomplete), and the
    // subscription gate refuses its writes (/users included); a trial starts
    // only through a Stripe card setup, which the in-process proof cannot
    // complete. So the throwaway workspace's own subscription is written as a
    // running trial (fixture, as the user-add proof does), restored at the end.
    let trialWritten = false;
    if (zId) {
      const before = await one('select status, "trialEndsAt" from "Subscription" where "orgId" = $1', [zId]);
      const trial = await db.query(`update "Subscription" set status = 'trialing', "trialEndsAt" = (now() at time zone 'utc') + interval '7 days', "updatedAt" = (now() at time zone 'utc') where "orgId" = $1`, [zId]);
      trialWritten = trial.rowCount === 1;
      if (trialWritten) ctx.trialFixtures.push({ orgId: zId, before });
    }
    const zO1 = zId && trialWritten ? api.as(O1.email, zId) : null;
    const joined = zO1 && O2.id ? await invitations.joinByInvitation({ inviter: zO1, email: O2.email, role: 'qs', name: O2.name, homeOrgId: orgA.id, db }) : null;
    keep('O setup O2 invite', joined?.invited);
    keep('O setup O2 accept', joined?.accepted);
    const owned = joined?.accepted?.status === 200 ? keep('O setup O2 made owner', await zO1.send('PATCH', `/users/${O2.id}`, { isOwner: true })) : null;
    const zO2 = zId ? api.as(O2.email, zId) : null;
    const owners = async () => (zId ? q('select "userId"::text as "userId", role, "isAdmin" from "OrganizationMembership" where "orgId" = $1 and "isOwner" = true and status = \'active\' order by "userId"', [zId]) : []);
    const ownersBefore = await owners();
    const setupOk = Boolean(O1.id && O2.id && zId) && owned?.status === 200 && ownersBefore.length === 2
      && ownersBefore.some((o) => o.userId === O1.id) && ownersBefore.some((o) => o.userId === O2.id);
    check('O.setup', setupOk, `${O1.made}; ${O2.made}; workspace ${said(made)} ${zId}; trial fixture ${trialWritten}; O2 ${said(joined?.invited)} -> ${said(joined?.accepted)}; made owner ${said(owned)}; active owners ${JSON.stringify(ownersBefore)}`);
    if (!setupOk) throw new Error('setup O incomplete');
    await zO1.token();
    await zO2.token();

    await sideBegin("select pg_advisory_xact_lock(hashtext('owners'), hashtext($1::text))", [zId]);
    // Both owner rows too: an ownership removal that skipped the owners lock
    // would count the other owner and then wait here, at its write.
    await lockDb.query('select id from "OrganizationMembership" where "orgId" = $1 and "userId" = any($2::text[]) for update', [zId, [O1.id, O2.id]]);
    const p1 = settle(zO1.send('PATCH', `/users/${O2.id}`, { isOwner: false })).then((r) => keep('O O1 demotes O2', r));
    const b1 = await waitFor(blockedBySide, 1);
    const p2 = settle(zO2.send('PATCH', `/users/${O1.id}`, { isOwner: false })).then((r) => keep('O O2 demotes O1', r));
    const b2 = await waitFor(blockedBySide, 2);
    const onOwnersLock = await orgEmailWaiters('owners', zId);
    await sideEnd('commit');
    const [r1, r2] = await Promise.all([p1, p2]);
    const after = await owners();
    const wins = [r1, r2].filter((r) => r.status === 200).length;
    const lastOwner = [r1, r2].filter((r) => said(r) === '409 LAST_OWNER').length;
    const winner = r1.status === 200 ? O1.id : r2.status === 200 ? O2.id : null;
    check('O.race', b1 >= 1 && b2 >= 2 && onOwnersLock >= 2 && wins === 1 && lastOwner === 1 && after.length === 1 && after[0].userId === winner,
      `blocked ${b1}/${b2}; waiting on the owners lock ${onOwnersLock}; O1 demotes O2 ${said(r1)}; O2 demotes O1 ${said(r2)}; active owners after ${JSON.stringify(after)}`);
  });

  // ── E: legacy materialisation against deactivation (round-3 finding "unlocked legacy materialisation") ──
  await section('E legacy materialisation against deactivation', async () => {
    const legacyPerson = async (label) => {
      const L = await makePerson(label, aPm, A.domain, 'site_engineer');
      if (!L.id) return L;
      const joined = await invitations.joinByInvitation({ inviter: bPm, email: L.email, role: 'qs', name: L.name, homeOrgId: orgA.id, db });
      keep(`setup ${label} B invite`, joined?.invited);
      keep(`setup ${label} B accept`, joined?.accepted);
      L.joined = `${said(joined?.invited)} -> ${said(joined?.accepted)}`;
      L.joinedOk = joined?.accepted?.status === 200;
      L.bToken = await api.tokenFor(L.email, orgB.id);
      // Fixture: the A row goes (a legacy home member who is also a member of B), as in B and R.
      const removed = await db.query('delete from "OrganizationMembership" where "orgId" = $1 and "userId" = $2', [orgA.id, L.id]);
      L.rowDeleted = removed.rowCount === 1;
      ctx.legacyMore.push({ id: L.id, rowDeleted: L.rowDeleted });
      L.legacy = keep(`setup ${label} legacy A session`, await api.raw('POST', `/auth/workspaces/${orgA.id}/session`, { token: L.bToken }));
      L.legacyToken = L.legacy.body?.data?.tokens?.accessToken || null;
      L.claims = decode(L.legacyToken);
      L.meBefore = keep(`setup ${label} legacy bearer`, await api.raw('GET', '/auth/me', { token: L.legacyToken }));
      L.before = await userState(L.id);
      L.uBefore = await one('select role, "isCompanyAdmin" from "User" where id = $1', [L.id]);
      L.aNow = await membershipIn(orgA.id, L.id);
      L.bNow = await membershipIn(orgB.id, L.id);
      return L;
    };
    const E1 = await legacyPerson('e-edit-first');
    const E2 = await legacyPerson('e-deact-first');
    const E3 = await legacyPerson('e-midflight');
    const ready = (L) => Boolean(L.id) && L.joinedOk && Boolean(L.bToken) && L.rowDeleted && !L.aNow && L.bNow?.status === 'active'
      && L.before?.status === 'active' && L.before.orgId === orgA.id && L.uBefore?.role === 'site_engineer' && L.uBefore.isCompanyAdmin === false
      && L.legacy?.status === 200 && L.claims?.orgId === orgA.id && L.claims?.sub === L.id && !L.claims?.mid
      && L.meBefore?.status === 200 && L.meBefore.body?.data?.active?.orgId === orgA.id && L.meBefore.body?.data?.active?.membershipId === null;
    const all = [E1, E2, E3];
    check('E.setup', all.every(ready), all.map((L) => `${L.label}: ${L.made}; B ${L.joined}; fixture deleted ${L.rowDeleted}; A ${L.aNow?.status || 'none'}; B ${L.bNow?.status}; user ${L.before?.status}/${L.before?.orgId === orgA.id} ${JSON.stringify(L.uBefore)}; legacy session ${said(L.legacy)} mid ${L.claims?.mid || 'none'}; me ${said(L.meBefore)} ${JSON.stringify(L.meBefore?.body?.data?.active ?? null)}`).join(' | '));
    if (!all.every(ready)) throw new Error('setup E incomplete');
    await aPm.token();

    const roleEdit = (L) => settle(aPm.send('PATCH', `/users/${L.id}`, { role: 'qs' })).then((r) => keep(`E ${L.label} role edit`, r));
    const deactivate = (L) => settle(aPm.send('PATCH', `/users/${L.id}/deactivate`, {})).then((r) => keep(`E ${L.label} deactivated by A`, r));
    const emailQueue = (L, first, second) => queued({ lockSql: ORG_EMAIL_LOCK_SQL, lockParams: [orgA.id, L.email], waiters: () => orgEmailWaiters(orgA.id, L.email), first: () => first(L), second: () => second(L) });
    const eState = async (L) => ({
      user: await userState(L.id),
      u: await one('select role, "isCompanyAdmin" from "User" where id = $1', [L.id]),
      a: await membershipIn(orgA.id, L.id),
      rows: (await one('select count(*)::int as n from "OrganizationMembership" where "orgId" = $1 and "userId" = $2', [orgA.id, L.id])).n,
      b: await membershipIn(orgB.id, L.id),
      me: keep(`E ${L.label} legacy bearer after`, await api.raw('GET', '/auth/me', { token: L.legacyToken })),
    });
    const showE = (s) => `A rows ${s.rows}: ${s.a ? `${s.a.status}/${s.a.kind}/${s.a.role}${s.a.isAdmin ? '/admin' : ''}${s.a.isOwner ? '/owner' : ''}` : 'none'}; User ${s.u?.role}; B ${s.b?.status || 'none'}; user ${s.user?.status} epoch ${s.user?.epoch}; legacy bearer ${said(s.me)}`;
    const suspendedOne = (s) => s.rows === 1 && s.a?.status === 'suspended' && s.a.kind === 'member' && s.a.isAdmin === false && s.a.isOwner === false;
    const kept = (L, s) => s.user?.status === 'active' && s.user.epoch === L.before.epoch && s.b?.status === 'active' && said(s.me) === '401 USER_INACTIVE';
    const sound = (r) => r.status > 0 && r.status < 500 && said(r) !== '409 CONFLICT';

    const e1 = await emailQueue(E1, roleEdit, deactivate);
    const t1 = await eState(E1);
    check('E.edit-first', e1.q1 >= 1 && e1.q2 >= 2 && e1.r1.status === 200 && e1.r2.status === 200 && suspendedOne(t1) && t1.a.role === 'qs' && t1.u?.role === 'qs' && kept(E1, t1),
      `waiters ${e1.q1}/${e1.q2}; role edit ${said(e1.r1)}; deactivation ${said(e1.r2)}; ${showE(t1)}; epoch before ${E1.before.epoch}`);

    const e2 = await emailQueue(E2, deactivate, roleEdit);
    const t2 = await eState(E2);
    const applied = e2.r2.status === 200 && t2.a?.role === 'qs';
    const refused = [400, 409].includes(e2.r2.status) && sound(e2.r2) && t2.a?.role === 'site_engineer';
    check('E.deact-first', e2.q1 >= 1 && e2.q2 >= 2 && e2.r1.status === 200 && (applied || refused) && suspendedOne(t2) && kept(E2, t2),
      `waiters ${e2.q1}/${e2.q2}; deactivation ${said(e2.r1)}; role edit ${said(e2.r2)}; ${showE(t2)}; epoch before ${E2.before.epoch}`);

    // Mid-flight: A's organisation row held FOR UPDATE stops the role edit at
    // the insert that materialises the A row (its foreign key needs a key-share
    // lock on that row), inside its transaction, after it took the (A, e-mail) lock.
    await sideBegin('select id from "Organisation" where id = $1 for update', [orgA.id]);
    const pe = roleEdit(E3);
    const held = await waitFor(blockedBySide, 1);
    const heldLock = await orgEmailHolders(orgA.id, E3.email);
    const pd = deactivate(E3);
    const waiting = await waitFor(() => orgEmailWaiters(orgA.id, E3.email), 1);
    await sideEnd('rollback');
    const [re, rd] = await Promise.all([pe, pd]);
    const t3 = await eState(E3);
    check('E.midflight', held >= 1 && heldLock === 1 && waiting >= 1 && re.status === 200 && rd.status === 200 && suspendedOne(t3) && t3.a.role === 'qs' && kept(E3, t3),
      `role edit stopped on the organisation row ${held}, holding the (A, e-mail) lock ${heldLock}; deactivation waiting on it ${waiting}; role edit ${said(re)}; deactivation ${said(rd)}${rd.status >= 500 || said(rd) === '409 CONFLICT' ? ` ${String(rd.text || '').slice(0, 300)}` : ''}; ${showE(t3)}; epoch before ${E3.before.epoch}`);
  });

  // ── F: workspace creation with the switch off (round-3 finding "switch-off workspace creation") ──
  await section('F workspace creation with the switch off', async () => {
    const Fp = await makePerson('ws-off', aPm, A.domain);
    const fName = `CERT ${WS_CODE} did1g off ${STAMP} (CERT-${WS_CODE})`;
    ctx.workspaceNames.push(fName);
    const bearer = Fp.id ? await api.tokenFor(Fp.email, orgA.id) : null;
    const seats = async () => (await one('select count(*)::int as n from "OrganizationMembership" where "userId" = $1', [Fp.id])).n;
    const createdEvents = async () => (await one(`select count(*)::int as n from "AuthAuditEvent" where "userId" = $1 and action = 'workspace.created'`, [Fp.id])).n;
    const seatsBefore = Fp.id ? await seats() : null;
    const eventsBefore = Fp.id ? await createdEvents() : null;
    await withSwitch('false', async () => {
      const res = bearer ? keep('F off workspace creation', await api.raw('POST', '/organisations', { token: bearer, json: { name: fName } })) : null;
      const named = (await one('select count(*)::int as n from "Organisation" where name = $1', [fName])).n;
      const seatsAfter = Fp.id ? await seats() : null;
      const eventsAfter = Fp.id ? await createdEvents() : null;
      check('F.create-off', Boolean(Fp.id) && Boolean(bearer) && seatsBefore === 1 && said(res) === `503 ${SWITCH_CODE}` && named === 0 && seatsAfter === seatsBefore && eventsAfter === eventsBefore,
        `${Fp.made}; bearer ${Boolean(bearer)}; creation ${said(res)}${res?.status === 201 ? ` (workspace ${res.body?.data?.organisation?.id}, membership ${JSON.stringify(res.body?.data?.workspace ?? null)})` : ''}; workspaces of that name ${named}; memberships ${seatsBefore} -> ${seatsAfter}; workspace.created events ${eventsBefore} -> ${eventsAfter}`);
    });
  });

  const changes = fingerprint.compare(printBefore, await fingerprint.take(db)).filter((c) => !c.noise && c.org !== A_CODE && c.org !== B_CODE && c.org !== WS_CODE);
  check('G.fingerprint', changes.length === 0, changes.map((c) => `${c.table}:${c.org} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
  const unexpected = answers.filter((a) => a.status >= 500 && !(a.status === 503 && a.code === SWITCH_CODE));
  check('G.5xx', unexpected.length === 0, unexpected.map((a) => `${a.label} ${a.status} ${a.code || ''}`).join(', '));
};

const cleanup = async () => {
  const notes = [];
  const { db, lockDb, aPm } = ctx;
  if (ctx.sideOpen) {
    ctx.sideOpen = false;
    await lockDb?.query('rollback').catch(() => null);
  }
  if (ctx.rowOpen) {
    ctx.rowOpen = false;
    await ctx.rowDb?.query('rollback').catch(() => null);
  }
  if (!db) return notes;
  const said2 = (res) => (res ? `${res.status} ${res.body?.error?.code || ''}`.trim() : 'no answer');
  try {
    const revoked = await db.query(
      `update "InvitationToken" set status = 'revoked', "revokedAt" = (now() at time zone 'utc'), "updatedAt" = (now() at time zone 'utc')
        where status = 'pending' and "createdAt" >= ($1::timestamptz at time zone 'utc') and email = any($2::text[])`,
      [RUN_START.toISOString(), [...ctx.runEmails]],
    );
    notes.push(`pending invitations of the run revoked: ${revoked.rowCount}`);
  } catch (error) { notes.push(`revoke failed: ${error.message}`); }
  if (ctx.teamMemberId && aPm) {
    try { notes.push(`team member removed: ${said2(await aPm.send('DELETE', `/projects/${ctx.projectA}/team/${ctx.teamMemberId}`))}`); } catch (error) { notes.push(`team member: ${error.message}`); }
  }
  if (ctx.partyId && aPm) {
    try { notes.push(`party delete ${said2(await aPm.send('DELETE', `/projects/${ctx.projectA}/parties/${ctx.partyId}`))}`); } catch (error) { notes.push(`party delete: ${error.message}`); }
  }
  // S's parties, found by their company's name (a mutation run may have made more than one).
  if (ctx.partyCompanyNames.length && aPm) {
    try {
      const rows = (await db.query(
        `select p.id from "ProjectParty" p join "Company" c on c.id = p."companyId"
          where p."projectId" = $1 and p.status = 'active' and c.name = any($2::text[])`,
        [ctx.projectA, ctx.partyCompanyNames],
      )).rows;
      for (const row of rows) notes.push(`S party delete ${said2(await aPm.send('DELETE', `/projects/${ctx.projectA}/parties/${row.id}`))}`);
      if (!rows.length) notes.push('S parties: none active');
    } catch (error) { notes.push(`S parties: ${error.message}`); }
  }
  // The run's API keys still active (the revocation check revokes the first; a mutation run may leave more).
  if (ctx.apiKeyNames.length && aPm) {
    try {
      const rows = (await db.query(`select id from "ApiClient" where status = 'active' and name = any($1::text[])`, [ctx.apiKeyNames])).rows;
      for (const row of rows) notes.push(`API key revoked ${said2(await aPm.send('DELETE', `/integrations/api-clients/${row.id}`))}`);
      if (!rows.length) notes.push('API keys: none active');
    } catch (error) { notes.push(`API keys: ${error.message}`); }
  }
  // Round 4: the race parties (closed or not) removed through the product, which also ends their members' places.
  for (const id of ctx.raceParties) {
    if (!aPm) break;
    try { notes.push(`P party delete ${said2(await aPm.send('DELETE', `/projects/${ctx.projectA}/parties/${id}`))}`); } catch (error) { notes.push(`P party: ${error.message}`); }
  }
  // Administration the run granted (or a mutation let through) taken back by the owner, through the product.
  if (ctx.adminsToRevoke.length && ctx.aOwner) {
    for (const id of ctx.adminsToRevoke) {
      try {
        const orgA = (await db.query('select "orgId" from "User" where id = $1', [id])).rows[0]?.orgId;
        const admin = (await db.query('select 1 from "OrganizationMembership" where "orgId" = $1 and "userId" = $2 and "isAdmin"', [orgA, id])).rowCount;
        if (admin) notes.push(`admin revoked ${said2(await ctx.aOwner.send('PATCH', `/users/${id}`, { isCompanyAdmin: false }))}`);
      } catch (error) { notes.push(`admin revoke: ${error.message}`); }
    }
  }
  for (const fixture of ctx.trialFixtures) {
    try {
      await db.query('update "Subscription" set status = $2, "trialEndsAt" = $3 where "orgId" = $1', [fixture.orgId, fixture.before?.status ?? 'incomplete', fixture.before?.trialEndsAt ?? null]);
      notes.push('O workspace trial fixture restored');
    } catch (error) { notes.push(`trial fixture: ${error.message}`); }
  }
  if (ctx.workspaceNames.length) {
    try {
      const made = (await db.query('select count(*)::int as n from "Organisation" where name = any($1::text[])', [ctx.workspaceNames])).rows[0].n;
      notes.push(`W workspaces of the run left in place (no product route deletes a workspace): ${made}`);
    } catch (error) { notes.push(`W workspaces: ${error.message}`); }
  }
  for (const name of ctx.projectNames) {
    try {
      for (const row of (await db.query('select id from "Project" where name = $1', [name])).rows) {
        notes.push(`project of the run deleted: ${said2(await aPm.send('DELETE', `/projects/${row.id}`))}`);
      }
    } catch (error) { notes.push(`project cleanup: ${error.message}`); }
  }
  for (const id of ctx.projectTemplates) {
    try { notes.push(`project template archived: ${said2(await aPm.send('DELETE', `/company/project-templates/${id}`))}`); } catch (error) { notes.push(`project template: ${error.message}`); }
  }
  for (const id of ctx.permissionTemplates) {
    try { notes.push(`permission template archived: ${said2(await aPm.send('DELETE', `/permissions/templates/${id}`))}`); } catch (error) { notes.push(`permission template: ${error.message}`); }
  }
  if (ctx.recoveryTarget?.id && aPm) {
    try {
      const orgA = (await db.query('select "orgId" from "User" where id = $1', [ctx.recoveryTarget.id])).rows[0]?.orgId;
      // A grant the switch failed to stop (a mutation) is taken back, as the owner-recovery proof does.
      const ungranted = await db.query('update "OrganizationMembership" set "isOwner" = false, "isAdmin" = false where "orgId" = $1 and "userId" = $2 and ("isOwner" or "isAdmin")', [orgA, ctx.recoveryTarget.id]);
      if (ungranted.rowCount) await db.query('update "User" set "isCompanyAdmin" = false where id = $1', [ctx.recoveryTarget.id]);
      // Suspended through the product, so no pending request of this run can make anyone owner later.
      notes.push(`recovery target: grant removed ${ungranted.rowCount}; suspended ${said2(await aPm.send('PATCH', `/users/${ctx.recoveryTarget.id}/deactivate`, {}))}`);
    } catch (error) { notes.push(`recovery target: ${error.message}`); }
  }
  for (const legacy of [ctx.legacy, ...ctx.legacyMore]) {
    if (!legacy?.id || !legacy.rowDeleted) continue;
    try {
      // The deleted A row is restored only if the product did not write one back (it writes a suspended one).
      const orgA = (await db.query('select "orgId" from "User" where id = $1', [legacy.id])).rows[0]?.orgId;
      const exists = (await db.query('select 1 from "OrganizationMembership" where "orgId" = $1 and "userId" = $2', [orgA, legacy.id])).rowCount;
      if (!exists) {
        await db.query(
          `insert into "OrganizationMembership" (id, "orgId", "userId", role, kind, "isAdmin", "isOwner", status, "createdAt", "updatedAt")
           values ($1, $2, $3, 'qs', 'member', false, false, 'suspended', (now() at time zone 'utc'), (now() at time zone 'utc'))`,
          [crypto.randomUUID(), orgA, legacy.id],
        );
        notes.push('legacy fixture: A row restored as suspended');
      } else {
        notes.push('legacy fixture: the product wrote the A row back');
      }
    } catch (error) { notes.push(`legacy fixture: ${error.message}`); }
  }
  return notes;
};

const run = async () => {
  const started = new Date();
  let scriptError = null;
  let cleanupNotes = [];
  try {
    await main();
  } catch (error) {
    scriptError = error;
    console.error(`SCRIPT ERROR: ${error.stack || error.message}`);
  } finally {
    for (const [name, value] of Object.entries(ENV_AT_START)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    try { cleanupNotes = await cleanup(); } catch (error) { cleanupNotes.push(`cleanup: ${error.message}`); }
  }
  for (const [id, name] of PLAN) {
    if (!recorded.has(id)) {
      recorded.set(id, { id, name, ok: false, detail: 'not run' });
      console.log(`FAIL  ${id}  ${name}\n        not run`);
    }
  }
  const list = PLAN.map(([id]) => recorded.get(id));
  const failed = list.filter((r) => !r.ok).length;
  console.log(`\ncleanup: ${cleanupNotes.join('; ') || 'nothing'}`);
  console.log(`${NAME}: ${list.length - failed} passed, ${failed} failed of ${EXPECTED_CHECKS} (fixed)`);
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULT_DIR, `${NAME}.json`), JSON.stringify({
    proof: NAME,
    stamp: STAMP,
    a: A_CODE,
    b: B_CODE,
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    total: EXPECTED_CHECKS,
    passed: list.length - failed,
    failed,
    scriptError: scriptError ? String(scriptError.stack || scriptError.message) : null,
    cleanup: cleanupNotes,
    checks: list,
  }, null, 1));
  try { await ctx.rowDb?.end(); } catch { /* closed */ }
  try { await ctx.lockDb?.end(); } catch { /* closed */ }
  try { await ctx.db?.end(); } catch { /* closed */ }
  try { await require('../../../src/config/db').prisma.$disconnect(); } catch { /* closed */ }
  process.exit(failed || scriptError ? 2 : 0);
};

run();
