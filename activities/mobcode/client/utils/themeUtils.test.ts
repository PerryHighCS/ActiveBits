import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_MOB_CODE_THEME } from './constants'
import { getThemeFromCookie, normalizeMobCodeTheme } from './themeUtils'

void test('normalizes theme ids', () => {
  assert.equal(normalizeMobCodeTheme('github-dark'), 'github-dark')
  assert.equal(normalizeMobCodeTheme('unknown'), DEFAULT_MOB_CODE_THEME)
})

void test('reads theme from cookie string', () => {
  assert.equal(getThemeFromCookie('other=1; mobcode-theme=one-dark'), 'one-dark')
  assert.equal(getThemeFromCookie('other=1'), DEFAULT_MOB_CODE_THEME)
})
