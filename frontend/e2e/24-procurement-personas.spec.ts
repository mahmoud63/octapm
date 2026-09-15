import { test, expect } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, openProject, signIn } from './support'
import { Journey, cachedToken, observe } from './support-ux'

/**
 * Four people, one delivery.
 *
 * Phase 19 joined procurement to quoting, to the warehouse and to cost, and
 * said plainly that none of it reached the screen. This drives the part that
 * now does, as the four people who actually do it: the PM who needs the
 * material, the buyer who gets it priced and ordered, the storeman who
 * receives it, and finance who reconciles it.
 *
 * What is measured is not whether the API works — Phase 19 proved that — but
 * whether a person can get through: how many steps, what they have to type
 * that the system already knows, and whether they can tell whose move it is.
 *
 * It runs on the seeded project on purpose. Every persona already has access
 * there, and a freshly created project has a team of one — see
 * OCTA-UX-TEAM-093, which is why that is not something a test can arrange.
 */

type Client = Awaited<ReturnType<typeof apiClient>>
type Who = 'pm' | 'procurement' | 'warehouse' | 'finance'

async function withApi<T>(fn: (client: Client, token: string) => Promise<T>, who: Who = 'pm') {
  const client = await apiClient()
  try {
    const token = await cachedToken(`persona-${who}`, () => apiToken(client, who))
    return await fn(client, token)
  } finally {
    await client.dispose()
  }
}

/** A POST that reports what happened instead of returning null. */
const post = async (client: Client, path: string, token: string, data: unknown) => {
  const response = await client.post(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    data,
  })
  let body: { data?: any; error?: { code?: string; message?: string } } | null = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  return { status: response.status(), data: body?.data, error: body?.error }
}

/**
 * A GET that fails loudly. The shared helper returns `body: null` for any
 * non-2xx, which turns a 403 into a null-dereference three lines later and
 * hides which persona was refused — that cost a whole run of this spec.
 */
