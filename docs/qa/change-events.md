# Change events and RFQs (OCTA-COM-CE-038)

A **change event** is a potential change captured before it is priced —
owner request, design change, site condition, error / omission, allowance
draw, value engineering — with scope lines, a rough order of magnitude, the
activity and location, and the record it came from. **RFQs** go to vendors
with a personal link; vendors quote line by line without a login; the team
accepts a quote (optionally drafting a commitment change order) and
**converts** the event into a draft prime change order at the quoted value.

## Where

- **Commercial › Change Events** (deep link
  `/projects/{id}/commercial/change-events?source=change_event&recordId=`).
  Tiles (live events, ROM exposure, quoted, converted value, open RFQs,
  quotes in), search, status / type filters, the register, *New change
  event*.
- **Event workspace**: header (title, type, activity, description, schedule
  impact, header ROM when there are no lines), **scope lines** (cost code,
  activity, vendor commitment, quantity, unit, unit cost → ROM; quoted
  amount once accepted), **RFQs** (send dialog: commitment vendors with the
  contact on file, ad-hoc company + email, due date, which lines,
  instructions; table of quotes per line with *Accept* / *Reject*, *Remind*
  (fresh link), *Withdraw*), *Convert to change order*, *Close*, *Void*,
  *Delete* (open, no RFQs), history.
- **Vendor portal** `/rfq/{token}` (public): scope lines with quantities,
  instructions and due date; an amount and note per line, validity, lead
  time, notes, name; *Send / Update quotation* (until accepted or rejected)
  and *Decline to quote*.

## Rules

- Refs `CE-001`; lines' ROM defaults to quantity × unit cost; the event
  estimate is the sum of quoted-where-accepted-else-ROM (header ROM when no
  lines).
- Status open → pricing (RFQs sent) → priced (quote accepted) → converted;
  closed / void end it (open RFQs cancelled). Converted events cannot be
  voided — void the change order.
- RFQ refs `CE-001-RFQ01`; **tokens are stored hashed**, expire after
  `RFQ_LINK_DAYS` (45) or a week past the due date, and are rotated on every
  reminder (older links stop working). One open RFQ per email per event
  (409 `RFQ_ALREADY_SENT`). A commitment recipient uses the party contact,
  else the vendor company's email.
- Quotes: amounts per line (or a total), validity, lead time; the project
  team (PM, QS, creator) is notified; the vendor gets a confirmation email.
  Re-quoting is allowed until accepted / rejected; expired or withdrawn
  links answer 410.
- **Accept**: quoted amounts land on the lines (`quotedRfqId`), status
  priced; with `createCommitmentChangeOrder` and a commitment vendor, a
  draft **commitment change order** is created with the quoted lines
  (`commitment.service.createChangeOrder`).
- **Convert**: `change-order.service.createChangeOrder` with description,
  category = type, value (quoted else ROM; `value` overrides), schedule
  impact, affected activities from the lines and header; accepted
  commitment quotes become commitment change orders linked to the prime
  (`primeChangeOrder`), existing ones are linked. Then status converted with
  `changeOrderId`.
- Permission module `change_event` (create: PM, planning, QS, site
  engineer; RFQ send: PM, QS, procurement; accept / convert / close: PM, QS;
  void: PM). Contractor parties create and send RFQs; owner / consultant
  read; subcontractors answer through the portal only.

## API

Tag "Change Events", `/projects/{id}/change-events`: `GET /`,
`POST /`, `GET|PATCH|DELETE /{changeEventId}`,
`POST /{changeEventId}/rfqs`, `POST /{changeEventId}/convert|close|void`,
`POST /rfqs/{rfqId}/remind|cancel|accept|reject`.
Tag "Vendor Quotation Portal", `/public/rfqs/{token}`: `GET /`,
`PUT /quote`, `POST /decline`.

## Test

```bash
cd backend && npx jest src/services/__tests__/change-event.service.test.js
cd frontend && node scripts/change-events-ui.test.mjs
```

Manual: New change event with two lines (one on a commitment's vendor) →
*Send RFQs* to that commitment and an ad-hoc email → open the link from
the email → quote both lines → the event shows the quote → *Accept* → lines
show the quoted amounts, a draft `SC-xxx-COnn` exists → *Convert to change
order* → a draft `VO-nn` opens from the toast with the quoted value and the
commitment change order linked to it.

## Configuration

`WEB_APP_URL` (portal links), `RFQ_LINK_DAYS` (default 45), email transport
as for the bid portal.
