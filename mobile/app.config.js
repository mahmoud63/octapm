/**
 * The app config is app.json, unchanged. This file exists so that every read
 * of it — `expo start`, `expo export`, `expo prebuild` and each EAS build —
 * first checks that a staging or production build carries a real https origin
 * rather than the localhost fallback in src/config/env.ts. Development builds
 * pass straight through. See scripts/release-origins.cjs.
 */
const { assertReleaseOrigins } = require('./scripts/release-origins.cjs')

module.exports = ({ config }) => {
  assertReleaseOrigins(process.env)
  return config
}
