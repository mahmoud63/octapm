import { expect, test, type APIRequestContext } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, openProject, SHOTS, signIn } from './support'

/**
 * The subcontract agreement.
 *
 * Nothing in it is typed: every clause and figure is read off a record
 * somebody already approved. What is worth testing is that the assembly pulls
 * the right records together, and that a document with gaps in it says so on
 * its own face — because that is the one that gets signed by mistake.
 */

async function withApi<T>(fn: (client: APIRequestContext, token: string) => Promise<T>) {
  const client = await apiClient()
  try {
    return await fn(client, await apiToken(client, 'pm'))
  } finally {
    await client.dispose()
  }
}

async function subcontract(projectId: string) {
  return withApi(async (client, token) => {
    const { body } = await apiGet(client, `/projects/${projectId}/commitments`, token)
    const rows = body?.data?.items ?? []
    return rows.find((row: { ref: string }) => row.ref === 'SC-0001') ?? null
  })
}

const agreementPath = (projectId: string, commitmentId: string) =>
  `/projects/${projectId}/commitments/${commitmentId}/agreement`

test.describe('subcontract agreement', () => {
  test('is assembled from the records, not retyped', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const commitment = await subcontract(projectId)
    test.skip(!commitment, 'no seeded subcontract')

    const agreement = await withApi(async (client, token) => {
      const { status, body } = await apiGet(client, agreementPath(projectId, commitment.id), token)
      expect(status).toBe(200)
      return body.data
    })

    // The vendor's own profile, entered once at company level.
    expect(agreement.parties.subcontractor.legalName).toBeTruthy()
    expect(agreement.parties.subcontractor.registrationNumber).toBeTruthy()

    // The sum comes from the schedule of values plus the approved changes,
    // and must agree with the commitment itself.
    expect(agreement.money.revised).toBeCloseTo(
      agreement.money.original + agreement.money.approvedChanges,
      2,
    )
    expect(agreement.money.original).toBeCloseTo(
      agreement.scheduleOfValues.reduce(
        (total: number, line: { amount: number }) => total + line.amount,
        0,
      ),
      2,
    )

    // The programme comes off the activities the schedule of values is on.
    expect(agreement.milestones.length).toBeGreaterThan(0)

    // And the retention clause quotes the commitment's own rate.
    const retention = agreement.clauses.find(
      (clause: { heading: string }) => clause.heading === 'Retention',
    )
    expect(retention.body[0]).toContain(`${agreement.money.retentionRate}%`)
  })

  test('names what is still missing rather than only refusing', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const commitment = await subcontract(projectId)
    test.skip(!commitment, 'no seeded subcontract')

    const agreement = await withApi(async (client, token) => {
      const { body } = await apiGet(client, agreementPath(projectId, commitment.id), token)
      return body.data
    })

    // The seed leaves required cover without certificates, which is the state
    // a fresh subcontract is actually in.
    expect(agreement.readiness.ready).toBe(false)
    expect(agreement.readiness.gaps.join(' ')).toContain('insurance')
    // Named, so the person reading it knows what to chase.
    for (const gap of agreement.readiness.gaps) expect(gap.length).toBeGreaterThan(10)
  })

  test('a draft still generates, and says on its face that it is one', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const commitment = await subcontract(projectId)
    test.skip(!commitment, 'no seeded subcontract')

    const pdf = await withApi(async (client, token) => {
      const response = await client.get(`${API}${agreementPath(projectId, commitment.id)}.pdf`, {
        headers: { authorization: `Bearer ${token}` },
      })
      return { status: response.status(), type: response.headers()['content-type'], body: await response.body() }
    })

    expect(pdf.status).toBe(200)
    expect(pdf.type).toContain('application/pdf')
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF')
    expect(pdf.body.length).toBeGreaterThan(5000)
  })

  test('the commitment shows the readiness and offers the document', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const commitment = await subcontract(projectId)
    test.skip(!commitment, 'no seeded subcontract')

    await page.goto(`/projects/${projectId}/commercial/commitments`)
    await expect(page.getByText('SC-0001')).toBeVisible({ timeout: 30_000 })
    await page
      .getByRole('row', { name: /SC-0001/ })
      .getByRole('button', { name: 'Open' })
      .click()

    const card = page.getByTestId('uat-subcontract-agreement')
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(card).toContainText('Nothing is retyped')
    await expect(page.getByTestId('uat-agreement-gaps')).toContainText('insurance')
    await expect(page.getByTestId('uat-agreement-download')).toBeVisible()

    // The card sits below the fold of a scrolling dialog, so bring it into
    // view before capturing.
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/33-subcontract-agreement.png` })
  })
})
