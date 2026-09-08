import { test, expect } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, signIn } from './support'
import { cachedToken, observe } from './support-ux'

/** One signed-in API context per call, closed afterwards. */
async function withApi<T>(
  fn: (client: Awaited<ReturnType<typeof apiClient>>, token: string) => Promise<T>,
): Promise<T> {
  const client = await apiClient()
  try {
    const token = await cachedToken('pm-spine', () => apiToken(client, 'pm'))
    return await fn(client, token)
  } finally {
    await client.dispose()
  }
}

const post = async (
  client: Awaited<ReturnType<typeof apiClient>>,
  path: string,
  token: string,
  data: unknown,
) => {
  const response = await client.post(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    data,
  })
  // Keep the body even when it failed — a refusal that says why is the most
  // useful thing a set-up step can hand back when it goes wrong.
  let body: { data?: unknown; error?: { code?: string; message?: string } } | null = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  return { status: response.status(), body, error: body?.error }
}

/**
 * The bill and the programme, on one activity.
 *
 * A project that already has a schedule — imported from P6, as most real ones
 * are — used to grow a second, shadow one the moment anybody typed a bill row:
 * zero-duration stubs holding the money beside the real activities holding the
 * logic. This drives the screen where that choice is now made explicitly.
 *
 * The programme is imported through the API rather than the import wizard: the
 * wizard has its own coverage, and what is under test here is what the planner
 * and the QS see in the BOQ afterwards.
 */

const readBack = async <T>(path: string): Promise<T> =>
  withApi(async (client, token) => (await apiGet(client, path, token)).body?.data)

async function seedProjectWithProgramme(stamp: string) {
  return withApi(async (client, token) => {
    const project = (
      await post(client, '/projects', token, {
        name: `Spine UI ${stamp}`,
        code: `SU-${stamp}`,
        startDate: '2027-01-04',
        endDate: '2027-12-17',
        currency: 'USD',
        contractValue: 2_000_000,
      })
    ).body.data

    const xer = [
      'ERMHDR\t19.12\t2027-01-04\tProject\tadmin\tadmin\tdb\tPM\tUSD',
      '%T\tPROJWBS',
      '%F\twbs_id\tproj_id\twbs_short_name\twbs_name\tparent_wbs_id',
      '%R\t100\t1\tST\tStructure\t',
      '%T\tTASK',
      '%F\ttask_id\tproj_id\twbs_id\ttask_code\ttask_name\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tphys_complete_pct\ttotal_float_hr_cnt\tclndr_id',
      '%R\t3001\t1\t100\tU-100\tFoundations\t160\t160\t0\t0\t1',
      '%R\t3002\t1\t100\tU-200\tSuperstructure\t120\t120\t0\t0\t1',
      // A programme of more than one activity has to say how they relate, or
      // schedule readiness refuses the revision — correctly, since a schedule
      // without logic has no critical path to compute.
      '%T\tTASKPRED',
      '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt',
      '%R\t1\t3002\t3001\tPR_FS\t0',
      '%E',
    ].join('\n')

    const upload = await client.post(
      `http://localhost:5000/api/v1/projects/${project.id}/import/xer`,
      {
        headers: { authorization: `Bearer ${token}` },
        multipart: {
          file: {
            name: `programme-${stamp}.xer`,
            mimeType: 'text/plain',
            buffer: Buffer.from(xer),
          },
        },
      },
    )
    const revisionId = (await upload.json()).data.revisionId

    const base = `/projects/${project.id}/schedule/revisions/${revisionId}`
    const review = await post(client, `${base}/submit-review`, token, {})
    const approve = await post(client, `${base}/approve`, token, {})
    const activate = await post(client, `${base}/activate`, token, {
      mappings: [],
      comment: 'ui spine',
    })
    observe('IMPORT_LIFECYCLE', {
      upload: upload.status(),
      revisionId,
      review: review.status,
      approve: `${approve.status} ${approve.error?.code ?? ''} ${approve.error?.message ?? ''}`.trim(),
      activate: `${activate.status} ${activate.error?.code ?? ''} ${activate.error?.message ?? ''}`.trim(),
    })

    const activities = (
      await apiGet(client, `/projects/${project.id}/activities?limit=200`, token)
    ).body.data
    return { project, activities: activities?.items ?? activities ?? [] }
  })
}

