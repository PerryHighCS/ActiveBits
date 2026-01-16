import React from 'react';
import PseudocodeRenderer from '../../components/PseudocodeRenderer';

const PSEUDOCODE = [
  'InsertionSort(A[0..n−1])',
  '    for i ← 1 to n − 1',
  '        tmp ← A[i]',
  '        j ← i − 1',
  '        while j ≥ 0 and A[j] > tmp',
  '            A[j + 1] ← A[j]',
  '            j ← j − 1',
  '        A[j + 1] ← tmp',
];

/**
 * Algorithm module for Insertion Sort
 */
const InsertionSort = {
  id: 'insertion-sort',
  name: 'Insertion Sort',
  description: 'Build sorted array by inserting elements one by one',
  category: 'sorting',
  pseudocode: PSEUDOCODE,

  initState(arraySize = 8) {
    return {
      array: Array.from({ length: arraySize }, () => Math.floor(Math.random() * 100) + 1),
      i: 1,
      j: 0,
      tmp: null,
      substep: 0,
      sorted: false,
      currentStep: null,
      highlightedLines: new Set(),
    };
  },

  reduceEvent(state, event) {
    if (event.type === 'nextStep') {
      return performNextStep(state);
    }
    if (event.type === 'reset') {
      return InsertionSort.initState(state.array.length);
    }
    if (event.type === 'setArraySize') {
      return InsertionSort.initState(event.payload);
    }
    return state;
  },

  ManagerView({ session, onStateChange }) {
    const state = session.data.algorithmState || InsertionSort.initState();

    const handleNextStep = () => {
      const newState = performNextStep(state);
      onStateChange(newState);
    };

    const handleReset = () => {
      onStateChange(InsertionSort.initState());
    };

    const handleRegenerate = () => {
      onStateChange(InsertionSort.initState());
    };

    return (
      <div className="algorithm-manager">
        <div className="controls">
          <button onClick={handleNextStep} disabled={state.sorted}>
            Next Step
          </button>
          <button onClick={handleReset}>Reset</button>
          <button onClick={handleRegenerate}>Generate New Array</button>
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
    const state = session.data.algorithmState || InsertionSort.initState();
    return (
      <div className="algorithm-student">
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
              idx < state.i ? 'sorted' : ''
            } ${idx === state.i ? 'current-i' : ''}`}
          >
            {val}
          </div>
        ))}
      </div>
      <div className="status">
        i={state.i}, j={state.j}, tmp={state.tmp}
        {state.sorted && <span className="completed"> ✓ Sorted!</span>}
      </div>
    </div>
  );
}

function performNextStep(state) {
  const arr = [...state.array];
  let { i, j, tmp, substep } = state;
  let highlightedLines = new Set();
  let currentStep = null;

  if (state.sorted) return state;

  if (i >= arr.length) {
    return { ...state, sorted: true, currentStep: 'Algorithm complete', highlightedLines: new Set() };
  }

  // Control flow by substep number
  if (substep === 0) {
    // Start new iteration: highlight for loop
    highlightedLines.add('line-1');
    currentStep = `Outer loop: i=${i}`;
    substep = 1;
  } else if (substep === 1) {
    // Get tmp value
    tmp = arr[i];
    highlightedLines.add('line-2');
    currentStep = `Set tmp = A[${i}] = ${tmp}`;
    substep = 2;
  } else if (substep === 2) {
    // Initialize j
    j = i - 1;
    highlightedLines.add('line-3');
    currentStep = `Set j = ${i} - 1 = ${j}`;
    substep = 3;
  } else if (substep === 3) {
    // Check while condition
    const conditionMet = j >= 0 && arr[j] > tmp;
    highlightedLines.add('line-4');
    currentStep = `Check while: j=${j} >= 0 and A[${j}]=${arr[j]} > ${tmp}? ${conditionMet ? 'Yes' : 'No'}`;
    substep = conditionMet ? 4 : 5; // 4 = enter loop body, 5 = skip to insert
  } else if (substep === 4) {
    // Inside while: shift element
    arr[j + 1] = arr[j];
    highlightedLines.add('line-5');
    currentStep = `Shift: A[${j + 1}] = A[${j}] = ${arr[j + 1]}`;
    substep = 4.5;
  } else if (substep === 4.5) {
    // Inside while: decrement j
    j--;
    highlightedLines.add('line-6');
    currentStep = `Decrement: j = ${j}`;
    substep = 3; // Loop back to check condition again
  } else if (substep === 5) {
    // After loop: insert tmp
    arr[j + 1] = tmp;
    i++;
    tmp = null;
    substep = 0;
    highlightedLines.add('line-7');
    currentStep = `Insert: A[${j + 1}] = ${arr[j + 1]}`;
  }

  return {
    ...state,
    array: arr,
    i,
    j,
    tmp,
    substep,
    highlightedLines,
    currentStep,
  };
}

export default InsertionSort;
