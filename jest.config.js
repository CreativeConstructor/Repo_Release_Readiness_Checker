/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  verbose: true,
  testMatch: ['**/__tests__/**/*.test.js', '**/?(*.)+(spec|test).js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    '**/*.js',
    '!**/node_modules/**',
    '!**/coverage/**',
    '!**/frontend/**',
    '!jest.config.js',
    '!eslint.config.js',
  ],
  testTimeout: 10000,
  clearMocks: true,
  restoreMocks: true,
};
