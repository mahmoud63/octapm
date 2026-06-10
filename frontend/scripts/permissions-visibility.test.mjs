import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const policy = JSON.parse(
  readFileSync(
    new URL('../../shared/permissions.json', import.meta.url),
    'utf8'
  )
)

const canPerform = (role, moduleName, action, transition) => {
  const modulePolicy = policy.modules[moduleName]
  const allowedRoles =
    transition && modulePolicy.transitions?.[transition]
      ? modulePolicy.transitions[transition]
      : modulePolicy.actions[action]

  return allowedRoles.includes(role)
}

const cases = [
  ['planning_eng', 'schedule', 'submit', 'revision.submit_review', true],
  ['planning_eng', 'schedule', 'approve', 'revision.approve', false],
  ['site_engineer', 'progress', 'submit', 'submission.submit', true],
  ['site_engineer', 'progress', 'approve', 'submission.approve', false],
  ['qs', 'progress', 'approve', 'submission.approve', true],
  ['finance', 'ipc', 'certify', 'period.certify', true],
  ['finance', 'ipc', 'submit', 'period.submit', false],
  ['finance', 'ipc', 'approve', 'invoice.issue', true],
  ['finance', 'ipc', 'approve', 'payment.record', true],
  ['qs', 'ipc', 'approve', 'payment.record', false],
  ['qs', 'ipc', 'approve', 'retention.release', false],
  ['cost_controller', 'cost', 'update', 'activity_cost.update', true],
  ['procurement', 'cost', 'update', 'activity_cost.update', false],
  ['procurement', 'procurement', 'create', 'po.issue', true],
  ['warehouse', 'procurement', 'create', 'po.issue', false],
  ['warehouse', 'procurement', 'submit', 'receipt.post', true],
  ['site_engineer', 'procurement', 'submit', 'material.use', true],
  ['finance', 'procurement', 'submit', 'material.use', false],
  ['pm', 'user_management', 'create', undefined, true],
  ['qs', 'user_management', 'create', undefined, false],
  ['site_engineer', 'rfi', 'create', undefined, true],
  ['procurement', 'rfi', 'create', undefined, false],
  ['planning_eng', 'submittal', 'update', undefined, true],
  ['warehouse', 'submittal', 'delete', undefined, false],
  ['planning_eng', 'ncr', 'create', undefined, true],
  ['finance', 'ncr', 'update', undefined, false],
  ['site_engineer', 'safety', 'create', undefined, true],
  ['planning_eng', 'safety', 'create', undefined, false],
  ['site_engineer', 'safety', 'delete', undefined, false],
]

cases.forEach(([role, moduleName, action, transition, expected]) => {
  assert.equal(
    canPerform(role, moduleName, action, transition),
    expected,
    `${role} ${moduleName}.${action}${
      transition ? ` (${transition})` : ''
    } visibility`
  )
})

console.log(`Permission visibility assertions passed (${cases.length})`)
