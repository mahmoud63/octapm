import { test, expect } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, signIn } from './support'

/**
 * Project Controls › Structure (PC-1): the WBS tree editor and the unit list.
 *
 * A planner adds a root node and a child, moves the child under a second
 * root (its subtree path is rewritten by the API), flags a node as a work
 * package, archives a branch and finds it again under "Show archived". The
 * unit list answers a spelling check without changing what was typed.
 *
 * The project is created through the API; what is under test is the screen.
 */

type Json = { data?: { id: string }; error?: { code?: string; message?: string } }

const post = async (
  client: Awaited<ReturnType<typeof apiClient>>,
  path: string,
  token: string,
  data: unknown,
) => {
  const response = await client.post(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    data,
  })
  const body: Json | null = await response.json().catch(() => null)
  return { status: response.status(), body }
}

const created: string[] = []

test.afterAll(async () => {
  const client = await apiClient()
  try {
    const token = await apiToken(client, 'pm')
    for (const id of created) {
      await client.delete(`${API}/projects/${id}`, { headers: { authorization: `Bearer ${token}` } }).catch(() => null)
    }
  } finally {
    await client.dispose()
  }
})

test('structure editor: add, move, package, archive; units answer a spelling', async ({ page }) => {
  const client = await apiClient()
  const projectId = await (async () => {
    try {
      const token = await apiToken(client, 'pm')
      const project = await post(client, '/projects', token, {
        name: `Structure ${Date.now()}`,
        type: 'building',
        startDate: '2026-01-05',
        endDate: '2026-12-18',
      })
      expect(project.status, `create project -> ${project.body?.error?.code ?? ''} ${project.body?.error?.message ?? ''}`).toBe(201)
      const id = project.body!.data!.id
      created.push(id)
      return id
    } finally {
      await client.dispose()
    }
  })()

  await signIn(page, 'pm')
  await page.goto(`/projects/${projectId}/controls/structure`)
  await expect(page.getByTestId('uat-structure-page')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('No WBS yet')).toBeVisible()

  // Root node A.
  await page.getByTestId('uat-wbs-add-root').click()
  const editor = page.getByTestId('uat-wbs-editor')
  await expect(editor).toBeVisible()
  await editor.locator('#wbs-code').fill('A')
  await editor.locator('#wbs-name').fill('Block A')
  await page.getByTestId('uat-wbs-save').click()
  await expect(page.getByTestId('uat-wbs-row-A')).toBeVisible()

  // A child under A, through the row menu.
  await page.getByTestId('uat-wbs-actions-A').click()
  await page.getByRole('menuitem', { name: 'Add child' }).click()
  await expect(editor).toBeVisible()
  await editor.locator('#wbs-code').fill('A.1')
  await editor.locator('#wbs-name').fill('Level 1')
  await page.getByTestId('uat-wbs-save').click()
  await expect(page.getByTestId('uat-wbs-row-A.1')).toBeVisible()

  // A second root, B.
  await page.getByTestId('uat-wbs-add-root').click()
  await editor.locator('#wbs-code').fill('B')
  await editor.locator('#wbs-name').fill('Block B')
  await page.getByTestId('uat-wbs-save').click()
  await expect(page.getByTestId('uat-wbs-row-B')).toBeVisible()

  // Move A.1 under B and flag it as a package.
  await page.getByTestId('uat-wbs-actions-A.1').click()
  await page.getByRole('menuitem', { name: 'Edit or move' }).click()
  await expect(editor).toBeVisible()
  await page.getByTestId('uat-wbs-parent').click()
  await page.getByRole('option', { name: /B · Block B/ }).click()
  await page.getByTestId('uat-wbs-package').click()
  await page.getByTestId('uat-wbs-save').click()
  await expect(page.getByTestId('uat-wbs-row-A.1').getByText('Package')).toBeVisible()

  // The API agrees: A.1 now sits under B, one level down.
  const verify = await apiClient()
  try {
    const token = await apiToken(verify, 'pm')
    const tree = await apiGet(verify, `/projects/${projectId}/structure/wbs`, token)
    expect(tree.status).toBe(200)
    const items = tree.body.data.items as Array<{ code: string; parentId: string | null; depth: number; path: string; isPackage: boolean; id: string }>
    const b = items.find((n) => n.code === 'B')!
    const a1 = items.find((n) => n.code === 'A.1')!
    expect([a1.parentId, a1.depth, a1.path, a1.isPackage]).toEqual([b.id, 1, `${b.id}/${a1.id}`, true])
    expect(tree.body.data.summary).toMatchObject({ total: 3, packages: 1, roots: 2 })
  } finally {
    await verify.dispose()
  }

  // Archive B (and A.1 with it); it is gone until "Show archived".
  await page.getByTestId('uat-wbs-actions-B').click()
  await page.getByRole('menuitem', { name: 'Archive subtree' }).click()
  await page.getByRole('button', { name: 'Archive' }).click()
  await expect(page.getByTestId('uat-wbs-row-B')).toHaveCount(0)
  await expect(page.getByTestId('uat-wbs-row-A')).toBeVisible()
  await page.getByLabel('Show archived nodes').click()
  await expect(page.getByTestId('uat-wbs-row-B')).toBeVisible()
  await expect(page.getByTestId('uat-wbs-row-B').getByText('Archived')).toBeVisible()

  // Units: the list is there and a spelling resolves to its code.
  await expect(page.getByTestId('uat-unit-m3')).toBeVisible()
  await page.getByTestId('uat-unit-probe').fill('M3')
  await expect(page.getByTestId('uat-unit-probe-result')).toHaveText('"M3" → m3')
  await page.getByTestId('uat-unit-probe').fill('furlong')
  await expect(page.getByTestId('uat-unit-probe-result')).toContainText('not recognised')
})
