import { expect, test, type Page } from '@playwright/test'
import { SHOTS, watchForProblems } from './support'

/**
 * The public marketing page, checked against the brand book.
 *
 * The things asserted here are the ones the brand book is specific about and
 * that are easy to lose in a later edit: the official palette values, the
 * octagon geometry, Space Grotesk on the headings, and the accent staying an
 * accent rather than spreading across the page.
 *
 * Screenshots land under test-results (see SHOTS in support.ts).
 */


/** Official values from the supplied brand book. */
const BRAND = {
  midnightIndigo: 'rgb(15, 27, 100)',
  royalBlue: 'rgb(50, 95, 236)',
  azure: 'rgb(51, 136, 255)',
  turquoise: 'rgb(19, 193, 206)',
  charcoal: 'rgb(18, 27, 33)',
  lightGray: 'rgb(220, 222, 221)',
}

/** Settles the scroll-reveal animations so a screenshot is not half-faded. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 60))
    }
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(900)
}

test.describe('landing page brand', () => {
  test('the palette is the official one', async ({ page }) => {
    await page.goto('/landing')
    await expect(page.getByTestId('uat-landing')).toBeVisible()

    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      const read = (name: string) => style.getPropertyValue(name).trim()
      // Resolve each hex through the browser so the comparison is on rgb().
      const resolve = (value: string) => {
        const probe = document.createElement('span')
        probe.style.color = value
        document.body.appendChild(probe)
        const out = getComputedStyle(probe).color
        probe.remove()
        return out
      }
      return {
        midnightIndigo: resolve(read('--octa-midnight-indigo')),
        royalBlue: resolve(read('--octa-royal-blue')),
        azure: resolve(read('--octa-azure')),
        turquoise: resolve(read('--octa-turquoise')),
        charcoal: resolve(read('--octa-charcoal')),
        lightGray: resolve(read('--octa-light-gray')),
      }
    })

    expect(tokens).toEqual(BRAND)
  })

  test('the hero carries the headline, the ground and the tessellation', async ({
    page,
  }) => {
    await page.goto('/landing')

    const hero = page.getByTestId('uat-landing-hero')
    await expect(hero).toBeVisible()

    // The brand book's own headline, not an invented one.
    await expect(
      page.getByRole('heading', { level: 1, name: 'One Platform, Total Project Control' }),
    ).toBeVisible()

    // The octagon tessellation is a ::before layer over the gradient.
    const pattern = await hero.evaluate((el) => {
      const style = getComputedStyle(el, '::before')
      return { image: style.backgroundImage, opacity: Number(style.opacity) }
    })
    expect(pattern.image, 'the hero has no tessellation layer').toContain('svg')
    expect(pattern.opacity, 'the tessellation is invisible').toBeGreaterThan(0.1)

    // Headings are set in the brand typeface.
    const font = await page
      .getByRole('heading', { level: 1 })
      .evaluate((el) => getComputedStyle(el).fontFamily)
    expect(font, `headline is not Space Grotesk, got ${font}`).toContain('Space Grotesk')
  })

  test('the logo is the eight-octagon ring, not a text fallback', async ({ page }) => {
    await page.goto('/landing')

    // An <svg role="img"> named OctaPM — if this became styled text the
    // wordmark's custom letterforms would be gone.
    const logo = page.getByRole('img', { name: 'OctaPM' }).first()
    await expect(logo).toBeVisible()

    const shape = await logo.evaluate((el) => ({
      tag: el.tagName.toLowerCase(),
      paths: el.querySelectorAll('path').length,
      viewBox: el.getAttribute('viewBox'),
    }))
    expect(shape.tag).toBe('svg')
    // One ring plus six letters.
    expect(shape.paths, 'the lockup lost paths').toBe(7)
    expect(shape.viewBox).toBeTruthy()
  })

  test('Turquoise is the call to action, and stays an accent', async ({ page }) => {
    await page.goto('/landing')
    await settle(page)

    const cta = page.getByTestId('uat-landing-cta')
    await expect(cta).toBeVisible()
    const background = await cta.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(background, 'the primary call to action is not Turquoise').toBe(
      BRAND.turquoise,
    )

    // The book budgets the accent at roughly 5% of the identity, so it must
    // never become a surface. Count only the turquoise that is actually seen:
    // a panel whose 1px frame is turquoise has an opaque child covering the
    // rest of it, and that covered area does not read as turquoise.
    const share = await page.evaluate((colour) => {
      const visible = (el: HTMLElement) => {
        const box = el.getBoundingClientRect()
        let covered = 0
        for (const child of Array.from(el.children) as HTMLElement[]) {
          const style = getComputedStyle(child)
          const opaque =
            style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
            style.backgroundColor !== 'transparent'
          if (!opaque) continue
          const childBox = child.getBoundingClientRect()
          covered += childBox.width * childBox.height
        }
        return Math.max(0, box.width * box.height - covered)
      }

      let area = 0
      for (const el of document.querySelectorAll<HTMLElement>('body *')) {
        if (getComputedStyle(el).backgroundColor === colour) area += visible(el)
      }
      const page = document.documentElement.scrollWidth * document.documentElement.scrollHeight
      return area / page
    }, BRAND.turquoise)

    expect(share, 'Turquoise has grown from an accent into a surface').toBeLessThan(0.05)
  })

  test('every link on the page goes somewhere', async ({ page }) => {
    await page.goto('/landing')
    await settle(page)

    const dead = await page.evaluate(() =>
      [...document.querySelectorAll('a')]
        .map((a) => a.getAttribute('href'))
        .filter((href) => !href || href === '#' || href === 'javascript:void(0)'),
    )
    expect(dead, 'the page still has placeholder links').toEqual([])

    // In-page anchors must resolve to a real section.
    const missing = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="#"]')]
        .map((a) => a.getAttribute('href')!.slice(1))
        .filter((id) => id && !document.getElementById(id)),
    )
    expect(missing, 'anchors point at sections that do not exist').toEqual([])
  })

  test('the calls to action reach sign-up and the legal pages', async ({ page }) => {
    await page.goto('/landing')

    await page.getByTestId('uat-landing-cta').click()
    await expect(page).toHaveURL(/\/sign-up/)

    await page.goto('/landing')
    await settle(page)
    await page.getByRole('link', { name: 'Privacy Policy' }).first().click()
    await expect(page).toHaveURL(/\/privacy/)
  })

  test('it holds together at every width, and reports no console errors', async ({
    page,
  }) => {
    const problems = watchForProblems(page)

    for (const [label, width, height] of [
      ['desktop', 1440, 900],
      ['tablet', 834, 1112],
      ['mobile', 390, 844],
    ] as Array<[string, number, number]>) {
      await page.setViewportSize({ width, height })
      await page.goto('/landing')
      await settle(page)

      // Measure the page, not the window: the dev server also renders the
      // TanStack devtools overlay, which is absent from a production build and
      // would otherwise be reported as the page overflowing.
      const worst = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth
        let over = 0
        let culprit = ''
        // Wide content is allowed as long as something above it scrolls or
        // clips — that is exactly what the comparison table does.
        const contained = (el: HTMLElement) => {
          for (let node = el.parentElement; node; node = node.parentElement) {
            const overflowX = getComputedStyle(node).overflowX
            if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') {
              return true
            }
          }
          return false
        }

        for (const el of document.querySelectorAll<HTMLElement>(
          '[data-testid="uat-landing"] *',
        )) {
          if (contained(el)) continue
          const box = el.getBoundingClientRect()
          const past = Math.max(box.right - limit, -box.left)
          if (past > over) {
            over = past
            culprit = `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 120)
          }
        }
        return { over: Math.round(over), culprit }
      })
      expect(
        worst.over,
        `${label} pushes ${worst.over}px past the viewport: ${worst.culprit}`,
      ).toBeLessThanOrEqual(2)
    }

    expect(problems.consoleErrors, 'the landing page logged console errors').toEqual([])
    expect(problems.failedRequests, 'the landing page has failing requests').toEqual([])
  })

  test('captures the page for review', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/landing')
    await settle(page)

    await page.screenshot({ path: `${SHOTS}/12-landing-hero.png` })

    for (const [name, id] of [
      ['13-landing-platform', '#platform'],
      ['14-landing-dimensions', '#dimensions'],
      ['15-landing-compare', '#compare'],
      ['17-landing-pricing', '#pricing'],
    ] as Array<[string, string]>) {
      await page.evaluate((anchor) => {
        document.querySelector(anchor)?.scrollIntoView()
      }, id)
      await page.waitForTimeout(700)
      await page.screenshot({ path: `${SHOTS}/${name}.png` })
    }

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/landing')
    await settle(page)
    await page.screenshot({ path: `${SHOTS}/16-landing-mobile.png` })
  })

  test('the dark theme is designed, not inherited', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/landing')
    await page.getByRole('button', { name: 'Use the dark theme' }).click()
    await settle(page)

    // The page ground must actually change, and the text must invert with it.
    const [background, foreground] = await page.evaluate(() => {
      const body = getComputedStyle(document.body)
      return [body.backgroundColor, body.color]
    })
    const luminance = (colour: string) => {
      const [r, g, b] = colour.match(/\d+/g)!.map(Number)
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255
    }
    expect(luminance(background), 'the dark theme still has a light ground').toBeLessThan(0.3)
    expect(
      luminance(foreground),
      'the text did not invert with the ground',
    ).toBeGreaterThan(0.6)

    await page.evaluate(() => document.querySelector('#platform')?.scrollIntoView())
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${SHOTS}/18-landing-dark.png` })
  })
})
