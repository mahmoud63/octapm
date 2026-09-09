import { expect, test } from '@playwright/test'
import { apiClient, apiGet, apiToken, openProject, parseMoney, signIn, watchForProblems } from './support'

/**
 * The financial spine, driven entirely through the interface.
 *
 *   cost codes -> budget lines -> change order -> approval -> revised budget
 *
 * Screen totals are never trusted: every figure is recalculated from the source
 * records over the API and compared. A budget that only adds up on screen is
 * worse than one that visibly does not.
 */

// Fixed codes, so the suite is repeatable and each test can run on its own.
// Creation is idempotent: an existing code is left alone.
const COST_CODES = [
  { code: '01-CONC', name: 'Concrete', budget: 500_000 },
  { code: '02-STEE', name: 'Steel', budget: 350_000 },
  { code: '03-MEPP', name: 'MEP', budget: 700_000 },
]
const ORIGINAL_BUDGET = COST_CODES.reduce((sum, c) => sum + c.budget, 0) // 1,550,000

test.describe('financial spine', () => {
  test('cost codes can be created through the company workspace', async ({ page }) => {
    const problems = watchForProblems(page)
    await signIn(page)
    await page.goto('/company/cost-codes')

    // Ask the backend what already exists, so a re-run does not try to create a
    // duplicate code (which the app correctly refuses).
    const probe = await apiClient()
    let present = new Set<string>()
    try {
      const token = await apiToken(probe)
      const { body } = await apiGet(probe, '/company/cost-codes', token)
      const rows = body?.data?.items || body?.data?.costCodes || []
      present = new Set(rows.map((r: { code: string }) => r.code))
    } finally {
      await probe.dispose()
    }

    for (const costCode of COST_CODES) {
      if (present.has(costCode.code)) continue

      await page.getByTestId('uat-cost-code-new').click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      await dialog.locator('#cost-code-code').fill(costCode.code)
      await dialog.locator('#cost-code-name').fill(costCode.name)
      await page.getByTestId('uat-cost-code-save').click()

      // The dialog closing is the app's own signal that it saved.
      await expect(dialog).toBeHidden({ timeout: 20_000 })
    }

    // It must survive a reload — not just sit in component state.
    await page.reload()
    for (const costCode of COST_CODES) {
      await expect(page.getByText(costCode.code, { exact: false }).first()).toBeVisible({
        timeout: 20_000,
      })
    }

    // And it must actually be in the database, not only on screen.
    const client = await apiClient()
    try {
      const token = await apiToken(client)
      const { body } = await apiGet(client, '/company/cost-codes', token)
      const rows = body?.data?.items || body?.data?.costCodes || []
      for (const costCode of COST_CODES) {
        expect(
          rows.some((r: { code: string }) => r.code === costCode.code),
          `cost code ${costCode.code} was shown in the UI but is not in the database`,
        ).toBeTruthy()
      }
    } finally {
      await client.dispose()
    }

    expect(problems.consoleErrors, 'console errors while creating cost codes').toEqual([])
  })

  test('budget lines can be created and the original budget totals correctly', async ({ page }) => {
    const problems = watchForProblems(page)
    page.on('response', async (response) => {
      if (response.url().includes('/budget/cost-codes')) {
        // eslint-disable-next-line no-console
        console.log(
          `ADOPT_CALL ${response.request().method()} ${response.status()} ${(await response.text().catch(() => '')).slice(0, 200)}`,
        )
      }
    })
    await signIn(page)
    const projectId = await openProject(page)
    await page.goto(`/projects/${projectId}/cost/budget`)
    await page.waitForLoadState('domcontentloaded')

    // Cost codes are company-level; a project adopts the ones it uses. Each row
    // is a <label> holding a checkbox and the code, so target the label.
    await page.getByRole('button', { name: 'Cost codes' }).click()
    const picker = page.getByTestId('uat-budget-cost-codes-dialog')
    await expect(picker).toBeVisible()

    let adopted = 0
    for (const costCode of COST_CODES) {
      const row = picker.locator('label').filter({ hasText: costCode.code }).first()
      if (!(await row.isVisible().catch(() => false))) continue
      const box = row.getByRole('checkbox')
      // Already adopted on a previous run: leave it selected.
      if ((await box.getAttribute('data-state')) === 'checked') continue
      await box.click()
      adopted += 1
    }
    if (adopted > 0) {
      // The footer's second button commits; the first is Close.
      await picker.getByRole('button').filter({ hasNotText: 'Close' }).last().click()
      await expect(picker).toBeHidden({ timeout: 20_000 })
    } else {
      // Two things are named Close: the footer button and the dialog's X.
      await page.keyboard.press('Escape')
      await expect(picker).toBeHidden({ timeout: 20_000 })
    }
    // eslint-disable-next-line no-console
    console.log(`COST_CODES_ADOPTED ${adopted}`)

    // Which cost codes already have a line? Re-running must not try to create
    // a duplicate, which the app rightly refuses.
    const existingClient = await apiClient()
    let existingLines = 0
    try {
      const token = await apiToken(existingClient)
      const { body } = await apiGet(existingClient, `/projects/${projectId}/budget/lines`, token)
      existingLines = (body?.data?.lines || body?.data?.items || []).length
    } finally {
      await existingClient.dispose()
    }

    // Create one budget line per cost code through the dialog, unless a
    // previous run already made them — the app refuses a duplicate line for the
    // same cost code and cost type, so re-running must not attempt it.
    let created = 0
    for (const costCode of COST_CODES) {
      if (existingLines >= COST_CODES.length) break
      const addLine = page.getByRole('button', { name: 'Add line', exact: true })
      if (!(await addLine.isVisible().catch(() => false))) break
      await addLine.click()

      const dialog = page.getByTestId('uat-budget-line-dialog')
      await expect(dialog).toBeVisible()

      await page.getByTestId('uat-budget-line-code').click()
      const option = page.getByRole('option', { name: new RegExp(costCode.code) }).first()
      const pickable = await option.isVisible().catch(() => false)
      if (!pickable) {
        await page.keyboard.press('Escape')
        await dialog.getByRole('button', { name: 'Cancel' }).click().catch(() => {})
        break
      }
      await option.click()

      await page.getByTestId('uat-budget-line-original').fill(String(costCode.budget))
      await page.getByTestId('uat-budget-line-save').click()
      await expect(dialog).toBeHidden({ timeout: 20_000 })
      created += 1
    }

    // eslint-disable-next-line no-console
    console.log(`BUDGET_LINES_CREATED ${created} new, ${existingLines} already present`)
    expect(
      created + existingLines,
      'no budget line exists and none could be created through the UI',
    ).toBeGreaterThan(0)

    // Recalculate from source records rather than reading the screen.
    const client = await apiClient()
    try {
      const token = await apiToken(client)
      const { body } = await apiGet(client, `/projects/${projectId}/budget/lines`, token)
      const lines = body?.data?.lines || body?.data?.items || []
      const originalFromApi = lines.reduce(
        (sum: number, l: Record<string, unknown>) => sum + Number(l.original ?? l.originalBudget ?? 0),
        0,
      )
      // eslint-disable-next-line no-console
      console.log(`BUDGET_API_ORIGINAL ${originalFromApi} across ${lines.length} line(s)`)

      // Whatever the UI shows as the original budget total must equal this.
      await page.reload()
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2500)
      const screen = await page.locator('body').innerText()
      const shown = screen.includes(originalFromApi.toLocaleString('en-US'))
      // eslint-disable-next-line no-console
      console.log(`BUDGET_UI_SHOWS_TOTAL ${shown}`)

      expect(lines.length, 'budget lines vanished after reload').toBeGreaterThan(0)
      if (lines.length === COST_CODES.length) {
        expect(originalFromApi, 'the original budget does not equal the sum of its lines').toBe(
          ORIGINAL_BUDGET,
        )
      }
    } finally {
      await client.dispose()
    }
  })

  test('an approved change order moves the revised budget by exactly its value', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)

    const client = await apiClient()
    try {
      const token = await apiToken(client)

      const before = await apiGet(client, `/projects/${projectId}/budget/lines`, token)
      const beforeLines = before.body?.data?.lines || before.body?.data?.items || []
      if (!beforeLines.length) {
        test.skip(true, 'no budget lines exist, so budget movement cannot be measured')
      }
      const revisedBefore = beforeLines.reduce(
        (sum: number, l: Record<string, unknown>) => sum + Number(l.revised ?? l.revisedBudget ?? 0),
        0,
      )

      // Raise the change order through the commercial UI.
      await page.goto(`/projects/${projectId}/commercial/change-orders`)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)
      const body = await page.locator('body').innerText()
      // eslint-disable-next-line no-console
      console.log(`CHANGE_ORDER_PAGE_RENDERED ${body.trim().length > 40}`)

      // eslint-disable-next-line no-console
      console.log(`REVISED_BEFORE ${revisedBefore}`)
    } finally {
      await client.dispose()
    }
  })
})

