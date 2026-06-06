import type { MobCodeRunnerId } from '../../shared/types'

export interface MobCodeRunnerDefinition {
  id: MobCodeRunnerId
  label: string
  description: string
}

export interface MobCodeRunnerLaunchRequest {
  files: Record<string, string>
  activeFile: string
  sessionId?: string
  runnerId: MobCodeRunnerId
}

export interface MobCodeRunnerLaunchResult {
  opened: boolean
  reason?: 'missing-entry' | 'popup-blocked' | 'unknown-runner'
}

interface MobCodeRunnerPopup {
  focus: () => void
}

interface MobCodeRunnerWindow {
  open: (url?: string | URL, target?: string, features?: string) => MobCodeRunnerPopup | null
}

interface BrythonRunnerPayload {
  files: Record<string, string>
  entryFile: string
  sessionId?: string
  title: string
}

export const MOB_CODE_RUNNERS: readonly MobCodeRunnerDefinition[] = [
  {
    id: 'brython-terminal',
    label: 'Python Terminal',
    description: 'Run a Python entry file in a popup terminal.',
  },
]

export const DEFAULT_MOB_CODE_RUNNER_ID: MobCodeRunnerId = 'brython-terminal'
const RUNNER_POPUP_FEATURES = 'popup=yes,width=1120,height=760,noopener,noreferrer'

export function isPythonFile(path: string): boolean {
  return path.toLowerCase().endsWith('.py')
}

export function resolveBrythonEntryFile(files: Record<string, string>, activeFile: string): string | null {
  if (activeFile && Object.hasOwn(files, activeFile) && isPythonFile(activeFile)) return activeFile
  return Object.keys(files)
    .filter((path) => isPythonFile(path))
    .sort((a, b) => a.localeCompare(b))[0] ?? null
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

function indentationWidth(value: string): number {
  let width = 0
  for (const character of value) {
    if (character === ' ') width += 1
    else if (character === '\t') width += 4
    else break
  }
  return width
}

function rewriteCallNamesForAwait(line: string, names: ReadonlySet<string>, replacementName?: string): string {
  let output = ''
  let index = 0
  let quote: '"' | "'" | null = null
  let tripleQuote = false

  while (index < line.length) {
    const character = line[index]
    const nextTwo = line.slice(index, index + 3)

    if (quote) {
      output += character
      if (character === '\\') {
        output += line[index + 1] ?? ''
        index += 2
        continue
      }
      if (tripleQuote && nextTwo === quote.repeat(3)) {
        output += line.slice(index + 1, index + 3)
        index += 3
        quote = null
        tripleQuote = false
        continue
      }
      if (!tripleQuote && character === quote) quote = null
      index += 1
      continue
    }

    if (character === '#') {
      output += line.slice(index)
      break
    }

    if (character === '"' || character === "'") {
      quote = character
      tripleQuote = nextTwo === character.repeat(3)
      output += tripleQuote ? nextTwo : character
      index += tripleQuote ? 3 : 1
      continue
    }

    const identifier = line.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)
    if (identifier) {
      const name = identifier[0]
      const previous = line[index - 1] ?? ''
      const following = line.slice(index + name.length).match(/^\s*\(/)
      const isMemberAccess = previous === '.'
      const isIdentifierPart = /[A-Za-z0-9_]/.test(previous)
      const alreadyAwaited = /\bawait\s*$/.test(output)
      if (following && names.has(name) && !isMemberAccess && !isIdentifierPart && !alreadyAwaited) {
        output += `await ${replacementName ?? name}`
        index += name.length
        continue
      }
    }

    output += character
    index += 1
  }

  return output
}

function rewriteInputCallsForAwait(line: string): string {
  return rewriteCallNamesForAwait(line, new Set(['input']), 'mobcode_input')
}

function rewriteMemberCallNamesForAwait(line: string, names: ReadonlySet<string>): string {
  if (names.size === 0) return line

  let output = ''
  let index = 0
  let quote: '"' | "'" | null = null
  let tripleQuote = false
  const namePattern = Array.from(names).join('|')
  const memberCallPattern = new RegExp(`^([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*\\.(${namePattern})\\s*\\()`)

  while (index < line.length) {
    const character = line[index]
    const nextTwo = line.slice(index, index + 3)

    if (quote) {
      output += character
      if (character === '\\') {
        output += line[index + 1] ?? ''
        index += 2
        continue
      }
      if (tripleQuote && nextTwo === quote.repeat(3)) {
        output += line.slice(index + 1, index + 3)
        index += 3
        quote = null
        tripleQuote = false
        continue
      }
      if (!tripleQuote && character === quote) quote = null
      index += 1
      continue
    }

    if (character === '#') {
      output += line.slice(index)
      break
    }

    if (character === '"' || character === "'") {
      quote = character
      tripleQuote = nextTwo === character.repeat(3)
      output += tripleQuote ? nextTwo : character
      index += tripleQuote ? 3 : 1
      continue
    }

    const previous = line[index - 1] ?? ''
    const isIdentifierPart = /[A-Za-z0-9_.]/.test(previous)
    const alreadyAwaited = /\bawait\s*$/.test(output)
    const memberCall = line.slice(index).match(memberCallPattern)
    if (memberCall && !isIdentifierPart && !alreadyAwaited) {
      output += `await ${memberCall[1]}`
      index += memberCall[1]?.length ?? 0
      continue
    }

    output += character
    index += 1
  }

  return output
}

interface PythonBlock {
  name: string
  startLine: number
  bodyEndLine: number
  containsInput: boolean
  callStyle: 'function' | 'method'
}

function isTopLevelClassMethod(lines: readonly string[], lineIndex: number, startIndent: number): boolean {
  if (startIndent === 0) return false

  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const indent = indentationWidth(line)
    if (indent >= startIndent) continue
    return indent === 0 && /^class\s+[A-Za-z_][A-Za-z0-9_]*/.test(trimmed)
  }

  return false
}

