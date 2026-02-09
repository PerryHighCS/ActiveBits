import { useEffect, useRef, type CSSProperties, type ChangeEvent } from 'react'
import PseudocodeRenderer from '../../components/PseudocodeRenderer'
import type { AlgorithmEvent, AlgorithmModule, AlgorithmState, AlgorithmViewProps } from '../index'

interface FactorialFrame {
  n: number
  state: 'active' | 'waiting' | 'returning'
  result: number | null
  pendingReturn: number | null
  substep: number
  returnStage: number | null
  returnLine: string | null
  overlayValue: number | null
}

interface FactorialState extends AlgorithmState {
  n: number
  callStack: FactorialFrame[]
  complete: boolean
  result: number | null
  substep: number
  highlightedLines: Set<string>
  overlays: Record<string, { value: unknown }>
  currentStep: string | null
}

const PSEUDOCODE = [
  '**Factorial(n)**',
  '    if n ≤ 1 then',
  '        return 1',
  '    else',
  '        return n * Factorial(n − 1)',
]

const pseudoColumnStyle: CSSProperties = {
  position: 'sticky',
  bottom: 0,
  alignSelf: 'flex-end',
  flex: '0 0 auto',
  width: 'fit-content',
  minWidth: '260px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  padding: '8px 0',
  background: '#fff',
  zIndex: 1,
}

function clampInputN(value: number): number {
  return Math.max(1, Math.min(value, 10))
}

function parseInputN(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? clampInputN(parsed) : fallback
}

function createFrame(n: number): FactorialFrame {
  return {
    n,
    state: 'active',
    result: null,
    pendingReturn: null,
    substep: 0,
    returnStage: null,
    returnLine: null,
    overlayValue: null,
  }
}

function initFactorialState(n = 5): FactorialState {
  return {
    n,
    callStack: [],
    complete: false,
    result: null,
    substep: 0,
    highlightedLines: new Set<string>(),
    overlays: {},
    currentStep: null,
  }
}

function getFactorialState(state: unknown): FactorialState {
  if (state === null || state === undefined || typeof state !== 'object') {
    return initFactorialState()
  }
  return state as FactorialState
}

function buildOverlays(callStack: FactorialFrame[]): Record<string, { value: unknown }> {
  const overlays: Record<string, { value: unknown }> = {}

  callStack.forEach((frame) => {
    const lineId = frame.returnLine ?? 'line-4'
    if (frame.state === 'returning' && frame.pendingReturn !== null) {
      overlays[lineId] = { value: `${frame.n} * ${frame.pendingReturn}` }
    } else if (frame.overlayValue !== null) {
      overlays[lineId] = { value: frame.overlayValue }
    }
  })

  return overlays
}

function performNextStep(state: FactorialState): FactorialState {
  const { n } = state
  let { complete, result } = state
  let { callStack, substep } = state
  const highlightedLines = new Set<string>()
  let currentStep: string | null = null

  if (complete) return state

  if (callStack.length === 0) {
    callStack = [createFrame(n)]
    highlightedLines.add('line-0')
    currentStep = `Start: Factorial(${n})`
    substep = 1
  } else {
    const topFrame = callStack[callStack.length - 1]
    if (!topFrame) return state

    if (topFrame.state === 'active') {
      if (topFrame.substep === 0) {
        highlightedLines.add('line-1')
        if (topFrame.n <= 1) {
          currentStep = `Check: ${topFrame.n} ≤ 1? Yes`
          topFrame.substep = 1
        } else {
          currentStep = `Check: ${topFrame.n} ≤ 1? No`
          topFrame.substep = 3
        }
      } else if (topFrame.substep === 1) {
        highlightedLines.add('line-2')
        topFrame.result = 1
        topFrame.state = 'returning'
        topFrame.returnStage = 2
        topFrame.returnLine = 'line-2'
        currentStep = 'return 1'
        topFrame.substep = 2
      } else if (topFrame.substep === 3) {
        highlightedLines.add('line-3')
        currentStep = 'else'
        topFrame.substep = 4
      } else if (topFrame.substep === 4) {
        highlightedLines.add('line-4')
        currentStep = `return ${topFrame.n} * Factorial(${topFrame.n - 1})`
        topFrame.returnLine = 'line-4'
        topFrame.substep = 4.5
      } else if (topFrame.substep === 4.5) {
        highlightedLines.add('line-0')
        topFrame.state = 'waiting'
        callStack = [...callStack, createFrame(topFrame.n - 1)]
        currentStep = `Enter: Factorial(${topFrame.n - 1})`
        substep = 0
      }
    } else if (topFrame.state === 'returning') {
      if (topFrame.returnStage === 1) {
        if (topFrame.pendingReturn !== null) {
          const computedResult = topFrame.n * topFrame.pendingReturn
          topFrame.result = computedResult
          topFrame.pendingReturn = null
          topFrame.overlayValue = null
          currentStep = `Compute return: ${topFrame.n} * ${computedResult / topFrame.n} = ${computedResult}`
        } else {
          currentStep = `Return ${topFrame.result}`
        }
        highlightedLines.add(topFrame.returnLine ?? 'line-4')
        topFrame.returnStage = 2
      } else {
        const poppedFrame = callStack.pop()
        if (!poppedFrame) return state

        const returnValue = poppedFrame.result
        const lineId = poppedFrame.returnLine ?? 'line-4'

        if (callStack.length > 0) {
          const parent = callStack[callStack.length - 1]
          if (!parent) return state

          parent.pendingReturn = returnValue
          parent.overlayValue = returnValue
          parent.state = 'returning'
          parent.returnStage = 1
          parent.returnLine = parent.returnLine ?? 'line-4'
          highlightedLines.add(parent.returnLine)
          currentStep = `Return ${returnValue} to Factorial(${parent.n})`
        } else {
          result = returnValue
          complete = true
          highlightedLines.add(lineId)
          currentStep = `Algorithm complete! Factorial(${n}) = ${result}`
        }
      }
    }
  }

  return {
    ...state,
    callStack,
    complete,
    result,
    substep,
    highlightedLines,
    overlays: buildOverlays(callStack),
    currentStep,
  }
}

