/** Unit tests (src/**\/*.spec.ts) + e2e tests against a real embedded PostgreSQL (test/**\/*.e2e-spec.ts). */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '(src/.*\\.spec|test/.*\\.e2e-spec)\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/global-setup.mjs',
  globalTeardown: '<rootDir>/test/global-teardown.mjs',
  testTimeout: 30000,
};