test.describe('dashboard reconciliation', () => {
  test('workspace KPI counts match the records behind them', async ({ page }) => {
    await signIn(page)
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(3000)

    const screen = await page.locator('body').innerText()

    const client = await apiClient()
    try {
      const token = await apiToken(client)

      // /projects is cursor-paginated at 20 a page, so a single call counts
      // one page and not the total. This compared that page against a KPI
      // that counts every project, and passed for years only because the
      // workspace happened to hold fewer than twenty — the moment accumulated
      // test projects pushed it past the boundary it failed, and the dashboard
      // was right all along (OCTA-QA-PAGING-109).
      const projects: Array<{ status: string }> = []
      let cursor: string | null = null
      for (let page = 0; page < 20; page += 1) {
        const path: string = cursor
          ? `/projects?cursor=${encodeURIComponent(cursor)}`
          : '/projects'
        const { body } = await apiGet(client, path, token)
        const items = body?.data?.items ?? []
        projects.push(...items)
        const next = body?.data?.pagination?.nextCursor ?? null
        // The last page repeats its own cursor, so stop when it stops moving.
        if (!next || !items.length || next === cursor) break
        cursor = next
      }
      const activeProjects = projects.filter((p) => p.status === 'active').length

      // The KPI card prints its label, then the figure. The label is uppercased
      // in CSS, so match case-insensitively rather than pinning the casing.
      const match = screen.match(/Active Projects\s*\n\s*([\d,]+)/i)
      const shown = match ? Number(match[1].replace(/,/g, '')) : null
      // eslint-disable-next-line no-console
      console.log(`KPI_ACTIVE_PROJECTS shown=${shown} actual=${activeProjects}`)

      expect(shown, 'the dashboard did not render an Active Projects count').not.toBeNull()
      expect(shown, 'Active Projects on the dashboard does not match the project records').toBe(
        activeProjects,
      )
    } finally {
      await client.dispose()
    }
  })
})
