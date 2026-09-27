import { linkLeavesWorkspace, normaliseLinkPath, resolveLink, resolveNotificationData, routeForResolvedLink, type ResolvedLink } from './deepLinks'

const P = 'a2153ef4-0bbb-4b9a-875c-44a0f69f9a12'
const ORG_A = '0f6f1a2e-0000-4000-8000-00000000000a'
const ORG_B = '0f6f1a2e-0000-4000-8000-00000000000b'
const none = { orgId: null, orgSlug: null }
const link = (route: string, projectId: string | null, workspace: Partial<Pick<ResolvedLink, 'orgId' | 'orgSlug'>> = {}): ResolvedLink => ({ route, projectId, ...none, ...workspace })

describe('deep links', () => {
  it('normalises the scheme, a universal link, group segments and the query', () => {
    expect(normaliseLinkPath('octapm://rfi/abc?x=1')).toEqual({ path: '/rfi/abc', params: new URLSearchParams('x=1'), workspace: null })
    expect(normaliseLinkPath('https://app.octapm.com/tasks?recordId=t1')?.path).toBe('/tasks')
    expect(normaliseLinkPath('/(app)/rfi/abc')?.path).toBe('/rfi/abc')
    // A workspace-prefixed web link (ENT-4) resolves to the path under the workspace, and keeps the handle.
    expect(normaliseLinkPath('/o/acme/tasks?recordId=t1')).toEqual({ path: '/tasks', params: new URLSearchParams('recordId=t1'), workspace: 'acme' })
    expect(normaliseLinkPath('https://app.octapm.com/o/acme/projects/p1/quality/ncr')?.path).toBe('/projects/p1/quality/ncr')
    expect(normaliseLinkPath('')).toBeNull()
  })

  it('opens the web platform record paths the server puts in notifications, with the project they belong to', () => {
    expect(resolveLink(`/projects/${P}/rfi?recordId=r1&source=rfi`)).toEqual(link('/rfi/r1', P))
    expect(resolveLink(`https://app.octapm.com/projects/${P}/quality/defects?recordId=pi1`)).toEqual(link('/quality/punch/pi1', P))
    expect(resolveLink(`/projects/${P}/commercial/change-orders?recordId=co1&status=submitted`)).toEqual(link('/commercial/change-orders/co1', P))
    expect(resolveLink(`/projects/${P}/procurement?recordId=po1&source=purchase_order`)).toEqual(link('/procurement/orders/po1', P))
    expect(resolveLink(`/projects/${P}/site-reporting?date=2026-09-18`)).toEqual(link('/site?date=2026-09-18', P))
  })

  it('lands on a module home when the record has no screen, and on Home for the project itself', () => {
    expect(resolveLink(`/projects/${P}/quality`)).toEqual(link('/quality', P))
    // The same link as the web now mints it, with its workspace in front (ENT-4): the handle rides along.
    expect(resolveLink(`/o/acme/projects/${P}/quality`)).toEqual(link('/quality', P, { orgSlug: 'acme' }))
    expect(resolveLink(`https://app.octapm.com/o/acme/projects/${P}/rfi?recordId=r1&source=rfi`)).toEqual(link('/rfi/r1', P, { orgSlug: 'acme' }))
    expect(resolveLink(`/projects/${P}/cost?recordId=x&source=ipc_certificate`)).toBeNull()
    expect(resolveLink(`/projects/${P}`)).toEqual(link('/', P))
    expect(resolveLink('/projects/not-a-uuid/rfi')).toBeNull()
  })

  it('opens the project-less web paths and the app’s own routes', () => {
    expect(resolveLink('/tasks?recordId=t7')).toEqual(link('/tasks/t7', null))
    expect(resolveLink('/inventory?orderRef=PO-0001')).toEqual(link('/inventory/receive', null))
    expect(resolveLink('octapm://quality/inspections/f1')).toEqual(link('/quality/inspections/f1', null))
    expect(resolveLink('/activities/a1?projectId=' + P)).toEqual(link(`/activities/a1?projectId=${P}`, P))
    expect(resolveLink('https://octapm.com/marketing')).toBeNull()
  })

  it('reads the workspace an app link or a push payload names, and keeps it off the screen’s own query', () => {
    // The project stays on the screen's query, as it always did; the workspace does not.
    expect(resolveLink(`octapm://rfi/r1?projectId=${P}&orgId=${ORG_B}`)).toEqual(link(`/rfi/r1?projectId=${P}`, P, { orgId: ORG_B }))
    expect(resolveLink(`/open?to=%2Frfi%2Fr1&orgSlug=beta`)).toEqual(link('/open?to=%2Frfi%2Fr1', null, { orgSlug: 'beta' }))
    expect(resolveLink(`/o/beta/projects/${P}/rfi?recordId=r1&source=rfi&orgId=${ORG_B}`)).toEqual(link('/rfi/r1', P, { orgId: ORG_B, orgSlug: 'beta' }))
  })

  it('routes a push notification by its record first and by its url second, carrying the workspace the payload names', () => {
    expect(resolveNotificationData({ entityType: 'ncr', entityId: 'n1', projectId: P })).toEqual(link('/quality/ncr/n1', P))
    expect(resolveNotificationData({ entityType: 'ncr', entityId: 'n1', projectId: P, orgId: ORG_A, orgSlug: 'acme', membershipId: 'm1' })).toEqual(link('/quality/ncr/n1', P, { orgId: ORG_A, orgSlug: 'acme' }))
    expect(resolveNotificationData({ entityType: 'ipc_certificate', entityId: 'i1', url: `/projects/${P}/rfi?recordId=r2&source=rfi` })).toEqual(link('/rfi/r2', P))
    // The payload's naming wins over the URL's handle.
    expect(resolveNotificationData({ url: `/o/acme/projects/${P}/rfi?recordId=r2&source=rfi`, orgId: ORG_A })).toEqual(link('/rfi/r2', P, { orgId: ORG_A, orgSlug: 'acme' }))
    expect(resolveNotificationData({ entityType: null, entityId: null, url: null })).toBeNull()
    expect(resolveNotificationData(null)).toBeNull()
  })

  it('knows when a link leaves the active workspace: by id when both have one, by handle otherwise, never when it names none', () => {
    const active = { orgId: ORG_A, slug: 'acme' }
    expect(linkLeavesWorkspace(none, active)).toBe(false)
    expect(linkLeavesWorkspace({ orgId: ORG_A, orgSlug: null }, active)).toBe(false)
    expect(linkLeavesWorkspace({ orgId: ORG_B, orgSlug: null }, active)).toBe(true)
    expect(linkLeavesWorkspace({ orgId: null, orgSlug: 'acme' }, active)).toBe(false)
    expect(linkLeavesWorkspace({ orgId: null, orgSlug: 'beta' }, active)).toBe(true)
    // The id decides even when the handle would agree.
    expect(linkLeavesWorkspace({ orgId: ORG_B, orgSlug: 'acme' }, active)).toBe(true)
    // The app does not know its own workspace: a named one is taken as another, so the opener asks rather than guesses.
    expect(linkLeavesWorkspace({ orgId: ORG_A, orgSlug: null }, null)).toBe(true)
    expect(linkLeavesWorkspace({ orgId: ORG_A, orgSlug: null }, { orgId: null, slug: null })).toBe(true)
  })

  it('goes through the opener only when the project has to change', () => {
    expect(routeForResolvedLink(link('/rfi/r1', P), P)).toBe('/rfi/r1')
    expect(routeForResolvedLink(link('/rfi/r1', P), 'other')).toBe(`/open?to=%2Frfi%2Fr1&projectId=${P}`)
    expect(routeForResolvedLink(link('/tasks/t1', null), null)).toBe('/tasks/t1')
  })

  it('goes through the opener, naming the workspace, when the link belongs to another workspace — and straight to the record in the same one', () => {
    const active = { orgId: ORG_A, slug: 'acme' }
    // Same workspace, same project: the record.
    expect(routeForResolvedLink(link('/rfi/r1', P, { orgId: ORG_A, orgSlug: 'acme' }), P, active)).toBe('/rfi/r1')
    // Same workspace, another project: the opener with the project only.
    expect(routeForResolvedLink(link('/rfi/r1', P, { orgSlug: 'acme' }), 'other', active)).toBe(`/open?to=%2Frfi%2Fr1&projectId=${P}`)
    // Another workspace: the opener names it, even when the project is the current one.
    expect(routeForResolvedLink(link('/rfi/r1', P, { orgId: ORG_B, orgSlug: 'beta' }), P, active)).toBe(`/open?to=%2Frfi%2Fr1&projectId=${P}&orgId=${ORG_B}&orgSlug=beta`)
    expect(routeForResolvedLink(link('/tasks/t1', null, { orgSlug: 'beta' }), null, active)).toBe('/open?to=%2Ftasks%2Ft1&orgSlug=beta')
    // A link that names no workspace belongs to the active one, as every link did before.
    expect(routeForResolvedLink(link('/tasks/t1', null), null, active)).toBe('/tasks/t1')
    // Nobody signed in yet: a named workspace goes to the opener, which will ask once the session exists.
    expect(routeForResolvedLink(link('/rfi/r1', P, { orgId: ORG_A }), P, null)).toBe(`/open?to=%2Frfi%2Fr1&projectId=${P}&orgId=${ORG_A}`)
  })
})
