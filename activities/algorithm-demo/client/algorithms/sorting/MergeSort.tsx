import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import PseudocodeRenderer from '../../components/PseudocodeRenderer'
import type { AlgorithmEvent, AlgorithmModule, AlgorithmState, AlgorithmViewProps } from '../index'

type FrameState = 'active' | 'waiting' | 'returning'
type AnimationTarget = string | null

interface MergeCallFrame {
  function: 'MergeSortHelper' | 'Merge'
  left: number
  right: number
  mid: number
  i: number
  j: number
  k: number
  m: number
  state: FrameState
  substep: number
  callSite: string
  returnTo: string
  shouldPop: boolean
}

function initMergeSortState(arraySize = 8) {
  const array = Array.from({ length: arraySize }, () => Math.floor(Math.random() * 100) + 1)
  const scratch = new Array<number | null>(arraySize).fill(null)
  return {
    array,
    initialArray: [...array],
    scratch,
    callStack: [] as MergeCallFrame[],
    complete: false,
    substep: 0,
    highlightedLines: new Set<string>(),
    currentStep: null as string | null,
    animFrom: null as AnimationTarget,
    animTo: null as AnimationTarget,
    animValue: null as number | null,
    copiedBackIndices: [] as number[],
    scratchWritten: [] as number[],
  }
}

type MergeSortState = ReturnType<typeof initMergeSortState>

function getMergeSortState(state: unknown): MergeSortState {
  if (state === null || state === undefined || typeof state !== 'object') {
    return initMergeSortState()
  }

  return state as MergeSortState
}

function reduceMergeSortEvent(state: MergeSortState, event: AlgorithmEvent): MergeSortState {
  if (event.type === 'nextStep') {
    return performNextStep(state)
  }

  if (event.type === 'reset') {
    return {
      array: [...state.initialArray],
      initialArray: state.initialArray,
      scratch: new Array(state.initialArray.length).fill(null),
      callStack: [],
      complete: false,
      substep: 0,
      highlightedLines: new Set<string>(),
      currentStep: null,
      animFrom: null,
      animTo: null,
      animValue: null,
      copiedBackIndices: [],
      scratchWritten: [],
    }
  }

  if (event.type === 'setArraySize') {
    return typeof event.payload === 'number'
      ? initMergeSortState(event.payload)
      : state
  }

  return state
}

const PSEUDOCODE = [
  '**MergeSort(A[0..n−1])**',
  '    Create S[0..n−1]',
  '    MergeSortHelper(A, S, 0, n − 1)',
  '',
  '**MergeSortHelper(A, S, left, right)**',
  '    if left ≥ right then',
  '        return',
  '    mid ← floor((left + right) / 2)',
  '    MergeSortHelper(A, S, left, mid)',
  '    MergeSortHelper(A, S, mid + 1, right)',
  '    Merge(A, S, left, mid, right)',
  '',
  '**Merge(A, S, left, mid, right)**',
  '    i ← left',
  '    j ← mid + 1',
  '    k ← left',
  '    while i ≤ mid and j ≤ right',
  '        if A[i] ≤ A[j] then',
  '            S[k] ← A[i]',
  '            i ← i + 1',
  '        else',
  '            S[k] ← A[j]',
  '            j ← j + 1',
  '        k ← k + 1',
  '    while i ≤ mid',
  '        S[k] ← A[i]',
  '        i ← i + 1',
  '        k ← k + 1',
  '    while j ≤ right',
  '        S[k] ← A[j]',
  '        j ← j + 1',
  '        k ← k + 1',
  '    for m ← left to right',
  '        A[m] ← S[m]',
];

