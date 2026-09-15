import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, openProject, SHOTS, signIn } from './support'

/**
 * Client billing — money coming in.
 *
 * The arithmetic is the product here: what the client actually owes after
 * retention, advance recovery, deductions and tax. Every figure on screen is
 * checked against the API, and the API's answer is checked against arithmetic
 * done here, because a payment application that only adds up on screen is
 * worse than one that visibly does not.
 *
 * Screenshots land under test-results (see SHOTS in support.ts).
 */


const contractPath = (projectId: string) => `/projects/${projectId}/prime-contract`

async function withApi<T>(fn: (client: APIRequestContext, token: string) => Promise<T>) {
  const client = await apiClient()
  try {
    return await fn(client, await apiToken(client, 'pm'))
  } finally {
    await client.dispose()
  }
}

/** Puts the contract on known terms, so the test's arithmetic is the product's. */
async function setTerms(projectId: string) {
  return withApi(async (client, token) => {
    const response = await client.patch(`${API}${contractPath(projectId)}`, {
      headers: { authorization: `Bearer ${token}` },
      data: {
        retentionRate: 5,
        retentionCapRate: 5,
        advanceRate: 10,
        advanceRecoveryRate: 20,
        materialsOnSiteRate: 100,
        taxRate: 5,
        paymentTermsDays: 45,
      },
    })
    expect(response.status(), await response.text()).toBe(200)
    return (await response.json()).data
  })
}

async function statement(projectId: string) {
  return withApi(async (client, token) => {
    const { body } = await apiGet(client, `${contractPath(projectId)}/statement`, token)
    return body?.data
  })
}

async function openBilling(page: Page, projectId: string) {
  await page.goto(`/projects/${projectId}/commercial/client-billing`)
  await expect(page.getByTestId('uat-client-billing')).toBeVisible({ timeout: 30_000 })
}

