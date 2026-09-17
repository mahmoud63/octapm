/**
 * Build the client documentation and the training kit.
 *
 *   node tools/publishing/build.mjs            everything
 *   node tools/publishing/build.mjs quick-start role-handbooks
 *
 * Every deliverable is assembled from the Markdown under docs/user-guide. None
 * of the text below is content: it is only the order the content is put in.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { EDITION, OUT, SOURCE, hex } from './brand.mjs'
import { demote, fitTables, pageBreak, parseMarkdown, readGuide, section } from './model.mjs'
import { renderHtml } from './render-html.mjs'
import { closePrinter, toPdf } from './pdf.mjs'
import { toDocx } from './render-docx.mjs'
import { logoPng } from './assets.mjs'
import { trainingMatrix } from './training-matrix.mjs'

const CLIENT = path.join(OUT, 'client')
const HANDBOOKS = path.join(CLIENT, 'role-handbooks')
const TRAINING = path.join(OUT, 'training')

const meta = (scope, kicker) => ({
  version: EDITION.version,
  edition: EDITION.edition,
  date: EDITION.date,
  scope,
  kicker: kicker ?? 'Construction project management platform',
})

const control = (extra = {}) => ({
  'Document version': EDITION.version,
  'OctaPM release': EDITION.product,
  'Publication date': EDITION.date,
  Status: EDITION.status,
  'Prepared for': EDITION.preparedFor,
  ...extra,
})

/**
 * Production notes are for the repository, not for the client. The workflow
 * guide ends each entry with the screen files that evidence it; a reader of the
 * printed manual has no use for a list of file names.
 */
const clientReady = (blocks) =>
  fitTables(
    blocks.filter((block) => {
      if (block.type !== 'para') return true
      const opening = (block.inline?.[0]?.text ?? '').trimStart()
      return !/^Screens?s*:/i.test(opening)
    })
  )

/** A heading that starts a new page, for the front of an appendix or part. */
const part = (text, level = 1) => [pageBreak(), { type: 'heading', level, text, inline: [{ text }] }]

const built = []

async function publish(spec, { pdf = true, docx = true } = {}) {
  const results = {}
  if (pdf) {
    const html = renderHtml(spec)
    results.pdf = await toPdf(html, spec.pdfFile, { title: spec.title, header: spec.header ?? spec.title })
  }
  if (docx) {
    results.docx = await toDocx({ ...spec, logoPng: spec.logoPng }, spec.docxFile)
  }
  built.push({ title: spec.title, ...results })
  const pages = results.pdf ? `${results.pdf.pages} pages` : ''
  const c = results.pdf?.contents
  const numbers = c && c.entries ? (c.numbered ? ' · contents numbered' : ` · CONTENTS UNNUMBERED (${c.found}/${c.entries} found, ordered=${c.ordered})`) : ''
  console.log(`  ${spec.title.padEnd(46)} ${pages}${numbers}`)
  return results
}

// ── The complete manual ────────────────────────────────────────────────────
async function completeManual(logo) {
  const guide = readGuide('OCTAPM_USER_GUIDE.md')
  const workflows = readGuide('OCTAPM_WORKFLOW_GUIDE.md')
  const responsibility = readGuide('OCTAPM_RESPONSIBILITY_GUIDE.md')
  const matrix = readGuide('OCTAPM_ROLE_FEATURE_MATRIX.md')
  const glossary = readGuide('OCTAPM_GLOSSARY.md')

  const blocks = [
    ...guide.blocks,
    ...part('Appendix A — Connected workflows in full'),
    ...demote(workflows.blocks, 1),
    ...part('Appendix B — Responsibility and handoffs'),
    ...demote(responsibility.blocks, 1),
    ...part('Appendix C — Role and feature matrix'),
    ...demote(matrix.blocks, 1),
    ...part('Appendix D — Glossary'),
    ...demote(glossary.blocks, 1),
  ]

  return publish({
    title: 'Complete User Manual',
    subtitle: 'Every module, every role, and the way the records connect.',
    tagline: 'Schedule · Cost · Commercial · Procurement · Quality',
    meta: meta('Pilot V1'),
    control: control({
      Sources: 'User Guide, Workflow Guide, Responsibility Guide, Role and Feature Matrix, Glossary',
      Validation: 'Every persona signed in and exercised in the product, September 2026',
    }),
    blocks: clientReady(blocks),
    logoPng: logo,
    pdfFile: path.join(CLIENT, 'OCTAPM_COMPLETE_USER_MANUAL.pdf'),
    docxFile: path.join(CLIENT, 'OCTAPM_COMPLETE_USER_MANUAL.docx'),
    header: 'OctaPM Complete User Manual',
  })
}