const MergeSort: AlgorithmModule = {
  id: 'merge-sort',
  name: 'Merge Sort',
  description: 'Divide and conquer sorting using recursion and merge',
  category: 'sorting',
  pseudocode: PSEUDOCODE,
  initState(...args: Array<number | string | null | undefined>) {
    const arraySize = args[0]
    return typeof arraySize === 'number' ? initMergeSortState(arraySize) : initMergeSortState()
  },
  reduceEvent(state: AlgorithmState, event: AlgorithmEvent) {
    return reduceMergeSortEvent(getMergeSortState(state), event)
  },

  ManagerView({ session, onStateChange }: AlgorithmViewProps) {
    const state = getMergeSortState(session.data.algorithmState)
    const pseudocodeRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
      if (pseudocodeRef.current && state.highlightedLines.size > 0) {
        const firstHighlighted = Array.from(state.highlightedLines)[0];
        const element = pseudocodeRef.current.querySelector(`#${firstHighlighted}`);
        if (element) {
          const containerRect = pseudocodeRef.current.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();
          const isVisible = elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom;
          if (!isVisible) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }
    }, [state.currentStep]);

    const handleNextStep = () => {
      const newState = performNextStep(state);
      onStateChange?.(newState);
    };

    const handleReset = () => {
      onStateChange?.(reduceMergeSortEvent(state, { type: 'reset' }));
    };

    const handleRegenerate = () => {
      onStateChange?.(initMergeSortState());
    };

    return (
      <div className="algorithm-manager">
        <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', height: 'calc(100vh - 100px)' }}>
          <div ref={pseudocodeRef} style={{ flex: '1 1 320px', minWidth: '280px', overflowY: 'auto', maxHeight: '100%' }}>
            <PseudocodeRenderer
              lines={PSEUDOCODE}
              highlightedLines={state.highlightedLines}
              className="compact"
            />
          </div>
          <div style={{ flex: '1 1 380px', minWidth: '320px', display: 'flex', flexDirection: 'column', maxHeight: '100%' }}>
            <div style={{ position: 'sticky', top: '0', background: 'white', zIndex: 10, paddingBottom: '12px', flexShrink: 0 }}>
              <div className="controls">
                <button onClick={handleNextStep} disabled={state.complete}>
                  Next Step
                </button>
                <button onClick={handleReset}>Reset</button>
                <button onClick={handleRegenerate}>Generate New Array</button>
              </div>
              {state.currentStep && (
                <div className="step-info" style={{ margin: '8px 0 0 0' }}>{state.currentStep}</div>
              )}
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <ArrayVisualization state={state} />
              <CallStackVisualization state={state} />
            </div>
          </div>
        </div>
      </div>
    );
  },

  StudentView({ session, onStateChange }: AlgorithmViewProps) {
    const state = getMergeSortState(session.data.algorithmState)
    const pseudocodeRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
      if (pseudocodeRef.current && state.highlightedLines.size > 0) {
        const firstHighlighted = Array.from(state.highlightedLines)[0];
        const element = pseudocodeRef.current.querySelector(`#${firstHighlighted}`);
        if (element) {
          const containerRect = pseudocodeRef.current.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();
          const isVisible = elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom;
          if (!isVisible) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }
    }, [state.currentStep]);

    const handleNextStep = () => {
      if (!onStateChange) return;
      const newState = performNextStep(state);
      onStateChange(newState);
    };

    const handleReset = () => {
      if (!onStateChange) return;
      onStateChange(reduceMergeSortEvent(state, { type: 'reset' }));
    };

    const handleRegenerate = () => {
      if (!onStateChange) return;
      onStateChange(initMergeSortState());
    };

    const controls = onStateChange ? (
      <div className="controls">
        <button onClick={handleNextStep} disabled={state.complete}>
          Next Step
        </button>
        <button onClick={handleReset}>Reset</button>
        <button onClick={handleRegenerate}>Generate New Array</button>
      </div>
    ) : null;

    return (
      <div className="algorithm-student">
        <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', height: 'calc(100vh - 100px)' }}>
          <div ref={pseudocodeRef} style={{ flex: '1 1 320px', minWidth: '280px', overflowY: 'auto', maxHeight: '100%' }}>
            <PseudocodeRenderer
              lines={PSEUDOCODE}
              highlightedLines={state.highlightedLines}
              className="compact"
            />
          </div>
          <div style={{ flex: '1 1 380px', minWidth: '320px', display: 'flex', flexDirection: 'column', maxHeight: '100%' }}>
            <div style={{ position: 'sticky', top: '0', background: 'white', zIndex: 10, paddingBottom: '12px', flexShrink: 0 }}>
              {controls}
              {state.currentStep && (
                <div className="step-info" style={{ margin: controls ? '8px 0 0 0' : '0' }}>{state.currentStep}</div>
              )}
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <ArrayVisualization state={state} />
              <CallStackVisualization state={state} />
            </div>
          </div>
        </div>
      </div>
    );
  },
};

