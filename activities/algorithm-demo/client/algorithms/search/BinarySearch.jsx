import React from 'react';
import PseudocodeRenderer from '../../components/PseudocodeRenderer';

const PSEUDOCODE = [
  'BinarySearch(A[0..n−1], target)',
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
];

const BinarySearch = {
  id: 'binary-search',
  name: 'Binary Search',
  description: 'Efficiently search in a sorted array',
  category: 'search',
  pseudocode: PSEUDOCODE,

  initState(arraySize = 16, target = null) {
    const array = Array.from({ length: arraySize }, (_, i) => (i + 1) * 5);
    const t = target !== null ? target : array[Math.floor(Math.random() * arraySize)];
    return {
      array,
      target: t,
      left: 0,
      right: arraySize - 1,
      mid: null,
      substep: 0,
      found: false,
      foundIndex: -1,
      currentStep: null,
      highlightedLines: new Set(),
      history: [],
    };
  },

  reduceEvent(state, event) {
    if (event.type === 'nextStep') {
      return performNextStep(state);
    }
    if (event.type === 'reset') {
      return BinarySearch.initState(state.array.length);
    }
    if (event.type === 'setTarget') {
      return BinarySearch.initState(state.array.length, event.payload);
    }
    return state;
  },

  ManagerView({ session, onStateChange }) {
    const state = session.data.algorithmState || BinarySearch.initState();

    const handleNextStep = () => {
      onStateChange(performNextStep(state));
    };

    const handleReset = () => {
      onStateChange(BinarySearch.initState());
    };

    return (
      <div className="algorithm-manager">
        <div className="controls">
          <button onClick={handleNextStep} disabled={state.found}>
            Next Step
          </button>
          <button onClick={handleReset}>Reset</button>
        </div>
        <div className="target-display">
          Searching for: <strong>{state.target}</strong>
        </div>
        <ArrayVisualization state={state} />
        <PseudocodeRenderer
          lines={PSEUDOCODE}
          highlightedLines={state.highlightedLines}
        />
        {state.currentStep && <div className="step-info">{state.currentStep}</div>}
      </div>
    );
  },

  StudentView({ session }) {
    const state = session.data.algorithmState || BinarySearch.initState();
    return (
      <div className="algorithm-student">
        <div className="target-display">
          Searching for: <strong>{state.target}</strong>
        </div>
        <ArrayVisualization state={state} />
        <PseudocodeRenderer
          lines={PSEUDOCODE}
          highlightedLines={state.highlightedLines}
        />
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
            className={`array-item ${
              idx < state.left || idx > state.right ? 'eliminated' : ''
            } ${idx === state.mid ? 'current-mid' : ''} ${
              idx === state.foundIndex ? 'found' : ''
            }`}
          >
            {val}
          </div>
        ))}
      </div>
      <div className="status">
        left={state.left}, right={state.right}, mid={state.mid}
        {state.found && (
          <span className="completed">
            {' '}
            ✓ Found at index {state.foundIndex}!
          </span>
        )}
      </div>
    </div>
  );
}

function performNextStep(state) {
  let { array, target, left, right, mid, found, foundIndex, history, substep } = state;
  let highlightedLines = new Set();
  let currentStep = null;

  if (found) return state;

  // Step-by-step highlighting
  if (substep === 0) {
    // Initialize left
    highlightedLines.add('line-1');
    currentStep = `Initialize: left ← 0`;
    substep = 1;
  } else if (substep === 1) {
    // Initialize right
    highlightedLines.add('line-2');
    currentStep = `Initialize: right ← n − 1 (${array.length - 1})`;
    substep = 2;
  } else if (substep === 2) {
    // Check while condition
    const cond = left <= right;
    highlightedLines.add('line-3');
    currentStep = `Check while: left=${left} ≤ right=${right}? ${cond ? 'Yes' : 'No'}`;
    substep = cond ? 3 : 99;
  } else if (substep === 3) {
    // Compute mid
    mid = Math.floor((left + right) / 2);
    highlightedLines.add('line-4');
    currentStep = `mid ← floor((${left} + ${right}) / 2) = ${mid} (A[mid]=${array[mid]})`;
    substep = 4;
  } else if (substep === 4) {
    // Check equals
    const eq = array[mid] === target;
    highlightedLines.add('line-5');
    currentStep = `Check: A[${mid}] == ${target}? ${eq ? 'Yes' : 'No'}`;
    substep = eq ? 6 : 5;
  } else if (substep === 6) {
    // Return mid (found)
    highlightedLines.add('line-6');
    found = true;
    foundIndex = mid;
    currentStep = `return ${mid}`;
    substep = 100;
  } else if (substep === 5) {
    // Else if A[mid] < target?
    const lt = array[mid] < target;
    highlightedLines.add('line-7');
    currentStep = `Check: A[${mid}]=${array[mid]} < ${target}? ${lt ? 'Yes' : 'No'}`;
    substep = lt ? 8 : 9;
  } else if (substep === 8) {
    // left ← mid + 1
    highlightedLines.add('line-8');
    left = mid + 1;
    mid = null;
    currentStep = `left ← ${left}`;
    substep = 2; // loop back to while
  } else if (substep === 9) {
    // else
    highlightedLines.add('line-9');
    currentStep = `else`;
    substep = 10;
  } else if (substep === 10) {
    // right ← mid − 1
    highlightedLines.add('line-10');
    right = mid - 1;
    mid = null;
    currentStep = `right ← ${right}`;
    substep = 2; // loop back
  } else if (substep === 99) {
    // return −1 (not found)
    highlightedLines.add('line-11');
    found = true;
    foundIndex = -1;
    currentStep = `return −1 (not found)`;
    substep = 100;
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
  };
}

export default BinarySearch;
