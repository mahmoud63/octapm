import { test, expect } from '@playwright/test'
import { API, PASSWORD, PEOPLE, apiClient, apiGet, apiToken, signIn } from './support'
import { observe } from './support-ux'

/**
 * Putting a team on a project.
 *
 * OctaPM could tell somebody "assign the user to the project before setting a
 * permission template" and then offer no way to do it. The only route onto a
 * project was an email invitation the person had to accept, which is the wrong
 * shape entirely for a colleague who already has an account — so a newly
 * created project had a team of one, and every other persona was refused with
 * PROJECT_ACCESS_DENIED (OCTA-UX-TEAM-093).
 *
 * That is why every persona test in this programme runs on the seeded project.
 * This one deliberately does not: it creates a project the way a customer
 * would, and builds the team through the interface.
 */

type Client = Awaited<ReturnType<typeof apiClient>>

const call = async (
  client: Client,
  method: 'get' | 'post' | 'delete',
  path: string,
  token: string,
  data?: unknown,
) => {
  const response = await client[method](`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    ...(data ? { data } : {}),
  })
  const body = await response.json().catch(() => null)
  return { status: response.status(), data: body?.data, error: body?.error }
}

/** A token per persona, minted once. */
const tokensFor = async (client: Client, who: Array<keyof typeof PEOPLE>) => {
  const out: Record<string, string> = {}
  for (const person of who) out[person] = await apiToken(client, person)
  return out
}

const THE_TEAM: Array<keyof typeof PEOPLE> = [
  'planner',
  'qs',
  'cost',
  'procurement',
  'warehouse',
  'site',
  'finance',
]

test.describe('a project gets a team', () => {
  test('an existing colleague is added through the interface and can work', async ({ page }) => {
    test.slow()
    const stamp = Date.now().toString(36)
    const client = await apiClient()

    try {
      const tokens = await tokensFor(client, ['pm', ...THE_TEAM])

      // ── A project made the way a customer makes one ──────────────────
      const project = (
        await call(client, 'post', '/projects', tokens.pm, {
          name: `Team spec ${stamp}`,
          code: `TS-${stamp}`,
          startDate: '2027-01-04',
          endDate: '2027-12-17',
          currency: 'USD',
          contractValue: 1_000_000,
        })
      ).data
      expect(project?.id, 'the project was created').toBeTruthy()

      // ── Before: it has a team of one ─────────────────────────────────
      const before: Record<string, number> = {}
      for (const who of THE_TEAM) {
        const r = await call(client, 'get', `/projects/${project.id}/activities`, tokens[who])
        before[who] = r.status
      }
      observe('TEAM_BEFORE', before)
      for (const who of THE_TEAM) {
        expect(before[who], `${who} cannot reach a project nobody put them on`).toBe(403)
      }

      // ── Add one of them through the actual screen ────────────────────
      await signIn(page, 'pm')
      await page.goto(`/projects/${project.id}/team`)

      const openAdd = page.getByTestId('uat-team-add-open')
      await expect(openAdd, 'the team screen offers to add a colleague').toBeVisible({
        timeout: 30_000,
      })
      await openAdd.click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      // Announced, per the console gate's rules.
      expect(await dialog.getAttribute('aria-labelledby')).toBeTruthy()
      expect(await dialog.getAttribute('aria-describedby')).toBeTruthy()

      // The PM is already here and is offered but not selectable.
      const pmRow = page.getByTestId(`uat-team-add-candidate-${PEOPLE.pm.email}`)
      await expect(pmRow, 'somebody already on the project is still listed').toBeVisible({
        timeout: 15_000,
      })
      await expect(pmRow).toBeDisabled()
      await expect(pmRow).toContainText(/already on project/i)

      // Pick the QS. Nothing is typed: no name, no email, no company.
      const qsRow = page.getByTestId(`uat-team-add-candidate-${PEOPLE.qs.email}`)
      await expect(qsRow).toBeVisible()
      await qsRow.click()

      // The role defaults to the one they carry in the company.
      const roleBlock = page.getByTestId('uat-team-add-role')
      await expect(roleBlock, 'a project role is offered').toBeVisible()
      await expect(roleBlock).toContainText(/their company role/i)

      await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === 'POST' && r.url().endsWith('/team'),
          { timeout: 30_000 },
        ),
        page.getByTestId('uat-team-add-submit').click(),
      ])

      // ── They are on the team, and they can work ─────────────────────
      const qsId = (await call(client, 'get', '/auth/me', tokens.qs)).data.id
      await expect(
        page.getByTestId(`uat-team-member-${qsId}`),
        'the QS appears on the team screen',
      ).toBeVisible({ timeout: 30_000 })

      const qsAfter = await call(client, 'get', `/projects/${project.id}/activities`, tokens.qs)
      observe('TEAM_AFTER_UI_ADD', { email: PEOPLE.qs.email, status: qsAfter.status })
      expect(qsAfter.status, 'the QS can now reach the project').toBe(200)

      // ── The rest of the team, through the same endpoint ──────────────
      const roles: Record<string, string> = {}
      for (const who of THE_TEAM) {
        if (who === 'qs') continue
        const userId = (await call(client, 'get', '/auth/me', tokens[who])).data.id
        const added = await call(client, 'post', `/projects/${project.id}/team`, tokens.pm, {
          userId,
        })
        expect(added.status, `${who} was added`).toBeLessThan(300)
        roles[who] = added.data.assignmentRole
      }
      observe('TEAM_ROLES_INHERITED', roles)
      // The role they hold here is the one they carry in the company.
      expect(roles.planner).toBe('planning_eng')
      expect(roles.warehouse).toBe('warehouse')
      expect(roles.finance).toBe('finance')

      const after: Record<string, number> = {}
      for (const who of THE_TEAM) {
        const r = await call(client, 'get', `/projects/${project.id}/activities`, tokens[who])
        after[who] = r.status
      }
      observe('TEAM_AFTER', after)
      for (const who of THE_TEAM) {
        expect(after[who], `${who} can reach the project they were added to`).toBe(200)
      }

      // ── Being on the team is not being allowed everything ────────────
      const me = (await call(client, 'get', '/auth/me', tokens.pm)).data
      const activity = (
        await call(client, 'post', `/projects/${project.id}/activities`, tokens.pm, {
          activityCode: 'A-1000',
          name: 'Groundworks',
          duration: 10,
          engineerIds: [me.id],
        })
      ).data
      const order = (
        await call(client, 'post', `/projects/${project.id}/procurement/purchase-orders`, tokens.pm, {
          activityId: activity.id,
          lines: [
            { activityId: activity.id, description: 'Rebar', unit: 'T', orderedQty: 5, unitCost: 900 },
          ],
        })
      ).data

      const transitions: Record<string, number> = {}
      for (const who of ['warehouse', 'site', 'finance'] as const) {
        const r = await call(
          client,
          'post',
          `/projects/${project.id}/purchase-orders/${order.id}/approve`,
          tokens[who],
        )
        transitions[who] = r.status
      }
      observe('TEAM_UNAUTHORISED_TRANSITIONS', transitions)
      for (const who of ['warehouse', 'site', 'finance'] as const) {
        expect(transitions[who], `${who} cannot approve a purchase order`).toBe(403)
      }

      await call(client, 'post', `/projects/${project.id}/archive`, tokens.pm).catch(() => {})
    } finally {
      await client.dispose()
    }
  })

  test('removing somebody affects one project and nothing else', async ({ page }) => {
    test.slow()
    const stamp = Date.now().toString(36)
    const client = await apiClient()

    try {
      const tokens = await tokensFor(client, ['pm', 'qs'])
      const qsId = (await call(client, 'get', '/auth/me', tokens.qs)).data.id

      const make = async (label: string) =>
        (
          await call(client, 'post', '/projects', tokens.pm, {
            name: `${label} ${stamp}`,
            code: `${label.toUpperCase()}-${stamp}`,
            startDate: '2027-01-04',
            endDate: '2027-12-17',
            currency: 'USD',
            contractValue: 500_000,
          })
        ).data

      const alpha = await make('Alpha')
      const beta = await make('Beta')
      for (const project of [alpha, beta]) {
        await call(client, 'post', `/projects/${project.id}/team`, tokens.pm, { userId: qsId })
      }

      // Something the QS authored on Alpha, to prove it survives them leaving.
      const me = (await call(client, 'get', '/auth/me', tokens.pm)).data
      const activity = (
        await call(client, 'post', `/projects/${alpha.id}/activities`, tokens.pm, {
          activityCode: 'A-1000',
          name: 'Authored before leaving',
          duration: 5,
          engineerIds: [me.id],
        })
      ).data
      expect(activity?.id).toBeTruthy()

      // ── Remove from Alpha, through the screen ────────────────────────
      await signIn(page, 'pm')
      await page.goto(`/projects/${alpha.id}/team`)
      const remove = page.getByTestId(`uat-team-remove-${qsId}`)
      await expect(remove, 'a member can be taken off the project').toBeVisible({ timeout: 30_000 })
      await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === 'DELETE' && r.url().includes('/team/'),
          { timeout: 30_000 },
        ),
        remove.click(),
      ])
      await expect(page.getByTestId(`uat-team-member-${qsId}`)).toHaveCount(0, { timeout: 30_000 })

      // ── Exactly one project's worth of access is gone ────────────────
      const onAlpha = await call(client, 'get', `/projects/${alpha.id}/activities`, tokens.qs)
      const onBeta = await call(client, 'get', `/projects/${beta.id}/activities`, tokens.qs)
      const account = await call(client, 'get', '/auth/me', tokens.qs)
      const record = await call(client, 'get', `/projects/${alpha.id}/activities`, tokens.pm)

      observe('TEAM_REMOVAL_SCOPE', {
        removedFrom: onAlpha.status,
        otherProject: onBeta.status,
        account: account.status,
        recordsSurvive: (record.data?.items ?? record.data ?? []).length,
      })

      expect(onAlpha.status, 'access to the project they left is gone').toBe(403)
      expect(onBeta.status, 'the other project is untouched').toBe(200)
      expect(account.status, 'their company account is untouched').toBe(200)
      expect(account.data.email).toBe(PEOPLE.qs.email)
      expect(
        (record.data?.items ?? record.data ?? []).length,
        'what they worked on is still there',
      ).toBeGreaterThan(0)

      // And they can still sign in, which is the difference between removing
      // somebody from a project and deleting them.
      const stillSignsIn = await client.post(`${API}/auth/login`, {
        data: { email: PEOPLE.qs.email, password: PASSWORD },
      })
      expect(stillSignsIn.ok(), 'they can still sign in to OctaPM').toBeTruthy()

      for (const project of [alpha, beta]) {
        await call(client, 'post', `/projects/${project.id}/archive`, tokens.pm).catch(() => {})
      }
    } finally {
      await client.dispose()
    }
  })

  test('only a manager can change the team', async ({ page }) => {
    const client = await apiClient()
    try {
      const tokens = await tokensFor(client, ['pm', 'site', 'qs'])
      const stamp = Date.now().toString(36)
      const project = (
        await call(client, 'post', '/projects', tokens.pm, {
          name: `Guard ${stamp}`,
          code: `GD-${stamp}`,
          startDate: '2027-01-04',
          endDate: '2027-12-17',
          currency: 'USD',
          contractValue: 100_000,
        })
      ).data
      const siteId = (await call(client, 'get', '/auth/me', tokens.site)).data.id
      const qsId = (await call(client, 'get', '/auth/me', tokens.qs)).data.id
      await call(client, 'post', `/projects/${project.id}/team`, tokens.pm, { userId: siteId })

      const refused = await call(client, 'post', `/projects/${project.id}/team`, tokens.site, {
        userId: qsId,
      })
      observe('TEAM_GUARD', { status: refused.status, code: refused.error?.code })
      expect(refused.status, 'a site engineer cannot add people').toBe(403)

      // And the screen does not offer it to them.
      await signIn(page, 'site')
      await page.goto(`/projects/${project.id}/team`)
      await expect(page.getByTestId('uat-project-team')).toBeVisible({ timeout: 30_000 })
      await expect(
        page.getByTestId('uat-team-add-open'),
        'the button is not shown to somebody who cannot use it',
      ).toHaveCount(0)

      await call(client, 'post', `/projects/${project.id}/archive`, tokens.pm).catch(() => {})
    } finally {
      await client.dispose()
    }
  })
})
