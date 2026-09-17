/**
 * Print a document to PDF.
 *
 * Two passes. The first print is read back for the page each contents entry
 * actually landed on — the file records that itself, in the table of named
 * destinations behind its internal links — and the contents page is then
 * numbered from it and printed again. The numbers are therefore measured, not
 * estimated; if the file does not yield them, the entries are published
 * unnumbered rather than published wrong. They stay clickable either way, and
 * the PDF also carries a heading outline for the reader's sidebar.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { footerTemplate, headerTemplate } from './render-html.mjs'

const A4 = { format: 'A4', margin: { top: '17mm', bottom: '16mm', left: '18mm', right: '18mm' } }

const asText = (bytes) => Buffer.from(bytes).toString('latin1')

export function countPages(bytes) {
  const counts = [...asText(bytes).matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g)].map((m) => Number(m[1]))
  return counts.length ? Math.max(...counts) : 0
}

/** anchor name -> page number, read from the file's own destination table. */
function destinationPages(bytes) {
  const text = asText(bytes)
  const pages = new Map()
  let index = 0
  let ascending = true
  let previous = -1
  for (const match of text.matchAll(/(\d+)\s+0\s+obj\s*<<([^]*?)>>\s*(?:stream|endobj)/g)) {
    if (!/\/Type\s*\/Page\b/.test(match[2])) continue
    const object = Number(match[1])
    if (object < previous) ascending = false
    previous = object
    pages.set(object, ++index)
  }
  if (!ascending || !pages.size) return new Map()

  const found = new Map()
  for (const match of text.matchAll(/\/([A-Za-z0-9._~-]+)\s*\[\s*(\d+)\s+0\s+R\s*\/XYZ/g)) {
    const page = pages.get(Number(match[2]))
    if (page) found.set(match[1], page)
  }
  return found
}

let browser = null
export const closePrinter = async () => {
  if (browser) await browser.close()
  browser = null
}

export async function toPdf(html, outFile, { title, header }) {
  if (!browser) browser = await chromium.launch()
  const page = await browser.newPage()
  await page.emulateMedia({ media: 'print' })
  await page.setContent(html, { waitUntil: 'load' })
  // Give the web fonts a chance; the document still prints if they never arrive.
  await page.evaluate(() => document.fonts.ready.catch(() => null))
  await page.waitForTimeout(400)

  const options = {
    ...A4,
    printBackground: true,
    outline: true,
    tagged: true,
    displayHeaderFooter: true,
    headerTemplate: headerTemplate(header ?? title),
    footerTemplate: footerTemplate(title),
  }

  const first = await page.pdf(options)
  const pages = destinationPages(first)

  const numbered = await page.evaluate((entries) => {
    const marks = [...document.querySelectorAll('.toc-page')]
    if (!marks.length) return { entries: 0, numbered: 0 }
    const lookup = new Map(entries)
    let done = 0
    let last = 0
    let ordered = true
    for (const mark of marks) {
      const page = lookup.get(mark.dataset.for)
      if (!page) continue
      if (page < last) ordered = false
      last = page
      mark.textContent = String(page)
      done += 1
    }
    // All of them or none: a contents page numbered in patches is worse than one
    // numbered nowhere.
    const complete = ordered && done === marks.length
    if (!complete) marks.forEach((mark) => { mark.textContent = '' })
    return { entries: marks.length, numbered: complete ? done : 0, found: done, ordered }
  }, [...pages.entries()])

  const bytes = numbered.numbered ? await page.pdf(options) : first
  await mkdir(path.dirname(outFile), { recursive: true })
  await writeFile(outFile, bytes)
  await page.close()

  return {
    file: outFile,
    pages: countPages(bytes),
    contents: numbered,
    outline: asText(bytes).includes('/Outlines'),
  }
}
