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

Status meanings: `invited` (row created on invitation, no access), `active`, `suspended` (org admin paused this person; token refused), `left` (person left or was removed; row kept for audit, unique still holds — re-invitation flips it back to `invited`).

---

## 2. Role and admin move from User to membership (§9-§12)

| Today [C] | Target [D] |
|---|---|
| `User.role` global (`schema.prisma:163`); `getEffectiveRole = req.projectAccess.role \|\| req.user.role` (`rbac.js:18-19`) | `req.user.role` = membership role. `getEffectiveRole` unchanged. |
| `User.isCompanyAdmin` (`:164`); read at ~40 sites (audit table "Where role and isCompanyAdmin are read as GLOBAL facts") | `req.user.isCompanyAdmin = membership.isAdmin \|\| membership.isOwner`. Property name kept so those sites compile unchanged; each is reviewed in ENT-2 only to confirm it wants "admin in the active workspace", which all of them do. |
| `ProjectAssignment.role` per project (`:698-709`); equals the global role on every live row [C] | unchanged: project role still overrides membership role inside a project (`assertProjectAccess :167`). |
| `ProjectUserPermission` template per project (`:6600`) | unchanged. |
| `ProjectParty` / `ProjectPartyMember` | unchanged; the member holds a `guest` membership. |
| SSO auto-provision writes `User.role = org.ssoDefaultRole` (`sso.service.js:240`) | writes a membership with that role in the SSO org. |
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

Target rules [D]:

| Situation | Behaviour |
|---|---|
| Invite an email with no User | `InvitationToken` as today (`user.service.js:340-470`: hashed token, 7 days, revoke previous pending for same org+email [C]); acceptance creates User + membership `active` in `invitation.orgId`, plus ProjectAssignment / party member / CompanyMembership as today (`auth.service.js:1005-1089`). |
| Invite an email that already has a User in **another** org | allowed (the 409 sites are removed). Acceptance requires the invitee to sign in as that identity (or prove the email via the token link while signed out → sign-in prompt), then creates a second membership. Their existing memberships are untouched. |
| Invite an email that already has a membership in **this** org | `active` → 409 `ALREADY_MEMBER`; `left`/`suspended` → re-invite flips to `invited` and a new token is issued; `invited` → previous token revoked, new one issued (existing behaviour). |
| `POST /users` (direct create, `user.service.js:189-194`) with an existing email | creates a membership for the existing identity instead of a User; response says `existingIdentity: true`; password fields ignored. Never overwrites the identity's name or password. |
| Register (`auth.service.js:290-338`) with an existing email | 409 `EMAIL_ALREADY_EXISTS` **kept**: registration creates identities; workspaces for an existing identity come from `POST /organisations` (create a personal/company workspace) while signed in. |
| SSO callback with an email that exists elsewhere (`sso.service.js:222-243`) | allowed: link `ssoSubject` to the identity if unlinked, create membership in the SSO org with `ssoDefaultRole`. If the identity already has a different `ssoSubject`/provider, refuse `403 SSO_IDENTITY_CONFLICT` (identity-level conflict, not tenancy). |
| Case-insensitive duplicates | none exist (0 locally [C]); email normalised to lower-case at every entry point (already `normalizeEmail` pattern in `auth.service.js`). |
| Invitation cannot confer `isAdmin`/`isOwner` | kept (today it cannot confer `isCompanyAdmin` [C]); admin is granted after joining by an owner/admin. |

`InvitationToken` (`schema.prisma:759-798`) is reused unchanged; it already spans org + optional project + company + party [C]. Add `membershipId?` filled on acceptance.

### 5.1 Identity standing, acceptance proof and standing grants (ENT-2 review decisions) [D]

- **`User.status` belongs to the identity's home workspace** (`User.orgId`), as name, email and password already do. Deactivation closes the identity only from home and only when no other active membership remains; reactivation from another workspace reopens that workspace's membership and answers `403 FORBIDDEN` when the identity itself is closed; a re-invitation from home reopens the identity (new password, `status = active`, the pre-membership contract) and a re-invitation from anywhere else is refused `403 USER_INACTIVE`. `resolveSessionPrincipal` refuses a session for an inactive identity on every path.
- **Acceptance by an existing identity requires proof** that the caller is that identity: an `Authorization` bearer for the same `sub` (an access or identity token) on `POST /auth/invitations/accept`, or the account password in the body (compared, never rewritten). Otherwise `401 INVITATION_SIGN_IN_REQUIRED`. The preview reports `requiresPassword: true` for every invitation so a client without a session asks for it. A brand-new identity still sets its password with the token alone.
- **An active member's role is not re-graded by an invitation.** A project or party invitation to someone already an active member assigns the project and leaves the membership (and the home `User.role`) alone; role changes go through `changeMembership`, with its guards and `membership.role_changed`.
- **Only an owner grants or revokes `isAdmin`**, as §2.1 lists, not merely `isOwner`: two PMs must not be able to make each other administrators (`403 OWNER_REQUIRED`). In a workspace with no membership rows of its own (seeded before the backfill, no owner exists) a company administrator grants it, as before.
- **SSO subject matching is issuer-scoped**: the identity is found by email; a subject match speaks only for an identity this organisation's IdP linked (`User.orgId` or a membership here), and then a different email is `403 SSO_IDENTITY_CONFLICT`. Another organisation's IdP issuing the same subject string is not a conflict.

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
- No per-membership SSO subject table until a second IdP per identity is required.
