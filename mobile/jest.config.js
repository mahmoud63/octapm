/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // Rendered screens compile a lot on a cold worker; the default 5 s failed the
  // first test of a file under a parallel run on a small machine.
  testTimeout: 20000,
  roots: ['<rootDir>/src', '<rootDir>/app'],
  setupFilesAfterEnv: ['<rootDir>/src/testing/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|expo-router|react-native-reanimated|openapi-fetch)',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/generated/**', '!src/testing/**', '!src/**/*.d.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
}
