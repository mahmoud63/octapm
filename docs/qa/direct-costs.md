# Direct costs (OCTA-FIN-DIRECT-039)

Costs that do not run through a commitment — vendor invoices, expenses,
payroll, other — recorded with lines by cost code / budget line / activity.
**Approval posts** each line to the budget line's actual and to the
activity's cost record; **void reverses** exactly what was posted;
**payments** are recorded against the approved cost and are outflows in
the project cash flow.

## Where

- **Cost Control › Direct Costs** (deep link
  `/projects/{id}/cost/direct-costs?source=direct_cost&recordId=`). Tiles
  (recorded, waiting for approval, approved, paid, unpaid, overdue), search
  and status / type filters, the register, *New direct cost*.
- **Cost workspace**: header (type, vendor from the directory or a typed
  name, invoice number, description, cost / due / received dates, terms,
  tax), **lines** (budget line — or cost code + cost type — activity,
  quantity, unit cost, amount; uncoded lines highlighted), attachments
  (invoice scans), *Save*, *Submit for approval*, *Approve and post* /
  *Return* (reason), *Void* (reason), *Delete* (draft), **payments** (amount,
  date, method, reference) with the running balance, history.

## Rules

- Refs `DC-001`; total = Σ lines + tax; a line's amount defaults to
  quantity × unit cost.
- Draft → pending → approved → paid; void from any state without payments.
  Draft and pending are editable; approved and later are locked.
- Duplicate check: the same vendor + invoice number (non-void) answers
  409 `DIRECT_COST_DUPLICATE_INVOICE`.
- Submission needs at least one line and a cost code or budget line on
  every line (400 `DIRECT_COST_LINE_COST_CODE_REQUIRED`); PMs and finance
  are notified.
- **Approval** (`direct_cost.approve`: PM, finance): for each line the
  budget line is the one named, else the cost code's active line of the
  line's cost type (defaults by cost type: invoice → material, payroll →
  labour, expense → indirect, other → other), else any active line of the
  cost code; `actual` is incremented; lines without a budget line are
  noted on the cost. Activities get `CostRecord.actual` incremented
  (record created if missing, `actualThroughDate` moved to the cost date).
  `postedAmount` and `budgetLineId` are stored per line.
- **Return** (pending → draft) needs a reason; **void** needs a reason,
  decrements the posted amounts and is refused once a payment exists
  (409 `DIRECT_COST_HAS_PAYMENTS`).
- **Payments** (`direct_cost.pay`: PM, finance) on approved costs, ≤ the
  balance (400 `DIRECT_COST_PAYMENT_EXCEEDS`); paid in full → paid; the
  cash flow is rebuilt (payments by month as outflows next to IPC and
  sub-pay-app payments).
- Overdue = approved / pending with a balance past the due date.
- Report source **Direct costs**; attachments and history on
  `direct_cost`; record link → Cost Control › Direct Costs.

## API (tag "Direct Costs", `/projects/{id}/direct-costs`)

| Endpoint | Permission |
| --- | --- |
| `GET /?status&type&vendorCompanyId&from&to&q` | `cost.read` |
| `POST /` | `cost.create` |
| `GET /{directCostId}`, `PATCH /{directCostId}`, `DELETE /{directCostId}` | `cost.read` / `cost.update` / `cost.delete` |
| `POST /{directCostId}/submit` | `direct_cost.submit` (PM, QS, cost controller) |
| `POST /{directCostId}/approve`, `…/reject { reason }` | `direct_cost.approve` (PM, finance) |
| `POST /{directCostId}/void { reason }` | `direct_cost.void` (PM, finance) |
| `POST /{directCostId}/payments { amount, paidAt?, method?, reference?, note? }` | `direct_cost.pay` (PM, finance) |

## Test

```bash
cd backend && npx jest src/services/__tests__/direct-cost.service.test.js
cd frontend && node scripts/direct-costs-ui.test.mjs
```

Manual: New direct cost (invoice, vendor from the directory, invoice number)
→ two lines: one on a cost code with an activity, one on a budget line →
Submit → as finance, Approve and post → Budget shows the lines' actuals up,
Cost Control › By Activity shows the activity's actual up → record a partial
payment → balance and status update, Cash Flow shows the outflow → record
the rest → paid.
