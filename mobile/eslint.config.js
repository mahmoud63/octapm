const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'ios/*', '.expo/*', 'src/api/generated/*', 'src/permissions/generated/*', 'coverage/*', 'scripts/*'],
  },
  {
    rules: {
      // Raw identifiers must never reach a screen; string them through the
      // formatters in src/utilities instead. The rule is a reminder, not a wall.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
])
