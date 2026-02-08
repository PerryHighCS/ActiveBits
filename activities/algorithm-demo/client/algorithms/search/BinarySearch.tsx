import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import PseudocodeRenderer from '../../components/PseudocodeRenderer'
import type { AlgorithmEvent, AlgorithmModule, AlgorithmState, AlgorithmViewProps } from '../index'

interface BinarySearchHistoryEntry {
  left: number
  right: number
  mid: number | null
  action: string | null
}

interface BinarySearchState extends AlgorithmState {
  array: number[]
  initialArray: number[]
  target: number
  left: number
  right: number
  mid: number | null
  substep: number
  found: boolean
  foundIndex: number
  currentStep: string | null
  highlightedLines: Set<string>
  history: BinarySearchHistoryEntry[]
}

type BinarySearchInput = number | ''

const PSEUDOCODE = [
  '**BinarySearch(A[0..n−1], target)**',
  '    left ← 0',
  '    right ← n − 1',
  '    while left ≤ right',
  '        mid ← floor((left + right) / 2)',
  '        if A[mid] == target then',
  '            return mid',
  '        else if A[mid] < target then',
  '            left ← mid + 1',
  '        else',
  '            right ← mid − 1',
  '    return −1',
]

function parseTargetInput(value: string): BinarySearchInput {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : ''
}

function initBinarySearchState(arraySize = 16, target: number | null = null): BinarySearchState {
  let nextValue = Math.floor(Math.random() * 20)
  const array = Array.from({ length: arraySize }, () => {
    const value = nextValue
    nextValue += Math.floor(Math.random() * 5) + 1
    return value
  })

  const randomTarget = array[Math.floor(Math.random() * arraySize)] ?? 0
  const resolvedTarget = target !== null ? target : randomTarget

  return {
    array,
    initialArray: [...array],
    target: resolvedTarget,
    left: 0,
    right: arraySize - 1,
    mid: null,
    substep: 0,
    found: false,
    foundIndex: -1,
    currentStep: null,
    highlightedLines: new Set<string>(),
    history: [],
  }
}

function resetBinarySearchState(state: BinarySearchState): BinarySearchState {
  const randomTarget =
    state.initialArray[Math.floor(Math.random() * state.initialArray.length)] ?? 0
  const target = typeof state.target === 'number' ? state.target : randomTarget

  return {
    array: [...state.initialArray],
    initialArray: [...state.initialArray],
    target,
    left: 0,
    right: state.initialArray.length - 1,
    mid: null,
    substep: 0,
    found: false,
    foundIndex: -1,
    currentStep: null,
    highlightedLines: new Set<string>(),
    history: [],
  }
}

function resetSearchWindow(state: BinarySearchState, target: number): BinarySearchState {
  return {
    ...state,
    target,
    left: 0,
    right: state.array.length - 1,
    mid: null,
    substep: 0,
    found: false,
    foundIndex: -1,
    currentStep: null,
    highlightedLines: new Set<string>(),
    history: [],
  }
}

function getBinarySearchState(rawState: unknown): BinarySearchState {
  if (!rawState || typeof rawState !== 'object') {
    return initBinarySearchState()
  }

  return rawState as BinarySearchState
}

