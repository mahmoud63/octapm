/**
 * Check the built package before it is handed over.
 *
 * The PDFs are checked for pages, an outline, a contents page and embedded
 * images; the Word files are unzipped and their XML parsed, because a .docx
 * that will not open is the one failure a reader cannot work around.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { OUT } from './brand.mjs'

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })

const problems = []
const note = (file, message) => problems.push(`${path.relative(OUT, file)}: ${message}`)

const pdfs = []
const docs = []
for (const file of walk(OUT)) {
  if (file.endsWith('.pdf')) pdfs.push(file)
  else if (file.endsWith('.docx')) docs.push(file)
}

console.log(`Checking ${pdfs.length} PDF and ${docs.length} Word files\n`)

for (const file of pdfs) {
  const bytes = readFileSync(file)
  const text = bytes.toString('latin1')
  const counts = [...text.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g)].map((m) => Number(m[1]))
  const pages = counts.length ? Math.max(...counts) : 0
  const images = (text.match(/\/Subtype\s*\/Image/g) || []).length
  const links = (text.match(/\/Subtype\s*\/Link/g) || []).length
  const outline = text.includes('/Outlines')
  const numbered = /\/Dest\s*\/[a-z0-9-]/.test(text)

  if (!text.startsWith('%PDF-')) note(file, 'not a PDF')
  if (!pages) note(file, 'no pages')
  if (!outline) note(file, 'no heading outline')
  if (!links) note(file, 'no contents links')
  if (!numbered) note(file, 'no named destinations')
  if (statSync(file).size < 20000) note(file, 'suspiciously small')

  console.log(
    `  ${path.basename(file).padEnd(44)} ${String(pages).padStart(3)} pp  ${String(images).padStart(3)} images  ${String(links).padStart(3)} links  ${outline ? 'outline' : 'NO OUTLINE'}`
  )
}

console.log('')

for (const file of docs) {
  const zip = await JSZip.loadAsync(readFileSync(file))
  const required = ['[Content_Types].xml', 'word/document.xml', 'word/_rels/document.xml.rels']
  for (const part of required) if (!zip.file(part)) note(file, `missing ${part}`)

  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) {
    note(file, 'no document body')
    continue
  }
  // A cheap well-formedness check: every tag opened is closed, in order.
  const stack = []
  let broken = null
  for (const m of xml.matchAll(/<(\/?)([A-Za-z0-9:_.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = m
    if (selfClosing) continue
    if (closing) {
      if (stack.pop() !== name) { broken = name; break }
    } else stack.push(name)
  }
  if (broken || stack.length) note(file, `document.xml is not well formed (${broken ?? stack[stack.length - 1]})`)

  const media = Object.keys(zip.files).filter((n) => n.startsWith('word/media/')).length
  const headings = (xml.match(/w:val="Heading\d"/g) || []).length
  const tables = (xml.match(/<w:tbl>/g) || []).length
  const toc = xml.includes('TOC \\o')

  // Running headers and footers are their own parts, not part of the body.
  const footerNames = Object.keys(zip.files).filter((n) => /^word\/footer\d*\.xml$/.test(n))
  const headerNames = Object.keys(zip.files).filter((n) => /^word\/header\d*\.xml$/.test(n))
  let pageFields = false
  for (const name of footerNames) {
    const part = await zip.file(name).async('string')
    if (/PAGE|NUMPAGES/.test(part)) pageFields = true
  }

  if (!headings) note(file, 'no headings: the outline would be flat')
  if (!toc) note(file, 'no contents field')
  if (!footerNames.length) note(file, 'no footer')
  if (!headerNames.length) note(file, 'no running header')
  if (!pageFields) note(file, 'no page numbers in the footer')

  console.log(
    `  ${path.basename(file).padEnd(44)} ${String(headings).padStart(4)} headings  ${String(tables).padStart(3)} tables  ${String(media).padStart(3)} images  ${toc ? 'contents' : 'NO CONTENTS'}  ${pageFields ? 'numbered' : 'UNNUMBERED'}`
  )
}

console.log('')
if (problems.length) {
  console.log(`${problems.length} problem(s):`)
  for (const p of problems) console.log('  -', p)
  process.exitCode = 1
} else {
  console.log('No problems found.')
}
