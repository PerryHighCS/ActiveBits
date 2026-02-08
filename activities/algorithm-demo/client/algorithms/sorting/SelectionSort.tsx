import type { CSSProperties } from 'react'
import PseudocodeRenderer from '../../components/PseudocodeRenderer'
import type { AlgorithmEvent, AlgorithmModule, AlgorithmState, AlgorithmViewProps } from '../index'

interface SelectionSortState extends AlgorithmState {
  array: number[]
  initialArray: number[]
  i: number
  minIndex: number
  j: number
  substep: number
  sorted: boolean
  currentStep: string | null
  highlightedLines: Set<string>
  swappingIndices: number[]
  swapAnimation: Record<number, number>
}

type SelectionSortCssVars = CSSProperties & {
  '--swap-offset'?: string
}

const PSEUDOCODE = [
  '**SelectionSort(A[0..n−1])**',
  '    for i ← 0 to n − 2',
  '        minIndex ← i',
  '        for j ← i + 1 to n − 1',
  '            if A[j] < A[minIndex] then',
  '                minIndex ← j',
  '        if minIndex ≠ i then',
  '            swap A[i] and A[minIndex]',
]

function initSelectionSortState(arraySize = 8): SelectionSortState {
  const array = Array.from({ length: arraySize }, () => Math.floor(Math.random() * 100) + 1)
  return {
    array,
    initialArray: [...array],
    i: 0,
    minIndex: 0,
    j: 0,
    substep: 0,
    sorted: false,
    currentStep: null,
    highlightedLines: new Set<string>(),
    swappingIndices: [],
    swapAnimation: {},
  }
}

function getSelectionSortState(state: unknown): SelectionSortState {
  if (!state || typeof state !== 'object') {
    return initSelectionSortState()
  }

  return state as SelectionSortState
}

function resetSelectionSortState(state: SelectionSortState): SelectionSortState {
  return {
    array: [...state.initialArray],
    initialArray: [...state.initialArray],
    i: 0,
    minIndex: 0,
    j: 0,
    substep: 0,
    sorted: false,
    currentStep: null,
    highlightedLines: new Set<string>(),
    swappingIndices: [],
    swapAnimation: {},
  }
}

function reduceSelectionSortEvent(state: SelectionSortState, event: AlgorithmEvent): SelectionSortState {
  if (event.type === 'nextStep') {
    return performNextStep(state)
  }

  if (event.type === 'reset') {
    return resetSelectionSortState(state)
  }

  if (event.type === 'setArraySize') {
    return typeof event.payload === 'number'
      ? initSelectionSortState(event.payload)
      : state
  }

  return state
}

