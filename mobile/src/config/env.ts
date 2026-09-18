/**
 * Build-time environment.
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` at bundle time, and only when the
 * variable is read by its literal name, so each one is spelled out here rather
 * than looked up dynamically. Nothing in this file is a secret: the app carries
 * no server credentials, and a value that must not ship in a bundle does not
 * belong in an EXPO_PUBLIC_ variable.
 */
import Constants from 'expo-constants'

export type EnvironmentName = 'local' | 'development' | 'staging' | 'production'

const trimSlash = (value: string) => value.replace(/\/+$/, '')

const name = (process.env.EXPO_PUBLIC_ENV as EnvironmentName | undefined) ?? 'local'
const apiOrigin = trimSlash(process.env.EXPO_PUBLIC_API_ORIGIN ?? 'http://localhost:5000')
const webOrigin = trimSlash(process.env.EXPO_PUBLIC_WEB_ORIGIN ?? 'http://localhost:5173')

const easProjectId =
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
  ''

export const env = Object.freeze({
  name,
  isProduction: name === 'production',
  apiOrigin,
  apiBase: `${apiOrigin}/api/v1`,
  webOrigin,
  easProjectId,
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
})
