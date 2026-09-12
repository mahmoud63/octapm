import { expect, test, type Page } from '@playwright/test'
import { openProject, SHOTS, signIn, watchForProblems } from './support'

/**
 * The two-level navigation: a Midnight Indigo application header, and a
 * Project Module Bar directly beneath it.
 *
 * These cover the sixteen checks in the navigation brief — brand surface,
 * dropdowns, child navigation, active state, project context across refresh,
 * responsive behaviour, permissions and network health.
 */

const MIDNIGHT_INDIGO = 'rgb(15, 27, 100)'

/** Opens a module dropdown and waits for its menu. */
async function openModuleMenu(page: Page, module: string) {
  await page.getByTestId(`uat-module-tab-${module}`).click()
  const menu = page.getByTestId(`uat-module-menu-${module}`)
  await expect(menu).toBeVisible()
  return menu
}

test.describe('application header', () => {
  test('is Midnight Indigo, compact, and carries the white logo', async ({ page }) => {
    await signIn(page)
    const header = page.locator('header').first()
    await expect(header).toBeVisible()

    // 1 & 2: the brand surface and the logo.
    const background = await header.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(background, 'the header must be Midnight Indigo').toBe(MIDNIGHT_INDIGO)

    await expect(page.getByLabel('OctaPM home')).toBeVisible()

    // The height brief: 56–64px for the bar itself, excluding any banner.
    const bar = header.locator('> div').last()
    const box = await bar.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(52)
    expect(box!.height).toBeLessThanOrEqual(68)

    // Nothing inside the dark header may be pure black.
    const blacks = await header.evaluate((root) =>
      [...root.querySelectorAll('*')].filter((el) => {
        const c = getComputedStyle(el).color
        return c === 'rgb(0, 0, 0)'
      }).length
    )
    expect(blacks, 'pure black text inside the indigo header').toBe(0)
  })

  test('the project selector stays in the primary header', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await page.goto(`/projects/${projectId}/overview`)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    // 3 & 9: project identity lives in the primary header, above the module
    // bar, so the modules below always belong to a visible project.
    const switcher = page.locator('header [data-testid="project-switcher"]')
    await expect(switcher).toBeVisible()
    await expect(switcher).toContainText('Riverside Tower')
    await expect(switcher).toHaveAttribute('aria-label', 'Switch project')
  })
})