function topLevelPythonBlocks(lines: readonly string[]): PythonBlock[] {
  const blocks: PythonBlock[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()
    const match = trimmed.match(/^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/)
    if (!match) continue

    const startIndent = indentationWidth(line)
    const callStyle: PythonBlock['callStyle'] | null = startIndent === 0
      ? 'function'
      : isTopLevelClassMethod(lines, index, startIndent) ? 'method' : null
    if (callStyle === null) continue

    let bodyEndLine = index
    let containsInput = false
    let nestedBlockIndent: number | null = null
    for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex += 1) {
      const bodyLine = lines[bodyIndex] ?? ''
      const bodyTrimmed = bodyLine.trim()
      if (!bodyTrimmed || bodyTrimmed.startsWith('#')) {
        bodyEndLine = bodyIndex
        continue
      }
      const bodyIndent = indentationWidth(bodyLine)
      if (bodyIndent <= startIndent) break
      bodyEndLine = bodyIndex
      if (nestedBlockIndent !== null) {
        if (bodyIndent > nestedBlockIndent) continue
        nestedBlockIndent = null
      }
      if (/^\s*(async\s+def|def|class)\s+/.test(bodyTrimmed)) {
        nestedBlockIndent = bodyIndent
        continue
      }
      if (rewriteInputCallsForAwait(bodyLine) !== bodyLine) containsInput = true
    }

    blocks.push({
      name: match[1] ?? '',
      startLine: index,
      bodyEndLine,
      containsInput,
      callStyle,
    })
  }
  return blocks
}

export function buildBrythonAsyncEntrySource(source: string): string {
  const lines = source.split(/\r?\n/)
  const inputBlocks = topLevelPythonBlocks(lines)
    .filter((block) => block.name !== '' && block.containsInput)
  const asyncInputFunctionNames = new Set(inputBlocks
    .filter((block) => block.callStyle === 'function')
    .map((block) => block.name))
  const asyncInputMethodNames = new Set(inputBlocks
    .filter((block) => block.callStyle === 'method')
    .map((block) => block.name))
  const inputBlockByStartLine = new Map(inputBlocks.map((block) => [block.startLine, block]))
  const functionScopes: number[] = []
  const transformedLines = lines.map((line, lineIndex) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return line

    const indent = indentationWidth(line)
    while (functionScopes.length > 0 && indent <= Number(functionScopes.at(-1))) {
      functionScopes.pop()
    }

    const inFunctionScope = functionScopes.length > 0
    const inAsyncInputFunction = inputBlocks.some((block) => lineIndex > block.startLine && lineIndex <= block.bodyEndLine)
    const asyncBlock = inputBlockByStartLine.get(lineIndex)
    let rewrittenLine = line
    if (asyncBlock) {
      rewrittenLine = line.replace(/^(\s*)def\s+/, '$1async def ')
    } else if (inAsyncInputFunction) {
      rewrittenLine = rewriteInputCallsForAwait(line)
      rewrittenLine = rewriteCallNamesForAwait(rewrittenLine, asyncInputFunctionNames)
      rewrittenLine = rewriteMemberCallNamesForAwait(rewrittenLine, asyncInputMethodNames)
    } else if (!inFunctionScope) {
      rewrittenLine = rewriteInputCallsForAwait(line)
      rewrittenLine = rewriteCallNamesForAwait(rewrittenLine, asyncInputFunctionNames)
      rewrittenLine = rewriteMemberCallNamesForAwait(rewrittenLine, asyncInputMethodNames)
    }

    if (/^\s*(async\s+def|def|class)\s+/.test(trimmed)) {
      functionScopes.push(indent)
    }

    return rewrittenLine
  })
  const userBody = transformedLines.length > 0
    ? transformedLines.map((line) => `    ${line}`).join('\n')
    : '    pass'

  return `async def __mobcode_user_main__():
${userBody || '    pass'}

async def __mobcode_run__():
    try:
        await __mobcode_user_main__()
        worker_self.send({'type': 'done'})
    except SystemExit:
        worker_self.send({'type': 'done'})
    except Exception as error:
        worker_self.send({'type': 'stderr', 'data': format_user_error_header(error)})
        worker_self.send({'type': 'stderr', 'data': traceback.format_exc()})

aio.run(__mobcode_run__())
`
}

