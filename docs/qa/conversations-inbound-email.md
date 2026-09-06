# Conversations and inbound email (OCTA-COMM-CONV-042)

Two communication channels that keep the record as the primary surface:
**conversations** (messaging inside the organisation, optionally on a
project) and **inbound email** (a project address, plus signed reply-to
addresses on every notification email so a reply lands back on the
record or in the conversation it came from).

## Conversations

**Where:** sidebar › **Messages** (`/messages?conversationId=`). Left: the
list (search, All / Unread / Starred / Archived, project filter); right:
the open thread. *New conversation* → direct (one person) or group
(title + people), organisation-wide or on a project; optional first
message. Members' open threads refresh in real time (events go to each
member's own socket room), so org-level threads work without a project
room.

Thread: title, kind, project, members, *Open <record>* on record threads;
star; menu — mute / unmute, add people, rename (groups and record
threads), archive / unarchive, leave; messages grouped by day with
@mention highlighting, *via email* marker on replies that came in by
mail, shared-record cards, edit / remove for your own; *Load older
messages*; composer with `@` autocomplete over the members, *Mention*,
*Share record* (global search, scoped to the thread's project when it
has one), Ctrl+Enter to send. Opening a thread marks it read.

Rules (`conversation.service.js`):

- Kinds: `direct` — exactly one other person, one thread per pair per
  scope (`directKey`), reused; `group` — title + people; `record` — one
  thread per project record (`recordType` + `recordId`, title from the
  record, link to its workspace), reused.
- People: active members of the organisation; on a project, only people
  who can open it (PM / super-admin / company admin, assignment or active
  party membership) — `CONVERSATION_MEMBER_INVALID` otherwise.
  `GET /conversations/people?projectId&q` is the directory for pickers.
- Messages: ≤ 10 000 characters, text and / or a shared record (title and
  path resolved server-side when the type is a comment record type);
  mentions are explicit member ids (`CONVERSATION_MENTION_INVALID`
  otherwise). Author's `lastReadAt` moves with the message; the
  conversation's preview / count / `lastMessageAt` update.
- Notifications: mentioned people → `mention`; other unmuted members →
  new **`message`** category (in-app by default, email opt-in in
  Settings › Notifications); people added to a group → `message`.
- Unread = messages by others after the member's `lastReadAt`; muted
  threads still count in the list but not in the badge summary.
- Edit: author only. Remove: author, or project manager / company admin /
  thread admin (starter). Archive: starter / PM / admin; archived threads
  are read-only.
- Non-members get 404, never 403 — a thread's existence is not revealed.

| Endpoint | Permission (`conversation`) |
| --- | --- |
| `GET /conversations?filter&projectId&q`, `GET /conversations/unread`, `GET /conversations/people` | read |
| `POST /conversations { kind, projectId?, title?, memberUserIds, recordType?, recordId?, message? }` | create |
| `GET /conversations/{id}`, `PATCH /me { starred, muted }`, `POST /read` | read |
| `PATCH /conversations/{id} { title, archived }`, `POST /members`, `DELETE /members/{userId}` | update |
| `GET /messages?cursor`, `POST /messages { body, mentionUserIds, linkedRecord }`, `PATCH / DELETE /messages/{messageId}` | read / update |

Every role has read / create / update; delete is PM. Party templates:
read / create / update for all four party roles.

## Inbound email

**Server setup:** `INBOUND_EMAIL_DOMAIN` (e.g. `mail.example.com`, MX →
the provider), `INBOUND_EMAIL_SECRET` (signs reply addresses; falls back
to `JWT_SECRET`), `INBOUND_EMAIL_WEBHOOK_TOKEN` (shared token for
Postmark / SendGrid / generic) and, for Mailgun,
`INBOUND_MAILGUN_SIGNING_KEY`. Point the provider's inbound webhook at
`POST /api/v1/public/inbound-email/{postmark|mailgun|sendgrid|generic}`
(`?token=`, `X-Inbound-Token` or basic-auth password). The route has its
own 40 MB body limit for base64 attachments. Outbound email must honour
the `replyTo` field the delivery webhook now receives.

