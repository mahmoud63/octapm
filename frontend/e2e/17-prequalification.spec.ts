import { expect, test, type APIRequestContext } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, openProject, SHOTS, signIn } from './support'

/**
 * Subcontractor prequalification.
 *
 * Stage 2 of the lifecycle: before a company is invited to price work,
 * somebody establishes it can do the work and survive doing it. Nine weighted
 * criteria, a score out of a hundred that recommends rather than decides, and
 * two gates — the bid invitation and the award.
 *
 * The point of the "expired" state is that it is never stored. A qualification
 * granted on a licence that lapses stops counting the day it lapses, not the
 * day somebody notices.
 */

async function withApi<T>(fn: (client: APIRequestContext, token: string) => Promise<T>) {
  const client = await apiClient()
  try {
    return await fn(client, await apiToken(client, 'pm'))
  } finally {
    await client.dispose()
  }
}

/**
 * Every company and package this spec raises carries this prefix, so the seed's
 * `purgeTestResidue` can clear them instead of letting them pile up in the
 * vendor directory run after run.
 */
const FIXTURE = 'E2E Prequal'

/** A vendor of its own, so the gate is not fighting the seeded one. */
async function freshVendor(label: string) {
  return withApi(async (client, token) => {
    const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${stamp}@example.test`
    const response = await client.post(`${API}/company/vendors`, {
      headers: { authorization: `Bearer ${token}` },
      data: { name: `${FIXTURE} ${label} ${stamp}`, email, trades: ['formwork'] },
    })
    expect(response.status(), await response.text()).toBe(201)
    const created = (await response.json()).data
    return { id: created.id as string, name: created.name as string, email }
  })
}

const CRITERIA = [
  'financial_capacity',
  'safety_history',
  'experience',
  'references',
  'insurance',
  'licenses',
  'manpower',
  'equipment',
  'quality_history',
]

async function scoreAll(companyId: string, score = 4) {
  return withApi(async (client, token) => {
    let last = null
    for (const key of CRITERIA) {
      const response = await client.patch(
        `${API}/company/vendors/${companyId}/prequalification/criteria/${key}`,
        { headers: { authorization: `Bearer ${token}` }, data: { score } },
      )
      expect(response.status(), `${key}: ${await response.text()}`).toBe(200)
      last = (await response.json()).data
    }
    return last
  })
}

async function decide(companyId: string, data: Record<string, unknown>) {
  return withApi(async (client, token) => {
    const response = await client.post(
      `${API}/company/vendors/${companyId}/prequalification/decision`,
      { headers: { authorization: `Bearer ${token}` }, data },
    )
    return { status: response.status(), body: await response.json() }
  })
}

async function setExpiry(companyId: string, key: string, expiresAt: string | null) {
  return withApi(async (client, token) => {
    const response = await client.patch(
      `${API}/company/vendors/${companyId}/prequalification/criteria/${key}`,
      { headers: { authorization: `Bearer ${token}` }, data: { expiresAt } },
    )
    return { status: response.status(), body: await response.json() }
  })
}

const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

test.describe('subcontractor prequalification', () => {
  test('opens with nine criteria weighted to a hundred, unscored, and every gap named', async ({
    page,
  }) => {
    await signIn(page)
    const vendor = await freshVendor('Prequal fixture')

    const view = await withApi(async (client, token) => {
      const { body } = await apiGet(client, `/company/vendors/${vendor.id}/prequalification`, token)
      return body.data
    })

    expect(view.criteria).toHaveLength(9)
    expect(view.criteria.reduce((sum: number, row: { weight: number }) => sum + row.weight, 0)).toBe(100)
    expect(view.score).toBeNull()
    expect(view.qualified).toBe(false)
    // Named, not counted: "Safety history has not been scored" is a next step.
    expect(view.gaps).toContain('Financial capacity has not been scored')
    expect(view.gaps).toHaveLength(9)
  })

  test('the score recommends; the decision is a person’s, and disagreeing with it is recorded', async ({
    page,
  }) => {
    await signIn(page)
    const vendor = await freshVendor('Scored')

    const scored = await scoreAll(vendor.id, 5)
    expect(scored.score).toBe(100)
    expect(scored.recommendation).toBe('approved')
    expect(scored.gaps).toEqual([])

    const conditional = await decide(vendor.id, {
      status: 'conditionally_approved',
      validUntil: iso(365),
      conditions: 'Supervision to be named before mobilisation.',
      singleAwardLimit: 500000,
    })
    expect(conditional.status).toBe(200)
    expect(conditional.body.data.storedRecommendation).toBe('approved')
    expect(conditional.body.data.decisionAgainstScore).toBe(true)
    expect(conditional.body.data.qualified).toBe(true)
  })

  test('a decision is refused while the assessment is unfinished, and says what is missing', async ({
    page,
  }) => {
    await signIn(page)
    const vendor = await freshVendor('Unfinished')

    const early = await decide(vendor.id, { status: 'approved', validUntil: iso(365) })
    expect(early.status).toBe(409)
    expect(early.body.error.code).toBe('PREQUAL_INCOMPLETE')
    expect(early.body.error.details.gaps.length).toBe(9)

    await scoreAll(vendor.id)

    // A qualification with no expiry date is not a qualification.
    const noValidity = await decide(vendor.id, { status: 'approved' })
    expect(noValidity.status).toBe(409)
    expect(noValidity.body.error.details.gaps).toEqual([
      'A qualification with no expiry date is not a qualification — set one',
    ])

    const noConditions = await decide(vendor.id, {
      status: 'conditionally_approved',
      validUntil: iso(365),
    })
    expect(noConditions.body.error.details.gaps).toEqual(['Say what the conditions are'])
  })

  test('a licence that lapses first caps the qualification, and cover already lapsed blocks it', async ({
    page,
  }) => {
    await signIn(page)
    const vendor = await freshVendor('Lapsing')

    await scoreAll(vendor.id)
    // Approved for a year, on a licence good for a month.
    const licence = await setExpiry(vendor.id, 'licenses', iso(30))
    expect(licence.status).toBe(200)

    const approved = await decide(vendor.id, { status: 'approved', validUntil: iso(365) })
    expect(approved.status).toBe(200)
    expect(approved.body.data.qualified).toBe(true)
    // Cover that lapses in a month cannot qualify anybody in two.
    expect(approved.body.data.expiresBecause).toBe('Licences and registrations')
    expect(new Date(approved.body.data.expiresAt).getTime()).toBeLessThan(
      new Date(approved.body.data.validUntil).getTime()
    )

    // Now the licence has already lapsed. Granting a qualification on it would
    // read "approved" and be expired the moment it was granted, so it is
    // refused and the reason is named.
    const reopened = await withApi(async (client, token) => {
      const response = await client.post(
        `${API}/company/vendors/${vendor.id}/prequalification/reopen`,
        { headers: { authorization: `Bearer ${token}` }, data: { reason: 'Licence lapsed' } },
      )
      return response.status()
    })
    expect(reopened).toBe(200)

    const lapsed = await setExpiry(vendor.id, 'licenses', iso(-30))
    expect(lapsed.status).toBe(200)
    expect(lapsed.body.data.criteria.find((row: { key: string }) => row.key === 'licenses').expired).toBe(true)

    const blocked = await decide(vendor.id, { status: 'approved', validUntil: iso(365) })
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.code).toBe('PREQUAL_INCOMPLETE')
    expect(blocked.body.error.details.gaps.join(' ')).toContain(
      'Licences and registrations expired on'
    )

    const view = await withApi(async (client, token) => {
      const { body } = await apiGet(client, `/company/vendors/${vendor.id}/prequalification`, token)
      return body.data
    })
    expect(view.status).toBe('under_review')
    expect(view.qualified).toBe(false)
  })

  test('an unprequalified vendor cannot be invited to price work, unless somebody says why', async ({
    page,
  }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const vendor = await freshVendor('Ungated')

    const pkg = await withApi(async (client, token) => {
      const response = await client.post(`${API}/projects/${projectId}/bids`, {
        headers: { authorization: `Bearer ${token}` },
        data: { title: `${FIXTURE} gate ${Date.now().toString(36)}`, commitmentType: 'subcontract' },
      })
      expect(response.status(), await response.text()).toBe(201)
      return (await response.json()).data
    })

    const invite = (data: Record<string, unknown>) =>
      withApi(async (client, token) => {
        const response = await client.post(
          `${API}/projects/${projectId}/bids/${pkg.id}/invitations`,
          { headers: { authorization: `Bearer ${token}` }, data },
        )
        return { status: response.status(), body: await response.json() }
      })

    const refused = await invite({
      invitations: [{ vendorCompanyId: vendor.id, contactEmail: vendor.email }],
    })
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe('PREQUAL_NOT_QUALIFIED')
    expect(refused.body.error.message).toContain('has not been prequalified')
    expect(refused.body.error.details.vendors[0].status).toBe('not_assessed')

    // The gate is not there to be impossible to bypass — it is there to make
    // bypassing it a decision somebody put their name to.
    const allowed = await invite({
      invitations: [{ vendorCompanyId: vendor.id, contactEmail: vendor.email }],
      prequalOverrideReason: 'Emergency works; assessment starts Monday.',
    })
    expect(allowed.status).toBe(201)
  })

  test('the assessment reads as an assessment on screen', async ({ page }) => {
    await signIn(page)
    const vendor = await freshVendor('On screen')
    await scoreAll(vendor.id, 4)
    await decide(vendor.id, {
      status: 'conditionally_approved',
      validUntil: iso(300),
      conditions: 'Second-tier supervision to be named before mobilisation.',
      singleAwardLimit: 750000,
    })

    await page.goto('/company/vendors')
    const row = page.getByRole('row', { name: new RegExp(vendor.name) })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row.getByTestId('uat-vendor-prequal-conditionally_approved')).toBeVisible()

    await row.getByRole('button', { name: 'Edit vendor' }).click()
    const panel = page.getByTestId('uat-prequal')
    await expect(panel).toBeVisible({ timeout: 20_000 })
    await expect(panel).toContainText('Financial capacity')
    await expect(panel).toContainText('Safety history')
    await expect(panel).toContainText('Quality history')
    await expect(page.getByTestId('uat-prequal-score')).toContainText('80')
    await expect(page.getByTestId('uat-prequal-state')).toContainText(
      'Conditionally approved'
    )
    // A decision taken against the score says so.
    await expect(panel).toContainText('Recorded against the score')

    await panel.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/35-subcontractor-prequalification.png` })
  })
})
