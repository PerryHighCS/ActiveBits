import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import SettingsMenu from './SettingsMenu'

void test('SettingsMenu does not reference a missing menu while closed', () => {
  const html = renderToStaticMarkup(
    <SettingsMenu
      theme="light"
      onThemeChange={() => {}}
      label="Theme"
    />,
  )

  assert.match(html, /aria-expanded="false"/)
  assert.doesNotMatch(html, /aria-controls=/)
  assert.doesNotMatch(html, /role="menu"/)
})
