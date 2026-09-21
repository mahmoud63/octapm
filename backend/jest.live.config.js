// Live tests: real processes against the real local Postgres. They never run
// in the default `npm test`; run them with `npm run test:live -- <path>`.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__live__/**/*.live.test.js'],
  setupFiles: ['<rootDir>/src/__live__/enable-live.js'],
  clearMocks: true,
  verbose: true,
  testTimeout: 60_000,
};