// ── Quick start ────────────────────────────────────────────────────────────
async function quickStart(logo) {
  const quick = readGuide('OCTAPM_QUICK_START.md')
  const workflows = readGuide('OCTAPM_WORKFLOW_GUIDE.md')
  const rfi = section(workflows, /^1\. RFI lifecycle/)

  const blocks = [
    ...quick.blocks,
    ...part('One workflow, end to end', 2),
    {
      type: 'para',
      inline: [
        {
          text: 'This is the shape of everything in OctaPM. One person raises a record, it appears on somebody else’s list, the answer comes back, and the modules that care about it update themselves. Read this once and the rest of the product explains itself.',
        },
      ],
    },
    ...demote(rfi, 1),
  ]

  return publish({
    title: 'Quick Start',
    subtitle: 'Ten minutes to your first productive session.',
    tagline: 'Read this first',
    meta: meta('Pilot V1'),
    control: control({ Audience: 'Everyone, on their first day' }),
    blocks: clientReady(blocks),
    logoPng: logo,
    pdfFile: path.join(CLIENT, 'OCTAPM_QUICK_START.pdf'),
    docxFile: path.join(CLIENT, 'OCTAPM_QUICK_START.docx'),
    header: 'OctaPM Quick Start',
  })
}

// ── Role handbooks ─────────────────────────────────────────────────────────
const ROLES = [
  ['ADMIN', 'Administrator Handbook', 'Company setup · Master data · People · Permissions'],
  ['PROJECT_MANAGER', 'Project Manager Handbook', 'Project controls · Commercial · Approvals · Coordination'],
  ['PLANNER', 'Planner Handbook', 'Programme · Progress · Critical path · Lookahead'],
  ['QS_COMMERCIAL', 'QS and Commercial Handbook', 'Change · Valuation · Commitments · Certification'],
  ['COST_CONTROLLER', 'Cost Controller Handbook', 'Budget · Actual cost · Forecast · Variance'],
  ['PROCUREMENT', 'Procurement Handbook', 'Packages · Bids · Award · Purchase orders'],
  ['STOREKEEPER', 'Storekeeper Handbook', 'Goods receipt · Stock · Issue · Transfers'],
  ['SITE_ENGINEER', 'Site Engineer Handbook', 'Daily log · RFI · Progress · Materials'],
  ['QUALITY_ENGINEER', 'Quality Engineer Handbook', 'Inspections · NCR · Punch · Closeout'],
  ['FINANCE', 'Finance Handbook', 'Invoices · Payments · Cash flow'],
  ['SUPPLIER_BIDDER', 'Supplier and Bidder Handbook', 'Invitations · Pricing · Submission · Award'],
]

async function roleHandbooks(logo) {
  const matrix = readGuide('OCTAPM_ROLE_FEATURE_MATRIX.md')
  const results = []
  for (const [key, title, tagline] of ROLES) {
    const guide = parseMarkdown(path.join(SOURCE, 'roles', `${key}_GUIDE.md`))
    const blocks = [
      ...guide.blocks,
      ...part('How to read your permissions', 2),
      ...section(matrix, /^How to read/i).slice(1),
    ]
    results.push(
      await publish({
        title,
        subtitle: `What this role does in OctaPM, and how to do it.`,
        tagline,
        meta: meta('Pilot V1', 'Role handbook'),
        control: control({ Role: title.replace(' Handbook', ''), 'Companion documents': 'Quick Start, Complete User Manual' }),
        blocks: clientReady(blocks),
        logoPng: logo,
        pdfFile: path.join(HANDBOOKS, `OCTAPM_${key}_HANDBOOK.pdf`),
        docxFile: path.join(HANDBOOKS, `OCTAPM_${key}_HANDBOOK.docx`),
        header: `OctaPM ${title}`,
      })
    )
  }
  return results
}

