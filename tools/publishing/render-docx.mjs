/**
 * The same document model, written as Word.
 *
 * Word gets a real heading outline, a contents field it fills in itself, and
 * running headers and footers, so the file behaves like a document someone can
 * edit rather than a picture of one. The cover is white with an indigo band:
 * a full-bleed dark page does not survive a desk printer.
 */
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { COLOUR, EDITION, FONT } from './brand.mjs'

const CONTENT_W = 620 // px of usable width at the margins below
const PANEL = COLOUR.panel
const px = (n) => Math.round(n)

const sizeOf = (file) => {
  const b = readFileSync(file)
  if (b.slice(1, 4).toString() === 'PNG') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  return { w: 1440, h: 900 }
}

function runsOf(inline, base = {}) {
  const runs = []
  for (const run of inline) {
    if (run.image) continue
    if (run.break) {
      runs.push(new TextRun({ break: 1 }))
      continue
    }
    const text = run.text ?? ''
    if (!text) continue
    runs.push(
      new TextRun({
        text,
        bold: run.bold || base.bold,
        italics: run.italic || base.italics,
        font: run.code ? FONT.docxMono : base.font ?? FONT.docxBody,
        size: run.code ? 18 : base.size ?? 21,
        color: run.code ? COLOUR.indigo : run.href ? COLOUR.royal : base.color ?? COLOUR.charcoal,
        shading: run.code ? { type: ShadingType.CLEAR, fill: PANEL } : undefined,
      })
    )
  }
  return runs.length ? runs : [new TextRun({ text: '', size: 21 })]
}

const HEADING = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
}

function tableOf(block) {
  const columns = Math.max(block.head.length, ...block.rows.map((r) => r.length), 1)
  const cell = (content, head, even) =>
    new TableCell({
      shading: { type: ShadingType.CLEAR, fill: head ? COLOUR.indigo : even ? PANEL : 'FFFFFF' },
      margins: { top: 60, bottom: 60, left: 90, right: 90 },
      children: [
        new Paragraph({
          spacing: { before: 0, after: 0 },
          children: runsOf(content ?? [], {
            bold: head,
            color: head ? 'FFFFFF' : COLOUR.charcoal,
            size: columns > 5 ? 16 : 18,
            font: head ? FONT.docxDisplay : FONT.docxBody,
          }),
        }),
      ],
    })

  const rows = []
  if (block.head.length) {
    rows.push(
      new TableRow({
        tableHeader: true,
        children: Array.from({ length: columns }, (_, i) => cell(block.head[i], true, false)),
      })
    )
  }
  block.rows.forEach((row, index) => {
    rows.push(
      new TableRow({
        children: Array.from({ length: columns }, (_, i) => cell(row[i], false, index % 2 === 1)),
      })
    )
  })

  const edge = { style: BorderStyle.SINGLE, size: 2, color: COLOUR.rule }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: edge, bottom: edge, left: edge, right: edge, insideHorizontal: edge, insideVertical: edge },
    rows,
  })
}