function ManagerView({ session, onStateChange }: AlgorithmViewProps) {
  const state = getFactorialState(session.data.algorithmState)

  const handleSetN = (event: ChangeEvent<HTMLInputElement>) => {
    if (!onStateChange) return
    onStateChange(initFactorialState(parseInputN(event.target.value, state.n)))
  }

  return (
    <div className="algorithm-manager">
      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={pseudoColumnStyle}>
          <div className="controls">
            <button onClick={() => onStateChange?.(performNextStep(state))} disabled={!onStateChange || state.complete}>
              Next Step
            </button>
            <button onClick={() => onStateChange?.(initFactorialState())} disabled={!onStateChange}>
              Reset
            </button>
            <label>
              Input n:
              <input
                type="number"
                min="1"
                max="10"
                value={state.n}
                onChange={handleSetN}
              />
            </label>
          </div>
          <PseudocodeRenderer lines={PSEUDOCODE} highlightedIds={state.highlightedLines} overlays={state.overlays} />
          {state.currentStep && <div className={`step-info ${state.complete ? 'complete' : ''}`}>{state.currentStep}</div>}
        </div>
        <div style={{ flex: '1 1 320px', minWidth: '300px' }}>
          <CallStackVisualization state={state} />
        </div>
      </div>
    </div>
  )
}

function StudentView({ session, onStateChange }: AlgorithmViewProps) {
  const state = getFactorialState(session.data.algorithmState)

  const handleSetN = (event: ChangeEvent<HTMLInputElement>) => {
    if (!onStateChange) return
    onStateChange(initFactorialState(parseInputN(event.target.value, state.n)))
  }

  const controls = onStateChange ? (
    <div className="controls">
      <button onClick={() => onStateChange(performNextStep(state))} disabled={state.complete}>
        Next Step
      </button>
      <button onClick={() => onStateChange(initFactorialState(state.n))}>Reset</button>
      <label>
        Input n:
        <input
          type="number"
          min="1"
          max="10"
          value={state.n}
          onChange={handleSetN}
        />
      </label>
    </div>
  ) : null

  return (
    <div className="algorithm-student">
      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={pseudoColumnStyle}>
          {controls}
          <PseudocodeRenderer lines={PSEUDOCODE} highlightedIds={state.highlightedLines} overlays={state.overlays} />
          {state.currentStep && <div className={`step-info ${state.complete ? 'complete' : ''}`}>{state.currentStep}</div>}
        </div>
        <div style={{ flex: '1 1 320px', minWidth: '300px' }}>
          <CallStackVisualization state={state} />
        </div>
      </div>
    </div>
  )
}

function CallStackVisualization({ state }: { state: FactorialState }) {
  const callStack = Array.isArray(state.callStack) ? state.callStack : []
  const stackEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    stackEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [callStack.length])

  return (
    <div className="recursion-viz">
      <div className="call-stack">
        <h3>Call Stack (Activation Records):</h3>
        <div className="stack-frames">
          {callStack.length === 0 ? (
            <div className="empty-stack">Empty</div>
          ) : (
            callStack.map((frame, idx) => (
              <div key={idx} className={`stack-frame ${frame.state}`}>
                <div className="frame-header">Factorial(n: {frame.n})</div>
                <div className="frame-locals">
                  <div className="local-var">n = {frame.n}</div>
                </div>
                <div className="frame-return">
                  {frame.result !== null ? `return: ${frame.result}` : 'return: ?'}
                </div>
              </div>
            ))
          )}
          <div ref={stackEndRef} />
        </div>
      </div>
    </div>
  )
}

function reduceFactorialEvent(state: FactorialState, event: AlgorithmEvent): FactorialState {
  if (event.type === 'nextStep') {
    return performNextStep(state)
  }
  if (event.type === 'reset') {
    return initFactorialState(state.n)
  }
  if (event.type === 'setN') {
    const nextN = typeof event.payload === 'number' ? clampInputN(event.payload) : state.n
    return initFactorialState(nextN)
  }
  return state
}

const Factorial: AlgorithmModule = {
  id: 'factorial',
  name: 'Factorial (Recursion)',
  description: 'Demonstrate recursion with factorial computation',
  category: 'recursion',
  pseudocode: PSEUDOCODE,
  initState: initFactorialState as AlgorithmModule['initState'],
  reduceEvent: (state, event) => reduceFactorialEvent(getFactorialState(state), event),
  ManagerView,
  StudentView,
}

export default Factorial
