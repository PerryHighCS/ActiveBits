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
  let { array, target, left, right, mid, found, foundIndex, history } = state;
  let highlightedLines = new Set(['line-0']);
  let currentStep = null;

  if (found) return state;

  if (mid === null) {
    // Initialize
    highlightedLines.add('line-1');
    highlightedLines.add('line-2');
    currentStep = 'Initialize: left=0, right=' + (array.length - 1);
  } else if (left > right) {
    // Not found
    found = true;
    foundIndex = -1;
    highlightedLines.add('line-11');
    currentStep = `Target ${target} not found`;
  } else {
    mid = Math.floor((left + right) / 2);
    highlightedLines.add('line-3');
    highlightedLines.add('line-4');
    currentStep = `mid = floor((${left} + ${right}) / 2) = ${mid}, A[mid]=${array[mid]}`;

    if (array[mid] === target) {
      found = true;
      foundIndex = mid;
      highlightedLines.add('line-5');
      highlightedLines.add('line-6');
      currentStep = `Found! A[${mid}] == ${target}`;
    } else if (array[mid] < target) {
      left = mid + 1;
      mid = null;
      highlightedLines.add('line-7');
      highlightedLines.add('line-8');
      currentStep = `${array[mid]} < ${target}, search right half`;
    } else {
      right = mid - 1;
      mid = null;
      highlightedLines.add('line-9');
      highlightedLines.add('line-10');
      currentStep = `${array[mid]} > ${target}, search left half`;
    }
  }

  return {
    ...state,
    left,
    right,
    mid,
    found,
    foundIndex,
    highlightedLines,
    currentStep,
    history: [...history, { left, right, mid, action: currentStep }],
  };
}

export default BinarySearch;
