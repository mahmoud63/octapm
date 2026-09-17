/**
 * The canonical Markdown, read into one document model.
 *
 * Both the PDF and the Word file are rendered from this model, so a sentence
 * exists once, in docs/user-guide, and the deliverables cannot drift from it or
 * from each other.
 *
 * Blocks: heading, para, list, table, figure, diagram, code, quote, rule,
 *         callout, pagebreak
 * Inline: { text, bold, italic, code, href }
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import MarkdownIt from 'markdown-it'
import { IMAGES, SOURCE } from './brand.mjs'

const md = new MarkdownIt({ html: false, linkify: false, typographer: false })

/** A fenced block that is really a flow diagram, not code. */
const looksLikeDiagram = (text) =>
  /[─│┌┐└┘├┤┬┴┼►▶→>]|-->|──|\|\s*$/m.test(text) && !/[;{}]/.test(text)

/** Callouts are written as a bold lead-in on a quoted line. */
const CALLOUT = /^(Note|Warning|Caution|Tip|Remember|Important)\b[:.]?\s*/i

function inlineOf(token) {
  const out = []
  let bold = 0
  let italic = 0
  let href = null
  for (const child of token.children ?? []) {
    switch (child.type) {
      case 'text':
        if (child.content) out.push({ text: child.content, bold: bold > 0, italic: italic > 0, href })
        break
      case 'code_inline':
        out.push({ text: child.content, code: true, bold: bold > 0, italic: italic > 0, href })
        break
      case 'strong_open':
        bold += 1
        break
      case 'strong_close':
        bold -= 1
        break
      case 'em_open':
        italic += 1
        break
      case 'em_close':
        italic -= 1
        break
      case 'link_open':
        href = child.attrGet('href')
        break
      case 'link_close':
        href = null
        break
      case 'softbreak':
        out.push({ text: ' ' })
        break
      case 'hardbreak':
        out.push({ text: '\n', break: true })
        break
      case 'image': {
        const src = child.attrGet('src')
        out.push({ image: src, text: child.content })
        break
      }
      default:
        break
    }
  }
  return out
}

const flatten = (inline) => inline.map((run) => run.text ?? '').join('')

/**
 * Every image in a paragraph becomes a figure of its own, with its alt text as
 * the caption. Two screenshots written on consecutive lines are one paragraph
 * as far as Markdown is concerned, so this has to handle more than one.
 */
function figuresFrom(inline, file) {
  const images = inline.filter((run) => run.image)
  if (!images.length) return null
  const words = inline
    .filter((run) => !run.image)
    .map((run) => run.text ?? '')
    .join('')
    .trim()
  // A sentence wrapped around an image is prose, not a plate; leave it alone.
  if (words) return null
  return images.map((run) => {
    const resolved = path.resolve(path.dirname(file), run.image)
    return {
      type: 'figure',
      src: existsSync(resolved) ? resolved : path.join(IMAGES, path.basename(run.image)),
      caption: run.text || '',
      missing: !existsSync(resolved),
    }
  })
}