const get = async (client: Client, path: string, token: string) => {
  const response = await client.get(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  const body = await response.json().catch(() => null)
  expect(
    response.ok(),
    `GET ${path} → ${response.status()} ${body?.error?.code ?? ''} ${body?.error?.message ?? ''}`,
  ).toBeTruthy()
  return body?.data
}

test.describe('four people, one delivery', () => {
  test('a requirement is priced, ordered, delivered and reconciled', async ({ page }) => {
    test.slow()
    const stamp = Date.now().toString(36)

    await signIn(page, 'pm')
    const projectId = await openProject(page)

    // ══ The requirement: a package on a real activity ═══════════════════
    const { pkg, activityId } = await withApi(async (client, token) => {
      const activities = await get(client, `/projects/${projectId}/activities`, token)
      const activity = (activities.items ?? activities ?? [])[0]
      expect(activity?.id, 'the seeded project has a programme').toBeTruthy()
      const created = await post(client, `/projects/${projectId}/procurement/packages`, token, {
        packageNumber: `PK-${stamp}`,
        title: 'Aluminium cladding panels',
        description: 'Anodised, 3mm — 2,000 m²',
        activityId: activity.id,
        requiredOnSiteDate: '2027-08-01',
        leadWeeks: 12,
      })
      expect(created.status, `raising the package: ${created.error?.message ?? ''}`).toBeLessThan(300)
      return { pkg: created.data, activityId: activity.id }
    })

    // ══ PROCUREMENT: get it priced ═══════════════════════════════════════
    const buyer = new Journey(
      'Procurement Manager',
      'Get the cladding priced by two suppliers',
      '/projects/:id/procurement/packages',
    )
    await page.goto(`/projects/${projectId}/procurement/packages`)
    buyer.step('Open Procurement → Packages').navigate('Procurement → Packages')

    const packageRow = page.getByTestId(`uat-package-row-${pkg.packageNumber}`)
    await expect(packageRow).toBeVisible({ timeout: 30_000 })
    // The order window is the thing a buyer needs: how long they have left.
    const windowText = await page.getByTestId(`uat-package-window-${pkg.packageNumber}`).innerText()
    observe('PACKAGE_ORDER_WINDOW', windowText.replace(/\s+/g, ' ').trim())
    buyer.inherited('needed-on-site and latest order date', 'the requirement')

    await packageRow.click()
    const requestQuotes = page.getByTestId(`uat-request-quotes-${pkg.packageNumber}`)
    await expect(requestQuotes).toBeVisible({ timeout: 15_000 })
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/quotes'), {
        timeout: 30_000,
      }),
      requestQuotes.click(),
    ])
    buyer
      .step('Request quotes')
      .inherited('title, description, currency and quote due date', 'the package')

    const enquiryLink = page.locator('[data-testid^="uat-compare-quotes-"]').first()
    await expect(enquiryLink, 'the enquiry is listed against the package').toBeVisible({
      timeout: 30_000,
    })
    const compareHref = await enquiryLink.getAttribute('href')
    observe('QUOTE_ENQUIRY_FROM_PROCUREMENT', {
      // The buyer never chose a commitment type and never opened Commercial.
      typedToCreate: 0,
      comparisonReachable: Boolean(compareHref),
    })

    // The enquiry is a bid package underneath. Nobody had to know that.
    const enquiry = await withApi(async (client, token) => {
      const quotes = await get(
        client,
        `/projects/${projectId}/procurement/packages/${pkg.id}/quotes`,
        token,
      )
      return (quotes.items ?? [])[0]
    })
    expect(enquiry?.commitmentType, 'the enquiry prices a purchase order').toBe('purchase_order')
    buyer.emit()

    // ══ The comparison opens on the enquiry, not on a list ════════════════
    await page.goto(compareHref!)
    const dialog = page.getByRole('dialog')
    await expect(dialog, 'the comparison opens on the enquiry itself').toBeVisible({
      timeout: 30_000,
    })
    const heading = await dialog.locator('h2, [role=heading]').first().innerText()
    observe('DEEP_LINK_OPENS_RECORD', {
      opened: heading.includes(enquiry.ref),
      heading: heading.replace(/\s+/g, ' ').trim().slice(0, 80),
    })
    expect(heading, 'on the right record').toContain(enquiry.ref)

    // And it survives a refresh, so the link can be sent to somebody else.
    await page.reload()
    await expect(page.getByRole('dialog'), 'still open after a refresh').toBeVisible({
      timeout: 30_000,
    })
    observe('DEEP_LINK_SURVIVES_REFRESH', true)

    // ══ Quote → award, through the engine that already did it ════════════
    const awarded = await withApi(async (client, token) => {
      await post(client, `/projects/${projectId}/bids/${enquiry.id}/lines`, token, {
        description: 'Anodised panel, 3mm',
        unit: 'M2',
        qty: 2000,
        estimateRate: 180,
      })
      const supplier = async (name: string) =>
        (await post(client, '/companies', token, { name: `${name} ${stamp}`, type: 'supplier' })).data
      const alpha = await supplier('Alpha Cladding')
      const beta = await supplier('Beta Facades')
      await post(client, `/projects/${projectId}/bids/${enquiry.id}/invitations`, token, {
        invitations: [
          { vendorCompanyId: alpha.id, contactEmail: `a-${stamp}@example.com` },
          { vendorCompanyId: beta.id, contactEmail: `b-${stamp}@example.com` },
        ],
        prequalOverrideReason: 'Persona drive',
      })
      await post(client, `/projects/${projectId}/bids/${enquiry.id}/publish`, token, {})

      const detail = await get(client, `/projects/${projectId}/bids/${enquiry.id}`, token)
      const lineId = detail.lines[0].id
      for (const [index, invitation] of detail.invitations.entries()) {
        const resent = await post(
          client,
          `/projects/${projectId}/bids/${enquiry.id}/invitations/${invitation.id}/resend`,
          token,
          {},
        )
        const portalToken = String(resent.data?.portalUrl || '').split('/').pop()
        await client.put(`${API}/public/bids/${portalToken}/bid`, {
          data: { lines: [{ packageLineId: lineId, rate: index === 0 ? 175 : 168 }] },
        })
        await client.post(`${API}/public/bids/${portalToken}/bid/submit`, {
          data: { submittedBy: 'Estimator' },
        })
      }

      const priced = await get(client, `/projects/${projectId}/bids/${enquiry.id}`, token)
      const cheapest = priced.bids
        .slice()
        .sort((a: { total: number }, b: { total: number }) => a.total - b.total)[0]
      expect(cheapest?.total, 'both suppliers priced it').toBeGreaterThan(0)
      await post(client, `/projects/${projectId}/bids/${enquiry.id}/award`, token, {
        bidId: cheapest.id,
      })
      await post(client, `/projects/${projectId}/bids/${enquiry.id}/award/confirm`, token, {
        bidId: cheapest.id,
        prequalOverrideReason: 'Persona drive',
      })
      return cheapest
    })
    observe('AWARD', { supplier: awarded.companyName, total: awarded.total })

    // ══ PROCUREMENT: raise the order for what was awarded ════════════════
    const order = await withApi(async (client, token) => {
      const raised = await post(
        client,
        `/projects/${projectId}/procurement/purchase-orders`,
        token,
        {
          ref: `PO-${stamp}`,
          activityId,
          packageId: pkg.id,
          requiredBy: '2027-08-01',
          leadWeeks: 12,
          supplier: awarded.companyName,
          lines: [
            {
              activityId,
              description: 'Anodised panel, 3mm',
              unit: 'M2',
              orderedQty: 2000,
              unitCost: 168,
              packageId: pkg.id,
            },
          ],
        },
      )
      expect(raised.status, `raising the order: ${raised.error?.message ?? ''}`).toBeLessThan(300)
      return raised.data
    }, 'procurement')

    // ══ Whose move is it? Asked of the register, as each person ═══════════
    const ballFor = async (who: Who) =>
      withApi(async (client, token) => {
        const rows = await get(client, `/projects/${projectId}/purchase-orders`, token)
        const mine = (rows.items ?? rows ?? []).find(
          (row: { ref: string }) => row.ref === `PO-${stamp}`,
        )
        expect(mine, `${who} can see PO-${stamp}`).toBeTruthy()
        return { status: mine.status, label: mine.ballInCourt?.label ?? null }
      }, who)

    const draft = await ballFor('procurement')
    observe('BALL_IN_COURT_DRAFT', draft)
    expect(draft.label, 'a draft order is the buyer’s move').toBe('Your action')

    await withApi(
      (client, token) =>
        post(client, `/projects/${projectId}/purchase-orders/${order.id}/submit`, token, {}),
      'procurement',
    )
    const submittedForBuyer = await ballFor('procurement')
    const submittedForPm = await ballFor('pm')
    observe('BALL_IN_COURT_SUBMITTED', { buyer: submittedForBuyer, pm: submittedForPm })
    expect(submittedForBuyer.label, 'the buyer is told who holds it').toMatch(/project manager/i)
    expect(submittedForPm.label, 'and the PM is told it is theirs').toBe('Your action')
    // Nobody is ever shown a permission code.
    for (const seen of [draft, submittedForBuyer, submittedForPm]) {
      expect(seen.label ?? '', 'no permission codes on screen').not.toMatch(/[a-z_]+\.[a-z_]+/)
    }

    // ══ PROJECT MANAGER: approve it ══════════════════════════════════════
    const pm = new Journey(
      'Project Manager',
      'Approve the cladding order',
      '/projects/:id/procurement/purchase-orders',
    )
    await withApi(
      (client, token) =>
        post(client, `/projects/${projectId}/purchase-orders/${order.id}/approve`, token, {}),
      'pm',
    )
    pm.step('Approve the order').inherited('supplier, value and dates', 'the award')
    pm.emit()

    const approved = await ballFor('procurement')
    observe('BALL_IN_COURT_APPROVED', approved)
    expect(approved.label, 'and it comes back to the buyer to issue').toBe('Your action')

    await withApi(
      (client, token) =>
        post(client, `/projects/${projectId}/purchase-orders/${order.id}/issue`, token, {}),
      'procurement',
    )
    const issued = await ballFor('procurement')
    observe('BALL_IN_COURT_ISSUED', issued)
    expect(issued.label, 'an issued order waits on the supplier').toMatch(/supplier|Alpha|Beta/i)

    // ══ WAREHOUSE: receive it, from the link Procurement offers ══════════
    const storeman = new Journey(
      'Warehouse Manager',
      'Receive the cladding',
      '/projects/:id/procurement/purchase-orders',
    )
    await page.goto(`/projects/${projectId}/procurement/purchase-orders`)
    const receiveLink = page.getByTestId(`uat-po-receive-PO-${stamp}`)
    await expect(receiveLink, 'the order offers a way to receive it').toBeVisible({
      timeout: 30_000,
    })
    const receiveHref = await receiveLink.getAttribute('href')
    storeman.step('Follow "Receive delivery" from the order').navigate('Procurement → Inventory')

    await page.goto(receiveHref!)
    await expect(page.getByTestId('uat-goods-receipt')).toBeVisible({ timeout: 30_000 })
    // The link carries the order; its lookup lands a moment after the panel paints,
    // so the panel is given time to name it before its text is read (Phase 22B).
    await expect(page.getByTestId('uat-goods-receipt'), 'the order is already looked up').toContainText(`PO-${stamp}`, { timeout: 30_000 })
    const receiptText = await page.getByTestId('uat-goods-receipt').innerText()
    const warehouseValue = await page
      .getByTestId('uat-receipt-warehouse')
      .innerText()
      .catch(() => '')
    observe('RECEIPT_PREFILLED', {
      orderFound: receiptText.includes(`PO-${stamp}`),
      warehousePreselected: warehouseValue.trim().length > 0,
      warehouse: warehouseValue.replace(/\s+/g, ' ').trim(),
      typedToGetHere: 0,
    })
    expect(receiptText, 'the order is already looked up').toContain(`PO-${stamp}`)
    storeman.inherited('the order, its lines and the warehouse', 'the link from Procurement')
    storeman.emit()

    // Two deliveries, through the one writer.
    const receipt = (qty: number, note: string) =>
      withApi(async (client, token) => {
        const warehouses = await get(client, '/inventory/warehouses', token)
        return post(client, '/inventory/goods-receipt', token, {
          orderId: order.id,
          warehouseId: (warehouses.items ?? warehouses)[0].id,
          receiptNumber: note,
          lines: [{ poLineId: order.lines[0].id, acceptedQty: qty }],
        })
      }, 'warehouse')

    const first = await receipt(1200, `GRN-A-${stamp}`)
    expect(first.status, `first delivery: ${first.error?.message ?? ''}`).toBeLessThan(300)
    const partial = await ballFor('warehouse')
    observe('BALL_IN_COURT_PART_DELIVERED', partial)
    expect(partial.label, 'a part-delivered order is the warehouse’s move').toBe('Your action')

    const second = await receipt(800, `GRN-B-${stamp}`)
    expect(second.status, `second delivery: ${second.error?.message ?? ''}`).toBeLessThan(300)
    const delivered = await ballFor('pm')
    observe('BALL_IN_COURT_DELIVERED', delivered)
    expect(delivered.label, 'a delivered order waits on the invoice').toMatch(/finance|invoice/i)

    // ══ FINANCE: match the order against what actually arrived ═══════════
    const finance = new Journey(
      'Finance',
      'Check the cladding invoice against the delivery',
      '/inventory (three-way match)',
    )
    const matched = await withApi(
      (client, token) => get(client, `/inventory/match/order/${order.id}`, token),
      'finance',
    )
    observe('THREE_WAY_MATCH', {
      lines: (matched?.lines ?? []).length,
      verdict: matched?.verdict ?? matched?.status ?? null,
      orderedVsReceived: (matched?.lines ?? []).map((line: any) => ({
        ordered: line.orderedQty,
        received: line.receivedQty,
      })),
    })
    expect(matched, 'finance can match the order against what arrived').toBeTruthy()
    finance
      .step('Open the three-way match for the order')
      .inherited('ordered, received and invoiced quantities', 'the order and its deliveries')
    finance.emit()
  })
})