function blocksToDocx(blocks, state) {
  const out = []
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        out.push(
          new Paragraph({
            heading: HEADING[Math.min(block.level, 6)],
            spacing: { before: block.level <= 2 ? 300 : 220, after: 110 },
            keepNext: true,
            children: runsOf(block.inline, {
              font: FONT.docxDisplay,
              bold: true,
              color: block.level >= 3 ? COLOUR.royal : COLOUR.indigo,
              size: block.level === 1 ? 34 : block.level === 2 ? 26 : 22,
            }),
          })
        )
        break
      case 'para':
        out.push(new Paragraph({ spacing: { after: 130 }, children: runsOf(block.inline) }))
        break
      case 'list':
        for (const item of block.items) {
          out.push(
            new Paragraph({
              numbering: block.ordered ? { reference: 'ordered', level: 0 } : undefined,
              bullet: block.ordered ? undefined : { level: 0 },
              spacing: { after: 60 },
              children: runsOf(item.inline),
            })
          )
          for (const child of item.children ?? []) {
            for (const sub of child.items) {
              out.push(
                new Paragraph({
                  bullet: { level: 1 },
                  spacing: { after: 50 },
                  children: runsOf(sub.inline),
                })
              )
            }
          }
        }
        break
      case 'figure': {
        if (block.missing) break
        state.figure += 1
        const { w, h } = sizeOf(block.src)
        const width = CONTENT_W
        const height = px((h / w) * width)
        out.push(
          new Paragraph({
            spacing: { before: 120, after: 40 },
            keepNext: true,
            children: [
              new ImageRun({ type: 'png', data: readFileSync(block.src), transformation: { width, height } }),
            ],
          })
        )
        if (block.caption) {
          out.push(
            new Paragraph({
              spacing: { after: 170 },
              children: [
                new TextRun({
                  text: `Figure ${state.figure}. ${block.caption}`,
                  size: 17,
                  color: COLOUR.muted,
                  font: FONT.docxDisplay,
                }),
              ],
            })
          )
        }
        break
      }
      case 'diagram':
      case 'code':
        out.push(
          new Paragraph({
            spacing: { before: 100, after: 150 },
            shading: { type: ShadingType.CLEAR, fill: PANEL },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: block.type === 'diagram' ? COLOUR.azure : COLOUR.rule } },
            children: block.text.split('\n').flatMap((line, i) => [
              ...(i ? [new TextRun({ break: 1 })] : []),
              new TextRun({ text: line, font: FONT.docxMono, size: 16, color: COLOUR.indigo }),
            ]),
          })
        )
        break
      case 'callout':
        out.push(
          new Paragraph({
            spacing: { before: 100, after: 150 },
            shading: { type: ShadingType.CLEAR, fill: 'F2FBFC' },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: COLOUR.turquoise } },
            children: runsOf(block.inline, { size: 19 }),
          })
        )
        break
      case 'quote':
        out.push(
          new Paragraph({
            spacing: { before: 100, after: 150 },
            indent: { left: 360 },
            border: { left: { style: BorderStyle.SINGLE, size: 10, color: COLOUR.rule } },
            children: runsOf(block.inline, { color: COLOUR.muted, italics: true }),
          })
        )
        break
      case 'table':
        out.push(tableOf(block))
        out.push(new Paragraph({ spacing: { after: 160 }, children: [] }))
        break
      case 'rule':
        out.push(
          new Paragraph({
            spacing: { before: 160, after: 160 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOUR.rule } },
            children: [],
          })
        )
        break
      case 'pagebreak':
        out.push(new Paragraph({ children: [new PageBreak()] }))
        break
      default:
        break
    }
  }
  return out
}

function coverParagraphs({ title, subtitle, tagline, meta, logoPng }) {
  const band = (text, opts = {}) =>
    new Paragraph({
      spacing: { after: opts.after ?? 60 },
      children: [new TextRun({ text, ...opts.run })],
    })

  const out = []
  if (logoPng) {
    const { w, h } = sizeOf(logoPng)
    out.push(
      new Paragraph({
        spacing: { after: 420 },
        children: [
          new ImageRun({ type: 'png', data: readFileSync(logoPng), transformation: { width: 210, height: px((h / w) * 210) } }),
        ],
      })
    )
  }
  out.push(
    band(meta.kicker.toUpperCase(), {
      after: 130,
      run: { size: 17, bold: true, color: COLOUR.royal, font: FONT.docxDisplay, characterSpacing: 60 },
    })
  )
  out.push(
    new Paragraph({
      spacing: { after: subtitle ? 120 : 260 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: COLOUR.royal } },
      children: [new TextRun({ text: title, size: 60, bold: true, color: COLOUR.indigo, font: FONT.docxDisplay })],
    })
  )
  if (subtitle) {
    out.push(band(subtitle, { after: 120, run: { size: 26, color: COLOUR.charcoal, font: FONT.docxDisplay } }))
  }
  if (tagline) {
    out.push(band(tagline.toUpperCase(), { after: 420, run: { size: 17, bold: true, color: COLOUR.turquoise, font: FONT.docxDisplay, characterSpacing: 40 } }))
  }
  const facts = [
    ['Version', meta.version],
    ['Edition', meta.edition],
    ['Date', meta.date],
    ['Scope', meta.scope],
    ['Status', EDITION.status],
  ]
  out.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: COLOUR.rule },
        insideVertical: { style: BorderStyle.NONE },
      },
      rows: facts.map(
        ([k, v]) =>
          new TableRow({
            children: [
              new TableCell({
                width: { size: 28, type: WidthType.PERCENTAGE },
                margins: { top: 70, bottom: 70, left: 0, right: 80 },
                children: [new Paragraph({ children: [new TextRun({ text: k.toUpperCase(), size: 15, bold: true, color: COLOUR.muted, font: FONT.docxDisplay })] })],
              }),
              new TableCell({
                margins: { top: 70, bottom: 70, left: 0, right: 0 },
                children: [new Paragraph({ children: [new TextRun({ text: v, size: 19, color: COLOUR.charcoal })] })],
              }),
            ],
          })
      ),
    })
  )
  out.push(new Paragraph({ children: [new PageBreak()] }))
  return out
}

