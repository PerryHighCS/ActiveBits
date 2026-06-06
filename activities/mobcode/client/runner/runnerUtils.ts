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
  location?: { origin?: string }
}

interface BrythonRunnerPayload {
  files: Record<string, string>
  entryFile: string
  sessionId?: string
  title: string
  assetBaseUrl?: string
}

interface MobCodeImportDiagnostic {
  line: number
  moduleName: string
}

export const MOB_CODE_RUNNERS: readonly MobCodeRunnerDefinition[] = [
  {
    id: 'brython-terminal',
    label: 'Python Terminal',
    description: 'Run a Python entry file in a popup terminal.',
  },
]

export const DEFAULT_MOB_CODE_RUNNER_ID: MobCodeRunnerId = 'brython-terminal'
const RUNNER_POPUP_FEATURES = 'popup=yes,width=1120,height=760'
const TERMINAL_BLOCKED_IMPORT_ROOTS = [
  'browser',
  'javascript',
  'os',
  'pathlib',
  'importlib',
  'sys',
  'subprocess',
  'socket',
  'asyncio',
  'threading',
  'multiprocessing',
  'webbrowser',
  'getpass',
]
const TERMINAL_ALLOWED_IMPORT_ROOTS = [
  'array',
  'bisect',
  'calendar',
  'cmath',
  'collections',
  'copy',
  'csv',
  'datetime',
  'decimal',
  'fractions',
  'functools',
  'heapq',
  'itertools',
  'json',
  'math',
  'operator',
  'pprint',
  'random',
  're',
  'statistics',
  'string',
  'time',
  'types',
]
const TERMINAL_BLOCKED_IMPORT_ROOT_SET = new Set(TERMINAL_BLOCKED_IMPORT_ROOTS)
const TERMINAL_ALLOWED_IMPORT_ROOT_SET = new Set(TERMINAL_ALLOWED_IMPORT_ROOTS)

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

function modulePath(moduleName: string): string {
  return `${moduleName.replaceAll('.', '/')}.py`
}

function isWorkspacePythonModule(moduleName: string, files: Record<string, string>): boolean {
  return Object.hasOwn(files, modulePath(moduleName))
}

function isTerminalAllowedModule(moduleName: string, files: Record<string, string>): boolean {
  const rootName = moduleName.split('.')[0] ?? moduleName
  return isWorkspacePythonModule(moduleName, files)
    || TERMINAL_ALLOWED_IMPORT_ROOT_SET.has(rootName)
}

function findUnsupportedEntryImport(source: string, files: Record<string, string>): MobCodeImportDiagnostic | null {
  const lines = source.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const importMatch = trimmed.match(/^import\s+(.+)$/)
    if (importMatch) {
      const importText = (importMatch[1] ?? '').split('#')[0]?.split(';')[0] ?? ''
      for (const importPart of importText.split(',')) {
        const moduleName = importPart.trim().split(/\s+as\s+/)[0]?.trim()
        if (!moduleName) continue
        const rootName = moduleName.split('.')[0] ?? moduleName
        if (TERMINAL_BLOCKED_IMPORT_ROOT_SET.has(rootName) || !isTerminalAllowedModule(moduleName, files)) {
          return { line: index + 1, moduleName }
        }
      }
    }

    const fromImportMatch = trimmed.match(/^from\s+([A-Za-z_][A-Za-z0-9_.]*)\s+import\s+/)
    if (fromImportMatch) {
      const moduleName = fromImportMatch[1] ?? ''
      const rootName = moduleName.split('.')[0] ?? moduleName
      if (TERMINAL_BLOCKED_IMPORT_ROOT_SET.has(rootName) || !isTerminalAllowedModule(moduleName, files)) {
        return { line: index + 1, moduleName }
      }
    }
  }
  return null
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

function rewriteDottedCallForAwait(line: string, dottedName: string, replacementName: string): string {
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

    const previous = line[index - 1] ?? ''
    const following = line.slice(index + dottedName.length).match(/^\s*\(/)
    const isIdentifierPart = /[A-Za-z0-9_.]/.test(previous)
    const alreadyAwaited = /\bawait\s*$/.test(output)
    if (line.startsWith(dottedName, index) && following && !isIdentifierPart && !alreadyAwaited) {
      output += `await ${replacementName}`
      index += dottedName.length
      continue
    }

    output += character
    index += 1
  }

  return output
}

