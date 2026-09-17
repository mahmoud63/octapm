/**
 * The OctaPM brand, as the documents need it.
 *
 * The palette and the logo are read from the product rather than retyped, so a
 * change to either reaches the client documents the next time they are built.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO = path.resolve(HERE, '..', '..')
export const SOURCE = path.join(REPO, 'docs', 'user-guide')
export const IMAGES = path.join(SOURCE, 'images')
export const OUT = path.join(REPO, 'deliverables')

/** From the brand book, by way of the product's own theme. */
export const COLOUR = {
  indigo: '0F1B64',
  indigoDeep: '0A1247',
  royal: '325FEC',
  azure: '3388FF',
  turquoise: '13C1CE',
  charcoal: '121B21',
  muted: '5A6672',
  rule: 'D8DEEA',
  paper: 'FFFFFF',
  panel: 'F4F6FA',
  success: '26AC7A',
  warning: 'FDC047',
  error: 'F2445C',
}

export const hex = (name) => `#${COLOUR[name]}`

/** Space Grotesk carries the brand; the rest is a readable fallback stack. */
export const FONT = {
  display: "'Space Grotesk', 'Inter', 'Segoe UI', Arial, sans-serif",
  body: "'Inter', 'Segoe UI', Calibri, Arial, sans-serif",
  mono: "'Cascadia Mono', 'Consolas', 'Courier New', monospace",
  docxDisplay: 'Space Grotesk',
  docxBody: 'Inter',
  docxMono: 'Consolas',
}

export const WEB_FONTS =
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap'

/**
 * The mark and wordmark, lifted from the component that draws them in the
 * product. They are real vectors from the supplied artwork and must never be
 * redrawn or replaced with type, so they are read rather than copied.
 */
function readLogo() {
  const file = path.join(REPO, 'frontend', 'src', 'components', 'brand', 'octa-logo.tsx')
  const src = readFileSync(file, 'utf8')
  const number = (name) => {
    const found = src.match(new RegExp(`const ${name} = ([0-9.]+)`))
    if (!found) throw new Error(`${name} not found in the logo component`)
    return Number(found[1])
  }
  const markD = src.match(/const MARK_D =\s*\n?\s*'([^']+)'/)?.[1]
  const wordBlock = src.match(/const WORD_D = \[([\s\S]*?)\n\]/)?.[1]
  if (!markD || !wordBlock) throw new Error('logo path data not found in the logo component')
  const wordD = [...wordBlock.matchAll(/'([^']+)'/g)].map((m) => m[1])
  const markW = number('MARK_W')
  const markH = number('MARK_H')
  const wordW = number('WORD_W')
  const wordH = number('WORD_H')
  const gap = number('GAP')
  return { markD, wordD, markW, markH, wordW, wordH, gap, lockupW: markW + gap + wordW }
}

export const LOGO = readLogo()

/** The full lockup, at whatever colour the document needs. */
export function lockupSvg(fill, height = 34) {
  const { markD, wordD, markW, markH, wordH, gap, lockupW } = LOGO
  const wordY = (markH - wordH) / 2
  const paths = wordD.map((d) => `<path fill-rule="nonzero" d="${d}"/>`).join('')
  return `<svg viewBox="0 0 ${lockupW} ${markH}" height="${height}" fill="${fill}" role="img" aria-label="OctaPM" xmlns="http://www.w3.org/2000/svg"><path fill-rule="nonzero" d="${markD}"/><g transform="translate(${markW + gap} ${wordY})">${paths}</g></svg>`
}

/** The ring on its own, for the corner of a page. */
export function markSvg(fill, height = 18) {
  const { markD, markW, markH } = LOGO
  return `<svg viewBox="0 0 ${markW} ${markH}" height="${height}" fill="${fill}" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill-rule="nonzero" d="${markD}"/></svg>`
}

export const svgDataUri = (svg) =>
  `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`

/** What every client-facing document says about itself. */
export const EDITION = {
  product: 'OctaPM Pilot V1',
  version: '1.0',
  edition: 'Pilot Edition',
  date: 'September 2026',
  status: 'Issued for client training and pilot',
  preparedFor: 'OctaPM pilot client team',
}
