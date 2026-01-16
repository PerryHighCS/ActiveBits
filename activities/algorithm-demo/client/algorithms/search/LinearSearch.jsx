import React from 'react';
import PseudocodeRenderer from '../../components/PseudocodeRenderer';

const PSEUDOCODE = [
  'LinearSearch(A[0..n−1], target)',
  '    for i ← 0 to n − 1',
  '        if A[i] == target then',
  '            return i',
  '    return −1',
];

const LinearSearch = {
  id: 'linear-search',
  name: 'Linear Search',
  description: 'Search by examining each element sequentially',
  category: 'search',
  pseudocode: PSEUDOCODE,

  initState(arraySize = 10, target = null) {
    const array = Array.from({ length: arraySize }, () => Math.floor(Math.random() * 100) + 1);
    const t = target !== null ? target : array[Math.floor(Math.random() * arraySize)];
    return {
      array,
      target: t,
      i: 0,
      found: false,
      foundIndex: -1,
      substep: 0,
      currentStep: null,
      highlightedLines: new Set(),
    };
  },

  reduceEvent(state, event) {
    if (event.type === 'nextStep') {
      return performNextStep(state);
    }
    if (event.type === 'reset') {
      return LinearSearch.initState(state.array.length);
    }
    return state;
  },

  ManagerView({ session, onStateChange }) {
    const state = session.data.algorithmState || LinearSearch.initState();

    return (
      <div className="algorithm-manager">
        <div className="controls">
          <button onClick={() => onStateChange(performNextStep(state))} disabled={state.found}>
            Next Step
          </button>
          <button onClick={() => onStateChange(LinearSearch.initState())}>Reset</button>
        </div>
        <div className="target-display">Searching for: <strong>{state.target}</strong></div>
        <ArrayVisualization state={state} />
        <PseudocodeRenderer lines={PSEUDOCODE} highlightedIds={state.highlightedLines} />
        {state.currentStep && <div className="step-info">{state.currentStep}</div>}
      </div>
    );
  },

  StudentView({ session }) {
    const state = session.data.algorithmState || LinearSearch.initState();
    return (
      <div className="algorithm-student">
        <div className="target-display">Searching for: <strong>{state.target}</strong></div>
        <ArrayVisualization state={state} />
        <PseudocodeRenderer lines={PSEUDOCODE} highlightedIds={state.highlightedLines} />
        {state.currentStep && <div className="step-info">{state.currentStep}</div>}
      </div>
    );
  },
};

function ArrayVisualization({ state }) {
  return (
    <div className="array-viz">
      <div className="array-container">
        {state.array.map((val, idx) => (
          <div
            key={idx}
            className={`array-item ${idx < state.i ? 'checked' : ''} ${
              idx === state.foundIndex ? 'found' : ''
            }`}
          >
            {val}
          </div>
        ))}
      </div>
      <div className="status">
        i={state.i}/{state.array.length}
        {state.found && <span className="completed"> ✓ Found at index {state.foundIndex}!</span>}
      </div>
    </div>
  );
}

function performNextStep(state) {
  let { array, target, i, found, foundIndex, substep } = state;
  let highlightedLines = new Set();
  let currentStep = null;

  if (found) return state;

  // Substep 0: Check for condition (line 1: for i ← 0 to n − 1)
  if (substep === 0) {
    const canContinue = i < array.length;
    highlightedLines.add('line-1');
    if (!canContinue) {
      substep = 99; // jump to return not found
      currentStep = `Loop complete: i=${i} >= array.length=${array.length}`;
    } else {
      substep = 1;
      currentStep = `Check loop: i=${i} < array.length=${array.length}? Yes`;
    }
  }
  // Substep 1: Check if condition (line 2: if A[i] == target then)
  else if (substep === 1) {
    const matches = array[i] === target;
    highlightedLines.add('line-2');
    if (matches) {
      substep = 2;
      currentStep = `Check: A[${i}] == ${target}? Yes`;
    } else {
      substep = 3;
      currentStep = `Check: A[${i}] == ${target}? No (A[${i}]=${array[i]})`;
    }
  }
  // Substep 2: Return if found (line 3: return i)
  else if (substep === 2) {
    found = true;
    foundIndex = i;
    highlightedLines.add('line-3');
    currentStep = `return ${i}`;
    substep = 100;
  }
  // Substep 3: Increment i (back to line 1 for next iteration)
  else if (substep === 3) {
    i++;
    highlightedLines.add('line-1');
    substep = 0;
    currentStep = `Increment: i ← ${i}`;
  }
  // Substep 99: Return not found (line 4: return −1)
  else if (substep === 99) {
    found = true;
    foundIndex = -1;
    highlightedLines.add('line-4');
    currentStep = `return −1`;
    substep = 100;
  }

  return {
    ...state,
    i,
    found,
    foundIndex,
    substep,
    highlightedLines,
    currentStep,
  };
}

export default LinearSearch;
