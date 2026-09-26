import { test, expect } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, PASSWORD, PEOPLE, signIn } from './support'

/**
 * Project Controls › Mapping (PC-3): the BOQ ↔ activity matrix.
 *
 * A planner types a figure into a cell (a draft appears), accepts a
 * suggestion (a draft with provenance), submits the drafts and approves
 * them, and the coverage bar reaches 100 % — at which point the readiness
 * step boq_allocation turns green, with the preliminaries row marked not
 * applicable and reported in its own bucket. The list view shows the rows.
 *
 * The bill and the programme are created through the API; what is under
 * test is the screen. It runs against its own API and Vite (the PC-3
 * driver), in a throwaway LiveTest organisation whose PM is pm@<domain>.
 */

type Json = { data?: Record<string, unknown>; error?: { code?: string; message?: string } }

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

test('mapping matrix: type a cell, accept a suggestion, submit, approve; coverage 100 % and the readiness step green', async ({ page }) => {
  const client = await apiClient()
  const setup = await (async () => {
    try {
      const token = await apiToken(client, 'pm')
      const login = await client.post(`${API}/auth/login`, { data: { email: PEOPLE.pm.email, password: PASSWORD } })
      const me = ((await login.json()) as Json).data as { user: { id: string } }
      const project = await post(client, '/projects', token, {
        name: `Mapping ${Date.now()}`,
        type: 'building',
        startDate: '2026-01-05',
        endDate: '2026-12-18',
      })
      expect(project.status, `create project -> ${project.body?.error?.code ?? ''} ${project.body?.error?.message ?? ''}`).toBe(201)
      const projectId = project.body!.data!.id as string
      created.push(projectId)

      const item = async (code: string, description: string, quantity: number, unit: string, rate: number) => {
        const row = await post(client, `/projects/${projectId}/boq/items`, token, { code, description, quantity, unit, rate })
        expect(row.status, `create item ${code} -> ${row.body?.error?.message ?? ''}`).toBe(201)
        return (row.body!.data as { item: { id: string } }).item.id
      }
      const activity = async (activityCode: string, name: string) => {
        const row = await post(client, `/projects/${projectId}/activities`, token, {
          name,
          activityCode,
          duration: 5,
          startDate: '2026-02-02',
          endDate: '2026-02-06',
          engineerIds: [me.user.id],
        })
        expect(row.status, `create activity ${activityCode} -> ${row.body?.error?.message ?? ''}`).toBe(201)
        return row.body!.data!.id as string
      }
      // Two priced rows and a preliminaries row; two activities, one of
      // which shares its code with the first row so a suggestion appears.
      const concrete = await item('1.1', 'Concrete in foundations', 100, 'm3', 200)
      const rebar = await item('1.2', 'Reinforcement', 50, 't', 1000)
      const prelims = await item('P.1', 'Site establishment', 1, 'sum', 30000)
      const pour = await activity('1.1', 'Pour foundations')
      const fix = await activity('A130', 'Fix reinforcement')
      const ruled = await client.patch(`${API}/projects/${projectId}/activity-boq-allocations/mapping-rules`, {
        headers: { authorization: `Bearer ${token}` },
        data: { rule: 'not_applicable', itemIds: [prelims] },
      })
      expect(ruled.status()).toBe(200)
      return { projectId, concrete, rebar, prelims, pour, fix, token }
    } finally {
      await client.dispose()
    }
  })()

  await signIn(page, 'pm')
  await page.goto(`/projects/${setup.projectId}/controls/mapping`)
  await expect(page.getByTestId('uat-mapping-page')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('uat-mapping-matrix')).toBeVisible()
  await expect(page.getByTestId('uat-mapping-coverage-pct')).toHaveText('0%')

  // The preliminaries row is n/a: greyed, not selectable, no cell to type in.
  await expect(page.getByTestId('uat-mapping-item-P.1')).toBeVisible()
  await expect(page.getByTestId('uat-mapping-open-P.1')).toContainText('—')
  await expect(page.getByTestId('uat-mapping-cell-P.1-1.1')).toBeDisabled()

  // Type the rebar row's full value into its cell against A130: Enter
  // creates a draft and the open balance drops to zero.
  await page.getByTestId('uat-mapping-cell-1.2-A130').click()
  const rebarInput = page.getByTestId('uat-mapping-cell-input-1.2-A130')
  await expect(rebarInput).toBeVisible()
  await rebarInput.fill('50000')
  await rebarInput.press('Enter')
  await expect(page.getByTestId('uat-mapping-cell-1.2-A130')).toContainText('50,000')
  await expect(page.getByTestId('uat-mapping-open-1.2')).toContainText('0')

  // Suggestions: 1.1 ↔ "1.1" by code is a ghost cell; accepting it files a
  // draft with the row's remaining value and the rule's provenance.
  await page.getByTestId('uat-mapping-suggestions-toggle').click()
  const ghost = page.getByTestId('uat-mapping-cell-1.1-1.1')
  await expect(ghost).toContainText('90%')
  await ghost.click()
  await expect(page.getByTestId('uat-mapping-cell-1.1-1.1')).toContainText('20,000')

  // Submit both drafts, then approve them: the coverage bar reaches 100 %.
  await page.getByTestId('uat-mapping-submit-all').click()
  await expect(page.getByTestId('uat-mapping-submit-all')).toContainText('(0)')
  await page.getByTestId('uat-mapping-approve-all').click()
  await expect(page.getByTestId('uat-mapping-approve-all')).toContainText('(0)')
  await expect(page.getByTestId('uat-mapping-coverage-pct')).toHaveText('100%')

  // The list view shows the two approved rows with their provenance.
  await page.getByTestId('uat-mapping-view-list').click()
  await expect(page.getByTestId('uat-mapping-list')).toBeVisible()
  await expect(page.getByTestId('uat-mapping-list').getByText('Approved')).toHaveCount(2)
  await expect(page.getByTestId('uat-mapping-list').getByText('rule:code')).toBeVisible()

  // The API agrees: both rows approved (one by rule:code), the n/a bucket
  // holds the preliminaries, the invariant holds, and the readiness step is
  // green.
  const verify = await apiClient()
  try {
    const token = await apiToken(verify, 'pm')
    const coverage = await apiGet(verify, `/projects/${setup.projectId}/activity-boq-allocations/coverage`, token)
    expect(coverage.status).toBe(200)
    const summary = coverage.body.data as { totalBoqAmount: number; approvedAllocatedAmount: number; unallocatedAmount: number; notApplicableAmount: number; coveragePct: number }
    expect([summary.totalBoqAmount, summary.approvedAllocatedAmount, summary.unallocatedAmount, summary.notApplicableAmount, summary.coveragePct]).toEqual([100000, 70000, 0, 30000, 100])
    const rows = await apiGet(verify, `/projects/${setup.projectId}/activity-boq-allocations`, token)
    const allocations = rows.body.data.allocations as Array<{ status: string; suggestedBy: string | null; confidence: number | null; basis: string }>
    expect(allocations.map((a) => [a.status, a.suggestedBy, a.confidence, a.basis]).sort()).toEqual([
      ['approved', null, null, 'amount'],
      ['approved', 'rule:code', 0.9, 'amount'],
    ])
    const readiness = await apiGet(verify, `/projects/${setup.projectId}/setup-readiness`, token)
    const step = (readiness.body.data.steps as Array<{ key: string; status: string; blockers: unknown[] }>).find((s) => s.key === 'boq_allocation')
    expect([step?.status, step?.blockers]).toEqual(['complete', []])
  } finally {
    await verify.dispose()
  }
})
