# Product Findings Recorded While Writing the Handbook

Documentation phase only: nothing here was changed in the product. Each finding is classified as
GUIDE-BLOCKING (the guide cannot describe a working path), UX ISSUE, PERMISSION INCONSISTENCY,
MISSING FEATURE or DOCUMENTATION ONLY.

| ID | Class | Finding | Where | Effect on the handbook |
| --- | --- | --- | --- | --- |
| UG-01 | MISSING FEATURE | Client / Owner and Subcontractor have no external login. A representative invited to a party receives an internal role (Site Engineer) and internal navigation; there is no owner- or subcontractor-facing view and no tenant boundary. | Project → Team, People → invite | Both personas documented as NOT SUPPORTED; no role guide written for them. |
| UG-02 | UX ISSUE | The supplier portal confirms a bid withdrawal with the browser's own confirm box rather than a styled dialog. | Supplier portal, "Withdraw to edit" | Documented as it is. |
| UG-03 | UX ISSUE | Quick actions offer nothing to Procurement, Storekeeper and Finance (none of the four quick actions is a record those roles create). | Workspace Control | Their role guides start from the module bar instead. |
| UG-04 | UX ISSUE | A purchase order is raised from a procurement package that comes from a material requirement on the schedule; there is no "New purchase order" control on the Purchase Orders page. The empty-state text explains it, but the path is long for a buyer who knows what to order. | Procurement → Purchase Orders / Packages | Workflow guide documents the package path. |
| UG-05 | DOCUMENTATION ONLY | The company administration registries (Directory, Vendors, Cost codes, Equipment, templates) have search and filters but no pagination or audit view on the page. | Company workspace | Noted in the Admin guide's limitations. |
| UG-06 | DOCUMENTATION ONLY | The certified Phase 21 project's parties carry run-stamped names ("P21-20260910093852 …") in the Directory. Frozen by design; the demonstration walk-through uses Riverside Tower. | Company → Directory | Screenshots avoid it. |
| UG-07 | PERMISSION INCONSISTENCY | The policy lets the QS approve progress submissions (submission.approve) although progress is a planning matter; the Planner cannot open Pay Applications at all although the Commercial module is on the Planner's bar. Both are as the policy states, not defects, but worth a review by the company administrator. | Permission policy | Documented as they are in the matrix. |
| UG-08 | DOCUMENTATION ONLY | The fresh Riverside Tower budget (1,700,000) does not equal its BOQ total, so the Budget tab shows an "Off by …" note. Demonstration data, not product behaviour. | Cost Control → Budget | Screenshot captions say so. |
| UG-09 | UX ISSUE | 61 residue companies in the demonstration organisation are inactive rather than deleted; they appear only when "Show inactive companies" is switched on. | Company → Directory | Admin guide explains the switch. |
| UG-10 | DOCUMENTATION ONLY | Schedule was not deep-driven in Phase 22B (certified in Phase 21); its chapter is written from the live sub-tabs and the Phase 21 evidence. | Schedule | Marked in the coverage matrix. |

Findings added during the capture and validation passes.

| ID | Class | Finding | Where | Effect on the handbook |
| --- | --- | --- | --- | --- |
| UG-11 | UX ISSUE | When a Site Engineer opens Commercial (landing on Change Events, the one tab their role may read), the tab also asks for the commitment register, which the policy refuses; the page works, but one refused request is logged in the browser console. | Commercial → Change Events, as Site Engineer | Documented as it is; no dead end. |
| UG-12 | UX ISSUE | The address /notifications answers a "Page Not Found" screen; notifications live in the bell in the top bar (list, mark all read) and under Settings → Notifications (preferences). | Top bar, Settings | The guide sends people to the bell and to Settings; no page link. |
| UG-13 | UX ISSUE | The notification bell names some records by an internal reference rather than by their title: a change-order approval item reads "GR-…" and a BOQ allocation item shows a long identifier. | Notification bell | Documented as it is; screenshots avoid the item text. |
| UG-14 | UX ISSUE | The global Tasks page and the People page count and list records of archived projects (a person shows "114" projects; tasks from the archived certified fixture appear first). Demonstration data, but the counts include archived projects. | Tasks, People | Screenshots not used. |
| UG-16 | UX ISSUE | The global Inventory views (Match, Dashboard, Warehouses) list movements, orders and stores of archived projects, including run-stamped demonstration names; the Items tab and goods receipts are clean. | Inventory → Match / Dashboard / Warehouses | Screenshots of those tabs are not used. |
| UG-17 | UX ISSUE | Company → Vendors lists inactive vendors by default (the Directory hides them unless asked). | Company → Vendors | Screenshot not used. |
| UG-18 | UX ISSUE | Company → Security lists people with the internal role identifier (quality_engineer, site_engineer) rather than the role label used everywhere else. | Company → Security | Screenshot not used; the guide uses the labels. |
| UG-19 | DOCUMENTATION ONLY | Two screens carry server-configuration wording meant for administrators: Doc Control → Search ("Meaning search off — set an embeddings key", "Index missing — Rebuild") and Site Reporting → Daily log ("No AI provider on this server"). The features work without them. | Doc Control → Search, Site Reporting | The guide explains the plain-text search and manual draft; notes the messages. |
