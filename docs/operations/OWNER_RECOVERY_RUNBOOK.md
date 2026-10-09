# Sole-owner recovery runbook

**Audience:** OctaPM support operators.
**Applies to:** `npm run ops:recover-owner` (`backend/src/cli/recover-owner.js`, `backend/src/services/owner-recovery.service.js`), added by the D-ID-1 identity batch (owner decision Q13, 2026-10-05).
**Not in any UI.** The command runs from a shell with database access. No web page, API route or mobile screen can start, approve or see a recovery.

---

## 1. What it does, and what it never does

The command makes **one existing, active member** of **one workspace** its owner and administrator, after two operators have confirmed the request.

It changes exactly this:
- the person's membership in that workspace: `isOwner = true`, `isAdmin = true`;
- if that workspace is the person's home workspace, the legacy column `User.isCompanyAdmin = true`.

It never:
- sets, resets or shows a password;
- changes anyone's e-mail address;
- adds, removes or resets a second factor;
- creates, ends or prints a session or token;
- prints any secret (only ids, the expiry time and the outcome are printed);
- creates a person or a membership, or reactivates a suspended one;
- demotes or removes the previous owner.

---

## 2. When it applies

Use it only when **all** of these hold:

1. The workspace has **one** owner (or every owner is in the same situation).
2. That owner cannot sign in: they have lost access to their mailbox **and** their password, or their mailbox **and** their second factor (authenticator and backup codes). With the mailbox alone, self-service "Forgot password?" works and this runbook does not apply.
3. Nobody else in the workspace can fix it. An administrator cannot set another person's password or change their e-mail (by design), and only an owner can grant ownership or administration.
4. Another person in the workspace is an **active member** (not a guest, not suspended, not pending an invitation) and is the person the company names to take ownership.

If no active member exists yet, the company's administrator (if any) or the owner cannot invite one; support cannot add people. Escalate to the product owner; do not improvise with SQL.

