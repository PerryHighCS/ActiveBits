import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import globals from 'globals'
import jsdoc from 'eslint-plugin-jsdoc'

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
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      jsdoc,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs['flat/eslint-recommended'].rules,
      ...tseslint.configs.recommended.rules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-useless-assignment': 'off',
      'prefer-const': 'off',
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/check-access': 'warn',
      'jsdoc/require-param-description': 'off',
    },
  },
]
