import { test, expect } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, openProject, signIn } from './support'
import { cachedToken, observe } from './support-ux'

/**
 * A late delivery, said out loud on the programme.
 *
 * The risk engine has always worked out that a package cannot be ordered and
 * still arrive in time, and the activity has always carried the number of
 * days. The schedule showed the word "critical" and kept the figure to
 * itself, and the tooltip read "Order By Missed" — a database column with the
 * underscores taken out (OCTA-UX-SCHEDRISK-101).
 *
 * Nothing here moves a date. A late delivery is a warning to a planner, not a
 * licence for the system to reschedule the job behind their back.
 */
test('a package that cannot arrive in time says so on the programme', async ({ page }) => {
  test.slow()
  await signIn(page, 'pm')
  const projectId = await openProject(page)
  const stamp = Date.now().toString(36)

  // A requirement needed on site in the past, with a twelve-week lead time:
  // no possible order date works.
  const client = await apiClient()
  let activityId: string
  try {
    const token = await cachedToken('sched-risk', () => apiToken(client, 'pm'))
    const activities = (await apiGet(client, `/projects/${projectId}/activities`, token)).body
      .data
    const activity = (activities.items ?? activities)[0]
    activityId = activity.id
    const created = await client.post(
      `${API}/projects/${projectId}/procurement/packages`,
      {
        headers: { authorization: `Bearer ${token}` },
        data: {
          packageNumber: `PK-LATE-${stamp}`,
          title: 'Structural steel, ordered too late',
          activityId,
          requiredOnSiteDate: '2026-08-01',
          leadWeeks: 12,
        },
      },
    )
    expect(created.status(), 'the late requirement is recorded').toBeLessThan(300)

    const schedule = (await apiGet(client, `/projects/${projectId}/schedule`, token)).body.data
    const risky = (schedule.activities ?? []).find((row: any) => row.id === activityId)
    observe('SCHEDULE_PROCUREMENT_RISK', {
      activity: risky?.activityCode,
      severity: risky?.procurementRiskSummary?.highestSeverity,
      daysAtRisk: risky?.procurementRiskSummary?.daysAtRisk,
      reason: risky?.procurementRiskSummary?.reason,
    })
    expect(risky?.procurementRiskSummary?.daysAtRisk, 'the programme knows how late').toBeGreaterThan(0)
  } finally {
    await client.dispose()
  }

  await page.goto(`/projects/${projectId}/schedule/activities`)
  const cell = page.getByTestId(`uat-proc-risk-${activityId}`)
  await expect(cell).toBeVisible({ timeout: 30_000 })
  const shown = (await cell.innerText()).replace(/\s+/g, ' ').trim()
  observe('SCHEDULE_RISK_CELL', shown)

  // How late, not just how worried.
  expect(shown, 'the cell says how many days late').toMatch(/\d+d late/)

  // And the explanation is a sentence, not a column name.
  const tooltip = await cell.locator('xpath=ancestor::*[@title][1]').getAttribute('title')
  observe('SCHEDULE_RISK_TOOLTIP', tooltip)
  expect(tooltip, 'the reason is in English').not.toMatch(/_/)
  expect(tooltip, 'and it explains itself').toMatch(/order|deliver|arrive|linked/i)

  // The dates themselves are untouched: a warning, not a reschedule.
  const client2 = await apiClient()
  try {
    const token = await cachedToken('sched-risk', () => apiToken(client2, 'pm'))
    const after = (await apiGet(client2, `/projects/${projectId}/schedule`, token)).body.data
    const row = (after.activities ?? []).find((a: any) => a.id === activityId)
    expect(row.earlyStart, 'the risk did not move the activity').toBeDefined()
    observe('SCHEDULE_UNCHANGED_BY_RISK', {
      earlyStart: row.earlyStart,
      earlyFinish: row.earlyFinish,
    })
  } finally {
    await client2.dispose()
  }
})