// ── Training kit ───────────────────────────────────────────────────────────
async function trainingKit(logo) {
  const results = []
  const workbook = parseMarkdown(path.join(SOURCE, 'training', 'OCTAPM_TRAINING_UAT_WORKBOOK.md'))
  results.push(
    await publish({
      title: 'Training and UAT Workbook',
      subtitle: 'Four levels, from first sign-in to working unaided.',
      tagline: 'For trainers and participants',
      meta: meta('Pilot V1', 'Training kit'),
      control: control({ Audience: 'Trainers, participants, pilot observers' }),
      blocks: clientReady(workbook.blocks),
      logoPng: logo,
      pdfFile: path.join(TRAINING, 'OCTAPM_TRAINING_UAT_WORKBOOK.pdf'),
      docxFile: path.join(TRAINING, 'OCTAPM_TRAINING_UAT_WORKBOOK.docx'),
      header: 'OctaPM Training and UAT Workbook',
    })
  )

  const pack = parseMarkdown(path.join(SOURCE, 'training', 'OCTAPM_UAT_PARTICIPANT_PACK.md'))
  results.push(
    await publish({
      title: 'UAT Participant Pack',
      subtitle: 'Your role, your scenarios, and where to write what happened.',
      tagline: 'Bring this to the session',
      meta: meta('Pilot V1', 'Training kit'),
      control: control({ Audience: 'Participants' }),
      blocks: clientReady(pack.blocks),
      logoPng: logo,
      pdfFile: path.join(TRAINING, 'OCTAPM_UAT_PARTICIPANT_PACK.pdf'),
      docxFile: path.join(TRAINING, 'OCTAPM_UAT_PARTICIPANT_PACK.docx'),
      header: 'OctaPM UAT Participant Pack',
    })
  )

  const trainer = parseMarkdown(path.join(SOURCE, 'training', 'OCTAPM_TRAINER_GUIDE.md'))
  results.push(
    await publish({
      title: 'Trainer Guide',
      subtitle: 'How to run the sessions, and what not to give away.',
      tagline: 'Trainers only',
      meta: meta('Pilot V1', 'Training kit'),
      control: control({ Audience: 'Trainers and observers', Note: 'Not for participants: contains observation rules' }),
      blocks: clientReady(trainer.blocks),
      logoPng: logo,
      pdfFile: path.join(TRAINING, 'OCTAPM_TRAINER_GUIDE.pdf'),
      docxFile: path.join(TRAINING, 'OCTAPM_TRAINER_GUIDE.docx'),
      header: 'OctaPM Trainer Guide',
    })
  )
  return results
}

// ── Run ────────────────────────────────────────────────────────────────────
const only = process.argv.slice(2)
const wanted = (name) => only.length === 0 || only.includes(name)

await mkdir(CLIENT, { recursive: true })
await mkdir(HANDBOOKS, { recursive: true })
await mkdir(TRAINING, { recursive: true })

const logo = await logoPng(hex('indigo'))

console.log('Building from', path.relative(process.cwd(), SOURCE))
if (wanted('manual')) await completeManual(logo)
if (wanted('quick-start')) await quickStart(logo)
if (wanted('role-handbooks')) await roleHandbooks(logo)
if (wanted('training')) {
  await trainingKit(logo)
  const matrix = await trainingMatrix()
  console.log(`  ${'Training matrix (workbook)'.padEnd(46)} ${matrix.sheets.length} sheets`)
}

await closePrinter()

await writeFile(
  path.join(OUT, '.build-report.json'),
  JSON.stringify(
    built.map((b) => ({
      title: b.title,
      pdf: b.pdf ? path.relative(OUT, b.pdf.file) : null,
      pages: b.pdf?.pages ?? null,
      tocNumbered: b.pdf?.toc?.ordered ?? null,
      docx: b.docx ? path.relative(OUT, b.docx.file) : null,
      docxBytes: b.docx?.bytes ?? null,
      figures: b.docx?.figures ?? null,
    })),
    null,
    2
  )
)
console.log(`\n${built.length} documents built into ${path.relative(process.cwd(), OUT)}`)