function ManagerView({ session, onStateChange }: AlgorithmViewProps) {
  const state = getSelectionSortState(session.data.algorithmState)

  const handleNextStep = () => {
    if (!onStateChange) return
    onStateChange(performNextStep(state))
  }

  const handleReset = () => {
    if (!onStateChange) return
    onStateChange(reduceSelectionSortEvent(state, { type: 'reset' }))
  }

  const handleRegenerate = () => {
    if (!onStateChange) return
    onStateChange(initSelectionSortState())
  }

  return (
    <div className="algorithm-manager">
      <div className="controls">
        <button onClick={handleNextStep} disabled={!onStateChange || state.sorted}>
          Next Step
        </button>
        <button onClick={handleReset} disabled={!onStateChange}>Reset</button>
        <button onClick={handleRegenerate} disabled={!onStateChange}>Generate New Array</button>
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
  const state = getSelectionSortState(session.data.algorithmState)

  const handleNextStep = () => {
    if (!onStateChange) return
    onStateChange(performNextStep(state))
  }

  const handleReset = () => {
    if (!onStateChange) return
    onStateChange(reduceSelectionSortEvent(state, { type: 'reset' }))
  }

  const handleRegenerate = () => {
    if (!onStateChange) return
    onStateChange(initSelectionSortState())
  }

  const controls = onStateChange ? (
    <div className="controls">
      <button onClick={handleNextStep} disabled={state.sorted}>
        Next Step
      </button>
      <button onClick={handleReset}>Reset</button>
      <button onClick={handleRegenerate}>Generate New Array</button>
      {state.currentStep && (
        <div className="step-info" style={{ margin: 0, flex: '1 1 auto' }}>
          {state.currentStep}
        </div>
      )}
    </div>
  ) : (
    state.currentStep && <div className="step-info" style={{ margin: '0 0 16px 0' }}>{state.currentStep}</div>
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

function ArrayVisualization({ state }: { state: SelectionSortState }) {
  return (
    <div className="array-viz">
      <div className="array-container">
        {state.array.map((value, index) => {
          const offset = state.swapAnimation[index] ?? 0
          const swapStyle: SelectionSortCssVars | undefined = offset
            ? { '--swap-offset': `${offset * 52}px` }
            : undefined

          return (
            <div key={index} style={{ position: 'relative' }}>
              {index === state.i && <div className="index-badge badge-i">i</div>}
              {index === state.j && state.substep >= 3 && <div className="index-badge badge-j">j</div>}
              {index === state.minIndex && <div className="index-badge badge-min">m</div>}
              <div
                className={`array-item ${
                  index === state.i ? 'current-i' : ''
                } ${index === state.minIndex ? 'current-min' : ''} ${
                  index < state.i ? 'sorted' : ''
                } ${
                  state.substep >= 3 && index === state.j ? 'current-j' : ''
                } ${offset ? 'swap-anim' : ''}`}
                style={swapStyle}
              >
                {value}
              </div>
              <div className="array-index">{index}</div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '20px' }}>
        <div className="var-box">
          <div className="var-label">i</div>
          <div className="var-value">{state.i}</div>
        </div>
        <div className="var-box">
          <div className="var-label">minIndex</div>
          <div className="var-value">{state.minIndex}</div>
        </div>
        <div className="var-box">
          <div className="var-label">j</div>
          <div className="var-value">{state.j}</div>
        </div>
      </div>
      <div className="status">{state.sorted && <span className="completed"> ✓ Sorted!</span>}</div>
    </div>
  )
}

function performNextStep(state: SelectionSortState): SelectionSortState {
  const array = [...state.array]
  let { i, j, minIndex, substep, swapAnimation } = state
  const highlightedLines = new Set<string>()
  let currentStep: string | null = null

  if (substep !== 6 && Object.keys(swapAnimation).length > 0) {
    swapAnimation = {}
  }

  if (state.sorted) return state

  if (i >= array.length - 1) {
    return {
      ...state,
      sorted: true,
      currentStep: 'Algorithm complete',
      highlightedLines: new Set<string>(),
    }
  }

  if (substep === 0) {
    highlightedLines.add('line-1')
    currentStep = `Outer loop: i=${i}`
    substep = 1
  } else if (substep === 1) {
    minIndex = i
    highlightedLines.add('line-2')
    currentStep = `Set minIndex = i (${i})`
    substep = 2
  } else if (substep === 2) {
    j = i + 1
    highlightedLines.add('line-3')
    currentStep = `Inner loop: j starts at ${j}`
    substep = 3
  } else if (substep === 3) {
    if (j < array.length) {
      highlightedLines.add('line-4')
      const currentValue = array[j] ?? 0
      const currentMin = array[minIndex] ?? 0
      const isSmaller = currentValue < currentMin
      currentStep = `Check: A[${j}]=${currentValue} < A[${minIndex}]=${currentMin}? ${isSmaller ? 'Yes' : 'No'}`
      substep = isSmaller ? 4 : 5
    } else {
      highlightedLines.add('line-6')
      const needSwap = minIndex !== i
      currentStep = `Check swap: minIndex (${minIndex}) ${needSwap ? '≠' : '='} i (${i})`
      substep = needSwap ? 6 : 7
    }
  } else if (substep === 4) {
    minIndex = j
    highlightedLines.add('line-5')
    currentStep = `Update minIndex = j (${j})`
    substep = 4.2
  } else if (substep === 4.2) {
    j += 1
    highlightedLines.add('line-3')
    currentStep = `Advance j to ${j}`
    substep = 3
  } else if (substep === 5) {
    j += 1
    highlightedLines.add('line-3')
    currentStep = `Advance j to ${j}`
    substep = 3
  } else if (substep === 6) {
    highlightedLines.add('line-7')
    const offsets: Record<number, number> = {
      [i]: minIndex - i,
      [minIndex]: i - minIndex,
    }
    ;[array[i], array[minIndex]] = [array[minIndex] ?? 0, array[i] ?? 0]
    swapAnimation = offsets
    currentStep = `Swap A[${i}] with A[${minIndex}]`
    substep = 6.5
  } else if (substep === 6.5) {
    highlightedLines.add('line-1')
    i += 1
    currentStep = `Advance i to ${i}`
    substep = 1
  } else if (substep === 7) {
    i += 1
    highlightedLines.add('line-1')
    currentStep = `No swap; advance i to ${i}`
    substep = 1
  }

  const swappingIndices = Object.keys(swapAnimation).map((key) => Number.parseInt(key, 10))

  return {
    ...state,
    array,
    i,
    j,
    minIndex,
    substep,
    highlightedLines,
    currentStep,
    swappingIndices,
    swapAnimation,
  }
}

const SelectionSort: AlgorithmModule = {
  id: 'selection-sort',
  name: 'Selection Sort',
  description: 'Find minimum element and swap with current position',
  category: 'sorting',
  pseudocode: PSEUDOCODE,
  initState: initSelectionSortState as AlgorithmModule['initState'],
  reduceEvent: (state, event) => reduceSelectionSortEvent(getSelectionSortState(state), event),
  ManagerView,
  StudentView,
}

export default SelectionSort