export function parseMarkdown(file) {
  const text = readFileSync(file, 'utf8')
  const tokens = md.parse(text, {})
  const blocks = []
  let title = path.basename(file, '.md')
  let i = 0

  const listStack = []

  while (i < tokens.length) {
    const token = tokens[i]
    switch (token.type) {
      case 'heading_open': {
        const level = Number(token.tag.slice(1))
        const inline = inlineOf(tokens[i + 1])
        const plain = flatten(inline).trim()
        if (level === 1 && blocks.length === 0) title = plain
        else blocks.push({ type: 'heading', level, inline, text: plain })
        i += 3
        continue
      }
      case 'paragraph_open': {
        const inline = inlineOf(tokens[i + 1])
        const figures = figuresFrom(inline, file)
        if (figures) blocks.push(...figures)
        else {
          const plain = flatten(inline)
          const callout = CALLOUT.exec(plain)
          if (callout && inline[0]?.bold) {
            blocks.push({ type: 'callout', kind: callout[1].toLowerCase(), inline })
          } else if (plain.trim()) {
            blocks.push({ type: 'para', inline })
          }
        }
        i += 3
        continue
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        listStack.push({
          type: 'list',
          ordered: token.type === 'ordered_list_open',
          start: Number(token.attrGet('start') ?? 1),
          items: [],
        })
        i += 1
        continue
      }
      case 'bullet_list_close':
      case 'ordered_list_close': {
        const list = listStack.pop()
        if (listStack.length) {
          const parent = listStack[listStack.length - 1]
          const last = parent.items[parent.items.length - 1]
          if (last) last.children = [...(last.children ?? []), list]
        } else blocks.push(list)
        i += 1
        continue
      }
      case 'list_item_open': {
        listStack[listStack.length - 1]?.items.push({ inline: [], children: [] })
        i += 1
        continue
      }
      case 'inline': {
        const list = listStack[listStack.length - 1]
        if (list) {
          const item = list.items[list.items.length - 1]
          if (item) item.inline = [...item.inline, ...inlineOf(token)]
        }
        i += 1
        continue
      }
      case 'fence':
      case 'code_block': {
        const body = token.content.replace(/\s+$/, '')
        blocks.push(looksLikeDiagram(body) ? { type: 'diagram', text: body } : { type: 'code', text: body })
        i += 1
        continue
      }
      case 'table_open': {
        const table = { type: 'table', head: [], rows: [] }
        let inHead = false
        i += 1
        while (i < tokens.length && tokens[i].type !== 'table_close') {
          const t = tokens[i]
          if (t.type === 'thead_open') inHead = true
          if (t.type === 'thead_close') inHead = false
          if (t.type === 'tr_open') {
            const row = []
            i += 1
            while (tokens[i] && tokens[i].type !== 'tr_close') {
              if (tokens[i].type === 'inline') row.push(inlineOf(tokens[i]))
              i += 1
            }
            if (inHead) table.head = row
            else table.rows.push(row)
          }
          i += 1
        }
        blocks.push(table)
        i += 1
        continue
      }
      case 'blockquote_open': {
        const quote = { type: 'quote', inline: [] }
        i += 1
        while (i < tokens.length && tokens[i].type !== 'blockquote_close') {
          if (tokens[i].type === 'inline') quote.inline = [...quote.inline, ...inlineOf(tokens[i])]
          i += 1
        }
        blocks.push(quote)
        i += 1
        continue
      }
      case 'hr':
        blocks.push({ type: 'rule' })
        i += 1
        continue
      default:
        i += 1
    }
  }

  return { file, title, blocks }
}

export const readGuide = (name) => parseMarkdown(path.join(SOURCE, name))

/** Everything under a heading that matches, up to the next heading of that level or higher. */
export function section(doc, matcher, { include = true } = {}) {
  const out = []
  let level = null
  for (const block of doc.blocks) {
    if (level === null) {
      if (block.type === 'heading' && matcher.test(block.text)) {
        level = block.level
        if (include) out.push(block)
      }
      continue
    }
    if (block.type === 'heading' && block.level <= level) break
    out.push(block)
  }
  return out
}

/** Drop a section (and its contents) from a document's blocks. */
export function without(blocks, matcher) {
  const out = []
  let skipping = null
  for (const block of blocks) {
    if (skipping !== null) {
      if (block.type === 'heading' && block.level <= skipping) skipping = null
      else continue
    }
    if (block.type === 'heading' && matcher.test(block.text)) {
      skipping = block.level
      continue
    }
    out.push(block)
  }
  return out
}

/** Push every heading down by n, so a guide can sit inside a manual. */
export const demote = (blocks, n = 1) =>
  blocks.map((b) => (b.type === 'heading' ? { ...b, level: Math.min(6, b.level + n) } : b))

export const pageBreak = () => ({ type: 'pagebreak' })

/**
 * A table wider than the page is a table nobody can read.
 *
 * Anything past the limit is split into several tables, each keeping the first
 * column — which in every table here is the thing being described — so each
 * part still says what its rows are about. The alternative, shrinking the type
 * until it fits, produces a page that is present but useless.
 */
export function fitTables(blocks, limit = 7) {
  const out = []
  for (const block of blocks) {
    const columns = block.type === 'table' ? Math.max(block.head.length, ...block.rows.map((r) => r.length), 0) : 0
    if (columns <= limit) {
      out.push(block)
      continue
    }
    const perPart = limit - 1
    const parts = Math.ceil((columns - 1) / perPart)
    for (let part = 0; part < parts; part += 1) {
      const from = 1 + part * perPart
      const to = Math.min(columns, from + perPart)
      const take = (row) => [row[0], ...row.slice(from, to)]
      out.push({
        type: 'table',
        head: block.head.length ? take(block.head) : [],
        rows: block.rows.map(take),
      })
      if (part < parts - 1) {
        out.push({
          type: 'para',
          inline: [{ text: `The same rows continue below, against the remaining columns.`, italic: true }],
        })
      }
    }
  }
  return out
}
