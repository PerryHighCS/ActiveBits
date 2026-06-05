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

void test('openMobCodeRunnerPopup writes the Brython runner document to a popup', () => {
  const writes: string[] = []
  let focused = false
  const browserWindow = {
    open(url?: string | URL, target?: string, features?: string) {
      assert.equal(url, '')
      assert.equal(target, 'mobcode-runner')
      assert.match(features ?? '', /width=1120/)
      return {
        document: {
          open() {},
          write(value: string) {
            writes.push(value)
          },
          close() {},
        },
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
  assert.equal(writes.length, 1)
  assert.match(writes[0] ?? '', /MobCode Brython Runner/)
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
