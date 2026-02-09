import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import globals from 'globals'
import jsdoc from 'eslint-plugin-jsdoc'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url))

export default [
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: false },
        sourceType: 'module',
        project: './tsconfig.json',
        tsconfigRootDir,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      jsdoc,
    },
    rules: {
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
      'no-useless-assignment': 'error',
      'prefer-const': 'error',
      'no-sparse-arrays': 'error',
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/check-access': 'warn',
      'jsdoc/require-param-description': 'off',
    },
  },
]
