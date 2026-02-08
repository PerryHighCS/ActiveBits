import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import PseudocodeRenderer from '../../components/PseudocodeRenderer'
import type { AlgorithmEvent, AlgorithmModule, AlgorithmState, AlgorithmViewProps } from '../index'

type TmpAnimation = 'from-array' | 'to-array' | null

interface InsertionSortState extends AlgorithmState {
  array: number[]
  initialArray: number[]
  i: number
  j: number
  tmp: number | null
  substep: number
  sorted: boolean
  currentStep: string | null
  highlightedLines: Set<string>
  shiftedIndices: number[]
  transitionIndices: number[]
  moveAnimations: Record<number, number>
  tmpAnim: TmpAnimation
  tmpPos: number | null
}

interface TmpOffsets {
  offsetX: number
  offsetY: number
  targetX: number
  targetY: number
}

type InsertionSortCssVars = CSSProperties & {
  '--move-offset'?: string
  '--tmp-offset-x'?: string
  '--tmp-offset-y'?: string
  '--tmp-target-x'?: string
  '--tmp-target-y'?: string
}

const PSEUDOCODE = [
  '**InsertionSort(A[0..n−1])**',
  '    for i ← 1 to n − 1',
  '        tmp ← A[i]',
  '        j ← i − 1',
  '        while j ≥ 0 and A[j] > tmp',
  '            A[j + 1] ← A[j]',
  '            j ← j − 1',
  '        A[j + 1] ← tmp',
]

function initInsertionSortState(arraySize = 8): InsertionSortState {
  const array = Array.from({ length: arraySize }, () => Math.floor(Math.random() * 100) + 1)
  return {
    array,
    initialArray: [...array],
    i: 1,
    j: 0,
    tmp: null,
    substep: 0,
    sorted: false,
    currentStep: null,
    highlightedLines: new Set<string>(),
    shiftedIndices: [],
    transitionIndices: [],
    moveAnimations: {},
    tmpAnim: null,
    tmpPos: null,
  }
}

function getInsertionSortState(state: unknown): InsertionSortState {
  if (!state || typeof state !== 'object') {
    return initInsertionSortState()
  }

  return state as InsertionSortState
}

function resetInsertionSortState(state: InsertionSortState): InsertionSortState {
  return {
    array: [...state.initialArray],
    initialArray: [...state.initialArray],
    i: 1,
    j: 0,
    tmp: null,
    substep: 0,
    sorted: false,
    currentStep: null,
    highlightedLines: new Set<string>(),
    shiftedIndices: [],
    transitionIndices: [],
    moveAnimations: {},
    tmpAnim: null,
    tmpPos: null,
  }
}

function reduceInsertionSortEvent(state: InsertionSortState, event: AlgorithmEvent): InsertionSortState {
  if (event.type === 'nextStep') {
    return performNextStep(state)
  }

  if (event.type === 'reset') {
    return resetInsertionSortState(state)
  }

  if (event.type === 'setArraySize') {
    return typeof event.payload === 'number'
      ? initInsertionSortState(event.payload)
      : state
  }

  return state
}

