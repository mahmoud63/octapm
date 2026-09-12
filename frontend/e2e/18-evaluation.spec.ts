import { expect, test, type APIRequestContext } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, openProject, SHOTS, signIn } from './support'

/**
 * Subcontractor performance evaluation.
 *
 * The counterpart to prequalification: that one asks whether a company can do
 * the work, this one asks whether they did. By now there is a trail, so six of
 * the eight criteria are read from the records and only the two nobody can
 * count are rated.
 *
 * The two things worth proving here are the ones that make the score honest:
 * a line with nothing to measure scores nothing rather than zero, and
 * disagreeing with what the records say is an override that needs a reason.
 */

async function withApi<T>(fn: (client: APIRequestContext, token: string) => Promise<T>) {
  const client = await apiClient()
  try {
    return await fn(client, await apiToken(client, 'pm'))
  } finally {
    await client.dispose()
  }
}

/** The seeded, executed subcontract — the one with real work behind it. */
async function seededSubcontract(projectId: string) {
  return withApi(async (client, token) => {
    const { body } = await apiGet(client, `/projects/${projectId}/commitments`, token)
    return (body?.data?.items ?? []).find((row: { ref: string }) => row.ref === 'SC-0001') ?? null
  })
}

const path = (projectId: string, commitmentId: string) =>
  `/projects/${projectId}/commitments/${commitmentId}/evaluation`

async function readEvaluation(projectId: string, commitmentId: string) {
  return withApi(async (client, token) => {
    const { body } = await apiGet(client, path(projectId, commitmentId), token)
    return body.data
  })
}

async function scoreCriterion(
  projectId: string,
  commitmentId: string,
  key: string,
  data: Record<string, unknown>,
) {
  return withApi(async (client, token) => {
    const response = await client.patch(`${API}${path(projectId, commitmentId)}/criteria/${key}`, {
      headers: { authorization: `Bearer ${token}` },
      data,
    })
    return { status: response.status(), body: await response.json() }
  })
}

async function post(projectId: string, commitmentId: string, action: string, data = {}) {
  return withApi(async (client, token) => {
    const response = await client.post(`${API}${path(projectId, commitmentId)}/${action}`, {
      headers: { authorization: `Bearer ${token}` },
      data,
    })
    return { status: response.status(), body: await response.json() }
  })
}

async function setVerdict(projectId: string, commitmentId: string, data: Record<string, unknown>) {
  return withApi(async (client, token) => {
    const response = await client.patch(`${API}${path(projectId, commitmentId)}`, {
      headers: { authorization: `Bearer ${token}` },
      data,
    })
    return { status: response.status(), body: await response.json() }
  })
}

/** Puts the seeded evaluation back to a draft so each test starts level. */
async function resetEvaluation(projectId: string, commitmentId: string) {
  const view = await readEvaluation(projectId, commitmentId)
  if (view.status === 'final') {
    await post(projectId, commitmentId, 'reopen', { reason: 'Test reset' })
  }
  for (const line of view.criteria) {
    if (line.overridden || (line.source === 'rated' && line.score !== null)) {
      await scoreCriterion(projectId, commitmentId, line.key, { score: null })
    }
  }
  await setVerdict(projectId, commitmentId, { wouldReuse: null, summary: null })
}

