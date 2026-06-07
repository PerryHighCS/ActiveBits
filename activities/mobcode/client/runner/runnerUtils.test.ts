import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildBrythonAsyncEntrySource,
  buildBrythonModuleSource,
  buildBrythonRunnerHtml,
  MOB_CODE_RUNNERS,
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

void test('MOB_CODE_RUNNERS exposes Python-facing labels', () => {
  assert.deepEqual(MOB_CODE_RUNNERS.map((runner) => runner.label), ['Python Terminal'])
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
  assert.match(html, /const closeRunnerWindow = window\.close\.bind\(window\);/)
  assert.match(html, /window\.close = \(\) => \{/)
  assert.match(html, /window\.mobcodeCloseRunnerWindow = \(\) => \{/)
})

void test('buildBrythonRunnerHtml runs user code in a Brython worker', () => {
  const html = buildBrythonRunnerHtml({
    files: { 'test.py': 'print("Hello")' },
    entryFile: 'test.py',
    title: 'Runner',
    assetBaseUrl: 'http://127.0.0.1:3100',
  })

  assert.match(html, /<base href="http:\/\/127\.0\.0\.1:3100\/">/)
  assert.match(html, /Object\.defineProperty\(navigator, 'language', \{ value: 'en-US'/)
  assert.match(html, /Object\.defineProperty\(navigator, 'languages', \{ value: \['en-US', 'en'\]/)
  assert.match(html, /src="\/vendor\/brython\/brython\.min\.js"/)
  assert.match(html, /src="\/vendor\/brython\/brython_stdlib\.js"/)
  assert.match(html, /class="webworker" id="mobcode-python-worker"/)
  assert.match(html, /from browser import self as worker_self/)
  assert.match(html, /worker_self\.send\(\{'type': self\.message_type, 'data': str\(data\)\}\)/)
  assert.match(html, /def handle_worker_ready\(runner_worker\):/)
  assert.match(html, /worker\.create_worker\('mobcode-python-worker', handle_worker_ready, handle_worker_message, handle_worker_error\)/)
  assert.match(html, /brython\(\{ debug: 0 \}\)/)
  assert.doesNotMatch(html, /brython\(\{ debug: 1 \}\)/)
})

void test('buildBrythonRunnerHtml exposes stop and output limit controls', () => {
  const html = buildBrythonRunnerHtml({
    files: { 'test.py': 'while True:\n    pass\n' },
    entryFile: 'test.py',
    title: 'Runner',
  })

  assert.match(html, /id="stop-runner"/)
  assert.match(html, /aria-label="Stop Python runner"/)
  assert.match(html, /id="done-runner"/)
  assert.match(html, /aria-label="Close Python runner"/)
  assert.match(html, /hidden disabled>Done<\/button>/)
  assert.match(html, /window\.mobcodeRunnerSetState = \(state\) =>/)
  assert.match(html, /window\.mobcodeRunnerState = state;/)
  assert.match(html, /const doneButton = document\.getElementById\('done-runner'\);/)
  assert.match(html, /const canClose = state === 'done' \|\| state === 'stopped';/)
  assert.match(html, /stopButton\.disabled = !isRunning;/)
  assert.match(html, /stopButton\.hidden = !isRunning;/)
  assert.match(html, /doneButton\.disabled = !canClose;/)
  assert.match(html, /doneButton\.hidden = !canClose;/)
  assert.match(html, /window\.mobcodeRunnerGetState = \(\) => window\.mobcodeRunnerState \|\| 'loading';/)
  assert.match(html, /maxChars: 100000/)
  assert.match(html, /\[output truncated\]/)
  assert.match(html, /def stop_active_worker\(\):/)
  assert.match(html, /const NativeWorker = window\.Worker/)
  assert.match(html, /const shouldWrapBlobWorkers = \(\(\) => \{/)
  assert.match(html, /const isWebKitLike = \/\\bAppleWebKit\\b\/\.test\(userAgent\);/)
  assert.match(html, /const isChromiumLike = \/\\b\(Chrome\|Chromium\|CriOS\|Edg\|OPR\)\\b\/\.test\(userAgent\);/)
  assert.match(html, /return !isWebKitLike \|\| isChromiumLike;/)
  assert.match(html, /shouldWrapBlobWorkers && typeof args\[0\] === 'string' && args\[0\]\.startsWith\('blob:'\)/)
  assert.match(html, /importScripts\(" \+ JSON\.stringify\(args\[0\]\) \+ "\);/)
  assert.match(html, /activeNativeWorker = worker/)
  assert.match(html, /activeNativeWorker\.terminate\(\)/)
  assert.match(html, /window\.mobcodeTerminateWorker\(\)/)
  assert.match(html, /@bind\(document\['stop-runner'\], 'click'\)/)
  assert.match(html, /if window\.mobcodeRunnerGetState\(\) != 'running':/)
  assert.match(html, /@bind\(document\['done-runner'\], 'click'\)/)
  assert.match(html, /window\.mobcodeCloseRunnerWindow\(\)/)
  assert.match(html, /message_type == 'done'/)
})

void test('buildBrythonRunnerHtml renders a terminal-only popup', () => {
  const html = buildBrythonRunnerHtml({
    files: { 'test.py': 'print("hello")\n' },
    entryFile: 'test.py',
    title: 'Runner',
  })

  assert.match(html, /id="terminal"/)
  assert.match(html, /html,\s*\n\s{4}body \{\s*\n\s{6}height: 100%;\s*\n\s{6}overflow: hidden;/)
  assert.match(html, /body \{\s*\n\s{6}margin: 0;\s*\n\s{6}height: 100vh;/)
  assert.match(html, /main \{\s*\n\s{6}min-height: 0;\s*\n\s{6}display: flex;\s*\n\s{6}overflow: hidden;/)
  assert.doesNotMatch(html, /id="graphics"/)
  assert.doesNotMatch(html, /Graphics output/)
  assert.doesNotMatch(html, /graphics-surface/)
})

void test('buildBrythonRunnerHtml wires terminal input through async worker messages', () => {
  const html = buildBrythonRunnerHtml({
    files: { 'test.py': 'name = input("Name? ")\nprint(name)\n' },
    entryFile: 'test.py',
    title: 'Runner',
  })

  assert.match(html, /window\.mobcodeInputBridge = \(\(\) =>/)
  assert.match(html, /scrollToBottom\(terminal\) \{/)
  assert.match(html, /this\.scrollToBottom\(terminal\);/)
  assert.match(html, /window\.mobcodeTerminal\.scrollToBottom\(document\.getElementById\('terminal'\)\);/)
  assert.match(html, /terminal\.addEventListener\('click', \(\) => \{/)
  assert.match(html, /activeInput\.focus\(\);/)
  assert.match(html, /'type': 'input-response'/)
  assert.match(html, /from browser import aio, bind/)
  assert.match(html, /input_future = aio\.Future\(\)/)
  assert.match(html, /input_future\.set_result/)
  assert.match(html, /async def __mobcode_user_main__/)
  assert.match(html, /name = await mobcode_input/)
  assert.match(html, /await __mobcode_user_main__\(\)/)
  assert.match(html, /worker_self\.send\(\{\s*'type': 'input-request'/)
  assert.match(html, /def submit_input_response\(request_id, value\):/)
  assert.match(html, /active_worker\.send\(\{/)
  assert.match(html, /message_type == 'input-request'/)
  assert.match(html, /bridge\.request\(/)
})

void test('buildBrythonRunnerHtml blocks browser escape-hatch imports', () => {
  const html = buildBrythonRunnerHtml({
    files: {
      'test.py': [
        'import math',
        'import browser',
        'from javascript import window',
        'import os',
      ].join('\n'),
    },
    entryFile: 'test.py',
    title: 'Runner',
  })

  assert.match(html, /blocked_import_roots = set\(\[/)
  assert.match(html, /"browser"/)
  assert.match(html, /"javascript"/)
  assert.match(html, /"os"/)
  assert.match(html, /"sys"/)
  assert.match(html, /"getpass"/)
  assert.match(html, /allowed_import_roots = set\(\[/)
  assert.match(html, /"math"/)
  assert.match(html, /"random"/)
  assert.match(html, /"time"/)
  assert.match(html, /def mobcode_import\(name, globals=None, locals=None, fromlist=\(\), level=0\):/)
  assert.match(html, /builtins\.__import__ = mobcode_import/)
  assert.match(html, /Module '" \+ root_name \+ "' is not available in the terminal runner/)
  assert.match(html, /if root_name not in allowed_import_roots:/)
  assert.match(html, /return original_import\(name, globals, locals, fromlist, level\)/)
  assert.match(html, /except BaseException as error:/)
  assert.match(html, /Module '" \+ module_name \+ "' is not available in the terminal runner/)
})

void test('buildBrythonRunnerHtml serializes no import diagnostic as Python None', () => {
  const html = buildBrythonRunnerHtml({
    files: { 'test.py': 'import time\nprint("ok")\n' },
    entryFile: 'test.py',
    title: 'Runner',
  })

  assert.match(html, /entry_import_diagnostic = None/)
  assert.doesNotMatch(html, /entry_import_diagnostic = null/)
})

void test('buildBrythonRunnerHtml preflights unsupported entry imports', () => {
  const html = buildBrythonRunnerHtml({
    files: { 'test.py': 'import timey\nprint("never")\n' },
    entryFile: 'test.py',
    title: 'Runner',
  })

  assert.match(html, /entry_import_diagnostic = \{"line":1,"moduleName":"timey"\}/)
  assert.match(html, /if entry_import_diagnostic is not None:/)
  assert.match(html, /return int\(entry_import_diagnostic\.get\('line', 1\)\)/)
  assert.match(html, /raise ImportError\("Module '"/)
})

void test('buildBrythonRunnerHtml exposes read-only workspace files and imports', () => {
  const html = buildBrythonRunnerHtml({
    files: {
      'main.py': 'from helper import greet\nprint(greet("Ada"))\nprint(open("data/names.txt").read())\n',
      'helper.py': 'def greet(name):\n    return "Hello " + name\n',
      'data/names.txt': 'Ada\nGrace\n',
      'README.md': 'Expected output: `3` and ${count}\n',
    },
    entryFile: 'main.py',
    title: 'Runner',
  })

  assert.match(html, /workspace_files = \{/)
  assert.match(html, /"data\/names\.txt":"Ada\\nGrace\\n"/)
  assert.match(html, /Expected output: \\u00603\\u0060 and \\u0024\{count\}/)
  assert.doesNotMatch(html, /Expected output: `3` and \$\{count\}/)
  assert.match(html, /workspace_python_modules = \{/)
  assert.match(html, /"helper\.py":"def greet/)
  assert.match(html, /workspace_brython_files_json = /)
  assert.match(html, /worker_self\.__BRYTHON__\.add_files\(worker_self\.JSON\.parse\(workspace_brython_files_json\)\)/)
  assert.match(html, /self\.XMLHttpRequest = class MobCodeWorkspaceXMLHttpRequest/)
  assert.match(html, /resolveWorkspacePath\(url\)/)
  assert.match(html, /original_open = builtins\.open/)
  assert.match(html, /def mobcode_open\(path, mode='r'/)
  assert.match(html, /MobCode workspace files are read-only in the terminal runner/)
  assert.match(html, /self\._content = str\(content\)\.encode\('utf-8'\) if self\._binary else str\(content\)/)
  assert.match(html, /return b'' if self\._binary else ''/)
  assert.match(html, /path_text = str\(path\)/)
  assert.match(html, /'#mobcode-python-worker' in path_text/)
  assert.match(html, /return MobCodeReadOnlyFile\(path_text, '', 'b' in mode_text\)/)
  assert.match(html, /path_text\.startswith\('VFS\.'\)/)
  assert.match(html, /return original_open\(path, mode, buffering, encoding, errors, newline, closefd, opener\)/)
  assert.match(html, /'b' in mode_text/)
  assert.match(html, /class MobCodeReadOnlyFile:/)
  assert.match(html, /def mobcode_create_workspace_module\(name, path\):/)
  assert.match(html, /module_type = original_import\('types'\)\.ModuleType/)
  assert.match(html, /compiled_module = compile\(workspace_python_modules\[path\], path, 'exec'\)/)
  assert.match(html, /builtins\.open = mobcode_open/)
  assert.match(html, /'open': mobcode_open/)
})

void test('buildBrythonModuleSource transforms functions without adding entry wrapper', () => {
  const source = buildBrythonModuleSource([
    'def ask():',
    '    return input("Name?")',
    'def plain():',
    '    return 42',
  ].join('\n'))

  assert.match(source, /async def ask\(\):\n {4}return await mobcode_input\("Name\?"\)/)
  assert.match(source, /def plain\(\):/)
  assert.doesNotMatch(source, /__mobcode_user_main__/)
  assert.doesNotMatch(source, /mobcode_run_async/)
})

void test('buildBrythonAsyncEntrySource rewrites top-level and function input', () => {
  const source = buildBrythonAsyncEntrySource([
    'name = input("Name?")',
    'if name:',
    '    age = input("Age?")',
    'def ask():',
    '    return input("Nested?")',
    'print(ask())',
  ].join('\n'))

  assert.match(source, /async def __mobcode_user_main__\(\):/)
  assert.match(source, /name = await mobcode_input\("Name\?"\)/)
  assert.match(source, / {4}age = await mobcode_input\("Age\?"\)/)
  assert.match(source, /async def ask\(\):\n {8}return await mobcode_input\("Nested\?"\)/)
  assert.match(source, /print\(await ask\(\)\)/)
  assert.match(source, /mobcode_run_async\(__mobcode_run__\(\)\)/)
})

void test('buildBrythonAsyncEntrySource rewrites class method input', () => {
  const source = buildBrythonAsyncEntrySource([
    'class Prompter:',
    '    def ask(self):',
    '        return input("Nested?")',
    'prompter = Prompter()',
    'print(prompter.ask())',
  ].join('\n'))

  assert.match(source, /class Prompter:/)
  assert.match(source, /async def ask\(self\):\n {12}return await mobcode_input\("Nested\?"\)/)
  assert.match(source, /print\(await prompter\.ask\(\)\)/)
})

void test('buildBrythonAsyncEntrySource rewrites top-level time.sleep', () => {
  const source = buildBrythonAsyncEntrySource([
    'import time',
    'print("hello")',
    'while True:',
    '    time.sleep(1)',
  ].join('\n'))

  assert.match(source, /import time/)
  assert.match(source, /print\("hello"\)/)
  assert.match(source, /while True:\n {8}await mobcode_sleep\(1\)/)
  assert.doesNotMatch(source, /time\.sleep\(1\)/)
})

void test('buildBrythonAsyncEntrySource rewrites imported sleep calls', () => {
  const source = buildBrythonAsyncEntrySource([
    'from time import sleep',
    'sleep(0.5)',
  ].join('\n'))

  assert.match(source, /from time import sleep/)
  assert.match(source, /await mobcode_sleep\(0\.5\)/)
  assert.doesNotMatch(source, /\nsleep\(0\.5\)/)
})

void test('buildBrythonAsyncEntrySource rewrites functions that call time.sleep', () => {
  const source = buildBrythonAsyncEntrySource([
    'import time',
    'def pause():',
    '    time.sleep(1)',
    '    return "done"',
    'print(pause())',
  ].join('\n'))

  assert.match(source, /async def pause\(\):\n {8}await mobcode_sleep\(1\)/)
  assert.match(source, /print\(await pause\(\)\)/)
})

void test('buildBrythonAsyncEntrySource leaves nested function input unchanged', () => {
  const source = buildBrythonAsyncEntrySource([
    'def outer():',
    '    def inner():',
    '        return input("Nested?")',
    '    return inner()',
    'print(outer())',
  ].join('\n'))

  assert.match(source, /def outer\(\):/)
  assert.match(source, /def inner\(\):\n {12}return input\("Nested\?"\)/)
  assert.match(source, /return inner\(\)/)
  assert.doesNotMatch(source, /async def inner/)
})

void test('buildBrythonRunnerHtml compiles user code with the entry filename for tracebacks', () => {
  const html = buildBrythonRunnerHtml({
    files: { 'test.py': 'print("Hello")\nraise ValueError("boom")\n' },
    entryFile: 'test.py',
    title: 'Runner',
  })

  assert.match(html, /entry_filename = "test\.py"/)
  assert.match(html, /entry_user_line_count = 2/)
  assert.match(html, /compiled_code = compile\(entry_source, entry_filename, 'exec'\)/)
  assert.match(html, /'__file__': entry_filename/)
  assert.match(html, /'input': mobcode_input/)
  assert.match(html, /async def mobcode_sleep\(seconds=0\):/)
  assert.match(html, /await aio\.sleep\(delay\)/)
  assert.match(html, /'mobcode_sleep': mobcode_sleep/)
  assert.match(html, /'mobcode_run_async': mobcode_run_async/)
  assert.match(html, /'mobcode_report_done': mobcode_report_done/)
  assert.match(html, /except BaseException as error:/)
  assert.match(html, /exec\(compiled_code, runner_globals\)/)
  assert.doesNotMatch(html, /runner_globals = globals\(\)/)
  assert.doesNotMatch(html, /'aio': aio/)
})

void test('buildBrythonRunnerHtml prints a user-file error header before the raw traceback', () => {
  const html = buildBrythonRunnerHtml({
    files: { 'test.py': 'print("Hello")\n1 / 0\n' },
    entryFile: 'test.py',
    title: 'Runner',
  })

  assert.match(html, /def find_user_error_line\(error\):/)
  assert.match(html, /if filename == entry_filename:/)
  assert.match(html, /line_number <= entry_user_line_count \+ 1/)
  assert.match(html, /fallback_line_number = getattr\(error, 'lineno', None\)/)
  assert.match(html, /fallback_line_number = int\(fallback_line_number\)/)
  assert.match(html, /return max\(1, fallback_line_number - 1\)/)
  assert.match(html, /return None/)
  assert.match(html, /Error in ' \+ entry_filename \+ ', line ' \+ str\(line_number\)/)
  assert.match(html, /def mobcode_format_error\(error\):/)
  assert.match(html, /formatted_error = traceback\.format_exc\(\)/)
  assert.match(html, /formatted_error\.strip\(\) != 'NoneType: None'/)
  assert.match(html, /return error\.__class__\.__name__ \+ ': ' \+ str\(error\)/)
  assert.match(html, /worker_self\.send\(\{'type': 'stderr', 'data': format_user_error_header\(error\)\}\)/)
  assert.match(html, /worker_self\.send\(\{'type': 'stderr', 'data': mobcode_format_error\(error\)\}\)/)
})

void test('buildBrythonRunnerHtml shows Python-facing runner labels', () => {
  const html = buildBrythonRunnerHtml({
    files: { 'test.py': 'print("Hello")' },
    entryFile: 'test.py',
    title: 'Runner',
  })

  assert.match(html, /MobCode Python Runner/)
  assert.match(html, /\[Python\] Running/)
  assert.doesNotMatch(html, /MobCode Brython Runner/)
  assert.doesNotMatch(html, /\[Brython\] Running/)
})

void test('openMobCodeRunnerPopup opens a fresh blob-backed runner popup', () => {
  let openedUrl = ''
  let focused = false
  const browserWindow = {
    location: { origin: 'https://bits.example' },
    open(url?: string | URL, target?: string, features?: string) {
      openedUrl = String(url ?? '')
      assert.equal(target, '_blank')
      assert.match(features ?? '', /width=1120/)
      assert.doesNotMatch(features ?? '', /noopener/)
      assert.doesNotMatch(features ?? '', /noreferrer/)
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

void test('openMobCodeRunnerPopup reports a null popup handle as blocked and revokes the blob URL', () => {
  const originalRevokeObjectUrl = URL.revokeObjectURL
  let openedUrl = ''
  let revokedUrl = ''
  URL.revokeObjectURL = (url) => {
    revokedUrl = url
  }

  try {
    assert.deepEqual(
      openMobCodeRunnerPopup({
        files: { 'main.py': 'print("hello")' },
        activeFile: 'main.py',
        runnerId: 'brython-terminal',
      }, {
        open(url?: string | URL) {
          openedUrl = String(url ?? '')
          return null
        },
      }),
      { opened: false, reason: 'popup-blocked' },
    )
  } finally {
    URL.revokeObjectURL = originalRevokeObjectUrl
  }

  assert.match(openedUrl, /^blob:/)
  assert.equal(revokedUrl, openedUrl)
})

void test('openMobCodeRunnerPopup reports missing entry and thrown popup open failures', () => {
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
    }, {
      open() {
        throw new Error('blocked')
      },
    }),
    { opened: false, reason: 'popup-blocked' },
  )
})
