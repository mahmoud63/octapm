# BRD Gaps — User Management, Project/Activity & BOQ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps between the PM Copilots User-Stories BRD and the current codebase for Epic 1 (User Management), Epic 2 (Project/Activity), and the BOQ / Activity-Code module — excluding the Subscription module (see separate plan `2026-05-22-subscription-plans-module.md`).

**Architecture:** Express.js + Prisma backend, React 19 + TanStack Query/Router + shadcn frontend. Backend follows route → service → prisma layering with `express-validator`, `HttpError`, `sendSuccess`/`sendError`, `authenticate` + `requireRoles`. The repo currently has **no test framework** — Task 1 installs Jest + Supertest so later tasks can be test-driven.

**Tech Stack:** Node 20, Express 4, Prisma 6, Jest 29, Supertest 7, React 19, TanStack Query 5, axios, zod.

**Decisions locked with the user:**
- BOQ activity codes switch to BRD prefix-sequential format (`Concrete Works` → `CO-001`, `Steel Works` → `ST-001`).
- OTP / self-service forgot-password is a mobile-team flow — out of scope here. The BRD's PM-facing "Reset password" row action **is** in scope (Task 6).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `backend/package.json` | Add `jest`, `supertest`, `test` script | Modify |
| `backend/jest.config.js` | Jest config (node env) | Create |
| `backend/src/utils/activity-code.js` | Prefix-sequential activity-code generator | Replace |
| `backend/src/utils/__tests__/activity-code.test.js` | Unit tests for code generator | Create |
| `backend/src/services/boq.service.js` | Use new generator; reject duplicate BOQ codes; stop accepting editable activity codes | Modify |
| `backend/src/routes/boq.js` | Drop `activityCode` from manual-item required fields | Modify |
| `backend/src/services/user.service.js` | `updateUser`, `resetPassword`, sortable `listUsers` | Modify |
| `backend/src/routes/users.js` | `PATCH /:id`, `POST /:id/reset-password`, sort query params | Modify |
| `backend/src/services/activity.service.js` | Project-boundary dates become warnings, not hard errors | Modify |
| `frontend/src/features/users/hooks/use-users.ts` | `useUpdateUserMutation`, `useResetPasswordMutation`, sort params | Modify |
| `frontend/src/features/users/components/users-reset-password-dialog.tsx` | New PM reset-password dialog | Create |

---

## Task 1: Test Infrastructure (Jest + Supertest)

**Files:**
- Modify: `backend/package.json`
- Create: `backend/jest.config.js`
- Create: `backend/src/utils/__tests__/sanity.test.js`

- [ ] **Step 1: Install dev dependencies**

Run:
```bash
cd backend && npm install --save-dev jest@29 supertest@7
```
Expected: `package.json` `devDependencies` now lists `jest` and `supertest`.

- [ ] **Step 2: Add the test script**

In `backend/package.json`, add to the `"scripts"` block:
```json
    "test": "jest --runInBand",
    "test:watch": "jest --watch"
```

- [ ] **Step 3: Create `backend/jest.config.js`**

```js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  clearMocks: true,
  verbose: true,
};
```

- [ ] **Step 4: Create a sanity test `backend/src/utils/__tests__/sanity.test.js`**

```js
describe('test harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

Run: `cd backend && npm test`
Expected: PASS — `1 passed`.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/jest.config.js backend/src/utils/__tests__/sanity.test.js
git commit -m "test: add Jest + Supertest harness"
```

---

## Task 2: Prefix-Sequential Activity-Code Generator

The BRD requires activity codes derived from the BOQ item description: a 2-letter
uppercase prefix taken from the first word, then a zero-padded 3-digit sequence.
Sequence is **project-wide per prefix** so two items sharing a prefix never collide.

**Files:**
- Replace: `backend/src/utils/activity-code.js`
- Create: `backend/src/utils/__tests__/activity-code.test.js`

- [ ] **Step 1: Write the failing test `backend/src/utils/__tests__/activity-code.test.js`**