test.describe('client billing', () => {
  test('the contract exists on first read, built from the project', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)

    const contract = await withApi(async (client, token) => {
      const { status, body } = await apiGet(client, contractPath(projectId), token)
      expect(status).toBe(200)
      return body.data
    })

    // Nothing was re-keyed: the value and the reference came off the project.
    expect(contract.originalValue).toBeGreaterThan(0)
    expect(contract.ref).toBeTruthy()
    expect(contract.revisedValue).toBe(
      contract.originalValue + contract.approvedChangesValue,
    )
  })

  test('the revised value moves with approved change orders, not with pending ones', async ({
    page,
  }) => {
    await signIn(page)
    const projectId = await openProject(page)

    // Saving the terms also re-reads the change orders, which is how a
    // contract that predates this module catches up with the ones already
    // approved against it.
    const before = await setTerms(projectId)

    // Every approved, unarchived change order should be in the revised value.
    // List envelopes differ per endpoint in this API, so unwrap defensively.
    const orders = await withApi(async (client, token) => {
      const { body } = await apiGet(client, `/projects/${projectId}/change-orders`, token)
      const data = body?.data
      for (const candidate of [data, data?.items, data?.orders, data?.rows]) {
        if (Array.isArray(candidate)) return candidate
      }
      return []
    })
    const approved = orders
      .filter((order: { status: string; archivedAt: string | null }) =>
        order.status === 'approved' && !order.archivedAt)
      .reduce((sum: number, order: { value: number }) => sum + Number(order.value), 0)

    expect(before.approvedChangesValue).toBeCloseTo(approved, 2)
    expect(before.revisedValue).toBeCloseTo(before.originalValue + approved, 2)
  })

  test('a certificate bills gross less retention, advance and deductions, then tax', async ({
    page,
  }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const contract = await setTerms(projectId)

    // The client pays the advance, so there is something to recover.
    if (contract.advancePaidAmount < contract.advanceAmount) {
      await withApi(async (client, token) => {
        const response = await client.post(`${API}${contractPath(projectId)}/advances`, {
          headers: { authorization: `Bearer ${token}` },
          data: {
            amount: contract.advanceAmount - contract.advancePaidAmount,
            note: 'Advance on signature',
          },
        })
        expect(response.status(), await response.text()).toBe(201)
      })
    }

    let before = await statement(projectId)
    if (!before.current) {
      // A fresh fixture has no payment application yet: raise the first period,
      // so the certificate's arithmetic is exercised on every run (Phase 22B).
      await withApi(async (client, token) => {
        const response = await client.post(`${API}/projects/${projectId}/ipc`, {
          headers: { authorization: `Bearer ${token}` },
          data: {},
        })
        expect(response.status(), await response.text()).toBe(201)
      })
      before = await statement(projectId)
    }
    test.skip(!before.current, 'no payment application has been raised on this project')

    // Stored materials and a deduction, which are not measured work and so do
    // not belong on a BOQ line.
    await withApi(async (client, token) => {
      const response = await client.patch(
        `${API}/projects/${projectId}/ipc/${encodeURIComponent(before.current.period)}/adjustments`,
        {
          headers: { authorization: `Bearer ${token}` },
          data: {
            materialsOnSite: 50_000,
            deductions: 10_000,
            deductionsNote: 'Damaged formwork recharge',
          },
        },
      )
      expect(response.status(), await response.text()).toBe(200)
    })

    const after = await statement(projectId)
    const s = after.summary

    // The whole calculation, done here rather than trusted.
    expect(s.grossThisPeriod).toBeCloseTo(s.currentCertified + s.materialsOnSite, 2)
    expect(s.advanceRecoveryThisPeriod).toBeCloseTo(s.grossThisPeriod * 0.2, 2)
    const beforeTax =
      s.grossThisPeriod -
      s.retentionThisPeriod -
      s.advanceRecoveryThisPeriod -
      s.deductions
    expect(s.taxAmount).toBeCloseTo(beforeTax * 0.05, 2)
    expect(s.totalDue).toBeCloseTo(beforeTax + s.taxAmount, 2)

    // Tax is on what is left, never on the gross — the difference is the whole
    // reason the order of operations is worth testing.
    expect(s.taxAmount).toBeLessThan(s.grossThisPeriod * 0.05)

    // And it reads the same on screen.
    await openBilling(page, projectId)
    const summary = page.getByTestId('uat-application-summary')
    await expect(summary).toContainText('Gross this period')
    await expect(summary).toContainText('Advance recovery')
    await expect(summary).toContainText('Damaged formwork recharge')
    await expect(summary).toContainText(
      s.totalDue.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    )

    await page.screenshot({ path: `${SHOTS}/30-client-billing.png`, fullPage: true })
  })

  test('the advance is never over-recovered or over-received', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const contract = await setTerms(projectId)

    // Paying more than the contract's advance is refused, not silently taken.
    await withApi(async (client, token) => {
      const response = await client.post(`${API}${contractPath(projectId)}/advances`, {
        headers: { authorization: `Bearer ${token}` },
        data: { amount: contract.advanceAmount + 1 },
      })
      expect(response.status()).toBe(409)
      expect((await response.json()).error.code).toBe('ADVANCE_OVER_AGREED')
    })

    const state = await withApi(async (client, token) => {
      const { body } = await apiGet(client, `${contractPath(projectId)}/advances`, token)
      return body.data
    })
    expect(state.outstanding).toBeLessThanOrEqual(contract.advanceAmount)
  })

  test('the schedule of values reads contract, previous, this period and remaining', async ({
    page,
  }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await openBilling(page, projectId)

    const sov = page.getByTestId('uat-contract-sov')
    await expect(sov).toBeVisible()
    for (const heading of ['Contract', 'Previous', 'This period', 'Total', 'Remaining']) {
      await expect(sov).toContainText(heading)
    }

    // Every line's remaining must be its contract less what has been certified.
    const data = await statement(projectId)
    for (const line of data.lines) {
      expect(line.remaining).toBeCloseTo(line.contractAmount - line.total, 2)
    }

    // And the table's contract column must add up to the BOQ, which is the
    // schedule of values.
    const total = data.lines.reduce(
      (sum: number, line: { contractAmount: number }) => sum + line.contractAmount,
      0,
    )
    await expect(sov).toContainText(
      total.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    )
  })

  test('receivables age from the due date and are reported, not hidden', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await openBilling(page, projectId)

    const panel = page.getByTestId('uat-receivables')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('Invoiced')
    await expect(panel).toContainText('Outstanding')

    const ar = await withApi(async (client, token) => {
      const { body } = await apiGet(client, `${contractPath(projectId)}/receivables`, token)
      return body.data
    })

    // Outstanding is what is invoiced and not yet received, and the ageing
    // buckets must account for all of it.
    expect(ar.outstanding).toBeCloseTo(ar.invoiced - ar.received, 2)
    const bucketed = ar.ageing.reduce(
      (sum: number, bucket: { amount: number }) => sum + bucket.amount,
      0,
    )
    expect(bucketed).toBeCloseTo(ar.outstanding, 2)
  })

  test('the terms are entered once, and the panel says what each one does', async ({
    page,
  }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await openBilling(page, projectId)

    await page.getByTestId('uat-contract-terms').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Contract terms')

    // Each rate says what it does, because "5%" on its own is not a term.
    await expect(dialog).toContainText('Held back from each certificate')
    await expect(dialog).toContainText('paid up front')
    await expect(dialog).toContainText('after retention, advance recovery and deductions')
    await expect(dialog).toContainText(
      'Approved change orders are added on top; they are never typed here',
    )

    await page.getByTestId('uat-contract-retention').fill('7')
    await page.getByTestId('uat-contract-save').click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await expect
      .poll(async () => (await statement(projectId)).contract.retentionRate, {
        timeout: 15_000,
      })
      .toBe(7)

    // Put it back, so a re-run starts where this one did.
    await setTerms(projectId)
  })
})