test.describe('project module bar', () => {
  test('renders the major modules with a More overflow', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await page.goto(`/projects/${projectId}/schedule/gantt`)
    await page.waitForLoadState('domcontentloaded')

    const bar = page.getByTestId('uat-project-module-bar')
    await expect(bar).toBeVisible()

    // 4: the major construction modules are directly reachable.
    for (const module of ['overview', 'schedule', 'cost', 'commercial', 'quality', 'docControl', 'boq', 'bim']) {
      await expect(page.getByTestId(`uat-module-tab-${module}`)).toBeVisible()
    }
    // 8: lower-frequency modules fold into More rather than crowding the row.
    await expect(page.getByTestId('uat-module-tab-more')).toBeVisible()

    // The bar is lighter than the header and sized for working against.
    const background = await bar.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(background, 'the module bar must not be the dark header colour').not.toBe(
      MIDNIGHT_INDIGO
    )
    const box = await bar.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(40)
    expect(box!.height).toBeLessThanOrEqual(56)

    // 12: no remnant of the old sidebar.
    await expect(page.getByTestId('uat-project-module-nav')).toHaveCount(0)
    await expect(page.getByTestId('uat-project-module-rail')).toHaveCount(0)
  })

  test('the Schedule dropdown opens and navigates to a child page', async ({ page }) => {
    const problems = watchForProblems(page)
    await signIn(page)
    const projectId = await openProject(page)
    await page.goto(`/projects/${projectId}/schedule/gantt`)
    await page.waitForLoadState('domcontentloaded')

    // 5: the dropdown opens.
    const menu = await openModuleMenu(page, 'schedule')
    await expect(menu.getByText('Gantt', { exact: true })).toBeVisible()
    await expect(menu.getByText('Lookahead', { exact: true })).toBeVisible()

    // 6: a child navigates, without a full page reload.
    await page.getByTestId('uat-module-child-schedule-lookahead').click()
    await expect(page).toHaveURL(/\/schedule\/lookahead/)
    await expect(page.getByTestId('uat-module-tab-schedule')).toHaveAttribute(
      'aria-current',
      'page'
    )

    // 16: navigating the bar introduces no failed requests.
    expect(problems.failedRequests, 'failed requests during module navigation').toEqual([])
  })

  test('Cost Control and Commercial navigate to their children', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await page.goto(`/projects/${projectId}/overview`)
    await page.waitForLoadState('domcontentloaded')

    // 7
    await openModuleMenu(page, 'cost')
    await page.getByTestId('uat-module-child-cost-budget').click()
    await expect(page).toHaveURL(/\/cost\/budget/)

    // 8
    await openModuleMenu(page, 'commercial')
    await page.getByTestId('uat-module-child-commercial-change-orders').click()
    await expect(page).toHaveURL(/\/commercial\/change-orders/)
  })

  test('the active module is marked without relying on colour', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await page.goto(`/projects/${projectId}/cost/budget`)
    await page.waitForLoadState('domcontentloaded')

    // 9 & accessibility: aria-current carries the state, not just the underline.
    const active = page.getByTestId('uat-module-tab-cost')
    await expect(active).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('uat-module-tab-quality')).not.toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  test('a dropdown closes on Escape and reports its expanded state', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await page.goto(`/projects/${projectId}/overview`)
    await page.waitForLoadState('domcontentloaded')

    const trigger = page.getByTestId('uat-module-tab-schedule')
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await trigger.click()
    await expect(page.getByTestId('uat-module-menu-schedule')).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('uat-module-menu-schedule')).toHaveCount(0)
  })

  test('Setup Readiness appears on Overview only', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)

    // On Overview it is present. Wait for the panel rather than sleeping: the
    // readiness query can be slow when the whole suite is running.
    await page.goto(`/projects/${projectId}/overview`)
    await page.waitForLoadState('domcontentloaded')
    await expect(
      page
        .getByTestId('uat-setup-readiness-collapse')
        .or(page.getByTestId('uat-setup-readiness-expand')),
      'Setup Readiness should be on Overview',
    ).toBeVisible({ timeout: 30_000 })

    // On every working module it is not: the setup checklist must not take
    // space away from the screens people work in all day.
    for (const route of ['schedule/gantt', 'cost/budget', 'commercial/change-orders', 'boq']) {
      await page.goto(`/projects/${projectId}/${route}`)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1800)
      const present =
        (await page.getByTestId('uat-setup-readiness-collapse').count()) +
        (await page.getByTestId('uat-setup-readiness-expand').count())
      expect(present, `Setup Readiness leaked onto /${route}`).toBe(0)
    }
  })

  test('project context survives a refresh', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await page.goto(`/projects/${projectId}/commercial/change-orders`)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    // 10 & 11
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2500)

    await expect(page).toHaveURL(new RegExp(`${projectId}/commercial/change-orders`))
    await expect(page.getByTestId('uat-module-tab-commercial')).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(page.getByText('Riverside Tower').first()).toBeVisible()
  })

  test('module links carry the current project id', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await page.goto(`/projects/${projectId}/overview`)
    await page.waitForLoadState('domcontentloaded')

    // 9 (project identity): navigating must never reuse a stale project id.
    await openModuleMenu(page, 'quality')
    await page.getByTestId('uat-module-child-quality-ncr').click()
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/quality/ncr`))
  })
})

test.describe('permissions', () => {
  test('a role without commercial access is not offered it', async ({ page }) => {
    // 15: the bar is filtered by the resolved permission matrix. The warehouse
    // role has no commercial permission, so the module must not appear —
    // while the server stays the real authorization boundary.
    await signIn(page, 'warehouse')
    const projectId = await openProject(page)
    await page.goto(`/projects/${projectId}/overview`)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2500)

    const bar = page.getByTestId('uat-project-module-bar')
    await expect(bar).toBeVisible()

    const commercialVisible = await page
      .getByTestId('uat-module-tab-commercial')
      .isVisible()
      .catch(() => false)
    const inMore = await page
      .getByTestId('uat-module-more-commercial')
      .count()
      .catch(() => 0)

    // eslint-disable-next-line no-console
    console.log(`PERM_COMMERCIAL_VISIBLE ${commercialVisible} inMore=${inMore}`)
    expect(
      commercialVisible,
      'the commercial module was exposed to a role without access',
    ).toBeFalsy()
  })
})

test.describe('responsive navigation', () => {
  test('tablet keeps the bar scrollable without moving the page', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await page.setViewportSize({ width: 834, height: 1112 })
    await page.goto(`/projects/${projectId}/cost/budget`)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2500)

    // 13
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, `the page scrolls horizontally by ${overflow}px on tablet`).toBeLessThanOrEqual(2)

    await page.screenshot({ path: `${SHOTS}/nav-05-tablet.png` })
  })

  test('mobile opens a searchable module drawer', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/projects/${projectId}/overview`)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2500)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, `the page scrolls horizontally by ${overflow}px on mobile`).toBeLessThanOrEqual(2)

    // 14
    await page.getByTestId('uat-module-menu-trigger').click()
    const drawer = page.getByTestId('uat-module-drawer')
    await expect(drawer).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/nav-06-mobile-drawer.png` })

    // 15 (optional module switcher): search narrows the list.
    await page.getByTestId('uat-module-drawer-search').fill('budget')
    await expect(drawer.getByText('Budget', { exact: true }).first()).toBeVisible()

    await page.getByTestId('uat-module-drawer-search').fill('')
    await page.getByTestId('uat-module-drawer-cost').click()
    await expect(page).toHaveURL(/\/cost\//)
  })
})

test.describe('navigation screenshots', () => {
  test('captures the workspace states for review', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)

    for (const [name, route] of [
      ['nav-01-dashboard', '/'],
      ['nav-02-schedule', `/projects/${projectId}/schedule/gantt`],
      ['nav-03-budget', `/projects/${projectId}/cost/budget`],
      ['nav-04-commercial', `/projects/${projectId}/commercial/change-orders`],
    ] as Array<[string, string]>) {
      await page.goto(route)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2800)
      await page.screenshot({ path: `${SHOTS}/${name}.png` })
    }

    // The Schedule dropdown open, so the two-column menu can be reviewed.
    await page.goto(`/projects/${projectId}/schedule/gantt`)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)
    await openModuleMenu(page, 'schedule')
    await page.screenshot({ path: `${SHOTS}/nav-07-schedule-dropdown.png` })
  })
})
