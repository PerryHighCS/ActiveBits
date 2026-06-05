import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildBrythonRunnerHtml,
  openMobCodeRunnerPopup,
  resolveBrythonEntryFile,
} from './runnerUtils'

void test('resolveBrythonEntryFile prefers the active Python file', () => {
  assert.equal(
    resolveBrythonEntryFile({
      'a.py': 'print("a")',
      'nested/b.py': 'print("b")',
    }, 'nested/b.py'),
    'nested/b.py',
  )
})

void test('resolveBrythonEntryFile falls back to the first Python file', () => {
  assert.equal(
    resolveBrythonEntryFile({
      'README.md': 'notes',
      'src/main.py': 'print("main")',
      'src/alpha.py': 'print("alpha")',
    }, 'README.md'),
    'src/alpha.py',
  )
})

void test('resolveBrythonEntryFile returns null when the workspace has no Python file', () => {
  assert.equal(resolveBrythonEntryFile({ 'Main.java': 'class Main {}' }, 'Main.java'), null)
})

void test('buildBrythonRunnerHtml escapes payload content in script contexts', () => {
  const html = buildBrythonRunnerHtml({
    files: {
      'main.py': 'print("</script><script>alert(1)</script>")',
    },
    entryFile: 'main.py',
    title: 'Runner <title>',
  })

  assert.match(html, /Runner &lt;title&gt;/)
  assert.doesNotMatch(html, /print\("<\/script><script>/)
  assert.match(html, /\\u003c\/script\\u003e\\u003cscript\\u003e/)
})

void test('buildBrythonRunnerHtml guards Brython execution against duplicate initialization', () => {
  const html = buildBrythonRunnerHtml({
    files: { 'test.py': 'print("Hello")' },
    entryFile: 'test.py',
    title: 'Runner',
  })

  assert.match(html, /let runnerStarted = false;/)
  assert.match(html, /window\.mobcodeRunnerShouldStart = \(\) =>/)
  assert.match(html, /if \(runnerStarted\) return false;/)
  assert.match(html, /if window\.mobcodeRunnerShouldStart\(\):/)
  assert.match(html, /window\.opener = null;/)
  assert.match(html, /URL\.revokeObjectURL\(window\.location\.href\)/)
})

void test('openMobCodeRunnerPopup opens a fresh blob-backed runner popup', () => {
  let openedUrl = ''
  let focused = false
  const browserWindow = {
    open(url?: string | URL, target?: string, features?: string) {
      openedUrl = String(url ?? '')
      assert.equal(target, '_blank')
      assert.match(features ?? '', /width=1120/)
      return {
        focus() {
          focused = true
        },
      }
    },
  }

  assert.deepEqual(
    openMobCodeRunnerPopup({
      files: { 'main.py': 'print("hello")' },
      activeFile: 'main.py',
      runnerId: 'brython-terminal',
    }, browserWindow),
    { opened: true },
  )
  assert.equal(focused, true)
  assert.match(openedUrl, /^blob:/)
  URL.revokeObjectURL(openedUrl)
})

void test('openMobCodeRunnerPopup reports missing entry and blocked popup states', () => {
  assert.deepEqual(
    openMobCodeRunnerPopup({
      files: { 'Main.java': 'class Main {}' },
      activeFile: 'Main.java',
      runnerId: 'brython-terminal',
    }, { open: () => null }),
    { opened: false, reason: 'missing-entry' },
  )

  assert.deepEqual(
    openMobCodeRunnerPopup({
      files: { 'main.py': 'print("hello")' },
      activeFile: 'main.py',
      runnerId: 'brython-terminal',
    }, { open: () => null }),
    { opened: false, reason: 'popup-blocked' },
  )
})
