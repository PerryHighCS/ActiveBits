import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import RunnerControls from './RunnerControls'
import type { MobCodeRunnerId } from '../../shared/types'
import type { MobCodeRunnerDefinition } from '../runner/runnerUtils'

const pythonRunner: MobCodeRunnerDefinition = {
  id: 'brython-terminal',
  label: 'Python Terminal',
  description: 'Run a Python entry file in a popup terminal.',
}

const futureRunner = {
  id: 'future-runner' as MobCodeRunnerId,
  label: 'Future Runner',
  description: 'Reserved test runner.',
}

function renderRunnerControls(runners: readonly MobCodeRunnerDefinition[]) {
  return renderToStaticMarkup(
    <RunnerControls
      files={{ 'test.py': 'print("hello")' }}
      runnerId="brython-terminal"
      runners={runners}
      onRunCode={() => {}}
      onRunnerChange={() => {}}
    />,
  )
}

void test('RunnerControls hides the runtime selector when only one runner is available', () => {
  const html = renderRunnerControls([pythonRunner])

  assert.doesNotMatch(html, /Runner implementation/)
  assert.doesNotMatch(html, /<select/)
  assert.match(html, />Run<\/button>/)
})

void test('RunnerControls shows the runtime selector when multiple runners are available', () => {
  const html = renderRunnerControls([pythonRunner, futureRunner])

  assert.match(html, /aria-label="Runner implementation"/)
  assert.match(html, /Python Terminal/)
  assert.match(html, /Future Runner/)
})
