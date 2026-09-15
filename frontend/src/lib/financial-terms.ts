/**
 * One vocabulary for money on screen (Phase 22B).
 *
 * The Phase 22 audit found "Committed" meaning two different things — the
 * value of purchase orders in Procurement, the value of executed commitments
 * in Cost and Commercial — and "Budget" meaning three. Every card, column,
 * filter and export that shows one of these figures takes its label and its
 * one-line meaning from here, so the same number always carries the same
 * name and two different numbers never share one.
 */
export const FINANCIAL_TERMS = {
  contractValue: {
    label: 'Contract value',
    hint: 'The contract sum agreed with the client',
  },
  originalBudget: {
    label: 'Original budget',
    hint: 'The approved starting budget',
  },
  approvedChanges: {
    label: 'Approved changes',
    hint: 'Approved change orders',
  },
  revisions: {
    label: 'Revisions & transfers',
    hint: 'Approved budget revisions and transfers',
  },
  revisedBudget: {
    label: 'Revised budget',
    hint: 'Original + approved changes + revisions',
  },
  activityBudget: {
    label: 'Activity budget',
    hint: 'Σ activity budgets on this schedule revision',
  },
  allocatedToActivities: {
    label: 'Allocated to activities',
    hint: 'Budget carried on activity cost records',
  },
  executedCommitments: {
    label: 'Executed commitments',
    hint: 'Value of executed subcontracts and purchase orders',
  },
  manualCommitted: {
    label: 'Committed (manual)',
    hint: 'A figure typed on the budget line; replaced by executed commitments once any exist',
  },
  poValue: {
    label: 'PO value',
    hint: 'Value of purchase orders that are neither planned nor cancelled',
  },
  invoiced: {
    label: 'Invoiced',
    hint: 'Supplier invoices recorded against purchase orders',
  },
  certifiedCost: {
    label: 'Certified cost',
    hint: 'Subcontract work certified on pay applications',
  },
  actualCost: {
    label: 'Actual cost',
    hint: 'Posted to the cost ledger to date',
  },
  forecastEac: {
    label: 'Forecast (EAC)',
    hint: 'Estimate at completion on activity cost records — never below actual cost',
  },
  lineForecast: {
    label: 'Forecast (budget lines)',
    hint: 'Forecast of every budget line; a line with no forecast set expects its revised budget',
  },
  retention: {
    label: 'Retention held',
    hint: 'Certified value withheld until release',
  },
  cashIn: {
    label: 'Cash in',
    hint: 'Client receipts to date',
  },
  cashOut: {
    label: 'Cash out',
    hint: 'Payments made to subcontractors and suppliers',
  },
  receivable: {
    label: 'Receivable',
    hint: 'Certified and invoiced to the client, not yet received',
  },
} as const

export type FinancialTermKey = keyof typeof FINANCIAL_TERMS

export const term = (key: FinancialTermKey) => FINANCIAL_TERMS[key].label
export const termHint = (key: FinancialTermKey) => FINANCIAL_TERMS[key].hint
