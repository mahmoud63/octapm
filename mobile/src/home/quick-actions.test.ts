import { QUICK_ACTIONS, availableQuickActions, type QuickAction } from '@/home/quick-actions'
import { matrix, pmMatrix } from '@/testing/fixtures'

describe('quick actions on Home', () => {
  const built: QuickAction[] = QUICK_ACTIONS.map((action) => ({ ...action, route: `/${action.id}` }))

  it('shows only the actions whose screen exists, whatever the permission', () => {
    // After M2 the RFI form exists; the others arrive with their milestones.
    expect(availableQuickActions(pmMatrix).map((a) => a.id)).toEqual(['rfi'])
  })

  it('shows a project manager every built action the server allows', () => {
    expect(availableQuickActions(pmMatrix, built).map((a) => a.id)).toEqual(['rfi', 'punch', 'photo', 'daily-log', 'inspection', 'goods-in'])
  })

  it('shows a site engineer only what the server allows them to create or submit', () => {
    const site = matrix('site_engineer', { rfi: { actions: ['read', 'create'] }, punch: { actions: ['read', 'create'] }, progress: { actions: ['read', 'submit'] }, inventory: { actions: ['read'] } })
    expect(availableQuickActions(site, built).map((a) => a.id)).toEqual(['rfi', 'punch', 'daily-log'])
  })

  it('shows a storekeeper goods in and nothing else', () => {
    const store = matrix('warehouse', { inventory: { actions: ['read', 'create', 'update', 'submit'] }, rfi: { actions: ['read'] } })
    expect(availableQuickActions(store, built).map((a) => a.id)).toEqual(['goods-in'])
  })

  it('shows nothing before the server has answered', () => {
    expect(availableQuickActions(undefined, built)).toEqual([])
  })
})
