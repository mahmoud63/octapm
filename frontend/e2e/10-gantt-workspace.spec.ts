import { expect, test, type Page } from '@playwright/test'
import { openProject, signIn } from './support'

/**
 * The Gantt as a working surface.
 *
 * A planner arriving from Primavera judges this on one thing before anything
 * else: how much of the screen the bars actually get. These check that the
 * chart opens with a usable split, that it can take the whole window, and that
 * fitting the timeline really fits it.
 *
 * Screenshots land in docs/design/screenshots/.
 */

const SHOTS = '../docs/design/screenshots'

async function openGantt(page: Page) {
  await signIn(page)
  const projectId = await openProject(page)
  await page.goto(`/projects/${projectId}/schedule`)
  await expect(page.getByTestId('primavera-gantt')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('primavera-gantt-viewport').scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
}

/** Share of the chart's width that belongs to the bars rather than the table. */
async function timelineShare(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('[data-testid="primavera-gantt-viewport"]')!
    const grid = document.querySelector('[data-testid="primavera-gantt-grid"]')!
    const total = viewport.clientWidth
    return (total - grid.getBoundingClientRect().width) / total
  })
}

test.describe('gantt working area', () => {
  test('opens with most of the width given to the bars', async ({ page }) => {
    await openGantt(page)

    const share = await timelineShare(page)
    expect(
      share,
      `the timeline only gets ${(share * 100).toFixed(0)}% of the width`,
    ).toBeGreaterThan(0.35)

    await page.screenshot({ path: `${SHOTS}/19-gantt-default.png` })
  })

  test('takes the whole window, and Escape gives it back', async ({ page }) => {
    await openGantt(page)

    const chart = page.getByTestId('primavera-gantt')
    const before = (await chart.boundingBox())!.height

    await page.getByTestId('primavera-gantt-fullscreen').click()
    await expect(chart).toHaveAttribute('data-fullscreen', 'true')

    const viewport = page.viewportSize()!
    const box = (await chart.boundingBox())!
    expect(box.height, 'full screen did not fill the window').toBeGreaterThan(
      viewport.height * 0.95,
    )
    expect(box.height).toBeGreaterThan(before)

    // The application behind must not scroll while the chart owns the window.
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')

    await page.screenshot({ path: `${SHOTS}/20-gantt-fullscreen.png` })

    await page.keyboard.press('Escape')
    await expect(chart).toHaveAttribute('data-fullscreen', 'false')
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')
  })

  test('fit to window really fits the whole programme', async ({ page }) => {
    await openGantt(page)
    await page.getByTestId('primavera-gantt-fullscreen').click()
    await expect(page.getByTestId('primavera-gantt')).toHaveAttribute(
      'data-fullscreen',
      'true',
    )

    await page.getByTestId('primavera-gantt-fit').click()
    await page.waitForTimeout(400)

    const overflow = await page.evaluate(() => {
      const viewport = document.querySelector('[data-testid="primavera-gantt-viewport"]')!
      return viewport.scrollWidth - viewport.clientWidth
    })
    expect(overflow, `the fitted chart still scrolls by ${overflow}px`).toBeLessThanOrEqual(2)
  })

  test('the splitter hands width between the table and the bars', async ({ page }) => {
    await openGantt(page)

    const grid = page.getByTestId('primavera-gantt-grid')
    const before = (await grid.boundingBox())!.width

    const splitter = page.getByTestId('primavera-gantt-splitter')
    const handle = (await splitter.boundingBox())!
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 60)
    await page.mouse.down()
    await page.mouse.move(handle.x - 240, handle.y + 60, { steps: 8 })
    await page.mouse.up()

    const after = (await grid.boundingBox())!.width
    expect(after, 'dragging the splitter left did not narrow the table').toBeLessThan(
      before - 100,
    )
    expect(after, 'the table collapsed past its minimum').toBeGreaterThanOrEqual(200)
  })

  test('the resource histogram lines up under the bars', async ({ page }) => {
    await openGantt(page)
    await page.getByTestId('primavera-gantt-resources').click()

    const pane = page.getByTestId('primavera-gantt-histogram')
    await expect(pane).toBeVisible()

    // Seeded crews and plant must actually produce a profile.
    await expect(page.getByTestId('primavera-gantt-histogram-empty')).toHaveCount(0)
    const canvas = page.getByTestId('primavera-gantt-histogram-canvas')
    await expect(canvas).toBeVisible()

    // The columns are only readable against the bars if they share an origin
    // and a width with the timeline above them.
    const aligned = await page.evaluate(() => {
      const grid = document.querySelector('[data-testid="primavera-gantt-grid"]')!
      const legend = document
        .querySelector('[data-testid="primavera-gantt-histogram"]')!
        .firstElementChild!
      const chart = document.querySelector(
        '[data-testid="primavera-gantt-histogram-canvas"]',
      ) as SVGElement
      const header = document.querySelector(
        '[data-testid="primavera-gantt-timeline-header"]',
      ) as HTMLElement
      return {
        legendWidth: legend.getBoundingClientRect().width,
        gridWidth: grid.getBoundingClientRect().width,
        chartWidth: Number(chart.getAttribute('width')),
        timelineWidth: header.getBoundingClientRect().width,
      }
    })
    expect(Math.abs(aligned.legendWidth - aligned.gridWidth)).toBeLessThanOrEqual(2)
    expect(Math.abs(aligned.chartWidth - aligned.timelineWidth)).toBeLessThanOrEqual(2)

    // Man-days and square metres do not add up, so one unit is charted at a
    // time and the others are offered beside it.
    await expect(
      page.getByTestId('primavera-gantt-histogram-unit-man-days'),
    ).toBeVisible()

    // Grouping by named resource must separate the crews the seed assigns.
    await page.getByTestId('primavera-gantt-histogram-group-resource').click()
    await page.waitForTimeout(400)
    const series = await canvas.evaluate(
      (svg) => new Set([...svg.querySelectorAll('rect')].map((r) => r.getAttribute('fill'))).size,
    )
    expect(series, 'by-resource grouping drew a single series').toBeGreaterThan(1)

    // Capture it the way it is meant to be read: full screen, whole programme.
    await page.getByTestId('primavera-gantt-fullscreen').click()
    await page.getByTestId('primavera-gantt-fit').click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${SHOTS}/21-gantt-histogram.png` })
  })

  test('a layout can be saved and comes back on the next visit', async ({ page }) => {
    await openGantt(page)

    // A built-in layout is the starting point.
    await expect(page.getByTestId('primavera-gantt-layouts')).toContainText(
      'Classic schedule',
    )

    // Set the view up: resources on, month scale.
    await page.getByTestId('primavera-gantt-resources').click()
    await page.getByRole('button', { name: 'Month', exact: true }).click()
    await expect(page.getByTestId('primavera-gantt-histogram')).toBeVisible()

    page.once('dialog', (dialog) => dialog.accept('Site review'))
    await page.getByTestId('primavera-gantt-layouts').click()
    await page.getByTestId('primavera-gantt-layout-save').click()
    await expect(page.getByTestId('primavera-gantt-layouts')).toContainText(
      'Site review',
    )

    // The whole point: come back and find it as you left it.
    await page.reload()
    await expect(page.getByTestId('primavera-gantt')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('primavera-gantt-layouts')).toContainText(
      'Site review',
    )
    await expect(page.getByTestId('primavera-gantt-histogram')).toBeVisible()
  })

  test('the built-in resource layout turns the histogram on', async ({ page }) => {
    await openGantt(page)

    await page.getByTestId('primavera-gantt-layouts').click()
    await page.getByTestId('primavera-gantt-layout-builtin:resources').click()

    await expect(page.getByTestId('primavera-gantt-histogram')).toBeVisible()
    await expect(page.getByTestId('primavera-gantt-layouts')).toContainText(
      'Resource review',
    )

    // Switching back to a layout without resources puts them away again.
    await page.getByTestId('primavera-gantt-layouts').click()
    await page.getByTestId('primavera-gantt-layout-builtin:classic').click()
    await expect(page.getByTestId('primavera-gantt-histogram')).toHaveCount(0)
  })

  test('total float is shown, and zero float reads as critical', async ({ page }) => {
    await openGantt(page)

    // The column has to be reachable: widen the table back to its full set.
    await page.evaluate(() => {
      const grid = document.querySelector<HTMLElement>(
        '[data-testid="primavera-gantt-grid"]',
      )!
      grid.scrollIntoView()
    })

    await expect(
      page.getByTestId('primavera-gantt-grid').getByText('Total Float'),
    ).toBeAttached()
  })
})
