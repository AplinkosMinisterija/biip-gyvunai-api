/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  coverageDirectory: './coverage',
  rootDir: './',
  roots: ['./test'],
  setupFiles: ['<rootDir>/test/setupEnv.ts'],
  testTimeout: 30000,
};
