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
      onStateChange(performNextStep(state));
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
  let { i, j, tmp } = state;
  let highlightedLines = new Set();
  let currentStep = null;

  if (state.sorted) return state;

  if (i >= arr.length) {
    return { ...state, sorted: true, currentStep: 'Algorithm complete', highlightedLines: new Set(['line-0']) };
  }

  if (tmp === null) {
    tmp = arr[i];
    j = i - 1;
    highlightedLines.add('line-1');
    highlightedLines.add('line-2');
    highlightedLines.add('line-3');
    currentStep = `Starting iteration i=${i}, tmp=${tmp}`;
  } else if (j >= 0 && arr[j] > tmp) {
    arr[j + 1] = arr[j];
    j--;
    highlightedLines.add('line-4');
    highlightedLines.add('line-5');
    highlightedLines.add('line-6');
    currentStep = `Shifted A[${j + 2}] = A[${j + 1}]`;
  } else {
    arr[j + 1] = tmp;
    i++;
    tmp = null;
    highlightedLines.add('line-7');
    currentStep = `Inserted ${arr[j + 1]} at position ${j + 1}`;
  }

  return {
    ...state,
    array: arr,
    i,
    j,
    tmp,
    highlightedLines,
    currentStep,
  };
}

export default InsertionSort;
