import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strict,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      prettier,
    ],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Vertical slicing: shared code must not depend on features.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*/*'],
              message: "Import from a slice's public API (@/features/<slice>) only.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/features/**'], message: 'shared/ must not import from features/.' },
          ],
        },
      ],
    },
  },
])