function performNextStep(state: BinarySearchState): BinarySearchState {
  let { array, target, left, right, mid, found, foundIndex, history, substep } = state
  const highlightedLines = new Set<string>()
  let currentStep: string | null = null

  if (found) return state

  if (substep === 0) {
    highlightedLines.add('line-1')
    currentStep = 'Initialize: left ← 0'
    substep = 1
  } else if (substep === 1) {
    highlightedLines.add('line-2')
    currentStep = `Initialize: right ← n − 1 (${array.length - 1})`
    substep = 2
  } else if (substep === 2) {
    const condition = left <= right
    highlightedLines.add('line-3')
    currentStep = `Check while: left=${left} ≤ right=${right}? ${condition ? 'Yes' : 'No'}`
    substep = condition ? 3 : 99
  } else if (substep === 3) {
    mid = Math.floor((left + right) / 2)
    const midValue = array[mid] ?? '—'
    highlightedLines.add('line-4')
    currentStep = `mid ← floor((${left} + ${right}) / 2) = ${mid} (A[mid]=${midValue})`
    substep = 4
  } else if (substep === 4) {
    const midValue = mid === null ? undefined : array[mid]
    const equalsTarget = midValue === target
    highlightedLines.add('line-5')
    currentStep = `Check: A[${mid}] == ${target}? ${equalsTarget ? 'Yes' : 'No'}`
    substep = equalsTarget ? 6 : 5
  } else if (substep === 6) {
    const resolvedMid = mid ?? -1
    highlightedLines.add('line-6')
    found = true
    foundIndex = resolvedMid
    currentStep = `return ${resolvedMid}`
    substep = 100
  } else if (substep === 5) {
    const midValue = mid === null ? undefined : array[mid]
    const isLessThanTarget = typeof midValue === 'number' && midValue < target
    highlightedLines.add('line-7')
    currentStep = `Check: A[${mid}]=${midValue ?? '—'} < ${target}? ${isLessThanTarget ? 'Yes' : 'No'}`
    substep = isLessThanTarget ? 8 : 9
  } else if (substep === 8) {
    highlightedLines.add('line-8')
    left = (mid ?? -1) + 1
    mid = null
    currentStep = `left ← ${left}`
    substep = 2
  } else if (substep === 9) {
    highlightedLines.add('line-9')
    currentStep = 'else'
    substep = 10
  } else if (substep === 10) {
    highlightedLines.add('line-10')
    right = (mid ?? 0) - 1
    mid = null
    currentStep = `right ← ${right}`
    substep = 2
  } else if (substep === 99) {
    highlightedLines.add('line-11')
    found = true
    foundIndex = -1
    currentStep = 'return −1 (not found)'
    substep = 100
  }

  return {
    ...state,
    left,
    right,
    mid,
    found,
    foundIndex,
    substep,
    highlightedLines,
    currentStep,
    history: [...history, { left, right, mid, action: currentStep }],
  }
}