**Addresses** (`utils/inbound-addresses.js`):

| Address | Meaning |
| --- | --- |
| `p-<token>@domain` | the project's inbox (`Project.inboundEmailToken`, rotatable) |
| `r-<recordType>-<recordId>-<sig>@domain` | reply on a record → comment |
| `c-<conversationId>-<sig>@domain` | reply in a conversation → message |

`sig` = first 12 hex of HMAC-SHA256(secret, `r:<type>:<id>` /
`c:<id>`); a wrong signature is dropped (`bad_signature`). Notification
emails about a record or conversation carry the matching **Reply-To** and
a "Reply to this email to answer in OctaPM" line.

**Routing** (`inbound-email.service.receive`): the first recipient on our
domain decides (record > conversation > project). The message is stored
as `InboundEmail` (deduplicated by provider + Message-ID; attachments
saved as project documents on the email, then re-linked to whatever it
lands on), the new text is separated from the quoted thread
(`stripQuotedReply`: `On … wrote:`, `-----Original Message-----`,
`From:` header blocks, `>` lines, signatures), then:

- record: the sender must be an active user with access to the project →
  `comment.service.createComment` as that user (`posted`); otherwise
  `unmatched` with the reason;
- conversation: the sender must be a member → message of kind `email`
  (`posted`); otherwise `unmatched`;
- project: `received` — or `logged` as incoming correspondence (type
  email, sender / received-at header in the body, open, owner = nobody)
  when the project's **auto-log** is on.

Unknown project token / record / conversation, or no recipient on our
domain → `accepted: false` (still HTTP 200 so providers do not retry).

**Where:** Doc Control › **Emails** (deep link
`/projects/{id}/doc-control/emails?source=inbound_email&recordId=`):
project address card (copy, *New address* / *Issue address*, auto-log
switch — `email.settings`, PM), tiles (needs action, posted, logged,
conversations), search / status filter, the inbox; email dialog with
sender, status and reason, the new text (toggle the full email),
attachments, and the triage actions for `email.update`: **Log as
correspondence** (type, contractual notice), **Post to a record** (global
search scoped to the project → comment prefixed with the sender and
subject, attachments follow), **Start a conversation** (people picker;
the sender joins when they are a user; the email is the first message),
**Ignore**; **Delete** (`email.delete`, PM). Links open the record /
correspondence / conversation it went to.

| Endpoint | Permission (`email`) |
| --- | --- |
| `GET /projects/{id}/emails?status&target&q`, `GET …/emails/{emailId}`, `GET …/emails/settings` | read |
| `PATCH …/emails/settings { autoLog }`, `POST …/emails/settings/rotate` | `email.settings` (PM) |
| `POST …/emails/{emailId}/log`, `/post`, `/conversation`, `/ignore` | update |
| `DELETE …/emails/{emailId}` | delete |
| `POST /public/inbound-email/{provider}` | webhook token / signature |

Party templates: contractors read / update the inbox; owners,
consultants and subcontractors do not see it (they still get reply-to
addresses on their own notifications).

## Test

```bash
cd backend && npx jest src/services/__tests__/conversation.service.test.js src/services/__tests__/inbound-email.service.test.js
cd frontend && node scripts/conversations-email-ui.test.mjs
```

Manual: Messages › New conversation (direct) with a colleague → send a
message with an @mention → the colleague sees the unread badge and the
mention notification → they reply → your open thread updates without a
refresh. Configure the inbound domain with the generic provider, POST a
JSON message to `/api/v1/public/inbound-email/generic?token=…` addressed
to the project address → it appears in Doc Control › Emails → *Log as
correspondence* → the correspondence register shows it with the
attachment. Reply to an RFI notification email → the reply appears as a
comment on the RFI by you.
