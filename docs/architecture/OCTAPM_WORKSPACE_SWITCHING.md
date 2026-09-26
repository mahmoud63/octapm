# OctaPM workspace switching — web and mobile (ENT-0 design)

[C] = confirmed at the cited line, [I] = inferred, [D] = decision.

## 0. Today

Neither client has a workspace concept. The org is an attribute of the signed-in user (`frontend/src/services/auth/types.ts:3`; `mobile/src/auth/store.ts:22`) [C]. Web: active project = route param `/projects/$projectId` (`components/layout/project-switcher.tsx:31-32`); 414 query keys, none with `orgId`; cache cleared only when `user.id` changes (`main.tsx:84-86`) or on sign-out (`sign-out-dialog.tsx:29`); outbox items carry `projectId` and no owner (`lib/offline/outbox.ts:35-58`); service worker caches `GET /api/v1/*` by URL for 24 h (`sw.ts:65-86`); `joinedProjects` never cleared (`lib/realtime.ts:81, 116-121`) [C]. Mobile: `currentProjectId` persisted at `session.project` (`projects/store.ts:22-52`); read cache `cache:v1:{userId}` (`offline/persist.ts:20`); outbox owner `outbox:v1:owner = userId` (`offline/outbox.ts:64-65, 126-137`); one socket room, the current project (`realtime/index.ts:114-136`) [C].

---

## 1. State model [D]

| State | Web | Mobile |
|---|---|---|
| `activeOrganizationId` (+ `membershipId`, `orgSlug`, `orgKind`, `role`, `isAdmin`, `isOwner`) | in `auth-store` as `session.workspace`, **derived from the URL** segment `/o/$orgSlug` on load; the JWT in memory is the one bound to that membership | in `auth store` `session.workspace`; persisted with the profile at `session.profile` |
| `activeProjectId` | route param under `/o/$orgSlug/projects/$projectId` (no store, as today) | `projects/store.ts` `currentProjectId`, persisted at `session.project` **together with the orgId it belongs to** (`{ projectId, orgId }`) |
| Memberships list | `GET /auth/me.memberships`, query key `['me']` (identity-level, survives a switch) | same |
| Last workspace | `localStorage octa.lastWorkspace` (slug) — per-viewer convenience only | secure storage `session.lastWorkspace` |

The URL is the source of truth on web: opening `/o/acme/projects/123/boq` while signed in as a member of `acme` and `beta` first ensures the session is bound to `acme` (silent switch if needed), then renders. This is what makes browser Back correct (§108) — Back to a `/o/beta/...` URL re-triggers the same guard and switches back.

---

## 2. The switch — server contract

`POST /auth/workspaces/:orgId/session` (authenticated with any valid access token *or* an identity token from login §116):

