import { expect, test, type Page } from '@playwright/test'
import { apiBase, ALLOWED_CAPS, accounts, apiSession, findLeaks, getData, isWide, items, mainProject, signIn } from './cert-helpers'

/**
 * Certification: adaptive layout on the web target, labelled WEB/RESPONSIVE
 * LAYOUT VALIDATION (not native device certification). Every important
 * screen is opened at each phone width, tablet width and iPad-style size
 * and checked for horizontal page overflow, controls outside the viewport,
 * tap targets below 40 px, technical text, and, on wide sizes, the rail and
 * the master–detail split. Screenshots of the representative sizes go to
 * test-results/shots for the report.
 */
const PHONES = [
  { w: 320, h: 568 },
  { w: 360, h: 780 },
  { w: 375, h: 812 },
  { w: 390, h: 844 },
  { w: 412, h: 915 },
  { w: 430, h: 932 },
]
const TABLETS = [
  { w: 768, h: 1024, label: 'tablet portrait' },
  { w: 820, h: 1180, label: 'tablet portrait (large)' },
  { w: 1024, h: 768, label: 'tablet landscape' },
  { w: 1280, h: 800, label: 'tablet landscape (wide)' },
]
const IPADS = [
  { w: 834, h: 1194, label: 'iPad portrait' },
  { w: 1194, h: 834, label: 'iPad landscape' },
  { w: 1024, h: 1366, label: 'iPad Pro portrait' },
  { w: 1366, h: 1024, label: 'iPad Pro landscape' },
]

type Metrics = { overflow: number; outside: string[]; small: string[]; buttons: number; minButton: number }

/** Page-wide overflow, controls outside the viewport and tap targets under 40 px, measured in the browser. */
const measure = (page: Page): Promise<Metrics> =>
  page.evaluate(() => {
    const vw = window.innerWidth
    const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw
    const outside: string[] = []
    const small: string[] = []
    let buttons = 0
    let minButton = Infinity
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && r.bottom > 0 && r.top < window.innerHeight
    }
    /** A control past the edge is still reachable when it sits in a strip that scrolls sideways. */
    const inScrollableStrip = (el: Element) => {
      let node: Element | null = el.parentElement
      while (node && node !== document.body) {
        const style = getComputedStyle(node)
        if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1) return true
        node = node.parentElement
      }
      return false
    }
    for (const el of Array.from(document.querySelectorAll('[role="button"], button, [role="tab"], input, [role="textbox"]'))) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      const id = el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 30) ?? '?'
      if ((r.left < -1 || r.right > vw + 1) && !inScrollableStrip(el)) outside.push(`${id}@${Math.round(r.left)}-${Math.round(r.right)}`)
      if (el.getAttribute('role') === 'button' || el.tagName === 'BUTTON') {
        buttons += 1
        minButton = Math.min(minButton, r.height)
        if (r.height < 40) small.push(`${id}:${Math.round(r.height)}px`)
      }
    }
    return { overflow, outside, small, buttons, minButton: Number.isFinite(minButton) ? Math.round(minButton) : 0 }
  })

/** The tab bar's place: a rail stands on the left edge; a bar lies along the bottom. */
const barPlacement = async (page: Page): Promise<'rail' | 'bar' | 'none'> => {
  const home = page.getByText('Home', { exact: true }).last()
  if ((await home.count()) === 0) return 'none'
  const box = await home.boundingBox()
  if (!box) return 'none'
  const size = page.viewportSize()!
  if (box.x < 160 && box.y < size.height * 0.7) return 'rail'
  if (box.y > size.height * 0.75) return 'bar'
  return 'none'
}

