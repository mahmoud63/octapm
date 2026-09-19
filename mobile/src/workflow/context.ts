import { humanise, money } from '@/utilities/format'

/**
 * What a person is being asked to decide.
 *
 * The server builds a `context` for every workflow record (see
 * `backend/src/services/workflow-tools.js`) and carries it on the instance.
 * Until this phase the app never showed it, so a change order could be
 * approved on a phone with only its reference and title on screen. Nothing
 * here computes a figure: every value comes from that context, and the
 * labels are the server's own.
 */
export type WorkflowContext = Record<string, unknown>

/** The tools whose approval is a decision about money. */
const FINANCIAL_TOOLS = new Set(['change_order', 'commitment', 'sub_pay_app', 'ipc_certificate', 'budget_revision'])

/** How the product names one record of each tool, for a sentence. */
const SINGULAR: Record<string, string> = {
  change_order: 'change order',
  commitment: 'commitment',
  sub_pay_app: 'pay application',
  ipc_certificate: 'IPC certificate',
  budget_revision: 'budget revision',
  submittal: 'submittal',
  correspondence: 'letter',
  document_revision: 'document revision',
}

/** The server's own labels, per tool, in the order a person reads them. */
const FIELDS: Record<string, { key: string; label: string; kind?: 'money' | 'days' | 'percent' }[]> = {
  change_order: [
    { key: 'amount', label: 'Change value', kind: 'money' },
    { key: 'category', label: 'Reason' },
    { key: 'scheduleImpact', label: 'Schedule impact', kind: 'days' },
  ],
  commitment: [
    { key: 'amount', label: 'Schedule of values', kind: 'money' },
    { key: 'vendor', label: 'Vendor' },
    { key: 'type', label: 'Type' },
    { key: 'retentionRate', label: 'Retention', kind: 'percent' },
  ],
  sub_pay_app: [
    { key: 'amount', label: 'Net this period', kind: 'money' },
    { key: 'gross', label: 'Gross this period', kind: 'money' },
    { key: 'overClaim', label: 'Over-claim', kind: 'money' },
    { key: 'vendor', label: 'Vendor' },
  ],
  ipc_certificate: [
    { key: 'amount', label: 'Net payable', kind: 'money' },
    { key: 'totalCert', label: 'Certified', kind: 'money' },
    { key: 'period', label: 'Period' },
  ],
  budget_revision: [
    { key: 'amount', label: 'Amount', kind: 'money' },
    { key: 'changeType', label: 'Change type' },
  ],
  submittal: [
    { key: 'discipline', label: 'Discipline' },
    { key: 'leadTimeWeeks', label: 'Lead time (weeks)' },
  ],
  correspondence: [
    { key: 'type', label: 'Type' },
    { key: 'direction', label: 'Direction' },
  ],
  document_revision: [],
}

/** Keys shown by every tool, and keys the record header already carries. */
const ALWAYS_LAST: { key: string; label: string }[] = [{ key: 'status', label: 'Status' }]
const HEADER_KEYS = new Set(['ref', 'title'])

const present = (value: unknown) => value !== null && value !== undefined && value !== '' && !(typeof value === 'number' && Number.isNaN(value))

const format = (value: unknown, kind: 'money' | 'days' | 'percent' | undefined, currency?: string | null): string => {
  if (kind === 'money') return money(Number(value), currency ?? undefined)
  if (kind === 'days') {
    const days = Number(value)
    return days === 0 ? 'None' : `${days} day${Math.abs(days) === 1 ? '' : 's'}`
  }
  if (kind === 'percent') return `${Number(value)}%`
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return humanise(String(value))
}

export interface ContextFact {
  key: string
  label: string
  value: string
}

/**
 * The context as facts a person can read, in the server's own words. Keys the
 * server sent that this app has no label for are still shown, humanised, so a
 * new field on the server never goes silently missing from a decision.
 */
export function contextFacts(tool: string, context: WorkflowContext | null | undefined, currency?: string | null): ContextFact[] {
  if (!context) return []
  const known = FIELDS[tool] ?? []
  const facts: ContextFact[] = []
  const used = new Set<string>([...HEADER_KEYS, ...ALWAYS_LAST.map((f) => f.key)])
  // `amount` is a money field only where the approval is a money decision:
  // the server sends `amount: 0` for a submittal, and a submittal approval is
  // not worth nothing, it is worth nothing to say.
  if (!isFinancialTool(tool)) used.add('amount')
  for (const field of known) {
    used.add(field.key)
    if (!present(context[field.key])) continue
    facts.push({ key: field.key, label: field.label, value: format(context[field.key], field.kind, currency) })
  }
  for (const [key, value] of Object.entries(context)) {
    if (used.has(key) || !present(value)) continue
    facts.push({ key, label: humanise(key), value: format(value, undefined, currency) })
  }
  for (const field of ALWAYS_LAST) {
    if (!present(context[field.key])) continue
    facts.push({ key: field.key, label: field.label, value: format(context[field.key], undefined, currency) })
  }
  return facts
}

/** The money figure a financial decision turns on, or null when the tool is not a money decision. */
export function approvalAmount(tool: string, context: WorkflowContext | null | undefined): number | null {
  if (!FINANCIAL_TOOLS.has(tool)) return null
  const raw = context?.amount
  const amount = Number(raw)
  return present(raw) && Number.isFinite(amount) ? amount : null
}

export const isFinancialTool = (tool: string) => FINANCIAL_TOOLS.has(tool)

/**
 * Whether this decision can be made safely on a phone. A money decision with
 * no amount on screen cannot: the app offers "Review on web" instead of an
 * approve button it cannot justify.
 */
export function canDecideHere(tool: string, context: WorkflowContext | null | undefined): boolean {
  if (!isFinancialTool(tool)) return true
  return approvalAmount(tool, context) !== null
}

/** The singular noun for a sentence, e.g. "change order". */
export const toolNoun = (tool: string, toolLabel?: string | null) => SINGULAR[tool] ?? (toolLabel ? toolLabel.toLowerCase().replace(/s$/, '') : 'record')

/**
 * The confirmation a person reads before a decision is recorded: what they are
 * deciding, what it is worth, and that it goes into the audit trail.
 */
export function confirmationText(input: { tool: string; toolLabel?: string | null; reference?: string | null; optionLabel: string; positive: boolean; context: WorkflowContext | null | undefined; currency?: string | null }): { title: string; body: string } {
  const noun = toolNoun(input.tool, input.toolLabel)
  const ref = input.reference ? ` ${input.reference}` : ''
  const amount = approvalAmount(input.tool, input.context)
  const valueLabel = (FIELDS[input.tool] ?? []).find((f) => f.key === 'amount')?.label ?? 'Value'
  const lines: string[] = []
  if (amount !== null) lines.push(`${valueLabel}: ${money(amount, input.currency ?? undefined)}`)
  lines.push(input.positive ? 'This action will record your approval in the project audit trail.' : 'This action will record your decision in the project audit trail.')
  return { title: `${input.optionLabel} ${noun}${ref}?`, body: lines.join('\n') }
}
