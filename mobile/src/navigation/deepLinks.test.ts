import { normaliseLinkPath, resolveLink, resolveNotificationData, routeForResolvedLink } from './deepLinks'

const P = 'a2153ef4-0bbb-4b9a-875c-44a0f69f9a12'

describe('deep links', () => {
  it('normalises the scheme, a universal link, group segments and the query', () => {
    expect(normaliseLinkPath('octapm://rfi/abc?x=1')).toEqual({ path: '/rfi/abc', params: new URLSearchParams('x=1') })
    expect(normaliseLinkPath('https://app.octapm.com/tasks?recordId=t1')?.path).toBe('/tasks')
    expect(normaliseLinkPath('/(app)/rfi/abc')?.path).toBe('/rfi/abc')
    expect(normaliseLinkPath('')).toBeNull()
  })

  it('opens the web platform record paths the server puts in notifications, with the project they belong to', () => {
    expect(resolveLink(`/projects/${P}/rfi?recordId=r1&source=rfi`)).toEqual({ route: '/rfi/r1', projectId: P })
    expect(resolveLink(`https://app.octapm.com/projects/${P}/quality/defects?recordId=pi1`)).toEqual({ route: '/quality/punch/pi1', projectId: P })
    expect(resolveLink(`/projects/${P}/commercial/change-orders?recordId=co1&status=submitted`)).toEqual({ route: '/commercial/change-orders/co1', projectId: P })
    expect(resolveLink(`/projects/${P}/procurement?recordId=po1&source=purchase_order`)).toEqual({ route: '/procurement/orders/po1', projectId: P })
    expect(resolveLink(`/projects/${P}/site-reporting?date=2026-09-18`)).toEqual({ route: '/site?date=2026-09-18', projectId: P })
  })

  it('lands on a module home when the record has no screen, and on Home for the project itself', () => {
    expect(resolveLink(`/projects/${P}/quality`)).toEqual({ route: '/quality', projectId: P })
    expect(resolveLink(`/projects/${P}/cost?recordId=x&source=ipc_certificate`)).toBeNull()
    expect(resolveLink(`/projects/${P}`)).toEqual({ route: '/', projectId: P })
    expect(resolveLink('/projects/not-a-uuid/rfi')).toBeNull()
  })

  it('opens the project-less web paths and the app’s own routes', () => {
    expect(resolveLink('/tasks?recordId=t7')).toEqual({ route: '/tasks/t7', projectId: null })
    expect(resolveLink('/inventory?orderRef=PO-0001')).toEqual({ route: '/inventory/receive', projectId: null })
    expect(resolveLink('octapm://quality/inspections/f1')).toEqual({ route: '/quality/inspections/f1', projectId: null })
    expect(resolveLink('/activities/a1?projectId=' + P)).toEqual({ route: `/activities/a1?projectId=${P}`, projectId: P })
    expect(resolveLink('https://octapm.com/marketing')).toBeNull()
  })

  it('routes a push notification by its record first and by its url second', () => {
    expect(resolveNotificationData({ entityType: 'ncr', entityId: 'n1', projectId: P })).toEqual({ route: '/quality/ncr/n1', projectId: P })
    expect(resolveNotificationData({ entityType: 'ipc_certificate', entityId: 'i1', url: `/projects/${P}/rfi?recordId=r2&source=rfi` })).toEqual({ route: '/rfi/r2', projectId: P })
    expect(resolveNotificationData({ entityType: null, entityId: null, url: null })).toBeNull()
    expect(resolveNotificationData(null)).toBeNull()
  })

  it('goes through the opener only when the project has to change', () => {
    expect(routeForResolvedLink({ route: '/rfi/r1', projectId: P }, P)).toBe('/rfi/r1')
    expect(routeForResolvedLink({ route: '/rfi/r1', projectId: P }, 'other')).toBe(`/open?to=%2Frfi%2Fr1&projectId=${P}`)
    expect(routeForResolvedLink({ route: '/tasks/t1', projectId: null }, null)).toBe('/tasks/t1')
  })
})
