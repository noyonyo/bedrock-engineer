/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+.tsx?$': ['ts-jest', {}]
  },
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '\\.integration\\.test\\.ts$' // Exclude files ending with .integration.test.ts
  ]
}