function ManagerView({ session, onStateChange }: AlgorithmViewProps) {
  const state = getInsertionSortState(session.data.algorithmState)

  const handleNextStep = () => {
    if (!onStateChange) return
    onStateChange(performNextStep(state))
  }

  const handleReset = () => {
    if (!onStateChange) return
    onStateChange(reduceInsertionSortEvent(state, { type: 'reset' }))
  }

  const handleRegenerate = () => {
    if (!onStateChange) return
    onStateChange(initInsertionSortState())
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
  const state = getInsertionSortState(session.data.algorithmState)

  const handleNextStep = () => {
    if (!onStateChange) return
    onStateChange(performNextStep(state))
  }

  const handleReset = () => {
    if (!onStateChange) return
    onStateChange(reduceInsertionSortEvent(state, { type: 'reset' }))
  }

  const handleRegenerate = () => {
    if (!onStateChange) return
    onStateChange(initInsertionSortState())
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
          <PseudocodeRenderer lines={PSEUDOCODE} highlightedLines={state.highlightedLines} />
        </div>
        <div style={{ flex: '1 1 380px', minWidth: '320px' }}>
          <ArrayVisualization state={state} />
        </div>
      </div>
    </div>
  )
}

function ArrayVisualization({ state }: { state: InsertionSortState }) {
  const shiftedSet = new Set<number>(Array.isArray(state.shiftedIndices) ? state.shiftedIndices : [])
  const transitionSet = new Set<number>(Array.isArray(state.transitionIndices) ? state.transitionIndices : [])
  const itemRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const tmpRef = useRef<HTMLDivElement | null>(null)
  const [tmpOffsets, setTmpOffsets] = useState<TmpOffsets>({ offsetX: 0, offsetY: 0, targetX: 0, targetY: 0 })

  const registerItemRef = (index: number) => (element: HTMLDivElement | null) => {
    if (element) {
      itemRefs.current[index] = element
    }
  }

  useLayoutEffect(() => {
    const tmpElement = tmpRef.current
    if (!tmpElement) return

    const tmpRect = tmpElement.getBoundingClientRect()
    const tmpCenterX = tmpRect.left + tmpRect.width / 2
    const tmpCenterY = tmpRect.top + tmpRect.height / 2

    if (state.tmpAnim === 'from-array' && itemRefs.current[state.i]) {
      const source = itemRefs.current[state.i]
      if (!source) return

      const sourceRect = source.getBoundingClientRect()
      const sourceCenterX = sourceRect.left + sourceRect.width / 2
      const sourceCenterY = sourceRect.top + sourceRect.height / 2
      setTmpOffsets({
        offsetX: sourceCenterX - tmpCenterX,
        offsetY: sourceCenterY - tmpCenterY,
        targetX: 0,
        targetY: 0,
      })
    } else if (state.tmpAnim === 'to-array' && state.tmpPos !== null && itemRefs.current[state.tmpPos]) {
      const destination = itemRefs.current[state.tmpPos]
      if (!destination) return

      const destinationRect = destination.getBoundingClientRect()
      const destinationCenterX = destinationRect.left + destinationRect.width / 2
      const destinationCenterY = destinationRect.top + destinationRect.height / 2
      setTmpOffsets({
        offsetX: 0,
        offsetY: 0,
        targetX: destinationCenterX - tmpCenterX,
        targetY: destinationCenterY - tmpCenterY,
      })
    } else {
      setTmpOffsets({ offsetX: 0, offsetY: 0, targetX: 0, targetY: 0 })
    }
  }, [state.tmpAnim, state.tmpPos, state.i, state.array.length])

  const tmpValueStyle: InsertionSortCssVars = {
    '--tmp-offset-x': `${tmpOffsets.offsetX}px`,
    '--tmp-offset-y': `${tmpOffsets.offsetY}px`,
    '--tmp-target-x': `${tmpOffsets.targetX}px`,
    '--tmp-target-y': `${tmpOffsets.targetY}px`,
  }

  return (
    <div className="array-viz">
      <div className="array-container">
        {state.array.map((value, index) => {
          const moveOffset = state.moveAnimations[index]
          const moveStyle: InsertionSortCssVars | undefined = moveOffset
            ? { '--move-offset': `${moveOffset}px` }
            : undefined

          return (
            <div key={index} style={{ position: 'relative' }} ref={registerItemRef(index)}>
              {index === state.i && <div className="index-badge badge-i-centered">i</div>}
              {index === state.j && state.substep >= 3 && <div className="index-badge badge-j-centered">j</div>}
              <div
                className={`array-item ${index < state.i ? 'sorted' : ''} ${index === state.i ? 'current-i' : ''} ${shiftedSet.has(index) ? 'shifted' : ''} ${transitionSet.has(index) ? 'transition' : ''} ${state.tmpPos === index ? 'tmp-placed' : ''} ${moveOffset ? 'move-anim' : ''}`}
                style={moveStyle}
              >
                {value}
              </div>
              <div className="array-index">{index}</div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '20px' }}>
        <div className="tmp-box">
          <div className="tmp-label">tmp</div>
          <div
            className={`tmp-value${state.tmpAnim === 'from-array' ? ' tmp-from-array' : ''}${state.tmpAnim === 'to-array' ? ' tmp-to-array' : ''}`}
            ref={tmpRef}
            style={tmpValueStyle}
          >
            {state.tmp}
          </div>
        </div>
        <div className="var-box">
          <div className="var-label">i</div>
          <div className="var-value">{state.i}</div>
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

function performNextStep(state: InsertionSortState): InsertionSortState {
  const array = [...state.array]
  let { i, j, tmp, substep, shiftedIndices, transitionIndices, tmpPos, moveAnimations, tmpAnim } = state
  const highlightedLines = new Set<string>()
  let currentStep: string | null = null

  if (state.sorted) return state

  if (i >= array.length) {
    return {
      ...state,
      sorted: true,
      currentStep: 'Algorithm complete',
      highlightedLines: new Set<string>(),
    }
  }

  if (substep === 0) {
    shiftedIndices = []
    transitionIndices = []
    moveAnimations = {}
    tmpAnim = null
    tmp = null
    tmpPos = null
    highlightedLines.add('line-1')
    currentStep = `Outer loop: i=${i}`
    substep = 1
  } else if (substep === 1) {
    tmp = array[i] ?? null
    tmpAnim = 'from-array'
    highlightedLines.add('line-2')
    currentStep = `Set tmp = A[${i}] = ${tmp}`
    substep = 2
  } else if (substep === 2) {
    j = i - 1
    highlightedLines.add('line-3')
    currentStep = `Set j = ${i} - 1 = ${j}`
    substep = 3
  } else if (substep === 3) {
    const conditionMet = j >= 0 && (array[j] ?? 0) > (tmp ?? 0)
    highlightedLines.add('line-4')
    currentStep = `Check while: j=${j} >= 0 and A[${j}]=${array[j]} > ${tmp}? ${conditionMet ? 'Yes' : 'No'}`
    substep = conditionMet ? 4 : 5
  } else if (substep === 4) {
    array[j + 1] = array[j] ?? 0
    shiftedIndices = [...shiftedIndices, j]
    transitionIndices = [...transitionIndices, j + 1]
    moveAnimations = { ...moveAnimations, [j + 1]: -52 }
    highlightedLines.add('line-5')
    currentStep = `Shift: A[${j + 1}] = A[${j}] = ${array[j + 1]}`
    substep = 4.5
  } else if (substep === 4.5) {
    j -= 1
    highlightedLines.add('line-6')
    currentStep = `Decrement: j = ${j}`
    substep = 3
  } else if (substep === 5) {
    array[j + 1] = tmp ?? 0
    tmpPos = j + 1
    moveAnimations = {}
    tmpAnim = 'to-array'
    i += 1
    substep = 0
    highlightedLines.add('line-7')
    currentStep = `Insert: A[${j + 1}] = ${array[j + 1]}`
  }

  return {
    ...state,
    array,
    i,
    j,
    tmp,
    substep,
    highlightedLines,
    currentStep,
    shiftedIndices,
    transitionIndices,
    tmpPos,
    moveAnimations,
    tmpAnim,
  }
}

const InsertionSort: AlgorithmModule = {
  id: 'insertion-sort',
  name: 'Insertion Sort',
  description: 'Build sorted array by inserting elements one by one',
  category: 'sorting',
  pseudocode: PSEUDOCODE,
  initState: initInsertionSortState as AlgorithmModule['initState'],
  reduceEvent: (state, event) => reduceInsertionSortEvent(getInsertionSortState(state), event),
  ManagerView,
  StudentView,
}

export default InsertionSort
