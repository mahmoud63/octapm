/// <reference types="node" />
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { accounts, apiSession, getData, isWide, items, mainProject, password } from './cert-helpers'

/**
 * Certification: what this environment can measure on the web target. The
 * bundle's first load, sign-in, Home, a project switch, Needs You, the
 * largest register, a record, the inventory list, a document register and
 * search, each timed from the navigation to the screen's freshness line
 * (the moment the data is on screen). Figures are the median of three
 * runs and are written to test-results/perf.json for the report. Nothing
 * here is a native measurement.
 */
const ms = (t0: number) => Math.round(performance.now() - t0)
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!

async function timeRoute(page: Page, route: string, marker: string, runs = 3) {
  const samples: number[] = []
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now()
    await page.goto(route)
    await page.getByTestId(marker).first().waitFor({ state: 'visible' })
    samples.push(ms(t0))
  }
  return median(samples)
}

test.describe('certification: performance on the web target', () => {
  test('bundle load, sign-in, Home, switch, registers, record and search', async ({ page, request }) => {
    test.skip(isWide(page), 'measured once on the phone viewport')
    test.setTimeout(300_000)
    const admin = await apiSession(request, accounts.pm)
    const project = await mainProject(request, admin.headers)
    const activities = items(await getData<{ items: unknown[] } | unknown[]>(request, admin.headers, `/projects/${project.id}/activities`))
    const rfis = items(await getData<{ items: { id: string }[] }>(request, admin.headers, `/projects/${project.id}/rfi`))
    const result: Record<string, number | string> = {}

    // First load of the production bundle to the sign-in screen (browser navigation timing).
    const t0 = performance.now()
    await page.goto('/sign-in')
    await page.getByTestId('sign-in-submit').waitFor({ state: 'visible' })
    result['bundle first load to sign-in (ms)'] = ms(t0)
    const nav = await page.evaluate(() => {
      const e = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      return e ? { domContentLoaded: Math.round(e.domContentLoadedEventEnd), load: Math.round(e.loadEventEnd), transfer: Math.round(e.transferSize / 1024) } : null
    })
    if (nav) {
      result['DOMContentLoaded (ms)'] = nav.domContentLoaded
      result['load event (ms)'] = nav.load
      result['document transfer (KB)'] = nav.transfer
    }

    // Sign-in: from the tap to Home with its data.
    await page.getByTestId('sign-in-email').fill(accounts.pm)
    await page.getByTestId('sign-in-password').fill(password)
    const t1 = performance.now()
    await page.getByTestId('sign-in-submit').click()
    await page.getByTestId('screen-home').waitFor({ state: 'visible' })
    const first = page.locator('[data-testid^="choose-"], [data-testid="freshness"]').first()
    await first.waitFor({ state: 'visible' })
    if ((await first.getAttribute('data-testid'))?.startsWith('choose-')) {
      await first.click()
      await page.getByTestId('freshness').first().waitFor({ state: 'visible' })
    }
    result['sign-in to Home with data (ms)'] = ms(t1)

    result['Home (ms)'] = await timeRoute(page, '/', 'freshness')
    result['Needs You (ms)'] = await timeRoute(page, '/needs-you', 'freshness')
    result[`activities register, ${activities.length} rows (ms)`] = await timeRoute(page, '/activities', 'freshness')
    result[`RFI list, ${rfis.length} rows (ms)`] = await timeRoute(page, '/rfi', 'freshness')
    if (rfis[0]) result['RFI record (ms)'] = await timeRoute(page, `/rfi/${rfis[0].id}`, 'screen-rfi')
    result['inventory items (ms)'] = await timeRoute(page, '/inventory/items', 'freshness')
    result['document register (ms)'] = await timeRoute(page, '/documents', 'freshness')
    result['quality home (ms)'] = await timeRoute(page, '/quality', 'freshness')

    // Project switch: from the tap on another project to Home with that project's data.
    const projects = items(await getData<{ items: { id: string }[] } | { id: string }[]>(request, admin.headers, '/projects'))
    const other = projects.find((p) => p.id !== project.id)
    if (other) {
      await page.goto('/projects')
      await page.getByTestId(`project-row-${other.id}`).waitFor({ state: 'visible' })
      const t2 = performance.now()
      await page.getByTestId(`project-row-${other.id}`).click()
      await page.getByTestId('screen-home').waitFor({ state: 'visible' })
      await page.getByTestId('freshness').first().waitFor({ state: 'visible' })
      result['project switch to Home with data (ms)'] = ms(t2)
      await page.goto('/projects')
      await page.getByTestId(`project-row-${project.id}`).click()
      await page.getByTestId('screen-home').waitFor({ state: 'visible' })
    }

    // Search: from the last keystroke to the first hit.
    await page.goto('/search')
    await page.getByTestId('search-input').waitFor({ state: 'visible' })
    const t3 = performance.now()
    await page.getByTestId('search-input').fill('RFI')
    await expect(page.getByTestId('search-count')).toContainText(/\d/, { timeout: 15_000 })
    result['search "RFI" to the result count (ms)'] = ms(t3)

    test.info().annotations.push({ type: 'perf', description: JSON.stringify(result, null, 2) })
    mkdirSync('test-results', { recursive: true })
    writeFileSync('test-results/perf.json', JSON.stringify(result, null, 2))
    expect(Object.keys(result).length).toBeGreaterThan(8)
  })
})
