/** The logo, rasterised once so Word can place it. */
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { HERE, hex, lockupSvg } from './brand.mjs'

const CACHE = path.join(HERE, '.cache')

export async function logoPng(colour = hex('indigo'), width = 640) {
  const file = path.join(CACHE, `lockup-${colour.replace('#', '')}-${width}.png`)
  if (existsSync(file)) return file
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width, height: 200 }, deviceScaleFactor: 2 })
  await page.setContent(
    `<body style="margin:0;background:transparent"><div id="mark" style="display:inline-block">${lockupSvg(colour, 64)}</div></body>`
  )
  const box = await page.locator('#mark').boundingBox()
  await mkdir(CACHE, { recursive: true })
  const bytes = await page.screenshot({ clip: box, omitBackground: true })
  await writeFile(file, bytes)
  await browser.close()
  return file
}
