# OctaPM membership and RBAC (ENT-0 design)

Companion to `OCTAPM_MULTI_TENANT_ARCHITECTURE.md`. [C] = confirmed at the cited line, [I] = inferred, [D] = decision.

---

## 1. OrganizationMembership (§7-§12)

```prisma
model OrganizationMembership {
  id            String    @id @default(uuid())
  orgId         String
  userId        String
  role          String                       // catalogue role id (shared/permissions.json roles) or 'external_party' for guests
  kind          String    @default("member") // member | guest
  isAdmin       Boolean   @default(false)    // company administration (was User.isCompanyAdmin)
  isOwner       Boolean   @default(false)    // ownership: billing, conversion, cannot be removed while last
  status        String    @default("active") // invited | active | suspended | left
  invitedById   String?
  invitationId  String?                      // InvitationToken that created it
  joinedAt      DateTime?
  leftAt        DateTime?
  lastActiveAt  DateTime?
  defaultProjectId String?                   // last project opened in this workspace (client convenience, nullable)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  org  Organisation @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([orgId, userId])
  @@index([userId, status])
  @@index([orgId, status])
  @@index([orgId, isOwner])
}
```

Rules enforced in `membership.service.js` (new) and by constraints:

| Rule | Enforcement |
|---|---|
| One membership per (org, user) | `@@unique([orgId, userId])` |
| At least one active owner per company workspace | service invariant on every `PATCH`/`DELETE`: refuse `409 LAST_OWNER` when the change would leave zero `isOwner && status='active'`. (A partial unique index "one owner per org" is **not** used: several owners are allowed.) |
| Owner implies admin | `isOwner → isAdmin` written by the service; validation report checks it |
| Guests: `kind='guest'` ⇒ `role='external_party'`, `isAdmin=false`, `isOwner=false` | service + CHECK constraint `("kind" <> 'guest' OR ("role" = 'external_party' AND NOT "isAdmin" AND NOT "isOwner"))` |
| Role must be in the catalogue | `ALLOWED_ROLES` from `backend/src/config/permissions.js:3-7` [C] — same list `user.service.js:10, 196-199` already uses [C] |
| Personal workspace: exactly one `member` membership | service refuses a second `member` on `Organisation.kind='personal'` (`409 WORKSPACE_IS_PERSONAL`; *as shipped in ENT-6: `409 PERSONAL_WORKSPACE_CONVERT_REQUIRED`*) |
| `super_admin` | not a membership role. It is honoured in five code sites but absent from the catalogue and unassignable, 0 users [C] (`project-authorization.service.js:7`, `conversation.service.js:55`, `meeting.service.js:437`, `task.service.js:311`, `search.service.js:15`). ENT-2 removes it from those sets; `isAdmin`/`isOwner` cover the intent. |

