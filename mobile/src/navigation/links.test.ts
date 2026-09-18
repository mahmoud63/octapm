import { appRouteForRecord, destinationForNotification, destinationForSearchItem, destinationForTarget, webPathForNotification, webPathForTarget } from '@/navigation/links'
import { notification, searchItem } from '@/testing/fixtures'

describe('records with a screen in the app', () => {
  it('routes RFIs, tasks and sheets into the app and everything else to the web', () => {
    expect(appRouteForRecord('rfi', 'r1')).toBe('/rfi/r1')
    expect(appRouteForRecord('task', 't1')).toBe('/tasks/t1')
    expect(appRouteForRecord('sheet', 's1')).toBe('/drawings/s1')
    expect(appRouteForRecord('punch_item', 'x')).toBeNull()
    expect(destinationForTarget({ projectId: 'p1', module: 'docControl', child: 'rfi', recordType: 'rfi', recordId: 'r1' })).toEqual({ app: '/rfi/r1' })
    expect(destinationForTarget({ projectId: 'p1', module: 'quality', child: 'ncr', recordType: 'ncr', recordId: 'n1' })).toEqual({ web: '/projects/p1/quality/ncr?recordId=n1&source=ncr' })
    expect(destinationForSearchItem(searchItem())).toEqual({ app: '/rfi/r1' })
    expect(destinationForNotification(notification({ entityType: 'task', entityId: 't7' }))).toEqual({ app: '/tasks/t7' })
    expect(destinationForNotification(notification())).toEqual({ web: '/projects/p1/commercial/change-orders?recordId=co1&source=change_order' })
  })
})

describe('web hand-over links', () => {
  it('turns a server target with a legacy module key into the web path for that record', () => {
    expect(webPathForTarget({ projectId: 'p1', module: 'docControl', child: 'rfi', recordType: 'rfi', source: 'rfi', recordId: 'r1' })).toBe('/projects/p1/doc-control/rfi?recordId=r1&source=rfi')
  })

  it('keeps a module the web already spells the same way, and uses the record type as the source when none is given', () => {
    expect(webPathForTarget({ projectId: 'p1', module: 'quality', child: 'ncr', recordType: 'ncr', recordId: 'n1' })).toBe('/projects/p1/quality/ncr?recordId=n1&source=ncr')
  })

  it('maps child keys the server emits in camel case', () => {
    expect(webPathForTarget({ projectId: 'p1', module: 'commercial', child: 'changeOrders', recordType: 'change_order', recordId: 'c1' })).toBe('/projects/p1/commercial/change-orders?recordId=c1&source=change_order')
  })

  it('sends tasks and inventory to their global pages', () => {
    expect(webPathForTarget({ projectId: 'p1', module: 'tasks', recordType: 'task', recordId: 't1' })).toBe('/tasks?recordId=t1')
    expect(webPathForTarget({ projectId: 'p1', module: 'inventory', recordId: 'PO-00012' })).toBe('/inventory?orderRef=PO-00012')
  })

  it('leaves a module page without a record as a plain module link', () => {
    expect(webPathForTarget({ projectId: 'p1', module: 'overview' })).toBe('/projects/p1/overview')
  })

  it('repairs the one task link the web router cannot resolve, and passes every other notification link through', () => {
    expect(webPathForNotification(notification({ actionUrl: '/projects/p1?module=tasks&taskId=t9' }))).toBe('/tasks?recordId=t9')
    expect(webPathForNotification(notification())).toBe('/projects/p1/commercial/change-orders?recordId=co1&source=change_order')
    expect(webPathForNotification(notification({ actionUrl: null }))).toBeNull()
  })
})