```js
const {
  deriveActivityPrefix,
  formatActivityCode,
} = require('../activity-code');

describe('deriveActivityPrefix', () => {
  it('takes the first two letters of the first word', () => {
    expect(deriveActivityPrefix('Concrete Works')).toBe('CO');
    expect(deriveActivityPrefix('Steel Works')).toBe('ST');
  });

  it('uppercases regardless of input casing', () => {
    expect(deriveActivityPrefix('concrete works')).toBe('CO');
  });

  it('pads a single-letter first word with X', () => {
    expect(deriveActivityPrefix('A frame')).toBe('AX');
  });

  it('falls back to AC when no letters are present', () => {
    expect(deriveActivityPrefix('123')).toBe('AC');
    expect(deriveActivityPrefix('')).toBe('AC');
    expect(deriveActivityPrefix(null)).toBe('AC');
  });

  it('ignores leading non-letters in the first word', () => {
    expect(deriveActivityPrefix('1.2 Excavation')).toBe('EX');
  });
});

describe('formatActivityCode', () => {
  it('zero-pads the sequence to three digits', () => {
    expect(formatActivityCode('CO', 1)).toBe('CO-001');
    expect(formatActivityCode('ST', 42)).toBe('ST-042');
    expect(formatActivityCode('CO', 1000)).toBe('CO-1000');
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `cd backend && npm test -- activity-code`
Expected: FAIL — `deriveActivityPrefix is not a function` (current file exports `generateActivityCode`).

- [ ] **Step 3: Replace `backend/src/utils/activity-code.js`**

```js
const { prisma } = require('../config/db');

/**
 * Derive a 2-letter uppercase prefix from a BOQ item description.
 * Uses the first two alphabetic characters of the first word.
 * "Concrete Works" -> "CO", "Steel Works" -> "ST", "1.2 Excavation" -> "EX".
 */
function deriveActivityPrefix(description) {
  const words = String(description ?? '').trim().split(/\s+/);
  for (const word of words) {
    const letters = word.replace(/[^a-zA-Z]/g, '').toUpperCase();
    if (letters.length >= 2) return letters.slice(0, 2);
    if (letters.length === 1) return `${letters}X`;
  }
  return 'AC';
}

/** Format a code: prefix + zero-padded 3-digit sequence. (CO, 1) -> "CO-001" */
function formatActivityCode(prefix, sequence) {
  return `${prefix}-${String(sequence).padStart(3, '0')}`;
}

/**
 * Compute the next sequential activity code for a project, scoped by prefix.
 * Pass the same `tx` used by surrounding writes so in-flight rows are counted.
 */
