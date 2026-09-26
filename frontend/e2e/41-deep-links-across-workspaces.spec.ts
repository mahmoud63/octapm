import { test, expect } from '@playwright/test'
import { apiClient } from './support'
import {
  addMember,
  createProject,
  dropLiveOrg,
  escapeRegExp,
  headerWorkspace,
  makeCompanyAdmin,
  registerLiveOrg,
  signInForm,
  type LiveOrg,
} from './support-workspaces'

/**
 * Deep links across workspaces (ENT-4, workspace switching doc §5, §8;
 * deep-link rule §108).
 *
 * The same persona as 40-workspace-switch: a PM in A, a QS in B.
 *
 * What must hold:
 *   - a legacy `/projects/:id/…` link — every link minted before this wave —
 *     opens the same page under `/o/{workspace}` when the project is in the
 *     active workspace, with its module and search string intact;
 *   - a legacy link to a project of another of the person's workspaces
 *     offers the switch, names both workspaces, and switches only on request;
 *   - a legacy link to a project of nobody's is not found;
 *   - a link into a workspace the identity is not a member of says so and
 *     lists the workspaces they can open — never a silent fallback;
 *   - a workspace-prefixed link into the other workspace switches on
 *     arrival, because the URL is the source of truth.
 */

const persona = {
  email: `live-persona-${crypto.randomUUID()}@octapm-live.test`,
  name: 'Persona Linker',
  id: '',
}
let orgA: LiveOrg
let orgB: LiveOrg
let orgC: LiveOrg
let alphaId = ''
let betaId = ''
let gammaId = ''

test.beforeAll(async () => {
  const client = await apiClient()
  try {
    orgA = await registerLiveOrg(client, 'a')
    orgB = await registerLiveOrg(client, 'b')
    orgC = await registerLiveOrg(client, 'c')
    // A QS in B who administers it (so B's projects are visible), a PM in A.
    persona.id = await addMember(client, orgB, { ...persona, role: 'qs' })
    await addMember(client, orgA, { ...persona, role: 'pm' })
    await makeCompanyAdmin(client, orgB, persona.id)
    alphaId = await createProject(client, orgA.adminToken, 'Alpha Project')
    betaId = await createProject(client, orgB.adminToken, 'Beta Project')
    gammaId = await createProject(client, orgC.adminToken, 'Gamma Project')
  } finally {
    await client.dispose()
  }
})

test.afterAll(async () => {
  for (const org of [orgA, orgB, orgC]) if (org) dropLiveOrg(org.orgId)
})

test('legacy links land in their workspace; another workspace is offered; a stranger is refused', async ({ page }) => {
  await signInForm(page, persona.email)
  await page.getByTestId(`uat-sign-in-workspace-${orgA.segment}`).click()
  await expect(page).toHaveURL(new RegExp(`/o/${escapeRegExp(orgA.segment)}(/|$|\\?)`), { timeout: 30_000 })
  await expect(headerWorkspace(page)).toHaveText(orgA.name, { timeout: 30_000 })

  // ── A legacy link into the active workspace: redirected, path and search intact ──
  await page.goto(`/projects/${alphaId}/quality/ncr?recordId=abc&source=ncr`)
  await expect(page).toHaveURL(
    new RegExp(`/o/${escapeRegExp(orgA.segment)}/projects/${alphaId}/quality/ncr\\?.*recordId=abc`),
    { timeout: 30_000 },
  )
  await expect(headerWorkspace(page)).toHaveText(orgA.name)
  // The workspace-level pages redirect the same way.
  await page.goto('/tasks')
  await expect(page).toHaveURL(new RegExp(`/o/${escapeRegExp(orgA.segment)}/tasks`), { timeout: 30_000 })

  // ── A legacy link into the other workspace: offered, not taken ────────
  await page.goto(`/projects/${betaId}/schedule/gantt`)
  const offer = page.getByTestId('switch-offer')
  await expect(offer).toBeVisible({ timeout: 30_000 })
  await expect(offer).toContainText(orgB.name)
  await expect(offer).toContainText('Beta Project')
  await expect(headerWorkspace(page)).toHaveText(orgA.name)
  // Staying keeps A's session.
  await page.getByTestId('switch-offer-stay').click()
  await expect(page).toHaveURL(new RegExp(`/o/${escapeRegExp(orgA.segment)}(/|$|\\?)`), { timeout: 30_000 })
  await expect(headerWorkspace(page)).toHaveText(orgA.name)
  // Switching opens the link inside B.
  await page.goto(`/projects/${betaId}/schedule/gantt`)
  await expect(page.getByTestId('switch-offer')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('switch-offer-switch').click()
  await expect(page).toHaveURL(new RegExp(`/o/${escapeRegExp(orgB.segment)}/projects/${betaId}/schedule/gantt`), {
    timeout: 30_000,
  })
  await expect(headerWorkspace(page)).toHaveText(orgB.name, { timeout: 30_000 })

  // ── A workspace-prefixed link back into A switches on arrival ─────────
  await page.goto(`/o/${orgA.segment}/projects/${alphaId}/schedule/gantt`)
  await expect(headerWorkspace(page)).toHaveText(orgA.name, { timeout: 30_000 })
  await expect(page).toHaveURL(new RegExp(`/o/${escapeRegExp(orgA.segment)}/projects/${alphaId}`))

  // ── A project of nobody's: not found, the same as a project that does not exist ──
  await page.goto(`/projects/${gammaId}`)
  await expect(page.getByText(/not found/i).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('switch-offer')).toHaveCount(0)
  await page.goto(`/projects/${crypto.randomUUID()}`)
  await expect(page.getByText(/not found/i).first()).toBeVisible({ timeout: 30_000 })

  // ── A workspace the identity is not a member of ────────────────────────
  await page.goto(`/o/${orgC.segment}/projects`)
  const gate = page.getByTestId('workspace-gate')
  await expect(gate).toBeVisible({ timeout: 30_000 })
  await expect(gate).toContainText('not a member')
  await expect(gate.getByTestId('workspace-gate-list')).toContainText(orgA.name)
  await expect(gate.getByTestId('workspace-gate-list')).toContainText(orgB.name)
  await expect(page.getByText('Gamma Project')).toHaveCount(0)
  // Still signed in to A, not silently moved anywhere.
  await expect(headerWorkspace(page)).toHaveText(orgA.name)
  await page.goto(`/o/not-a-workspace-${Date.now()}`)
  await expect(page.getByTestId('workspace-gate')).toBeVisible({ timeout: 30_000 })
})
