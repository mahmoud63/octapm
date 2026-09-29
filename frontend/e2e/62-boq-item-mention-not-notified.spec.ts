import { test, expect } from '@playwright/test'
import { apiClient } from './support'
import {
  addMember,
  apiJson,
  createProject,
  dropLiveOrg,
  registerLiveOrg,
  signInForm,
  workspaceToken,
  type LiveOrg,
} from './support-workspaces'

/**
 * A mention on a BOQ row, from the BOQ page (owner F1, 2026-09-28):
 *
 *   the PM opens the row's Discussion and @mentions a cost controller whose
 *   project template sets BOQ to none; the comment is saved, and the thread says, in the
 *   server's words, that they were not notified and why — names only
 *
 * Everything is built through the API in a throwaway "LiveTest <uuid>"
 * organisation, dropped afterwards.
 */

let org: LiveOrg | null = null

test.afterAll(() => {
  if (org) dropLiveOrg(org.orgId)
})

test('a mention on a BOQ row tells its author who cannot see the BOQ', async ({ page }) => {
  test.setTimeout(180_000)
  const client = await apiClient()
  let projectId: string
  let itemId: string
  try {
    org = await registerLiveOrg(client, 'boqmention')
    projectId = await createProject(client, org.adminToken, `BOQ mention ${Date.now()}`)
    const controllerEmail = `live-boqmention-cc-${Date.now()}@octapm-live.test`
    const controllerId = await addMember(client, org, {
      name: 'Omar Ali',
      email: controllerEmail,
      role: 'cost_controller',
    })
    const joined = await apiJson(client, 'post', `/projects/${projectId}/team`, {
      token: org.adminToken,
      data: { userId: controllerId },
    })
    expect(joined.status, JSON.stringify(joined.body?.error)).toBeLessThan(300)
    const template = await apiJson(client, 'post', '/permissions/templates', {
      token: org.adminToken,
      data: { name: `No BOQ cost controller ${Date.now()}`, baseRole: 'cost_controller', tools: [{ module: 'boq', level: 'none' }] },
    })
    expect(template.status, JSON.stringify(template.body?.error)).toBe(201)
    const applied = await apiJson(client, 'put', `/projects/${projectId}/team/${controllerId}/permissions`, {
      token: org.adminToken,
      data: { templateId: template.body!.data!.id },
    })
    expect(applied.status, JSON.stringify(applied.body?.error)).toBe(200)
    const item = await apiJson(client, 'post', `/projects/${projectId}/boq/items`, {
      token: org.adminToken,
      data: { code: '9.1', description: 'Blinding concrete', quantity: 10, unit: 'm3', rate: 100 },
    })
    expect(item.status, JSON.stringify(item.body?.error)).toBe(201)
    itemId = (item.body!.data as { item: { id: string } }).item.id
    // The premise: the cost controller is on the project and may not read its BOQ.
    const controllerToken = await workspaceToken(client, controllerEmail, org.orgId)
    expect((await apiJson(client, 'get', `/projects/${projectId}`, { token: controllerToken })).status).toBe(200)
    expect((await apiJson(client, 'get', `/projects/${projectId}/boq`, { token: controllerToken })).status).toBe(403)
  } finally {
    await client.dispose()
  }

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)
  await page.goto(`/o/${org!.segment}/projects/${projectId}/boq`)

  await page.getByTestId('boq-row-actions').first().click()
  await page.getByTestId('boq-row-discussion').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('BOQ row 9.1 – Blinding concrete')).toBeVisible()

  const input = dialog.getByTestId('uat-comment-input')
  await input.click()
  await input.pressSequentially('@Omar')
  await dialog.getByTestId('uat-comment-mention-option').filter({ hasText: 'Omar Ali' }).click()
  await input.pressSequentially('is this rate right?')

  const posted = page.waitForResponse(
    (r) => r.url().endsWith('/comments') && r.request().method() === 'POST',
  )
  await dialog.getByTestId('uat-comment-post').click()
  const response = await posted
  expect(response.status()).toBe(201)
  const saved = (await response.json()).data
  expect(saved.recordType).toBe('boq_item')
  expect(saved.recordId).toBe(itemId)
  expect(saved.notNotified?.people).toEqual([{ userId: expect.any(String), name: 'Omar Ali' }])

  // Saved, with the mention…
  await expect(dialog.getByTestId('uat-comment-item')).toHaveCount(1)
  // …and the author is told, in the server's words, who was not notified.
  await expect(dialog.getByTestId('comment-not-notified')).toHaveText(
    'Saved. Not notified (no BOQ access): Omar Ali.',
  )
})