function ManagerView({ session, onStateChange }: AlgorithmViewProps) {
  const state = getBinarySearchState(session.data.algorithmState)
  const [inputTarget, setInputTarget] = useState<BinarySearchInput>(state.target)

  useEffect(() => {
    setInputTarget(state.target)
  }, [state.target])

  const handleTargetChange = (event: ChangeEvent<HTMLInputElement>) => {
    setInputTarget(parseTargetInput(event.target.value))
  }

  const handleTargetKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || inputTarget === '' || !onStateChange) return
    onStateChange(resetSearchWindow(state, inputTarget))
  }

  const handleNextStep = () => {
    if (!onStateChange) return

    if (inputTarget !== '' && inputTarget !== state.target) {
      onStateChange(resetSearchWindow(state, inputTarget))
      return
    }

    onStateChange(performNextStep(state))
  }

  const handleReset = () => {
    if (!onStateChange) return
    onStateChange(resetBinarySearchState(state))
  }

  const handleGenerate = () => {
    if (!onStateChange) return
    onStateChange(initBinarySearchState(state.array.length, null))
  }

  return (
    <div className="algorithm-manager">
      <div className="target-display">
        <button onClick={handleNextStep} disabled={!onStateChange || state.found}>
          Next Step
        </button>
        <button onClick={handleReset} disabled={!onStateChange}>Reset</button>
        <button onClick={handleGenerate} disabled={!onStateChange}>Generate New Array</button>
        <div style={{ whiteSpace: 'nowrap' }}>
          Searching for:&nbsp;
          {state.found || state.substep > 0 ? (
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
        <div style={{ flex: '0 0 auto', width: 'fit-content', minWidth: '240px' }}>
          <PseudocodeRenderer lines={PSEUDOCODE} highlightedLines={state.highlightedLines} />
        </div>
        <div style={{ flex: '1 1 380px', minWidth: '320px' }}>
          <ArrayVisualization state={state} />
        </div>
      </div>
    </div>
  )
}

function StudentView({ session, onStateChange }: AlgorithmViewProps) {
  const state = getBinarySearchState(session.data.algorithmState)
  const [inputTarget, setInputTarget] = useState<BinarySearchInput>(state.target)

  useEffect(() => {
    setInputTarget(state.target)
  }, [state.target])

  const handleTargetChange = (event: ChangeEvent<HTMLInputElement>) => {
    setInputTarget(parseTargetInput(event.target.value))
  }

  const handleTargetKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || inputTarget === '' || !onStateChange) return
    onStateChange(resetSearchWindow(state, inputTarget))
  }

  const handleNextStep = () => {
    if (!onStateChange) return

    if (inputTarget !== '' && inputTarget !== state.target) {
      onStateChange(resetSearchWindow(state, inputTarget))
    } else {
      onStateChange(performNextStep(state))
    }
  }

  const handleReset = () => {
    if (!onStateChange) return
    onStateChange(resetBinarySearchState(state))
  }

  const handleGenerate = () => {
    if (!onStateChange) return
    onStateChange(initBinarySearchState(state.array.length, null))
  }

  const controls = onStateChange ? (
    <div className="target-display" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
      <button onClick={handleNextStep} disabled={state.found}>Next Step</button>
      <button onClick={handleReset}>Reset</button>
      <button onClick={handleGenerate}>Generate New Array</button>
      <div style={{ whiteSpace: 'nowrap' }}>
        Searching for:&nbsp;
        {state.found || state.substep > 0 ? (
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
        <div style={{ flex: '0 0 auto', width: 'fit-content', minWidth: '240px' }}>
          <PseudocodeRenderer lines={PSEUDOCODE} highlightedLines={state.highlightedLines} />
        </div>
        <div style={{ flex: '1 1 380px', minWidth: '320px' }}>
          <ArrayVisualization state={state} />
        </div>
      </div>
    </div>
  )
}

function ArrayVisualization({ state }: { state: BinarySearchState }) {
  return (
    <div className="array-viz">
      <div className="array-container">
        {state.array.map((val, idx) => (
          <div key={idx} style={{ position: 'relative' }}>
            {idx === state.left && <div className="index-badge badge-left">L</div>}
            {idx === state.right && <div className="index-badge badge-right">R</div>}
            {idx === state.mid && <div className="index-badge badge-mid">M</div>}
            <div
              className={`array-item ${
                idx < state.left || idx > state.right ? 'eliminated' : ''
              } ${idx === state.mid ? 'current-mid' : ''} ${
                idx === state.foundIndex ? 'found' : ''
              }`}
            >
              {val}
            </div>
            <div className="array-index">{idx}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '8px', flexWrap: 'wrap' }}>
        <div className="var-box">
          <div className="var-label">left</div>
          <div className="var-value">{state.left}</div>
        </div>
        <div className="var-box">
          <div className="var-label">mid</div>
          <div className="var-value">{state.mid ?? '—'}</div>
        </div>
        <div className="var-box">
          <div className="var-label">right</div>
          <div className="var-value">{state.right}</div>
        </div>
      </div>
      <div className="status">
        {state.found && (
          <span className="completed">
            {state.foundIndex >= 0 ? `✓ Found at index ${state.foundIndex}!` : '✗ Not found'}
          </span>
        )}
      </div>
    </div>
  )
}

function reduceBinarySearchEvent(state: BinarySearchState, event: AlgorithmEvent): BinarySearchState {
  if (event.type === 'nextStep') {
    return performNextStep(state)
  }

  if (event.type === 'reset') {
    return resetBinarySearchState(state)
  }

  if (event.type === 'setTarget') {
    const payload = typeof event.payload === 'number' ? event.payload : null
    return initBinarySearchState(state.array.length, payload)
  }

  return state
}

const BinarySearch: AlgorithmModule = {
  id: 'binary-search',
  name: 'Binary Search',
  description: 'Efficiently search in a sorted array',
  category: 'search',
  pseudocode: PSEUDOCODE,
  initState: initBinarySearchState as AlgorithmModule['initState'],
  reduceEvent: (state, event) => reduceBinarySearchEvent(getBinarySearchState(state), event),
  ManagerView,
  StudentView,
}

export default BinarySearch
