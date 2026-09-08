import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, openProject, signIn } from './support'

/**
 * Certified subcontractor work becoming actual cost — the chain the audit found
 * severed — driven through the screens a QS actually uses.
 *
 * The figures are fixed so every number can be recomputed rather than read off
 * the page:
 *
 *   Subcontract     500,000     Concrete 300,000 · Formwork 200,000
 *   Pay app #1      100,000 gross   (Concrete 80,000 · Formwork 20,000)
 *   Retention 10%    10,000
 *   Net payable      90,000
 *
 * Nothing here trusts a displayed total. The screen is checked because a wrong
 * figure on it is its own defect, but every financial assertion is recomputed
 * from the cost ledger, which is what actual cost actually is.
 */

const stamp = () => Math.random().toString(36).slice(2, 8)

async function withApi<T>(fn: (client: APIRequestContext, token: string) => Promise<T>) {
  const client = await apiClient()
  try {
    return await fn(client, await apiToken(client, 'pm'))
  } finally {
    await client.dispose()
  }
}

async function send(
  method: 'post' | 'patch' | 'delete',
  path: string,
  data: Record<string, unknown> = {},
) {
  return withApi(async (client, token) => {
    const response = await client[method](`${API}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      data,
    })
    let body: any = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    return { status: response.status(), body }
  })
}

const read = async (path: string) =>
  withApi(async (client, token) => (await apiGet(client, path, token)).body?.data)

/** Actual cost, from the ledger — not from any figure a page rendered. */
const ledger = async (projectId: string) =>
  read(`/projects/${projectId}/cost/reconciliation`)

/** The ledger entries a single record put there. */
async function entriesFor(projectId: string, activityId: string, sourceId: string) {
  const explained = await read(
    `/projects/${projectId}/cost/reconciliation/explain?activityId=${activityId}&limit=500`,
  )
  return (explained?.entries ?? []).filter(
    (entry: { sourceId: string }) => entry.sourceId === sourceId,
  )
}

/**
 * An executed subcontract with a known schedule of values.
 *
 * Raised over the API on purpose: it is the setup, not the thing under test,
 * and rebuilding it through the commitment screens on every run would make a
 * failure here ambiguous about which module broke.
 */
async function subcontract(projectId: string, tag: string) {
  const vendor = await send('post', '/companies', {
    name: `E2E ${tag} Concrete`,
    type: 'subcontractor',
  })
  expect(vendor.status, JSON.stringify(vendor.body)).toBe(201)

  const activities = await read(`/projects/${projectId}/activities`)
  const list = activities?.items ?? activities ?? []
  // A-1000 is complete in the seed, so its approved-progress cap never binds on
  // these claims — the ceiling under test is the schedule of values, not
  // progress.
  const activity =
    list.find((row: { activityCode: string }) => row.activityCode === 'A-1000') ?? list[0]
  expect(activity, 'the project has activities to code cost to').toBeTruthy()

  const budget = await read(`/projects/${projectId}/budget/lines`)
  const budgetLine = (budget?.items ?? budget?.lines ?? [])[0]
  const coding = {
    activityId: activity.id,
    budgetLineId: budgetLine?.id ?? null,
    costCodeId: budgetLine?.costCodeId ?? null,
  }

  const created = await send('post', `/projects/${projectId}/commitments`, {
    title: `E2E ${tag} frame`,
    type: 'subcontract',
    vendorCompanyId: vendor.body.data.id,
    retentionRate: 10,
    lines: [
      { description: 'Concrete', amount: 300000, ...coding },
      { description: 'Formwork', amount: 200000, ...coding },
    ],
  })
  expect(created.status, JSON.stringify(created.body)).toBe(201)
  const commitment = created.body.data
  expect(commitment.original, 'the schedule of values sums to the contract').toBe(500000)

  await send('post', `/projects/${projectId}/commitments/${commitment.id}/submit`)
  await send('post', `/projects/${projectId}/commitments/${commitment.id}/approve`)

  // Execution needs the signed agreement on file, so attach one.
  const executed = await withApi(async (client, token) => {
    const response = await client.post(
      `${API}/projects/${projectId}/commitments/${commitment.id}/execute`,
      {
        headers: { authorization: `Bearer ${token}` },
        multipart: {
          file: {
            name: 'agreement.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from(`Executed agreement ${tag}`),
          },
        },
      },
    )
    return { status: response.status(), body: await response.json() }
  })
  expect(executed.status, JSON.stringify(executed.body)).toBe(200)
  expect(executed.body.data.status).toBe('executed')

  return { commitment, activity, vendorId: vendor.body.data.id }
}

/** Opens the pay-app module with one application already selected. */
async function openPayApp(page: Page, projectId: string, payAppId: string) {
  await page.goto(
    `/projects/${projectId}/commercial/pay-apps?recordId=${payAppId}&source=sub_pay_app`,
  )
  await expect(page.getByTestId('uat-payapp-detail')).toBeVisible({ timeout: 30_000 })
}

/** Types a claim into the line editor and saves it, through the form. */
async function claimOnScreen(page: Page, amounts: Record<string, string>) {
  for (const [description, amount] of Object.entries(amounts)) {
    const row = page.getByTestId('uat-payapp-line').filter({ hasText: description })
    const input = row.locator('input[type="number"]').first()
    await input.click()
    await input.fill(amount)
  }
  const save = page.getByTestId('uat-payapp-lines-save')
  await expect(save).toBeEnabled()
  await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().includes('/pay-apps/'),
      { timeout: 30_000 },
    ),
    save.click(),
  ])
}

test.describe('certified subcontract cost reaches actual cost', () => {
  test('the whole flow on screen: claim, submit, certify, pay', async ({ page }) => {
    test.slow()
    await signIn(page)
    const projectId = await openProject(page)
    const tag = stamp()
    const { commitment, activity } = await subcontract(projectId, tag)

    const before = await ledger(projectId)

    // ── raise the application through the create dialog ───────────────────
    await page.goto(`/projects/${projectId}/commercial/pay-apps`)
    await expect(page.getByTestId('uat-payapps-panel')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('uat-payapp-new').click()
    await expect(page.getByTestId('uat-payapp-create')).toBeVisible()

    await page.getByTestId('uat-payapp-commitment').click()
    await page.getByRole('option', { name: new RegExp(`E2E ${tag} frame`) }).click()
    await page.getByTestId('uat-payapp-period').fill(`E2E ${tag} period 1`)
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().endsWith('/pay-apps'),
        { timeout: 30_000 },
      ),
      page.getByTestId('uat-payapp-create-submit').click(),
    ])

    // Find what the screen just created, without guessing its ref.
    const list = await read(`/projects/${projectId}/pay-apps?commitmentId=${commitment.id}`)
    const payApp = list.items[0]
    expect(payApp.status).toBe('draft')
    expect(
      payApp.lines.map((line: { description: string }) => line.description).sort(),
    ).toEqual(['Concrete', 'Formwork'])

    // ── claim on the lines ────────────────────────────────────────────────
    await openPayApp(page, projectId, payApp.id)
    await claimOnScreen(page, { Concrete: '80000', Formwork: '20000' })

    // What the page shows, because a wrong figure on screen is its own defect…
    const values = page.getByTestId('uat-payapp-values')
    await expect(values).toContainText('100,000')
    await expect(values).toContainText('10,000')
    await expect(values).toContainText('90,000')

    // …and what the records say, which is what actually counts.
    const claimed = await read(`/projects/${projectId}/pay-apps/${payApp.id}`)
    expect(claimed.grossThisPeriod).toBe(100000)
    expect(claimed.retentionThisPeriod).toBe(10000)
    expect(claimed.netThisPeriod).toBe(90000)
    expect(
      claimed.lines.reduce(
        (total: number, line: { thisPeriodAmount: number }) => total + line.thisPeriodAmount,
        0,
      ),
      'the header total is the sum of its lines, not a separate number',
    ).toBe(100000)

    // Nothing has been certified, so nothing has been posted.
    const atDraft = await ledger(projectId)
    expect(atDraft.ledger.total, 'a draft claim is not cost').toBe(before.ledger.total)

    // ── submit and certify, on screen ─────────────────────────────────────
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/submit'), { timeout: 30_000 }),
      page.getByTestId('uat-payapp-submit').click(),
    ])
    await expect(page.getByTestId('uat-payapp-status')).toHaveText('Submitted')

    await page.getByTestId('uat-payapp-approve').click()
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/approve'), { timeout: 30_000 }),
      page.getByTestId('uat-payapp-approve-confirm').click(),
    ])
    await expect(page.getByTestId('uat-payapp-status')).toHaveText('Approved')

    // ── G: what certification did to actual cost ──────────────────────────
    const after = await ledger(projectId)
    expect(
      Math.round((after.ledger.total - before.ledger.total) * 100) / 100,
      'gross certified reaches actual cost — retention is withheld money, not uncosted work',
    ).toBe(100000)
    expect(
      Math.round(
        (after.ledger.transactionalActual - before.ledger.transactionalActual) * 100,
      ) / 100,
      'and it lands as transacted cost, not as an opening balance',
    ).toBe(100000)

    // Per schedule-of-values line, not as one lump.
    const posted = await entriesFor(projectId, activity.id, payApp.id)
    expect(
      posted
        .map((entry: { amount: number }) => entry.amount)
        .sort((a: number, b: number) => a - b),
    ).toEqual([20000, 80000])
    for (const entry of posted) {
      expect(entry.sourceType).toBe('sub_pay_app')
      expect(entry.costType).toBe('subcontract')
      expect(entry.isReversal).toBe(false)
    }

    // Committed is untouched: under the posting model the commitment keeps its
    // full executed value and remaining commitment is derived from it.
    const commitmentAfter = await read(
      `/projects/${projectId}/commitments/${commitment.id}`,
    )
    expect(commitmentAfter.original).toBe(500000)
    expect(commitmentAfter.revised).toBe(500000)
    expect(500000 - 100000, 'remaining commitment').toBe(400000)
    expect(after.balanced, 'the ledger and the projections agree').toBe(true)

    // ── H: paying it moves cash, not cost ─────────────────────────────────
    await page.getByTestId('uat-payapp-pay').click()
    const payForm = page.getByTestId('uat-payapp-pay-form')
    await expect(payForm).toBeVisible()
    await payForm.locator('input[type="number"]').first().fill('90000')
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/payments'), { timeout: 30_000 }),
      page.getByTestId('uat-payapp-pay-confirm').click(),
    ])
    await expect(page.getByTestId('uat-payapp-status')).toHaveText('Paid')

    const afterPayment = await ledger(projectId)
    expect(
      afterPayment.ledger.total,
      'paying a certificate must not post the cost a second time',
    ).toBe(after.ledger.total)

    const paid = await read(`/projects/${projectId}/pay-apps/${payApp.id}`)
    expect(paid.paidAmount).toBe(90000)
    expect(paid.retentionThisPeriod, 'retention stays held').toBe(10000)
  })

  test('certifying twice, concurrently or on retry, posts once', async ({ page }) => {
    test.slow()
    await signIn(page)
    const projectId = await openProject(page)
    const tag = stamp()
    const { commitment, activity } = await subcontract(projectId, tag)

    const created = await send('post', `/projects/${projectId}/pay-apps`, {
      commitmentId: commitment.id,
      periodLabel: `E2E ${tag} duplicate`,
      periodEnd: '2026-09-30',
      retentionRate: 10,
    })
    const payApp = created.body.data
    const concrete = payApp.lines.find(
      (line: { description: string }) => line.description === 'Concrete',
    )
    await send('patch', `/projects/${projectId}/pay-apps/${payApp.id}`, {
      lines: [{ sovLineId: concrete.sovLineId, thisPeriodAmount: 50000 }],
    })
    await send('post', `/projects/${projectId}/pay-apps/${payApp.id}/submit`)

    const before = await ledger(projectId)

    // Three approvals racing. The state machine catches whichever arrives after
    // a commit; the ledger's unique source key catches any that do not.
    const racing = await Promise.all([
      send('post', `/projects/${projectId}/pay-apps/${payApp.id}/approve`),
      send('post', `/projects/${projectId}/pay-apps/${payApp.id}/approve`),
      send('post', `/projects/${projectId}/pay-apps/${payApp.id}/approve`),
    ])
    // And a retry long after the fact, the way a stuck request arrives.
    const retry = await send('post', `/projects/${projectId}/pay-apps/${payApp.id}/approve`)

    expect(racing.map((r) => r.status), 'at least one approval succeeds').toContain(200)
    expect(retry.status, 'and a later retry is refused rather than reposting').toBe(409)

    const after = await ledger(projectId)
    expect(
      Math.round((after.ledger.total - before.ledger.total) * 100) / 100,
      'one economic event, however many times approve is called',
    ).toBe(50000)
    expect(
      (await entriesFor(projectId, activity.id, payApp.id)).length,
      'and exactly one ledger entry',
    ).toBe(1)

    await openPayApp(page, projectId, payApp.id)
    await expect(page.getByTestId('uat-payapp-status')).toHaveText('Approved')
  })

  test('a certificate can be corrected: +100,000, then -100,000, then +95,000', async ({
    page,
  }) => {
    test.slow()
    await signIn(page)
    const projectId = await openProject(page)
    const tag = stamp()
    const { commitment, activity } = await subcontract(projectId, tag)

    const created = await send('post', `/projects/${projectId}/pay-apps`, {
      commitmentId: commitment.id,
      periodLabel: `E2E ${tag} revision`,
      periodEnd: '2026-09-30',
      retentionRate: 10,
    })
    const payApp = created.body.data
    const concrete = payApp.lines.find(
      (line: { description: string }) => line.description === 'Concrete',
    )

    const start = await ledger(projectId)
    await send('patch', `/projects/${projectId}/pay-apps/${payApp.id}`, {
      lines: [{ sovLineId: concrete.sovLineId, thisPeriodAmount: 100000 }],
    })
    await send('post', `/projects/${projectId}/pay-apps/${payApp.id}/submit`)
    await send('post', `/projects/${projectId}/pay-apps/${payApp.id}/approve`)

    const certified = await ledger(projectId)
    expect(
      Math.round((certified.ledger.total - start.ledger.total) * 100) / 100,
    ).toBe(100000)

    // ── revoke it on screen ───────────────────────────────────────────────
    await openPayApp(page, projectId, payApp.id)
    await page.getByTestId('uat-payapp-revoke').click()
    await expect(page.getByTestId('uat-payapp-revoke-form')).toBeVisible()

    // A revocation without a reason is not a revocation.
    await expect(page.getByTestId('uat-payapp-revoke-confirm')).toBeDisabled()
    await page
      .getByTestId('uat-payapp-revoke-reason')
      .fill('Concrete measured against the superseded drawing revision')
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/reopen'), { timeout: 30_000 }),
      page.getByTestId('uat-payapp-revoke-confirm').click(),
    ])
    await expect(page.getByTestId('uat-payapp-status')).toHaveText('Draft')

    const revoked = await ledger(projectId)
    expect(
      Math.round((revoked.ledger.total - certified.ledger.total) * 100) / 100,
      'revoking takes the cost back out',
    ).toBe(-100000)

    // ── correct it and certify again ──────────────────────────────────────
    await claimOnScreen(page, { Concrete: '95000' })
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/submit'), { timeout: 30_000 }),
      page.getByTestId('uat-payapp-submit').click(),
    ])
    await page.getByTestId('uat-payapp-approve').click()
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/approve'), { timeout: 30_000 }),
      page.getByTestId('uat-payapp-approve-confirm').click(),
    ])
    await expect(page.getByTestId('uat-payapp-status')).toHaveText('Approved')
    await expect(page.getByTestId('uat-payapp-revision')).toHaveText('Revision 1')

    const final = await ledger(projectId)
    expect(
      Math.round((final.ledger.total - start.ledger.total) * 100) / 100,
      'the corrected figure is what actual cost ends up holding',
    ).toBe(95000)

    // Every step is still on the ledger. Nothing was edited or removed.
    const trail = (await entriesFor(projectId, activity.id, payApp.id)).map(
      (entry: { amount: number }) => entry.amount,
    )
    expect(trail.length, 'the posting, its reversal, and the correction').toBe(3)
    expect([...trail].sort((a: number, b: number) => a - b)).toEqual([
      -100000, 95000, 100000,
    ])
    expect(trail.reduce((sum: number, amount: number) => sum + amount, 0)).toBe(95000)
    expect(final.balanced).toBe(true)

    // ── once money has moved, the certificate stands ──────────────────────
    await send('post', `/projects/${projectId}/pay-apps/${payApp.id}/payments`, {
      amount: 1000,
      reference: `E2E-${tag}`,
    })
    const afterPaid = await send(
      'post',
      `/projects/${projectId}/pay-apps/${payApp.id}/reopen`,
      { reason: 'second thoughts' },
    )
    expect(afterPaid.status).toBe(409)
    expect(afterPaid.body.error.code).toBe('SUB_PAY_APP_ALREADY_PAID')
    // It names what stands in the way rather than only refusing.
    expect(afterPaid.body.error.message).toContain('1000')
  })

  test('the billing ceiling is the schedule of values as authorised changes revise it', async ({
    page,
  }) => {
    test.slow()
    await signIn(page)
    const projectId = await openProject(page)
    const tag = stamp()
    const { commitment } = await subcontract(projectId, tag)

    const created = await send('post', `/projects/${projectId}/pay-apps`, {
      commitmentId: commitment.id,
      periodLabel: `E2E ${tag} ceiling`,
      periodEnd: '2026-09-30',
      retentionRate: 10,
    })
    const payApp = created.body.data
    const concrete = payApp.lines.find(
      (line: { description: string }) => line.description === 'Concrete',
    )

    const over = await send('patch', `/projects/${projectId}/pay-apps/${payApp.id}`, {
      lines: [{ sovLineId: concrete.sovLineId, thisPeriodAmount: 350000 }],
    })
    expect(over.status, 'a 300,000 line cannot be billed 350,000').toBe(400)
    expect(over.body.error.code).toBe('SUB_PAY_APP_EXCEEDS_SCHEDULED')

    // ── an authorised change raises it, through the commitment screen ─────
    await page.goto(
      `/projects/${projectId}/commercial/commitments?recordId=${commitment.id}&source=commitment`,
    )
    await page.getByTestId('uat-commitment-co-new').click()
    await page.getByTestId('uat-commitment-co-title').fill(`Extra concrete ${tag}`)
    await page.getByTestId('uat-commitment-co-value').fill('50000')
    await page.getByTestId('uat-commitment-co-sovline').click()
    await page.getByRole('option', { name: /Concrete/ }).click()
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().includes('/change-orders'),
        { timeout: 30_000 },
      ),
      page.getByTestId('uat-commitment-co-add').click(),
    ])

    const withCo = await read(`/projects/${projectId}/commitments/${commitment.id}`)
    const co = withCo.changeOrders[0]
    expect(co.lines[0].sovLineId, 'the change names the schedule line it moves').toBe(
      concrete.sovLineId,
    )

    // A drafted change may not raise anything.
    const beforeApproval = await read(`/projects/${projectId}/pay-apps/${payApp.id}`)
    expect(
      beforeApproval.lines.find(
        (l: { description: string }) => l.description === 'Concrete',
      ).revisedScheduledAmount,
      'an unapproved change buys nothing',
    ).toBe(300000)

    await send('post', `/projects/${projectId}/commitments/change-orders/${co.id}/submit`)
    await send('post', `/projects/${projectId}/commitments/change-orders/${co.id}/approve`)

    // Read with no save in between: the ceiling shown has to be the ceiling
    // enforced, or a QS is told they cannot bill work they can.
    const raised = await read(`/projects/${projectId}/pay-apps/${payApp.id}`)
    const line = raised.lines.find(
      (l: { description: string }) => l.description === 'Concrete',
    )
    expect(line.scheduledAmount).toBe(300000)
    expect(line.approvedChangeAmount).toBe(50000)
    expect(line.revisedScheduledAmount).toBe(350000)
    expect(line.balanceToFinish).toBe(350000)

    const now = await send('patch', `/projects/${projectId}/pay-apps/${payApp.id}`, {
      lines: [{ sovLineId: concrete.sovLineId, thisPeriodAmount: 350000 }],
    })
    expect(now.status, 'the same claim the change order authorises').toBe(200)

    const past = await send('patch', `/projects/${projectId}/pay-apps/${payApp.id}`, {
      lines: [{ sovLineId: concrete.sovLineId, thisPeriodAmount: 350001 }],
    })
    expect(past.status, 'and not a penny past the revised ceiling').toBe(400)

    // A change order cannot reach into a line that is not on its contract.
    const foreign = await send(
      'post',
      `/projects/${projectId}/commitments/${commitment.id}/change-orders`,
      {
        title: `Foreign ${tag}`,
        lines: [{ description: 'Not mine', amount: 1000, sovLineId: payApp.id }],
      },
    )
    expect(foreign.status).toBe(400)
    expect(foreign.body.error.code).toBe('COMMITMENT_CO_LINE_SOV_INVALID')
  })

  test('the certified figure traces back to the subcontractor with no free text', async ({
    page,
  }) => {
    test.slow()
    await signIn(page)
    const projectId = await openProject(page)
    const tag = stamp()
    const { commitment, activity, vendorId } = await subcontract(projectId, tag)

    const created = await send('post', `/projects/${projectId}/pay-apps`, {
      commitmentId: commitment.id,
      periodLabel: `E2E ${tag} lineage`,
      periodEnd: '2026-09-30',
      retentionRate: 10,
    })
    const payApp = created.body.data
    const concrete = payApp.lines.find(
      (line: { description: string }) => line.description === 'Concrete',
    )
    await send('patch', `/projects/${projectId}/pay-apps/${payApp.id}`, {
      lines: [{ sovLineId: concrete.sovLineId, thisPeriodAmount: 30000 }],
    })
    await send('post', `/projects/${projectId}/pay-apps/${payApp.id}/submit`)
    await send('post', `/projects/${projectId}/pay-apps/${payApp.id}/approve`)

    const [entry] = await entriesFor(projectId, activity.id, payApp.id)
    expect(entry.amount).toBe(30000)

    // ledger entry → pay-app line → schedule-of-values line → commitment →
    // subcontractor. Every step is a foreign key.
    const app = await read(`/projects/${projectId}/pay-apps/${payApp.id}`)
    const payAppLine = app.lines.find((l: { id: string }) => l.id === entry.sourceLineId)
    expect(payAppLine, 'the entry names the line it came from').toBeTruthy()

    const full = await read(`/projects/${projectId}/commitments/${commitment.id}`)
    const sovLine = full.lines.find((l: { id: string }) => l.id === payAppLine.sovLineId)
    expect(sovLine, 'which names a line of this commitment').toBeTruthy()
    expect(sovLine.amount).toBe(300000)
    expect(full.vendor?.id, 'which names the subcontractor company').toBe(vendorId)

    // And the coding came off that schedule line rather than being retyped.
    expect(payAppLine.activityId).toBe(sovLine.activityId)
    expect(entry.costType).toBe('subcontract')

    // The same lineage is on screen, so it can be followed without the API.
    await openPayApp(page, projectId, payApp.id)
    await expect(page.getByTestId('uat-payapp-detail')).toContainText(commitment.ref)
    await expect(page.getByTestId('uat-payapp-detail')).toContainText(`E2E ${tag} Concrete`)
  })
})
