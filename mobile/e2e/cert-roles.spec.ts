import { expect, test } from '@playwright/test'
import { ALLOWED_CAPS, accounts, apiSession, findLeaks, getData, isWide, mainProject, signIn, signOut } from './cert-helpers'

/**
 * Certification: role-aware sign-in. Every role account in the end-to-end
 * organisation signs in on the web target; Home's quick actions and record
 * doors are compared, one by one, with the effective matrix the server
 * returns for that person, and Needs You opens. The matrix is the
 * authority: the screen may show a door only when the matrix grants it.
 */
const QUICK_ACTIONS = [
  { id: 'rfi', module: 'rfi', action: 'create' },
  { id: 'punch', module: 'punch', action: 'create' },
  { id: 'photo', module: 'document_control', action: 'create' },
  { id: 'daily-log', module: 'progress', action: 'submit' },
  { id: 'inspection', module: 'inspection', action: 'create' },
  { id: 'goods-in', module: 'inventory', action: 'create' },
]
const RECORD_DOORS = [
  { id: 'site', module: 'progress' },
  { id: 'activities', module: 'schedule' },
  { id: 'photos', module: 'document_control' },
  { id: 'quality', module: 'punch' },
  { id: 'inventory', module: 'inventory' },
  { id: 'workflow', module: 'workflow' },
  { id: 'commercial', module: 'change_event' },
  { id: 'procurement', module: 'procurement' },
  { id: 'rfi', module: 'rfi' },
  { id: 'tasks', module: 'task' },
  { id: 'documents', module: 'document_control' },
  { id: 'drawings', module: 'document_control' },
  { id: 'timesheets', module: 'timesheet' },
]
type Matrix = { modules: Record<string, { visible: boolean; actions: string[]; transitions: string[] }> }
const allows = (m: Matrix, module: string, action: string) => Boolean(m.modules[module]?.visible && m.modules[module]?.actions?.includes(action))

const ROLES: (keyof typeof accounts)[] = ['pm', 'planner', 'qs', 'cost', 'procurement', 'warehouse', 'site', 'quality', 'finance']

test.describe('certification: role-aware sign-in', () => {
  for (const role of ROLES) {
    test(`${role}: Home shows exactly the doors and quick actions the server grants, Needs You opens, sign-out returns to sign-in`, async ({ page, request }) => {
      test.skip(isWide(page), 'the doors are the same on every width; runs once on the phone viewport')
      const session = await apiSession(request, accounts[role])
      const project = await mainProject(request, session.headers)
      const matrix = await getData<Matrix>(request, session.headers, `/auth/me/permissions?projectId=${project.id}`)

      await signIn(page, accounts[role])
      await expect(page.getByTestId('screen-home')).toBeVisible()
      await expect(page.getByTestId('freshness').first()).toBeVisible()
      const shown: string[] = []
      const hidden: string[] = []
      for (const q of QUICK_ACTIONS) {
        const expected = allows(matrix, q.module, q.action)
        await expect(page.getByTestId(`quick-${q.id}`), `quick action ${q.id} for ${role}`).toHaveCount(expected ? 1 : 0)
        ;(expected ? shown : hidden).push(`quick:${q.id}`)
      }
      for (const d of RECORD_DOORS) {
        const expected = allows(matrix, d.module, 'read')
        await expect(page.getByTestId(`records-${d.id}`), `door ${d.id} for ${role}`).toHaveCount(expected ? 1 : 0)
        ;(expected ? shown : hidden).push(`door:${d.id}`)
      }
      expect(await findLeaks(page, ALLOWED_CAPS)).toEqual([])
      test.info().annotations.push({ type: 'role', description: `${session.user.role}: shown ${shown.join(' ')} | hidden ${hidden.join(' ')}` })

      await page.getByTestId('home-needs-you-all').click()
      await expect(page.getByTestId('screen-needs-you')).toBeVisible()
      expect(await findLeaks(page, ALLOWED_CAPS)).toEqual([])
      await signOut(page)
    })
  }
})