export async function toDocx({ title, subtitle, tagline, meta, blocks, control, logoPng, toc = true }, outFile) {
  const state = { figure: 0 }

  const children = [...coverParagraphs({ title, subtitle, tagline, meta, logoPng })]

  if (control) {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { after: 160 }, children: [new TextRun({ text: 'Document control', font: FONT.docxDisplay, bold: true, size: 34, color: COLOUR.indigo })] }),
      tableOf({
        head: [[{ text: 'Item' }], [{ text: 'Detail' }]],
        rows: Object.entries(control).map(([k, v]) => [[{ text: k }], [{ text: v }]]),
      }),
      new Paragraph({ children: [new PageBreak()] })
    )
  }

  if (toc) {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { after: 160 }, children: [new TextRun({ text: 'Contents', font: FONT.docxDisplay, bold: true, size: 34, color: COLOUR.indigo })] }),
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({ text: 'Press Ctrl+A then F9 in Word to refresh the page numbers.', size: 17, color: COLOUR.muted, italics: true })],
      })
    )
    // A real Word field: Word numbers it when the document opens.
    const { TableOfContents } = await import('docx')
    children.push(new TableOfContents('Contents', { hyperlinks: true, headingStyleRange: '1-3' }))
    children.push(new Paragraph({ children: [new PageBreak()] }))
  }

  children.push(...blocksToDocx(blocks, state))

  const doc = new Document({
    creator: 'OctaPM',
    title,
    description: subtitle ?? title,
    styles: {
      default: {
        document: { run: { font: FONT.docxBody, size: 21, color: COLOUR.charcoal } },
      },
      paragraphStyles: [1, 2, 3, 4, 5, 6].map((level) => ({
        id: `Heading${level}`,
        name: `Heading ${level}`,
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: {
          font: FONT.docxDisplay,
          bold: true,
          size: level === 1 ? 34 : level === 2 ? 26 : level === 3 ? 22 : 20,
          color: level >= 3 ? COLOUR.royal : COLOUR.indigo,
        },
        paragraph: { spacing: { before: level <= 2 ? 300 : 220, after: 110 }, keepNext: true },
      })),
    },
    numbering: {
      config: [
        {
          reference: 'ordered',
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 460, hanging: 260 } } } },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1000, bottom: 900, left: 1080, right: 1080, header: 500, footer: 450 } },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { after: 0 },
                children: [new TextRun({ text: `${title} · ${meta.edition}`, size: 15, color: COLOUR.muted })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                spacing: { before: 0 },
                border: { top: { style: BorderStyle.SINGLE, size: 4, color: COLOUR.rule } },
                tabStops: [{ type: 'right', position: 9700 }],
                children: [
                  new TextRun({ text: `OctaPM · ${meta.version} · ${meta.date}`, size: 15, color: COLOUR.muted }),
                  new TextRun({ text: '\t', size: 15 }),
                  new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 15, color: COLOUR.muted }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  })

  const bytes = await Packer.toBuffer(doc)
  await mkdir(path.dirname(outFile), { recursive: true })
  await writeFile(outFile, bytes)
  return { file: outFile, bytes: bytes.length, figures: state.figure }
}
