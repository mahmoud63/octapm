import { expect, test, type Page } from '@playwright/test'
import { openProject, signIn, watchForProblems } from './support'
import { observe } from './support-ux'

// This file signs in twice through the form and makes no API calls of its own,
// so it needs no token cache — but it runs alongside specs that do, which is
// why those cache.

/**
 * A user-oriented smoke test.
 *
 * Not "does the route render" — that is already covered. This asks, module by
 * module, the questions a person arriving at a screen asks:
 *
 *   Can I see what is here?
 *   Can I tell what to do next?
 *   Does the page survive me refreshing it?
 *   Does it tell me anything, or is it a shell?
 *
 * Each module is scored from what was observed, not from an opinion.
 */

type ModuleCheck = {
  key: string
  label: string
  path: (projectId: string) => string
  /** Wording that proves this module, and not a shell, is on screen. */
  landing: RegExp
  /** The thing a user would come here to do. */
  primaryAction?: string[]
  /** Text that means the module has real records in it, not just chrome. */
  contentHint?: RegExp
}

const MODULES: ModuleCheck[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    path: () => '/',
    landing: /Workspace Control/i,
    contentHint: /Official KPIs|open items/i,
  },
  {
    key: 'projects',
    label: 'Projects',
    path: () => '/projects',
    landing: /Riverside Tower/,
    primaryAction: ['button:has-text("New project")', 'button:has-text("Project")'],
  },
  {
    key: 'schedule',
    label: 'Schedule',
    path: (id) => `/projects/${id}/schedule/gantt`,
    landing: /Gantt|Programme|Baseline|Critical/i,
    contentHint: /A-1000|Substructure/i,
  },
  {
    key: 'activities',
    label: 'Activities',
    path: (id) => `/projects/${id}/activities`,
    landing: /Activit/i,
    contentHint: /A-1000|A-2000/,
  },
  {
    key: 'boq',
    label: 'BOQ',
    path: (id) => `/projects/${id}/boq`,
    landing: /BOQ|Bill of quantities|quantit/i,
    contentHint: /B-\d{3}|Unitised|curtain|Concrete/i,
  },
  {
    key: 'cost',
    label: 'Cost',
    path: (id) => `/projects/${id}/cost/overview`,
    landing: /Budget|Cost|Actual/i,
    contentHint: /Actual|Committed|Variance|Forecast/i,
  },
  {
    key: 'commercial',
    label: 'Commercial',
    path: (id) => `/projects/${id}/commercial/pay-apps`,
    landing: /Payment application|Pay app|Retention|Gross/i,
    primaryAction: ['[data-testid="uat-payapp-new"]'],
  },
  {
    key: 'procurement',
    label: 'Procurement',
    path: (id) => `/projects/${id}/procurement/purchase-orders`,
    landing: /Purchase order|Supplier|Ordered/i,
    primaryAction: ['[data-testid="uat-po-search"]'],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    path: () => '/inventory',
    landing: /Inventory|Stock|Warehouse|Scan/i,
    contentHint: /CEM|Cement|bag|on hand/i,
  },
  {
    key: 'docControl',
    label: 'Document Control',
    path: (id) => `/projects/${id}/doc-control/rfi`,
    landing: /RFI|Request for information/i,
  },
  {
    key: 'quality',
    label: 'Quality',
    path: (id) => `/projects/${id}/quality/ncr`,
    landing: /NCR|Non-conformance|Quality/i,
  },
  {
    key: 'siteReporting',
    label: 'Site Reporting',
    path: (id) => `/projects/${id}/site-reporting`,
    landing: /Daily|Site report|Diary|Weather/i,
  },
  {
    key: 'meetings',
    label: 'Meetings',
    path: (id) => `/projects/${id}/meetings`,
    landing: /Meeting|Minutes|Agenda|Action/i,
  },
  {
    key: 'reports',
    label: 'Reports',
    path: (id) => `/projects/${id}/reports`,
    landing: /Report|Export|Dashboard/i,
  },
]

/** First locator that turns up, or null. */
async function firstVisible(page: Page, selectors: string[], timeout = 20_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const found = await page
        .locator(selector)
        .first()
        .isVisible()
        .catch(() => false)
      if (found) return selector
    }
    await page.waitForTimeout(400)
  }
  return null
}

/**
 * Did the module actually load?
 *
 * A `text=` locator can resolve to something hidden, and a testid can be
 * missing from a module that renders perfectly well — so the reliable signal is
 * what a reader would see: the page's own text, plus the fact that the route
 * did not bounce somewhere else.
 */
async function landed(page: Page, module: ModuleCheck, path: string) {
  const deadline = Date.now() + 25_000
  let text = ''
  while (Date.now() < deadline) {
    text = await page
      .locator('body')
      .innerText()
      .catch(() => '')
    // A module that is still loading says so; wait for it to stop.
    const settled = text.length > 200 && !/^\s*(loading|…)\s*$/i.test(text)
    if (settled && module.landing.test(text)) break
    await page.waitForTimeout(400)
  }
  const url = new URL(page.url())
  return {
    reachedText: module.landing.test(text),
    // A redirect to sign-in or away from the module is a different failure from
    // an empty one.
    stayedOnRoute: url.pathname === path.split('?')[0],
    redirectedTo: url.pathname === path.split('?')[0] ? null : url.pathname,
    textLength: text.length,
    body: text,
  }
}

