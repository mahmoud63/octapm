/**
 * The document model, set for print.
 *
 * The page is white and the ink is sparing: one dark page at the front and
 * nothing else that would empty a toner cartridge. Headings never end a page
 * alone, figures and tables never split across one, and every screenshot is
 * framed the same width so a reader can compare two pages without noticing the
 * page.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { COLOUR, FONT, WEB_FONTS, hex, lockupSvg, markSvg } from './brand.mjs'

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const dataUri = (file) => {
  const ext = path.extname(file).toLowerCase()
  const type = ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : 'image/jpeg'
  return `data:${type};base64,${readFileSync(file).toString('base64')}`
}

function inlineHtml(inline) {
  return inline
    .map((run) => {
      if (run.image) return ''
      let text = escapeHtml(run.text ?? '')
      if (run.break) return '<br>'
      if (run.code) text = `<code>${text}</code>`
      if (run.bold) text = `<strong>${text}</strong>`
      if (run.italic) text = `<em>${text}</em>`
      // Links to other documents in the set are printed as plain words: a
      // reader on paper cannot follow them, and the set travels as one bundle.
      if (run.href && /^https?:/.test(run.href)) text = `<a href="${escapeHtml(run.href)}">${text}</a>`
      return text
    })
    .join('')
}

const slug = (text, seen) => {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section'
  let id = base
  let n = 2
  while (seen.has(id)) id = `${base}-${n++}`
  seen.add(id)
  return id
}

function listHtml(list) {
  const tag = list.ordered ? 'ol' : 'ul'
  const start = list.ordered && list.start !== 1 ? ` start="${list.start}"` : ''
  const items = list.items
    .map((item) => {
      const children = (item.children ?? []).map(listHtml).join('')
      return `<li>${inlineHtml(item.inline)}${children}</li>`
    })
    .join('')
  return `<${tag}${start}>${items}</${tag}>`
}

export function renderHtml({ title, subtitle, tagline, meta, blocks, control, toc = true, figurePrefix = 'Figure' }) {
  const seen = new Set()
  const headings = []
  let figure = 0

  const body = blocks
    .map((block) => {
      switch (block.type) {
        case 'heading': {
          const id = slug(block.text, seen)
          if (block.level <= 3) headings.push({ id, level: block.level, text: block.text })
          return `<h${block.level} id="${id}">${inlineHtml(block.inline)}</h${block.level}>`
        }
        case 'para':
          return `<p>${inlineHtml(block.inline)}</p>`
        case 'list':
          return listHtml(block)
        case 'figure': {
          if (block.missing) return ''
          figure += 1
          const caption = block.caption ? `<figcaption>${figurePrefix} ${figure}. ${escapeHtml(block.caption)}</figcaption>` : ''
          return `<figure><img src="${dataUri(block.src)}" alt="${escapeHtml(block.caption)}">${caption}</figure>`
        }
        case 'diagram':
          return `<pre class="diagram">${escapeHtml(block.text)}</pre>`
        case 'code':
          return `<pre class="code">${escapeHtml(block.text)}</pre>`
        case 'callout':
          return `<aside class="callout ${escapeHtml(block.kind)}">${inlineHtml(block.inline)}</aside>`
        case 'quote':
          return `<blockquote>${inlineHtml(block.inline)}</blockquote>`
        case 'table': {
          const head = block.head.length
            ? `<thead><tr>${block.head.map((c) => `<th>${inlineHtml(c)}</th>`).join('')}</tr></thead>`
            : ''
          const rows = block.rows
            .map((row) => `<tr>${row.map((c) => `<td>${inlineHtml(c)}</td>`).join('')}</tr>`)
            .join('')
          const wide = (block.head.length || block.rows[0]?.length || 0) >= 6
          return `<div class="table-wrap${wide ? ' wide' : ''}"><table>${head}<tbody>${rows}</tbody></table></div>`
        }
        case 'rule':
          return '<hr>'
        case 'pagebreak':
          return '<div class="pagebreak"></div>'
        default:
          return ''
      }
    })
    .join('\n')

  const tocHtml = toc
    ? `<section class="toc"><h1 class="plain">Contents</h1><ol class="toc-list">${headings
        .filter((h) => h.level <= 3)
        .map(
          (h) =>
            `<li class="lvl-${h.level}"><a href="#${h.id}"><span class="toc-text">${escapeHtml(h.text)}</span><span class="toc-dots"></span><span class="toc-page" data-for="${h.id}"></span></a></li>`
        )
        .join('')}</ol></section><div class="pagebreak"></div>`
    : ''

  const controlHtml = control
    ? `<section class="control"><h1 class="plain">Document control</h1><table class="control-table"><tbody>${Object.entries(
        control
      )
        .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
        .join('')}</tbody></table><p class="control-note">This document describes OctaPM as validated for the pilot. Where a feature is not available in this release, it is named as such rather than omitted.</p></section><div class="pagebreak"></div>`
    : ''

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${WEB_FONTS}">
<style>
  :root {
    --indigo: ${hex('indigo')};
    --royal: ${hex('royal')};
    --azure: ${hex('azure')};
    --turquoise: ${hex('turquoise')};
    --ink: ${hex('charcoal')};
    --muted: ${hex('muted')};
    --rule: ${hex('rule')};
    --panel: ${hex('panel')};
  }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    font-family: ${FONT.body};
    font-size: 10.5pt;
    line-height: 1.55;
    color: var(--ink);
    background: #fff;
  }
  h1, h2, h3, h4, h5, h6 { font-family: ${FONT.display}; color: var(--indigo); line-height: 1.2; break-after: avoid; page-break-after: avoid; }
  h1 { font-size: 21pt; margin: 0 0 14pt; padding-top: 4pt; }
  h2 { font-size: 15pt; margin: 20pt 0 8pt; }
  h3 { font-size: 12pt; margin: 15pt 0 6pt; color: var(--royal); }
  h4 { font-size: 10.5pt; margin: 12pt 0 4pt; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  h1 + *, h2 + *, h3 + * { break-before: avoid; page-break-before: avoid; }
  p { margin: 0 0 8pt; orphans: 2; widows: 2; }
  ul, ol { margin: 0 0 9pt; padding-left: 16pt; }
  li { margin: 0 0 3pt; }
  li > ul, li > ol { margin-top: 3pt; }
  a { color: var(--royal); text-decoration: none; }
  code { font-family: ${FONT.mono}; font-size: 9pt; background: var(--panel); padding: 0.5pt 3pt; border-radius: 2pt; }
  strong { font-weight: 600; color: var(--indigo); }

  /* ── Cover ───────────────────────────────────────────────────── */
  .cover {
    position: relative;
    height: 264mm;
    background: linear-gradient(150deg, ${hex('indigoDeep')} 0%, ${hex('indigo')} 52%, ${hex('royal')} 100%);
    color: #fff;
    padding: 26mm 20mm;
    display: flex;
    flex-direction: column;
  }
  .cover .logo { margin-bottom: auto; }
  .cover h1 { color: #fff; font-size: 34pt; margin: 0 0 6pt; letter-spacing: -0.01em; }
  .cover .kicker { font-size: 9.5pt; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(255,255,255,0.72); margin: 0 0 14pt; }
  .cover .sub { font-size: 13pt; color: rgba(255,255,255,0.88); margin: 0 0 26pt; max-width: 120mm; font-family: ${FONT.display}; }
  .cover .tagline { font-size: 10pt; color: ${hex('turquoise')}; letter-spacing: 0.1em; text-transform: uppercase; margin: 0 0 30pt; }
  .cover .meta { border-top: 1px solid rgba(255,255,255,0.28); padding-top: 12pt; display: flex; gap: 18mm; font-size: 9.5pt; }
  .cover .meta div span { display: block; color: rgba(255,255,255,0.6); font-size: 8pt; letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 2pt; }
  .pagebreak { break-after: page; page-break-after: always; height: 0; }

  /* ── Front matter ────────────────────────────────────────────── */
  h1.plain { border-bottom: 2pt solid var(--royal); padding-bottom: 6pt; }
  .control-table { width: 100%; border-collapse: collapse; margin-bottom: 10pt; }
  .control-table th { text-align: left; width: 42mm; padding: 5pt 8pt 5pt 0; color: var(--muted); font-weight: 600; font-size: 9.5pt; vertical-align: top; }
  .control-table td { padding: 5pt 0; border-bottom: 1px solid var(--rule); }
  .control-note { color: var(--muted); font-size: 9.5pt; margin-top: 10pt; }

  .toc-list { list-style: none; padding: 0; margin: 0; }
  .toc-list li { margin: 0; }
  .toc-list a { display: flex; align-items: baseline; gap: 4pt; color: var(--ink); padding: 2.6pt 0; border-bottom: 1px dotted transparent; }
  .toc-list .lvl-1 > a { font-family: ${FONT.display}; font-weight: 700; color: var(--indigo); margin-top: 8pt; font-size: 11pt; }
  .toc-list .lvl-2 > a { font-weight: 500; }
  .toc-list .lvl-3 > a { padding-left: 8mm; color: var(--muted); font-size: 9.5pt; }
  .toc-dots { flex: 1; border-bottom: 1px dotted ${hex('rule')}; transform: translateY(-2pt); }
  .toc-page { font-variant-numeric: tabular-nums; color: var(--indigo); font-weight: 600; font-size: 10pt; min-width: 9mm; text-align: right; font-family: ${FONT.display}; }

  /* ── Body furniture ──────────────────────────────────────────── */
  figure { margin: 10pt 0 12pt; break-inside: avoid; page-break-inside: avoid; }
  figure img { display: block; width: 100%; border: 1px solid var(--rule); border-radius: 3pt; }
  figcaption { font-size: 8.5pt; color: var(--muted); margin-top: 4pt; font-family: ${FONT.display}; }
  .table-wrap { break-inside: avoid; page-break-inside: avoid; margin: 8pt 0 12pt; }
  .table-wrap.wide { break-inside: auto; page-break-inside: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  thead th {
    background: var(--indigo); color: #fff; text-align: left; font-family: ${FONT.display};
    font-size: 8.5pt; letter-spacing: 0.04em; padding: 5pt 6pt; border: 1px solid var(--indigo);
  }
  td { padding: 4.5pt 6pt; border: 1px solid var(--rule); vertical-align: top; }
  tbody tr:nth-child(even) td { background: var(--panel); }
  .wide table { font-size: 8pt; }
  .wide td, .wide thead th { padding: 3.5pt 4pt; }

  pre.diagram {
    font-family: ${FONT.mono}; font-size: 8.5pt; line-height: 1.45; background: var(--panel);
    border-left: 3pt solid var(--azure); padding: 8pt 10pt; margin: 8pt 0 12pt; white-space: pre;
    overflow: hidden; break-inside: avoid; page-break-inside: avoid; color: var(--indigo);
  }
  pre.code {
    font-family: ${FONT.mono}; font-size: 8.5pt; background: var(--panel); border: 1px solid var(--rule);
    padding: 7pt 9pt; margin: 8pt 0 12pt; white-space: pre-wrap; word-break: break-word; break-inside: avoid;
  }
  aside.callout {
    border-left: 3pt solid var(--turquoise); background: #f2fbfc; padding: 7pt 10pt; margin: 8pt 0 12pt;
    font-size: 9.5pt; break-inside: avoid; page-break-inside: avoid;
  }
  aside.callout.warning, aside.callout.caution { border-left-color: ${hex('warning')}; background: #fffaf0; }
  blockquote { margin: 8pt 0 12pt; padding: 6pt 12pt; border-left: 3pt solid var(--rule); color: var(--muted); }
  hr { border: 0; border-top: 1px solid var(--rule); margin: 16pt 0; }
</style>
</head>
<body>
<section class="cover">
  <div class="logo">${lockupSvg('#ffffff', 38)}</div>
  <p class="kicker">${escapeHtml(meta.kicker ?? 'Construction project management platform')}</p>
  <h1>${escapeHtml(title)}</h1>
  ${subtitle ? `<p class="sub">${escapeHtml(subtitle)}</p>` : ''}
  ${tagline ? `<p class="tagline">${escapeHtml(tagline)}</p>` : ''}
  <div class="meta">
    <div><span>Version</span>${escapeHtml(meta.version)}</div>
    <div><span>Edition</span>${escapeHtml(meta.edition)}</div>
    <div><span>Date</span>${escapeHtml(meta.date)}</div>
    <div><span>Scope</span>${escapeHtml(meta.scope)}</div>
  </div>
</section>
<div class="pagebreak"></div>
${controlHtml}
${tocHtml}
<main>
${body}
</main>
</body></html>`
}

export const footerTemplate = (title) => `
<div style="width:100%; font-family:${FONT.body.replace(/'/g, '')}; font-size:7.5pt; color:${hex('muted')};
            padding:0 18mm; display:flex; justify-content:space-between; align-items:center;">
  <span style="display:flex; align-items:center; gap:5px;">
    <img src="${'data:image/svg+xml;base64,' + Buffer.from(markSvg(hex('royal'), 9), 'utf8').toString('base64')}" style="height:9px;">
    ${escapeHtml(title)}
  </span>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`

export const headerTemplate = (right) => `
<div style="width:100%; font-family:${FONT.body.replace(/'/g, '')}; font-size:7.5pt; color:${hex('muted')};
            padding:0 18mm; text-align:right;">${escapeHtml(right)}</div>`
