import { test, expect, type Page } from '@playwright/test'
import { apiClient } from './support'
import {
  apiJson,
  dropLiveOrg,
  escapeRegExp,
  registerLiveOrg,
  setLivePlan,
  signInForm,
  type LiveOrg,
} from './support-workspaces'

/**
 * The subscription display and the gates agree (PLAN-CATALOGUE-UAT,
 * docs/qa/OCTAPM_ISSUE_PLAN-CATALOGUE-UAT.md).
 *
 * One throwaway company workspace, registered through sign-up and put on
 * business: Settings › Billing names Business with its limits, and the
 * server lets it create a project. Put on "standard" — a plan outside the
 * catalogue, what the UAT seed used to write — the same screen says
 * "Subscription plan: configuration issue", limits unavailable, contact your
 * administrator, with no tier name and never Trial; the plans page says so
 * too; and project creation is refused with the same configuration fault.
 * Nothing here signs in to the E2E, demo or UAT organisations.
 */

let org: LiveOrg

const openBillingSettings = async (page: Page) => {
  const billing = page.waitForResponse(
    (r) => r.url().includes('/billing/subscription') && r.request().method() === 'GET',
    { timeout: 30_000 },
  )
  await page.goto(`/o/${org.segment}/settings/billing`)
  expect((await billing).status()).toBe(200)
  await expect(page.getByText('Current plan')).toBeVisible()
}

test.beforeAll(async () => {
  const client = await apiClient()
  try {
    org = await registerLiveOrg(client, 'plan')
  } finally {
    await client.dispose()
  }
})

test.afterAll(async () => {
  if (org) dropLiveOrg(org.orgId)
})

test('business shows Business with its limits; a plan outside the catalogue shows a configuration issue, never Trial, and the gate agrees', async ({
  page,
}) => {
  await signInForm(page, org.adminEmail)
  await expect(page).toHaveURL(new RegExp(`/o/${escapeRegExp(org.segment)}(/|$|\\?)`), { timeout: 30_000 })

  // ── Business ────────────────────────────────────────────────────────────
  await openBillingSettings(page)
  await expect(page.getByTestId('subscription-plan')).toHaveText('Business')
  await expect(page.getByTestId('subscription-limits')).toHaveText(
    'Up to 25 live projects · 0 of 150 AI generations used this period',
  )
  await expect(page.getByTestId('subscription-plan-fault')).toHaveCount(0)

  const client = await apiClient()
  try {
    const created = await apiJson(client, 'post', '/projects', {
      token: org.adminToken,
      data: { name: 'Plan display project', type: 'building', startDate: '2026-01-05', endDate: '2026-12-18' },
    })
    expect(created.status, JSON.stringify(created.body?.error)).toBe(201)

    // ── A plan outside the catalogue ──────────────────────────────────────
    setLivePlan(org.orgId, 'standard')
    await openBillingSettings(page)
    const fault = page.getByTestId('subscription-plan-fault')
    await expect(fault).toBeVisible()
    await expect(page.getByTestId('subscription-plan')).toHaveText('Subscription plan: configuration issue')
    await expect(page.getByTestId('subscription-limits')).toHaveText('Limits unavailable — contact your administrator.')
    await expect(fault).toContainText('Stored plan: standard')
    const card = page.locator('[data-slot="card"]').filter({ hasText: 'Current plan' })
    await expect(card).not.toContainText(/trial/i)
    await expect(card).not.toContainText('Business')
    await expect(card).not.toContainText(/\b0 of\b|Up to/)

    // The gate says the same thing the screen says.
    const refused = await apiJson(client, 'post', '/projects', {
      token: org.adminToken,
      data: { name: 'Refused on an unknown plan', type: 'building', startDate: '2026-01-05', endDate: '2026-12-18' },
    })
    expect(refused.status).toBe(500)
    expect(refused.body?.error?.code).toBe('SUBSCRIPTION_PLAN_UNKNOWN')
    expect(refused.body?.error?.message).toMatch(/^Subscription plan: configuration issue\./)
    await expect(fault).toContainText(refused.body!.error!.message!)

    // The plans page names the fault too.
    await page.goto(`/o/${org.segment}/billing`)
    await expect(page.getByTestId('subscription-plan-fault')).toContainText('Subscription plan: configuration issue')
    await expect(page.getByTestId('subscription-plan-fault')).toContainText('contact your administrator')
  } finally {
    await client.dispose()
  }
})
