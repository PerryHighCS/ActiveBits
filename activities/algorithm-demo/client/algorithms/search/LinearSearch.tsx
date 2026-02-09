import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import PseudocodeRenderer from '../../components/PseudocodeRenderer'
import type { AlgorithmEvent, AlgorithmModule, AlgorithmState, AlgorithmViewProps } from '../index'

interface LinearSearchState extends AlgorithmState {
  array: number[]
  initialArray: number[]
  target: number
  i: number
  found: boolean
  foundIndex: number
  substep: number
  currentStep: string | null
  highlightedLines: Set<string>
}

type LinearSearchInput = number | ''

const PSEUDOCODE = [
  '**LinearSearch(A[0..n−1], target)**',
  '    for i ← 0 to n − 1',
  '        if A[i] == target then',
  '            return i',
  '    return −1',
]

function parseTargetInput(value: string): LinearSearchInput {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : ''
}

function initLinearSearchState(arraySize = 10, target: number | null = null): LinearSearchState {
  const array = Array.from({ length: arraySize }, () => Math.floor(Math.random() * 100) + 1)
  const randomValue = array[Math.floor(Math.random() * arraySize)] ?? 0
  const resolvedTarget =
    target !== null ? target : randomValue

  return {
    array,
    initialArray: [...array],
    target: resolvedTarget,
    i: 0,
    found: false,
    foundIndex: -1,
    substep: 0,
    currentStep: null,
    highlightedLines: new Set<string>(),
  }
}

function resetLinearSearchState(state: LinearSearchState): LinearSearchState {
  const randomValue = state.initialArray[Math.floor(Math.random() * state.initialArray.length)] ?? 0
  const target =
    typeof state.target === 'number'
      ? state.target
      : randomValue

  return {
    array: [...state.initialArray],
    initialArray: [...state.initialArray],
    target,
    i: 0,
    found: false,
    foundIndex: -1,
    substep: 0,
    currentStep: null,
    highlightedLines: new Set<string>(),
  }
}

function getLinearSearchState(rawState: unknown): LinearSearchState {
  if (rawState === null || rawState === undefined || typeof rawState !== 'object') {
    return initLinearSearchState()
  }

  return rawState as LinearSearchState
}

function performNextStep(state: LinearSearchState): LinearSearchState {
  const { array, target } = state
  let { i, found, foundIndex, substep } = state
  const highlightedLines = new Set<string>()
  let currentStep: string | null = null

  if (found) return state

  if (substep === 0) {
    const canContinue = i < array.length
    highlightedLines.add('line-1')
    if (!canContinue) {
      substep = 99
      currentStep = `Loop complete: i=${i} >= array.length=${array.length}`
    } else {
      substep = 1
      currentStep = `Check loop: i=${i} < array.length=${array.length}? Yes`
    }
  } else if (substep === 1) {
    const matches = array[i] === target
    highlightedLines.add('line-2')
    if (matches) {
      substep = 2
      currentStep = `Check: A[${i}] == ${target}? Yes`
    } else {
      substep = 3
      currentStep = `Check: A[${i}] == ${target}? No (A[${i}]=${array[i]})`
    }
  } else if (substep === 2) {
    found = true
    foundIndex = i
    highlightedLines.add('line-3')
    currentStep = `return ${i}`
    substep = 100
  } else if (substep === 3) {
    i += 1
    highlightedLines.add('line-1')
    substep = 0
    currentStep = `Increment: i ← ${i}`
  } else if (substep === 99) {
    found = true
    foundIndex = -1
    highlightedLines.add('line-4')
    currentStep = 'return −1'
    substep = 100
  }

  return {
    ...state,
    i,
    found,
    foundIndex,
    substep,
    highlightedLines,
    currentStep,
  }
}

function ManagerView({ session, onStateChange }: AlgorithmViewProps) {
  const state = getLinearSearchState(session.data.algorithmState)
  const [inputTarget, setInputTarget] = useState<LinearSearchInput>(state.target)

  useEffect(() => {
    setInputTarget(state.target)
  }, [state.target])

  const handleTargetChange = (event: ChangeEvent<HTMLInputElement>) => {
    setInputTarget(parseTargetInput(event.target.value))
  }

  const handleTargetKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || inputTarget === '' || !onStateChange) return
    onStateChange(initLinearSearchState(state.array.length, inputTarget))
  }

  const handleNextStep = () => {
    if (!onStateChange) return

    if (inputTarget !== '' && inputTarget !== state.target) {
      onStateChange(initLinearSearchState(state.array.length, inputTarget))
      return
    }

    onStateChange(performNextStep(state))
  }

  const handleReset = () => {
    if (!onStateChange) return
    onStateChange(resetLinearSearchState(state))
  }

  const handleGenerate = () => {
    if (!onStateChange) return
    onStateChange(initLinearSearchState(state.array.length, null))
  }

  return (
    <div className="algorithm-manager">
      <div className="target-display">
        <button onClick={handleNextStep} disabled={!onStateChange || state.found}>
          Next Step
        </button>
        <button onClick={handleReset} disabled={!onStateChange}>Reset</button>
        <button onClick={handleGenerate} disabled={!onStateChange}>
          Generate New Array
        </button>
        <div style={{ whiteSpace: 'nowrap' }}>
          Searching for:&nbsp;
          {state.found || state.i > 0 || state.substep > 0 ? (
            <strong>{state.target}</strong>
          ) : (
            <input
              type="number"
              value={inputTarget}
              onChange={handleTargetChange}
              onKeyDown={handleTargetKeyDown}
            />
          )}
        </div>
        {state.currentStep && (
          <div className="step-info" style={{ margin: 0, flex: '1 1 auto' }}>
            {state.currentStep}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: '280px' }}>
          <PseudocodeRenderer lines={PSEUDOCODE} highlightedIds={state.highlightedLines} />
        </div>
        <div style={{ flex: '1 1 380px', minWidth: '320px' }}>
          <ArrayVisualization state={state} />
        </div>
      </div>
    </div>
  )
}