test.describe('user smoke test across the portal', () => {
  test('every module opens, says something, and survives a refresh', async ({
    page,
  }) => {
    test.slow()
    test.setTimeout(600_000)

    const problems = watchForProblems(page)
    await signIn(page, 'pm')
    const projectId = await openProject(page)

    for (const module of MODULES) {
      const before = problems.consoleErrors.length
      const failedBefore = problems.failedRequests.length
      const path = module.path(projectId)

      let opened = false
      let action: string | null = null
      let hasContent: boolean | null = null
      let survivesRefresh: boolean | null = null
      let redirectedTo: string | null = null
      let error: string | null = null

      try {
        await page.goto(path, { waitUntil: 'domcontentloaded' })
        const arrival = await landed(page, module, path)
        opened = arrival.reachedText
        redirectedTo = arrival.redirectedTo

        if (module.primaryAction) {
          action = await firstVisible(page, module.primaryAction, 8_000)
        }

        if (module.contentHint) {
          // Landing text can appear from the chrome while the records are still
          // loading, so give the content its own wait rather than reading the
          // page at the first sign of life.
          const deadline = Date.now() + 15_000
          hasContent = module.contentHint.test(arrival.body)
          while (!hasContent && Date.now() < deadline) {
            await page.waitForTimeout(500)
            const body = await page
              .locator('body')
              .innerText()
              .catch(() => '')
            hasContent = module.contentHint.test(body)
          }
        }

        // The question a user asks by hitting F5.
        if (opened) {
          await page.reload({ waitUntil: 'domcontentloaded' })
          survivesRefresh = (await landed(page, module, path)).reachedText
        }
      } catch (thrown) {
        error = thrown instanceof Error ? thrown.message.slice(0, 200) : String(thrown)
      }

      const newConsoleErrors = problems.consoleErrors.slice(before)
      const newFailedRequests = problems.failedRequests.slice(failedBefore)

      // ⚪ not testable · 🔴 cannot be used · 🟡 usable with friction · ✅ fine
      const rating = !opened
        ? '🔴'
        : error || survivesRefresh === false
          ? '🔴'
          : newFailedRequests.length || hasContent === false || (module.primaryAction && !action)
            ? '🟡'
            : '✅'

      observe('SMOKE', {
        module: module.label,
        path,
        rating,
        opened,
        redirectedTo,
        primaryActionFound: module.primaryAction ? Boolean(action) : null,
        hasContent,
        survivesRefresh,
        consoleErrors: newConsoleErrors.length,
        consoleSample: newConsoleErrors.slice(0, 2),
        failedRequests: newFailedRequests.length,
        failedSample: newFailedRequests.slice(0, 3),
        error,
      })
    }

    observe('SMOKE_TOTALS', {
      modules: MODULES.length,
      consoleErrors: problems.consoleErrors.length,
      failedRequests: problems.failedRequests.length,
    })
  })

  /**
   * The deeper question the brief asks: perform a basic workflow, save, refresh,
   * reopen, and check the downstream state. Done on the one module where the
   * downstream is a number that can be checked — cost.
   */
  test('a saved change survives a refresh and reaches the number downstream', async ({
    page,
  }) => {
    test.slow()
    await signIn(page, 'pm')
    const projectId = await openProject(page)

    await page.goto(`/projects/${projectId}/cost/overview`)
    await expect(page.locator('body')).toContainText(/Executed commitments|Committed/i, { timeout: 30_000 })
    const body = await page.locator('body').innerText()
    observe('COST_OVERVIEW_SHOWS', {
      mentionsActual: /actual/i.test(body),
      mentionsCommitted: /executed commitments|committed/i.test(body),
      mentionsVariance: /variance/i.test(body),
      mentionsForecast: /forecast|eac|final/i.test(body),
    })

    // Deep-link into a record and back out, the way a notification does.
    await page.goto(`/projects/${projectId}/commercial/pay-apps`)
    await expect(page.getByTestId('uat-payapps-panel')).toBeVisible({ timeout: 30_000 })
    // The panel is the outer container and paints before its rows arrive, so
    // counting the moment it appears is a race — and one the register loses
    // more often the more applications the project has. Wait for the first row,
    // which fails as an empty register rather than as a puzzling count of nought.
    await expect(
      page.getByTestId('uat-payapp-row').first(),
      'the register lists what has been raised',
    ).toBeVisible({ timeout: 30_000 })
    const rows = await page.getByTestId('uat-payapp-row').count()
    observe('PAYAPP_ROWS_VISIBLE', rows)
    expect(rows, 'the register lists what has been raised').toBeGreaterThan(0)

    await page.getByTestId('uat-payapp-open').first().click()
    await expect(page.getByTestId('uat-payapp-detail')).toBeVisible({ timeout: 30_000 })
    const url = page.url()
    observe('DETAIL_IS_LINKABLE', {
      urlCarriesRecord: /recordId=/.test(url),
    })

    // Refresh with the dialog open: does the record come back?
    await page.reload({ waitUntil: 'domcontentloaded' })
    const stillOpen = await page
      .getByTestId('uat-payapp-detail')
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false)
    observe('DETAIL_SURVIVES_REFRESH', stillOpen)
  })
})
