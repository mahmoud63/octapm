# Comments, @mentions and record subscriptions (OCTA-COMM-COMMENT-009)

One discussion thread on every record type, explicit @mentions, and a
follow / unfollow model that decides who hears about new comments.

## Model

| Table | Purpose |
| --- | --- |
| `Comment` | `(recordType, recordId)` → `body`, `authorId`, optional `parentId` (reply), `editedAt`, soft delete (`deletedAt`, `deletedBy`). |
| `CommentMention` | One row per mentioned user per comment (`commentId`, `userId`, unique). |
| `RecordSubscription` | Who follows a record: `(recordType, recordId, userId)` unique, `reason` (`manual`, `created`, `commented`, `mentioned`, `assigned`), `muted` (explicit unfollow). |

Record types are the same set as attachments (`attachment.service.RECORD_TYPE_MODULES`),
resolved to a Prisma model and display title in `comment.service.RECORD_SOURCES`
(e.g. `rfi` → "RFI RFI-012 – Rebar spacing"). Commenting on a record that is not
on the project returns `COMMENT_RECORD_NOT_FOUND`.

## Mentions

Mentions are **explicit user ids** chosen from the project team (`GET /projects/:id/team`);
the API never parses names out of the text, so a typo can't notify the wrong
person. Each mentioned user must be an active member of the organisation
**with access to the project** (assignment, party membership, or org-wide
role) — otherwise `COMMENT_MENTION_NO_ACCESS` / `COMMENT_MENTION_INVALID`.
At most 20 mentions per comment, 5 000 characters per body.

## Who gets notified

| Event | Recipients | Category | Email default |
| --- | --- | --- | --- |
| Comment posted | Users @mentioned | `mention` | on |
| Comment posted | Other followers of the record (not the author, not already mentioned, not muted, active) | `comment` | off |
| Comment edited with new mentions | Newly mentioned users only | `mention` | on |

Both categories are user preferences (`GET/PUT /notifications/preferences`,
Settings › Notifications). Notification `actionUrl` opens the record's own
workspace module with `?recordId=` (`backend/src/utils/record-links.js`); the
same helper replaced the old `?module=notifications` links used by workflow
notifications.

## Automatic follows

| Trigger | Reason |
| --- | --- |
| You create a record (`record.changed` with action `created`) | `created` |
| You are referenced on a record — `ownerUserId`, `reviewerUserId`, `approverUserId`, `assigneeUserId`, `ballInCourtUserId`, task `assigneeId`, report `engineerId` — after any change | `assigned` |
| You comment | `commented` |
| You are @mentioned | `mentioned` |

`registerAutoSubscriptions()` (called in `backend/src/index.js`) subscribes to
the domain event bus; the handler reads the record after commit and upserts
subscriptions with `update: {}` so an explicit unfollow (`muted = true`) is
never undone. The migration backfills `assigned` subscriptions for everyone
already referenced on RFIs, submittals, NCRs, ITPs, defects, safety incidents,
material tests, drawings, transmittals, correspondence and risks.

## API

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/projects/:id/comments?recordType&recordId&cursor&limit&order` | record module `read` |
| POST | `/projects/:id/comments` `{ recordType, recordId, body, mentionUserIds?, parentId? }` | record module `read` |
| PATCH | `/projects/:id/comments/:commentId` `{ body?, mentionUserIds? }` | author only (`COMMENT_NOT_AUTHOR`) |
| DELETE | `/projects/:id/comments/:commentId` | author, PM, or company admin (`COMMENT_DELETE_FORBIDDEN`); soft delete |
| GET | `/projects/:id/subscriptions?recordType&recordId` | record module `read` — `{ following, subscription, subscribers, count }` |
| PUT | `/projects/:id/subscriptions` `{ recordType, recordId, follow }` | record module `read` |
| GET | `/projects/:id/subscriptions/mine` | any project member |
| GET | `/projects/:id/audit?source=comment` | `audit.read` — comments merged into the record history feed as `action: "commented"` |

Every comment create / edit / delete publishes a `record.changed` domain event
(`commented`, `comment_updated`, `comment_deleted`) on the record, so open
workspaces refresh the thread and the history feed in real time.

## Frontend

- `features/comments/components/comment-thread.tsx` — **Discussion** section
  on every workflow record (RFI, submittal, NCR, ITP, defect, safety, material
  test, drawing, transmittal, correspondence, change order, IPC, …) via
  `WorkflowRecordList`: `@` autocomplete over the project team, mention chips,
  reply (pre-fills `@Author`), inline edit (author) and remove (author / PM /
  company admin), Ctrl+Enter to post, Follow / Following button with follower
  count and names on hover.
- History panel gains a **Comments** source and a **Commented** action filter.
- Settings › Notifications gains **Mentions** (in-app + email) and **Comments**
  (in-app only by default).

## QA checklist

1. Post a comment with `@` — the suggestion list shows only active team
   members; pick one and post → the mentioned user receives a `mention`
   notification whose link opens the record in its module.
2. Follow a record as a second user, post as the first → the follower gets a
   `comment` notification (in-app only unless email is enabled in Settings).
3. Unfollow, then get assigned as owner → still unfollowed (`muted` stays).
4. Edit a comment and add a new mention → only the new user is notified;
   the comment shows "(edited)".
5. Remove a comment as a PM → it disappears from the thread and the feed.
6. History panel › Comments source shows every live comment with author and
   mention names.

## Known limits

- Threads are flat with a "replying to" marker; there is no nested tree.
- Mentioning a distribution group / party (rather than a person) is not
  supported yet; parties are on the roadmap with the workflow engine.
- Task comments (`TaskComment`) and meeting comments keep their own tables;
  they are candidates for migration onto `Comment` in a later sprint.