function ArrayVisualization({ state }: { state: MergeSortState }) {
  const topFrame = state.callStack.length > 0 ? state.callStack[state.callStack.length - 1] : null;
  const left = topFrame?.left ?? null;
  const right = topFrame?.right ?? null;
  const mid = topFrame && topFrame.mid >= 0 ? topFrame.mid : null;
  const i = topFrame && topFrame.i >= 0 ? topFrame.i : null;
  const j = topFrame && topFrame.j >= 0 ? topFrame.j : null;
  const k = topFrame && topFrame.k >= 0 ? topFrame.k : null;
  const m = topFrame && topFrame.m >= 0 ? topFrame.m : null;

  const arrayRefs = useRef<Record<number, HTMLElement | null>>({})
  const scratchRefs = useRef<Record<number, HTMLElement | null>>({})
  const [animOffsets, setAnimOffsets] = useState({ offsetX: 0, offsetY: 0 })

  const registerArrayRef = (idx: number) => (el: HTMLElement | null) => {
    if (el) arrayRefs.current[idx] = el
  }

  const registerScratchRef = (idx: number) => (el: HTMLElement | null) => {
    if (el) scratchRefs.current[idx] = el
  }

  useLayoutEffect(() => {
    if (state.animFrom && state.animTo) {
      const [fromType, fromIdx = '0'] = String(state.animFrom).split('-')
      const [toType, toIdx = '0'] = String(state.animTo).split('-')
      
      const fromRefs = fromType === 'array' ? arrayRefs.current : scratchRefs.current;
      const toRefs = toType === 'array' ? arrayRefs.current : scratchRefs.current;
      
      const fromEl = fromRefs[Number.parseInt(fromIdx, 10)]
      const toEl = toRefs[Number.parseInt(toIdx, 10)]
      
      if (fromEl && toEl) {
        const fromRect = fromEl.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();
        const fromCenterX = fromRect.left + fromRect.width / 2;
        const fromCenterY = fromRect.top + fromRect.height / 2;
        const toCenterX = toRect.left + toRect.width / 2;
        const toCenterY = toRect.top + toRect.height / 2;
        
        setAnimOffsets({
          offsetX: fromCenterX - toCenterX,
          offsetY: fromCenterY - toCenterY
        })
      }
    } else {
      setAnimOffsets({ offsetX: 0, offsetY: 0 })
    }
  }, [state.animFrom, state.animTo])

  return (
    <div className="array-viz">
      <div className="array-label" style={{ fontWeight: 'bold', marginBottom: '8px' }}>Array A:</div>
      <div className="array-container">
        {state.array.map((val: number, idx: number) => {
          const isInRange = left !== null && right !== null && idx >= left && idx <= right;

          const isMid = idx === mid;
          const isI = idx === i;
          const isJ = idx === j;
          const isM = idx === m;
          const isAnimSource = state.animFrom === `array-${idx}`;
          const isAnimTarget = state.animTo === `array-${idx}`;

          return (
            <div key={idx} style={{ position: "relative" }} ref={registerArrayRef(idx)}>
              {isI && <div className="index-badge badge-i-centered">i</div>}
              {isJ && <div className="index-badge badge-j-centered">j</div>}
              {isM && <div className="index-badge badge-m-centered">m</div>}
              <div
                className={`array-item ${isInRange ? "in-range" : ""} ${isMid ? "mid-marker" : ""} ${isAnimSource ? "anim-fade" : ""} ${isAnimTarget ? "anim-arrive" : ""}`}
                style={{
                  opacity: isInRange || left === null ? 1 : 0.3,
                  '--anim-offset-x': `${animOffsets.offsetX}px`,
                  '--anim-offset-y': `${animOffsets.offsetY}px`,
                } as CSSProperties}
              >
                {isAnimTarget && state.animValue !== null ? state.animValue : val}
              </div>
              <div className="array-index">{idx}</div>
            </div>
          );
        })}
      </div>

      <div className="array-label" style={{ fontWeight: 'bold', marginTop: '20px', marginBottom: '8px' }}>Scratch S:</div>
      {(state.substep >= 2 || state.callStack.length > 0) && (
        <div className="array-container">
          {state.scratch.map((val: number | null, idx: number) => {
          const isInRange = left !== null && right !== null && idx >= left && idx <= right;
          const isK = idx === k;
          const isM = idx === m;
          const isAnimSource = state.animFrom === `scratch-${idx}`;
          const isAnimTarget = state.animTo === `scratch-${idx}`;
          const isCopiedBack = Array.isArray(state.copiedBackIndices) && state.copiedBackIndices.includes(idx);
          const hasValue = val !== null;
          const isWrittenToScratch = Array.isArray(state.scratchWritten) && state.scratchWritten.includes(idx);
          const shouldBeBlue = hasValue && isWrittenToScratch && !isCopiedBack;
          
          return (
            <div key={idx} style={{ position: "relative" }} ref={registerScratchRef(idx)}>
              {isK && <div className="index-badge badge-k-centered">k</div>}
              {isM && <div className="index-badge badge-m-centered">m</div>}
              <div
                className={`array-item scratch-item ${shouldBeBlue ? "in-range" : ""} ${isAnimSource ? "anim-fade" : ""} ${isAnimTarget ? "anim-arrive" : ""} ${isCopiedBack ? "copied-back" : ""}`}
                style={{
                  opacity: isInRange || left === null ? 1 : 0.3,
                  backgroundColor: isCopiedBack ? undefined : (shouldBeBlue ? '#3498db' : '#e0e0e0'),
                  color: isCopiedBack ? undefined : (shouldBeBlue ? '#fff' : '#999'),
                  '--anim-offset-x': `${animOffsets.offsetX}px`,
                  '--anim-offset-y': `${animOffsets.offsetY}px`,
                } as CSSProperties}
              >
                {isAnimTarget && state.animValue !== null ? state.animValue : (val !== null ? val : '−')}
              </div>
              <div className="array-index">{idx}</div>
            </div>
          );
        })}
        </div>
      )}

      <div style={{ display: "flex", gap: "16px", justifyContent: "center", marginTop: "20px", flexWrap: "wrap" }}>
        {topFrame && (
          <>
            <div className="var-box">
              <div className="var-label">left</div>
              <div className="var-value">{left !== null ? left : '--'}</div>
            </div>
            <div className="var-box">
              <div className="var-label">mid</div>
              <div className="var-value">{mid !== null ? mid : '--'}</div>
            </div>
            <div className="var-box">
              <div className="var-label">right</div>
              <div className="var-value">{right !== null ? right : '--'}</div>
            </div>
            {topFrame.function === 'Merge' && (
              <>
                <div className="var-box">
                  <div className="var-label">i</div>
                  <div className="var-value">{i !== null ? i : '--'}</div>
                </div>
                <div className="var-box">
                  <div className="var-label">j</div>
                  <div className="var-value">{j !== null ? j : '--'}</div>
                </div>
                <div className="var-box">
                  <div className="var-label">k</div>
                  <div className="var-value">{k !== null ? k : '--'}</div>
                </div>
                <div className="var-box">
                  <div className="var-label">m</div>
                  <div className="var-value">{m !== null ? m : '--'}</div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="status">
        {state.complete && <span className="completed"> ✓ Sorted!</span>}
      </div>
    </div>
  );
}

function CallStackVisualization({ state }: { state: MergeSortState }) {
  const callStack = Array.isArray(state.callStack) ? state.callStack : [];

  if (callStack.length === 0) return null;

  return (
    <div className="recursion-viz" style={{ marginTop: '24px' }}>
      <div className="call-stack">
        <h3>Call Stack (Activation Records):</h3>
        <div className="stack-frames">
          {[...callStack].reverse().map((frame, idx) => (
            <div key={callStack.length - 1 - idx} className={`stack-frame ${frame.state}`}>
              <div className="frame-header">
                {frame.function === 'MergeSortHelper' 
                  ? `MergeSortHelper(A, S, ${frame.left}, ${frame.right})`
                  : frame.function === 'Merge'
                  ? `Merge(A, S, ${frame.left}, ${frame.mid}, ${frame.right})`
                  : 'MergeSort(A)'}
              </div>
              <div className="frame-locals">
                {frame.function === 'MergeSortHelper' && (
                  <>
                    <div className="local-var">left = {frame.left !== null && frame.left !== undefined ? frame.left : '--'}</div>
                    <div className="local-var">right = {frame.right !== null && frame.right !== undefined ? frame.right : '--'}</div>
                    <div className="local-var">mid = {frame.mid >= 0 ? frame.mid : '--'}</div>
                  </>
                )}
                {frame.function === 'Merge' && (
                  <>
                    <div className="local-var">left = {frame.left !== null && frame.left !== undefined ? frame.left : '--'}, mid = {frame.mid !== null && frame.mid !== undefined ? frame.mid : '--'}, right = {frame.right !== null && frame.right !== undefined ? frame.right : '--'}</div>
                    <div className="local-var">i = {frame.i >= 0 ? frame.i : '--'}, j = {frame.j >= 0 ? frame.j : '--'}, k = {frame.k >= 0 ? frame.k : '--'}</div>
                    <div className="local-var">m = {frame.m >= 0 ? frame.m : '--'}</div>
                  </>
                )}
              </div>
              {frame.state === 'returning' && frame.returnTo ? (
                <div className="frame-return">
                  Returning to: <strong>{frame.returnTo}</strong>
                </div>
              ) : (
                <div className="frame-return" style={{ display: 'none' }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function performNextStep(state: MergeSortState) {
  const { array } = state;
  let { scratch, callStack, complete, substep, currentStep, copiedBackIndices, scratchWritten } = state;
  scratch = [...scratch];
  callStack = [...callStack];
  copiedBackIndices = [...copiedBackIndices];
  scratchWritten = [...scratchWritten];
  const highlightedLines = new Set<string>();
  const readArrayValue = (index: number): number | null => {
    const value = array[index]
    return typeof value === 'number' ? value : null
  }

  if (complete) return state;

  // Handle popping returning frames
  const lastFrame = callStack.length > 0 ? callStack[callStack.length - 1] : null
  if (lastFrame?.shouldPop) {
    callStack.pop();
    if (callStack.length > 0) {
      const parent = callStack[callStack.length - 1]!;
      parent.state = 'active';
      if (parent.function === 'MergeSortHelper') {
        if (parent.substep === 2) {
          parent.substep = 3;
        } else if (parent.substep === 3) {
          parent.substep = 4;
        } else if (parent.substep === 4) {
          parent.substep = 99;
        }
      } else if (parent.function === 'Merge') {
        parent.substep = 99;
      }
    } else {
      complete = true;
    }
  }

  // Initial step: Start MergeSort
  if (callStack.length === 0 && substep === 0) {
    highlightedLines.add('line-0');
    currentStep = `Start: MergeSort(A[0..${array.length - 1}])`;
    substep = 1;
  } else if (callStack.length === 0 && substep === 1) {
    highlightedLines.add('line-1');
    currentStep = `Create scratch array S[0..${array.length - 1}]`;
    substep = 2;
  } else if (callStack.length === 0 && substep === 2) {
    highlightedLines.add('line-2');
    currentStep = `Call MergeSortHelper(A, S, 0, ${array.length - 1})`;
    callStack.push({
      function: 'MergeSortHelper',
      left: 0,
      right: array.length - 1,
      mid: -1,
      i: -1,
      j: -1,
      k: -1,
      m: -1,
      state: 'active',
      substep: 0,
      callSite: 'line-2',
      returnTo: '',
      shouldPop: false,
    });
    substep = 0;
  } else if (callStack.length > 0) {
    const topFrame = callStack[callStack.length - 1]!;

    if (topFrame.function === 'MergeSortHelper') {
      if (topFrame.substep === 0) {
        // Check base case
        highlightedLines.add('line-5');
        if (topFrame.left >= topFrame.right) {
          currentStep = `Base case: left (${topFrame.left}) ≥ right (${topFrame.right}), return`;
          topFrame.substep = 99; // Mark for return
        } else {
          currentStep = `Check: left (${topFrame.left}) < right (${topFrame.right}), continue`;
          topFrame.substep = 1;
        }
      } else if (topFrame.substep === 1) {
        // Calculate mid
        highlightedLines.add('line-7');
        topFrame.mid = Math.floor((topFrame.left + topFrame.right) / 2);
        currentStep = `Calculate mid = floor((${topFrame.left} + ${topFrame.right}) / 2) = ${topFrame.mid}`;
        topFrame.substep = 2;
      } else if (topFrame.substep === 2) {
        // Call MergeSortHelper for left half
        if (topFrame.mid < 0) {
          topFrame.mid = Math.floor((topFrame.left + topFrame.right) / 2);
        }
        highlightedLines.add('line-8');
        currentStep = `Call MergeSortHelper(A, S, ${topFrame.left}, ${topFrame.mid})`;
        topFrame.state = 'waiting';
        callStack.push({
          function: 'MergeSortHelper',
          left: topFrame.left,
          right: topFrame.mid,
          mid: -1,
          i: -1,
          j: -1,
          k: -1,
          m: -1,
          state: 'active',
          substep: 0,
          callSite: 'line-8',
          returnTo: '',
          shouldPop: false,
        });
        substep = 0;
      } else if (topFrame.substep === 3) {
        // Call MergeSortHelper for right half
        if (topFrame.mid < 0) {
          topFrame.mid = Math.floor((topFrame.left + topFrame.right) / 2);
        }
        highlightedLines.add('line-9');
        currentStep = `Call MergeSortHelper(A, S, ${topFrame.mid + 1}, ${topFrame.right})`;
        topFrame.state = 'waiting';
        callStack.push({
          function: 'MergeSortHelper',
          left: topFrame.mid + 1,
          right: topFrame.right,
          mid: -1,
          i: -1,
          j: -1,
          k: -1,
          m: -1,
          state: 'active',
          substep: 0,
          callSite: 'line-9',
          returnTo: '',
          shouldPop: false,
        });
        substep = 0;
      } else if (topFrame.substep === 4) {
        // Call Merge
        if (topFrame.mid < 0) {
          topFrame.mid = Math.floor((topFrame.left + topFrame.right) / 2);
        }
        highlightedLines.add('line-10');
        currentStep = `Call Merge(A, S, ${topFrame.left}, ${topFrame.mid}, ${topFrame.right})`;
        topFrame.state = 'waiting';
        callStack.push({
          function: 'Merge',
          left: topFrame.left,
          mid: topFrame.mid,
          right: topFrame.right,
          i: -1,
          j: -1,
          k: -1,
          m: -1,
          state: 'active',
          substep: 0,
          callSite: 'line-10',
          returnTo: '',
          shouldPop: false,
        });
        substep = 0;
      } else if (topFrame.substep === 99) {
        // Return from MergeSortHelper - mark for return
        topFrame.state = 'returning';
        if (topFrame.callSite) {
          highlightedLines.add(topFrame.callSite);
        }
        if (callStack.length > 1) {
          const parent = callStack[callStack.length - 2];
          if (parent) {
            topFrame.returnTo = `${parent.function}(${parent.left}, ${parent.right})`;
          }
        } else if (callStack.length === 1) {
          topFrame.returnTo = 'MergeSort';
        }
        currentStep = `Returning from ${topFrame.function}`;
        topFrame.shouldPop = true;
        return {
          ...state,
          array,
          scratch,
          callStack,
          complete,
          substep,
          highlightedLines,
          currentStep,
          animFrom: null,
          animTo: null,
          animValue: null,
          copiedBackIndices,
        };
      }
    } else if (topFrame.function === 'Merge') {
      if (topFrame.substep === 0) {
        // Initialize i - clear copied back indices
        copiedBackIndices = [];
        highlightedLines.add('line-13');
        topFrame.i = topFrame.left;
        currentStep = `Initialize i = ${topFrame.i}`;
        topFrame.substep = 1;
      } else if (topFrame.substep === 1) {
        // Initialize j
        highlightedLines.add('line-14');
        topFrame.j = Math.max(topFrame.mid, topFrame.left) + 1;
        currentStep = `Initialize j = ${topFrame.j}`;
        topFrame.substep = 2;
      } else if (topFrame.substep === 2) {
        // Initialize k
        highlightedLines.add('line-15');
        topFrame.k = topFrame.left;
        currentStep = `Initialize k = ${topFrame.k}`;
        topFrame.substep = 3;
      } else if (topFrame.substep === 3) {
        // Check first while condition
        highlightedLines.add('line-16');
        if (topFrame.i <= topFrame.mid && topFrame.j <= topFrame.right) {
          currentStep = `Check: i (${topFrame.i}) ≤ mid (${topFrame.mid}) and j (${topFrame.j}) ≤ right (${topFrame.right})? Yes`;
          topFrame.substep = 4;
        } else {
          currentStep = `Check: i (${topFrame.i}) ≤ mid (${topFrame.mid}) and j (${topFrame.j}) ≤ right (${topFrame.right})? No`;
          topFrame.substep = 10; // Move to second while
        }
      } else if (topFrame.substep === 4) {
        // Compare A[i] and A[j]
        highlightedLines.add('line-17');
        const leftValue = readArrayValue(topFrame.i)
        const rightValue = readArrayValue(topFrame.j)
        if (leftValue === null || rightValue === null) {
          currentStep = 'Merge indices out of bounds, returning';
          topFrame.substep = 99;
        } else if (leftValue <= rightValue) {
          currentStep = `Compare: A[${topFrame.i}] (${leftValue}) ≤ A[${topFrame.j}] (${rightValue})? Yes`;
          topFrame.substep = 5;
        } else {
          currentStep = `Compare: A[${topFrame.i}] (${leftValue}) ≤ A[${topFrame.j}] (${rightValue})? No`;
          topFrame.substep = 7;
        }
      } else if (topFrame.substep === 5) {
        // S[k] = A[i]
        highlightedLines.add('line-18');
        const value = readArrayValue(topFrame.i);
        if (value === null) {
          currentStep = `Copy skipped: A[${topFrame.i}] is unavailable`;
          topFrame.substep = 10;
          return {
            ...state,
            array,
            scratch,
            callStack,
            complete,
            substep,
            highlightedLines,
            currentStep,
            animFrom: null,
            animTo: null,
            animValue: null,
            copiedBackIndices,
            scratchWritten,
          };
        }
        scratch[topFrame.k] = value;
        if (!scratchWritten.includes(topFrame.k)) {
          scratchWritten.push(topFrame.k);
        }
        currentStep = `Copy to scratch: S[${topFrame.k}] = A[${topFrame.i}] = ${value}`;
        topFrame.substep = 6;
        return {
          ...state,
          array,
          scratch,
          callStack,
          complete,
          substep,
          highlightedLines,
          currentStep,
          animFrom: `array-${topFrame.i}`,
          animTo: `scratch-${topFrame.k}`,
          animValue: value,
          scratchWritten,
        };
      } else if (topFrame.substep === 6) {
        // i++
        highlightedLines.add('line-19');
        topFrame.i++;
        currentStep = `Increment i = ${topFrame.i}`;
        topFrame.substep = 9;
      } else if (topFrame.substep === 7) {
        // S[k] = A[j]
        highlightedLines.add('line-21');
        const value = readArrayValue(topFrame.j);
        if (value === null) {
          currentStep = `Copy skipped: A[${topFrame.j}] is unavailable`;
          topFrame.substep = 14;
          return {
            ...state,
            array,
            scratch,
            callStack,
            complete,
            substep,
            highlightedLines,
            currentStep,
            animFrom: null,
            animTo: null,
            animValue: null,
            copiedBackIndices,
            scratchWritten,
          };
        }
        scratch[topFrame.k] = value;
        if (!scratchWritten.includes(topFrame.k)) {
          scratchWritten.push(topFrame.k);
        }
        currentStep = `Copy to scratch: S[${topFrame.k}] = A[${topFrame.j}] = ${value}`;
        topFrame.substep = 8;
        return {
          ...state,
          array,
          scratch,
          callStack,
          complete,
          substep,
          highlightedLines,
          currentStep,
          animFrom: `array-${topFrame.j}`,
          animTo: `scratch-${topFrame.k}`,
          animValue: value,
          scratchWritten,
        };
      } else if (topFrame.substep === 8) {
        // j++
        highlightedLines.add('line-22');
        topFrame.j++;
        currentStep = `Increment j = ${topFrame.j}`;
        topFrame.substep = 9;
      } else if (topFrame.substep === 9) {
        // k++
        highlightedLines.add('line-23');
        topFrame.k++;
        currentStep = `Increment k = ${topFrame.k}`;
        topFrame.substep = 3; // Loop back
      } else if (topFrame.substep === 10) {
        // Check second while condition
        highlightedLines.add('line-24');
        if (topFrame.i <= topFrame.mid) {
          currentStep = `Check: i (${topFrame.i}) ≤ mid (${topFrame.mid})? Yes`;
          topFrame.substep = 11;
        } else {
          currentStep = `Check: i (${topFrame.i}) ≤ mid (${topFrame.mid})? No`;
          topFrame.substep = 14; // Move to third while
        }
      } else if (topFrame.substep === 11) {
        // S[k] = A[i]
        highlightedLines.add('line-25');
        const value = readArrayValue(topFrame.i);
        if (value === null) {
          currentStep = `Copy skipped: A[${topFrame.i}] is unavailable`;
          topFrame.substep = 14;
          return {
            ...state,
            array,
            scratch,
            callStack,
            complete,
            substep,
            highlightedLines,
            currentStep,
            animFrom: null,
            animTo: null,
            animValue: null,
            copiedBackIndices,
            scratchWritten,
          };
        }
        scratch[topFrame.k] = value;
        if (!scratchWritten.includes(topFrame.k)) {
          scratchWritten.push(topFrame.k);
        }
        currentStep = `Copy remaining left: S[${topFrame.k}] = A[${topFrame.i}] = ${value}`;
        topFrame.substep = 12;
        return {
          ...state,
          array,
          scratch,
          callStack,
          complete,
          substep,
          highlightedLines,
          currentStep,
          animFrom: `array-${topFrame.i}`,
          animTo: `scratch-${topFrame.k}`,
          animValue: value,
          scratchWritten,
        };
      } else if (topFrame.substep === 12) {
        // i++
        highlightedLines.add('line-26');
        topFrame.i++;
        currentStep = `Increment i = ${topFrame.i}`;
        topFrame.substep = 13;
      } else if (topFrame.substep === 13) {
        // k++
        highlightedLines.add('line-27');
        topFrame.k++;
        currentStep = `Increment k = ${topFrame.k}`;
        topFrame.substep = 10; // Loop back
      } else if (topFrame.substep === 14) {
        // Check third while condition
        highlightedLines.add('line-28');
        if (topFrame.j <= topFrame.right) {
          currentStep = `Check: j (${topFrame.j}) ≤ right (${topFrame.right})? Yes`;
          topFrame.substep = 15;
        } else {
          currentStep = `Check: j (${topFrame.j}) ≤ right (${topFrame.right})? No`;
          topFrame.substep = 18; // Move to copy back
        }
      } else if (topFrame.substep === 15) {
        // S[k] = A[j]
        highlightedLines.add('line-29');
        const value = readArrayValue(topFrame.j);
        if (value === null) {
          currentStep = `Copy skipped: A[${topFrame.j}] is unavailable`;
          topFrame.substep = 18;
          return {
            ...state,
            array,
            scratch,
            callStack,
            complete,
            substep,
            highlightedLines,
            currentStep,
            animFrom: null,
            animTo: null,
            animValue: null,
            copiedBackIndices,
            scratchWritten,
          };
        }
        scratch[topFrame.k] = value;
        if (!scratchWritten.includes(topFrame.k)) {
          scratchWritten.push(topFrame.k);
        }
        currentStep = `Copy remaining right: S[${topFrame.k}] = A[${topFrame.j}] = ${value}`;
        topFrame.substep = 16;
        return {
          ...state,
          array,
          scratch,
          callStack,
          complete,
          substep,
          highlightedLines,
          currentStep,
          animFrom: `array-${topFrame.j}`,
          animTo: `scratch-${topFrame.k}`,
          animValue: value,
          scratchWritten,
        };
      } else if (topFrame.substep === 16) {
        // j++
        highlightedLines.add('line-30');
        topFrame.j++;
        currentStep = `Increment j = ${topFrame.j}`;
        topFrame.substep = 17;
      } else if (topFrame.substep === 17) {
        // k++
        highlightedLines.add('line-31');
        topFrame.k++;
        currentStep = `Increment k = ${topFrame.k}`;
        topFrame.substep = 14; // Loop back
      } else if (topFrame.substep === 18) {
        // Initialize m for copy back
        highlightedLines.add('line-32');
        topFrame.m = topFrame.left;
        currentStep = `Start copying back: m = ${topFrame.m}`;
        topFrame.substep = 19;
      } else if (topFrame.substep === 19) {
        // Check for loop condition
        highlightedLines.add('line-32');
        if (topFrame.m <= topFrame.right) {
          topFrame.substep = 20;
        } else {
          topFrame.substep = 99; // Done with merge
        }
      } else if (topFrame.substep === 20) {
        // A[m] = S[m]
        highlightedLines.add('line-33');
        const value = scratch[topFrame.m];
        if (value == null) {
          currentStep = `Copy back skipped: S[${topFrame.m}] is empty`;
          topFrame.substep = 99;
          return {
            ...state,
            array,
            scratch,
            callStack,
            complete,
            substep,
            highlightedLines,
            currentStep,
            animFrom: null,
            animTo: null,
            animValue: null,
            copiedBackIndices,
            scratchWritten,
          };
        }
        const copyIdx = topFrame.m;
        array[topFrame.m] = value;
        copiedBackIndices.push(copyIdx);
        scratchWritten = scratchWritten.filter((idx: number) => idx !== copyIdx);
        currentStep = `Copy back: A[${topFrame.m}] = S[${topFrame.m}] = ${value}`;
        topFrame.m++;
        topFrame.substep = 19; // Loop back
        return {
          ...state,
          array,
          scratch,
          callStack,
          complete,
          substep,
          highlightedLines,
          currentStep,
          animFrom: `scratch-${copyIdx}`,
          animTo: `array-${copyIdx}`,
          animValue: value,
          copiedBackIndices,
          scratchWritten,
        };
      } else if (topFrame.substep === 99) {
        // Return from Merge - mark for return
        topFrame.state = 'returning';
        if (topFrame.callSite) {
          highlightedLines.add(topFrame.callSite);
        }
        if (callStack.length > 1) {
          const parent = callStack[callStack.length - 2];
          if (parent) {
            topFrame.returnTo = `${parent.function}(${parent.left}, ${parent.right})`;
          }
        } else if (callStack.length === 1) {
          topFrame.returnTo = 'MergeSortHelper';
        }
        currentStep = `Returning from ${topFrame.function}`;
        topFrame.shouldPop = true;
        return {
          ...state,
          array,
          scratch,
          callStack,
          complete,
          substep,
          highlightedLines,
          currentStep,
          animFrom: null,
          animTo: null,
          animValue: null,
          copiedBackIndices,
        };
      }
    }
  }

  return {
    ...state,
    array,
    scratch,
    callStack,
    complete,
    substep,
    highlightedLines,
    currentStep,
    animFrom: null,
    animTo: null,
    animValue: null,
    copiedBackIndices,
    scratchWritten,
  };
}

export default MergeSort
