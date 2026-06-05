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

export function buildBrythonRunnerHtml(payload: BrythonRunnerPayload): string {
  const serializedPayload = escapeScriptJson(payload)
  const entryContent = payload.files[payload.entryFile] ?? ''
  const serializedEntryContent = escapeScriptJson(entryContent)
  const serializedEntryFile = escapeScriptJson(payload.entryFile)
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
    <div class="entry">${entryFile}</div>
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
    window.mobcodeTerminal = {
      write(value) {
        const terminal = document.getElementById('terminal');
        terminal.append(document.createTextNode(String(value)));
        terminal.scrollTop = terminal.scrollHeight;
      },
      input(promptText) {
        const promptValue = String(promptText || '');
        if (promptValue) this.write(promptValue);
        const value = window.prompt(promptValue) ?? '';
        this.write(value + '\\n');
        return value;
      }
    };
    window.addEventListener('error', (event) => {
      window.mobcodeTerminal.write('\\n[error] ' + event.message + '\\n');
    });
  </script>
  <script type="text/python" class="webworker" id="mobcode-python-worker">
from browser import self as worker_self
import builtins
import sys
import traceback

entry_filename = ${serializedEntryFile}
entry_source = ${serializedEntryContent}

class MobCodeWorkerOutput:
    def __init__(self, message_type):
        self.message_type = message_type

    def write(self, data):
        if data is not None:
            worker_self.send({'type': self.message_type, 'data': str(data)})

    def flush(self):
        pass

def mobcode_input(prompt=''):
    if prompt:
        worker_self.send({'type': 'stdout', 'data': str(prompt)})
    raise RuntimeError('input() is not available in the isolated Python runner yet.')

def find_user_error_line(error):
    traceback_node = getattr(error, '__traceback__', None)
    while traceback_node is not None:
        frame = getattr(traceback_node, 'tb_frame', None)
        code = getattr(frame, 'f_code', None)
        filename = getattr(code, 'co_filename', None)
        if filename == entry_filename:
            return getattr(traceback_node, 'tb_lineno', None)
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
    exec(compiled_code, {'__name__': '__main__', '__file__': entry_filename})
    worker_self.send({'type': 'done'})
except SystemExit:
    worker_self.send({'type': 'done'})
except Exception as error:
    worker_self.send({'type': 'stderr', 'data': format_user_error_header(error)})
    worker_self.send({'type': 'stderr', 'data': traceback.format_exc()})
  </script>
  <script type="text/python">
from browser import window, worker

entry_filename = ${serializedEntryFile}

def handle_worker_message(event):
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

def handle_worker_error(error):
    window.mobcodeTerminal.write('\\n[error] Python runner worker failed: ' + str(error) + '\\n')

if window.mobcodeRunnerShouldStart():
    window.mobcodeTerminal.write('[Python] Running ' + entry_filename + '\\n')
    worker.create_worker('mobcode-python-worker', None, handle_worker_message, handle_worker_error)
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
