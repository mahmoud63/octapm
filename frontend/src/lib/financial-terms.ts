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
  // A BOQ item's share of executed contracts before any approved commitment
  // change order (owner decision R5-3): a partial figure, never called
  // "Committed" — the committed cost on cost records and the budget register
  // includes approved variations.
  baseCommitmentValue: {
    label: 'Base commitment value (excluding approved variations)',
    hint: 'Executed or closed commitment SOV lines naming this BOQ item — approved commitment change orders are not included',
  },
  manualCommitted: {
    label: 'Committed (manual)',
    hint: 'A figure typed on the budget line; replaced by executed commitments once any exist',
  },
  poValue: {
    label: 'PO value',
    hint: 'Order value — not committed cost: purchase orders that are neither planned nor cancelled',
  },
  // The three budgets that coexist (control model §3): each screen says
  // which one it shows, and none is called by another's name.
  budgetRegister: {
    label: 'Budget',
    hint: 'The budget register: original + approved changes + revisions',
  },
  evBudgetAtCompletion: {
    label: 'Budget at completion (EV basis)',
    hint: 'Approved BOQ allocations + approved budget revisions — the budget earned value is measured against',
  },
  contractWaterfall: {
    label: 'Contract value + approved changes',
    hint: 'The project contract value plus approved budget revisions (the revisions waterfall)',
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
  // The cost records' own projection (owner decision R5-2): never called the
  // EAC — the EAC is the earned-value report's revised budget ÷ CPI (D2),
  // which reads no cost record's forecast.
  costRecordsFinalCost: {
    label: 'Projected final cost (cost records)',
    hint: "Σ each activity cost record's projected final cost: an entered forecast counts as entered (0 included) and never below actual cost; a default is not counted as a forecast — the larger of budget and actual counts; an unrecorded one counts when above 0 and not below actual, otherwise the larger of budget and actual — not the earned-value EAC (revised budget ÷ CPI)",
  },
  // A cost record's stored forecast, by where it came from (R5-2). The server
  // sends the basis text; these are the column's name and the marker's.
  recordForecast: {
    label: 'Forecast',
    hint: 'The forecast stored on the cost record: entered, or the initial default when none was entered',
  },
  defaultForecastMarker: {
    label: 'Default',
    hint: 'Default forecast: the larger of the budget and the actual cost as they stood when it was set; it does not follow them afterwards (no forecast was entered)',
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

/**
 * The three truths (PC-7a; control model §3). The server labels each figure
 * "source", "derived" or "projection:<basis>"; a screen shows which, so a
 * projection is never read as a fact. Labels only — no figure is computed
 * from them.
 */
export type FigureTruthKind = 'source' | 'derived' | 'projection'

export const FIGURE_TRUTH: Record<
  FigureTruthKind,
  { label: string; hint: string }
> = {
  source: {
    label: 'Source',
    hint: 'A fact somebody approved, executed, certified or posted',
  },
  derived: {
    label: 'Derived',
    hint: 'Computed only from source records; rebuildable at any time',
  },
  projection: {
    label: 'Projection',
    hint: 'An estimate about the future — never feeds a certified figure',
  },
}

/** Reads a server truth label ("projection:typed" → projection, basis "typed"). */
export const parseTruth = (
  value: string | null | undefined
): { kind: FigureTruthKind; basis: string | null } | null => {
  if (!value) return null
  const [kind, ...rest] = value.split(':')
  if (kind !== 'source' && kind !== 'derived' && kind !== 'projection')
    return null
  return { kind, basis: rest.length ? rest.join(':') : null }
}

/**
 * One vocabulary for quantities on screen (PC-6; OCTAPM_PROGRESS_MEASUREMENT
 * §5–§6). Received, issued, installed, certified and paid are five figures
 * with five truths: never merged, never summed across units, each with its
 * own basis. Labels and one-line meanings only — no figure is computed from
 * them, and every value comes from the server with its truth and basis.
 */
export const QUANTITY_TERMS = {
  installed: {
    label: 'Installed',
    hint: 'Σ approved quantity progress entries — official only once a progress approver has approved them; "—" on an activity not measured by quantity, never pct × quantity',
  },
  certified: {
    label: 'Certified',
    hint: 'Σ IPC item quantity on certified or paid client certificates; a subcontract pay application carries amounts only, so its certified quantity reads "—"',
  },
  paidProRata: {
    label: 'Paid (pro-rata)',
    hint: 'A projection: certified quantity × (Σ payments received ÷ certificate total), per certificate — never a fact',
  },
  received: {
    label: 'Received',
    hint: 'Σ stock receipts naming this BOQ item, in the inventory item’s unit — shown only when that unit is the BOQ unit',
  },
  issued: {
    label: 'Issued',
    hint: 'Σ stock issues (less returns) naming this BOQ item, in the inventory item’s unit — shown only when that unit is the BOQ unit',
  },
  committedQuantity: {
    label: 'Committed quantity (excluding variations)',
    hint: 'Σ commitment SOV line quantity on executed or closed commitments naming this BOQ item — approved commitment change orders carry no quantity and are not included',
  },
  planned: {
    label: 'Planned',
    hint: 'The quantity the activity is measured against: Σ approved allocation quantities per BOQ item (or the figure typed on the method when no allocation defines it)',
  },
} as const

export type QuantityTermKey = keyof typeof QUANTITY_TERMS
