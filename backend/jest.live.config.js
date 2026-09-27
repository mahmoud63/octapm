// Live tests: real processes against the real local Postgres. They never run
// in the default `npm test`; run them with `npm run test:live -- <path>`.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__live__/**/*.live.test.js'],
  setupFiles: ['<rootDir>/src/__live__/enable-live.js'],
  // Membership integrity sentinel: a live run may not change a durable
  // organisation's people (src/__live__/membership-sentinel.global.js).
  globalSetup: '<rootDir>/src/__live__/membership-sentinel.setup.js',
  globalTeardown: '<rootDir>/src/__live__/membership-sentinel.teardown.js',
  clearMocks: true,
  verbose: true,
  testTimeout: 60_000,
};
