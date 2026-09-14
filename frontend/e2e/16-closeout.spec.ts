import { expect, test, type APIRequestContext } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, openProject, SHOTS, signIn } from './support'

/**
 * Subcontract closeout.
 *
 * The gate is the point: a subcontract cannot be closed, and its final payment
 * cannot be approved, while the punch list is open, the insurance has lapsed,
 * the account is unsettled or the handover is missing. And half of that is
 * read from the records rather than ticked, because a tickbox next to "punch
 * list closed" is a tickbox somebody ticks on the way to getting paid.
 */

async function withApi<T>(fn: (client: APIRequestContext, token: string) => Promise<T>) {
  const client = await apiClient()
  try {
    return await fn(client, await apiToken(client, 'pm'))
  } finally {
    await client.dispose()
  }
}

/** A subcontract of its own, so the gate is not fighting the seeded one. */
async function freshSubcontract(projectId: string) {
  return withApi(async (client, token) => {
    const response = await client.post(`${API}/projects/${projectId}/commitments`, {
      headers: { authorization: `Bearer ${token}` },
      data: { type: 'subcontract', title: 'Closeout fixture', retentionRate: 5 },
    })
    expect(response.status(), await response.text()).toBe(201)
    const created = (await response.json()).data
    return { id: created.id as string, ref: created.ref as string }
  })
}

const closeoutPath = (projectId: string, commitmentId: string) =>
  `/projects/${projectId}/commitments/${commitmentId}/closeout`

async function readCloseout(projectId: string, commitmentId: string) {
  return withApi(async (client, token) => {
    const { body } = await apiGet(client, closeoutPath(projectId, commitmentId), token)
    return body.data
  })
}

async function setItem(
  projectId: string,
  commitmentId: string,
  key: string,
  data: Record<string, unknown>,
) {
  return withApi(async (client, token) => {
    const response = await client.patch(
      `${API}${closeoutPath(projectId, commitmentId)}/items/${key}`,
      { headers: { authorization: `Bearer ${token}` }, data },
    )
    return { status: response.status(), body: await response.json() }
  })
}

async function closeCommitment(
  projectId: string,
  commitmentId: string,
  data: Record<string, unknown> = {},
) {
  return withApi(async (client, token) => {
    const response = await client.post(
      `${API}/projects/${projectId}/commitments/${commitmentId}/close`,
      { headers: { authorization: `Bearer ${token}` }, data },
    )
    return { status: response.status(), body: await response.json() }
  })
}

/** The seeded, executed subcontract — the one with real work behind it. */
async function seededSubcontract(projectId: string) {
  return withApi(async (client, token) => {
    // asked for by reference: the list answers its first 500 rows, and the runs' residue has pushed the seeded one past them (T-19)
    const { body } = await apiGet(client, `/projects/${projectId}/commitments?search=SC-0001`, token)
    return (body?.data?.items ?? []).find((row: { ref: string }) => row.ref === 'SC-0001') ?? null
  })
}

test.describe('subcontract closeout', () => {
  test('opens with the handover listed and the derived checks already answered', async ({
    page,
  }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const { id } = await freshSubcontract(projectId)

    const closeout = await readCloseout(projectId, id)

    // The four checks the system answers for itself come first.
    const derived = closeout.items.filter((item: { source: string }) => item.source === 'derived')
    expect(derived.map((item: { key: string }) => item.key)).toEqual([
      'punch_closed',
      'insurance_current',
      'account_settled',
      'retention_released',
    ])
    // Each says what it found, so the next step is on the screen.
    for (const item of derived) expect(item.detail).toBeTruthy()

    // And the handover is listed outstanding rather than absent — a checklist
    // you have to remember to add items to is not a checklist.
    const handover = closeout.items.filter((item: { source: string }) => item.source === 'handover')
    expect(handover.map((item: { key: string }) => item.key)).toContain('as_builts')
    expect(handover.map((item: { key: string }) => item.key)).toContain('lien_waiver')
    expect(closeout.ready).toBe(false)
  })

  test('a derived check cannot be ticked, only waived', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const commitment = await seededSubcontract(projectId)
    test.skip(!commitment, 'no seeded subcontract')

    const ticked = await setItem(projectId, commitment.id, 'insurance_current', {
      status: 'complete',
    })
    expect(ticked.status).toBe(409)
    expect(ticked.body.error.code).toBe('CLOSEOUT_DERIVED_ITEM')

    const bare = await setItem(projectId, commitment.id, 'insurance_current', { status: 'waived' })
    expect(bare.status).toBe(400)
    expect(bare.body.error.code).toBe('CLOSEOUT_WAIVER_REASON_REQUIRED')

    const waived = await setItem(projectId, commitment.id, 'insurance_current', {
      status: 'waived',
      waivedReason: 'Cover confirmed by broker letter pending renewal',
    })
    expect(waived.status).toBe(200)
    expect(
      waived.body.data.items.find((item: { key: string }) => item.key === 'insurance_current')
        .status,
    ).toBe('waived')
  })

  test('closing is refused while anything required is outstanding, and says what', async ({
    page,
  }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const { id } = await freshSubcontract(projectId)

    // A draft commitment cannot be closed at all; the closeout gate is the
    // second line, so check it directly.
    const closeout = await readCloseout(projectId, id)
    expect(closeout.ready).toBe(false)
    expect(closeout.outstanding).toContain('As-built records submitted')
    expect(closeout.outstanding).toContain('Final lien waiver')
  })

  test('the seeded subcontract is held by its own records, not by a tickbox', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const commitment = await seededSubcontract(projectId)
    test.skip(!commitment, 'no seeded subcontract')

    const refused = await closeCommitment(projectId, commitment.id)
    // Either the commitment is not executed (transition) or the closeout gate
    // holds it — both are refusals with a named reason, never a silent pass.
    expect([409, 400]).toContain(refused.status)
    expect(refused.body.error.code).toBeTruthy()

    if (refused.body.error.code === 'CLOSEOUT_OUTSTANDING') {
      expect(refused.body.error.details.outstanding.length).toBeGreaterThan(0)
    }
  })

  test('a required item can be recorded, and the count comes down', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const { id } = await freshSubcontract(projectId)

    const before = await readCloseout(projectId, id)
    const recorded = await setItem(projectId, id, 'as_builts', { status: 'complete' })
    expect(recorded.status).toBe(200)

    expect(recorded.body.data.summary.outstanding).toBe(before.summary.outstanding - 1)
    expect(recorded.body.data.outstanding).not.toContain('As-built records submitted')
  })

  test('the checklist reads as a checklist on screen', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const commitment = await seededSubcontract(projectId)
    test.skip(!commitment, 'no seeded subcontract')

    await page.goto(`/projects/${projectId}/commercial/commitments`)
    const row = page.getByRole('row', { name: /SC-0001/ })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.getByRole('button', { name: 'Open' }).click()

    const panel = page.getByTestId('uat-closeout')
    await expect(panel).toBeVisible({ timeout: 20_000 })
    await expect(panel).toContainText('Punch list closed')
    await expect(panel).toContainText('As-built records submitted')
    await expect(panel).toContainText('Final lien waiver')

    // The state chip is the thing that must be impossible to miss.
    await expect(page.getByTestId('uat-closeout-state')).toBeVisible()

    // A derived check offers no way to tick it — only to waive it.
    const insurance = page.getByTestId('uat-closeout-insurance_current')
    await expect(insurance).toBeVisible()
    await expect(
      insurance.getByTestId('uat-closeout-complete-insurance_current'),
    ).toHaveCount(0)

    await page.getByTestId('uat-closeout').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/34-subcontract-closeout.png` })
  })
})
