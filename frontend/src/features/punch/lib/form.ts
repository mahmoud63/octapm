import type {
  PunchItem,
  PunchItemInput,
  PunchPriority,
} from '../hooks/use-punch'

export interface PunchFormValue {
  title: string
  description: string
  priority: PunchPriority
  trade: string
  locationId: string | null
  locationText: string
  sheetId: string | null
  assigneeCompanyId: string | null
  assigneeUserId: string | null
  managerUserId: string | null
  finalApproverUserId: string | null
  dueDate: string
}

export const emptyPunchForm = (
  overrides: Partial<PunchFormValue> = {}
): PunchFormValue => ({
  title: '',
  description: '',
  priority: 'normal',
  trade: '',
  locationId: null,
  locationText: '',
  sheetId: null,
  assigneeCompanyId: null,
  assigneeUserId: null,
  managerUserId: null,
  finalApproverUserId: null,
  dueDate: '',
  ...overrides,
})

export const itemToForm = (item: PunchItem): PunchFormValue => ({
  title: item.title,
  description: item.description ?? '',
  priority: item.priority,
  trade: item.trade ?? '',
  locationId: item.locationId,
  locationText: item.locationText ?? '',
  sheetId: item.sheetId,
  assigneeCompanyId: item.assigneeCompanyId,
  assigneeUserId: item.assigneeUserId,
  managerUserId: item.managerUserId,
  finalApproverUserId: item.finalApproverUserId,
  dueDate: item.dueDate ? item.dueDate.slice(0, 10) : '',
})

/**
 * Turns the form into an API payload. `create` omits empty fields; `update`
 * sends `null` so a cleared field is cleared on the server too.
 */
export const formToPayload = (
  form: PunchFormValue,
  {
    mode,
    includeTitle = true,
  }: { mode: 'create' | 'update'; includeTitle?: boolean }
): PunchItemInput => {
  const full: PunchItemInput = {
    ...(includeTitle ? { title: form.title.trim() } : {}),
    description: form.description.trim() || null,
    priority: form.priority,
    trade: form.trade.trim() || null,
    locationId: form.locationId || null,
    locationText: form.locationText.trim() || null,
    sheetId: form.sheetId || null,
    assigneeCompanyId: form.assigneeCompanyId || null,
    assigneeUserId: form.assigneeUserId || null,
    managerUserId: form.managerUserId || null,
    finalApproverUserId: form.finalApproverUserId || null,
    dueDate: form.dueDate || null,
  }
  if (mode === 'update') return full
  return Object.fromEntries(
    Object.entries(full).filter(([, value]) => value !== null)
  ) as PunchItemInput
}

/** One title per line → items; blank lines and leading bullets are ignored. */
export const parseBulkTitles = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .map((title) => ({ title: title.slice(0, 200) }))
