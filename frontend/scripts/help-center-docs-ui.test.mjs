import { readFile } from 'node:fs/promises'

const routeSource = await readFile(
  new URL(
    '../src/routes/_authenticated/o/$orgSlug/help-center/index.tsx',
    import.meta.url
  ),
  'utf8'
)
const legacyRouteSource = await readFile(
  new URL(
    '../src/routes/_authenticated/help-center/index.tsx',
    import.meta.url
  ),
  'utf8'
)
const helpCenterSource = await readFile(
  new URL('../src/features/help-center/index.tsx', import.meta.url),
  'utf8'
)

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message)
  }
}

assert(
  !routeSource.includes('ComingSoon'),
  'Help Center route must not render ComingSoon'
)
assert(
  routeSource.includes('HelpCenter'),
  'Help Center route must render the real HelpCenter component'
)
assert(
  legacyRouteSource.includes('legacyWorkspaceRedirect') &&
    !legacyRouteSource.includes('ComingSoon'),
  'the pre-workspace /help-center path must redirect into the active workspace'
)

for (const requiredText of [
  'docs/help-center/admin-guide.md',
  'docs/help-center/user-guide-by-role.md',
  'docs/help-center/support-runbook.md',
  'docs/help-center/api-docs.md',
  'docs/help-center/release-notes-known-limitations.md',
  'docs/help-center/onboarding-checklist.md',
  'docs/qa/documentation-readiness.md',
  '/api/v1/docs',
  '/api/v1/openapi.json',
]) {
  assert(
    helpCenterSource.includes(requiredText),
    `Help Center is missing launch documentation reference: ${requiredText}`
  )
}

console.log('Help Center documentation UI assertions passed.')
