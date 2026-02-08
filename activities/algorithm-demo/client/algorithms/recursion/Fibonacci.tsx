import { useEffect, useRef, type CSSProperties, type ChangeEvent } from 'react'
import PseudocodeRenderer from '../../components/PseudocodeRenderer'
import type { AlgorithmEvent, AlgorithmModule, AlgorithmState, AlgorithmViewProps } from '../index'

interface FibonacciFrame {
  n: number
  state: 'active' | 'waiting' | 'returning'
  result: number | null
  substep: number
  returnStage: number | null
  returnLine: string | null
  waitingFor: 'left' | 'right' | null
  leftValue: number | null
  rightValue: number | null
  overlayValue: number | null
}

interface FibonacciState extends AlgorithmState {
  n: number
  callStack: FibonacciFrame[]
  complete: boolean
  result: number | null
  substep: number
  highlightedLines: Set<string>
  overlays: Record<string, { value: unknown }>
  currentStep: string | null
}

const PSEUDOCODE = [
  '**Fibonacci(n)**',
  '    if n ≤ 1 then',
  '        return n',
  '    else',
  '        return Fibonacci(n − 1) + Fibonacci(n − 2)',
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

function createFrame(n: number): FibonacciFrame {
  return {
    n,
    state: 'active',
    result: null,
    substep: 0,
    returnStage: null,
    returnLine: null,
    waitingFor: null,
    leftValue: null,
    rightValue: null,
    overlayValue: null,
  }
}

function initFibonacciState(n = 6): FibonacciState {
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

function getFibonacciState(state: unknown): FibonacciState {
  if (!state || typeof state !== 'object') {
    return initFibonacciState()
  }
  return state as FibonacciState
}

function buildOverlays(callStack: FibonacciFrame[]): Record<string, { value: unknown }> {
  const overlays: Record<string, { value: unknown }> = {}

  callStack.forEach((frame) => {
    if (frame.state === 'waiting') return

    const lineId = frame.returnLine ?? 'line-4'
    if (frame.leftValue !== null && frame.rightValue !== null) {
      overlays[lineId] = { value: `${frame.leftValue} + ${frame.rightValue}` }
    } else if (frame.leftValue !== null) {
      overlays[lineId] = { value: `${frame.leftValue} + ?` }
    } else if (frame.rightValue !== null) {
      overlays[lineId] = { value: `? + ${frame.rightValue}` }
    } else if (frame.overlayValue !== null) {
      overlays[lineId] = { value: frame.overlayValue }
    }
  })

  return overlays
}

function performNextStep(state: FibonacciState): FibonacciState {
  const { n } = state
  let { complete, result } = state
  let { callStack, substep } = state
  const highlightedLines = new Set<string>()
  let currentStep: string | null = null

  if (complete) return state

  if (callStack.length === 0) {
    callStack = [createFrame(n)]
    highlightedLines.add('line-0')
    currentStep = `Start: Fibonacci(${n})`
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
          topFrame.substep = 2
        }
      } else if (topFrame.substep === 1) {
        highlightedLines.add('line-2')
        topFrame.result = topFrame.n
        topFrame.state = 'returning'
        topFrame.returnStage = 2
        topFrame.returnLine = 'line-2'
        currentStep = `return ${topFrame.n}`
        topFrame.substep = 3
      } else if (topFrame.substep === 2) {
        highlightedLines.add('line-3')
        currentStep = 'else'
        topFrame.substep = 3
      } else if (topFrame.substep === 3) {
        highlightedLines.add('line-4')
        currentStep = `return Fibonacci(${topFrame.n - 1}) + Fibonacci(${topFrame.n - 2})`
        topFrame.returnLine = 'line-4'
        topFrame.substep = 4
      } else if (topFrame.substep === 4) {
        highlightedLines.add('line-0')
        topFrame.state = 'waiting'
        topFrame.waitingFor = 'left'
        callStack = [...callStack, createFrame(topFrame.n - 1)]
        currentStep = `Enter: Fibonacci(${topFrame.n - 1})`
        substep = 0
      } else if (topFrame.substep === 5) {
        highlightedLines.add('line-0')
        topFrame.state = 'waiting'
        topFrame.waitingFor = 'right'
        callStack = [...callStack, createFrame(topFrame.n - 2)]
        currentStep = `Enter: Fibonacci(${topFrame.n - 2})`
        substep = 0
      }
    } else if (topFrame.state === 'returning') {
      if (topFrame.returnStage === 1) {
        if (topFrame.leftValue !== null && topFrame.rightValue !== null) {
          const computedResult = topFrame.leftValue + topFrame.rightValue
          topFrame.result = computedResult
          currentStep = `Compute return: ${topFrame.leftValue} + ${topFrame.rightValue} = ${computedResult}`
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

          if (parent.waitingFor === 'left') {
            parent.leftValue = returnValue
            parent.overlayValue = returnValue
            parent.waitingFor = null
            parent.state = 'active'
            parent.substep = 5
            parent.returnLine = parent.returnLine ?? 'line-4'
            highlightedLines.add(parent.returnLine)
            currentStep = `Return ${returnValue} to Fibonacci(${parent.n})`
          } else if (parent.waitingFor === 'right') {
            parent.rightValue = returnValue
            parent.overlayValue = returnValue
            parent.waitingFor = null
            parent.state = 'returning'
            parent.returnStage = 1
            parent.returnLine = parent.returnLine ?? 'line-4'
            highlightedLines.add(parent.returnLine)
            currentStep = `Return ${returnValue} to Fibonacci(${parent.n})`
          } else {
            parent.overlayValue = returnValue
            parent.state = 'returning'
            parent.returnStage = 1
            parent.returnLine = parent.returnLine ?? 'line-4'
            highlightedLines.add(parent.returnLine)
            currentStep = `Return ${returnValue} to Fibonacci(${parent.n})`
          }
        } else {
          result = returnValue
          complete = true
          highlightedLines.add(lineId)
          currentStep = `Algorithm complete! Fibonacci(${n}) = ${result}`
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
  const state = getFibonacciState(session.data.algorithmState)

  const handleSetN = (event: ChangeEvent<HTMLInputElement>) => {
    if (!onStateChange) return
    onStateChange(initFibonacciState(parseInputN(event.target.value, state.n)))
  }

  return (
    <div className="algorithm-manager">
      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={pseudoColumnStyle}>
          <div className="controls">
            <button onClick={() => onStateChange?.(performNextStep(state))} disabled={!onStateChange || state.complete}>
              Next Step
            </button>
            <button onClick={() => onStateChange?.(initFibonacciState())} disabled={!onStateChange}>
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
  const state = getFibonacciState(session.data.algorithmState)

  const handleSetN = (event: ChangeEvent<HTMLInputElement>) => {
    if (!onStateChange) return
    onStateChange(initFibonacciState(parseInputN(event.target.value, state.n)))
  }

  const controls = onStateChange ? (
    <div className="controls">
      <button onClick={() => onStateChange(performNextStep(state))} disabled={state.complete}>
        Next Step
      </button>
      <button onClick={() => onStateChange(initFibonacciState(state.n))}>Reset</button>
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

function CallStackVisualization({ state }: { state: FibonacciState }) {
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
                <div className="frame-header">Fibonacci(n: {frame.n})</div>
                <div className="frame-locals">
                  <div className="local-var">n = {frame.n}</div>
                  {frame.leftValue !== null ? (
                    <div className="local-var">
                      <em>tempLeft = {frame.leftValue}</em>
                    </div>
                  ) : null}
                  {frame.rightValue !== null ? (
                    <div className="local-var">
                      <em>tempRight = {frame.rightValue}</em>
                    </div>
                  ) : null}
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

function reduceFibonacciEvent(state: FibonacciState, event: AlgorithmEvent): FibonacciState {
  if (event.type === 'nextStep') {
    return performNextStep(state)
  }
  if (event.type === 'reset') {
    return initFibonacciState(state.n)
  }
  if (event.type === 'setN') {
    const nextN = typeof event.payload === 'number' ? clampInputN(event.payload) : state.n
    return initFibonacciState(nextN)
  }
  return state
}

const Fibonacci: AlgorithmModule = {
  id: 'fibonacci',
  name: 'Fibonacci (Recursion)',
  description: 'Demonstrate recursion with Fibonacci computation',
  category: 'recursion',
  pseudocode: PSEUDOCODE,
  initState: initFibonacciState as AlgorithmModule['initState'],
  reduceEvent: (state, event) => reduceFibonacciEvent(getFibonacciState(state), event),
  ManagerView,
  StudentView,
}

export default Fibonacci