Do not use it for: a forgotten password (self-service reset), a person who wants a new e-mail (invite at the new address, see the admin guide), a dispute between two people in the same company about who should own the workspace (escalate to the account's contract holder and the product owner), or any workspace you have not verified as below.

---

## 3. Identity verification (before any request)

Support verifies the request **outside the product**, records the evidence on the support ticket, and only then runs `request`. The ticket must show:

1. **Who is asking.** The requester's name, role in the company and how they contacted support.
2. **At least two independent proofs** that the company asking is the company that owns the workspace, from different channels, for example:
   - a confirmation from the **billing or contract contact on record** (the contact on the Stripe customer, the signed order form or contract), reached through the contact details **already on record**, never through details supplied in the request;
   - a reply from a corporate e-mail address on the company's own domain that matches the workspace's company, sent by someone other than the requester or confirmed by phone through the company's published switchboard;
   - a live video or phone call with the requester, who answers questions about the workspace that are not public (project names, the approximate number of people, the plan, the last invoice amount);
   - a signed letter on company letterhead from a company officer naming the person to make owner.
   The two proofs must come from different people or different channels. A single e-mail thread is one proof, however many messages it holds.
3. **The lost owner.** Evidence that the current owner cannot recover (their own statement if reachable, or the company's statement that they have left or lost access) and, where reachable, the owner's consent. If the current owner is reachable and objects, stop and escalate.
4. **The person to make owner.** Their name and the sign-in e-mail of their OctaPM account, confirmed by the company (proof from step 2), and confirmation that they are an active member of the workspace (step 4 below).
5. **The ticket reference**, which goes into the command.

A second support operator reviews the ticket evidence before approving (section 6). If any proof is missing or inconsistent, do not request.

---

## 4. Who may be an operator

An operator is an OctaPM identity that is:
- listed in the environment variable `RECOVERY_OPERATOR_EMAILS` (comma-separated sign-in e-mails) **of the process that runs the command**; only the command reads it, never the API;
- `active`;
- enrolled in two-factor authentication.

Each step asks for a **current six-digit code from the operator's authenticator app** (`--totp`). Backup codes are not accepted. A code works once: the same code cannot be used twice, so an operator who requests and approves (outside production only) waits for the next code.

Operators do not need a membership in the workspace being recovered. Keep the list short, named people only, and remove people from it when they leave support.

---

## 5. Look up the ids (read only)

The command takes ids, not names. From a read-only database session:

```sql
-- the workspace and its people
SELECT o.id AS org_id, o.name, o.slug, o.status AS org_status,
       u.id AS user_id, u.email, u.status AS identity_status,
       m.role, m.kind, m.status AS membership_status, m."isOwner", m."isAdmin"
FROM "OrganizationMembership" m
JOIN "User" u ON u.id = m."userId"
JOIN "Organisation" o ON o.id = m."orgId"
WHERE o.slug = '<workspace slug>'      -- or o.id = '<org id>'
ORDER BY m."isOwner" DESC, m."isAdmin" DESC, u.email;
```

Check: the workspace is `active`; the person to make owner has `kind = member`, `membership_status = active`, `identity_status = active`; the e-mail matches the one the company confirmed. Record `org_id` and `user_id` on the ticket.

---

## 6. The two commands

Run from the backend directory of the deployed image (in production as a one-off task, the same way as `npm run admin:bootstrap`), with the production `DATABASE_URL`, `MFA_SECRET_KEY` and `RECOVERY_OPERATOR_EMAILS` set.

**Step 1: the first operator records the request.**

```bash
npm run ops:recover-owner -- request \
  --org <org id> --user <user id> \
  --ticket <ticket reference> \
  --reason "<what was verified, in a sentence or two>" \
  --operator <first operator's sign-in e-mail> --totp <current code>
```

- `--ticket` is required (at most 120 characters). `--reason` is required (10 to 1,000 characters); write what was verified, not just "owner lost access".
- The person must be an active member of that workspace at this moment, or the request is refused.
- Output: the request id and its expiry. Copy the request id to the ticket.

**Step 2: a second operator reviews the ticket and approves.**

```bash
npm run ops:recover-owner -- approve \
  --request <request id> \
  --operator <second operator's sign-in e-mail> --totp <current code>
```

- **Two-person approval is mandatory in production.** The approver must be a different operator from the requester; the same operator is refused. Outside production only, a request made with `--single-operator` may be approved by the same operator (for rehearsals and tests); in production `--single-operator` is refused.
- A request **expires 24 hours** after it was recorded. An expired request is refused; make a new one.
- A request is carried out **once**. Approving it again is refused.
- The person must still be an active member at approval time; this is checked again.
- Output: confirmation that the person is now owner and administrator of the workspace.

**Refusals** (a refused step writes no request, no change and no audit row; the command prints the code and exits 1). A valid operator code is checked before the workspace and the person and is used up even when a later check refuses, so retry with the next code:

| Code | Meaning |
|---|---|
| `RECOVERY_OPERATOR_NOT_ALLOWED` | The operator is not on `RECOVERY_OPERATOR_EMAILS`, or is not an active identity |
| `RECOVERY_OPERATOR_MFA_REQUIRED` | The operator has no second factor |
| `RECOVERY_OPERATOR_CODE_INVALID` | The code is wrong, expired, or was already used |
| `RECOVERY_TWO_PERSON_REQUIRED` | Production with `--single-operator`, or the requester tried to approve their own request |
| `RECOVERY_TARGET_NOT_ACTIVE_MEMBER` | The person is not an active member (member kind) of that workspace, or their identity is not active |
| `ORG_NOT_FOUND` | No active workspace has that id |
| `RECOVERY_REQUEST_NOT_FOUND` / `RECOVERY_REQUEST_EXPIRED` / `RECOVERY_REQUEST_USED` | The request id is unknown, older than 24 hours, or already carried out |
| `VALIDATION_ERROR` | An id is not an id, or the ticket or reason is missing or out of range |

---

## 7. Check the audit trail afterwards

Every step writes `AuthAuditEvent` rows in the recovered workspace. Nothing in the product updates or deletes them (the database does not enforce that; do not edit them). Run:

```sql
SELECT "createdAt", "entityType", action, "actorId", "userId", "metadataJson"
FROM "AuthAuditEvent"
WHERE "orgId" = '<org id>'
  AND ("entityType" = 'owner_recovery'
       OR ("entityType" = 'membership' AND "metadataJson"->>'via' = 'owner_recovery'))
ORDER BY "createdAt";
```

Expect, in order:
1. `owner_recovery.requested` — `actorId` = first operator; `userId` = the person; metadata: `ticket`, `reason`, `operatorEmail`, `expiresAt`, `singleOperator` (false in production). Its `id` is the request id.
2. `membership.admin_granted` (only if the person was not already an administrator) and `membership.owner_granted` (only if not already an owner) — `actorId` = the approving operator; metadata `via: owner_recovery`, `requestId`, `ticket`.
3. `owner_recovery.executed` — `actorId` = the approving operator; metadata: `requestId`, `ticket`, `reason`, `requestedBy`, `approvedBy`.

Then confirm the membership: re-run the query in section 5 and check the person shows `isOwner = true`, `isAdmin = true`. Record the three audit row ids on the ticket and close it.

Refused attempts are printed to the operator's terminal only; they are not written to the audit trail. Note them on the ticket.

---

## 8. After the recovery

Tell the new owner (through the verified channel, not by replying to an unverified message) to:
- sign in and check People;
- deactivate the lost owner's account in the workspace if it should no longer have access (the workspace now has another owner, so the last-owner guard no longer blocks it), or leave it if the person may regain access;
- appoint a second owner, so the workspace never again depends on one person;
- if the lost owner needs to come back with a new mailbox, invite them at the new address: that is a new account with only the role chosen, and ownership is granted again by an owner (admin guide, "A person has lost access to their email").
