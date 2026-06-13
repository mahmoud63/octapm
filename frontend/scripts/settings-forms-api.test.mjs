import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')

const hookSource = read('src/features/settings/hooks/use-user-settings.ts')
const profileForm = read('src/features/settings/profile/profile-form.tsx')
const accountForm = read('src/features/settings/account/account-form.tsx')
const appearanceForm = read(
  'src/features/settings/appearance/appearance-form.tsx'
)
const displayForm = read('src/features/settings/display/display-form.tsx')
const notificationsForm = read(
  'src/features/settings/notifications/notifications-form.tsx'
)
const topNavbar = read('src/components/layout/top-navbar.tsx')

for (const [label, source] of [
  ['profile', profileForm],
  ['account', accountForm],
  ['appearance', appearanceForm],
  ['display', displayForm],
  ['notifications', notificationsForm],
]) {
  assert.doesNotMatch(source, /showSubmittedData/, `${label} uses demo submit`)
}

assert.match(hookSource, /\/auth\/me\/settings/)
assert.match(hookSource, /\/auth\/me\/profile/)
assert.match(hookSource, /\/auth\/me\/account/)
assert.match(hookSource, /\/auth\/me\/appearance/)
assert.match(hookSource, /\/auth\/me\/display/)
assert.match(hookSource, /useAuthStore\.getState\(\)\.auth\.setUser/)

assert.match(profileForm, /useUpdateProfileSettings/)
assert.match(accountForm, /useUpdateAccountSettings/)
assert.match(appearanceForm, /useUpdateAppearanceSettings/)
assert.match(displayForm, /useUpdateDisplaySettings/)
assert.match(notificationsForm, /useUpdateNotificationPreferences/)

assert.match(displayForm, /displayNavigationItems/)
assert.match(topNavbar, /useUserSettings/)
assert.match(topNavbar, /filterDisplayItems/)
assert.match(topNavbar, /useAuthStore/)

console.log('settings form API assertions passed')
