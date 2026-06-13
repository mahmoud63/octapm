import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')

const formSource = read(
  'src/features/settings/notifications/notifications-form.tsx'
)
const topbarSource = read('src/components/layout/top-navbar.tsx')
const centerSource = read(
  'src/features/notifications/components/notification-center.tsx'
)
const hookSource = read('src/features/notifications/hooks/use-notifications.ts')

assert.match(formSource, /useNotificationPreferences/)
assert.match(formSource, /useUpdateNotificationPreferences/)
assert.doesNotMatch(formSource, /showSubmittedData/)
assert.match(topbarSource, /<NotificationCenter \/>/)
assert.match(centerSource, /useNotificationSummary/)
assert.match(centerSource, /useMarkAllNotificationsRead/)
assert.match(hookSource, /\/notifications\/preferences/)
assert.match(hookSource, /\/notifications\/mark-read/)

console.log('notifications-ui assertions passed')
