import React from 'react';
import PseudocodeRenderer from '../../components/PseudocodeRenderer';

const PSEUDOCODE = [
  'Fibonacci(n)',
  '    if n ≤ 1 then',
  '        return n',
  '    else',
  '        return Fibonacci(n − 1) + Fibonacci(n − 2)',
];

const Fibonacci = {
  id: 'fibonacci',
  name: 'Fibonacci (Recursion)',
  description: 'Demonstrate recursion with Fibonacci computation',
  category: 'recursion',
  pseudocode: PSEUDOCODE,

  initState(n = 6) {
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
      return Fibonacci.initState(state.n);
    }
    if (event.type === 'setN') {
      return Fibonacci.initState(Math.max(1, Math.min(event.payload, 10)));
    }
    return state;
  },

  ManagerView({ session, onStateChange }) {
    const state = session.data.algorithmState || Fibonacci.initState();

    return (
      <div className="algorithm-manager">
        <div className="controls">
          <button onClick={() => onStateChange(performNextStep(state))} disabled={state.complete}>
            Next Step
          </button>
          <button onClick={() => onStateChange(Fibonacci.initState())}>Reset</button>
          <label>
            Input n:
            <input
              type="number"
              min="1"
              max="10"
              value={state.n}
              onChange={(e) => onStateChange(Fibonacci.initState(parseInt(e.target.value)))}
            />
          </label>
        </div>
        <CallStackVisualization state={state} />
        <PseudocodeRenderer lines={PSEUDOCODE} highlightedIds={state.highlightedLines} overlays={state.overlays} />
        {state.currentStep && <div className="step-info">{state.currentStep}</div>}
      </div>
    );
  },

  StudentView({ session }) {
    const state = session.data.algorithmState || Fibonacci.initState();
    return (
      <div className="algorithm-student">
        <CallStackVisualization state={state} />
        <PseudocodeRenderer lines={PSEUDOCODE} highlightedIds={state.highlightedLines} overlays={state.overlays} />
        {state.currentStep && <div className="step-info">{state.currentStep}</div>}
      </div>
    );
  },
};

function CallStackVisualization({ state }) {
  const callStack = Array.isArray(state.callStack) ? state.callStack : [];
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
                  {frame.leftValue !== null && frame.leftValue !== undefined ? (
                    <div className="local-var">
                      <em>tempLeft = {frame.leftValue}</em>
                    </div>
                  ) : null}
                  {frame.rightValue !== null && frame.rightValue !== undefined ? (
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
        </div>
      </div>
      {state.complete && (
        <div className="result-display">
          Result: <strong>Fibonacci({state.n}) = {state.result}</strong>
        </div>
      )}
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
    callStack = [
      {
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
      },
    ];
    highlightedLines.add('line-0');
    currentStep = `Start: Fibonacci(${n})`;
    substep = 1;
  } else {
    const topFrame = callStack[callStack.length - 1];

    if (topFrame.state === 'active') {
      if (topFrame.substep === 0) {
        highlightedLines.add('line-1');
        if (topFrame.n <= 1) {
          currentStep = `Check: ${topFrame.n} ≤ 1? Yes`;
          topFrame.substep = 1;
        } else {
          currentStep = `Check: ${topFrame.n} ≤ 1? No`;
          topFrame.substep = 2;
        }
      } else if (topFrame.substep === 1) {
        highlightedLines.add('line-2');
        topFrame.result = topFrame.n;
        topFrame.state = 'returning';
        topFrame.returnStage = 2;
        topFrame.returnLine = 'line-2';
        currentStep = `return ${topFrame.n}`;
        topFrame.substep = 3;
      } else if (topFrame.substep === 2) {
        highlightedLines.add('line-3');
        currentStep = 'else';
        topFrame.substep = 3;
      } else if (topFrame.substep === 3) {
        highlightedLines.add('line-4');
        currentStep = `return Fibonacci(${topFrame.n - 1}) + Fibonacci(${topFrame.n - 2})`;
        topFrame.returnLine = 'line-4';
        topFrame.substep = 4;
      } else if (topFrame.substep === 4) {
        highlightedLines.add('line-0');
        topFrame.state = 'waiting';
        topFrame.waitingFor = 'left';
        callStack = [
          ...callStack,
          {
            n: topFrame.n - 1,
            state: 'active',
            result: null,
            substep: 0,
            returnStage: null,
            returnLine: null,
            waitingFor: null,
            leftValue: null,
            rightValue: null,
            overlayValue: null,
          },
        ];
        currentStep = `Enter: Fibonacci(${topFrame.n - 1})`;
        substep = 0;
      } else if (topFrame.substep === 5) {
        highlightedLines.add('line-0');
        topFrame.state = 'waiting';
        topFrame.waitingFor = 'right';
        callStack = [
          ...callStack,
          {
            n: topFrame.n - 2,
            state: 'active',
            result: null,
            substep: 0,
            returnStage: null,
            returnLine: null,
            waitingFor: null,
            leftValue: null,
            rightValue: null,
            overlayValue: null,
          },
        ];
        currentStep = `Enter: Fibonacci(${topFrame.n - 2})`;
        substep = 0;
      }
    } else if (topFrame.state === 'returning') {
      if (topFrame.returnStage === 1) {
        if (topFrame.leftValue !== null && topFrame.rightValue !== null) {
          const computedResult = topFrame.leftValue + topFrame.rightValue;
          topFrame.result = computedResult;
          currentStep = `Compute return: ${topFrame.leftValue} + ${topFrame.rightValue} = ${computedResult}`;
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
          if (parent.waitingFor === 'left') {
            parent.leftValue = returnValue;
            parent.overlayValue = returnValue;
            parent.waitingFor = null;
            parent.state = 'active';
            parent.substep = 5;
            parent.returnLine = parent.returnLine || 'line-4';
            highlightedLines.add(parent.returnLine);
            currentStep = `Return ${returnValue} to Fibonacci(${parent.n})`;
          } else if (parent.waitingFor === 'right') {
            parent.rightValue = returnValue;
            parent.overlayValue = returnValue;
            parent.waitingFor = null;
            parent.state = 'returning';
            parent.returnStage = 1;
            parent.returnLine = parent.returnLine || 'line-4';
            highlightedLines.add(parent.returnLine);
            currentStep = `Return ${returnValue} to Fibonacci(${parent.n})`;
          } else {
            parent.overlayValue = returnValue;
            parent.state = 'returning';
            parent.returnStage = 1;
            parent.returnLine = parent.returnLine || 'line-4';
            highlightedLines.add(parent.returnLine);
            currentStep = `Return ${returnValue} to Fibonacci(${parent.n})`;
          }
        } else {
          result = returnValue;
          complete = true;
          highlightedLines.add(lineId);
          currentStep = `Algorithm complete! Fibonacci(${n}) = ${result}`;
        }
      }
    }
  }

  overlays = {};
  callStack.forEach((frame) => {
    if (frame.state === 'waiting') {
      return;
    }
    const lineId = frame.returnLine || 'line-4';
    if (frame.leftValue !== null && frame.rightValue !== null) {
      overlays[lineId] = { value: `${frame.leftValue} + ${frame.rightValue}` };
    } else if (frame.leftValue !== null && frame.leftValue !== undefined) {
      overlays[lineId] = { value: `${frame.leftValue} + ?` };
    } else if (frame.rightValue !== null && frame.rightValue !== undefined) {
      overlays[lineId] = { value: `? + ${frame.rightValue}` };
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

export default Fibonacci;