test.describe('certification: responsive layout (web target)', () => {
  test.beforeEach(({ page }) => {
    test.skip(isWide(page), 'the sizes are set inside the checks; runs once')
  })

  test('phone widths: no overflow, every control reachable, tap targets at least 40 px, no technical text', async ({ page, request }) => {
    test.setTimeout(600_000)
    const admin = await apiSession(request, accounts.pm)
    const project = await mainProject(request, admin.headers)
    const rfis = items(await getData<{ items: { id: string }[] }>(request, admin.headers, `/projects/${project.id}/rfi`))
    const rfiId = rfis[0]?.id
    const routes = ['/', '/projects', '/needs-you', '/search', '/notifications', '/rfi', ...(rfiId ? [`/rfi/${rfiId}`] : []), '/rfi/new', '/tasks', '/documents', '/drawings', '/site', '/activities', '/photos', '/timesheets', '/quality', '/quality/inspections', '/quality/punch', '/quality/ncr', '/inventory', '/inventory/items', '/inventory/receive', '/workflow', '/commercial', '/commercial/change-events', '/procurement', '/procurement/orders', '/outbox', '/more']
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page, accounts.pm)
    const report: string[] = []
    const failures: string[] = []
    for (const size of PHONES) {
      await page.setViewportSize({ width: size.w, height: size.h })
      for (const route of routes) {
        await page.goto(route)
        await page.locator('[data-testid^="screen-"]').first().waitFor({ state: 'visible' })
        await page.waitForLoadState('networkidle').catch(() => undefined)
        await page.waitForTimeout(250)
        const m = await measure(page)
        const leaks = await findLeaks(page, ALLOWED_CAPS)
        const placement = await barPlacement(page)
        report.push(`${size.w}x${size.h} ${route}: overflow ${m.overflow}px, outside ${m.outside.length}, small ${m.small.length}, buttons ${m.buttons}, min ${m.minButton}px, ${placement}`)
        if (m.overflow > 1) failures.push(`${size.w} ${route}: horizontal overflow ${m.overflow}px`)
        if (m.outside.length) failures.push(`${size.w} ${route}: outside viewport ${m.outside.slice(0, 3).join(', ')}`)
        if (m.small.length) failures.push(`${size.w} ${route}: tap targets under 40px ${m.small.slice(0, 4).join(', ')}`)
        if (leaks.length) failures.push(`${size.w} ${route}: technical text ${leaks.map((l) => `${l.name}=${l.sample}`).join('; ')}`)
        if (placement !== 'bar' && route !== '/outbox') failures.push(`${size.w} ${route}: tab bar not along the bottom (${placement})`)
        if (size.w === 390 && ['/', '/needs-you', '/rfi', ...(rfiId ? [`/rfi/${rfiId}`] : []), '/quality', '/inventory', '/site', '/drawings'].includes(route)) {
          await page.screenshot({ path: `test-results/shots/phone-${route === '/' ? 'home' : route.slice(1).replace(/\//g, '-').replace(/[^a-z0-9-]/gi, '')}.png`, fullPage: false })
        }
      }
    }
    test.info().annotations.push({ type: 'report', description: report.join('\n') })
    expect(failures, failures.join('\n')).toEqual([])
  })

  test('tablet and iPad-style sizes: rail, master–detail on records, no overflow, wider content used', async ({ page, request }) => {
    test.setTimeout(600_000)
    const admin = await apiSession(request, accounts.pm)
    const project = await mainProject(request, admin.headers)
    // Master–detail needs a record to show beside its list. Raise one when the
    // organisation has just been reset, rather than depending on an earlier
    // spec in the same run having happened to leave one behind.
    const rfis = items(await getData<{ items: { id: string }[] }>(request, admin.headers, `/projects/${project.id}/rfi`))
    let rfiId = rfis[0]?.id
    if (!rfiId) {
      const raised = await request.post(`${apiBase}/projects/${project.id}/rfi`, { headers: admin.headers, data: { subject: `Cert responsive RFI ${Date.now() % 100000}`, question: 'Does the record sit beside its list on a tablet?', status: 'open' } })
      expect(raised.status(), await raised.text()).toBe(201)
      rfiId = ((await raised.json()) as { data: { id: string } }).data.id
    }
    await page.setViewportSize({ width: 1024, height: 768 })
    await signIn(page, accounts.pm)
    const report: string[] = []
    const failures: string[] = []
    for (const size of [...TABLETS, ...IPADS]) {
      await page.setViewportSize({ width: size.w, height: size.h })
      const expanded = size.w >= 900
      for (const route of ['/', '/needs-you', '/rfi', `/rfi/${rfiId}`, '/quality', '/quality/punch', '/inventory', '/inventory/items', '/activities', '/workflow', '/documents', '/drawings', '/procurement/orders']) {
        await page.goto(route)
        await page.locator('[data-testid^="screen-"]').first().waitFor({ state: 'visible' })
        await page.waitForLoadState('networkidle').catch(() => undefined)
        await page.waitForTimeout(300)
        const m = await measure(page)
        const leaks = await findLeaks(page, ALLOWED_CAPS)
        const placement = await barPlacement(page)
        const split = await page.getByTestId('split-group').count()
        const placeholder = await page.getByTestId('pane-placeholder').count()
        report.push(`${size.label} ${size.w}x${size.h} ${route}: ${placement}, split ${split}, placeholder ${placeholder}, overflow ${m.overflow}px, small ${m.small.length}`)
        if (m.overflow > 1) failures.push(`${size.label} ${route}: horizontal overflow ${m.overflow}px`)
        if (m.outside.length) failures.push(`${size.label} ${route}: outside viewport ${m.outside.slice(0, 3).join(', ')}`)
        if (m.small.length) failures.push(`${size.label} ${route}: tap targets under 40px ${m.small.slice(0, 4).join(', ')}`)
        if (leaks.length) failures.push(`${size.label} ${route}: technical text ${leaks.map((l) => `${l.name}=${l.sample}`).join('; ')}`)
        if (expanded && placement !== 'rail') failures.push(`${size.label} ${route}: expected the rail on the left, saw ${placement}`)
        if (!expanded && placement !== 'bar') failures.push(`${size.label} ${route}: expected the bar along the bottom, saw ${placement}`)
        const recordGroup = ['/rfi', `/rfi/${rfiId}`, '/quality/punch', '/inventory/items', '/activities', '/workflow', '/procurement/orders'].includes(route)
        if (expanded && recordGroup && split === 0) failures.push(`${size.label} ${route}: expected master–detail, no split`)
        if (expanded && route === `/rfi/${rfiId}` && (await page.getByTestId('split-pane').getByTestId('screen-rfi').count()) === 0) failures.push(`${size.label}: the record is not in the right pane`)
        if (!expanded && split > 0) failures.push(`${size.label} ${route}: split shown below the expanded width`)
        if ([1024, 834, 1194].includes(size.w) && ['/', `/rfi/${rfiId}`, '/quality', '/inventory'].includes(route)) {
          await page.screenshot({ path: `test-results/shots/${size.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${route === '/' ? 'home' : route.slice(1).replace(/\//g, '-').replace(/[^a-z0-9-]/gi, '')}.png` })
        }
      }
    }
    test.info().annotations.push({ type: 'report', description: report.join('\n') })
    expect(failures, failures.join('\n')).toEqual([])
  })

  test('sign-in fits every phone width without overflow', async ({ page }) => {
    for (const size of PHONES) {
      await page.setViewportSize({ width: size.w, height: size.h })
      await page.goto('/sign-in')
      await expect(page.getByTestId('sign-in-submit')).toBeVisible()
      const m = await measure(page)
      expect(m.overflow, `${size.w}px overflow`).toBeLessThanOrEqual(1)
      expect(m.outside, `${size.w}px outside`).toEqual([])
    }
  })
})
