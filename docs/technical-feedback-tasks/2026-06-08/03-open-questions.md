# Open Questions

## Related Feedback ID: FB-003

**Question:** Which project metadata fields are mandatory at create time versus optional after setup?

**Why clarification is needed:** Contract terms, retention defaults, calendars, and cutoff days affect migrations, validation, and setup blocking behavior.

**Suggested owner:** Product / Business

## Related Feedback ID: FB-004

**Question:** Who is allowed to approve a generated/imported schedule and who is allowed to lock the baseline?

**Why clarification is needed:** The approval workflow needs authority rules before implementation.

**Suggested owner:** Product / Backend

## Related Feedback ID: FB-005

**Question:** Which calendar model is required for Phase 1a: project-level only, activity-level calendars, or resource calendars?

**Why clarification is needed:** Calendar scope affects CPM calculations, schema design, and UI complexity.

**Suggested owner:** Product / Backend

## Related Feedback ID: FB-007

**Question:** What is the official EV basis for PV, EV, AC, EAC, budget revisions, and reporting cutoffs?

**Why clarification is needed:** Current calculations are simplified; official formulas need business signoff.

**Suggested owner:** Business / Backend

## Related Feedback ID: FB-008

**Question:** Which progress methods should be available per activity type and which require photo or inspection evidence?

**Why clarification is needed:** Progress method choices directly affect EV and approval workflows.

**Suggested owner:** Product / QA

## Related Feedback ID: FB-009

**Question:** What is the final role/action permission matrix for all eight roles?

**Why clarification is needed:** The code can enforce policies only after the action matrix is agreed.

**Suggested owner:** Product / Security

## Related Feedback ID: FB-011

**Question:** Does the mobile daily-report API need offline draft/sync behavior in Phase 1a?

**Why clarification is needed:** Offline behavior changes API design, conflict handling, and storage requirements.

**Suggested owner:** Product / Mobile API

## Related Feedback ID: FB-012

**Question:** Should commercial records support many-to-many links to activities/BOQ allocations immediately, or be phased by module?

**Why clarification is needed:** Traceability depth affects schema, migrations, and implementation effort.

**Suggested owner:** Business / Backend

## Related Feedback ID: FB-019

**Question:** Has the previously flagged live Stripe key been revoked/rotated and confirmed by the owner?

**Why clarification is needed:** The repository notes flag the issue, but secret status cannot be verified from code.

**Suggested owner:** Security / DevOps

## Related Feedback ID: FB-020

**Question:** What evidence is required for go-live signoff, and who owns final approval?

**Why clarification is needed:** Production readiness is an organizational decision requiring QA, Product, Security, and Business acceptance.

**Suggested owner:** Business / QA

## Related Feedback ID: Reference docs

**Question:** Where is the BRD file referenced by project instructions?

**Why clarification is needed:** `docs/PMcopilots_BRD_v3.docx` was named in instructions but was not present in the visible `docs` folder.

**Suggested owner:** Product / Business