test.describe('the bill and the programme meet on one activity', () => {
  test('a planner puts a bill row onto the activity that is already there', async ({
    page,
  }) => {
    test.slow()
    const stamp = Date.now().toString(36)
    const { project, activities } = await seedProjectWithProgramme(stamp)
    expect(activities.length, 'the imported programme is live').toBe(2)
    const foundations = activities.find(
      (a: { p6ActivityId: string }) => a.p6ActivityId === 'U-100',
    )
    observe('PROGRAMME_BEFORE_BILL', {
      count: activities.length,
      codes: activities.map((a: { p6ActivityId: string }) => a.p6ActivityId),
    })

    await signIn(page, 'pm')
    await page.goto(`/projects/${project.id}/boq`)
    await page.getByTestId('uat-boq-add-row').click()
    // The page behind the dialog has its own labelled fields, so everything
    // typed here is scoped to the dialog.
    const dialog = page.getByRole('dialog')

    // The choice is on the screen, not implied. And on a project that already
    // has a programme, attaching to it is what the dialog opens on.
    const useExisting = page.getByTestId('uat-boq-activity-existing')
    await expect(useExisting).toBeVisible({ timeout: 15_000 })
    await expect(useExisting).toBeChecked()
    observe('ACTIVITY_CHOICE_OFFERED', {
      existing: await page.getByTestId('uat-boq-activity-existing').isVisible(),
      createNew: await page.getByTestId('uat-boq-activity-new').isVisible(),
      decideLater: await page.getByTestId('uat-boq-activity-later').isVisible(),
      defaultsToExisting: true,
    })

    await dialog.getByLabel('Code').fill(`UI-${stamp}`)
    await dialog.getByLabel('Unit').fill('m3')
    await dialog.getByLabel('Description').fill('Concrete to foundations')
    await dialog.getByLabel('Quantity').fill('500')
    await dialog.getByLabel('Rate').fill('320')

    await page.getByTestId('uat-boq-activity-select').click()
    await page.getByRole('option', { name: /U-100/ }).click()

    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().endsWith('/boq/items'),
        { timeout: 30_000 },
      ),
      page.getByTestId('uat-boq-add-row-submit').click(),
    ])

    // The programme must be exactly as it was: no stub minted beside U-100.
    const after = await readBack<{ items?: unknown[] }>(
      `/projects/${project.id}/activities?limit=200`,
    )
    const rows = (after as { items?: unknown[] })?.items ?? (after as unknown[]) ?? []
    observe('PROGRAMME_AFTER_BILL', {
      count: rows.length,
      codes: rows.map((a: { p6ActivityId: string }) => a.p6ActivityId),
    })
    expect(rows.length, 'no shadow activity was created for the bill row').toBe(2)

    const allocations = await readBack<{ allocations?: Record<string, never>[] }>(
      `/projects/${project.id}/activity-boq-allocations`,
    )
    const allocation = (allocations?.allocations ?? [])[0] as
      | Record<string, never>
      | undefined
    observe('ALLOCATION_AFTER_BILL', {
      activityId: allocation?.activityId,
      shownAs: allocation?.activity?.activityId,
      p6ActivityId: allocation?.activity?.p6ActivityId,
      activityCode: allocation?.activity?.activityCode,
      amount: allocation?.amount,
    })
    expect(
      allocation?.activityId,
      'the bill row is attached to the imported activity itself',
    ).toBe(foundations.id)
    // Both identifiers stay distinguishable, which is what lets a person
    // reconcile a bill against a P6 programme.
    expect(allocation?.activity?.p6ActivityId).toBe('U-100')
    expect(allocation?.activity?.activityCode).toBeNull()
  })

  test('a project with no programme can still let the bill create one', async ({
    page,
  }) => {
    test.slow()
    const stamp = Date.now().toString(36)
    const created = await withApi(async (client, token) =>
      post(client, '/projects', token, {
        name: `Greenfield UI ${stamp}`,
        code: `GU-${stamp}`,
        startDate: '2027-01-04',
        endDate: '2027-12-17',
        currency: 'USD',
        contractValue: 500_000,
      }),
    )
    expect(
      created.status,
      `creating the project: ${created.error?.code ?? ''} ${created.error?.message ?? ''}`,
    ).toBeLessThan(300)
    const project = created.body.data as { id: string }

    await signIn(page, 'pm')
    await page.goto(`/projects/${project.id}/boq`)
    await page.getByTestId('uat-boq-add-row').click()
    // The page behind the dialog has its own labelled fields, so everything
    // typed here is scoped to the dialog.
    const dialog = page.getByRole('dialog')

    // With nothing to attach to, the dialog says so rather than offering an
    // empty list, and opens on creating one.
    const existing = page.getByTestId('uat-boq-activity-existing')
    await expect(existing).toBeVisible({ timeout: 15_000 })
    await expect(existing).toBeDisabled()
    await expect(page.getByTestId('uat-boq-activity-new')).toBeChecked()
    observe('GREENFIELD_CHOICE', {
      existingOfferedButDisabled: true,
      defaultsToCreating: true,
    })

    await dialog.getByLabel('Code').fill(`GF-${stamp}`)
    await dialog.getByLabel('Unit').fill('m2')
    await dialog.getByLabel('Description').fill('Blockwork, 100mm')
    await dialog.getByLabel('Quantity').fill('200')
    await dialog.getByLabel('Rate').fill('55')
    await page.getByTestId('uat-boq-activity-name').fill('Blockwork')

    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().endsWith('/boq/items'),
        { timeout: 30_000 },
      ),
      page.getByTestId('uat-boq-add-row-submit').click(),
    ])

    const after = await readBack<{ items?: { name: string }[] }>(
      `/projects/${project.id}/activities?limit=200`,
    )
    const rows = after?.items ?? (after as unknown as { name: string }[]) ?? []
    observe('GREENFIELD_AFTER_BILL', {
      count: rows.length,
      names: rows.map((a: { name: string }) => a.name),
    })
    expect(rows.length, 'the bill row created the activity it needed').toBe(1)
    expect(rows[0].name).toBe('Blockwork')
  })
})
