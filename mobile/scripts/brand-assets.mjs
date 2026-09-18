#!/usr/bin/env node
/**
 * Render the app's brand assets from the product's own logo component.
 *
 * The mark is the eight-octagon ring from frontend/src/components/brand, the
 * real vectors from the supplied artwork; nothing here is redrawn. Each asset
 * is rasterised with the repository's Playwright at the size the stores want.
 *
 *   node scripts/brand-assets.mjs
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const mobile = path.resolve(here, '..')
const repo = path.resolve(mobile, '..')
const require = createRequire(path.join(repo, 'package.json'))
const { chromium } = require('playwright')

const INDIGO = '#0F1B64'

function readMark() {
  const src = readFileSync(path.join(repo, 'frontend', 'src', 'components', 'brand', 'octa-logo.tsx'), 'utf8')
  const d = src.match(/const MARK_D =\s*\n?\s*'([^']+)'/)?.[1]
  const w = Number(src.match(/const MARK_W = ([0-9.]+)/)?.[1])
  const h = Number(src.match(/const MARK_H = ([0-9.]+)/)?.[1])
  if (!d || !w || !h) throw new Error('mark not found in octa-logo.tsx')
  return { d, w, h }
}

const mark = readMark()

/** The ring, centred in a square canvas, at a fraction of the canvas width. */
const page = (size, { background, fill, scale }) => `<!doctype html>
<body style="margin:0;width:${size}px;height:${size}px;background:${background};display:grid;place-items:center">
<svg viewBox="0 0 ${mark.w} ${mark.h}" width="${size * scale}" height="${(size * scale * mark.h) / mark.w}" xmlns="http://www.w3.org/2000/svg">
  <path fill="${fill}" fill-rule="nonzero" d="${mark.d}"/>
</svg></body>`

const ASSETS = [
  // App icon: the ring on Midnight Indigo, ~64% of the canvas.
  { file: 'icon.png', size: 1024, background: INDIGO, fill: '#ffffff', scale: 0.64 },
  // Android adaptive foreground: transparent, smaller because the launcher masks it.
  { file: 'adaptive-icon.png', size: 1024, background: 'transparent', fill: '#ffffff', scale: 0.46 },
  // Splash: the ring alone on transparent; app.json paints the indigo behind it.
  { file: 'splash-icon.png', size: 1024, background: 'transparent', fill: '#ffffff', scale: 0.34 },
  // Android notification icon: white silhouette on transparent, small.
  { file: 'notification-icon.png', size: 96, background: 'transparent', fill: '#ffffff', scale: 0.8 },
  // Web favicon.
  { file: 'favicon.png', size: 48, background: INDIGO, fill: '#ffffff', scale: 0.7 },
]

const out = path.join(mobile, 'assets')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
for (const asset of ASSETS) {
  const tab = await browser.newPage({ viewport: { width: asset.size, height: asset.size }, deviceScaleFactor: 1 })
  await tab.setContent(page(asset.size, asset))
  const png = await tab.screenshot({ omitBackground: asset.background === 'transparent', clip: { x: 0, y: 0, width: asset.size, height: asset.size } })
  writeFileSync(path.join(out, asset.file), png)
  console.log(`  ${asset.file.padEnd(22)} ${asset.size}×${asset.size}  ${(png.length / 1024).toFixed(0)} KB`)
  await tab.close()
}
await browser.close()
