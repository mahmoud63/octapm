/**
 * The training matrix, as a workbook a trainer can actually fill in.
 *
 * Four sheets: who was trained and how it went, the scenarios to assign, a
 * certification page per participant, and the findings raised on the day. It
 * ships empty on purpose — inventing participants would put made-up results in
 * front of a client.
 */
import path from 'node:path'
import ExcelJS from 'exceljs'
import { COLOUR, EDITION, OUT } from './brand.mjs'

const INDIGO = { argb: `FF${COLOUR.indigo}` }
const PANEL = { argb: `FF${COLOUR.panel}` }
const RULE = { argb: `FF${COLOUR.rule}` }

const header = (sheet, row) => {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: INDIGO }
  row.alignment = { vertical: 'middle', wrapText: true }
  row.height = 30
  sheet.views = [{ state: 'frozen', ySplit: row.number }]
}

const bordered = (sheet, fromRow, toRow, columns) => {
  for (let r = fromRow; r <= toRow; r += 1) {
    for (let c = 1; c <= columns; c += 1) {
      const cell = sheet.getCell(r, c)
      cell.border = {
        top: { style: 'thin', color: RULE },
        left: { style: 'thin', color: RULE },
        bottom: { style: 'thin', color: RULE },
        right: { style: 'thin', color: RULE },
      }
      if (r % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: PANEL }
      cell.alignment = { vertical: 'top', wrapText: true }
    }
  }
}

const ROLES = [
  'Administrator',
  'Project Manager',
  'Planner',
  'QS / Commercial',
  'Cost Controller',
  'Procurement',
  'Storekeeper',
  'Site Engineer',
  'Quality Engineer',
  'Finance',
  'Supplier / Bidder',
]

const SCENARIOS = [
  ['UAT-01', 'RFI lifecycle', 'Site Engineer, Project Manager', 'Answer on record, RFI closed, raiser saw it unprompted'],
  ['UAT-02', 'RFI leading to a change', 'Site Engineer, QS, Project Manager', 'Change cites the RFI; revised budget moves after approval'],
  ['UAT-03', 'RFQ to bid to award to order', 'Procurement, two Suppliers', 'Order exists, names the winner, committed to the budget'],
  ['UAT-04', 'Order to receipt to stock to issue to cost', 'Storekeeper, Site Engineer, Cost Controller', 'Cost found against the right activity, unprompted'],
  ['UAT-05', 'Timesheet to labour cost', 'Site Engineer, Project Manager, Cost Controller', 'Labour lands on the activity and in the forecast'],
  ['UAT-06', 'Pay application to certification to payment', 'QS, Project Manager, Finance', 'Certified and paid values agree; cash flow reflects it'],
  ['UAT-07', 'Change to revised budget to forecast', 'QS, Project Manager, Cost Controller', 'Movement explainable from the record alone'],
  ['UAT-08', 'Inspection to non-conformance to closeout', 'Quality Engineer, responsible party', 'Closed by the Quality Engineer, not by the fixer'],
  ['UAT-09', 'Meeting to action to task', 'Project Manager and two others', 'Each owner finds their action without a link'],
  ['UAT-10', 'Document and submittal review', 'Site Engineer or Planner, reviewer, PM', 'Current version obvious to somebody uninvolved'],
]

const INDEPENDENT = [
  ['IND-01', 'Site Engineer', 'Unclear drawing detail before a pour', 10],
  ['IND-02', 'Project Manager', 'Explain the forecast overrun to the client', 12],
  ['IND-03', 'QS / Commercial', 'Price and evidence unbilled blockwork', 12],
  ['IND-04', 'Procurement', 'Buy reinforcement against compared quotes', 15],
  ['IND-05', 'Storekeeper', 'Receive a delivery and issue half of it', 10],
  ['IND-06', 'Quality Engineer', 'Record and close a cover-depth failure', 12],
  ['IND-07', 'Cost Controller', 'Find what is driving a substructure overrun', 10],
  ['IND-08', 'Planner', 'Show the critical path behind a slip', 12],
  ['IND-09', 'Finance', 'Decide whether a chasing supplier is owed', 10],
  ['IND-10', 'Administrator', 'Set up a new surveyor on one project only', 10],
]

