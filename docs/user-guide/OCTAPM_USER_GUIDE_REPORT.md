# OctaPM User Guide — Documentation Report

Date: 15 September 2026 · Product: branch `feat/p0-foundations-sprint1` at `0fce677` (documentation
commit follows) · Sources of truth: the live product (frontend navigation, module registry, the
permission policy `shared/permissions.json`, the routes), the browser as every persona, and the
Phase 22 / 22A / 22B reports and persona evidence. No product code was changed.

## Supported personas documented

Company / Admin, Project Manager, Planner, QS / Commercial, Cost Controller, Procurement,
Storekeeper / Warehouse, Site Engineer, Quality Engineer, Finance — each signed in and validated
in the browser (landing, module bar and More menu, quick actions, My open items, own module, one
refused address, sign-out; 0 refused calls and 0 console errors for nine of ten, one refused
call for the Site Engineer on Change Events, recorded as UG-11). Supplier / Bidder — driven live through
the invitation link (package, pricing, submit, question, award outcome).

## Unsupported personas

Client / Owner: NOT SUPPORTED as a login. Subcontractor: NOT SUPPORTED as a login. Both are
described in the User Guide (chapter 11) with what the product holds for them and why a
representative invited today receives an internal role. No role guide was written for them.

## Features documented

121 rows of the Phase 22 Feature Register (with the 22A and 22B additions): 116 covered, 5 not
applicable (sign-up, billing, legacy sub valuations, registry short links, operator tooling),
0 missing for supported Pilot V1 features. See `OCTAPM_GUIDE_COVERAGE_MATRIX.md`.

## Workflows documented

24 in `OCTAPM_WORKFLOW_GUIDE.md`: RFI lifecycle; change order lifecycle; schedule progress; BOQ →
budget; RFQ → bid → award; award → PO; PO → goods receipt; goods receipt → inventory; inventory →
material issue; material issue → actual cost; direct cost; timesheet → labour cost; subcontract →
pay application; certification → actual cost; payment → cash flow; client valuation; client
invoice; client receipt; inspection → NCR; NCR → corrective action → closeout; punch lifecycle;
document review; submittal review; meetings → actions → tasks. Each with who starts, what they do,
who receives, what changes, modules that update, who approves, final state, click path and quick
path; twelve carry start / action / result screenshots; the rest reference the register screens.

Driven live for this handbook (on the reset E2E organisation): RFI raise, answer and close;
change order with budget line and evidence; goods receipt; NCR raise, closeout by the assignee,
approval; bid package, portal pricing and submission. Written from the registers, the policy and
the Phase 21/22 evidence: schedule progress, BOQ → budget, award → PO, direct cost, timesheet,
pay application, IPC, inspection, punch, document and submittal review, meetings.

## Screenshots captured

110 images under `docs/user-guide/images/` (17 MB), 1440×900, on clean demonstration data: the
demonstration organisation's Riverside Tower for read-only screens and the reset E2E
organisation for action flows. Every image referenced by a guide exists; no unreferenced image is
kept. Seven screens were captured and then dropped because the live data showed archived-project
or inactive residue or raw identifiers (Projects list, People, Vendors, Inventory Match /
Dashboard / Warehouses, Security); those features are covered in text.

## Role guides created

11 / 11: Admin, Project Manager, Planner, QS / Commercial, Cost Controller, Procurement,
Storekeeper, Site Engineer, Quality Engineer, Finance, Supplier / Bidder — all in the required
A–M structure with "Your first 15 minutes" and a daily checklist.

## Feature-matrix rows

37 feature rows × 9 internal roles + Supplier / Bidder, generated from the permission policy
(`OCTAPM_ROLE_FEATURE_MATRIX.md`), plus the approvals and transitions each role holds.

## Coverage percentage

116 / 116 applicable rows = **100 %** of supported Pilot V1 features covered in the master guide;
role-guide, workflow and screenshot columns as the matrix states.

## Missing documentation

None for supported features. Two chapters rest on lighter live evidence: Schedule (certified in
Phase 21, not deep-driven since) and the client-side IPC chain (registers and policy, not driven
end to end in this pass). Both are marked in the coverage matrix and the findings.

## Product behaviour discovered while documenting

- Quick actions keep their project in the browser (the block's **In project…** control), not on
  the account; a fresh browser shows the first project the person may open.
- Commercial lands on the first sub-tab a role may read (Change Events for Procurement and Site
  Engineer); Cost Control is hidden for four roles; People and Company appear only for
  administrators.
- The address `/notifications` is not a page; the bell and Settings → Notifications are.
- A purchase order is raised from a procurement package that comes from a material requirement
  on the schedule; there is no "New purchase order" control.
- The Directory hides inactive companies by default; the Vendors tab does not.

## Potential UX issues discovered

Recorded in `OCTAPM_GUIDE_PRODUCT_FINDINGS.md` (UG-01 … UG-19): 0 guide-blocking, 10 UX issues,
1 permission inconsistency, 1 missing feature (external logins), 7 documentation-only notes.
Nothing was changed in the product.

## Documentation limitations

- Screenshots are of the demonstration organisation; a customer's data will differ.
- Where a workflow was not driven live, button names are those on the register screens and the
  transitions are those of the policy; the exact dialog wording of certification, invoice and
  receipt steps was not captured.
- The handbook describes the default role policy; a company's permission templates may widen or
  narrow what a role sees on a project.
- Markdown is the canonical source; PDF, DOCX and help-centre exports are to be produced from it
  (one file per chapter or role, images in `images/`).
