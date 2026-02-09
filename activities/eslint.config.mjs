import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import globals from 'globals'
import jsdoc from 'eslint-plugin-jsdoc'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url))
const tsFiles = ['**/*.{ts,tsx}']
const tsEslintFlatRecommendedRules = tseslint.configs['flat/eslint-recommended']?.rules ?? {}
const tsEslintRecommendedRules = tseslint.configs.recommended?.rules ?? {}
const tsRules = {
  ...js.configs.recommended.rules,
  ...tsEslintFlatRecommendedRules,
  ...tsEslintRecommendedRules,
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/consistent-type-imports': [
    'error',
    { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
  ],
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/await-thenable': 'error',
  '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
  '@typescript-eslint/strict-boolean-expressions': [
    'error',
    {
      allowNullableString: true,
      allowNullableBoolean: true,
      allowNullableObject: true,
      allowAny: false,
    },
  ],
  '@typescript-eslint/no-unused-expressions': 'error',
  'prefer-const': 'error',
  'no-sparse-arrays': 'error',
  'jsdoc/require-jsdoc': 'off',
  'jsdoc/check-access': 'warn',
  'jsdoc/require-param-description': 'off',
}
const tsBaseConfig = {
  files: tsFiles,
  languageOptions: {
    ecmaVersion: 'latest',
    parser: tsParser,
    parserOptions: {
      ecmaFeatures: { jsx: true },
      sourceType: 'module',
      project: './tsconfig.json',
      tsconfigRootDir,
    },
  },
  plugins: {
    '@typescript-eslint': tseslint,
    jsdoc,
  },
  rules: tsRules,
}

export default [
  { ignores: ['dist', 'node_modules'] },
  tsBaseConfig,
  {
    files: ['**/client/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: [
      '**/server/**/*.{ts,tsx}',
      '**/shared/**/*.{ts,tsx}',
      '**/*.config.ts',
      '**/*.{test,spec}.{ts,tsx}',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
]