function StudentView({ session, onStateChange }: AlgorithmViewProps) {
  const state = getLinearSearchState(session.data.algorithmState)
  const [inputTarget, setInputTarget] = useState<LinearSearchInput>(state.target)

  useEffect(() => {
    setInputTarget(state.target)
  }, [state.target])

  const handleTargetChange = (event: ChangeEvent<HTMLInputElement>) => {
    setInputTarget(parseTargetInput(event.target.value))
  }

  const handleTargetKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || inputTarget === '' || !onStateChange) return
    onStateChange(initLinearSearchState(state.array.length, inputTarget))
  }

  const handleNextStep = () => {
    if (!onStateChange) return

    if (inputTarget !== '' && inputTarget !== state.target) {
      onStateChange(initLinearSearchState(state.array.length, inputTarget))
    } else {
      onStateChange(performNextStep(state))
    }
  }

  const handleReset = () => {
    if (!onStateChange) return
    onStateChange(resetLinearSearchState(state))
  }

  const handleGenerate = () => {
    if (!onStateChange) return
    onStateChange(initLinearSearchState(state.array.length, null))
  }

  const controls = onStateChange ? (
    <div className="target-display" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
      <button onClick={handleNextStep} disabled={state.found}>Next Step</button>
      <button onClick={handleReset}>Reset</button>
      <button onClick={handleGenerate}>Generate New Array</button>
      <div style={{ whiteSpace: 'nowrap' }}>
        Searching for:&nbsp;
        {state.found || state.i > 0 || state.substep > 0 ? (
          <strong>{state.target}</strong>
        ) : (
          <input
            type="number"
            value={inputTarget}
            onChange={handleTargetChange}
            onKeyDown={handleTargetKeyDown}
          />
        )}
      </div>
      {state.currentStep && (
        <div className="step-info" style={{ margin: 0, flex: '1 1 auto' }}>
          {state.currentStep}
        </div>
      )}
    </div>
  ) : (
    <div className="target-display" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ whiteSpace: 'nowrap' }}>
        Searching for: <strong>{state.target}</strong>
      </div>
      {state.currentStep && (
        <div className="step-info" style={{ margin: 0, flex: '1 1 auto' }}>
          {state.currentStep}
        </div>
      )}
    </div>
  )

  return (
    <div className="algorithm-student">
      {controls}
      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: '280px' }}>
          <PseudocodeRenderer lines={PSEUDOCODE} highlightedIds={state.highlightedLines} />
        </div>
        <div style={{ flex: '1 1 380px', minWidth: '320px' }}>
          <ArrayVisualization state={state} />
        </div>
      </div>
    </div>
  )
}

function ArrayVisualization({ state }: { state: LinearSearchState }) {
  return (
    <div className="array-viz">
      <div className="array-container">
        {state.array.map((val, idx) => (
          <div key={idx} style={{ position: 'relative' }}>
            {idx === state.i && <div className="index-badge">i</div>}
            <div
              className={`array-item ${idx < state.i ? 'checked' : ''} ${
                idx === state.i ? 'current' : ''
              } ${idx === state.foundIndex ? 'found' : ''}`}
            >
              {val}
            </div>
            <div className="array-index">{idx}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '8px' }}>
        <div className="var-box">
          <div className="var-label">i</div>
          <div className="var-value">{state.i}</div>
        </div>
      </div>
      <div className="status">
        {state.found && (
          <span className="completed">
            {state.foundIndex >= 0 ? ` ✓ Found at index ${state.foundIndex}!` : ' ✗ Not found'}
          </span>
        )}
      </div>
    </div>
  )
}

function reduceLinearSearchEvent(state: LinearSearchState, event: AlgorithmEvent): LinearSearchState {
  if (event.type === 'nextStep') {
    return performNextStep(state)
  }

  if (event.type === 'reset') {
    return resetLinearSearchState(state)
  }

  return state
}

const LinearSearch: AlgorithmModule = {
  id: 'linear-search',
  name: 'Linear Search',
  description: 'Search by examining each element sequentially',
  category: 'search',
  pseudocode: PSEUDOCODE,
  initState: initLinearSearchState as AlgorithmModule['initState'],
  reduceEvent: (state, event) => reduceLinearSearchEvent(getLinearSearchState(state), event),
  ManagerView,
  StudentView,
}

export default LinearSearch