Status meanings: `invited` (legacy rows only, no access; since owner decision L38 an invitation writes no membership row), `active`, `suspended` (org admin paused this person; token refused; only the admin's Activate brings them back — D-ID-1 Q3), `left` (person left or was removed; row kept for audit, unique still holds — a new invitation leaves it as it is until acceptance rewrites it to the offer).

---

## 2. Role and admin move from User to membership (§9-§12)

| Today [C] | Target [D] |
|---|---|
| `User.role` global (`schema.prisma:163`); `getEffectiveRole = req.projectAccess.role \|\| req.user.role` (`rbac.js:18-19`) | `req.user.role` = membership role. `getEffectiveRole` unchanged. |
| `User.isCompanyAdmin` (`:164`); read at ~40 sites (audit table "Where role and isCompanyAdmin are read as GLOBAL facts") | `req.user.isCompanyAdmin = membership.isAdmin \|\| membership.isOwner`. Property name kept so those sites compile unchanged; each is reviewed in ENT-2 only to confirm it wants "admin in the active workspace", which all of them do. |
| `ProjectAssignment.role` per project (`:698-709`); equals the global role on every live row [C] | unchanged: project role still overrides membership role inside a project (`assertProjectAccess :167`). |
| `ProjectUserPermission` template per project (`:6600`) | unchanged. |
| `ProjectParty` / `ProjectPartyMember` | unchanged; the member holds a `guest` membership. |
| SSO auto-provision writes `User.role = org.ssoDefaultRole` (`sso.service.js:240`) | *Superseded by owner decision D-ID-1 Q1:* SSO never creates an identity or a membership. Auto-provision is retired (§5). |
| Invitation acceptance overwrites `User.role` and forces `status='active'` (`auth.service.js:992-1003`) | creates/activates the membership in `invitation.orgId` with `invitation.role`; never touches another workspace's membership. |

### 2.1 Admin scoping (§11)

`isAdmin` is per membership. A person can be admin of company A and `site_engineer` in company B. What admin grants stays exactly what `isCompanyAdmin` grants today, per workspace:

- unconditional allow on `user_management` and `project_parties` (`rbac.js:16, 55`; `permission-template.service.js:48, 563-565, 585-587`) [C];
- org-wide project visibility (`project-authorization.service.js:7-13`) [C];
- `requireCompanyAdmin` routes: project team, permission templates, company workspace, company security, integrations [C];
- moderation in comments/conversations, report-builder manage [C];
- exemption from SSO-required login and org-MFA-on-reset (`auth.service.js:400-411`; `mfa.service.js:186`) — **scoped**: the exemption applies when the *target workspace's* membership is admin. Login policy resolution for a multi-workspace identity: the strictest policy among the workspaces the person is signing into applies at that sign-in (a token is minted for one workspace, so "the workspace being entered" is well defined).

What `isOwner` adds: billing routes (`billing.js` today `requireRoles(pm|finance)` → `isOwner || role in {pm, finance}`), `POST /organisations/:id/convert`, workspace rename/archive, granting or revoking `isOwner`/`isAdmin`.

Self-elevation guard (missing today: a PM can set `isCompanyAdmin` on anyone including themselves, `routes/users.js:110-135` → `user.service.js:292-294` [C]): a membership may not change its own `isAdmin`/`isOwner`/`role`/`status`; only an owner may change `isOwner`; the last active owner cannot be demoted, suspended or removed.

---

## 3. JWT and `req.user` (§15)

Access token claims (`backend/src/utils/tokens.js:49-57` today `{ sub, orgId, role, email, name, isCompanyAdmin, type }`) become:

```json
{ "sub": "<userId>", "orgId": "<orgId>", "mid": "<membershipId>", "role": "qs",
  "adm": true, "own": false, "kind": "member", "email": "...", "name": "...", "type": "access" }
```

Refresh token (`tokens.js:77-83`: `{ sub, orgId, cli, ... }`) gains `mid`. `RefreshSession` gains `membershipId`; the channel binding (`cli` web/mobile, family revocation on replay, `auth.service.js:513-523`) is unchanged.

Since D-ID-1 every token (access, identity, refresh, MFA challenge) also carries `cep`, the identity's credential epoch, and a session issued by a company's SSO carries `sso` (that company's id). Both are described in §5.2.

`req.user` after `authenticate`:

```js
{ id, orgId, membershipId, role, isCompanyAdmin /* adm||own */, isOwner, orgKind, orgSlug, email, name }
```

Everything that reads `req.user.orgId`, `req.user.role`, `req.user.isCompanyAdmin` keeps working. New readers use `membershipId` for audit and realtime rooms.

`GET /auth/me` returns the identity plus `memberships: [{ orgId, slug, name, kind, role, isAdmin, isOwner, status }]` and `active: { orgId, membershipId }`. `GET /auth/me/permissions` (`routes/auth.js:314-343`) is unchanged: org matrix from the membership role + admin, project matrix through the existing chain.

---

## 4. Effective-role logic (unchanged order, new inputs)

On a project route (`rbac.js:50-68`; `permission-template.service.js:32-34, 401-440`) [C]:

1. API-key scope (`api-client.service.scopeAllows`) — deny if outside scope.
2. `isCompanyAdmin(req)` (membership admin/owner) and module ∈ {user_management, project_parties} — allow.
3. `ProjectUserPermission(projectId, userId).templateId` compiled — decides.
4. Active party template — decides.
5. `can(effectiveRole)` where effectiveRole = `ProjectAssignment.role` → `'external_party'` if party-only → **membership role**.
6. `canParty(partyRole)`.
7. deny.

On an org route: `can(membership role)` plus the admin bypass. Guests never reach org routes (`requireOrganizationMembership({ kind: 'member' })`).

`requireCompanyAdmin` (`rbac.js:188-209`) becomes `isAdmin || isOwner`. The `pm` shortcut at `:199` is retired. Why this is safe on the live data: every `isCompanyAdmin` user is a `pm` and no org has more than one admin [C]; the only `pm` without the flag is in "PMcopilots UAT Fixtures" (`79312790-…`), which has **no** admin at all [C]. The backfill rule in §7 promotes that PM. No other person loses a power they exercise today. (Listed for the PO as decision 1 because it is a visible behaviour change for future PMs.)

---

## 5. Invitations and duplicate-identity rules (§114-§115)

Today `User.email @unique` plus four refusal sites make a second workspace impossible: register 409 `EMAIL_ALREADY_EXISTS` (`auth.service.js:304-314`), invite 409 `INVITATION_EMAIL_IN_OTHER_ORG` (`user.service.js:398-404`; `auth.service.js:899-905, 970-976`), createUser 409 (`user.service.js:189-194`), SSO 403 `SSO_USER_OTHER_ORG` (`sso.service.js:235-236`) [C].

Target rules [D]. Updated for owner decision D-ID-1 (2026-10-05, CERT-3 plan §2): **adding a person is always an invitation.** Nobody's account, password or membership is made by an administrator.

| Situation | Behaviour |
|---|---|
| Add a person (any e-mail) | `POST /users/invitations` (`userService.inviteUser`), gated by `user_management` submit plus the transition `user.invite`. `POST /users` is a deprecated alias for one release: the same middleware chain, validator, handler, status and body. `role` is required; `name` and `phone` are ignored (the person sets them when accepting). A body that contains `password` or `confirmPassword`, whatever the value, is refused `400 USER_PASSWORD_NOT_ACCEPTED` before any lookup. The answer is `201` with the invitation (`id` is the **invitation** id, never a user id) plus `invited: true`, with identical keys and values whether or not the e-mail has an account. No User row and no membership exist until acceptance. |
| Who is already part of this workspace | Decided inside the transaction, after `pg_advisory_xact_lock(org, e-mail)` (the lock acceptance and deactivation of the same e-mail also take). Suspended here (including a closed identity homed here that is not LEFT, and a legacy home row whose identity is closed) → `409 ALREADY_MEMBER` for **every** invitation payload. Active here → `409 ALREADY_MEMBER` for a workspace invitation; a project, company or party invitation is allowed and only assigns. LEFT (or closed+LEFT) → may be invited again. A personal workspace refuses a member invitation `409 PERSONAL_WORKSPACE_CONVERT_REQUIRED`. `EMAIL_EXISTS` is retired from user add. |
| One pending link per (org, e-mail) | A new invitation revokes the earlier pending one first (audited `invitation_revoked`, reason `superseded`). Links last 7 days (`INVITATION_TOKEN_DAYS`) and are single use. |
| E-mail send failure | The invitation stays pending, `invitation_delivery_failed` is audited, and the answer is `502 INVITATION_EMAIL_FAILED` with `details.invitationId`, the same for every e-mail and every transport fault. There is no copied-link fallback; the admin resends from the pending list. |
| Pending invitations | `GET /users/invitations?cursor=` lists pending, unexpired rows (offer, note, `lastDeliveryFailedAt`; nothing about whether the e-mail has an account). `DELETE /users/invitations/:id` revokes under the e-mail lock with a conditional write on the pending state (`409 INVITATION_NOT_PENDING` when it is no longer pending; an expired row can be revoked once). `POST /users/invitations/:id/resend` re-sends the **stored** offer (project, company, party, note) as a new link that supersedes the old one. All three use the invite gate. Foreign ids answer 404. |
| Invite an email that already has a User in **another** org | Allowed. Acceptance requires the invitee's own session as that identity (§5.1), then creates a second membership. Their existing memberships are untouched. |
| "Part of the workspace" | `active` or `suspended` membership (`membershipService.PRESENT_STATUSES`): `userInOrgWhere`, `tenant-references.assertMembers`, the warehouse manager. An `invited` row (legacy) is not membership — not listed, assigned, mentioned or activated (`PATCH /users/:id/activate` → 409 `MEMBERSHIP_PENDING_ACCEPTANCE`). |
| Suspension | `PATCH /users/:id/deactivate` suspends the membership under the same (org, e-mail) lock, revokes every pending invitation of this org for that e-mail (audited `invitation_revoked`, reason `member_suspended`), revokes this workspace's refresh sessions, and removes the person's project and activity assignments here. It closes the identity only from home and only when no other **present** membership exists (see the guards below). Suspension is undone only by Activate. |
| Identity fields | `PATCH /users/:id` refuses any body containing `email` with `400 USER_EMAIL_IDENTITY_OWNED`, for every target. `name` and `phone` are editable only for a person homed in this workspace (others `403 FORBIDDEN`). Role and standing go through the membership. There is no self-service e-mail change (D-ID-6, P2). |
| Passwords | No administrator sets or sees a password. `POST /users/:id/reset-password` and the transition `user.reset_password` are removed. `POST /users/:id/password-reset-email` (no body; gate `user_management` update plus `user.send_password_reset`) asks OctaPM to send the ordinary self-service reset e-mail to the identity's stored address, for a person with a present membership here or a legacy home member. It always answers `202 {sent:true}` (a closed identity is sent nothing and gets the same answer), is rate-limited per actor and per (org, target) (`429`), and is audited `password_reset_email_requested_by_admin`. Foreign ids and random ids answer the same 404. |
| Identity-wide admin guards | The admin MFA reset and the identity close inside deactivation are each one conditional statement that counts every **present** membership elsewhere (active **and** suspended). A home administrator cannot clear the second factor of (`403 IDENTITY_SHARED`), or close, an identity that is still active or suspended in another company; the deactivation then only suspends the membership here. |
| Register (`auth.service.js:290-338`) | Closed in production whatever `PUBLIC_REGISTRATION` says, and the production preflight refuses `PUBLIC_REGISTRATION=true` (D-ID-1 Q8; D-REG-1). Outside production it is open only under `NODE_ENV` `development` or `test`, or with `PUBLIC_REGISTRATION=true`; any other `NODE_ENV` is closed (L103). The first administrator of a new deployment comes from `npm run admin:bootstrap`. Where registration is open, an existing e-mail still gets 409 `EMAIL_ALREADY_EXISTS`. |
| SSO callback | **SSO never creates an identity or a membership** (D-ID-1 Q1). The callback admits only an existing identity with an **active** membership in the SSO workspace, or a legacy person homed there with no membership row (whose row is then written from the User columns). Anyone else (unknown e-mail, identity homed elsewhere that is not a member here, LEFT former member) gets the same `403 SSO_USER_NOT_FOUND`, decided before anything about the account is revealed. A person who is part of the workspace but suspended, or whose identity is closed, gets `403 USER_INACTIVE`. `ssoAutoProvision` is retired: settings always report `autoProvision: false`, and `PUT /company/security/sso` with `autoProvision: true` is refused `400 SSO_AUTO_PROVISION_RETIRED`. An invited new person creates the identity by accepting the e-mailed link and can then use SSO (establishing the identity through SSO while accepting is D-SSO-3, not built). |
| Case-insensitive duplicates | none exist (0 locally [C]); email normalised to lower-case at every entry point (already `normalizeEmail` pattern in `auth.service.js`). |
| Invitation cannot confer `isAdmin`/`isOwner` | kept (today it cannot confer `isCompanyAdmin` [C]); admin is granted after joining by an owner/admin. |

`InvitationToken` (`schema.prisma:759-798`) is reused unchanged; it already spans org + optional project + company + party [C]. Add `membershipId?` filled on acceptance.

### 5.1 Identity standing, acceptance proof and standing grants (ENT-2 review decisions) [D]

- **`User.status` belongs to the identity's home workspace** (`User.orgId`), as name, email and password already do. Deactivation closes the identity only from home and only when no other **present** membership (active or suspended) remains; closing bumps the credential epoch (§5.2). Reactivation from another workspace reopens that workspace's membership and answers `403 FORBIDDEN` when the identity itself is closed. `resolveSessionPrincipal` refuses a session for an inactive identity on every path.
- **Who an acceptance may bring back** (D-ID-1 Q3, SUSP). A link never reverses a suspension: acceptance by a person whose membership here is SUSPENDED, or by a closed identity homed here that is not LEFT (closed+SUSPENDED, or a legacy home row with no membership), is refused with the ordinary invalid-invitation error and changes nothing. A closed identity homed elsewhere is refused `403 USER_INACTIVE`. Only **closed+LEFT** with this home is reopened by a link from home: the person chooses a new password with the token alone, `status` returns to active, the credential epoch is bumped, and the answer is `signInRequired` (no session). The administrator's way back for a suspended person is Activate.
- **Acceptance by an existing identity requires its own session** (owner decision L38, 2026-10-05): an `Authorization` bearer for the same `sub` (an access or identity token from its own sign-in) on `POST /auth/invitations/accept`. The password alone is **not** proof — it skipped the second factor, the sign-in throttle and single sign-on; the link alone, a password, or another identity's bearer → `401 INVITATION_SIGN_IN_REQUIRED`. The bearer must also carry the identity's current credential epoch (§5.2). The preview reports `requiresSignIn: true` for an active identity and `requiresPassword` only for a new identity or a home reopen; the web accept page signs the person in (password, then the second factor) and accepts with that session. A brand-new identity still sets its name and password with the token alone.
- **An SSO-bound session is identity proof, never workspace access** (D-ID-1 Q12, replacing the L10 refusal). A session issued by another company's SSO proves who the person is, so acceptance completes and the membership is written. It never satisfies the target workspace's own policy: the answer is `{ accepted: true, signInRequired: true, orgId, reason }` with no session, and the person then signs in to the target workspace under its own SSO, MFA and access rules. There is no home-company shortcut.
- **Two organisations, one new e-mail.** When two workspaces' links for the same new address are accepted at once, the unique e-mail lets one identity be created; the other acceptance rolls back and answers `401 INVITATION_SIGN_IN_REQUIRED`, and its link stays pending for the person to accept after signing in.
- **Acceptance writes exactly the offer** (`membershipService.acceptOffer`): the invited role and kind, `isAdmin = isOwner = false`, whatever a left or legacy invited row held before; it never turns a SUSPENDED row active; an active member keeps its membership. The link is claimed atomically in the transaction (pending, not revoked, not expired), so a link revoked or used meanwhile writes nothing; a party invitation whose party moved company or closed → `409 INVITATION_OFFER_CHANGED`. The session for the joined workspace is issued as any workspace session (`issueWorkspaceSession`: SSO-only policy, MFA enrolment, SSO binding); when that policy refuses, the acceptance stands and the answer is `{ accepted: true, signInRequired: true, orgId, reason }` with no tokens — as it is for a home reopen.
- **An active member's role is not re-graded by an invitation.** A project or party invitation to someone already an active member assigns the project and leaves the membership (and the home `User.role`) alone; role changes go through `changeMembership`, with its guards and `membership.role_changed`.
- **Only an owner grants or revokes `isAdmin`**, as §2.1 lists, not merely `isOwner`: two PMs must not be able to make each other administrators (`403 OWNER_REQUIRED`). In a workspace with no membership rows of its own (seeded before the backfill, no owner exists) a company administrator grants it, as before.
- **SSO links are per workspace** (D-ID-1 Q2). The provider's subject is stored on the membership, `OrganizationMembership.ssoSubject` (unique on `(orgId, ssoSubject)`), and the callback matches and links only within the SSO workspace. A subject already linked here to another person, or a membership here already linked to a different subject, is `403 SSO_IDENTITY_CONFLICT`. One company's provider can never bind, block or replace another company's link. The global `User.ssoSubject` is legacy: no longer read or written; migration `20261006010000_identity_security` copied existing values onto the home membership.
- **SSO sessions cannot change the identity's own security** (D-ID-1 Q2). A session issued by any company's SSO (token claim `sso`), the home company's included, gets `403 SSO_SESSION_BOUND` on `/auth/mfa/setup`, `/enable`, `/disable` and `/backup-codes`. The second factor is changed only from a session the person opened with their own credentials. An SSO session also stays bound to its company: switching workspace with it is `403 SSO_SESSION_BOUND`.

### 5.2 Credential epoch (D-ID-1 Q6) [D]

`User.credentialEpoch` (integer, default 0) is carried as the `cep` claim on access, identity, refresh and MFA-challenge tokens. A token without the claim counts as 0, so the deploy signed nobody out.

- **What bumps it**, together with revoking every refresh session of the identity: a completed password reset; an identity close (deactivation from home with no other present membership); an admin MFA reset (home workspace only; `403 IDENTITY_SHARED` while another present membership exists); and the acceptance that reopens a closed+LEFT account.
- **What else it ends** (owner decision Q-KEY, 2026-10-09): every SSO sign-in ticket not yet exchanged, and every active API key the person **created** (`ApiClient.createdBy`), in every workspace. Each revoked key leaves an `api_key_revoked` auth-audit row whose reason names the event (`password_reset`, `mfa_reset_by_admin`, `identity_closed`, `identity_reopened`). Keys other people created are untouched, including keys that act as this person. One helper, `endIdentitySessions` in `auth.service.js`, does all of this for every credential event.
- **Keys and the epoch.** Creating an API key, or changing what one may reach (scopes, projects, expiry), holds the acting session's credential epoch in the same transaction as the write. A request that a credential event overtakes gets `401 SESSION_REVOKED` and writes nothing; one that commits first is caught by the event's revocation. Revoking a key never waits on this and is never refused. A reach field that a request resends unchanged is left out of the write, so a queued edit cannot restore what a concurrent narrowing removed. Every credential event holds the person's User row before it revokes, so a key being created either commits first and is revoked, or waits and is refused. An acceptance that would reopen a closed account re-checks under that row that the account is still closed; if it was reopened meanwhile, the answer is `401 INVITATION_SIGN_IN_REQUIRED`.
- **Where it is checked:** `authenticate` (access and identity tokens), `subjectOfToken` in `routes/workspaces.js` (workspace switching, the resolve route and the acceptance proof), `refresh`, the MFA challenge (answered `401 SESSION_REVOKED`), and the socket handshake.
- **The answer** to a token minted before the identity's last credential event is `401 SESSION_REVOKED` everywhere. Clients treat it as "signed out: sign in again".
- **Deactivation** also revokes the refresh sessions of that workspace, so a later Activate cannot revive them.

### 5.3 The membership emergency switch (D-ID-1 Q10) [D]

`AUTH_MEMBERSHIP_WRITE=false` fails closed: it blocks **access expansion** and never blocks **revocation**. One guard, `membershipService.assertAccessExpansionAllowed()`, answers `503 MEMBERSHIP_WRITES_SUSPENDED` (writing nothing) for:

- inviting (both doors) and accepting an invitation;
- Activate;
- a role change, and a grant of administration or ownership;
- project-team additions (including through project templates) and project-party member additions.

Still available while the switch is off: deactivate/suspend (the membership status is written even then), revoking an invitation, removing project access, and revoking administration or ownership.

---

## 6. Login with 0 / 1 / many workspaces (§116)

`POST /auth/login` verifies the password (and MFA/SSO policy) against the identity, then:

| Active memberships | Response |
|---|---|
| 0 (identity exists, e.g. left every workspace) | `200 { needsWorkspace: true, identityToken }` — a short-lived identity-only token (`type: 'identity'`) that can call only `GET /auth/me`, `POST /organisations` (create a personal workspace) and `POST /auth/invitations/accept`. No `orgId` claim, refused by `authenticate`. |
| 1 | tokens bound to that membership (today's behaviour, unchanged for every existing user — 46 of 46 have exactly one). |
| many | `200 { chooseWorkspace: true, identityToken, memberships: [...] }`; the client calls `POST /auth/workspaces/:orgId/session` with the identity token to obtain the workspace-bound pair. The client may remember the last workspace (`localStorage`/secure storage) and call the switch endpoint immediately to skip the picker. |

Suspended memberships are listed with `status` so the picker can explain; `left` ones are not listed. Mobile follows the same contract with the `x-octapm-client: mobile` channel (`routes/auth.js:48-61`) [C].

Policy at sign-in: `Organisation.mfaRequired` / `ssoRequired` (`schema.prisma:16-27`) are evaluated for the workspace being entered, at `POST /auth/workspaces/:orgId/session` as well as at single-workspace login.

---

## 7. Migration of existing rows and the §50 validation report

Backfill (M2 in the wave plan), idempotent `upsert` on `(orgId, userId)`:

```
for each User u:
  membership = { orgId: u.orgId, userId: u.id, role: u.role, kind: 'member',
                 isAdmin: u.isCompanyAdmin, isOwner: <rule below>, status: u.status === 'active' ? 'active' : 'suspended',
                 joinedAt: u.createdAt }
```

Owner rule [D]: per organisation, `isOwner = true` for the **earliest-created active user with `isCompanyAdmin = true`**; if an org has none, for the earliest-created active user with role `pm` (and set `isAdmin = true` on that row); if still none, the earliest-created active user of any role, flagged in the report. Result on the live data: 22 orgs get their single pm+admin as owner; "PMcopilots UAT Fixtures" gets its non-admin pm promoted (the one ambiguous case the identity analyst found) [C].

Validation report (`backend/scripts/enterprise/validate-membership-backfill.js --dry-run|--apply`), printed and written as JSON:

| Check | Expected | Failing case → action |
|---|---|---|
| users == memberships (1:1) | 46 == 46 | any user without a membership → stop |
| every membership.role in catalogue | 46 | role outside catalogue (`super_admin` or unknown) → stop, list |
| every org has ≥1 active owner | 23 | orgs with none after the rule → list (expected: 0) |
| every org has ≥1 active admin | 23 | UAT Fixtures before rule → resolved by rule; listed as "promoted" |
| isOwner ⇒ isAdmin | all | violation → stop |
| RefreshSession.orgId == membership.orgId for the user | 0 mismatches (0 today [C]) | mismatch → revoke session family |
| ProjectAssignment.user.membership(org == project.orgId) exists | 1,352 / 1,352 (0 cross-org today [C]) | missing → list (would block the M7 FK) |
| ProjectPartyMember user has a membership in the party's project org | 0 rows today | missing → create `guest` membership |
| ApiClient.owner membership exists in ApiClient.orgId | 38 / 38 | missing → key disabled, listed |
| Duplicate emails (case-insensitive) | 0 | any → stop |
| Organisation slug uniqueness after generation | 23 distinct | collision → suffix, listed |
| Orgs without the 12 system templates (79312790, a34432fd, 6193440d) [C] | listed as info | `seedDefaultTemplates` re-run for them in ENT-1 (idempotent by name) |

The report is re-run after M6 (dual-write) and after M8 (User columns nulled) and must be clean each time.

---

## 8. Audit events (§113)

All through `recordAuthAuditEvent` (`AuthAuditEvent`, `schema.prisma:800-828`) with `orgId` and new `membershipId?`:

`membership.invited`, `membership.invitation_accepted`, `membership.created` (direct add), `membership.role_changed` (from, to), `membership.admin_granted`, `membership.admin_revoked`, `membership.owner_granted`, `membership.owner_revoked`, `membership.suspended`, `membership.reactivated`, `membership.left`, `membership.removed`, `workspace.switched` (identity-level; orgId = target), `workspace.created` (personal/company), `organisation.converted` (personal → company; *as shipped in ENT-6: `workspace.converted`*), `session.workspace_issued`. Existing events (`login`, `invitation.sent`, etc.) are kept.

`AuditEvent` (`:830`) records the corresponding domain-level entries where the change is visible in the company workspace UI (user list), as `user.service.js` does today for role changes.

---

## 9. What is explicitly not built

- No second permission catalogue, no org-level permission templates beyond the existing `PermissionTemplate`; membership `role` is a catalogue role and the admin bypass is the same two modules.
- No cross-workspace "super user" or platform-admin role in the JWT; platform operations stay in scripts.
- No separate SSO link table: since D-ID-1 the subject is a column of the membership (`OrganizationMembership.ssoSubject`, §5.1), one link per person per workspace.
- No account creation by SSO, no administrator-set password, and no administrator e-mail change (§5).
