# PMcopilots — Open Questions Register

**Logic Gaps & Edge Cases — Organized by Phase and Owner**

Date: April 2026 | Status: Pending Review

---

## Phase 1: Project Initiation & Budgeting

### A. Client Decision Questions

> These require business decisions from the product owner / client before development can proceed.

| #   | Category               | Question                                                                                                                                                                                   | BRD Reference                              |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| 1   | BOQ Validation         | Should a BOQ item with zero quantity or zero rate be allowed? (e.g., a "Supervision" item with no direct cost but must appear in the table)                                                | FR-103 (no negatives, but silent on zero)  |
| 2   | Excel Format           | Must clients follow a fixed Excel template for BOQ uploads, or should the system flexibly accept any column order?                                                                         | ASM-04 (assumes section/phase assignments) |
| 3   | Currency & Rounding    | What is the default project currency? What rounding rules apply to calculations (e.g., nearest 2 decimal places, nearest whole unit)?                                                      | ASM-08 (USD default)                       |
| 4   | Subtotal 2 Adjustments | Can users edit tax/service percentages (Subtotal 2) per project from the UI, or are these fixed company-wide values from the JSON config only? Are they always calculated from Subtotal 1? | Not explicitly in BRD                      |
| 5   | BOQ Versioning         | When a client re-uploads a corrected BOQ Excel, should the system overwrite the old data or create a new version (Version 2) with change history?                                          | Not explicitly in BRD                      |

### B. Developer / Technical Questions

> These require technical investigation or design decisions from the development team.

| #   | Category             | Question                                                                                                                                                                  | BRD Reference                                           |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 6   | Chunking Logic       | When a single BOQ section exceeds the 60-item AI limit, how does the system split it into sub-batches while preserving section order and cross-batch predecessor linking? | FR-102 / BRU-07 (chunking by section, batch IDs B1-xxx) |
| 7   | Calculation Conflict | If an uploaded Excel has (Qty × Rate) ≠ (Total Amount) in the same row, should the system recalculate from Qty × Rate, or reject the file with an error?                  | FR-103 (input validation rules)                         |
| 8   | File Size Limit      | What is the maximum allowed Excel file size for BOQ upload to ensure acceptable performance?                                                                              | CON-03 (API token limits)                               |
| 9   | AI Parsing Strategy  | How will the 60-item chunking be implemented programmatically to ensure the AI context does not drift between chunks?                                                     | FR-102 / CON-03                                         |
| 10  | JSON Schema          | What is the exact JSON structure (schema) for the Subtotal 2 percentages config (field names, types, defaults)?                                                           | Not explicitly in BRD                                   |

---

## Phase 2: Procurement

### A. Client Decision Questions

> These require business rules and workflow decisions from the product owner / client.

| #   | Category                        | Question                                                                                                                                                              | BRD Reference                                            |
| --- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 11  | BOQ Quantity Limit              | When a Material Request exceeds the remaining BOQ quantity for an activity, should the system hard-block the request or show a warning and allow the user to proceed? | Not explicitly in BRD                                    |
| 12  | Non-BOQ Items                   | If an engineer needs an emergency material not listed in the BOQ, can they request it under a "Miscellaneous" category, or must the BOQ be amended first?             | Not explicitly in BRD                                    |
| 13  | Approval Workflow               | Is the approval chain (PM → QS → Accountant) fixed for all requests, or should it be configurable based on request value thresholds?                                  | BRD Sec. 12 (role-based access)                          |
| 14  | Approval Deadlines & Escalation | Is there a time limit for managers to approve a request? If exceeded, should the system auto-escalate to a higher manager?                                            | Not explicitly in BRD                                    |
| 15  | Partial Receipts                | When a supplier delivers only part of an order (e.g., 50 of 100 bags), should the system allow partial receipt and keep the order open until fully delivered?         | GRN module exists (partial receipt status shown in code) |
| 16  | Vendor Database                 | Should the system maintain a pre-loaded vendor/supplier list for selection, or will users type vendor names manually per request?                                     | Material Master has Supplier field (Sec. 14.1)           |

### B. Developer / Technical Questions

> These require technical design or architecture decisions from the development team.

| #   | Category              | Question                                                                                                                                                                                                                                  | BRD Reference                                                            |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 17  | Cascading Filters     | When a user selects a Project, should the Branch and Warehouse dropdowns auto-filter to show only related entries? (Prevents cross-project selection errors)                                                                              | Not explicitly in BRD                                                    |
| 18  | Draft Persistence     | Since browser localStorage is prohibited (CON-05), how should incomplete PR forms (e.g., 20 items mid-entry) be preserved if the page refreshes or loses power? Options: temporary DB table, auto-save to server, or single-session only? | CON-05 (no localStorage); NFR: zero data loss on refresh via React state |
| 19  | Real-time Updates     | How should the Dashboard reflect newly approved procurement requests in real time without requiring a full page reload?                                                                                                                   | NFR: progress slider updates propagate within 100ms                      |
| 20  | Mobile Responsiveness | Does the Procurement module need to be fully mobile-friendly for on-site engineers using phones, and how will complex tables render on small screens?                                                                                     | NFR: responsive for tablets 1024px+; mobile is out of scope (Sec. 6.2)   |

---

## Summary

| Category                         | Client | Developer | Total  |
| -------------------------------- | ------ | --------- | ------ |
| Phase 1 — Initiation & Budgeting | 5      | 5         | 10     |
| Phase 2 — Procurement            | 6      | 4         | 10     |
| **TOTAL**                        | **11** | **9**     | **20** |

**Key:**
- **Client** = Requires a business/product decision before development.
- **Developer** = Requires a technical design or architecture decision.