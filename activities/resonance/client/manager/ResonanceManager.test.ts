import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { storeCreateSessionBootstrapPayload } from '@src/components/common/manageDashboardUtils'
import {
  isAllQuestionsSelected,
  isQuestionStemVisuallyTruncated,
  normalizeActivationSelection,
  reconcileActivationSelection,
  resolveActivationSelectionAfterToggle,
  resolveActivationSelectionForRender,
  resolvePasscode,
  shouldShowQuestionListActivationControls,
  shouldShowQuestionPanelActions,
  toggleExpandedQuestionStem,
  toggleQuestionActivationSelection,
} from './ResonanceManager.js'

function installDomEnvironment() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://activebits.local/',
  })

  const previousWindow = globalThis.window
  const previousDocument = globalThis.document

  ;(globalThis as { window?: Window & typeof globalThis }).window = dom.window as unknown as Window & typeof globalThis
  ;(globalThis as { document?: Document }).document = dom.window.document

  return () => {
    dom.window.close()
    ;(globalThis as { window?: Window & typeof globalThis }).window = previousWindow
    ;(globalThis as { document?: Document }).document = previousDocument
  }
}

void test('toggleQuestionActivationSelection adds and removes question ids', () => {
  assert.deepEqual(toggleQuestionActivationSelection(['q1'], 'q2'), ['q1', 'q2'])
  assert.deepEqual(toggleQuestionActivationSelection(['q1', 'q2'], 'q1'), ['q2'])
})

void test('toggleExpandedQuestionStem adds and removes expanded question ids', () => {
  assert.deepEqual(toggleExpandedQuestionStem(['q1'], 'q2'), ['q1', 'q2'])
  assert.deepEqual(toggleExpandedQuestionStem(['q1', 'q2'], 'q1'), ['q2'])
})

void test('normalizeActivationSelection keeps valid selection and falls back to live questions or all available questions', () => {
  assert.deepEqual(
    normalizeActivationSelection(['q2'], ['q1', 'q2', 'q3'], ['q1', 'q3']),
    ['q2'],
  )
  assert.deepEqual(
    normalizeActivationSelection(['missing'], ['q1', 'q2', 'q3'], ['q1', 'q3']),
    ['q1', 'q3'],
  )
  assert.deepEqual(
    normalizeActivationSelection(['missing'], ['q1', 'q2', 'q3'], []),
    ['q1', 'q2', 'q3'],
  )
  assert.deepEqual(
    normalizeActivationSelection([], ['q1', 'q2', 'q3'], []),
    ['q1', 'q2', 'q3'],
  )
  assert.deepEqual(
    normalizeActivationSelection([], [], []),
    [],
  )
})

void test('reconcileActivationSelection only applies defaults while selection is uninitialized', () => {
  assert.deepEqual(
    reconcileActivationSelection(null, ['q1', 'q2', 'q3'], []),
    ['q1', 'q2', 'q3'],
  )
  assert.deepEqual(
    reconcileActivationSelection(null, ['q1', 'q2', 'q3'], ['q2']),
    ['q2'],
  )
  assert.deepEqual(
    reconcileActivationSelection([], ['q1', 'q2', 'q3'], ['q2']),
    [],
  )
  assert.deepEqual(
    reconcileActivationSelection(['missing', 'q2'], ['q1', 'q2', 'q3'], []),
    ['q2'],
  )

  const current = ['q1', 'q2']
  assert.equal(
    reconcileActivationSelection(current, ['q1', 'q2', 'q3'], []),
    current,
  )
})

void test('resolveActivationSelectionForRender applies the default selection before the snapshot effect runs', () => {
  assert.deepEqual(
    resolveActivationSelectionForRender(null, ['q1', 'q2', 'q3'], []),
    ['q1', 'q2', 'q3'],
  )
  assert.deepEqual(
    resolveActivationSelectionForRender(null, ['q1', 'q2', 'q3'], ['q2']),
    ['q2'],
  )
  assert.deepEqual(
    resolveActivationSelectionForRender([], ['q1', 'q2', 'q3'], ['q2']),
    [],
  )
})

void test('resolveActivationSelectionAfterToggle uses the rendered default selection before first interaction', () => {
  assert.deepEqual(
    resolveActivationSelectionAfterToggle(null, 'q2', ['q1', 'q2', 'q3'], []),
    ['q1', 'q3'],
  )
  assert.deepEqual(
    resolveActivationSelectionAfterToggle(null, 'q2', ['q1', 'q2', 'q3'], ['q2']),
    [],
  )
  assert.deepEqual(
    resolveActivationSelectionAfterToggle([], 'q2', ['q1', 'q2', 'q3'], ['q2']),
    ['q2'],
  )
})

void test('isAllQuestionsSelected only returns true when every available question is selected', () => {
  assert.equal(isAllQuestionsSelected(new Set(), []), false)
  assert.equal(isAllQuestionsSelected(new Set(['q1']), ['q1', 'q2']), false)
  assert.equal(isAllQuestionsSelected(new Set(['q1', 'q2']), ['q1', 'q2']), true)
  assert.equal(isAllQuestionsSelected(new Set(['q1', 'q2', 'extra']), ['q1', 'q2']), true)
})

void test('shouldShowQuestionListActivationControls keeps activate and stop available for single-question sessions', () => {
  assert.equal(shouldShowQuestionListActivationControls(0), false)
  assert.equal(shouldShowQuestionListActivationControls(1), true)
  assert.equal(shouldShowQuestionListActivationControls(3), true)
})

void test('shouldShowQuestionPanelActions only keeps share controls on multiple-choice questions', () => {
  assert.equal(
    shouldShowQuestionPanelActions({
      id: 'q1',
      type: 'multiple-choice',
      text: 'Pick one',
      order: 0,
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
    }),
    true,
  )

  assert.equal(
    shouldShowQuestionPanelActions({
      id: 'q2',
      type: 'free-response',
      text: 'Explain why',
      order: 1,
    }),
    false,
  )
})

void test('isQuestionStemVisuallyTruncated uses rendered overflow rather than stem length', () => {
  assert.equal(
    isQuestionStemVisuallyTruncated({
      clientWidth: 120,
      scrollWidth: 160,
      clientHeight: 16,
      scrollHeight: 16,
    }),
    true,
  )
  assert.equal(
    isQuestionStemVisuallyTruncated({
      clientWidth: 120,
      scrollWidth: 120,
      clientHeight: 16,
      scrollHeight: 28,
    }),
    true,
  )
  assert.equal(
    isQuestionStemVisuallyTruncated({
      clientWidth: 120,
      scrollWidth: 120,
      clientHeight: 16,
      scrollHeight: 16,
    }),
    false,
  )
  assert.equal(isQuestionStemVisuallyTruncated(null), false)
})

void test('resolvePasscode persists embedded bootstrap passcodes for later manager re-entry', () => {
  const restoreDomEnvironment = installDomEnvironment()

  try {
    storeCreateSessionBootstrapPayload('resonance', 'child-session-1', {
      instructorPasscode: 'embedded-passcode',
    })

    assert.equal(resolvePasscode('child-session-1'), 'embedded-passcode')
    assert.equal(
      window.sessionStorage.getItem('resonance_instructor_child-session-1'),
      'embedded-passcode',
    )

    assert.equal(resolvePasscode('child-session-1'), 'embedded-passcode')
  } finally {
    restoreDomEnvironment()
  }
})
