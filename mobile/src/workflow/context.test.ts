import { approvalAmount, canDecideHere, confirmationText, contextFacts, isFinancialTool, toolNoun } from './context'

// The payload the server actually sends for a change-order approval, copied
// from a live instance in the end-to-end organisation.
const CHANGE_ORDER = { ref: 'VO-08', title: 'E2E probe 4', amount: 1500, status: 'pending', category: 'site_condition', scheduleImpact: 0 }

describe('what the approver is shown', () => {
  it('puts the money first, in the platform’s own words', () => {
    const facts = contextFacts('change_order', CHANGE_ORDER, 'USD')
    expect(facts[0]!.label).toBe('Change value')
    expect(facts[0]!.value).toContain('1,500')
    expect(facts.map((f) => f.label)).toEqual(['Change value', 'Reason', 'Schedule impact', 'Status'])
    expect(facts.find((f) => f.key === 'category')?.value).toBe('Site condition')
    expect(facts.find((f) => f.key === 'scheduleImpact')?.value).toBe('None')
  })

  it('never repeats the reference and title the header already carries', () => {
    const keys = contextFacts('change_order', CHANGE_ORDER, 'USD').map((f) => f.key)
    expect(keys).not.toContain('ref')
    expect(keys).not.toContain('title')
  })

  it('uses each tool’s own vocabulary for its money field', () => {
    expect(contextFacts('sub_pay_app', { amount: 40000, gross: 50000, overClaim: 0, vendor: 'Delta MEP' }, 'USD').map((f) => f.label)).toEqual(['Net this period', 'Gross this period', 'Over-claim', 'Vendor'])
    expect(contextFacts('ipc_certificate', { amount: 120000, totalCert: 900000, period: '2026-08' }, 'USD').map((f) => f.label)).toEqual(['Net payable', 'Certified', 'Period'])
    expect(contextFacts('commitment', { amount: 250000, vendor: 'Delta MEP', type: 'subcontract', retentionRate: 5 }, 'USD').map((f) => f.label)).toEqual(['Schedule of values', 'Vendor', 'Type', 'Retention'])
    expect(contextFacts('budget_revision', { amount: -5000, changeType: 'transfer' }, 'USD').map((f) => f.label)).toEqual(['Amount', 'Change type'])
  })

  it('shows a field the server adds later rather than dropping it', () => {
    const facts = contextFacts('change_order', { ...CHANGE_ORDER, counterparty: 'Delta MEP' }, 'USD')
    expect(facts.find((f) => f.key === 'counterparty')).toEqual({ key: 'counterparty', label: 'Counterparty', value: 'Delta mep' })
  })

  it('leaves out what the server did not send', () => {
    const facts = contextFacts('change_order', { ref: 'VO-09', amount: 800, status: 'pending', category: null, scheduleImpact: null }, 'USD')
    expect(facts.map((f) => f.key)).toEqual(['amount', 'status'])
  })

  it('reads a figure the server withheld as "—", never 0, and does not show the marker', () => {
    // An IPC submitted while the contract value is unestablished under a retention cap.
    const context = { ref: 'P02', title: 'IPC P02', status: 'submitted', totalCert: 6133.7, period: 'P02', valueWithheld: { keys: ['amount'], source: 'boq_fallback', reason: 'withheld' } }
    const facts = contextFacts('ipc_certificate', context, 'USD')
    expect(facts.map((f) => [f.label, f.value])).toEqual([['Net payable', '—'], ['Certified', expect.stringContaining('6,133.7')], ['Period', 'P02'], ['Status', 'Submitted']])
    expect(approvalAmount('ipc_certificate', context)).toBeNull()
    expect(canDecideHere('ipc_certificate', context)).toBe(false)
  })

  it('does not dress up a submittal as a decision about nothing', () => {
    // The server sends `amount: 0` for a submittal; a submittal approval is not a money decision.
    expect(contextFacts('submittal', { discipline: 'mep', leadTimeWeeks: 12, amount: 0 }, 'USD').map((f) => f.label)).toEqual(['Discipline', 'Lead time (weeks)'])
  })
})

describe('what may be decided on a phone', () => {
  it('reads the amount only for the tools whose approval is about money', () => {
    expect(approvalAmount('change_order', CHANGE_ORDER)).toBe(1500)
    expect(approvalAmount('submittal', { amount: 0 })).toBeNull()
    expect(isFinancialTool('ipc_certificate')).toBe(true)
    expect(isFinancialTool('correspondence')).toBe(false)
  })

  it('refuses to offer a money decision it cannot put a figure against', () => {
    expect(canDecideHere('change_order', CHANGE_ORDER)).toBe(true)
    expect(canDecideHere('change_order', { ref: 'VO-09', status: 'pending' })).toBe(false)
    expect(canDecideHere('change_order', null)).toBe(false)
    expect(canDecideHere('budget_revision', { changeType: 'transfer' })).toBe(false)
  })

  it('still lets the non-financial decisions through', () => {
    expect(canDecideHere('submittal', { discipline: 'mep' })).toBe(true)
    expect(canDecideHere('correspondence', null)).toBe(true)
    expect(canDecideHere('document_revision', {})).toBe(true)
  })
})

describe('the confirmation', () => {
  it('names the record, the money and the consequence', () => {
    const { title, body } = confirmationText({ tool: 'change_order', toolLabel: 'Change orders', reference: 'VO-08', optionLabel: 'Approve', positive: true, context: CHANGE_ORDER, currency: 'USD' })
    expect(title).toBe('Approve change order VO-08?')
    expect(body).toContain('Change value: ')
    expect(body).toContain('1,500')
    expect(body).toContain('This action will record your approval in the project audit trail.')
  })

  it('says "decision", not "approval", when the answer is a refusal', () => {
    const { title, body } = confirmationText({ tool: 'change_order', toolLabel: 'Change orders', reference: 'VO-08', optionLabel: 'Reject', positive: false, context: CHANGE_ORDER, currency: 'USD' })
    expect(title).toBe('Reject change order VO-08?')
    expect(body).toContain('1,500')
    expect(body).toContain('This action will record your decision in the project audit trail.')
  })

  it('carries each tool’s own money label into the sentence', () => {
    expect(confirmationText({ tool: 'sub_pay_app', reference: 'PA-03', optionLabel: 'Certify', positive: true, context: { amount: 40000 }, currency: 'USD' }).body).toContain('Net this period: ')
    expect(confirmationText({ tool: 'ipc_certificate', reference: '2026-08', optionLabel: 'Approve', positive: true, context: { amount: 120000 }, currency: 'USD' }).title).toBe('Approve IPC certificate 2026-08?')
  })

  it('claims no figure for a decision that has none', () => {
    const { title, body } = confirmationText({ tool: 'submittal', toolLabel: 'Submittals', reference: 'SUB-12', optionLabel: 'Approve', positive: true, context: { discipline: 'mep' }, currency: 'USD' })
    expect(title).toBe('Approve submittal SUB-12?')
    expect(body).toBe('This action will record your approval in the project audit trail.')
  })

  it('falls back to the server’s own label for a tool it has never seen', () => {
    expect(toolNoun('warranty_claim', 'Warranty claims')).toBe('warranty claim')
    expect(toolNoun('warranty_claim')).toBe('record')
  })
})
