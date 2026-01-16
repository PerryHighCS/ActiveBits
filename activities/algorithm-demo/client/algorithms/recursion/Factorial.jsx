import React from 'react';
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
      highlightedLines: new Set(),
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

    return (
      <div className="algorithm-manager">
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
        <CallStackVisualization state={state} />
        <PseudocodeRenderer lines={PSEUDOCODE} highlightedIds={state.highlightedLines} />
        {state.currentStep && <div className="step-info">{state.currentStep}</div>}
      </div>
    );
  },

  StudentView({ session }) {
    const state = session.data.algorithmState || Factorial.initState();
    return (
      <div className="algorithm-student">
        <CallStackVisualization state={state} />
        <PseudocodeRenderer lines={PSEUDOCODE} highlightedIds={state.highlightedLines} />
        {state.currentStep && <div className="step-info">{state.currentStep}</div>}
      </div>
    );
  },
};

function CallStackVisualization({ state }) {
  return (
    <div className="recursion-viz">
      <div className="call-stack">
        <h3>Call Stack:</h3>
        <div className="stack-frames">
          {state.callStack.length === 0 ? (
            <div className="empty-stack">Empty</div>
          ) : (
            state.callStack.map((frame, idx) => (
              <div key={idx} className={`stack-frame ${frame.state}`}>
                <div className="frame-label">Factorial({frame.n})</div>
                {frame.result !== null && <div className="frame-result">= {frame.result}</div>}
              </div>
            ))
          )}
        </div>
      </div>
      {state.complete && (
        <div className="result-display">
          Result: <strong>Factorial({state.n}) = {state.result}</strong>
        </div>
      )}
    </div>
  );
}

function performNextStep(state) {
  let { n, callStack, complete, result } = state;
  let highlightedLines = new Set();
  let currentStep = null;

  if (complete) return state;

  if (callStack.length === 0) {
    // Start: push first call
    callStack = [{ n, state: 'active', result: null }];
    highlightedLines.add('line-0');
    currentStep = `Start: Factorial(${n})`;
  } else {
    const topFrame = callStack[callStack.length - 1];

    if (topFrame.state === 'active') {
      if (topFrame.n <= 1) {
        // Base case
        topFrame.result = 1;
        topFrame.state = 'returning';
        highlightedLines.add('line-1');
        highlightedLines.add('line-2');
        currentStep = `Base case: Factorial(${topFrame.n}) = 1`;
      } else {
        // Recursive case: push new call
        topFrame.state = 'waiting';
        callStack = [
          ...callStack,
          { n: topFrame.n - 1, state: 'active', result: null },
        ];
        highlightedLines.add('line-3');
        highlightedLines.add('line-4');
        currentStep = `Recursive call: Factorial(${topFrame.n - 1})`;
      }
    } else if (topFrame.state === 'returning') {
      // Pop and compute result
      const poppedFrame = callStack.pop();
      if (callStack.length > 0) {
        const parent = callStack[callStack.length - 1];
        parent.result = parent.n * poppedFrame.result;
        parent.state = 'returning';
        currentStep = `Return: ${parent.n} * ${poppedFrame.result} = ${parent.result}`;
      } else {
        result = poppedFrame.result;
        complete = true;
        currentStep = `Algorithm complete! Factorial(${n}) = ${result}`;
      }
    }
  }

  return {
    ...state,
    callStack,
    complete,
    result,
    highlightedLines,
    currentStep,
  };
}

export default Factorial;
