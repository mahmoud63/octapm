import { expect, test, type APIRequestContext } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, openProject, SHOTS, signIn } from './support'

/**
 * The scope and responsibility matrix.
 *
 * The rule worth defending is that a matrix cannot be agreed with holes in it.
 * Agreeing a scope where nobody owns the crane is agreeing to argue about the
 * crane later, and the point of the screen is to make that impossible to do by
 * accident.
 */

async function withApi<T>(fn: (client: APIRequestContext, token: string) => Promise<T>) {
  const client = await apiClient()
  try {
    return await fn(client, await apiToken(client, 'pm'))
  } finally {
    await client.dispose()
  }
}

/** A subcontract to hang a matrix on: the first one on the project. */
async function subcontractId(projectId: string) {
  return withApi(async (client, token) => {
    const { body } = await apiGet(client, `/projects/${projectId}/commitments`, token)
    const data = body?.data
    const rows = Array.isArray(data) ? data : (data?.items ?? [])
    const subcontract = rows.find(
      (row: { type: string }) => row.type === 'subcontract',
    )
    return subcontract?.id ?? null
  })
}

const scopePath = (projectId: string, commitmentId: string) =>
  `/projects/${projectId}/commitments/${commitmentId}/scope`

async function readScope(projectId: string, commitmentId: string) {
  return withApi(async (client, token) => {
    const { body } = await apiGet(client, scopePath(projectId, commitmentId), token)
    return body.data
  })
}

async function putScope(projectId: string, commitmentId: string, items: unknown[]) {
  return withApi(async (client, token) => {
    const response = await client.put(`${API}${scopePath(projectId, commitmentId)}`, {
      headers: { authorization: `Bearer ${token}` },
      data: { items },
    })
    return { status: response.status(), body: await response.json() }
  })
}

async function decide(projectId: string, commitmentId: string, action: string, data = {}) {
  return withApi(async (client, token) => {
    const response = await client.post(`${API}${scopePath(projectId, commitmentId)}/${action}`, {
      headers: { authorization: `Bearer ${token}` },
      data,
    })
    return { status: response.status(), body: await response.json() }
  })
}

/**
 * A subcontract of its own, so the "first read seeds the starter rows" test
 * does not depend on a matrix earlier tests have already rewritten.
 */
async function freshSubcontract(projectId: string) {
  return withApi(async (client, token) => {
    const response = await client.post(`${API}/projects/${projectId}/commitments`, {
      headers: { authorization: `Bearer ${token}` },
      data: { type: 'subcontract', title: 'Scope matrix fixture', retentionRate: 5 },
    })
    expect(response.status(), await response.text()).toBe(201)
    const created = (await response.json()).data
    return { id: created.id as string, ref: created.ref as string }
  })
}

