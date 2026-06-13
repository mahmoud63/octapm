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
  ['pm', 'boq', 'approve', 'allocation.approve', true],
  ['qs', 'boq', 'approve', 'allocation.approve', true],
  ['planning_eng', 'boq', 'approve', 'allocation.approve', false],
  ['site_engineer', 'boq', 'approve', 'allocation.reject', false],
  ['finance', 'ipc', 'certify', 'period.certify', true],
  ['finance', 'ipc', 'submit', 'period.submit', false],
  ['finance', 'ipc', 'approve', 'invoice.issue', true],
  ['finance', 'ipc', 'approve', 'payment.record', true],
  ['pm', 'ipc', 'approve', 'payment.record', false],
  ['finance', 'ipc', 'approve', 'retention.release', true],
  ['qs', 'ipc', 'approve', 'payment.record', false],
  ['qs', 'ipc', 'approve', 'retention.release', false],
  ['cost_controller', 'cost', 'update', 'activity_cost.update', true],
  ['procurement', 'cost', 'update', 'activity_cost.update', false],
  ['finance', 'cost', 'approve', 'reporting_period.lock', true],
  ['pm', 'cost', 'approve', 'reporting_period.override', true],
  ['finance', 'cost', 'approve', 'reporting_period.override', false],
  ['procurement', 'procurement', 'create', 'po.issue', true],
  ['warehouse', 'procurement', 'create', 'po.issue', false],
  ['warehouse', 'procurement', 'submit', 'receipt.post', true],
  ['site_engineer', 'procurement', 'submit', 'material.use', true],
  ['finance', 'procurement', 'submit', 'material.use', false],
  ['procurement', 'procurement', 'update', 'alert.acknowledge', true],
  ['procurement', 'procurement', 'update', 'alert.resolve', true],
  ['finance', 'procurement', 'update', 'alert.resolve', false],
  ['pm', 'risk', 'create', undefined, true],
  ['planning_eng', 'risk', 'submit', 'risk.submit', true],
  ['qs', 'risk', 'submit', 'risk.submit', true],
  ['site_engineer', 'risk', 'submit', 'risk.submit', false],
  ['pm', 'risk', 'approve', 'risk.approve', true],
  ['planning_eng', 'risk', 'approve', 'risk.approve', false],
  ['pm', 'risk', 'approve', 'risk.reject', true],
  ['pm', 'risk', 'approve', 'risk.reopen', true],
  ['pm', 'user_management', 'create', undefined, true],
  ['qs', 'user_management', 'create', undefined, false],
  ['site_engineer', 'rfi', 'create', undefined, true],
  ['procurement', 'rfi', 'create', undefined, false],
  ['pm', 'rfi', 'approve', 'rfi.approve', true],
  ['site_engineer', 'rfi', 'submit', 'rfi.submit', true],
  ['site_engineer', 'rfi', 'submit', 'rfi.answer', true],
  ['planning_eng', 'rfi', 'approve', 'rfi.close', false],
  ['pm', 'rfi', 'approve', 'rfi.reopen', true],
  ['planning_eng', 'rfi', 'approve', 'rfi.approve', false],
  ['pm', 'submittal', 'approve', 'submittal.reject', true],
  ['site_engineer', 'submittal', 'submit', 'submittal.submit', true],
  ['qs', 'submittal', 'submit', 'submittal.review', true],
  ['site_engineer', 'submittal', 'submit', 'submittal.review', false],
  ['planning_eng', 'submittal', 'submit', 'submittal.resubmit', true],
  ['qs', 'submittal', 'approve', 'submittal.reject', false],
  ['planning_eng', 'submittal', 'update', undefined, true],
  ['warehouse', 'submittal', 'delete', undefined, false],
  ['warehouse', 'document_control', 'read', undefined, true],
  [
    'site_engineer',
    'document_control',
    'submit',
    'document.revision.upload',
    true,
  ],
  [
    'site_engineer',
    'document_control',
    'submit',
    'document.revision.submit_review',
    true,
  ],
  [
    'planning_eng',
    'document_control',
    'approve',
    'document.revision.approve',
    false,
  ],
  ['pm', 'document_control', 'approve', 'document.revision.supersede', true],
  ['planning_eng', 'ncr', 'create', undefined, true],
  ['planning_eng', 'ncr', 'submit', 'ncr.close', true],
  ['finance', 'ncr', 'submit', 'ncr.close', false],
  ['finance', 'ncr', 'update', undefined, false],
  ['pm', 'ncr', 'approve', 'ncr.approve', true],
  ['pm', 'ncr', 'approve', 'ncr.reopen', true],
  ['site_engineer', 'ncr', 'approve', 'ncr.approve', false],
  ['site_engineer', 'safety', 'create', undefined, true],
  ['site_engineer', 'safety', 'submit', 'safety.close', true],
  ['planning_eng', 'safety', 'submit', 'safety.close', false],
  ['planning_eng', 'safety', 'create', undefined, false],
  ['site_engineer', 'safety', 'delete', undefined, false],
  ['pm', 'safety', 'approve', 'safety.reject', true],
  ['pm', 'safety', 'approve', 'safety.reopen', true],
  ['site_engineer', 'safety', 'approve', 'safety.reject', false],
  ['pm', 'change_order', 'approve', 'change_order.approve', true],
  ['qs', 'change_order', 'approve', 'change_order.approve', false],
  ['qs', 'change_order', 'submit', 'change_order.submit', true],
  ['planning_eng', 'change_order', 'submit', 'change_order.submit', false],
  ['qs', 'change_order', 'submit', 'change_order.reopen', true],
  ['planning_eng', 'eot', 'submit', 'eot.submit', true],
  ['pm', 'eot', 'approve', 'eot.reject', true],
  ['planning_eng', 'eot', 'approve', 'eot.reject', false],
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
