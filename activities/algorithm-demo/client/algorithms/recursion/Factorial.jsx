import React, { useEffect, useRef } from 'react';
import PseudocodeRenderer from '../../components/PseudocodeRenderer';

const PSEUDOCODE = [
  'Factorial(n)',
  '    if n ≤ 1 then',
  '        return 1',
  '    else',
  '        return n * Factorial(n − 1)',
];

const Factorial = {
  id: 'factorial',
  name: 'Factorial (Recursion)',
  description: 'Demonstrate recursion with factorial computation',
  category: 'recursion',
  pseudocode: PSEUDOCODE,

  initState(n = 5) {
    return {
      n,
      callStack: [],
      complete: false,
      result: null,
      substep: 0,
      highlightedLines: new Set(),
      overlays: {},
      currentStep: null,
    };
  },

  reduceEvent(state, event) {
    if (event.type === 'nextStep') {
      return performNextStep(state);
    }
    if (event.type === 'reset') {
      return Factorial.initState(state.n);
    }
    if (event.type === 'setN') {
      return Factorial.initState(Math.max(1, Math.min(event.payload, 10)));
    }
    return state;
  },

  ManagerView({ session, onStateChange }) {
    const state = session.data.algorithmState || Factorial.initState();
    const pseudoColumnStyle = {
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
    };

    return (
      <div className="algorithm-manager">
        <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={pseudoColumnStyle}>
            <div className="controls">
              <button onClick={() => onStateChange(performNextStep(state))} disabled={state.complete}>
                Next Step
              </button>
              <button onClick={() => onStateChange(Factorial.initState())}>Reset</button>
              <label>
                Input n:
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={state.n}
                  onChange={(e) => onStateChange(Factorial.initState(parseInt(e.target.value)))}
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
    );
  },

  StudentView({ session, onStateChange }) {
    const state = session.data.algorithmState || Factorial.initState();
    const pseudoColumnStyle = {
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
    };

    const controls = onStateChange ? (
      <div className="controls">
        <button onClick={() => onStateChange(performNextStep(state))} disabled={state.complete}>
          Next Step
        </button>
        <button onClick={() => onStateChange(Factorial.initState(state.n))}>Reset</button>
        <label>
          Input n:
          <input
            type="number"
            min="1"
            max="10"
            value={state.n}
            onChange={(e) => onStateChange(Factorial.initState(parseInt(e.target.value)))}
          />
        </label>
      </div>
    ) : null;

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
    );
  },
};

function CallStackVisualization({ state }) {
  // Defensive: ensure callStack is an array
  const callStack = Array.isArray(state.callStack) ? state.callStack : [];
  const stackEndRef = useRef(null);

  useEffect(() => {
    if (stackEndRef.current) {
      stackEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [callStack.length]);

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
  );
}

function performNextStep(state) {
  let { n, callStack, complete, result, substep } = state;
  let highlightedLines = new Set();
  let overlays = state.overlays || {};
  let currentStep = null;

  if (complete) return state;

  if (callStack.length === 0) {
    // Start: push first call with substep 0
    callStack = [{ n, state: 'active', result: null, pendingReturn: null, substep: 0, returnStage: null, returnLine: null }];
    highlightedLines.add('line-0');
    currentStep = `Start: Factorial(${n})`;
    substep = 1;
  } else {
    const topFrame = callStack[callStack.length - 1];

    if (topFrame.state === 'active') {
      // Substep 0: Check base case condition (line 1)
      if (topFrame.substep === 0) {
        highlightedLines.add('line-1');
        if (topFrame.n <= 1) {
          currentStep = `Check: ${topFrame.n} ≤ 1? Yes`;
          topFrame.substep = 1;
        } else {
          currentStep = `Check: ${topFrame.n} ≤ 1? No`;
          topFrame.substep = 3;
        }
      }
      // Substep 1: Base case return (line 2)
      else if (topFrame.substep === 1) {
        highlightedLines.add('line-2');
        topFrame.result = 1;
        topFrame.state = 'returning';
        topFrame.returnStage = 2;
        topFrame.returnLine = 'line-2';
        currentStep = `return 1`;
        topFrame.substep = 2;
      }
      // Substep 3: Else (line 3)
      else if (topFrame.substep === 3) {
        highlightedLines.add('line-3');
        currentStep = `else`;
        topFrame.substep = 4;
      }
      // Substep 4: Recursive call (line 4)
      else if (topFrame.substep === 4) {
        highlightedLines.add('line-4');
        currentStep = `return ${topFrame.n} * Factorial(${topFrame.n - 1})`;
        topFrame.returnLine = 'line-4';
        topFrame.substep = 4.5;
      }
      // Substep 4.5: Enter recursive call (line 0)
      else if (topFrame.substep === 4.5) {
        highlightedLines.add('line-0');
        topFrame.state = 'waiting';
        callStack = [
          ...callStack,
          { n: topFrame.n - 1, state: 'active', result: null, pendingReturn: null, substep: 0, returnStage: null, returnLine: null },
        ];
        currentStep = `Enter: Factorial(${topFrame.n - 1})`;
        substep = 0; // next call starts at substep 0
      }
    } else if (topFrame.state === 'returning') {
      if (topFrame.returnStage === 1) {
        const received = topFrame.pendingReturn;
        if (received !== null && received !== undefined) {
          const computedResult = topFrame.n * received;
          topFrame.result = computedResult;
          topFrame.pendingReturn = null;
          topFrame.overlayValue = null;
          currentStep = `Compute return: ${topFrame.n} * ${received} = ${computedResult}`;
        } else {
          currentStep = `Return ${topFrame.result}`;
        }
        highlightedLines.add(topFrame.returnLine || 'line-4');
        topFrame.returnStage = 2;
      } else {
        const poppedFrame = callStack.pop();
        const returnValue = poppedFrame.result;
        const lineId = poppedFrame.returnLine || 'line-4';

        if (callStack.length > 0) {
          const parent = callStack[callStack.length - 1];
          parent.pendingReturn = returnValue;
          parent.overlayValue = returnValue;
          parent.state = 'returning';
          parent.returnStage = 1;
          parent.returnLine = parent.returnLine || 'line-4';
          highlightedLines.add(parent.returnLine);
          currentStep = `Return ${returnValue} to Factorial(${parent.n})`;
        } else {
          result = returnValue;
          complete = true;
          highlightedLines.add(lineId);
          currentStep = `Algorithm complete! Factorial(${n}) = ${result}`;
        }
      }
    }
  }

  overlays = {};
  callStack.forEach((frame) => {
    const lineId = frame.returnLine || 'line-4';
    if (frame.state === 'returning' && frame.pendingReturn !== null && frame.pendingReturn !== undefined) {
      // Show the multiplication during unwinding: n * pendingReturn
      overlays[lineId] = { value: `${frame.n} * ${frame.pendingReturn}` };
    } else if (frame.overlayValue !== null && frame.overlayValue !== undefined) {
      overlays[lineId] = { value: frame.overlayValue };
    }
  });

  return {
    ...state,
    callStack,
    complete,
    result,
    substep,
    highlightedLines,
    overlays,
    currentStep,
  };
}

export default Factorial;