1. Verify `sub` has an active membership in `:orgId`; evaluate the target org's MFA/SSO policy (`Organisation.mfaRequired`, `ssoDomainsJson`, `schema.prisma:16-27`).
2. Mint a new access + refresh pair bound to that membership (`mid`), same channel (`cli`) as the caller; revoke nothing (the other workspace's refresh family stays valid so the client can switch back without re-login — a family per (device, membership)).
3. Record `workspace.switched`.
4. Respond `{ accessToken, user, workspace, memberships }` (web: refresh cookie replaced; mobile: refresh in body).

`RefreshSession` is per membership; `GET /auth/sessions` lists them per workspace; sign-out revokes all families for the device (existing family model, `auth.service.js:513-523`) [C].

---

## 3. What a switch must clear / invalidate / leave / join (§17)

Order matters; both clients implement the same sequence in one function (`switchWorkspace(target)`):

| Step | Web | Mobile |
|---|---|---|
| 1. Freeze | set `switching=true` (blocks queries and outbox replay) | same |
| 2. Leave realtime | `realtime.leaveAll()` — emit `project:leave` for every id in `joinedProjects`, then **clear the set** (`lib/realtime.ts:81`) | `realtime.leaveCurrent()` (`realtime/index.ts:138-160`) |
| 3. Outbox | `outbox.lock(previousOwnerKey)`: pending items are kept, tagged `ownerKey = userId:orgId` (items already carry it, §4), and excluded from replay | `outbox.lock()` — same; owner becomes `userId:orgId` |
| 4. Token | `POST /auth/workspaces/:id/session` → `auth.setSession(...)` | same; `rememberProfile`, refresh token to keychain |
| 5. Caches | `queryClient.clear()` — the identity-change subscription at `main.tsx:84-86` compares `membershipId` instead of `user.id`; `caches.delete('octapm-api')` (reuse `clearOfflineData` minus the outbox wipe, `outbox.ts:176-191`) | `forgetEverything()` (`api/query.ts:61`); persisted read cache re-keyed `cache:v1:{userId}:{orgId}` — the previous workspace's document is left on disk, the target's is restored (`offline/index.ts:38-46`) |
| 6. Project | navigate to `/o/{slug}` (workspace home) unless the target URL names a project of the target org | `useProjectStore.clear()` then hydrate `{projectId, orgId}` only if `orgId === target` |
| 7. Realtime | `realtime.connect(newToken)` (reconnects on token change, `lib/realtime.ts:96-105`) [C]; project rooms are re-joined by `ProjectDetail` mount as today (`use-realtime.ts:81-98`) | `follow()` reconnects on store change (`realtime/index.ts:175-186`) [C] |
| 8. Outbox | `outbox.unlock(newOwnerKey)` → replay items whose `ownerKey` matches | same |
| 9. Per-viewer prefs | `octa.quickActions.projectId` self-heals (`quick-actions.tsx:100-102`) [C]; per-project keys are uuid-keyed and harmless; `octa.lastWorkspace = slug` | `session.inventory` (warehouse per project) uuid-keyed, harmless; `session.drawings` recents filtered by active org on read |
| 10. Unfreeze | `switching=false` | same |

Sign-out clears everything for the identity as today (`clearOfflineData`, `forgetEverything`, `outbox` wipe) plus the last-workspace hint.

Role/permissions after a switch: `useCanPerform` global fallback (`frontend/src/lib/permissions.ts:184-211`) reads `session.workspace.role`; mobile `roleNav` (`navigation/roleNav.ts:100-106`) and `usePermissions` (`permissions/usePermissions.ts:33, 52`) read the same; `['permissions', projectId, 'me']` and `['permissions','org']` are gone with the cache clear and refetch.

---

## 4. Offline-queue rules (§18) [D]

1. Every outbox item carries `ownerKey = userId:orgId` (web `lib/offline/outbox.ts:35-58` gains it; mobile `offline/outbox.ts:27-51` gains `orgId`, owner key becomes `userId:orgId`).
2. Replay runs only for items whose `ownerKey` equals the active session's; others stay queued and visible in the outbox screen under their workspace name with a "Switch to <workspace> to send" action.
3. `startOutbox()` no longer runs before a session exists (`main.tsx:115` moves behind the auth-ready gate); until the session is known nothing is replayed.
4. A different **identity** signing in on the same browser/device wipes the queue (mobile already does, `outbox.ts:126-137` [C]; web adopts the same rule). A different **workspace** of the same identity locks, never wipes.
5. Items are validated on replay: the server answers 404 for a project outside the token's org (`assertProjectAccess`) — the item is marked `conflict: 'wrong_workspace'` rather than retried.
6. The service-worker read cache is per workspace: request URLs are already under `/o/{slug}`-free API paths, so the cache key gains the `orgId` from the token via a header the SW reads (`x-octapm-workspace`), or simpler [D]: the cache is dropped on every switch (step 5) and rebuilt. The 8 s network timeout fallback (`main.tsx:56-65`) can then never serve another workspace's list.

---

## 5. Deep links and browser Back (§107-§108) [D]

- Canonical web URL: `/o/{orgSlug}/...` for every authenticated route. `Organisation.slug` is unique (matrix §2). Legacy links `/projects/:id/...` (all notification/email links today, `utils/record-links.js:88-102` [C]) are redirected by a route guard that calls `GET /auth/workspaces/resolve?projectId=` → `{ orgId, slug }` and replaces the URL (same `replace: true` pattern as the legacy `?module=` redirect, `routes/_authenticated/projects/$projectId.tsx:37-69` [C]).
- A link into a workspace the identity is not a member of → `/o/{slug}` is unreachable → "You are not a member of this workspace" page with the memberships list; never a silent fallback to another workspace.
- A link into a project the member cannot open → existing `Project access restricted` / `Project not found.` states (`project-detail.tsx:729-750`) [C], plus a "Back to <workspace>" action.
- Browser Back across a switch: because the switch is URL-driven (§1), Back lands on the previous `/o/{other}` URL and the guard performs the reverse switch (with the token for that membership fetched again — cheap, one request). Record-in-URL behaviour (`hooks/use-record-in-url.ts:10-14`, replaceState so Back does not close dialogs) is unchanged. A Playwright spec asserts: open record in A → switch to B → Back → A's record dialog is open again.
- Mobile deep links carry `orgId` (`mobile/src/navigation/deepLinks.ts`); `/open` (`app/(app)/open.tsx:41-53`) becomes: if `orgId !== active` → `switchWorkspace(orgId)` → `GET /projects/:id` → `store.select` → record route. Push payload gains `orgId`/`orgSlug` (`push.service.js:140-152`), `routeForNotificationResponse` reads it.
- Notification `actionUrl` and email links are built once, in `recordWorkspacePath`, with the slug.

---

## 6. Switcher and create-menu IA (§15-§16, §21-§23, §30) [D]

Header (`components/layout/top-navbar.tsx:409-461` today: logo → `/`, ProjectSwitcher hidden below md, Work nav, Settings, Help, status, search, assistant, notifications, theme, user menu) [C] becomes:

```
[Logo] [Workspace ▾ Acme Contracting · Company] [Project ▾ Riverside Tower] | Work nav … | [+ Create ▾] … [user ▾]
```

- **Workspace switcher**: name + kind badge (Personal / Company), list of memberships with role, "Create workspace" (personal), "Convert to company" (owner of a personal workspace), "Workspace settings" (admin). Always visible, also below `md` (the project switcher stays hidden below md as today; on mobile widths the workspace name moves into the sheet menu).
- **Project switcher**: unchanged component, list filtered to the active workspace (already, since `/projects` is org-scoped).
- **+ Create** (replaces the dashboard-only quick actions as the primary entry; `features/dashboard/quick-actions.tsx` keeps rendering the same list on the dashboard): *Project* (workspace; needs `project` create), *Invite people* (admin; on a personal workspace opens the conversion prompt), *Company workspace* (from personal), then the record quick actions grouped by module and gated by `canPerform(role, module, 'create')` with the remembered project (`octa.quickActions.projectId`) and a project picker when none.
- The user menu lists memberships as a secondary switcher and "Sign out of all workspaces".

Mobile: a "Workspace" row at the top of `projects.tsx` and in `more.tsx` opens the same picker; the Projects tab lists the active workspace's projects; `_layout.tsx` (`app/(app)/_layout.tsx:27-47`) gates on `hasProject && project.orgId === active.orgId`.

---

## 7. The three dashboard levels (§24-§29) mapped onto what exists

| Level | Route | Exists today | Change |
|---|---|---|---|
| **L1 — Home (identity)** | `/home` (outside `/o/`) | no | New, small: memberships with kind/role, unread notifications per workspace, "needs you" counts per workspace. Backed by one endpoint `GET /me/home` that iterates the identity's active memberships and calls the existing per-org queries (`workspace-dashboard.service.js` "my open items", `notification.service` unread count) under each membership's org — no cross-org query is written; it is N scoped queries. Shown when the identity has >1 membership; otherwise login lands on L2. |
| **L2 — Workspace dashboard** | `/o/{slug}` | yes: `features/dashboard/index.tsx:226-235` ← `GET /projects/workspace-dashboard` (`routes/projects.js:169`; portfolio summary, KPIs, health dimensions, workflow queues, per-project health, my open items, quick actions) [C] | Header shows workspace name/kind; personal workspaces hide the company-only tiles (workflow queues, portfolio) until they have >1 project. `/portfolio` (`features/reports/portfolio-page.tsx`) stays a workspace report reached from L2. |
| **L3 — Project overview** | `/o/{slug}/projects/{id}` | yes: `project-detail.tsx:159, 688` Overview module; `/projects/:id` redirects to `schedule/gantt` (`routes/.../$projectId/index.tsx:9-19`) [C] | Landing becomes the Overview module (setup readiness bar + Project Controls summary, see `OCTAPM_BOQ_SCHEDULE_INTEGRATION.md` §2) instead of the Gantt redirect. |

---

## 8. Tests that prove it (referenced by the wave plan)

- Playwright `e2e/40-workspace-switch.spec.ts`: §51 persona (one email, member of two orgs with different roles) — switch, assert header, assert `['projects']` list differs, assert a queued offline write in A is not sent in B and is sent after switching back, assert Back restores A.
- Playwright `e2e/41-deep-links-across-workspaces.spec.ts`: legacy `/projects/:id` link → redirected to `/o/{slug}/projects/:id`; link into a non-member workspace → membership error page.
- Mobile Jest: `deepLinks.test.ts` and `push.test.ts` (`mobile/src/notifications/push.test.ts:70-72` pattern) with `orgId` in payloads; `outbox.test.ts` owner-key lock/unlock.
- Backend live test: `POST /auth/workspaces/:id/session` for a non-member → 403; token from A used on B's project → 404 (existing `assertProjectAccess` semantics).
