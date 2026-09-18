import { ROLES, can, canTransition, moduleIds, readableModules, roleLabel, transitionsOf } from './policy'

/**
 * These run against the real policy copied from shared/permissions.json, so
 * they fail if the product's rules change under the app. That is the point.
 */
describe('permission policy', () => {
  it('carries the nine internal roles the product defines', () => {
    expect(ROLES.map((r) => r.id).sort()).toEqual(
      ['cost_controller', 'finance', 'planning_eng', 'pm', 'procurement', 'qs', 'quality_engineer', 'site_engineer', 'warehouse'].sort()
    )
    expect(roleLabel('planning_eng')).toBe('Planning Engineer')
    expect(roleLabel('nobody')).toBe('Team member')
  })

  it('lets a site engineer raise an RFI but not close one', () => {
    expect(can('site_engineer', 'rfi', 'create')).toBe(true)
    expect(can('site_engineer', 'rfi', 'read')).toBe(true)
    expect(can('site_engineer', 'rfi', 'delete')).toBe(false)
    expect(canTransition('site_engineer', 'rfi.close')).toBe(false)
    expect(canTransition('pm', 'rfi.close')).toBe(true)
  })

  it('never grants anything to no role at all', () => {
    expect(can(null, 'rfi', 'read')).toBe(false)
    expect(can(undefined, 'schedule', 'read')).toBe(false)
    expect(canTransition(null, 'rfi.close')).toBe(false)
  })

  it('does not invent modules or transitions', () => {
    expect(can('pm', 'teleportation', 'read')).toBe(false)
    expect(canTransition('pm', 'rfi.teleport')).toBe(false)
    expect(transitionsOf('not-a-module')).toEqual({})
  })

  it('gives every role a navigation of readable modules, and the warehouse fewer than the PM', () => {
    expect(moduleIds().length).toBeGreaterThan(30)
    const pm = readableModules('pm')
    const warehouse = readableModules('warehouse')
    expect(pm.length).toBeGreaterThan(0)
    expect(warehouse.length).toBeGreaterThan(0)
    expect(warehouse.length).toBeLessThanOrEqual(pm.length)
    expect(pm).toContain('rfi')
  })
})
