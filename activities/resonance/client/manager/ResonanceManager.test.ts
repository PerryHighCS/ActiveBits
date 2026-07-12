import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { storeCreateSessionBootstrapPayload } from '@src/components/common/manageDashboardUtils'
import {
  formatEndSessionError,
  formatQuestionImportError,
  handleQuestionListItemKeyDown,
  isAllQuestionsSelected,
  isQuestionStemVisuallyTruncated,
  normalizeActivationSelection,
  reconcileActivationSelection,
  resolveActivationSelectionAfterToggle,
  resolveActivationSelectionForRender,
  resolveLiveCountdown,
  resolveManagerActiveTab,
  resolvePasscode,
  resolveStagedAdvanceLabel,
  shouldAdvanceStagedQuestion,
  shouldRevealStagedChoices,
  shouldShowQuestionListActivationControls,
  shouldShowQuestionPanelActions,
  shouldRenderResonanceEndSessionButton,
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

void test('resolveManagerActiveTab follows the current staged question as the run advances', () => {
  const questions = [
    { id: 'q1' },
    { id: 'q2' },
  ]

  assert.equal(
    resolveManagerActiveTab({
      currentActiveTab: 'q1',
      previousStagedQuestionId: 'q1',
      questions,
      presentationMode: 'staged',
      stagedRun: {
        questionIds: ['q1', 'q2'],
        currentQuestionId: 'q2',
        currentIndex: 1,
        choicesRevealed: false,
        completedQuestionIds: ['q1'],
      },
    }),
    'q2',
  )
  assert.equal(
    resolveManagerActiveTab({
      currentActiveTab: 'q1',
      previousStagedQuestionId: 'q2',
      questions,
      presentationMode: 'staged',
      stagedRun: {
        questionIds: ['q1', 'q2'],
        currentQuestionId: 'q2',
        currentIndex: 1,
        choicesRevealed: false,
        completedQuestionIds: ['q1'],
      },
    }),
    'q1',
  )
  assert.equal(
    resolveManagerActiveTab({
      currentActiveTab: null,
      previousStagedQuestionId: null,
      questions,
      presentationMode: 'staged',
      stagedRun: {
        questionIds: ['q1', 'q2'],
        currentQuestionId: 'q2',
        currentIndex: 1,
        choicesRevealed: false,
        completedQuestionIds: ['q1'],
      },
    }),
    'q2',
  )
  assert.equal(
    resolveManagerActiveTab({
      currentActiveTab: 'q1',
      previousStagedQuestionId: null,
      questions,
      presentationMode: 'standard',
      stagedRun: null,
    }),
    'q1',
  )
  assert.equal(
    resolveManagerActiveTab({
      currentActiveTab: null,
      previousStagedQuestionId: null,
      questions,
      presentationMode: 'standard',
      stagedRun: null,
    }),
    'q1',
  )
})

void test('resolveLiveCountdown hides expired live-run deadlines', () => {
  assert.equal(
    resolveLiveCountdown({
      activeQuestionDeadlineAt: 1_000,
      hasLiveRun: false,
      now: 1_500,
    }),
    null,
  )
  assert.equal(
    resolveLiveCountdown({
      activeQuestionDeadlineAt: 3_000,
      hasLiveRun: true,
      now: 1_500,
    }),
    '0:02',
  )
  assert.equal(
    resolveLiveCountdown({
      activeQuestionDeadlineAt: null,
      hasLiveRun: true,
      now: 1_500,
    }),
    null,
  )
})

void test('resolveStagedAdvanceLabel names skip, next, and end staged actions', () => {
  assert.equal(
    resolveStagedAdvanceLabel({
      isStemOnlyMultipleChoice: true,
      currentIndex: 0,
      questionCount: 2,
    }),
    'Skip question',
  )
  assert.equal(
    resolveStagedAdvanceLabel({
      isStemOnlyMultipleChoice: false,
      currentIndex: 0,
      questionCount: 2,
    }),
    'Next question',
  )
  assert.equal(
    resolveStagedAdvanceLabel({
      isStemOnlyMultipleChoice: false,
      currentIndex: 1,
      questionCount: 2,
    }),
    'End staged run',
  )
})

void test('staged choice controls depend on the staged current question state', () => {
  const mcq = {
    id: 'q1',
    type: 'multiple-choice' as const,
    text: 'Pick one',
    order: 0,
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
  }
  const frq = {
    id: 'q2',
    type: 'free-response' as const,
    text: 'Explain',
    order: 1,
  }
  const hiddenChoicesRun = {
    questionIds: ['q1', 'q2'],
    currentQuestionId: 'q1',
    currentIndex: 0,
    choicesRevealed: false,
    completedQuestionIds: [],
  }
  const revealedChoicesRun = { ...hiddenChoicesRun, choicesRevealed: true }

  assert.equal(shouldRevealStagedChoices(mcq, hiddenChoicesRun), true)
  assert.equal(shouldAdvanceStagedQuestion(mcq, hiddenChoicesRun), false)
  assert.equal(shouldRevealStagedChoices(mcq, revealedChoicesRun), false)
  assert.equal(shouldAdvanceStagedQuestion(mcq, revealedChoicesRun), true)
  assert.equal(shouldRevealStagedChoices(frq, hiddenChoicesRun), false)
  assert.equal(shouldAdvanceStagedQuestion(frq, hiddenChoicesRun), true)
})

void test('formatQuestionImportError prefers useful error messages and falls back safely', () => {
  assert.equal(formatQuestionImportError(new Error('question set contains ids already in this session')), 'question set contains ids already in this session')
  assert.equal(formatQuestionImportError(new Error('   ')), 'Unable to load this question set into the session.')
  assert.equal(formatQuestionImportError('nope'), 'Unable to load this question set into the session.')
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

void test('shouldRenderResonanceEndSessionButton only shows for independent sessions', () => {
  assert.equal(shouldRenderResonanceEndSessionButton('ABC123'), true)
  assert.equal(shouldRenderResonanceEndSessionButton('CHILD:parent:abc12:resonance'), false)
  assert.equal(shouldRenderResonanceEndSessionButton(undefined), true)
})

void test('formatEndSessionError returns specific failures and a fallback message', () => {
  assert.equal(formatEndSessionError(new Error('Failed to end session (403)')), 'Failed to end session (403)')
  assert.equal(formatEndSessionError(new Error('   ')), 'Unable to end this Resonance session. Please try again.')
  assert.equal(formatEndSessionError('network'), 'Unable to end this Resonance session. Please try again.')
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

void test('handleQuestionListItemKeyDown prevents default browser behavior for button-like keys', () => {
  let activated = 0
  let prevented = 0
  const dom = new JSDOM('<!doctype html><html><body><div><input /></div></body></html>')
  const container = dom.window.document.querySelector('div') as HTMLElement
  const nestedControl = dom.window.document.querySelector('input') as HTMLElement

  handleQuestionListItemKeyDown({
    key: ' ',
    target: container,
    currentTarget: container,
    preventDefault: () => {
      prevented += 1
    },
  }, () => {
    activated += 1
  })

  handleQuestionListItemKeyDown({
    key: 'Enter',
    target: container,
    currentTarget: container,
    preventDefault: () => {
      prevented += 1
    },
  }, () => {
    activated += 1
  })

  handleQuestionListItemKeyDown({
    key: 'Tab',
    target: container,
    currentTarget: container,
    preventDefault: () => {
      prevented += 1
    },
  }, () => {
    activated += 1
  })

  handleQuestionListItemKeyDown({
    key: ' ',
    target: nestedControl,
    currentTarget: container,
    preventDefault: () => {
      prevented += 1
    },
  }, () => {
    activated += 1
  })

  assert.equal(activated, 2)
  assert.equal(prevented, 2)
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
