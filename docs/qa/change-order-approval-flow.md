# Change Order Approval Flow QA

TASK-V3-P1-commercial-change-order-approval-flow hardens commercial variation approval.

## Manual Variation Scenario

1. Create a draft change order as QS with value, schedule impact, affected activities, BOQ/allocation links, supporting document IDs, and both schedule/cost impact summaries.
2. Confirm the draft is editable and does not appear in approved variation totals or approved budget revision delta.
3. Submit the draft. Confirm status moves to `pending` and an `ApprovalWorkflowEvent` with action `submitted` is visible in approval history.
4. Attempt approval as QS. Confirm it is hidden or rejected by permissions.
5. Approve as PM. Confirm status moves to `approved`, approved activity impact fields are populated, and a linked approved budget revision appears in Budget Revisions and official EV revised BAC.
6. Attempt to patch `status`, value, schedule impact, activity links, allocation links, or supporting evidence on the approved record. Confirm the API returns `CHANGE_ORDER_APPROVED_LOCKED` or `CHANGE_ORDER_WORKFLOW_ACTION_REQUIRED`.
7. Create a second draft, submit it, then reject it as PM with a reason. Confirm reason is shown and the workflow event action is `rejected`.
8. Reopen the rejected record as QS or PM. Confirm status returns to `draft`, it is editable, and approval metadata is cleared.
