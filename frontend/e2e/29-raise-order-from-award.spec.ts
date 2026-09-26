import { test, expect } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, openProject, signIn } from './support'
import { Journey, cachedToken, observe } from './support-ux'

/**
 * Raising the order for what was awarded, without typing any of it again.
 *
 * There was no way to create a purchase order in the interface at all — the
 * register listed them and the dialog showed one, but nothing made one, so
 * every order in this programme's tests was created over the API. And the API
 * demanded a reference the buyer had to invent, which is duplicate entry of
 * the worst kind: the system knows every reference it has issued and the
 * person does not, so they keep a list somewhere else and two of them working
 * the same afternoon collide (OCTA-UX-PODUP-102).
 *
 * The classification this settles, field by field:
 *
 *   PO reference        AUTO-GENERATE       — with a hand-typed one honoured
 *   supplier            INHERIT             — from the winning bid
 *   line description    INHERIT             — from the priced package line
 *   unit, quantity      INHERIT             — from the priced package line
 *   unit cost           INHERIT             — the rate the supplier quoted
 *   activity            INHERIT             — from the package line
 *   required date       KEEP WITH OVERRIDE  — the package's, changeable here
 *   lead weeks          KEEP WITH OVERRIDE  — the package's, changeable here
 */

type Client = Awaited<ReturnType<typeof apiClient>>

const post = async (client: Client, path: string, token: string, data: unknown = {}) => {
  const response = await client.post(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    data,
  })
  const body = await response.json().catch(() => null)
  return { status: response.status(), data: body?.data, error: body?.error }
}

test('the order for an awarded package writes itself', async ({ page }) => {
  test.slow()
  await signIn(page, 'pm')
  const projectId = await openProject(page)
  const stamp = Date.now().toString(36)
  const quoted = { description: 'Anodised panel 3mm', unit: 'M2', qty: 1500, rate: 172 }

  const client = await apiClient()
  const quoteRef: string = await (async () => {
    try {
      const token = await cachedToken('raise-order', () => apiToken(client, 'pm'))
      const activities = (await apiGet(client, `/projects/${projectId}/activities`, token)).body.data
      const activity = (Array.isArray(activities) ? activities : activities.items)[0]

      const pkg = (
        await post(client, `/projects/${projectId}/procurement/packages`, token, {
          packageNumber: `PK-RAISE-${stamp}`,
          title: `Awarded cladding ${stamp}`,
          activityId: activity.id,
          requiredOnSiteDate: '2027-09-01',
          leadWeeks: 10,
        })
      ).data
      const packageId: string = pkg.id

      // Before a winner is chosen there is nothing to raise, and it says so
      // rather than quietly making an empty order.
      const early = await post(
        client,
        `/projects/${projectId}/procurement/packages/${packageId}/order`,
        token,
      )
      observe('RAISE_BEFORE_AWARD', { status: early.status, code: early.error?.code })
      expect(early.status, 'no order before an award').toBe(409)
      expect(early.error?.code).toBe('PROCUREMENT_NO_AWARD')

      const quote = (
        await post(client, `/projects/${projectId}/procurement/packages/${packageId}/quotes`, token)
      ).data
      await post(client, `/projects/${projectId}/bids/${quote.id}/lines`, token, {
        description: quoted.description,
        unit: quoted.unit,
        qty: quoted.qty,
        estimateRate: 180,
        activityId: activity.id,
      })
      const company = (
        await post(client, '/companies', token, {
          name: `Gamma Cladding ${stamp}`,
          type: 'supplier',
        })
      ).data
      await post(client, `/projects/${projectId}/bids/${quote.id}/invitations`, token, {
        invitations: [{ vendorCompanyId: company.id, contactEmail: `g-${stamp}@example.com` }],
        prequalOverrideReason: 'Raise-order spec',
      })
      await post(client, `/projects/${projectId}/bids/${quote.id}/publish`, token)

      const detail = (await apiGet(client, `/projects/${projectId}/bids/${quote.id}`, token)).body.data
      const resent = await post(
        client,
        `/projects/${projectId}/bids/${quote.id}/invitations/${detail.invitations[0].id}/resend`,
        token,
      )
      const portalToken = String(resent.data?.portalUrl || '').split('/').pop()
      await client.put(`${API}/public/bids/${portalToken}/bid`, {
        data: { lines: [{ packageLineId: detail.lines[0].id, rate: quoted.rate }] },
      })
      await client.post(`${API}/public/bids/${portalToken}/bid/submit`, {
        data: { submittedBy: 'Estimator' },
      })
      const priced = (await apiGet(client, `/projects/${projectId}/bids/${quote.id}`, token)).body.data
      const bid = priced.bids[0]
      await post(client, `/projects/${projectId}/bids/${quote.id}/award`, token, { bidId: bid.id })
      await post(client, `/projects/${projectId}/bids/${quote.id}/award/confirm`, token, {
        bidId: bid.id,
        prequalOverrideReason: 'Raise-order spec',
      })
      return quote.ref as string
    } finally {
      await client.dispose()
    }
  })()

  // The buyer's whole job, from here: one button.
  const buyer = new Journey(
    'Procurement Manager',
    'Raise the order for the cladding that was awarded',
    '/projects/:id/procurement/packages',
  )
  await page.goto(`/projects/${projectId}/procurement/packages`)
  await page.getByTestId(`uat-package-row-PK-RAISE-${stamp}`).click()
  const raiseButton = page.getByTestId(`uat-raise-order-${quoteRef}`)
  await expect(raiseButton, 'an awarded quote offers the order').toBeVisible({ timeout: 30_000 })

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/order'), {
      timeout: 30_000,
    }),
    raiseButton.click(),
  ])
  const order = (await response.json()).data

  buyer
    .step('Raise the order')
    .inherited('supplier', 'the winning bid')
    .inherited('description, unit and quantity', 'the priced package line')
    .inherited('unit cost', 'the rate the supplier quoted')
    .inherited('needed-on-site date and lead time', 'the package')
    .inherited('order reference', 'the project numbering its own orders')
  buyer.emit()

  observe('RAISED_ORDER', {
    ref: order.ref,
    supplier: order.supplier,
    requiredBy: order.requiredBy,
    leadWeeks: order.leadWeeks,
    lines: (order.lines ?? []).map((line: { description: string; unit: string; orderedQty: number; unitCost: number }) => ({
      description: line.description,
      unit: line.unit,
      orderedQty: line.orderedQty,
      unitCost: line.unitCost,
    })),
    // The measurement section 4 is actually about.
    fieldsTypedByTheBuyer: 0,
  })

  // Nothing was sent, and everything came back right.
  expect(order.ref, 'the project numbered it').toMatch(/^PO-\d{5}$/)
  expect(order.supplier, 'the winner carried across').toContain('Gamma Cladding')
  expect(order.leadWeeks, 'the lead time carried across').toBe(10)
  expect(String(order.requiredBy), 'the needed-on-site date carried across').toContain('2027-09-01')
  expect(order.lines, 'one line, as priced').toHaveLength(1)
  expect(order.lines[0].description).toBe(quoted.description)
  expect(order.lines[0].unit).toBe(quoted.unit)
  expect(Number(order.lines[0].orderedQty)).toBe(quoted.qty)
  // The rate is the one the supplier quoted, not the estimate it was against.
  expect(Number(order.lines[0].unitCost)).toBe(quoted.rate)
})
