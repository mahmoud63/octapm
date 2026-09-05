# Bid packages, bidder portal, leveling and award (OCTA-PRE-BID-027)

## Where

- **Commercial › Bids** (`/projects/{id}/commercial/bids`, `?recordId=` opens a package): packages `BP-nnn` with their state, and a workspace with **Brief & documents**, **Bid form**, **Bidders**, **Q&A** (questions + addenda), **Bids & leveling** and **History**.
- **Bidder portal** (`/bid/{token}`, no login): the page a vendor reaches from the invitation email — brief, documents, addenda, its own questions and shared answers, and its own bid form.

## Package

- **Create** with a title, due date, question deadline, award type (subcontract / purchase order) and the **BOQ sections** to price: every active BOQ item in those sections becomes a bid form line (code, description, unit, quantity) with the **internal estimate** taken from the BOQ rate — shown to the team, **never to bidders**. Lines can also be added from more sections, from BOQ item ids, or by hand (draft only). Documents are attachments on the package (`recordType = bid_package`); every one is downloadable from the portal.
- **Bidders**: vendors from the company directory (name, contact and email pre-filled) or an ad-hoc company + email. One invitation per email per package, 50 max.
- **Publish** (`bid.publish`: PM, procurement): needs lines, bidders and a future due date; every bidder is emailed a **personal portal link**. Links are tokens (only the SHA-256 is stored) that expire 14 days after the due date (45 days when none); every later email — reminder, addendum, answer, reopen — issues a fresh link and the previous one stops working, so the latest email always holds the working link. **Resend** sends a reminder with a fresh link.
- **Addenda** are numbered and, on open packages, emailed to every bidder. Changing the due date of an open package emails the bidders. **Close** stops bids; **Reopen** needs a new due date; **Cancel** tells the bidders when it was open.

## Portal (bidders never see each other)

`GET /public/bids/{token}` returns only that invitation's view: package brief, lines **without estimates**, documents, addenda, its own questions plus answers the team chose to **share** (the asker is never named), and its own bid. Marks the invitation *viewed*.

- **Questions** (`POST …/questions`, until the question deadline) notify PMs and procurement; an answer goes to the asker only, or to every bidder when shared.
- **Bid** (`PUT …/bid`): a rate per line (amount = quantity × rate) or *excluded* with a note, inclusions, exclusions, notes, validity and lead time; totals are computed server-side. An optional **priced form** upload (`POST …/upload`, PDF / spreadsheet / document, ≤ 25 MB) is attached to the bid.
- **Submit** (`POST …/bid/submit`): every line must be priced or excluded unless a priced form was uploaded (400 `BID_INCOMPLETE` lists the lines); refused after the due date or when the package is not open. The bidder gets a confirmation email; the team a notification. **Withdraw** reopens the bid for editing (version + 1) until the due date; **Decline** records a reason.
- Expired or replaced links answer 404 `BID_LINK_INVALID` / 410 `BID_LINK_EXPIRED`; cancelled packages 410.

## Leveling and award

- `GET …/bids/{packageId}/leveling`: lines × bidders with rate and amount, the low bid per line, per-line low / average / high / spread, each bidder's total and **normalised total** — an excluded or unpriced line is **plugged** with the average of the other bidders' amounts for that line (or the estimate when nobody priced it) so totals compare like for like; bidders are ranked by normalised total. Inclusions, exclusions, validity, lead time and the uploaded form are shown beside each bidder.
- `GET …/leveling.xlsx` (`bid.export`): *Leveling* (lines × bidders, low / average / spread, totals and normalised totals), *Summary* (rank, totals, plugs, inclusions / exclusions, validity, lead time) and *About*.
- **Soft award** (`bid.award`: PM): selects a submitted bid and closes bidding; nothing is created. **Confirm award** creates the **commitment** through the commitments module — vendor from the invitation (a directory company is created for ad-hoc bidders), title, currency, retention and dates from the form, and the **schedule of values from the priced lines** (description, unit, quantity, rate, amount, with each line's BOQ item, budget line, cost code and activity links); the package becomes *awarded*, the winning bid *awarded*, the others *unsuccessful*, and every bidder is emailed the outcome. The commitment then follows its own lifecycle (approve, execute, pay applications).

## Permissions

`bid` module: read for PM, planning, QS, cost controller, procurement and finance; create / update for PM, QS and procurement; delete for PM and procurement; transitions `bid.publish` (PM, procurement), `bid.answer` (PM, QS, procurement), `bid.award` (PM). Bidders need no account.

## Walkthrough

1. Commercial › Bids → **New package** *Piling subcontract*, sections *02 Substructure*, due in two weeks → Brief: attach the drawings → Bidders: invite two vendors → **Publish & invite**.
2. Open bidder A's link: documents download, ask *Is dewatering included?* → team answers and shares → bidder B's fresh link shows the answer without the asker. Bidder A prices every line and submits; bidder B excludes *Pile caps* with a note and submits.
3. Bids & leveling: B is ranked first on normalised total with one plug; export the XLSX → **Select (soft award)** A → **Confirm award & create commitment** → Commercial › Commitments shows the subcontract with the two SOV lines; both bidders receive the outcome email.

## Tests

`backend/src/services/__tests__/bid.service.test.js` (package from BOQ sections, invitations and publish with hashed tokens; portal isolation, questions and shared answers, link rotation; pricing / completeness / withdraw / upload / decline; leveling with plugs, XLSX, soft award, award → commitment SOV and vendor creation) and `frontend/scripts/bids-ui.test.mjs`.