export async function trainingMatrix() {
  const book = new ExcelJS.Workbook()
  book.creator = 'OctaPM'
  book.created = new Date()
  book.title = `OctaPM Training Matrix — ${EDITION.edition}`

  // ── Participants ────────────────────────────────────────────────────────
  const people = book.addWorksheet('Participants', { properties: { defaultRowHeight: 18 } })
  people.columns = [
    { header: 'Participant', width: 24 },
    { header: 'Usual job', width: 20 },
    { header: 'OctaPM role', width: 18 },
    { header: 'Guide issued', width: 12 },
    { header: 'Level 1', width: 10 },
    { header: 'Level 2', width: 10 },
    { header: 'Level 3', width: 10 },
    { header: 'Scenarios assigned', width: 22 },
    { header: 'Scenarios passed', width: 14 },
    { header: 'Assistance count', width: 14 },
    { header: 'Completion %', width: 13 },
    { header: 'Confidence 1-5', width: 13 },
    { header: 'Open findings', width: 16 },
    { header: 'Certified for pilot', width: 18 },
  ]
  header(people, people.getRow(1))
  for (let r = 2; r <= 26; r += 1) {
    people.getCell(r, 3).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${ROLES.join(',')}"`] }
    for (const c of [4, 5, 6, 7]) {
      people.getCell(r, c).dataValidation = { type: 'list', allowBlank: true, formulae: ['"YES,NO"'] }
    }
    people.getCell(r, 12).dataValidation = { type: 'list', allowBlank: true, formulae: ['"1,2,3,4,5"'] }
    people.getCell(r, 14).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"CERTIFIED FOR PILOT,REQUIRES ADDITIONAL TRAINING,NOT YET CERTIFIED"'],
    }
  }
  bordered(people, 2, 26, 14)

  // ── Scenarios ───────────────────────────────────────────────────────────
  const scenarios = book.addWorksheet('Scenarios')
  scenarios.columns = [
    { header: 'Reference', width: 12 },
    { header: 'Scenario', width: 38 },
    { header: 'Roles involved', width: 34 },
    { header: 'Passes when', width: 52 },
    { header: 'Assigned to', width: 22 },
    { header: 'Result', width: 14 },
    { header: 'Notes', width: 40 },
  ]
  header(scenarios, scenarios.getRow(1))
  let row = 2
  scenarios.getCell(row, 1).value = 'Level 3 — connected team scenarios'
  scenarios.getRow(row).font = { bold: true, color: { argb: `FF${COLOUR.royal}` } }
  row += 1
  for (const s of SCENARIOS) {
    scenarios.getRow(row).values = [...s, '', '', '']
    scenarios.getCell(row, 6).dataValidation = { type: 'list', allowBlank: true, formulae: ['"PASS,FAIL,NOT RUN"'] }
    row += 1
  }
  row += 1
  scenarios.getCell(row, 1).value = 'Level 4 — independent certification'
  scenarios.getRow(row).font = { bold: true, color: { argb: `FF${COLOUR.royal}` } }
  row += 1
  for (const [ref, role, background, minutes] of INDEPENDENT) {
    scenarios.getRow(row).values = [ref, background, role, `Target ${minutes} minutes, unaided`, '', '', '']
    scenarios.getCell(row, 6).dataValidation = { type: 'list', allowBlank: true, formulae: ['"PASS,FAIL,NOT RUN"'] }
    row += 1
  }
  bordered(scenarios, 3, row - 1, 7)

  // ── Certification ───────────────────────────────────────────────────────
  const certificate = book.addWorksheet('Certification')
  certificate.columns = [{ width: 30 }, { width: 62 }]
  const fields = [
    'Participant',
    'Role',
    'Training date',
    'Scenarios completed',
    'Independent success rate',
    'Critical errors',
    'Assistance required',
    'Trainer notes',
    'Result',
  ]
  certificate.getCell('A1').value = 'OctaPM role certification'
  certificate.getCell('A1').font = { bold: true, size: 14, color: { argb: `FF${COLOUR.indigo}` } }
  certificate.getCell('A2').value = `${EDITION.product} · ${EDITION.edition} · one sheet per participant`
  certificate.getCell('A2').font = { italic: true, color: { argb: `FF${COLOUR.muted}` } }
  fields.forEach((field, i) => {
    const r = i + 4
    certificate.getCell(r, 1).value = field
    certificate.getCell(r, 1).font = { bold: true, color: { argb: `FF${COLOUR.indigo}` } }
    certificate.getCell(r, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: PANEL }
    certificate.getRow(r).height = field === 'Trainer notes' ? 60 : 22
  })
  certificate.getCell(fields.indexOf('Result') + 4, 2).dataValidation = {
    type: 'list',
    allowBlank: true,
    formulae: ['"CERTIFIED FOR PILOT,REQUIRES ADDITIONAL TRAINING,NOT YET CERTIFIED"'],
  }
  bordered(certificate, 4, fields.length + 3, 2)

  // ── Findings ────────────────────────────────────────────────────────────
  const findings = book.addWorksheet('Findings')
  findings.columns = [
    { header: 'Reference', width: 12 },
    { header: 'Date', width: 12 },
    { header: 'Participant', width: 20 },
    { header: 'Role', width: 18 },
    { header: 'Scenario', width: 14 },
    { header: 'What was expected', width: 40 },
    { header: 'What happened', width: 44 },
    { header: 'Severity', width: 12 },
    { header: 'Kind', width: 22 },
    { header: 'Existing finding', width: 16 },
    { header: 'Status', width: 14 },
  ]
  header(findings, findings.getRow(1))
  for (let r = 2; r <= 41; r += 1) {
    findings.getCell(r, 8).dataValidation = { type: 'list', allowBlank: true, formulae: ['"UAT-P0,UAT-P1,UAT-P2,UAT-P3"'] }
    findings.getCell(r, 9).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"TRAINING GAP,UX DEFECT,PRODUCT DEFECT,PERMISSION ISSUE,DATA ISSUE,DOCUMENTATION ISSUE"'],
    }
    findings.getCell(r, 11).dataValidation = { type: 'list', allowBlank: true, formulae: ['"OPEN,TRIAGED,FIXED,WONT FIX"'] }
  }
  bordered(findings, 2, 41, 11)

  const file = path.join(OUT, 'training', 'OCTAPM_TRAINING_MATRIX.xlsx')
  await book.xlsx.writeFile(file)
  return { file, sheets: book.worksheets.map((w) => w.name) }
}

if (process.argv[1]?.endsWith('training-matrix.mjs')) {
  const result = await trainingMatrix()
  console.log('written', result.file, '·', result.sheets.join(', '))
}
