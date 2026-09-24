import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Vertical slicing: other code may only reach a slice through its index.ts.
const sliceInternals = {
  regex: '(^|/)features/[^/]+/(?!index\\.ts$).+',
  message: "Import from a slice's public API (features/<slice>/index.ts) only.",
}
// From inside a slice, `../<sibling>/<file>` is a deep import into another slice.
const siblingSliceInternals = {
  regex: '^\\.\\./(?!\\.\\.)[^/]+/(?!index\\.ts$).+',
  message: "Import from another slice's public API (../<slice>/index.ts) only.",
}
// Tests must go through src/test/http.ts: a direct supertest(app) binds a wildcard port that can
// collide with another local listener on 127.0.0.1 and answer with a foreign 404.
const supertestPath = {
  name: 'supertest',
  message: "Import `request` from 'src/test/http.ts' instead of supertest.",
}
const anyFeature = {
  regex: '(^|/)features(/|$)',
  message: 'shared/ must not import from features/.',
}

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.strict, prettier],
    languageOptions: { globals: globals.node },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-imports': ['error', { patterns: [sliceInternals], paths: [supertestPath] }],
    },
  },
  {
    files: ['src/features/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [sliceInternals, siblingSliceInternals], paths: [supertestPath] },
      ],
    },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [anyFeature], paths: [supertestPath] }],
    },
  },
  {
    files: ['src/test/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [sliceInternals] }] },
  },
])
