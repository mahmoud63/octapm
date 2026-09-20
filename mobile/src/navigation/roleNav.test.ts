import type { PermissionMatrix } from '@/api/types'
import { ALL_SLOT_NAMES, resolveCaptureActions, resolveMore, resolveTabs } from './roleNav'

/** A matrix granting read+create+submit on the named modules and nothing else. */
const matrix = (modules: string[], actions: string[] = ['read', 'create', 'submit']): PermissionMatrix =>
  ({
    orgId: 'o1',
    projectId: 'p1',
    userId: 'u1',
    isCompanyAdmin: false,
    source: 'test',
    role: 'test',
    partyRoles: [],
    template: null,
    modules: Object.fromEntries(modules.map((m) => [m, { visible: true, actions, transitions: [] }])),
  }) as unknown as PermissionMatrix

const EVERYTHING = matrix([
  'progress', 'schedule', 'lookahead', 'document_control', 'inspection', 'ncr', 'punch', 'safety',
  'inventory', 'procurement', 'change_order', 'change_event', 'cost', 'commitment', 'report',
  'rfi', 'task', 'timesheet', 'workflow', 'user_management', 'project_parties',
])

const ctx = (role: string, m = EVERYTHING, extra: object = {}) => ({ role, matrix: m, hasProject: true, ...extra })

describe('the shape of the app follows the role', () => {
  it('gives each role its own five slots, not one bar for everyone', () => {
    const titles = (role: string) => resolveTabs(ctx(role)).map((t) => t.title)
    expect(titles('pm')).toEqual(['Home', 'Needs You', 'Project', 'Controls', 'More'])
    expect(titles('site_engineer')).toEqual(['Today', 'Site', 'Capture', 'Drawings', 'More'])
    expect(titles('quality_engineer')).toEqual(['Home', 'Inspections', 'Capture', 'Issues', 'More'])
    expect(titles('warehouse')).toEqual(['Home', 'Scan', 'Receive', 'Stock', 'More'])
    expect(titles('procurement')).toEqual(['Home', 'Orders', 'Deliveries', 'Suppliers', 'More'])
    expect(titles('planning_eng')).toEqual(['Home', 'Schedule', 'Lookahead', 'Progress', 'More'])
    expect(titles('qs')).toEqual(['Home', 'Needs You', 'Commercial', 'Approvals', 'More'])
    expect(titles('cost_controller')).toEqual(['Home', 'Needs You', 'Commercial', 'Approvals', 'More'])
    expect(titles('finance')).toEqual(['Home', 'Needs You', 'Commercial', 'Approvals', 'More'])
  })

  it('separates the two field roles that share a permission set', () => {
    // site_engineer and quality_engineer hold identical rights; only the
    // emphasis differs, which is the whole reason role drives the shape.
    const site = resolveTabs(ctx('site_engineer')).map((t) => t.title)
    const quality = resolveTabs(ctx('quality_engineer')).map((t) => t.title)
    expect(site).not.toEqual(quality)
    expect(resolveCaptureActions(ctx('site_engineer'))[0]!.id).toBe('progress')
    expect(resolveCaptureActions(ctx('quality_engineer'))[0]!.id).toBe('inspection')
  })

  it('gives the field roles a capture button and the deciding roles a second destination', () => {
    const hasCapture = (role: string) => resolveTabs(ctx(role)).some((t) => t.capture)
    expect(hasCapture('site_engineer')).toBe(true)
    expect(hasCapture('quality_engineer')).toBe(true)
    expect(hasCapture('pm')).toBe(false)
    expect(hasCapture('cost_controller')).toBe(false)
  })

  it('falls back to a safe shape for a role it has never seen', () => {
    expect(resolveTabs(ctx('warranty_manager')).map((t) => t.title)).toEqual(['Home', 'Needs You', 'Projects', 'Search', 'More'])
  })
})

describe('permission decides, role never does', () => {
  it('drops a slot the server has not granted rather than showing it', () => {
    // A quality engineer whose NCR rights were removed loses the Issues tab.
    const noNcr = matrix(['inspection', 'punch', 'document_control', 'progress'])
    expect(resolveTabs(ctx('quality_engineer', noNcr)).map((t) => t.title)).toEqual(['Home', 'Inspections', 'Capture', 'More'])
  })

  it('offers no capture action the server would refuse', () => {
    const readOnly = matrix(['progress', 'rfi', 'ncr'], ['read'])
    expect(resolveCaptureActions(ctx('site_engineer', readOnly))).toEqual([])
  })

  it('never grants a capture action from the role alone', () => {
    // The role that most wants to raise an NCR still cannot without the right.
    const withoutNcr = matrix(['inspection', 'document_control'])
    const ids = resolveCaptureActions(ctx('quality_engineer', withoutNcr)).map((a) => a.id)
    expect(ids).not.toContain('ncr')
    expect(ids).toContain('inspection')
  })

  it('shows an empty bar rather than inventing one when nothing is permitted', () => {
    const nothing = matrix([])
    const titles = resolveTabs(ctx('site_engineer', nothing)).map((t) => t.title)
    expect(titles).toEqual(['Today', 'Capture', 'More'])
  })
})

describe('More is a directory, and administration is a capability', () => {
  it('lists only the modules the person may read', () => {
    const small = matrix(['progress', 'rfi'], ['read'])
    const groups = resolveMore(ctx('site_engineer', small))
    expect(groups.map((g) => g.title)).toEqual(['You', 'Project modules'])
    expect(groups.find((g) => g.title === 'Project modules')!.entries.map((e) => e.id).sort()).toEqual(['rfi', 'site'])
  })

  it('always offers what belongs to the person, whatever the project allows', () => {
    // Notifications and what is waiting to send are mine wherever I am; they
    // are not a project module and no permission gates them.
    const nothing = matrix([])
    const groups = resolveMore(ctx('site_engineer', nothing))
    const you = groups.find((g) => g.title === 'You')!
    expect(you.entries.map((e) => e.id)).toEqual(['notifications', 'outbox'])
  })

  it('adds Administration for a company admin and never for anyone else', () => {
    expect(resolveMore(ctx('pm')).map((g) => g.title)).toEqual(['You', 'Project modules'])
    const admin = resolveMore(ctx('pm', EVERYTHING, { isCompanyAdmin: true }))
    expect(admin.map((g) => g.title)).toEqual(['You', 'Project modules', 'Administration'])
  })

  it('still asks permission for each administration entry', () => {
    // Company admin without user_management sees no people entry.
    const m = matrix(['progress', 'project_parties'], ['read'])
    const groups = resolveMore(ctx('pm', m, { isCompanyAdmin: true }))
    const admin = groups.find((g) => g.title === 'Administration')!
    expect(admin.entries.map((e) => e.id)).toEqual(['parties'])
  })

  it('shows no module directory before a project is chosen', () => {
    const groups = resolveMore({ role: 'pm', matrix: EVERYTHING, hasProject: false })
    expect(groups.map((g) => g.title)).toEqual(['You'])
  })
})

describe('the shell', () => {
  it('knows every slot any role can ask for, so the rest can be hidden', () => {
    for (const role of ['pm', 'site_engineer', 'quality_engineer', 'warehouse', 'procurement', 'planning_eng', 'qs', 'cost_controller', 'finance']) {
      for (const slot of resolveTabs(ctx(role))) expect(ALL_SLOT_NAMES).toContain(slot.name)
    }
  })
})