test.describe('scope and responsibility', () => {
  test('a new matrix opens with the rows that cause arguments already asked', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const { id: commitmentId } = await freshSubcontract(projectId)

    const matrix = await readScope(projectId, commitmentId)

    const descriptions = matrix.items.map((item: { description: string }) => item.description)
    for (const row of [
      'Crane and lifting',
      'Daily cleanup',
      'Waste removal from site',
      'Inspection requests',
    ]) {
      expect(descriptions).toContain(row)
    }

    // Every one of them starts unowned, so the question is asked rather than
    // assumed by whoever wrote the contract.
    expect(matrix.summary.unallocated).toBe(matrix.summary.allocated + matrix.summary.unallocated)
    expect(matrix.summary.allocated).toBe(0)
  })

  test('it cannot be agreed while any row of work is unowned, and says which', async ({
    page,
  }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const commitmentId = await subcontractId(projectId)
    test.skip(!commitmentId, 'no subcontract on this project')

    await putScope(projectId, commitmentId!, [
      { kind: 'scope', description: 'Installation', responsibility: 'subcontractor' },
      { kind: 'scope', description: 'Crane and lifting' },
    ])

    const refused = await decide(projectId, commitmentId!, 'agree')
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe('SCOPE_MATRIX_INCOMPLETE')
    // Named, so it can be fixed rather than hunted for.
    expect(refused.body.error.details.rows).toContain('Crane and lifting')
  })

  test('a statement is not work, so it never blocks agreement', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const commitmentId = await subcontractId(projectId)
    test.skip(!commitmentId, 'no subcontract on this project')

    await putScope(projectId, commitmentId!, [
      { kind: 'scope', description: 'Installation', responsibility: 'subcontractor' },
      { kind: 'exclusion', description: 'Painting is excluded' },
      { kind: 'clarification', description: 'Rates assume daytime working' },
      { kind: 'interface', description: 'Coordinate penetrations with M&E' },
    ])

    const agreed = await decide(projectId, commitmentId!, 'agree')
    expect(agreed.status).toBe(200)
    expect(agreed.body.data.status).toBe('agreed')
  })

  test('an agreed matrix is locked, and reopening it needs a reason', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const commitmentId = await subcontractId(projectId)
    test.skip(!commitmentId, 'no subcontract on this project')

    // Left agreed by the previous test; make sure of it either way.
    if ((await readScope(projectId, commitmentId!)).status !== 'agreed') {
      await putScope(projectId, commitmentId!, [
        { kind: 'scope', description: 'Installation', responsibility: 'subcontractor' },
      ])
      await decide(projectId, commitmentId!, 'agree')
    }

    const edit = await putScope(projectId, commitmentId!, [
      { kind: 'scope', description: 'Something new', responsibility: 'gc' },
    ])
    expect(edit.status).toBe(409)
    expect(edit.body.error.code).toBe('SCOPE_MATRIX_AGREED')

    const bare = await decide(projectId, commitmentId!, 'reopen')
    expect(bare.status).toBe(400)
    expect(bare.body.error.code).toBe('SCOPE_REOPEN_REASON_REQUIRED')

    const reopened = await decide(projectId, commitmentId!, 'reopen', {
      reason: 'Client moved the crane provision',
    })
    expect(reopened.status).toBe(200)
    expect(reopened.body.data.status).toBe('draft')
  })

  test('the matrix reads as a matrix on screen, with a party per row', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)

    // Its own commitment: the earlier tests all mutate the seeded one, and the
    // app's offline cache can serve a stale read of a URL that has already
    // been fetched. A brand-new matrix has neither problem.
    const { id: commitmentId, ref } = await freshSubcontract(projectId)

    const written = await putScope(projectId, commitmentId, [
      { kind: 'scope', section: 'Works', description: 'Crane and lifting', responsibility: 'gc' },
      { kind: 'scope', section: 'Site', description: 'Daily cleanup' },
      { kind: 'responsibility', section: 'Submittals', description: 'Shop drawings', responsibility: 'subcontractor' },
      { kind: 'exclusion', description: 'Painting is excluded' },
    ])
    expect(written.status, JSON.stringify(written.body)).toBe(200)

    await page.goto(`/projects/${projectId}/commercial/commitments`)

    // The reference also appears in the history feed below the register, so
    // find the register's own row rather than the text.
    const row = page.getByRole('row', { name: new RegExp(ref) })
    await expect(row).toBeVisible({ timeout: 30_000 })

    // A commitment opens from a button on its row, not a row click — and
    // "Open" also names a control in the page header.
    await row.getByRole('button', { name: 'Open' }).click()

    const matrix = page.getByTestId('uat-scope-matrix')
    await expect(matrix).toBeVisible({ timeout: 20_000 })

    // The row carries its description as an attribute, because on screen it
    // lives in an input while the matrix is a draft and in a cell once agreed.
    for (const row of ['Crane and lifting', 'Daily cleanup', 'Shop drawings', 'Painting is excluded']) {
      await expect(matrix.locator(`tr[data-scope-row="${row}"]`)).toHaveCount(1)
    }

    // Each of the five parties is a column, and the row shows which one owns it.
    const craneRow = matrix.locator('tr[data-scope-row="Crane and lifting"]')
    await expect(craneRow.locator('input[type="radio"]')).toHaveCount(5)
    await expect(craneRow.locator('input[type="radio"]').first()).toBeChecked()

    // The unallocated count is the thing that must be impossible to miss.
    await expect(page.getByTestId('uat-scope-unallocated')).toContainText('1 unallocated')

    await page.screenshot({ path: `${SHOTS}/32-scope-matrix.png`, fullPage: true })
  })
})
