import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import EditorToolbar from './EditorToolbar'

void test('EditorToolbar renders optional center controls', () => {
  const html = renderToStaticMarkup(
    <EditorToolbar
      files={{ 'main.py': 'print("hello")' }}
      readOnly
      theme="github-light"
      centerControls={<button type="button">Run</button>}
      onThemeChange={() => {}}
    />,
  )

  assert.match(html, /mobcode-editor-toolbar-center/)
  assert.match(html, />Run<\/button>/)
})

void test('EditorToolbar keeps settings in the right column without center controls', () => {
  const html = renderToStaticMarkup(
    <EditorToolbar
      files={{ 'main.py': 'print("hello")' }}
      readOnly
      theme="github-light"
      onThemeChange={() => {}}
    />,
  )

  assert.match(html, /mobcode-editor-toolbar-start/)
  assert.doesNotMatch(html, /mobcode-editor-toolbar-center/)
  assert.match(html, /mobcode-editor-toolbar-settings/)
})