function importsTimeSleep(lines: readonly string[]): boolean {
  return lines.some((line) => /^from\s+time\s+import\s+/.test(line.trim()) && /\bsleep\b/.test(line))
}

function rewriteSleepCallsForAwait(line: string, rewriteBareSleep: boolean): string {
  let rewrittenLine = rewriteDottedCallForAwait(line, 'time.sleep', 'mobcode_sleep')
  if (rewriteBareSleep) {
    rewrittenLine = rewriteCallNamesForAwait(rewrittenLine, new Set(['sleep']), 'mobcode_sleep')
  }
  return rewrittenLine
}

function rewriteAwaitableCallsForAwait(line: string, rewriteBareSleep: boolean): string {
  let rewrittenLine = rewriteInputCallsForAwait(line)
  rewrittenLine = rewriteSleepCallsForAwait(rewrittenLine, rewriteBareSleep)
  return rewrittenLine
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
  const rewriteBareSleep = importsTimeSleep(lines)
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
      if (rewriteAwaitableCallsForAwait(bodyLine, rewriteBareSleep) !== bodyLine) containsInput = true
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
  const userBody = buildBrythonTransformedSource(source, { rewriteTopLevelInput: true })

  return `async def __mobcode_user_main__():
${userBody || '    pass'}

async def __mobcode_run__():
    try:
        await __mobcode_user_main__()
        mobcode_report_done()
    except SystemExit:
        mobcode_report_done()
    except BaseException as error:
        mobcode_report_error(error)

mobcode_run_async(__mobcode_run__())
`
}

export function buildBrythonModuleSource(source: string): string {
  return buildBrythonTransformedSource(source, { rewriteTopLevelInput: false }).replace(/^ {4}/gm, '')
}

function buildBrythonTransformedSource(
  source: string,
  options: { rewriteTopLevelInput: boolean },
): string {
  const lines = source.split(/\r?\n/)
  const rewriteBareSleep = importsTimeSleep(lines)
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
      rewrittenLine = rewriteAwaitableCallsForAwait(line, rewriteBareSleep)
      rewrittenLine = rewriteCallNamesForAwait(rewrittenLine, asyncInputFunctionNames)
      rewrittenLine = rewriteMemberCallNamesForAwait(rewrittenLine, asyncInputMethodNames)
    } else if (!inFunctionScope && options.rewriteTopLevelInput) {
      rewrittenLine = rewriteAwaitableCallsForAwait(line, rewriteBareSleep)
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

  return userBody
}