async function nextActivityCode(projectId, description, tx = prisma) {
  const prefix = deriveActivityPrefix(description);
  const existing = await tx.boqActivity.findMany({
    where: { projectId, activityCode: { startsWith: `${prefix}-` } },
    select: { activityCode: true },
  });

  let max = 0;
  for (const { activityCode } of existing) {
    const n = parseInt(activityCode.slice(prefix.length + 1), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }

  return formatActivityCode(prefix, max + 1);
}

module.exports = { deriveActivityPrefix, formatActivityCode, nextActivityCode };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm test -- activity-code`
Expected: PASS — all 8 assertions green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/activity-code.js backend/src/utils/__tests__/activity-code.test.js
git commit -m "feat(boq): prefix-sequential activity-code generator per BRD"
```

---

## Task 3: Wire New Generator into BOQ Service + Reject Duplicate Codes

The old `generateUniqueActivityCode` is referenced in three places in
`boq.service.js`. Each must switch to `nextActivityCode`. Also: the BRD requires
the upload to reject duplicate item IDs/codes, and treat the activity code as
non-editable.

**Files:**
- Modify: `backend/src/services/boq.service.js`
- Modify: `backend/src/routes/boq.js:95-98`

- [ ] **Step 1: Update the import in `boq.service.js:7`**

Replace:
```js
const { generateUniqueActivityCode } = require('../utils/activity-code');
```
with:
```js
const { nextActivityCode } = require('../utils/activity-code');
```

- [ ] **Step 2: Reject duplicate codes in `validateBoqRows` (`boq.service.js`)**

Replace the whole `validateBoqRows` function with:
```js
function validateBoqRows(rows) {
  const errors = [];
  const seenCodes = new Map(); // normalized code -> first rowIndex

  rows.forEach((row) => {
    const r = row.rowIndex;

    if (!row.code) errors.push({ row: r, field: 'code', message: 'Code is required' });
    if (!row.description) errors.push({ row: r, field: 'description', message: 'Description is required' });
    if (!row.unit) errors.push({ row: r, field: 'unit', message: 'Unit is required' });

    const qty = Number(row.quantity);
    if (isNaN(qty) || qty <= 0) {
      errors.push({ row: r, field: 'quantity', message: 'Quantity must be a positive number' });
    }

    const rate = Number(row.rate);
    if (isNaN(rate) || rate < 0) {
      errors.push({ row: r, field: 'rate', message: 'Rate must be a non-negative number' });
    }

    if (row.description && row.description.length > 500) {
      errors.push({ row: r, field: 'description', message: 'Description exceeds 500 characters' });
    }

    if (row.code) {
      const key = row.code.toString().trim().toLowerCase();
      if (seenCodes.has(key)) {
        errors.push({
          row: r,
          field: 'code',
          message: `Duplicate code "${row.code}" — also on row ${seenCodes.get(key)}`,
        });
      } else {
        seenCodes.set(key, r);
      }
    }
  });

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 3: Use `nextActivityCode` in the AI async loop (`processBoqAiAsync`)**

In `processBoqAiAsync`, the `savedItems` query selects only `id` and `code`.
Add `description`. Replace:
```js
    const savedItems = await prisma.boqItem.findMany({
      where: { projectId, isManual: false },
      select: { id: true, code: true },
    });
    const itemByCode = Object.fromEntries(savedItems.map((i) => [i.code, i.id]));
```
with:
```js
    const savedItems = await prisma.boqItem.findMany({
      where: { projectId, isManual: false },
      select: { id: true, code: true, description: true },
    });
    const itemByCode = Object.fromEntries(
      savedItems.map((i) => [i.code, { id: i.id, description: i.description }]),
    );
```

Then in the same function replace the loop body that resolves `boqItemId` and
generates `activityCode`. Replace:
```js
    for (const boqResult of parsed.boqActivities ?? []) {
      const boqItemId = itemByCode[boqResult.boqCode];
      if (!boqItemId) continue;

      const codes = [];
      for (let i = 0; i < (boqResult.activities ?? []).length; i++) {
        const act = boqResult.activities[i];
        const activityCode = await generateUniqueActivityCode(projectId);
        codes.push(activityCode);
```
with:
```js
    for (const boqResult of parsed.boqActivities ?? []) {
      const boqItem = itemByCode[boqResult.boqCode];
      if (!boqItem) continue;
      const boqItemId = boqItem.id;

      const codes = [];
      for (let i = 0; i < (boqResult.activities ?? []).length; i++) {
        const act = boqResult.activities[i];
        const activityCode = await nextActivityCode(projectId, boqItem.description);
        codes.push(activityCode);
```

- [ ] **Step 4: Use `nextActivityCode` in `createManualBoqItem`**

In `createManualBoqItem`, the activity code currently comes from `data.activityCode`.
Replace the `prisma.boqActivity.create` call inside it with:
```js
  // Activity code is auto-generated, never supplied by the client (BRD rule)
  const activityCode = await nextActivityCode(projectId, data.description);
  await prisma.boqActivity.create({
    data: {
      boqItemId: item.id,
      projectId,
      activityCode,
      activityName: data.activityName,
      unit: data.unit,
      quantity: Number(data.quantity),
      rate: Number(data.rate),
      budget: amount,
      isManual: true,
      sortOrder: 0,
    },
  });
```

- [ ] **Step 5: Use `nextActivityCode` in `createActivity`**

In `createActivity`, replace:
```js
  const count = await prisma.boqActivity.count({ where: { boqItemId } });
  const activityCode = await generateUniqueActivityCode(projectId);
```
with:
```js
  const count = await prisma.boqActivity.count({ where: { boqItemId } });
  const activityCode = await nextActivityCode(projectId, item.description);
```

- [ ] **Step 6: Make activity code non-editable in `updateActivity`**

In `updateActivity`, remove the line that allows `activityCode` updates:
```js
  if (data.activityCode !== undefined) updateData.activityCode = data.activityCode;
```
Delete that line entirely. The remaining `activityName`, `unit`, `quantity`,
`rate`, `dependencyType`, `predecessorCode` updates stay.

- [ ] **Step 7: Drop `activityCode` from manual-item required fields in `routes/boq.js`**

In `backend/src/routes/boq.js`, the `POST /items` handler currently requires
`activityCode`. Replace lines 95–98:
```js
    const { code, description, quantity, unit, rate, activityName, activityCode } = req.body;
    if (!code || !description || !quantity || !unit || !rate || !activityName || !activityCode) {
      throw new HttpError(400, 'MISSING_FIELDS', 'All fields are required');
    }
```
with:
```js
    const { code, description, quantity, unit, rate, activityName } = req.body;
    if (!code || !description || !quantity || !unit || !rate || !activityName) {
      throw new HttpError(400, 'MISSING_FIELDS', 'code, description, quantity, unit, rate and activityName are required');
    }
```

- [ ] **Step 8: Verify — unit + manual end-to-end check**

Run: `cd backend && npm test -- activity-code` → Expected: PASS (unchanged).

Then start the API (`cd backend && npm run dev`) and, with a valid PM token and
project ID, exercise the BOQ upload + manual-row flow:
```bash
# Upload a 2-row BOQ (Concrete Works, Steel Works), poll the job, then GET the BOQ
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:5000/api/v1/projects/$PROJECT_ID/boq | npx json
```
Expected: each item's `activities[].activityCode` matches `^[A-Z]{2}-\d{3}$`
(e.g. `CO-001`, `ST-001`). Re-upload a file containing two rows with the same
code → Expected: `400 BOQ_VALIDATION_FAILED` with a `Duplicate code` error.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/boq.service.js backend/src/routes/boq.js
git commit -m "feat(boq): use prefix-sequential codes, reject duplicate BOQ codes, lock activity code"
```

---

## Task 4: Edit Engineer Endpoint (`PATCH /users/:id`)

BRD 1.2 lists "Edit" as a per-row action. There is currently no update endpoint.

**Files:**
- Modify: `backend/src/services/user.service.js`
- Modify: `backend/src/routes/users.js`

- [ ] **Step 1: Add `updateUser` to `user.service.js`**

Add this function before `module.exports` and export it:
```js
const updateUser = async ({ orgId, userId, payload }) => {
  const user = await prisma.user.findFirst({ where: { id: userId, orgId } });
  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');

  const data = {};
  if (payload.name !== undefined) data.name = payload.name;
  if (payload.phone !== undefined) data.phone = payload.phone || null;

  if (payload.email !== undefined) {
    const normalized = payload.email.trim().toLowerCase();
    if (normalized !== user.email) {
      const clash = await prisma.user.findUnique({ where: { email: normalized } });
      if (clash) throw new HttpError(409, 'EMAIL_EXISTS', 'Email already exists');
      data.email = normalized;
    }
  }

  if (payload.role !== undefined) {
    if (!ALLOWED_ROLES.includes(payload.role)) {
      throw new HttpError(400, 'INVALID_ROLE', 'Role is invalid');
    }
    data.role = payload.role;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    include: { _count: { select: { projectAssignments: true } } },
  });

  return sanitizeUser(updated);
};
```
Add `updateUser` to the `module.exports` object.

- [ ] **Step 2: Add the `PATCH /:id` route to `routes/users.js`**

Insert after the `GET /:id` route:
```js
router.patch(
  '/:id',
  requireRoles('pm'),
  [
    param('id').isUUID(),
    body('name').optional().isString().trim().notEmpty(),
    body('email').optional().isEmail().normalizeEmail(),
    body('phone').optional().isString().trim(),
    body('role').optional().isString(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await userService.updateUser({
      orgId: req.user.orgId,
      userId: req.params.id,
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);
```

- [ ] **Step 3: Verify**

Start the API and run, with a PM token and an existing engineer's UUID:
```bash
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Updated Name","role":"site_engineer"}' \
  http://localhost:5000/api/v1/users/$USER_ID
```
Expected: `{"success":true,"data":{...,"name":"Updated Name","role":"site_engineer"}}`.
PATCH with an email already used by another user → Expected: `409 EMAIL_EXISTS`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/user.service.js backend/src/routes/users.js
git commit -m "feat(users): add PATCH /users/:id edit-engineer endpoint"
```

---

## Task 5: PM Reset-Password Endpoint (`POST /users/:id/reset-password`)

BRD 1.2 lists "Reset password" as a per-row action for the PM. The PM supplies a
new password for the engineer.

**Files:**
- Modify: `backend/src/services/user.service.js`
- Modify: `backend/src/routes/users.js`

- [ ] **Step 1: Add `resetPassword` to `user.service.js`**

```js
const resetPassword = async ({ orgId, userId, newPassword }) => {
  const user = await prisma.user.findFirst({ where: { id: userId, orgId } });
  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  return { id: user.id, reset: true };
};
```
Add `resetPassword` to `module.exports`.

- [ ] **Step 2: Add the route to `routes/users.js`**

Insert after the `PATCH /:id` route from Task 4:
```js
router.post(
  '/:id/reset-password',
  requireRoles('pm'),
  [
    param('id').isUUID(),
    body('newPassword')
      .isString()
      .isLength({ min: 8 })
      .matches(/[a-z]/)
      .withMessage('Password must contain a lowercase letter')
      .matches(/[0-9]/)
      .withMessage('Password must contain a number'),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await userService.resetPassword({
      orgId: req.user.orgId,
      userId: req.params.id,
      newPassword: req.body.newPassword,
    });
    return sendSuccess(res, result);
  }),
);
```

- [ ] **Step 3: Verify**

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"newPassword":"newpass123"}' \
  http://localhost:5000/api/v1/users/$USER_ID/reset-password
```
Expected: `{"success":true,"data":{"id":"...","reset":true}}`. Then log in as that
engineer with `newpass123` via `POST /auth/login` → Expected: success.
A weak password (`abc`) → Expected: `400 VALIDATION_ERROR`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/user.service.js backend/src/routes/users.js
git commit -m "feat(users): add PM-triggered reset-password endpoint"
```

---

## Task 6: Sortable Engineer List

BRD 1.2: "I can sort by: Name, Email, and Projects count." `listUsers` currently
hard-codes `orderBy: { createdAt: 'desc' }`.

**Files:**
- Modify: `backend/src/services/user.service.js`
- Modify: `backend/src/routes/users.js`

- [ ] **Step 1: Add sorting to `listUsers` in `user.service.js`**

Replace the `orderBy` line inside the `prisma.user.findMany` call. The function
currently does `orderBy: { createdAt: 'desc' }`. Replace the whole `listUsers`
body's query section so it reads:
```js
  const SORT_FIELDS = {
    name: { name: 'asc' },
    email: { email: 'asc' },
    projects: { projectAssignments: { _count: 'desc' } },
    created: { createdAt: 'desc' },
  };
  const sortKey = SORT_FIELDS[query.sortBy] ? query.sortBy : 'created';
  let orderBy = SORT_FIELDS[sortKey];
  if (query.sortDir === 'desc' && sortKey !== 'projects' && sortKey !== 'created') {
    orderBy = { [sortKey]: 'desc' };
  }
  if (query.sortDir === 'asc' && (sortKey === 'projects' || sortKey === 'created')) {
    orderBy = sortKey === 'projects'
      ? { projectAssignments: { _count: 'asc' } }
      : { createdAt: 'asc' };
  }

  const users = await prisma.user.findMany({
    where,
    take: take + 1,
    include: { _count: { select: { projectAssignments: true } } },
    orderBy,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
```
(Delete the previous `const users = await prisma.user.findMany({ ... orderBy: { createdAt: 'desc' } ... })` block.)

- [ ] **Step 2: Accept sort query params in `routes/users.js`**

In the `GET /` route's validator array, add before `validate`:
```js
    query('sortBy').optional().isIn(['name', 'email', 'projects', 'created']),
    query('sortDir').optional().isIn(['asc', 'desc']),
```

- [ ] **Step 3: Verify**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5000/api/v1/users?sortBy=name&sortDir=asc" | npx json items
```
Expected: `items` ordered alphabetically by `name`. Try `sortBy=projects` →
Expected: ordered by `projectCount` descending.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/user.service.js backend/src/routes/users.js
git commit -m "feat(users): support sorting engineer list by name/email/projects"
```

---

## Task 7: Activity Dates Outside Project → Warning, Not Hard Error

BRD 2.2: "If the activity dates outside project dates → the System must show a
**warning**." Current `assertDates` **throws** `400 INVALID_DATES` for project
boundary violations, which blocks creation. Only `endDate <= startDate` should
stay a hard error.

**Files:**
- Modify: `backend/src/services/activity.service.js`
- Create: `backend/src/services/__tests__/activity-dates.test.js`

- [ ] **Step 1: Write the failing test `backend/src/services/__tests__/activity-dates.test.js`**

```js
const { collectDateWarnings } = require('../activity.service');

const project = {
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
};

describe('collectDateWarnings', () => {
  it('returns no warnings when activity dates sit inside the project', () => {
    const w = collectDateWarnings({
      project,
      startDate: new Date('2026-02-01'),
      endDate: new Date('2026-03-01'),
    });
    expect(w).toEqual([]);
  });

  it('warns when the activity starts before the project', () => {
    const w = collectDateWarnings({
      project,
      startDate: new Date('2025-12-01'),
      endDate: new Date('2026-03-01'),
    });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/before the project/i);
  });

  it('warns when the activity ends after the project', () => {
    const w = collectDateWarnings({
      project,
      startDate: new Date('2026-02-01'),
      endDate: new Date('2027-01-15'),
    });
    expect(w[0]).toMatch(/after the project/i);
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `cd backend && npm test -- activity-dates`
Expected: FAIL — `collectDateWarnings is not a function`.

- [ ] **Step 3: Replace `assertDates` in `activity.service.js`**

Replace the entire `assertDates` function with these two functions:
```js
// Hard rule: end must be after start. Throws.
const assertDates = ({ startDate, endDate }) => {
  if (startDate && endDate && endDate <= startDate) {
    throw new HttpError(400, 'INVALID_DATES', 'endDate must be after startDate');
  }
};

// Soft rule: project-boundary breaches are warnings, not errors (BRD 2.2).
const collectDateWarnings = ({ project, startDate, endDate }) => {
  const warnings = [];
  if (startDate && project.startDate && startDate < project.startDate) {
    warnings.push('Activity start date is before the project start date.');
  }
  if (endDate && project.endDate && endDate > project.endDate) {
    warnings.push('Activity end date is after the project end date.');
  }
  return warnings;
};
```

- [ ] **Step 4: Use warnings in `createActivity`**

In `createActivity`, after `assertDates({ project, startDate, endDate });` is
currently called as `assertDates({ project, startDate, endDate })` — change it
to drop `project` (no longer used by `assertDates`) and collect warnings:
```js
  assertDates({ startDate, endDate });
  const dateWarnings = collectDateWarnings({ project, startDate, endDate });
```
Then change the function's return so warnings travel back. Replace the final
`return sanitizeActivity(activity);` in `createActivity` with:
```js
  return { ...sanitizeActivity(activity), warnings: dateWarnings };
```

- [ ] **Step 5: Update `updateActivity`'s call site**

In `updateActivity`, replace:
```js
  assertDates({ project, startDate: nextStartDate, endDate: nextEndDate });
```
with:
```js
  assertDates({ startDate: nextStartDate, endDate: nextEndDate });
```
(`project` is still fetched for `ensureProject`; the unused binding is harmless,
but if lint complains, the `project` variable is still used by `ensureProject`'s
return — keep it.)

- [ ] **Step 6: Export `collectDateWarnings`**

Add `collectDateWarnings` to the `module.exports` object in `activity.service.js`.

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd backend && npm test -- activity-dates`
Expected: PASS — 3 assertions green.

- [ ] **Step 8: Manual verify**

Start the API. Create an activity whose `endDate` is after the project `endDate`:
```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Late activity","startDate":"2026-02-01","endDate":"2030-01-01","engineerIds":["'$ENG_ID'"]}' \
  http://localhost:5000/api/v1/projects/$PROJECT_ID/activities
```
Expected: `201` with `data.warnings` containing "after the project end date" —
**not** a `400`. An activity with `endDate <= startDate` → still `400 INVALID_DATES`.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/activity.service.js backend/src/services/__tests__/activity-dates.test.js
git commit -m "feat(activities): project-boundary date breaches are warnings not errors (BRD 2.2)"
```

---

## Task 8: Frontend — Edit, Reset Password & Sorting in Users Feature

Wire the three new backend capabilities into the existing Users feature.

**Files:**
- Modify: `frontend/src/features/users/hooks/use-users.ts`
- Create: `frontend/src/features/users/components/users-reset-password-dialog.tsx`
- Modify: `frontend/src/features/users/components/users-dialogs.tsx` (mount the new dialog)
- Modify: `frontend/src/features/users/components/data-table-row-actions.tsx` (add "Edit" + "Reset password" menu items)

> Before editing the dialog/row-action components, **read them first** — they are
> existing shadcn components and the executor must match their prop shapes.

- [ ] **Step 1: Add hooks to `use-users.ts`**

Extend `UsersQueryParams` and append the mutations:
```ts
export type UsersQueryParams = {
  status?: string
  search?: string
  role?: string
  sortBy?: 'name' | 'email' | 'projects' | 'created'
  sortDir?: 'asc' | 'desc'
}

export const useUpdateUserMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      userId,
      payload,
    }: {
      userId: string
      payload: { name?: string; email?: string; phone?: string; role?: string }
    }) => apiClient.patch(`/users/${userId}`, payload).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export const useResetPasswordMutation = () =>
  useMutation({
    mutationFn: ({ userId, newPassword }: { userId: string; newPassword: string }) =>
      apiClient
        .post(`/users/${userId}/reset-password`, { newPassword })
        .then((r) => r.data.data),
  })
```

- [ ] **Step 2: Create `users-reset-password-dialog.tsx`**

```tsx
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { useResetPasswordMutation } from '../hooks/use-users'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  userName: string
}

export function UsersResetPasswordDialog({ open, onOpenChange, userId, userName }: Props) {
  const [password, setPassword] = useState('')
  const resetPassword = useResetPasswordMutation()

  const valid = password.length >= 8 && /[a-z]/.test(password) && /[0-9]/.test(password)

  const handleSubmit = () => {
    resetPassword.mutate(
      { userId, newPassword: password },
      {
        onSuccess: () => {
          toast.success(`Password reset for ${userName}`)
          setPassword('')
          onOpenChange(false)
        },
        onError: () => toast.error('Could not reset password'),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for {userName}. They will use it on their next login.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-2'>
          <Label htmlFor='new-password'>New password</Label>
          <Input
            id='new-password'
            type='password'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder='At least 8 chars, 1 letter, 1 number'
          />
          {password.length > 0 && !valid && (
            <p className='text-destructive text-sm'>
              Must be 8+ characters and include a lowercase letter and a number.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || resetPassword.isPending} onClick={handleSubmit}>
            {resetPassword.isPending ? 'Resetting…' : 'Reset password'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```
> If the project uses a different toast library than `sonner`, match the import
> used elsewhere in `frontend/src/features` (grep for `toast`).

- [ ] **Step 3: Wire "Edit" and "Reset password" into the row actions**

Read `data-table-row-actions.tsx`. It already drives Deactivate/Activate via the
users provider/dialog state. Add two menu items — "Edit" (opens the existing
`users-action-dialog` in edit mode) and "Reset password" (opens
`UsersResetPasswordDialog`). Follow the exact dialog-state pattern already in
`users-provider.tsx` / `users-dialogs.tsx`: add an `'edit'` and `'resetPassword'`
open-state, render `UsersResetPasswordDialog` from `users-dialogs.tsx`, and have
the edit path call `useUpdateUserMutation`.

> `users-action-dialog.tsx` is the existing add-engineer form. Confirm whether it
> already supports an edit mode (a `currentRow`/`user` prop). If it does, reuse it
> and switch its submit to `useUpdateUserMutation` when a user is passed. If it
> does not, add an optional `user` prop: when present, pre-fill fields, hide the
> password field, and submit via `useUpdateUserMutation`.

- [ ] **Step 4: Add sort controls to the users table header**

In `users-table.tsx` / `users-columns.tsx`, the table uses TanStack Table. Enable
column sorting on the Name, Email and Projects columns (`enableSorting: true`)
and pass the active sort state into `useUsersQuery` as `sortBy`/`sortDir` so the
server sorts. Map TanStack column ids → API `sortBy` values
(`name`→`name`, `email`→`email`, `projectCount`→`projects`).

- [ ] **Step 5: Verify in the browser**

Run: `cd frontend && npm run dev`. Open the Users page.
- Click a row's "⋯" → "Edit" → change the name → save → row updates.
- Click "⋯" → "Reset password" → enter `newpass123` → success toast.
- Click the Name column header → list re-sorts alphabetically (network tab shows
  `?sortBy=name&sortDir=asc`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/users
git commit -m "feat(users): wire edit, reset-password and sorting into Users UI"
```

---

## Self-Review

**Spec coverage (BRD Epic 1, Epic 2, BOQ):**
- 1.1 Create engineer — already implemented; no task needed. ✓
- 1.2 View/manage list — sorting added (Task 6); Edit (Task 4) + Reset password (Task 5) endpoints + UI (Task 8). ✓
- 1.3 / 1.4 Deactivate/Reactivate — already implemented. ✓
- 2.1 Create project — already implemented. ✓
- 2.2 Create activity — implemented; project-boundary warning fixed (Task 7). ✓
- 2.3 / 2.4 Materials & Equipment — already implemented. ✓
- BOQ upload/validation/editable table — implemented; activity-code format (Tasks 2–3) + duplicate-code rejection (Task 3) + non-editable code (Task 3). ✓
- **Out of scope (documented):** OTP / self-service forgot-password (mobile-team flow); Subscription module (separate plan).

**Placeholder scan:** No TBD/TODO; every code step carries complete code.

**Type consistency:** `nextActivityCode(projectId, description, tx?)` defined in
Task 2, called consistently in Task 3. `collectDateWarnings({project,startDate,endDate})`
defined and called consistently in Task 7. `useUpdateUserMutation` /
`useResetPasswordMutation` defined in Task 8 Step 1, consumed in Steps 2–3.

---

## Execution Handoff

See the bottom of `2026-05-22-subscription-plans-module.md` for the combined
execution-approach choice — both plans share one decision.
