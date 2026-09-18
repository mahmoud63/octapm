// Renders docs/mobile/OCTAPM_MOBILE_PERMISSION_MATRIX.md from shared/permissions.json,
// the same policy file the backend enforces. Run from mobile/: node scripts/permission-matrix.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const policy = JSON.parse(fs.readFileSync(path.join(root, 'shared', 'permissions.json'), 'utf8'))
const out = path.join(root, 'docs', 'mobile', 'OCTAPM_MOBILE_PERMISSION_MATRIX.md')

const short = { pm: 'PM', planning_eng: 'Plan', qs: 'QS', cost_controller: 'Cost', procurement: 'Proc', warehouse: 'Store', site_engineer: 'Site', quality_engineer: 'Qual', finance: 'Fin' }
const milestone = {
  rfi: 'M2', task: 'M2', document_control: 'M2', submittal: 'M2', progress: 'M3', schedule: 'M3', lookahead: 'M3', inspection: 'M4', ncr: 'M4', punch: 'M4', safety: 'M4',
  inventory: 'M5', procurement: 'M5/M6', change_event: 'M6', workflow: 'M6', commitment: 'M6 (view)', sub_pay_app: 'M6 (view/submit)', meeting: 'M2 (view)', conversation: 'M1 (view)',
  location: 'M2 (pick)', timesheet: 'M3', risk: 'M3 (view)', custom_field: 'M2', assistant: 'later', ipc: 'web only', cost: 'web only', boq: 'web only', bid: 'web only', eot: 'web only',
  change_order: 'M6 (view)', report: 'web only', portfolio: 'web only', audit: 'M2 (history)', user_management: 'web only', project_parties: 'web only', bim: 'web only', email: 'web only',
}
const roles = policy.roles.map((r) => r.id)
const parties = policy.partyRoles.map((p) => p.id)
const tick = (list, role) => (list.includes(role) ? '✓' : '·')

const lines = []
lines.push('# OctaPM Mobile — Permission Matrix')
lines.push('')
lines.push(`**Source:** generated from \`shared/permissions.json\` (policy version ${policy.version}) by \`mobile/scripts/permission-matrix.mjs\` on ${new Date().toISOString().slice(0, 10)}. Do not edit by hand; regenerate after a policy change. The backend enforces this same file; the app never grants what is not here.`)
lines.push('')
lines.push('**How the app uses it.** The server is the authority: every request is authorized on the server with the access token, and `GET /auth/me/permissions?projectId=` returns the effective matrix for the signed-in person on a project (org role, project assignment, party role and permission templates resolved). The app reads that answer to decide what to render. The tables below are the org-role baseline from the shared policy; a project template can narrow or widen them, which is why the server answer wins. A `403` from the server is always a refusal for that record, never a reason to sign out.')
lines.push('')
lines.push('**Reading the tables.** Role columns: ' + roles.map((r) => `${short[r]} = ${policy.roles.find((x) => x.id === r).label}`).join(', ') + '. Actions are the nine policy actions; transitions are the named workflow steps a route additionally requires. The "Mobile" column says in which milestone of the implementation plan the module reaches the app, or that it stays web-only.')
lines.push('')
lines.push('## Module overview')
lines.push('')
lines.push('| Module | Mobile | ' + roles.map((r) => short[r]).join(' | ') + ' | Parties with read |')
lines.push('|---|---|' + roles.map(() => '---').join('|') + '|---|')
for (const [key, mod] of Object.entries(policy.modules)) {
  const level = (role) => {
    const a = mod.actions
    if (a.approve?.includes(role) || a.certify?.includes(role)) return 'approve'
    if (a.create?.includes(role) || a.update?.includes(role) || a.submit?.includes(role)) return 'edit'
    if (a.read?.includes(role)) return 'view'
    return '·'
  }
  const partyRead = parties.filter((p) => policy.partyPermissions[p]?.modules?.[key]?.actions?.includes('read'))
  lines.push(`| ${mod.label} (\`${key}\`) | ${milestone[key] ?? '—'} | ${roles.map(level).join(' | ')} | ${partyRead.join(', ') || '—'} |`)
}
lines.push('')
lines.push('Levels: **approve** = holds approve or certify; **edit** = create, update or submit; **view** = read only; · = no access.')
lines.push('')
lines.push('## Per module')
lines.push('')
for (const [key, mod] of Object.entries(policy.modules)) {
  lines.push(`### ${mod.label} (\`${key}\`) — mobile: ${milestone[key] ?? '—'}`)
  lines.push('')
  lines.push('| Action | ' + roles.map((r) => short[r]).join(' | ') + ' |')
  lines.push('|---|' + roles.map(() => '---').join('|') + '|')
  for (const action of policy.actions) {
    const holders = mod.actions[action] ?? []
    if (holders.length === 0) continue
    lines.push(`| ${action} | ${roles.map((r) => tick(holders, r)).join(' | ')} |`)
  }
  const transitions = Object.entries(mod.transitions ?? {})
  if (transitions.length) {
    lines.push('')
    lines.push('Transitions: ' + transitions.map(([t, holders]) => `\`${t}\` → ${holders.map((h) => short[h] ?? h).join(', ') || 'nobody'}`).join('; ') + '.')
  }
  const partyRows = parties.map((p) => [p, policy.partyPermissions[p]?.modules?.[key]]).filter(([, m]) => m)
  if (partyRows.length) {
    lines.push('')
    lines.push('Parties: ' + partyRows.map(([p, m]) => `**${p}** ${m.actions.join('/')}${m.transitions?.length ? ' (' + m.transitions.join(', ') + ')' : ''}`).join('; ') + '.')
  }
  lines.push('')
}
lines.push('## What the app never does, whatever the matrix says')
lines.push('')
lines.push('- Approve, certify, record payments, transfer budget, activate or baseline schedule revisions, or post cost from a phone: these stay on the web platform even for roles that hold them, and the app hands over with a link.')
lines.push('- Set a status by editing a record. Every state change goes through the transition endpoint the API map lists, so the server applies its workflow rules.')
lines.push('- Compute a permission from a role name. The rendered matrix comes from the server for the current project.')
lines.push('')
fs.writeFileSync(out, lines.join('\n'))
console.log('written', out, lines.length, 'lines')