export function buildBrythonRunnerHtml(payload: BrythonRunnerPayload): string {
  const serializedPayload = escapeScriptJson(payload)
  const entryContent = payload.files[payload.entryFile] ?? ''
  const serializedEntryContent = escapeScriptJson(buildBrythonAsyncEntrySource(entryContent))
  const serializedEntryFile = escapeScriptJson(payload.entryFile)
  const entryImportDiagnostic = findUnsupportedEntryImport(entryContent, payload.files)
  const serializedEntryImportDiagnostic = entryImportDiagnostic === null
    ? 'None'
    : escapeScriptJson(entryImportDiagnostic)
  const serializedWorkspaceFiles = escapeScriptJson(payload.files)
  const serializedWorkspacePythonModules = escapeScriptJson(Object.fromEntries(
    Object.entries(payload.files)
      .filter(([path]) => isPythonFile(path))
      .map(([path, content]) => [
        path,
        buildBrythonModuleSource(content),
      ]),
  ))
  const serializedBlockedImportRoots = escapeScriptJson(TERMINAL_BLOCKED_IMPORT_ROOTS)
  const serializedAllowedImportRoots = escapeScriptJson(TERMINAL_ALLOWED_IMPORT_ROOTS)
  const entryLineContent = entryContent.replace(/\r?\n$/, '')
  const entryLineCount = entryLineContent ? entryLineContent.split(/\r?\n/).length : 1
  const assetBaseUrl = payload.assetBaseUrl ? `${payload.assetBaseUrl.replace(/\/+$/, '')}/` : '/'
  const title = escapeHtml(payload.title)
  const entryFile = escapeHtml(payload.entryFile)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base href="${escapeHtml(assetBaseUrl)}">
  <title>${title}</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #111827;
      color: #e5e7eb;
    }
    * { box-sizing: border-box; }
    html,
    body {
      height: 100%;
      overflow: hidden;
    }
    body {
      margin: 0;
      height: 100vh;
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
      min-height: 0;
      display: flex;
      overflow: hidden;
    }
    #terminal {
      flex: 1;
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
    .dim { color: #9ca3af; }
    .error { color: #fca5a5; }
  </style>
  <script>
    try {
      Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
      Object.defineProperty(navigator, 'languages', { value: ['en-US', 'en'], configurable: true });
    } catch {}
  </script>
  <script src="/vendor/brython/brython.min.js"></script>
  <script src="/vendor/brython/brython_stdlib.js"></script>
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
    (() => {
      const NativeWorker = window.Worker;
      let activeNativeWorker = null;
      window.Worker = function(...args) {
        let workerUrlToRevoke = null;
        if (typeof args[0] === 'string' && args[0].startsWith('blob:')) {
          workerUrlToRevoke = URL.createObjectURL(new Blob([
            [
              "try {",
              "  Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });",
              "  Object.defineProperty(navigator, 'languages', { value: ['en-US', 'en'], configurable: true });",
              "} catch {}",
              "importScripts(" + JSON.stringify(args[0]) + ");",
            ].join("\\n")
          ], { type: 'text/javascript' }));
          args[0] = workerUrlToRevoke;
        }
        const worker = new NativeWorker(...args);
        if (workerUrlToRevoke) {
          setTimeout(() => URL.revokeObjectURL(workerUrlToRevoke), 0);
        }
        activeNativeWorker = worker;
        return worker;
      };
      window.Worker.prototype = NativeWorker.prototype;
      Object.setPrototypeOf(window.Worker, NativeWorker);
      window.mobcodeTerminateWorker = () => {
        if (!activeNativeWorker || typeof activeNativeWorker.terminate !== 'function') {
          throw new Error('The Python worker cannot be terminated by this browser.');
        }
        activeNativeWorker.terminate();
        activeNativeWorker = null;
      };
      window.mobcodeClearNativeWorker = () => {
        activeNativeWorker = null;
      };
    })();
    window.mobcodeTerminateWorker = window.mobcodeTerminateWorker || (() => {
      throw new Error('The Python worker cannot be terminated by this browser.');
    });
    window.mobcodeClearNativeWorker = window.mobcodeClearNativeWorker || (() => {});
    window.mobcodeTerminal = {
      maxChars: 100000,
      charsWritten: 0,
      truncated: false,
      scrollToBottom(terminal) {
        terminal.scrollTop = terminal.scrollHeight;
      },
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
        this.scrollToBottom(terminal);
      },
      writeln(value) {
        this.write(String(value) + '\\n');
      }
    };
    window.mobcodeInputBridge = (() => {
      let activeInput = null;
      const terminal = document.getElementById('terminal');
      terminal.addEventListener('click', () => {
        if (!activeInput) return;
        activeInput.focus();
      });
      function submitInput(input, value, requestId, submitInputResponse) {
        activeInput = null;
        submitInputResponse(requestId, value);
        input.replaceWith(document.createTextNode(value + '\\n'));
        window.mobcodeTerminal.scrollToBottom(document.getElementById('terminal'));
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
          window.mobcodeTerminal.scrollToBottom(terminal);
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
entry_import_diagnostic = ${serializedEntryImportDiagnostic}
workspace_files = ${serializedWorkspaceFiles}
workspace_python_modules = ${serializedWorkspacePythonModules}
input_sequence = 0
input_futures = {}
original_import = builtins.__import__
original_open = builtins.open
blocked_import_roots = set(${serializedBlockedImportRoots})
allowed_import_roots = set(${serializedAllowedImportRoots})

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

async def mobcode_sleep(seconds=0):
    try:
        delay = float(seconds)
    except Exception:
        delay = 0
    if delay < 0:
        delay = 0
    await aio.sleep(delay)

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
    if entry_import_diagnostic is not None:
        try:
            return int(entry_import_diagnostic.get('line', 1))
        except Exception:
            return None
    traceback_node = getattr(error, '__traceback__', None)
    while traceback_node is not None:
        frame = getattr(traceback_node, 'tb_frame', None)
        code = getattr(frame, 'f_code', None)
        filename = getattr(code, 'co_filename', None)
        if filename == entry_filename:
            line_number = getattr(traceback_node, 'tb_lineno', None)
            if line_number is not None and line_number <= entry_user_line_count + 1:
                return max(1, line_number - 1)
            return None
        traceback_node = getattr(traceback_node, 'tb_next', None)
    fallback_line_number = getattr(error, 'lineno', None)
    if fallback_line_number is not None:
        try:
            fallback_line_number = int(fallback_line_number)
        except Exception:
            return None
        if fallback_line_number <= entry_user_line_count + 1:
            return max(1, fallback_line_number - 1)
    return None

def format_user_error_header(error):
    line_number = find_user_error_line(error)
    if line_number is None:
        return '\\nError in ' + entry_filename + '\\n'
    return '\\nError in ' + entry_filename + ', line ' + str(line_number) + '\\n'

def mobcode_report_done():
    worker_self.send({'type': 'done'})

def mobcode_format_error(error):
    try:
        formatted_error = traceback.format_exc()
        if formatted_error.strip() != 'NoneType: None':
            return formatted_error
    except Exception:
        pass
    try:
        return error.__class__.__name__ + ': ' + str(error) + '\\n'
    except Exception:
        return 'Python error could not be formatted.\\n'

def mobcode_report_error(error):
    worker_self.send({'type': 'stderr', 'data': format_user_error_header(error)})
    worker_self.send({'type': 'stderr', 'data': mobcode_format_error(error)})

def mobcode_run_async(coroutine):
    aio.run(coroutine)

def mobcode_normalize_workspace_path(path):
    value = str(path).replace('\\\\', '/')
    if '://' in value or value.startswith('/') or value.startswith('~'):
        raise ValueError('Path is outside the MobCode workspace: ' + value)
    parts = []
    for part in value.split('/'):
        if part == '' or part == '.':
            continue
        if part == '..':
            raise ValueError('Path is outside the MobCode workspace: ' + value)
        parts.append(part)
    return '/'.join(parts)

def mobcode_find_workspace_file(path):
    normalized_path = mobcode_normalize_workspace_path(path)
    if normalized_path in workspace_files:
        return normalized_path
    entry_dir = entry_filename.rsplit('/', 1)[0] if '/' in entry_filename else ''
    if entry_dir:
        entry_relative_path = entry_dir + '/' + normalized_path
        if entry_relative_path in workspace_files:
            return entry_relative_path
    raise FileNotFoundError("No such MobCode workspace file: '" + normalized_path + "'")

class MobCodeReadOnlyFile:
    def __init__(self, path, content, binary=False):
        self.name = path
        self.closed = False
        self._binary = bool(binary)
        self._content = str(content).encode('utf-8') if self._binary else str(content)
        self._position = 0
        self._lines = None

    def _ensure_open(self):
        if self.closed:
            raise ValueError('I/O operation on closed file.')

    def readable(self):
        return True

    def writable(self):
        return False

    def seekable(self):
        return True

    def read(self, size=-1):
        self._ensure_open()
        if size is None or int(size) < 0:
            result = self._content[self._position:]
            self._position = len(self._content)
            return result
        end = min(len(self._content), self._position + int(size))
        result = self._content[self._position:end]
        self._position = end
        return result

    def readline(self, size=-1):
        self._ensure_open()
        if self._position >= len(self._content):
            return b'' if self._binary else ''
        newline = b'\\n' if self._binary else '\\n'
        newline_index = self._content.find(newline, self._position)
        end = len(self._content) if newline_index == -1 else newline_index + 1
        if size is not None and int(size) >= 0:
            end = min(end, self._position + int(size))
        result = self._content[self._position:end]
        self._position = end
        return result

    def readlines(self):
        self._ensure_open()
        return list(self)

    def seek(self, offset, whence=0):
        self._ensure_open()
        if int(whence) == 0:
            next_position = int(offset)
        elif int(whence) == 1:
            next_position = self._position + int(offset)
        elif int(whence) == 2:
            next_position = len(self._content) + int(offset)
        else:
            raise ValueError('Invalid whence value.')
        self._position = max(0, min(len(self._content), next_position))
        return self._position

    def tell(self):
        self._ensure_open()
        return self._position

    def close(self):
        self.closed = True

    def __iter__(self):
        return self

    def __next__(self):
        line = self.readline()
        if line == (b'' if self._binary else ''):
            raise StopIteration
        return line

    def __enter__(self):
        self._ensure_open()
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()
        return False

def mobcode_open(path, mode='r', buffering=-1, encoding=None, errors=None, newline=None, closefd=True, opener=None):
    mode_text = str(mode)
    path_text = str(path)
    if any(flag in mode_text for flag in ['w', 'a', 'x', '+']):
        raise ValueError('MobCode workspace files are read-only in the terminal runner.')
    if not mode_text.startswith('r'):
        raise ValueError('MobCode workspace files are read-only in the terminal runner.')
    try:
        workspace_path = mobcode_find_workspace_file(path)
    except FileNotFoundError:
        if '#mobcode-python-worker' in path_text:
            return MobCodeReadOnlyFile(path_text, '', 'b' in mode_text)
        if path_text.startswith('VFS.'):
            return original_open(path, mode, buffering, encoding, errors, newline, closefd, opener)
        raise
    return MobCodeReadOnlyFile(workspace_path, workspace_files[workspace_path], 'b' in mode_text)

def mobcode_module_path(name):
    return str(name).replace('.', '/') + '.py'

def mobcode_create_workspace_module(name, path):
    module_type = original_import('types').ModuleType
    module = module_type(name)
    module.__file__ = path
    module.__package__ = name.rsplit('.', 1)[0] if '.' in name else ''
    sys.modules[name] = module
    module_globals = module.__dict__
    module_globals.update({
        '__builtins__': builtins,
        'input': mobcode_input,
        'mobcode_input': mobcode_input,
        'mobcode_sleep': mobcode_sleep,
    })
    compiled_module = compile(workspace_python_modules[path], path, 'exec')
    exec(compiled_module, module_globals)
    return module

def mobcode_import(name, globals=None, locals=None, fromlist=(), level=0):
    root_name = str(name).split('.', 1)[0]
    if level != 0:
        raise ImportError('Relative imports are not available in the terminal runner yet.')
    if root_name in blocked_import_roots:
        raise ImportError("Module '" + root_name + "' is not available in the terminal runner.")
    module_name = str(name)
    if module_name in sys.modules:
        return sys.modules[module_name]
    workspace_module_path = mobcode_module_path(module_name)
    if workspace_module_path in workspace_python_modules:
        return mobcode_create_workspace_module(module_name, workspace_module_path)
    if root_name not in allowed_import_roots:
        raise ImportError("Module '" + module_name + "' is not available in the terminal runner.")
    try:
        return original_import(name, globals, locals, fromlist, level)
    except BaseException as error:
        raise ImportError("Module '" + module_name + "' is not available in the terminal runner.") from error

sys.stdout = MobCodeWorkerOutput('stdout')
sys.stderr = MobCodeWorkerOutput('stderr')
builtins.input = mobcode_input
builtins.open = mobcode_open
builtins.__import__ = mobcode_import

try:
    if entry_import_diagnostic is not None:
        raise ImportError("Module '" + str(entry_import_diagnostic.get('moduleName', '')) + "' is not available in the terminal runner.")
    compiled_code = compile(entry_source, entry_filename, 'exec')
    runner_globals = {
        '__name__': '__main__',
        '__file__': entry_filename,
        '__builtins__': builtins,
        'mobcode_input': mobcode_input,
        'mobcode_sleep': mobcode_sleep,
        'mobcode_run_async': mobcode_run_async,
        'mobcode_report_done': mobcode_report_done,
        'mobcode_report_error': mobcode_report_error,
        'input': mobcode_input,
        'open': mobcode_open,
    }
    exec(compiled_code, runner_globals)
except BaseException as error:
    mobcode_report_error(error)
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
    window.mobcodeClearNativeWorker()
    window.mobcodeInputBridge.cancel()
    window.mobcodeRunnerSetState(state)

def stop_active_worker():
    if active_worker is None:
        return
    try:
        window.mobcodeTerminateWorker()
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
    assetBaseUrl: browserWindow.location?.origin,
  }))
  let popup: MobCodeRunnerPopup | null
  try {
    popup = browserWindow.open(runnerUrl, '_blank', RUNNER_POPUP_FEATURES)
  } catch {
    URL.revokeObjectURL(runnerUrl)
    return { opened: false, reason: 'popup-blocked' }
  }

  if (!popup) {
    URL.revokeObjectURL(runnerUrl)
    return { opened: false, reason: 'popup-blocked' }
  }

  popup.focus()
  return { opened: true }
}