test.describe('subcontractor performance evaluation', () => {
  test('reads six criteria from the records and leaves two to a person', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const commitment = await seededSubcontract(projectId)
    test.skip(!commitment, 'no seeded subcontract')
    await resetEvaluation(projectId, commitment.id)

    const view = await readEvaluation(projectId, commitment.id)

    expect(view.criteria).toHaveLength(8)
    expect(view.criteria.reduce((sum: number, row: { weight: number }) => sum + row.weight, 0)).toBe(100)

    const derived = view.criteria.filter((row: { source: string }) => row.source === 'derived')
    const rated = view.criteria.filter((row: { source: string }) => row.source === 'rated')
    expect(derived).toHaveLength(6)
    expect(rated.map((row: { key: string }) => row.key)).toEqual(['schedule', 'management'])

    // Every derived line says what it found, so the score can be argued with.
    for (const row of derived) expect(row.detail).toBeTruthy()

    expect(view.gaps).toContain('Programme has not been rated')
    expect(view.gaps).toContain('Say whether you would use them again')
  })

  test('a line with nothing to measure scores nothing, not zero', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const commitment = await seededSubcontract(projectId)
    test.skip(!commitment, 'no seeded subcontract')

    const view = await readEvaluation(projectId, commitment.id)
    const unmeasured = view.criteria.filter(
      (row: { source: string; score: number | null }) => row.source === 'derived' && row.score === null,
    )
    // The seeded subcontract has an untouched closeout, so at minimum the
    // handover cannot be scored — and scoring it zero would measure the
    // project's record-keeping rather than the subcontractor.
    expect(unmeasured.length).toBeGreaterThan(0)
    expect(view.unmeasurable.length).toBe(unmeasured.length)
    // Those weights drop out rather than dragging the score down.
    const dropped = unmeasured.reduce((sum: number, row: { weight: number }) => sum + row.weight, 0)
    const rated = view.criteria.filter(
      (row: { source: string; score: number | null }) => row.source === 'rated' && row.score === null,
    )
    const unrated = rated.reduce((sum: number, row: { weight: number }) => sum + row.weight, 0)
    expect(view.weightScored).toBe(100 - dropped - unrated)
  })

  test('disagreeing with the records is an override, and it needs a reason', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const commitment = await seededSubcontract(projectId)
    test.skip(!commitment, 'no seeded subcontract')
    await resetEvaluation(projectId, commitment.id)

    const before = await readEvaluation(projectId, commitment.id)
    const quality = before.criteria.find((row: { key: string }) => row.key === 'quality')

    const bare = await scoreCriterion(projectId, commitment.id, 'quality', { score: 2 })
    expect(bare.status).toBe(400)
    expect(bare.body.error.code).toBe('EVALUATION_OVERRIDE_REASON_REQUIRED')

    const overridden = await scoreCriterion(projectId, commitment.id, 'quality', {
      score: 2,
      overrideReason: 'Two pours had to be cut out; the register does not show the cost of that.',
    })
    expect(overridden.status).toBe(200)
    const after = overridden.body.data.criteria.find((row: { key: string }) => row.key === 'quality')
    expect(after.score).toBe(2)
    // The reading it replaced stays visible beside it.
    expect(after.derivedScore).toBe(quality.score)
    expect(after.overridden).toBe(true)

    // Clearing it puts the reading back.
    const cleared = await scoreCriterion(projectId, commitment.id, 'quality', { score: null })
    const restored = cleared.body.data.criteria.find((row: { key: string }) => row.key === 'quality')
    expect(restored.score).toBe(quality.score)
    expect(restored.overridden).toBe(false)
  })

  test('finalising is refused while anything is unanswered, and says what', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const commitment = await seededSubcontract(projectId)
    test.skip(!commitment, 'no seeded subcontract')
    await resetEvaluation(projectId, commitment.id)

    const early = await post(projectId, commitment.id, 'final')
    expect(early.status).toBe(409)
    expect(early.body.error.code).toBe('EVALUATION_INCOMPLETE')
    expect(early.body.error.details.gaps).toContain('Say whether you would use them again')
  })

  test('a finalised evaluation counts towards the company record and shows on their prequalification', async ({
    page,
  }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const commitment = await seededSubcontract(projectId)
    test.skip(!commitment, 'no seeded subcontract')
    await resetEvaluation(projectId, commitment.id)

    for (const [key, score] of [
      ['schedule', 3],
      ['management', 4],
    ] as const) {
      const result = await scoreCriterion(projectId, commitment.id, key, { score })
      expect(result.status, JSON.stringify(result.body)).toBe(200)
    }
    await setVerdict(projectId, commitment.id, {
      wouldReuse: true,
      summary: 'Strong on safety; the programme slipped twice on rebar deliveries.',
    })

    const final = await post(projectId, commitment.id, 'final')
    expect(final.status).toBe(200)
    expect(final.body.data.status).toBe('final')
    const score = final.body.data.score
    expect(score).toBeGreaterThan(0)

    // Scoring a final evaluation is refused.
    const late = await scoreCriterion(projectId, commitment.id, 'schedule', { score: 5 })
    expect(late.status).toBe(409)
    expect(late.body.error.code).toBe('EVALUATION_FINAL')

    // This is the loop: it now shows where somebody decides whether to
    // qualify them again.
    const vendorId = commitment.vendor?.id
    expect(vendorId).toBeTruthy()
    const prequal = await withApi(async (client, token) => {
      const { body } = await apiGet(client, `/company/vendors/${vendorId}/prequalification`, token)
      return body.data
    })
    expect(prequal.performance.evaluations).toBeGreaterThan(0)
    expect(prequal.performance.score).toBe(score)
    expect(prequal.performance.wouldReuse.yes).toBeGreaterThan(0)
  })

  test('the evaluation reads as an evaluation on screen', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const commitment = await seededSubcontract(projectId)
    test.skip(!commitment, 'no seeded subcontract')

    await page.goto(`/projects/${projectId}/commercial/commitments`)
    const row = page.getByRole('row', { name: /SC-0001/ })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.getByRole('button', { name: 'Open' }).click()

    const panel = page.getByTestId('uat-evaluation')
    await expect(panel).toBeVisible({ timeout: 20_000 })
    await expect(panel).toContainText('Quality of work')
    await expect(panel).toContainText('Programme')
    await expect(panel).toContainText('Would you use them again?')
    await expect(page.getByTestId('uat-evaluation-state')).toBeVisible()

    // A derived line shows what the records said, right under its name.
    await expect(page.getByTestId('uat-evaluation-quality')).toContainText(
      /non-conformance/i
    )

    await panel.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/36-subcontractor-evaluation.png` })
  })
})
