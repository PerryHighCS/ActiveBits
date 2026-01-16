import React, { useState, useEffect } from 'react';
import PseudocodeRenderer from '../../components/PseudocodeRenderer';

const PSEUDOCODE = [
  'SelectionSort(A[0..n−1])',
  '    for i ← 0 to n − 2',
  '        minIndex ← i',
  '        for j ← i + 1 to n − 1',
  '            if A[j] < A[minIndex] then',
  '                minIndex ← j',
  '        if minIndex ≠ i then',
  '            swap A[i] and A[minIndex]',
];

/**
 * Algorithm module for Selection Sort
 */
const SelectionSort = {
  id: 'selection-sort',
  name: 'Selection Sort',
  description: 'Find minimum element and swap with current position',
  category: 'sorting',
  pseudocode: PSEUDOCODE,

  /**
   * Initialize algorithm state with random array
   */
  initState(arraySize = 8) {
    return {
      array: Array.from({ length: arraySize }, () => Math.floor(Math.random() * 100) + 1),
      i: 0,
      minIndex: 0,
      j: 0,
      sorted: false,
      currentStep: null,
      highlightedLines: new Set(),
    };
  },

  /**
   * Reduce events: nextStep, reset, setArraySize
   */
  reduceEvent(state, event) {
    if (event.type === 'nextStep') {
      return performNextStep(state);
    }
    if (event.type === 'reset') {
      return SelectionSort.initState(state.array.length);
    }
    if (event.type === 'setArraySize') {
      return SelectionSort.initState(event.payload);
    }
    return state;
  },

  /**
   * Manager view with controls
   */
  ManagerView({ session, onStateChange }) {
    const state = session.data.algorithmState || SelectionSort.initState();

    const handleNextStep = () => {
      const newState = performNextStep(state);
      onStateChange(newState);
    };

    const handleReset = () => {
      onStateChange(SelectionSort.initState());
    };

    const handleRegenerate = () => {
      onStateChange(SelectionSort.initState());
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
          highlightedIds={state.highlightedLines}
        />
      </div>
    );
  },

  /**
   * Student view (read-only)
   */
  StudentView({ session }) {
    const state = session.data.algorithmState || SelectionSort.initState();
    return (
      <div className="algorithm-student">
        <ArrayVisualization state={state} />
        <PseudocodeRenderer
          lines={PSEUDOCODE}
          highlightedIds={state.highlightedLines}
        />
      </div>
    );
  },
};

/**
 * Array visualization component
 */
function ArrayVisualization({ state }) {
  return (
    <div className="array-viz">
      <div className="array-container">
        {state.array.map((val, idx) => (
          <div
            key={idx}
            className={`array-item ${
              idx === state.i ? 'current-i' : ''
            } ${idx === state.minIndex ? 'current-min' : ''} ${
              idx < state.i ? 'sorted' : ''
            }`}
          >
            {val}
          </div>
        ))}
      </div>
      <div className="status">
        i={state.i}, minIndex={state.minIndex}, j={state.j}
        {state.sorted && <span className="completed"> ✓ Sorted!</span>}
      </div>
    </div>
  );
}

/**
 * Perform one step of the algorithm
 */
function performNextStep(state) {
  const arr = [...state.array];
  let { i, j, minIndex } = state;
  let highlightedLines = new Set();
  let currentStep = null;

  // If already sorted, return
  if (state.sorted) {
    return state;
  }

  if (i >= arr.length - 1) {
    // Algorithm complete
    return {
      ...state,
      sorted: true,
      currentStep: 'Algorithm complete',
      highlightedLines: new Set(['line-0']),
    };
  }

  // If j not initialized or completed, start next iteration
  if (j <= i) {
    minIndex = i;
    j = i + 1;
    highlightedLines.add('line-1'); // for loop
    highlightedLines.add('line-2'); // minIndex ← i
    currentStep = `Starting iteration i=${i}`;
  } else if (j < arr.length) {
    // Inner loop: check if A[j] < A[minIndex]
    if (arr[j] < arr[minIndex]) {
      minIndex = j;
      highlightedLines.add('line-4');
      highlightedLines.add('line-5');
      currentStep = `Found smaller: A[${j}]=${arr[j]} < A[${minIndex}]=${arr[minIndex]}`;
    } else {
      highlightedLines.add('line-3');
      highlightedLines.add('line-4');
      currentStep = `A[${j}]=${arr[j]} not smaller, continue`;
    }
    j++;
  } else {
    // Inner loop done, perform swap if needed
    if (minIndex !== i) {
      [arr[i], arr[minIndex]] = [arr[minIndex], arr[i]];
      highlightedLines.add('line-6');
      highlightedLines.add('line-7');
      currentStep = `Swapped A[${i}] and A[${minIndex}]`;
    } else {
      highlightedLines.add('line-6');
      currentStep = `No swap needed`;
    }
    i++;
    j = i + 1;
  }

  return {
    ...state,
    array: arr,
    i,
    j,
    minIndex,
    highlightedLines,
    currentStep,
  };
}

export default SelectionSort;
