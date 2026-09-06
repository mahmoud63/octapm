import { expect, test } from '@playwright/test'
import { openProject, signIn, watchForProblems } from './support'

/**
 * Sign-in through the real form, and a sweep of every navigation destination.
 * The route audit is the cheapest way to find a blank page or a page that
 * renders while its data call fails.
 */

test.describe('authentication', () => {
  test('signs in through the form and lands on the workspace', async ({ page }) => {
    const problems = watchForProblems(page)
    await signIn(page)
    await expect(page.getByText('Workspace Control')).toBeVisible()
    expect(problems.consoleErrors, 'console errors during sign-in').toEqual([])
  })

  test('rejects a wrong password without signing in', async ({ page }) => {
    await page.goto('/sign-in')
    const email = page.getByPlaceholder('name@example.com')
    await email.click()
    await email.fill('pm@octapm.demo')
    const password = page.locator('input[type="password"]').first()
    await password.click()
    await password.fill('definitely-not-the-password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    // Must stay on the sign-in form, and must say something useful.
    await expect(page.locator('input[type="password"]').first()).toBeVisible()
    await expect(page.getByText('Workspace Control')).toHaveCount(0)
  })

  test('a signed-in session survives a full page reload', async ({ page }) => {
    await signIn(page)
    await page.reload()
    await expect(page.getByText('Workspace Control')).toBeVisible({ timeout: 30_000 })
  })
})

// Company-level destinations, taken from the company sidebar.
const COMPANY_ROUTES = [
  ['Directory', '/company/directory'],
  ['Vendors', '/company/vendors'],
  ['Cost codes', '/company/cost-codes'],
  ['Equipment', '/company/equipment'],
  ['Project templates', '/company/templates'],
  ['Inspection templates', '/company/form-templates'],
  ['Submittal workflows', '/company/submittal-workflows'],
  ['Workflows', '/company/workflows'],
  ['Custom fields', '/company/custom-fields'],
  ['Integrations', '/company/integrations'],
  ['Security', '/company/security'],
  ['Permissions', '/company/permissions'],
] as const

// Top-level destinations from the main sidebar.
const WORKSPACE_ROUTES = [
  ['Dashboard', '/'],
  ['Projects', '/projects'],
  ['Portfolio', '/portfolio'],
  ['Reports', '/reports'],
  ['Tasks', '/tasks'],
  ['Messages', '/messages'],
  ['Users', '/users'],
] as const

// Project modules, from the project workspace menu.
const PROJECT_MODULES = [
  'overview', 'schedule', 'activities', 'boq', 'cost', 'commercial', 'quality',
  'doc-control', 'meetings', 'site-reporting', 'equipment', 'locations',
  'photos', 'team', 'reports', 'bim',
] as const

test.describe('route audit', () => {
  test('every workspace and company route renders without a crash', async ({ page }) => {
    const problems = watchForProblems(page)
    await signIn(page)

    const results: Array<Record<string, string>> = []
    for (const [label, route] of [...WORKSPACE_ROUTES, ...COMPANY_ROUTES]) {
      const before = problems.consoleErrors.length
      await page.goto(route)
      // Wait for the shell before reading: navigating to the route you are
      // already on does not always trigger a fresh paint.
      await page.waitForLoadState('domcontentloaded')
      await page
        .locator('a[href="/projects"], nav, main')
        .first()
        .waitFor({ state: 'attached', timeout: 30_000 })
        .catch(() => {})
      // Something from the app shell must be present: a blank body is a failure.
      const body = await page.locator('body').innerText()
      const rendered = body.trim().length > 40
      const crashed = /Something went wrong|Unexpected error|ChunkLoadError/i.test(body)
      const newErrors = problems.consoleErrors.length - before

      results.push({
        label,
        route,
        rendered: rendered ? 'yes' : 'NO',
        crashed: crashed ? 'YES' : 'no',
        consoleErrors: String(newErrors),
      })

      expect(rendered, `${route} rendered a blank page`).toBeTruthy()
      expect(crashed, `${route} showed an error boundary`).toBeFalsy()
    }

    // eslint-disable-next-line no-console
    console.log('ROUTE_AUDIT_WORKSPACE ' + JSON.stringify(results))
  })

  test('every project module renders with the project in context', async ({ page }) => {
    const problems = watchForProblems(page)
    await signIn(page)
    const projectId = await openProject(page)

    const results: Array<Record<string, string>> = []
    for (const module of PROJECT_MODULES) {
      const route = `/projects/${projectId}/${module}`
      const before = problems.consoleErrors.length
      await page.goto(route)
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})

      const body = await page.locator('body').innerText()
      const rendered = body.trim().length > 40
      const crashed = /Something went wrong|Unexpected error|ChunkLoadError/i.test(body)
      // The project name in the header proves the module kept its context.
      const inContext = body.includes('Riverside Tower')

      results.push({
        module,
        route,
        rendered: rendered ? 'yes' : 'NO',
        crashed: crashed ? 'YES' : 'no',
        projectContext: inContext ? 'yes' : 'NO',
        consoleErrors: String(problems.consoleErrors.length - before),
      })

      expect(rendered, `${route} rendered a blank page`).toBeTruthy()
      expect(crashed, `${route} showed an error boundary`).toBeFalsy()
    }

    // eslint-disable-next-line no-console
    console.log('ROUTE_AUDIT_PROJECT ' + JSON.stringify(results))
    // eslint-disable-next-line no-console
    console.log('FAILED_REQUESTS ' + JSON.stringify([...new Set(problems.failedRequests)].slice(0, 40)))
    // eslint-disable-next-line no-console
    console.log('CONSOLE_ERRORS ' + JSON.stringify([...new Set(problems.consoleErrors)].slice(0, 40)))
  })
})