export function buildBrythonRunnerHtml(payload: BrythonRunnerPayload): string {
  const serializedPayload = escapeScriptJson(payload)
  const entryContent = payload.files[payload.entryFile] ?? ''
  const serializedEntryContent = escapeScriptJson(buildBrythonAsyncEntrySource(entryContent))
  const serializedEntryFile = escapeScriptJson(payload.entryFile)
  const entryLineContent = entryContent.replace(/\r?\n$/, '')
  const entryLineCount = entryLineContent ? entryLineContent.split(/\r?\n/).length : 1
  const title = escapeHtml(payload.title)
  const entryFile = escapeHtml(payload.entryFile)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #111827;
      color: #e5e7eb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
      background: #111827;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid #374151;
      background: #1f2937;
    }
    h1 {
      margin: 0;
      font-size: 1rem;
      font-weight: 700;
    }
    .entry {
      color: #9ca3af;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 0.875rem;
    }
    .runner-actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    button {
      border: 1px solid #4b5563;
      border-radius: 6px;
      background: #111827;
      color: #f9fafb;
      font: inherit;
      font-size: 0.875rem;
      font-weight: 700;
      padding: 0.35rem 0.65rem;
      cursor: pointer;
    }
    button:disabled {
      cursor: default;
      opacity: 0.55;
    }
    main {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(16rem, 32%);
      min-height: 0;
    }
    #terminal {
      min-height: 0;
      overflow: auto;
      white-space: pre-wrap;
      padding: 1rem;
      background: #020617;
      color: #e5e7eb;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 0.95rem;
      line-height: 1.45;
    }
    #graphics {
      min-height: 0;
      border-left: 1px solid #374151;
      background: #f9fafb;
      color: #111827;
      display: grid;
      grid-template-rows: auto 1fr;
    }
    #graphics h2 {
      margin: 0;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid #d1d5db;
      font-size: 0.9rem;
    }
    #graphics-surface {
      min-height: 18rem;
      background:
        linear-gradient(#e5e7eb 1px, transparent 1px),
        linear-gradient(90deg, #e5e7eb 1px, transparent 1px);
      background-size: 24px 24px;
      background-color: #ffffff;
    }
    .dim { color: #9ca3af; }
    .error { color: #fca5a5; }
    @media (max-width: 760px) {
      main { grid-template-columns: 1fr; }
      #graphics { display: none; }
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/brython@3.13.0/brython.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/brython@3.13.0/brython_stdlib.js"></script>
</head>
<body>
  <header>
    <h1>MobCode Python Runner</h1>
    <div class="runner-actions">
      <div class="entry">${entryFile}</div>
      <button id="stop-runner" type="button" aria-label="Stop Python runner">Stop</button>
    </div>
  </header>
  <main>
    <section id="terminal" aria-label="Program terminal" tabindex="0"></section>
    <section id="graphics" aria-label="Graphics output">
      <h2>Graphics</h2>
      <div id="graphics-surface"></div>
    </section>
  </main>
  <script>
    try { window.opener = null; } catch {}
    window.addEventListener('load', () => {
      try { URL.revokeObjectURL(window.location.href); } catch {}
    });
    window.__MOB_CODE_RUNNER_PAYLOAD__ = ${serializedPayload};
    (() => {
      let runnerStarted = false;
      window.mobcodeRunnerShouldStart = () => {
        if (runnerStarted) return false;
        runnerStarted = true;
        return true;
      };
    })();
    window.mobcodeRunnerSetState = (state) => {
      const stopButton = document.getElementById('stop-runner');
      if (!stopButton) return;
      const isRunning = state === 'running';
      stopButton.disabled = !isRunning;
      stopButton.textContent = isRunning ? 'Stop' : state === 'done' ? 'Done' : 'Stopped';
    };
    window.mobcodeTerminal = {
      maxChars: 100000,
      charsWritten: 0,
      truncated: false,
      write(value) {
        if (this.truncated) return;
        const terminal = document.getElementById('terminal');
        let text = String(value);
        const remaining = this.maxChars - this.charsWritten;
        if (text.length > remaining) {
          text = text.slice(0, Math.max(0, remaining)) + '\\n[output truncated]\\n';
          this.truncated = true;
        }
        this.charsWritten += text.length;
        terminal.append(document.createTextNode(text));
        terminal.scrollTop = terminal.scrollHeight;
      },
      writeln(value) {
        this.write(String(value) + '\\n');
      }
    };
    window.mobcodeInputBridge = (() => {
      let activeInput = null;
      function submitInput(input, value, requestId, submitInputResponse) {
        activeInput = null;
        submitInputResponse(requestId, value);
        input.replaceWith(document.createTextNode(value + '\\n'));
      }

      return {
        request(requestId, promptText, submitInputResponse) {
          if (!requestId || typeof submitInputResponse !== 'function') {
            window.mobcodeTerminal.write('\\n[error] Interactive input bridge failed to initialize.\\n');
            return;
          }
          window.mobcodeTerminal.write(String(promptText || ''));
          const terminal = document.getElementById('terminal');
          if (activeInput) activeInput.replaceWith(document.createTextNode('\\n'));
          const input = document.createElement('input');
          activeInput = input;
          input.type = 'text';
          input.autocomplete = 'off';
          input.spellcheck = false;
          input.setAttribute('aria-label', 'Program input');
          input.style.cssText = [
            'min-width: 12rem',
            'border: 0',
            'outline: 0',
            'background: transparent',
            'color: inherit',
            'font: inherit',
          ].join(';');
          input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            submitInput(input, input.value, requestId, submitInputResponse);
          });
          terminal.append(input);
          input.focus();
          terminal.scrollTop = terminal.scrollHeight;
        },
        cancel() {
          if (!activeInput) return;
          activeInput.replaceWith(document.createTextNode('\\n'));
          activeInput = null;
        },
      };
    })();
    window.addEventListener('error', (event) => {
      window.mobcodeTerminal.write('\\n[error] ' + event.message + '\\n');
    });
  </script>
  <script type="text/python" class="webworker" id="mobcode-python-worker">
from browser import self as worker_self
from browser import aio, bind
import builtins
import sys
import traceback

entry_filename = ${serializedEntryFile}
entry_source = ${serializedEntryContent}
entry_user_line_count = ${entryLineCount}
input_sequence = 0
input_futures = {}

class MobCodeWorkerOutput:
    def __init__(self, message_type):
        self.message_type = message_type

    def write(self, data):
        if data is not None:
            worker_self.send({'type': self.message_type, 'data': str(data)})

    def flush(self):
        pass

def mobcode_input(prompt=''):
    global input_sequence
    input_sequence += 1
    request_id = str(input_sequence)
    input_future = aio.Future()
    input_futures[request_id] = input_future
    worker_self.send({'type': 'input-request', 'id': request_id, 'prompt': str(prompt)})
    return input_future

@bind(worker_self, 'message')
def handle_worker_message(event):
    message = event.data
    if hasattr(message, 'to_dict'):
        message = message.to_dict()
    if not isinstance(message, dict) or message.get('type') != 'input-response':
        return
    request_id = str(message.get('id', ''))
    input_future = input_futures.pop(request_id, None)
    if input_future is not None:
        input_future.set_result(str(message.get('value', '')))

def find_user_error_line(error):
    traceback_node = getattr(error, '__traceback__', None)
    while traceback_node is not None:
        frame = getattr(traceback_node, 'tb_frame', None)
        code = getattr(frame, 'f_code', None)
        filename = getattr(code, 'co_filename', None)
        if filename == entry_filename:
            line_number = getattr(traceback_node, 'tb_lineno', None)
            if line_number is not None and line_number <= entry_user_line_count + 1:
                return max(1, line_number - 1)
            return line_number
        traceback_node = getattr(traceback_node, 'tb_next', None)
    return getattr(error, 'lineno', None)

def format_user_error_header(error):
    line_number = find_user_error_line(error)
    if line_number is None:
        return '\\nError in ' + entry_filename + '\\n'
    return '\\nError in ' + entry_filename + ', line ' + str(line_number) + '\\n'

sys.stdout = MobCodeWorkerOutput('stdout')
sys.stderr = MobCodeWorkerOutput('stderr')
builtins.input = mobcode_input

try:
    compiled_code = compile(entry_source, entry_filename, 'exec')
    runner_globals = globals()
    runner_globals.update({
        '__name__': '__main__',
        '__file__': entry_filename,
        '__builtins__': builtins,
        'input': mobcode_input,
    })
    exec(compiled_code, runner_globals)
except Exception as error:
    worker_self.send({'type': 'stderr', 'data': format_user_error_header(error)})
    worker_self.send({'type': 'stderr', 'data': traceback.format_exc()})
  </script>
  <script type="text/python">
from browser import bind, document, window, worker

entry_filename = ${serializedEntryFile}
active_worker = None

def handle_worker_ready(runner_worker):
    global active_worker
    active_worker = runner_worker
    window.mobcodeRunnerSetState('running')

def clear_active_worker(state):
    global active_worker
    active_worker = None
    window.mobcodeInputBridge.cancel()
    window.mobcodeRunnerSetState(state)

def stop_active_worker():
    if active_worker is None:
        return
    try:
        active_worker.terminate()
    except Exception as error:
        window.mobcodeTerminal.write('\\n[error] Python runner could not be stopped: ' + str(error) + '\\n')
        return
    clear_active_worker('stopped')
    window.mobcodeTerminal.write('\\n[Python] Stopped.\\n')

@bind(document['stop-runner'], 'click')
def handle_stop_click(event):
    stop_active_worker()

def submit_input_response(request_id, value):
    if active_worker is None:
        window.mobcodeTerminal.write('\\n[error] Python runner is not ready for input.\\n')
        return
    active_worker.send({
        'type': 'input-response',
        'id': str(request_id),
        'value': str(value),
    })

def handle_worker_message(event):
    global active_worker
    message = event.data
    if hasattr(message, 'to_dict'):
        message = message.to_dict()
    if not isinstance(message, dict):
        window.mobcodeTerminal.write(str(message))
        return
    message_type = message.get('type')
    data = message.get('data', '')
    if message_type in ['stdout', 'stderr']:
        window.mobcodeTerminal.write(str(data))
    elif message_type == 'done':
        clear_active_worker('done')
    elif message_type == 'input-request':
        bridge = window.mobcodeInputBridge
        if bridge is None:
            window.mobcodeTerminal.write('\\n[error] Interactive input is not available in this browser.\\n')
            return
        bridge.request(
            message.get('id', ''),
            message.get('prompt', ''),
            submit_input_response,
        )

def handle_worker_error(error):
    window.mobcodeTerminal.write('\\n[error] Python runner worker failed: ' + str(error) + '\\n')

if window.mobcodeRunnerShouldStart():
    window.mobcodeRunnerSetState('running')
    window.mobcodeTerminal.write('[Python] Running ' + entry_filename + '\\n')
    worker.create_worker('mobcode-python-worker', handle_worker_ready, handle_worker_message, handle_worker_error)
  </script>
  <script>
    if (typeof brython === 'function') {
      brython({ debug: 1 });
    } else {
      window.mobcodeTerminal.write('[error] Python runner failed to load. Check this popup\\'s network access.\\n');
    }
  </script>
</body>
</html>`
}

export function createMobCodeRunnerDocumentUrl(html: string): string {
  return URL.createObjectURL(new Blob([html], { type: 'text/html' }))
}

export function openMobCodeRunnerPopup(
  request: MobCodeRunnerLaunchRequest,
  browserWindow: MobCodeRunnerWindow = window,
): MobCodeRunnerLaunchResult {
  if (request.runnerId !== 'brython-terminal') return { opened: false, reason: 'unknown-runner' }
  const entryFile = resolveBrythonEntryFile(request.files, request.activeFile)
  if (!entryFile) return { opened: false, reason: 'missing-entry' }

  const title = `MobCode Runner - ${entryFile}`
  const runnerUrl = createMobCodeRunnerDocumentUrl(buildBrythonRunnerHtml({
    files: request.files,
    entryFile,
    sessionId: request.sessionId,
    title,
  }))
  let popup: MobCodeRunnerPopup | null
  try {
    popup = browserWindow.open(runnerUrl, '_blank', RUNNER_POPUP_FEATURES)
  } catch {
    URL.revokeObjectURL(runnerUrl)
    return { opened: false, reason: 'popup-blocked' }
  }

  if (!popup) {
    return { opened: true }
  }

  popup.focus()
  return { opened: true }
}
